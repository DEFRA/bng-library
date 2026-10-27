/**
 * Draw a synthetic site's area habitat parcels: the red line tiled into
 * parcels, each with its habitat, retention, conditions and years.
 */

import { partitionPolygon, pick } from '../../geometry.mjs'
import {
  BASELINE_STRATEGIC_SIGNIFICANCE,
  LOCATIONS,
  PROPOSED_STRATEGIC_SIGNIFICANCE,
  RETENTION_CATEGORIES,
  SPATIAL_RISK_HABITAT
} from '../synthetic-constants.mjs'
import { AREA, canEnhance } from '../valid-draws.mjs'
import {
  DEFAULT_HABITAT_POOLS,
  creatableFor,
  creationBroadTypes,
  drawConditions,
  findHabitatByFullName,
  overrideOr,
  resolveAdvanceDelay,
  resolveProposed,
  resolveProposedHabitat,
  resolveRetention,
  syntheticRef,
  validRetentionPool
} from './rules.mjs'

const MAX_CREATED_ADVANCE_YEARS = 5
const MAX_CREATED_DELAY_YEARS = 3

/**
 * One parcel's values. `retention` is one of Retained, Enhanced, Created (a
 * creation in the parcel's own broad type) and Lost (a creation in another);
 * the legacy layout writes both creations as "Lost".
 */
function drawParcel(ring, i, override, pools) {
  const baseline = override?.habitatFullName
    ? findHabitatByFullName(override.habitatFullName)
    : pick(pools.baseline)
  const proposedDiffers =
    override?.proposedHabitatFullName !== undefined &&
    override.proposedHabitatFullName !== baseline.fullName
  const retention = resolveRetention(
    override,
    validRetentionPool(RETENTION_CATEGORIES, {
      enhance: canEnhance(AREA, baseline.fullName),
      create: creatableFor(pools, baseline.broad, baseline).length > 0,
      lose: creationBroadTypes(pools, baseline).length > 0
    }),
    proposedDiffers,
    `habitats row ${i}`
  )
  const proposed = resolveProposedHabitat(override, baseline, retention, pools)
  const conditions = drawConditions(
    AREA,
    baseline.fullName,
    proposed.fullName,
    retention,
    override
  )
  const [advanceYears, delayYears] = resolveAdvanceDelay(
    override,
    retention,
    MAX_CREATED_ADVANCE_YEARS,
    MAX_CREATED_DELAY_YEARS
  )
  // The significance, spatial risk and location draws follow in this order
  // whatever the override, so the rest of the site draws the same.
  const drawnSignificance = pick(PROPOSED_STRATEGIC_SIGNIFICANCE)
  const spatialRisk = pick(SPATIAL_RISK_HABITAT)
  const location = pick(LOCATIONS)
  return {
    ring,
    ref: override?.parcelRef ?? syntheticRef('H', i),
    baseline,
    proposed,
    retention,
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
    ),
    advanceYears,
    delayYears,
    spatialRisk,
    location
  }
}

/**
 * The parcels tiling `boundaryRing`. `perRowOverrides[i]`, if provided, pins
 * values on parcel i; fields not set there are drawn as normal.
 */
export function drawHabitats(
  boundaryRing,
  numParcels,
  perRowOverrides,
  pools = DEFAULT_HABITAT_POOLS
) {
  const parcels = partitionPolygon(boundaryRing, numParcels)
  return parcels.map((ring, i) =>
    drawParcel(ring, i, perRowOverrides?.[i], pools)
  )
}
