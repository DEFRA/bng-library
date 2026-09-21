// Area-habitat trading-rules Met / Not-met statuses (BMD-1008).
//
// The unit figures these read come from `calculateAreaHabitatTradingRules`
// (BMD-993). The statuses live here, next to those figures and to the worked
// example that pins them, rather than in the consumer that displays them:
// deciding whether a site meets the trading rules is a calculation, and the
// combination it requires is easy to get wrong in a way that fails towards
// "Met". AC2 in particular reads a figure that deliberately does not reconcile
// to the Statutory Metric, and is only safe because AC3 pairs it with AC1 — a
// consumer implementing AC2 alone would report a site compliant that the metric
// reports short. Deriving here means no consumer performs that combination.
//
// Display is a separate concern: this module produces statuses, not markup.

import {
  combineTradingRuleStatuses,
  tradingRuleStatus,
  TRADING_RULE_NOT_MET
} from './trading-rules.mjs'

/** A broad habitat or band figure below this is in deficit (AC1, AC2). */
const DEFICIT_THRESHOLD = 0

/**
 * AC1–AC4 — the area-habitat trading-rules statuses.
 *
 * AC1: the Medium band is Not met when *any* Medium broad habitat is in
 * deficit, which is the per-broad-habitat cumulative change from BMD-993 AC2
 * and AC3. A broad habitat that nets to exactly zero is not in deficit, so it
 * does not make the band Not met.
 *
 * AC2: the Low band is Not met when the cumulative availability from BMD-993
 * AC7 is below zero. That figure deliberately departs from the metric
 * spreadsheet, which reduces the Medium surplus by the Medium deficit before
 * offering it to the Low band — BMD-1008 records that as a bug in the
 * spreadsheet and takes the undiminished figure on purpose.
 *
 * AC3: the area-habitat status is Not met when either band is.
 *
 * AC4: with no post-intervention upload there is nothing to trade against, so
 * the area-habitat status is Not met. The band statuses are `null` rather than
 * Not met: AC1 and AC2 are both conditioned on *both* files having been
 * uploaded, so neither has been derived.
 *
 * @param {ReturnType<import('./area-trading-rules.mjs').calculateAreaHabitatTradingRules>} tradingRules
 * @param {{ postInterventionUploaded?: boolean }} [options] whether a
 *   post-intervention file has been uploaded. Explicit because it cannot be
 *   inferred from the figures: a project with no post-intervention upload and
 *   one whose post-intervention delivers zero units produce the same totals.
 * @returns {{ medium: string|null, low: string|null, areaHabitats: string }}
 */
export function deriveAreaHabitatTradingRuleStatuses(
  tradingRules,
  { postInterventionUploaded = true } = {}
) {
  if (!postInterventionUploaded) {
    return { medium: null, low: null, areaHabitats: TRADING_RULE_NOT_MET }
  }

  const broadHabitats = tradingRules?.medium?.broadHabitats ?? []
  const medium = tradingRuleStatus(
    !broadHabitats.some(
      (broadHabitat) => broadHabitat.netUnitChange < DEFICIT_THRESHOLD
    )
  )

  const cumulativeAvailability = tradingRules?.low?.cumulativeAvailability ?? 0
  const low = tradingRuleStatus(cumulativeAvailability >= DEFICIT_THRESHOLD)

  return {
    medium,
    low,
    areaHabitats: combineTradingRuleStatuses([medium, low])
  }
}
