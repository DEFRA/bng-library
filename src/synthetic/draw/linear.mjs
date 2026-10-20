/**
 * Draw a synthetic site's hedgerows and watercourses: lines inside the red
 * line, each with its type, retention, conditions, years and, for a
 * watercourse, encroachment.
 */

import { generateLinestring, lineInsideRing, pick } from '../../geometry.mjs'
import { RETENTION_CREATED, RETENTION_LOST } from '../../retention.mjs'
import {
  BASELINE_STRATEGIC_SIGNIFICANCE,
  CULVERT_ENCROACHMENT,
  CULVERT_TYPE,
  ENCROACHMENT_RIPARIAN,
  ENCROACHMENT_WATERCOURSE,
  IN_SCOPE_HEDGE_TYPES,
  IN_SCOPE_RIVER_TYPES,
  LINE_FEATURE_REJECTION_BUDGET_FACTOR,
  LOCATIONS,
  PROPOSED_STRATEGIC_SIGNIFICANCE,
  RETENTION_CATEGORIES,
  SPATIAL_RISK_HABITAT,
  SPATIAL_RISK_RIVER
} from '../synthetic-constants.mjs'
import {
  HEDGEROW,
  WATERCOURSE,
  canCreate,
  canEnhance,
  encroachmentNoWorseThan
} from '../valid-draws.mjs'
import {
  RETENTION_ENHANCED,
  RETENTION_RETAINED,
  drawConditions,
  overrideOr,
  pickOr,
  resolveAdvanceDelay,
  resolveProposed,
  resolveRetention,
  syntheticRef,
  validRetentionPool
} from './rules.mjs'

const MAX_HEDGE_ADVANCE_YEARS = 3
const MAX_HEDGE_DELAY_YEARS = 2
const MAX_RIVER_ADVANCE_YEARS = 3
const MAX_RIVER_DELAY_YEARS = 2

// The first two rivers are deterministically seeded (culvert + non-culvert) to
// exercise both baseline watercourse branches; see `pickRiverType`.
const SEEDED_RIVER_COUNT = 2
// The next river (index 2, present once a fixture has three or more) is seeded
// Created, so any fixture large enough to reach it exercises the created
// watercourse branch without relying on the retention draw; see
// `riverRetentionPool`.
const CREATED_RIVER_INDEX = 2

// A row pinned to a length range accepts only a fraction of the lines drawn,
// so a layer with one gets a larger rejection budget.
const LENGTH_RANGE_BUDGET_MULTIPLIER = 10

/**
 * Whether a drawn line suits the row it would become: any line does, unless
 * the row's override pins a `lengthRange` of [min, max] metres. Unrounded, so
 * the check sees the length the backend measures.
 */
function suitsRow(coords, override) {
  const range = override?.lengthRange
  if (!range) {
    return true
  }
  let length = 0
  for (let i = 1; i < coords.length; i += 1) {
    length += Math.hypot(
      coords[i][0] - coords[i - 1][0],
      coords[i][1] - coords[i - 1][1]
    )
  }
  return length >= range[0] && length <= range[1]
}

/**
 * The index of the earlier feature a row's `sameLineAs` names ("HG001" is
 * the first), or null when the row draws a line of its own. The catalogue
 * checks the ref names an earlier row of the same layer.
 */
function sameLineIndex(override) {
  const match = /(\d+)$/.exec(override?.sameLineAs ?? '')
  return match ? Number(match[1]) - 1 : null
}

/**
 * Shared rejection-sampling driver for the line layers. Draws linestrings
 * via `generateLinestring`, rejects any whose vertices fall outside the
 * boundary — or whose length falls outside the row's pinned `lengthRange` —
 * and keeps up to `count`, drawing each row's values as its line is kept. A
 * row pinned with `sameLineAs` takes that earlier feature's line instead of
 * drawing one, as a hedgerow recreated in place of a lost one does.
 */
function drawLineFeatures(boundaryRing, count, perRowOverrides, drawRow) {
  const features = []
  let attempts = 0
  const pinsLength = perRowOverrides?.some((o) => o?.lengthRange) ?? false
  const maxAttempts =
    count *
    LINE_FEATURE_REJECTION_BUDGET_FACTOR *
    (pinsLength ? LENGTH_RANGE_BUDGET_MULTIPLIER : 1)
  while (features.length < count && attempts < maxAttempts) {
    const produced = features.length
    const copied = features[sameLineIndex(perRowOverrides?.[produced])]?.coords
    if (copied) {
      features.push(drawRow(copied, produced))
      continue
    }
    attempts += 1
    const coords = generateLinestring(boundaryRing)
    if (
      coords &&
      lineInsideRing(coords, boundaryRing) &&
      suitsRow(coords, perRowOverrides?.[produced])
    ) {
      features.push(drawRow(coords, produced))
    }
  }
  return features
}

// A lost hedgerow's proposed type is drawn afresh, so it must also stay in
// scope. A created hedgerow has no baseline: the drawn type describes what is
// being planted.
function drawHedgerow(coords, i, override) {
  const hedgeType = override?.hedgeType ?? pick(IN_SCOPE_HEDGE_TYPES)
  const proposedDiffers =
    override?.proposedHedgeType !== undefined &&
    override.proposedHedgeType !== hedgeType
  const retention = resolveRetention(
    override,
    validRetentionPool(RETENTION_CATEGORIES, {
      enhance: canEnhance(HEDGEROW, hedgeType),
      create: canCreate(HEDGEROW, hedgeType)
    }),
    proposedDiffers
  )
  const proposedType =
    override?.proposedHedgeType ??
    (retention === RETENTION_LOST ? pick(IN_SCOPE_HEDGE_TYPES) : hedgeType)
  const conditions = drawConditions(
    HEDGEROW,
    hedgeType,
    proposedType,
    retention,
    override
  )
  const [advanceYears, delayYears] = resolveAdvanceDelay(
    override,
    retention,
    MAX_HEDGE_ADVANCE_YEARS,
    MAX_HEDGE_DELAY_YEARS
  )
  const drawnSignificance = pick(PROPOSED_STRATEGIC_SIGNIFICANCE)
  const spatialRisk = pick(SPATIAL_RISK_HABITAT)
  const location = pick(LOCATIONS)
  return {
    coords,
    ref: syntheticRef('HG', i),
    type: hedgeType,
    proposedType,
    retention,
    ...commonValues(override, conditions, drawnSignificance),
    advanceYears,
    delayYears,
    spatialRisk,
    location
  }
}

/** The condition and significance cells every layer shares. */
function commonValues(override, conditions, drawnSignificance) {
  return {
    baselineCondition: overrideOr(
      override,
      'baselineCondition',
      conditions.baseline
    ),
    baselineSignificance: overrideOr(
      override,
      'baselineStrategicSignificance',
      BASELINE_STRATEGIC_SIGNIFICANCE
    ),
    proposedCondition: resolveProposed(
      override,
      'proposedCondition',
      conditions.proposed
    ),
    proposedSignificance: resolveProposed(
      override,
      'proposedStrategicSignificance',
      drawnSignificance
    )
  }
}

export function drawHedgerows(boundaryRing, count, perRowOverrides) {
  return drawLineFeatures(boundaryRing, count, perRowOverrides, (coords, i) =>
    drawHedgerow(coords, i, perRowOverrides?.[i])
  )
}

// In-scope river types excluding culverts, used to seed the non-culvert row.
const NON_CULVERT_IN_SCOPE_RIVER_TYPES = IN_SCOPE_RIVER_TYPES.filter(
  (type) => type !== CULVERT_TYPE
)

// Guarantee both watercourse dropdown branches are represented: the
// first river is always a Culvert and the second a non-culvert, so any file
// with at least two rivers exercises the culvert and non-culvert cases.
// Remaining rivers are random.
function pickRiverType(index) {
  if (index === 0) {
    return CULVERT_TYPE
  }
  if (index === 1) {
    return pick(NON_CULVERT_IN_SCOPE_RIVER_TYPES)
  }
  return pick(IN_SCOPE_RIVER_TYPES)
}

// The seeded culvert and non-culvert rows exist to exercise their baseline
// dropdown branches, so they must carry a real baseline. A Created watercourse
// has none, so the seeded rows draw retention from the baseline-bearing
// categories only.
const RETENTION_WITH_BASELINE = RETENTION_CATEGORIES.filter(
  (retention) => retention !== RETENTION_CREATED
)

function riverRetentionPool(index) {
  if (index < SEEDED_RIVER_COUNT) {
    return RETENTION_WITH_BASELINE
  }
  if (index === CREATED_RIVER_INDEX) {
    return [RETENTION_CREATED]
  }
  return RETENTION_CATEGORIES
}

// The encroachment override fields, split by the side of the row they pin.
// Encroachment couples to the river type: a culvert's two encroachment
// columns are fixed to the "N/A - Culvert" sentinel.
const BASELINE_ENCROACHMENT_OVERRIDE_KEYS = [
  'baselineWaterEncroachment',
  'baselineRiparianEncroachment'
]
const PROPOSED_ENCROACHMENT_OVERRIDE_KEYS = [
  'proposedWaterEncroachment',
  'proposedRiparianEncroachment'
]

function hasAnyOverride(override, keys) {
  return keys.some((key) => override?.[key] !== undefined)
}

// The baseline river type. A pinned `riverType` wins. Otherwise a row whose
// override pins an encroachment degree cannot take the seeded culvert — its
// encroachment columns are fixed to the culvert sentinel — so the draw is
// steered to the non-culvert types. The proposed side counts too when
// `proposedRiverType` is not pinned, because it defaults to this type.
function resolveRiverType(override, index) {
  if (override?.riverType !== undefined) {
    return override.riverType
  }
  const pinsEncroachment =
    hasAnyOverride(override, BASELINE_ENCROACHMENT_OVERRIDE_KEYS) ||
    (override?.proposedRiverType === undefined &&
      hasAnyOverride(override, PROPOSED_ENCROACHMENT_OVERRIDE_KEYS))
  if (pinsEncroachment) {
    return pick(NON_CULVERT_IN_SCOPE_RIVER_TYPES)
  }
  return pickRiverType(index)
}

// A scenario that pins a culvert together with a non-sentinel encroachment
// asks for a row no template can express — fail loudly rather than draw it.
function assertCulvertEncroachment(riverType, override, keys, rowIndex) {
  if (riverType !== CULVERT_TYPE) {
    return
  }
  for (const key of keys) {
    const value = override?.[key]
    if (value !== undefined && value !== CULVERT_ENCROACHMENT) {
      throw new Error(
        `rivers row ${rowIndex}: ${key} "${value}" conflicts with the pinned ` +
          `"${CULVERT_TYPE}" type — a culvert's encroachment is fixed to ` +
          `"${CULVERT_ENCROACHMENT}"`
      )
    }
  }
}

// Encroachment does not apply to a culvert: both columns take the fixed
// "N/A - Culvert" category. Non-culverts draw a random degree, and baseline vs
// proposed are resolved independently so they can differ.
function riverEncroachment(riverType) {
  if (riverType === CULVERT_TYPE) {
    return { water: CULVERT_ENCROACHMENT, riparian: CULVERT_ENCROACHMENT }
  }
  return {
    water: pick(ENCROACHMENT_WATERCOURSE),
    riparian: pick(ENCROACHMENT_RIPARIAN)
  }
}

// The proposed encroachment. A retained watercourse keeps its baseline
// encroachment, and an enhanced one never worsens it (the metric flags an
// enhancement that does); a created one, a lost one, a type change or a
// culvert draws afresh.
function proposedRiverEncroachment(
  retention,
  riverType,
  proposedRiverType,
  baseline
) {
  const keepsType =
    proposedRiverType === riverType && riverType !== CULVERT_TYPE
  if (keepsType && retention === RETENTION_RETAINED) {
    return baseline
  }
  if (keepsType && retention === RETENTION_ENHANCED) {
    return {
      water: pickOr(
        encroachmentNoWorseThan(
          'water',
          ENCROACHMENT_WATERCOURSE,
          baseline.water
        ),
        baseline.water
      ),
      riparian: pickOr(
        encroachmentNoWorseThan(
          'riparian',
          ENCROACHMENT_RIPARIAN,
          baseline.riparian
        ),
        baseline.riparian
      )
    }
  }
  return riverEncroachment(proposedRiverType)
}

// Unlike a hedgerow, a watercourse keeps its baseline type through the
// intervention by default, so `proposedRiverType` defaults to the baseline
// type; a scenario can still pin a different proposed type. Only a created
// watercourse carries creation years, and at most one of advance / delay.
function drawRiver(coords, i, override) {
  const riverType = resolveRiverType(override, i)
  const proposedType = override?.proposedRiverType ?? riverType
  assertCulvertEncroachment(
    riverType,
    override,
    BASELINE_ENCROACHMENT_OVERRIDE_KEYS,
    i
  )
  assertCulvertEncroachment(
    proposedType,
    override,
    PROPOSED_ENCROACHMENT_OVERRIDE_KEYS,
    i
  )
  const proposedDiffers =
    override?.proposedRiverType !== undefined &&
    override.proposedRiverType !== riverType
  const retention = resolveRetention(
    override,
    validRetentionPool(riverRetentionPool(i), {
      enhance: canEnhance(WATERCOURSE, riverType),
      create: true
    }),
    proposedDiffers
  )
  const conditions = drawConditions(
    WATERCOURSE,
    riverType,
    proposedType,
    retention,
    override
  )
  const drawnEncroachment = riverEncroachment(riverType)
  const baselineEncroachment = {
    water: overrideOr(
      override,
      'baselineWaterEncroachment',
      drawnEncroachment.water
    ),
    riparian: overrideOr(
      override,
      'baselineRiparianEncroachment',
      drawnEncroachment.riparian
    )
  }
  const proposedEncroachment = proposedRiverEncroachment(
    retention,
    riverType,
    proposedType,
    baselineEncroachment
  )
  const [advanceYears, delayYears] = resolveAdvanceDelay(
    override,
    retention,
    MAX_RIVER_ADVANCE_YEARS,
    MAX_RIVER_DELAY_YEARS
  )
  const drawnSignificance = pick(PROPOSED_STRATEGIC_SIGNIFICANCE)
  const spatialRisk = pick(SPATIAL_RISK_RIVER)
  const location = pick(LOCATIONS)
  return {
    coords,
    ref: syntheticRef('R', i),
    type: riverType,
    proposedType,
    retention,
    ...commonValues(override, conditions, drawnSignificance),
    baselineEncroachment,
    proposedEncroachment: {
      water: resolveProposed(
        override,
        'proposedWaterEncroachment',
        proposedEncroachment.water
      ),
      riparian: resolveProposed(
        override,
        'proposedRiparianEncroachment',
        proposedEncroachment.riparian
      )
    },
    advanceYears,
    delayYears,
    spatialRisk,
    location
  }
}

export function drawRivers(boundaryRing, count, perRowOverrides) {
  return drawLineFeatures(boundaryRing, count, perRowOverrides, (coords, i) =>
    drawRiver(coords, i, perRowOverrides?.[i])
  )
}
