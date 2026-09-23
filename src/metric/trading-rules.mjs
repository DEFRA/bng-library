// Trading-rules unit calculations — band-agnostic primitives.
//
// These functions are deliberately pure and module-agnostic so the same
// primitives back the area-habitat rules today and the hedgerow / watercourse
// rules alongside them. They operate on already-computed unit totals: the
// per-feature unit figures are produced by the retained/created/enhanced
// calculators, and trading rules only aggregate them by habitat type and
// distinctiveness band.
//
// Alongside the unit figures, this module owns the Met / Not-met status
// vocabulary (`TRADING_RULE_MET` / `TRADING_RULE_NOT_MET`) and the primitives
// for deriving and combining statuses, so every band's status module reports
// in the same terms.

import {
  WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
  WATERCOURSE_DISTINCTIVENESS_SCORES
} from './reference-constants.mjs'
import { resolveLinearDistinctiveness } from './linear-resolvers.mjs'
import { roundToSigFigs } from './utils.mjs'

/** Net unit change threshold separating a surplus (> 0) from a deficit (< 0). */
const SURPLUS_THRESHOLD = 0

/** Distinctiveness bands that carry trading rules in the MVS. */
export const MEDIUM_BAND = 'Medium'
export const LOW_BAND = 'Low'

/**
 * Coerce a value to a finite number, treating anything else as 0. Mirrors the
 * leniency of the unit summariser so an uncalculated (null) total never
 * poisons an aggregate with NaN.
 *
 * @param {unknown} value
 * @returns {number}
 */
function numericOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Net unit change per unique habitat type across baseline and post-intervention.
 *
 * The delivered total is the sum of a habitat's retained, created and enhanced
 * post-intervention units (enhancement is attributed to the proposed habitat,
 * so units move between types); the baseline total is the sum of that habitat's
 * baseline units. Net unit change is delivered minus baseline.
 *
 * @param {Record<string, number>} baselineUnitsByType type -> summed baseline units
 * @param {Record<string, number>} deliveredUnitsByType type -> summed retained+created+enhanced units
 * @returns {Array<{ habitatType: string, netUnitChange: number }>} one entry per
 *   habitat type present on either side, ordered by habitat type
 */
export function calculateHabitatNetUnitChanges(
  baselineUnitsByType = {},
  deliveredUnitsByType = {}
) {
  const habitatTypes = new Set([
    ...Object.keys(baselineUnitsByType),
    ...Object.keys(deliveredUnitsByType)
  ])
  return [...habitatTypes]
    .sort((a, b) => a.localeCompare(b))
    .map((habitatType) => {
      const delivered = numericOrZero(deliveredUnitsByType[habitatType])
      const baseline = numericOrZero(baselineUnitsByType[habitatType])
      return {
        habitatType,
        netUnitChange: roundToSigFigs(delivered - baseline)
      }
    })
}

/**
 * Sum of the strictly positive net unit changes (a band's total surplus).
 *
 * @param {number[]} netUnitChanges
 * @returns {number} zero or positive
 */
export function sumSurplus(netUnitChanges = []) {
  const total = netUnitChanges
    .filter((value) => value > SURPLUS_THRESHOLD)
    .reduce((sum, value) => sum + value, 0)
  return roundToSigFigs(total)
}

/**
 * Sum of the strictly negative net unit changes (a band's total deficit).
 *
 * @param {number[]} netUnitChanges
 * @returns {number} zero or negative
 */
export function sumDeficit(netUnitChanges = []) {
  const total = netUnitChanges
    .filter((value) => value < SURPLUS_THRESHOLD)
    .reduce((sum, value) => sum + value, 0)
  return roundToSigFigs(total)
}

/**
 * Sum of all net unit changes regardless of sign (a band's net change).
 *
 * @param {number[]} netUnitChanges
 * @returns {number}
 */
export function sumNetChange(netUnitChanges = []) {
  const total = netUnitChanges.reduce((sum, value) => sum + value, 0)
  return roundToSigFigs(total)
}

/**
 * Cumulative availability of units for a lower band: the surplus carried down
 * from a higher band plus that band's own net change.
 *
 * Deliberately *not* named for the Statutory Metric's "Cumulative surplus of
 * units", which is computed differently — see the note on the area-habitat
 * calculator's `low.cumulativeAvailability`.
 *
 * @param {number} higherBandSurplus zero or positive, from {@link sumSurplus}
 * @param {number} lowerBandNetChange from {@link sumNetChange}
 * @returns {number}
 */
export function calculateCumulativeAvailability(
  higherBandSurplus,
  lowerBandNetChange
) {
  return roundToSigFigs(higherBandSurplus + lowerBandNetChange)
}

/**
 * Surplus, deficit and cumulative availability for a module's Medium and Low
 * bands, once that module has decided which net unit changes belong in each.
 *
 * Area habitats pass one net per broad habitat. Watercourses pass one net per
 * habitat type. The arithmetic is the same either way: surplus and deficit are
 * taken from the Medium list, and cumulative availability is the Medium surplus
 * plus the Low net unit change. The Medium deficit is not subtracted.
 *
 * @param {number[]} mediumNetUnitChanges
 * @param {number[]} lowNetUnitChanges
 * @returns {{
 *   medium: { surplus: number, deficit: number },
 *   low: { netUnitChange: number, cumulativeAvailability: number }
 * }}
 */
export function calculateBandTradingFigures(
  mediumNetUnitChanges = [],
  lowNetUnitChanges = []
) {
  const surplus = sumSurplus(mediumNetUnitChanges)
  const netUnitChange = sumNetChange(lowNetUnitChanges)
  return {
    medium: {
      surplus,
      deficit: sumDeficit(mediumNetUnitChanges)
    },
    low: {
      netUnitChange,
      cumulativeAvailability: calculateCumulativeAvailability(
        surplus,
        netUnitChange
      )
    }
  }
}

/** A trading rule that is satisfied. */
export const TRADING_RULE_MET = 'Met'

/** A trading rule that is not satisfied. */
export const TRADING_RULE_NOT_MET = 'Not met'

/**
 * The status a single trading rule resolves to.
 *
 * @param {boolean} isMet
 * @returns {string} {@link TRADING_RULE_MET} or {@link TRADING_RULE_NOT_MET}
 */
export function tradingRuleStatus(isMet) {
  return isMet ? TRADING_RULE_MET : TRADING_RULE_NOT_MET
}

/**
 * The aggregate of several band statuses: Not met if any one of them is.
 *
 * A band whose status was not derived (null — the band's preconditions were not
 * satisfied) does not make the aggregate Not met on its own; the caller decides
 * what an underived band means, because the reason differs per module.
 *
 * @param {Array<string|null>} statuses
 * @returns {string} {@link TRADING_RULE_MET} or {@link TRADING_RULE_NOT_MET}
 */
export function combineTradingRuleStatuses(statuses = []) {
  return tradingRuleStatus(
    !statuses.some((status) => status === TRADING_RULE_NOT_MET)
  )
}

/**
 * Resolve a watercourse type's distinctiveness band and score from the engine's
 * reference tables. Thin wrapper over {@link resolveLinearDistinctiveness} that
 * pins the watercourse category/score maps.
 *
 * @param {string} watercourseType e.g. 'Ditches', 'Canals', 'Culvert'
 * @returns {{ distinctiveness: string, distinctivenessScore: number }}
 */
export function resolveWatercourseDistinctiveness(watercourseType) {
  return resolveLinearDistinctiveness(
    watercourseType,
    WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
    WATERCOURSE_DISTINCTIVENESS_SCORES,
    'watercourse'
  )
}

/**
 * @param {Array<{ habitatType: string, distinctiveness: string, netUnitChange: number }>} habitats
 * @param {string} band
 * @returns {number[]} the net unit changes of the habitats in that band
 */
function netChangesForBand(habitats, band) {
  return habitats
    .filter((habitat) => habitat.distinctiveness === band)
    .map((habitat) => habitat.netUnitChange)
}

/**
 * AC1–AC5 — the full watercourse trading-rules unit figures.
 *
 * @param {Record<string, number>} baselineUnitsByType type -> summed baseline units
 * @param {Record<string, number>} deliveredUnitsByType type -> summed retained+created+enhanced units
 * @returns {{
 *   habitats: Array<{ habitatType: string, distinctiveness: string, netUnitChange: number }>,
 *   medium: { surplus: number, deficit: number },
 *   low: { netUnitChange: number, cumulativeAvailability: number }
 * }}
 */
export function calculateWatercourseTradingRules(
  baselineUnitsByType = {},
  deliveredUnitsByType = {}
) {
  const habitats = calculateHabitatNetUnitChanges(
    baselineUnitsByType,
    deliveredUnitsByType
  ).map((habitat) => ({
    ...habitat,
    distinctiveness: resolveWatercourseDistinctiveness(habitat.habitatType)
      .distinctiveness
  }))

  const { medium, low } = calculateBandTradingFigures(
    netChangesForBand(habitats, MEDIUM_BAND),
    netChangesForBand(habitats, LOW_BAND)
  )

  return { habitats, medium, low }
}
