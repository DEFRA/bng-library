// Area-habitat trading-rules unit calculations (MVS).
//
// Area habitats differ from the linear modules in one substantive way: Medium
// distinctiveness trades at *broad habitat* level ("same broad habitat or a
// higher distinctiveness habitat required"), so the Medium band is aggregated
// per broad habitat before surplus and deficit are taken. Low distinctiveness
// trades on distinctiveness alone, with no broad-habitat constraint, so it is
// aggregated across the band as a whole.
//
// Individual trees are area habitats here: the reference data keys them as
// "Individual trees - Urban tree" / "- Rural tree", so they fall out of the
// same aggregation as habitat parcels with no special handling.
//
// `low.cumulativeAvailability` deliberately does not reconcile to the published
// metric — see the note on it below before using it as though it did.
//
// This module produces the unit figures only; the Met / Not-met statuses are
// derived from them in area-trading-rules-statuses.mjs.

import { DISTINCTIVENESS_CATEGORIES } from './reference-constants.mjs'
import {
  calculateBandTradingFigures,
  calculateHabitatNetUnitChanges,
  LOW_BAND,
  MEDIUM_BAND,
  sumNetChange
} from './trading-rules.mjs'

/**
 * Separator between the broad habitat and the habitat type in a reference key,
 * e.g. "Grassland - Modified grassland".
 */
const BROAD_HABITAT_SEPARATOR = ' - '

const INTERTIDAL_SEDIMENT = 'Intertidal sediment'
const INTERTIDAL_HARD_STRUCTURES = 'Intertidal hard structures'

/**
 * AC3 — intertidal sediment and intertidal hard structures are treated as one
 * broad habitat for trading purposes, so their Medium net unit changes are
 * cumulated together under this label rather than separately.
 */
export const MERGED_INTERTIDAL_BROAD_HABITAT =
  'Intertidal sediment and hard structures'

/**
 * The broad habitat an area-habitat reference key belongs to. Keys are
 * "{Broad habitat} - {Habitat type}"; a habitat type may itself contain the
 * separator (e.g. "Woodland and forest - Other woodland; mixed"), so only the
 * first occurrence separates the two.
 *
 * @param {string} habitatType e.g. 'Lakes - Reservoirs'
 * @returns {string} the broad habitat, or the whole key when it carries no separator
 */
export function broadHabitatOf(habitatType) {
  if (typeof habitatType !== 'string') {
    return ''
  }
  const index = habitatType.indexOf(BROAD_HABITAT_SEPARATOR)
  if (index === -1) {
    return habitatType
  }
  return habitatType.slice(0, index)
}

/**
 * The broad habitat a habitat cumulates under for trading purposes.
 *
 * For a Medium habitat that is the AC3 merge: the two intertidal broad habitats
 * fold into one, so a caller can group the Medium habitats by this and match
 * `medium.broadHabitats` exactly rather than re-implementing the merge.
 *
 * The merge is Medium-only. Low distinctiveness trades on distinctiveness alone,
 * with no broad-habitat constraint, so a Low intertidal habitat has no merged
 * group to belong to and keeps its ordinary broad habitat — reporting one under
 * the merged Medium label would place it in a group AC3 never put it in.
 *
 * @param {string} broadHabitat
 * @param {string} distinctiveness
 * @returns {string}
 */
function tradingBroadHabitatOf(broadHabitat, distinctiveness) {
  const isIntertidal =
    broadHabitat === INTERTIDAL_SEDIMENT ||
    broadHabitat === INTERTIDAL_HARD_STRUCTURES
  if (distinctiveness === MEDIUM_BAND && isIntertidal) {
    return MERGED_INTERTIDAL_BROAD_HABITAT
  }
  return broadHabitat
}

/**
 * Annotate each habitat's net unit change with its broad habitat and
 * distinctiveness band, keeping only the bands that trade in the MVS.
 *
 * Very Low habitats are excluded because they hold zero units and trading does
 * not apply to them; High and Very High are excluded because the MVS defines no
 * traded figure for them (they require the same habitat, not a band trade).
 * Habitat types absent from the reference data are skipped silently — this
 * function has no logger. The backend caller resolves every habitat type against
 * the reference data before calling and warns on any it cannot place, so an
 * unrecognised type is reported there rather than here.
 *
 * @param {Array<{ habitatType: string, netUnitChange: number }>} netUnitChanges
 * @returns {Array<{ habitatType: string, broadHabitat: string, tradingBroadHabitat: string, distinctiveness: string, netUnitChange: number }>}
 */
function tradeableHabitats(netUnitChanges) {
  const habitats = []
  for (const habitat of netUnitChanges) {
    const distinctiveness = DISTINCTIVENESS_CATEGORIES[habitat.habitatType]
    if (distinctiveness !== MEDIUM_BAND && distinctiveness !== LOW_BAND) {
      continue
    }
    const broadHabitat = broadHabitatOf(habitat.habitatType)
    habitats.push({
      habitatType: habitat.habitatType,
      broadHabitat,
      tradingBroadHabitat: tradingBroadHabitatOf(broadHabitat, distinctiveness),
      distinctiveness,
      netUnitChange: habitat.netUnitChange
    })
  }
  return habitats
}

/**
 * AC2 + AC3 — cumulative net unit change per broad habitat, for the Medium
 * habitats only, with the two intertidal broad habitats merged into one entry.
 *
 * @param {Array<{ broadHabitat: string, distinctiveness: string, netUnitChange: number }>} habitats
 * @returns {Array<{ broadHabitat: string, netUnitChange: number }>} ordered by broad habitat
 */
function cumulativeBroadHabitatChanges(habitats) {
  const totals = new Map()
  for (const habitat of habitats) {
    if (habitat.distinctiveness !== MEDIUM_BAND) {
      continue
    }
    const running = totals.get(habitat.tradingBroadHabitat) ?? 0
    totals.set(habitat.tradingBroadHabitat, running + habitat.netUnitChange)
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([broadHabitat, netUnitChange]) => ({
      broadHabitat,
      netUnitChange: sumNetChange([netUnitChange])
    }))
}

/**
 * AC1–AC7 — the full area-habitat trading-rules unit figures.
 *
 * Habitat types are the engine reference keys ("{Broad habitat} - {Habitat
 * type}"), covering habitat parcels and individual trees alike. Units for both
 * sides are pre-summed by the caller.
 *
 * `habitatTypes` holds one entry per unique habitat type, not per feature — the
 * caller has already summed each type's units across its parcels and trees.
 *
 * Each entry carries `tradingBroadHabitat`, the key to group it under.
 * It differs from `broadHabitat` only for Medium intertidal habitats, where the
 * AC3 merge applies; every Low habitat keeps its ordinary broad habitat, because
 * the Low band does not trade per broad habitat and AC3 never merges it.
 *
 * @param {Record<string, number>} baselineUnitsByType type -> summed baseline units
 * @param {Record<string, number>} deliveredUnitsByType type -> summed retained+created+enhanced units
 * @returns {{
 *   habitatTypes: Array<{ habitatType: string, broadHabitat: string, tradingBroadHabitat: string, distinctiveness: string, netUnitChange: number }>,
 *   medium: { broadHabitats: Array<{ broadHabitat: string, netUnitChange: number }>, surplus: number, deficit: number },
 *   low: { netUnitChange: number, cumulativeAvailability: number }
 * }}
 *
 * `low.cumulativeAvailability` is the Medium surplus plus the Low net change
 * (AC7): the units available to the Low band once the Medium surplus is carried
 * down. It is **not** the Statutory Metric's "Cumulative surplus of units", and
 * is deliberately not named for it: the metric nets the Medium deficit off the
 * Medium surplus before offsetting the Low band, so its figure is always lower
 * than this one by exactly `Math.abs(medium.deficit)`. On the published worked
 * example the metric reports 23.1012 where this reports 32.5222.
 *
 * The divergence is intentional — the deficit still has to be offset by trading
 * up, so it is not also available to absorb a Low deficit — but it means a site
 * can look compliant on this figure while the metric reports it short. Anything
 * deriving a Met / Not-met status has to account for `medium.deficit` in its own
 * right rather than assuming this number already has.
 */
export function calculateAreaHabitatTradingRules(
  baselineUnitsByType = {},
  deliveredUnitsByType = {}
) {
  const habitatTypes = tradeableHabitats(
    calculateHabitatNetUnitChanges(baselineUnitsByType, deliveredUnitsByType)
  )

  const broadHabitats = cumulativeBroadHabitatChanges(habitatTypes)
  const { medium, low } = calculateBandTradingFigures(
    broadHabitats.map((entry) => entry.netUnitChange),
    habitatTypes
      .filter((habitat) => habitat.distinctiveness === LOW_BAND)
      .map((habitat) => habitat.netUnitChange)
  )

  return {
    habitatTypes,
    medium: { broadHabitats, ...medium },
    low
  }
}
