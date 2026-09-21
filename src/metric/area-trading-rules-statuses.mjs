// Area-habitat trading-rules Met / Not-met statuses.
//
// The unit figures these read come from `calculateAreaHabitatTradingRules`.
// The statuses live here, next to those figures and the worked example that
// pins them, rather than in the consumer that displays them: deciding whether
// a site meets the trading rules is a calculation, and the combination it
// needs is easy to get wrong in a way that wrongly reports "Met".
//
// The Low band rule is the one to watch. It reads a figure that deliberately
// does not reconcile to the metric spreadsheet, and is only safe because the
// site-wide status takes the Medium band into account as well. Anyone applying
// the Low rule on its own would report a site compliant that the spreadsheet
// reports short. Deriving here means no consumer performs that combination.
//
// Display is a separate concern: this module produces statuses, not markup.

import {
  combineTradingRuleStatuses,
  tradingRuleStatus,
  TRADING_RULE_NOT_MET
} from './trading-rules.mjs'

/** A broad habitat or band figure below this is in deficit. */
const DEFICIT_THRESHOLD = 0

/**
 * The area-habitat trading-rules statuses.
 *
 * Medium band: Not met when *any* Medium broad habitat is in deficit — when its
 * cumulative net unit change is below zero. A broad habitat that nets to
 * exactly zero is not in deficit, so it does not make the band Not met.
 *
 * Low band: Not met when the cumulative availability figure is below zero. That
 * figure deliberately departs from the metric spreadsheet, which reduces the
 * Medium surplus by the Medium deficit before offering it to the Low band. We
 * treat that reduction as a bug in the spreadsheet and carry the surplus down
 * whole.
 *
 * Area habitats: Not met when either band is. This is what makes the Low band
 * rule safe — the deficit the Low band was allowed to ignore still fails the
 * site through the Medium band.
 *
 * With no post-intervention upload there is nothing to trade against, so the
 * area-habitat status is Not met and both band statuses are `null`: each band
 * rule requires both files to have been uploaded, so neither was derived.
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
