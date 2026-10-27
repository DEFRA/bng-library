/**
 * The rules a synthetic site's values are drawn by, shared by every layer:
 * retention, conditions, advance/delay years and per-row overrides. Pure
 * apart from the geometry module's random source, which every draw reads in
 * a fixed order, so the same seed gives the same site.
 *
 * Every layer builder consults `perRowOverrides[i]` (see `generateOne`'s
 * `attributeOverrides` contract). A field left unset falls back to the random
 * draw, so a partial override pins only what it names and the rest of the row
 * stays coherent. Fields bound by a template invariant resolve as a unit —
 * the advance/delay pair, retention vs a differing proposed type, and the
 * culvert encroachment sentinel — so a partial override can never break an
 * invariant the random draw maintains.
 */

import { pick, randInt } from '../../geometry.mjs'
import {
  FEATURE_REF_PAD,
  FEATURE_REF_PAD_CHAR
} from '../../workbook/workbook-rows.mjs'
import { RETENTION_CREATED, RETENTION_LOST } from '../../retention.mjs'
import {
  ALL_HABITATS,
  IN_SCOPE_BROAD_HABITAT_TYPES,
  IN_SCOPE_HABITATS,
  IN_SCOPE_HABITATS_BY_BROAD
} from '../synthetic-constants.mjs'
import {
  AREA,
  baselineConditions,
  canCreate,
  creationConditions,
  enhancementPairs
} from '../valid-draws.mjs'

export const ZERO_YEARS = '0'
export const RETENTION_RETAINED = 'Retained'
export const RETENTION_ENHANCED = 'Enhanced'

export function syntheticRef(prefix, i) {
  return `${prefix}${String(i + 1).padStart(FEATURE_REF_PAD, FEATURE_REF_PAD_CHAR)}`
}

// The habitats a random creation can pick: those the metric can create in at
// least one condition, by broad type.
const CREATABLE_HABITATS_BY_BROAD = Object.fromEntries(
  IN_SCOPE_BROAD_HABITAT_TYPES.map((broad) => [
    broad,
    IN_SCOPE_HABITATS_BY_BROAD[broad].filter((h) => canCreate(AREA, h.fullName))
  ]).filter(([, pool]) => pool.length > 0)
)
const CREATABLE_BROAD_TYPES = Object.keys(CREATABLE_HABITATS_BY_BROAD)

export const DEFAULT_HABITAT_POOLS = Object.freeze({
  baseline: IN_SCOPE_HABITATS,
  creatableByBroad: CREATABLE_HABITATS_BY_BROAD,
  creatableBroadTypes: CREATABLE_BROAD_TYPES
})

/**
 * The area habitats a random draw picks from. A `habitatFilter` narrows
 * them, as the BNG Service template's Area Habitats layers do, which offer no
 * vertical area habitat. `excludeOwnTypeCreation` keeps a creation out of the
 * parcel's own habitat type (see `creatableFor`). Without either the pools
 * are the module's own, so every draw is exactly as before.
 *
 * @param {(fullName: string) => boolean} [habitatFilter]
 * @param {{ excludeOwnTypeCreation?: boolean }} [options]
 */
export function habitatPools(
  habitatFilter,
  { excludeOwnTypeCreation = false } = {}
) {
  const excludeOwnType = { excludeOwnType: excludeOwnTypeCreation }
  if (!habitatFilter) {
    return excludeOwnTypeCreation
      ? { ...DEFAULT_HABITAT_POOLS, ...excludeOwnType }
      : DEFAULT_HABITAT_POOLS
  }
  const creatableByBroad = Object.fromEntries(
    Object.entries(CREATABLE_HABITATS_BY_BROAD)
      .map(([broad, pool]) => [
        broad,
        pool.filter((h) => habitatFilter(h.fullName))
      ])
      .filter(([, pool]) => pool.length > 0)
  )
  return {
    baseline: IN_SCOPE_HABITATS.filter((h) => habitatFilter(h.fullName)),
    creatableByBroad,
    creatableBroadTypes: Object.keys(creatableByBroad),
    ...excludeOwnType
  }
}

/**
 * The habitats a creation in `broad` can pick for a parcel of `baseline`.
 * The BNG Service template reads a creation in the parcel's own type as a
 * habitat that gets worse, or one that is not worse at all, and the service
 * refuses either unless it is drawn for the purpose (`addWorseHabitats`). So
 * pools built with `excludeOwnTypeCreation` leave the parcel's own type out;
 * the default pools keep it, so a legacy site draws exactly as before.
 */
export function creatableFor(pools, broad, baseline) {
  const pool = pools.creatableByBroad[broad] ?? []
  return pools.excludeOwnType
    ? pool.filter((h) => h.fullName !== baseline.fullName)
    : pool
}

/** The broad types a "Lost" parcel's creation can pick from. */
export function creationBroadTypes(pools, baseline) {
  return pools.excludeOwnType
    ? pools.creatableBroadTypes.filter(
        (broad) => creatableFor(pools, broad, baseline).length > 0
      )
    : pools.creatableBroadTypes
}

// A retained or enhanced parcel keeps its habitat: an enhancement that
// changes habitat is a distinctiveness uplift, which a scenario pins. A
// creation takes a habitat the metric can create: "Lost" in a new broad type,
// "Created" in the parcel's own.
function pickProposedHabitat(baseline, retention, pools) {
  if (retention === RETENTION_RETAINED || retention === RETENTION_ENHANCED) {
    return baseline
  }
  const proposedBroad =
    retention === RETENTION_LOST
      ? pick(creationBroadTypes(pools, baseline))
      : baseline.broad
  const pool = creatableFor(pools, proposedBroad, baseline)
  // A pinned habitat can sit in a broad type the random pools exclude (e.g.
  // "Intertidal hard structures"). Enhancing or creating within that broad
  // type has nothing to draw from, so the baseline habitat carries through —
  // the row stays internally consistent either way.
  return pool.length > 0 ? pick(pool) : baseline
}

export function findHabitatByFullName(fullName) {
  const habitat = ALL_HABITATS.find((h) => h.fullName === fullName)
  if (!habitat) {
    throw new Error(
      `habitatFullName "${fullName}" not found in ALL_HABITATS reference data`
    )
  }
  return habitat
}

// The proposed area habitat: a pinned `proposedHabitatFullName` wins (this is
// how a scenario forces, say, a Low→Medium distinctiveness uplift), otherwise
// it is derived from the baseline and retention as before.
export function resolveProposedHabitat(override, baseline, retention, pools) {
  if (override?.proposedHabitatFullName) {
    return findHabitatByFullName(override.proposedHabitatFullName)
  }
  return pickProposedHabitat(baseline, retention, pools)
}

/**
 * Draw the advance/delay pair for a created feature. At most one of the two
 * is non-zero: the statutory metric (and the backend's
 * ADVANCE_AND_DELAY_BOTH_SET check) rejects a habitat carrying both, so a
 * random fixture must never produce the pair.
 */
function randomAdvanceDelay(maxAdvance, maxDelay) {
  if (randInt(0, 1) === 0) {
    return [String(randInt(0, maxAdvance)), ZERO_YEARS]
  }
  return [ZERO_YEARS, String(randInt(0, maxDelay))]
}

// An explicit override for `key` wins over the random `fallback`; used for the
// baseline-side cells, which are never blanked by `incomplete`.
export function overrideOr(override, key, fallback) {
  return override?.[key] ?? fallback
}

// A proposed-side cell. An explicit override always wins — a scenario that
// names a field owns its value, even on an `incomplete` row. Otherwise an
// `incomplete` row leaves the cell blank to model post-intervention data a
// user has not finished entering, and every other row takes the random
// `fallback`.
export function resolveProposed(override, key, fallback) {
  if (override?.[key] !== undefined) {
    return override[key]
  }
  if (override?.incomplete) {
    return null
  }
  return fallback
}

// The advance/delay pair. The statutory metric allows at most one of the two
// to be non-zero, so the pair always resolves as a unit: an override naming
// either field pins the whole pair (the un-named side stays zero) — merging a
// single overridden field with the random draw could set both. Only a fully
// un-overridden Created row takes the random draw.
export function resolveAdvanceDelay(override, retention, maxAdvance, maxDelay) {
  if (
    override?.advanceYears !== undefined ||
    override?.delayYears !== undefined
  ) {
    return [
      override.advanceYears ?? ZERO_YEARS,
      override.delayYears ?? ZERO_YEARS
    ]
  }
  if (retention === RETENTION_CREATED) {
    return randomAdvanceDelay(maxAdvance, maxDelay)
  }
  return [ZERO_YEARS, ZERO_YEARS]
}

export function pickOr(options, fallback) {
  return options.length > 0 ? pick(options) : fallback
}

// The proposed condition when an enhancement pair does not apply: a retained
// feature keeps its condition, an enhancement that changes type (a pinned
// uplift) takes any condition the new type can have, and a created one a
// condition the metric can create it in.
function proposedConditionFallback(kind, proposedType, retention, baseline) {
  if (retention === RETENTION_RETAINED) {
    return baseline
  }
  if (retention === RETENTION_ENHANCED) {
    return pickOr(baselineConditions(kind, proposedType), baseline)
  }
  return pickOr(creationConditions(kind, proposedType), baseline)
}

/**
 * The baseline and proposed conditions a row falls back to where a scenario
 * does not pin them, drawn so the metric accepts them: a condition the type
 * can have, an enhancement that improves on the baseline, a creation in a
 * condition the type can be created in. Pinned values still win at the call
 * site; this only makes the unpinned side agree with them where it can.
 */
export function drawConditions(
  kind,
  baselineType,
  proposedType,
  retention,
  override
) {
  const pinnedFrom = override?.baselineCondition
  const pinnedTo = override?.proposedCondition
  if (retention === RETENTION_ENHANCED && proposedType === baselineType) {
    const pairs = enhancementPairs(kind, baselineType).filter(
      ([from, to]) =>
        (pinnedFrom === undefined || from === pinnedFrom) &&
        (pinnedTo === undefined || to === pinnedTo)
    )
    if (pairs.length > 0) {
      const [from, to] = pick(pairs)
      return { baseline: from, proposed: to }
    }
  }
  const baseline =
    pinnedFrom ?? pickOr(baselineConditions(kind, baselineType), null)
  return {
    baseline,
    proposed: proposedConditionFallback(kind, proposedType, retention, baseline)
  }
}

// The retention categories a feature can validly take at random: no
// enhancement the metric cannot make, no creation it cannot create. `lose`
// false drops Lost, for an area parcel whose creation elsewhere has nothing
// to pick from; left out, Lost stays.
export function validRetentionPool(pool, { enhance, create, lose = true }) {
  return pool.filter(
    (retention) =>
      (retention !== RETENTION_ENHANCED || enhance) &&
      (retention !== RETENTION_CREATED || create) &&
      (retention !== RETENTION_LOST || lose)
  )
}

// Retention couples to the proposed type: a Retained feature keeps its
// baseline type, so an override pinning a proposed type that differs from the
// baseline cannot share a row with a randomly drawn Retained. When a scenario
// pins the proposed side without pinning retention, Retained drops out of the
// draw; an explicit retention override always wins. A row with nothing left to
// draw (a culvert that changes type, with Lost and Enhanced out of its pool,
// say) asks for a retention none can give, so fail loudly, naming the row by
// `label`, rather than write it with none.
export function resolveRetention(override, pool, proposedTypeDiffers, label) {
  if (override?.retention !== undefined) {
    return override.retention
  }
  const drawable = proposedTypeDiffers
    ? pool.filter((category) => category !== RETENTION_RETAINED)
    : pool
  if (drawable.length === 0) {
    const why = proposedTypeDiffers
      ? ` once "${RETENTION_RETAINED}" drops out for the pinned proposed type`
      : ''
    throw new Error(
      `${label}: no retention category is left to draw${why}; pin \`retention\` in the override`
    )
  }
  return pick(drawable)
}
