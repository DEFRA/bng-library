// Hedgerow trading-rules unit calculations (MVS).
//
// Hedgerows trade on distinctiveness band alone ("same distinctiveness band or
// better"), with no broad-habitat grouping, and carry three bands: Medium, Low
// and Very Low. Unlike area habitats, Very Low hedgerows hold real units, so
// the Very Low band is traded rather than dropped.
//
// Each band is a single net figure — every habitat type's net unit change in
// the band summed regardless of sign — and availability cascades downward only
// while it is positive:
//
//   Low cumulative availability      = Low net      + Medium net,         when Medium net > 0
//   Very Low cumulative availability = Very Low net + Low cumulative,     when Low cumulative > 0
//
// This is the metric's own Trading Summary Hedgerows sheet (I44, I54) exactly,
// and it is deliberately *not* the area-habitat and watercourse shape, which
// carry down the Medium *surplus* (positive nets only). The hedgerow worked
// example tells the two apart: carrying the surplus would report Low cumulative
// availability as -0.4557 where the metric reports -2.1327.
//
// Units available from High and Very High hedgerows are not carried into the
// Medium band: the MVS defines no traded figure for those bands (they are
// rejected at import), so the Medium figure is the Medium net change alone.
//
// This module produces the unit figures only. Met / Not-met statuses are a
// separate concern.

import { HEDGEROW_DISTINCTIVENESS_CATEGORIES } from './reference-constants.mjs'
import {
  calculateCumulativeAvailability,
  calculateHabitatNetUnitChanges,
  LOW_BAND,
  MEDIUM_BAND,
  sumNetChange,
  sumSurplus,
  VERY_LOW_BAND
} from './trading-rules.mjs'

/** The hedgerow bands that carry a traded figure in the MVS. */
const TRADEABLE_BANDS = new Set([MEDIUM_BAND, LOW_BAND, VERY_LOW_BAND])

/**
 * Annotate each habitat type's net unit change with its distinctiveness band,
 * keeping only the bands that trade in the MVS.
 *
 * The band is read straight from the reference table rather than through
 * `resolveLinearDistinctiveness`, which throws on an unrecognised type: one
 * unexpected value must not fail an upload's whole enrichment. Types absent
 * from the reference data are skipped silently — the backend caller warns on
 * any it cannot place.
 *
 * @param {Array<{ habitatType: string, netUnitChange: number }>} netUnitChanges
 * @returns {Array<{ habitatType: string, distinctiveness: string, netUnitChange: number }>}
 */
function tradeableHabitatTypes(netUnitChanges) {
  const habitatTypes = []
  for (const habitat of netUnitChanges) {
    const distinctiveness = Object.hasOwn(
      HEDGEROW_DISTINCTIVENESS_CATEGORIES,
      habitat.habitatType
    )
      ? HEDGEROW_DISTINCTIVENESS_CATEGORIES[habitat.habitatType]
      : undefined
    if (!TRADEABLE_BANDS.has(distinctiveness)) {
      continue
    }
    habitatTypes.push({
      habitatType: habitat.habitatType,
      distinctiveness,
      netUnitChange: habitat.netUnitChange
    })
  }
  return habitatTypes
}

/**
 * @param {Array<{ distinctiveness: string, netUnitChange: number }>} habitatTypes
 * @param {string} band
 * @returns {number} the band's net unit change, summed regardless of sign
 */
function bandNetUnitChange(habitatTypes, band) {
  return sumNetChange(
    habitatTypes
      .filter((habitat) => habitat.distinctiveness === band)
      .map((habitat) => habitat.netUnitChange)
  )
}

/**
 * The units a band makes available to the band below it: its figure when
 * positive, otherwise nothing — a deficit is never carried down.
 *
 * @param {number} figure
 * @returns {number} zero or positive
 */
function carriedDown(figure) {
  return sumSurplus([figure])
}

/**
 * AC1–AC6 — the full hedgerow trading-rules unit figures.
 *
 * Habitat types are the hedgerow reference keys (e.g. "Native hedgerow").
 * Units for both sides are pre-summed by the caller, delivered units being
 * attributed to the habitat each feature delivers into (the proposed type for
 * created and enhanced hedgerows, the baseline type for retained ones).
 *
 * @param {Record<string, number>} baselineUnitsByType type -> summed baseline units
 * @param {Record<string, number>} deliveredUnitsByType type -> summed retained+created+enhanced units
 * @returns {{
 *   habitatTypes: Array<{ habitatType: string, distinctiveness: string, netUnitChange: number }>,
 *   medium: { netUnitChange: number },
 *   low: { netUnitChange: number, cumulativeAvailability: number },
 *   veryLow: { netUnitChange: number, cumulativeAvailability: number }
 * }}
 */
export function calculateHedgerowTradingRules(
  baselineUnitsByType = {},
  deliveredUnitsByType = {}
) {
  const habitatTypes = tradeableHabitatTypes(
    calculateHabitatNetUnitChanges(baselineUnitsByType, deliveredUnitsByType)
  )

  const mediumNetUnitChange = bandNetUnitChange(habitatTypes, MEDIUM_BAND)
  const lowNetUnitChange = bandNetUnitChange(habitatTypes, LOW_BAND)
  const veryLowNetUnitChange = bandNetUnitChange(habitatTypes, VERY_LOW_BAND)

  const lowCumulativeAvailability = calculateCumulativeAvailability(
    carriedDown(mediumNetUnitChange),
    lowNetUnitChange
  )
  const veryLowCumulativeAvailability = calculateCumulativeAvailability(
    carriedDown(lowCumulativeAvailability),
    veryLowNetUnitChange
  )

  return {
    habitatTypes,
    medium: { netUnitChange: mediumNetUnitChange },
    low: {
      netUnitChange: lowNetUnitChange,
      cumulativeAvailability: lowCumulativeAvailability
    },
    veryLow: {
      netUnitChange: veryLowNetUnitChange,
      cumulativeAvailability: veryLowCumulativeAvailability
    }
  }
}
