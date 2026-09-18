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
// Nothing here derives Met / Not-met statuses — that is a front-end concern.

import { DISTINCTIVENESS_CATEGORIES } from './reference-constants.mjs'
import {
  calculateHabitatNetUnitChanges,
  calculateCumulativeSurplus,
  sumDeficit,
  sumNetChange,
  sumSurplus
} from './trading-rules.mjs'

/** Distinctiveness bands that carry area-habitat trading rules in the MVS. */
const MEDIUM_BAND = 'Medium'
const LOW_BAND = 'Low'

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
 * The broad habitat a Medium habitat cumulates under, folding the two
 * intertidal broad habitats into one (AC3).
 *
 * @param {string} broadHabitat
 * @returns {string}
 */
function tradingBroadHabitatOf(broadHabitat) {
  if (
    broadHabitat === INTERTIDAL_SEDIMENT ||
    broadHabitat === INTERTIDAL_HARD_STRUCTURES
  ) {
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
 * Habitat types absent from the reference data are skipped — the caller resolves
 * and reports unrecognised types, which it can do with a logger.
 *
 * @param {Array<{ habitatType: string, netUnitChange: number }>} netUnitChanges
 * @returns {Array<{ habitatType: string, broadHabitat: string, distinctiveness: string, netUnitChange: number }>}
 */
function tradeableHabitats(netUnitChanges) {
  const habitats = []
  for (const habitat of netUnitChanges) {
    const distinctiveness = DISTINCTIVENESS_CATEGORIES[habitat.habitatType]
    if (distinctiveness !== MEDIUM_BAND && distinctiveness !== LOW_BAND) {
      continue
    }
    habitats.push({
      habitatType: habitat.habitatType,
      broadHabitat: broadHabitatOf(habitat.habitatType),
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
    const broadHabitat = tradingBroadHabitatOf(habitat.broadHabitat)
    const running = totals.get(broadHabitat) ?? 0
    totals.set(broadHabitat, running + habitat.netUnitChange)
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([broadHabitat, netUnitChange]) => ({
      broadHabitat,
      netUnitChange: sumNetChange([netUnitChange])
    }))
}

/**
 * @param {Array<{ distinctiveness: string, netUnitChange: number }>} habitats
 * @returns {number[]} the net unit changes of the Low-distinctiveness habitats
 */
function lowBandNetChanges(habitats) {
  return habitats
    .filter((habitat) => habitat.distinctiveness === LOW_BAND)
    .map((habitat) => habitat.netUnitChange)
}

/**
 * AC1–AC7 — the full area-habitat trading-rules unit figures.
 *
 * Habitat types are the engine reference keys ("{Broad habitat} - {Habitat
 * type}"), covering habitat parcels and individual trees alike. Units for both
 * sides are pre-summed by the caller.
 *
 * @param {Record<string, number>} baselineUnitsByType type -> summed baseline units
 * @param {Record<string, number>} deliveredUnitsByType type -> summed retained+created+enhanced units
 * @returns {{
 *   habitats: Array<{ habitatType: string, broadHabitat: string, distinctiveness: string, netUnitChange: number }>,
 *   medium: { broadHabitats: Array<{ broadHabitat: string, netUnitChange: number }>, surplus: number, deficit: number },
 *   low: { netChange: number },
 *   cumulativeSurplus: number
 * }}
 */
export function calculateAreaHabitatTradingRules(
  baselineUnitsByType = {},
  deliveredUnitsByType = {}
) {
  const habitats = tradeableHabitats(
    calculateHabitatNetUnitChanges(baselineUnitsByType, deliveredUnitsByType)
  )

  const broadHabitats = cumulativeBroadHabitatChanges(habitats)
  const broadHabitatChanges = broadHabitats.map((entry) => entry.netUnitChange)

  const mediumSurplus = sumSurplus(broadHabitatChanges)
  const lowNetChange = sumNetChange(lowBandNetChanges(habitats))

  return {
    habitats,
    medium: {
      broadHabitats,
      surplus: mediumSurplus,
      deficit: sumDeficit(broadHabitatChanges)
    },
    low: {
      netChange: lowNetChange
    },
    cumulativeSurplus: calculateCumulativeSurplus(mediumSurplus, lowNetChange)
  }
}
