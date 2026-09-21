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

import { roundToSigFigs } from './utils.mjs'

/** Net unit change threshold separating a surplus (> 0) from a deficit (< 0). */
const SURPLUS_THRESHOLD = 0

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
