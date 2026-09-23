/**
 * The trading-rule matrix (BMD-1011): scenarios that exercise every trading
 * rule the service can meet, each both satisfied and breached, and the ways
 * surpluses and deficits in different distinctiveness bands interact.
 *
 * The three habitat types trade independently — an area habitat loss is
 * never made good by a hedgerow — so each scenario carries one area case and,
 * where there is one to pair, a hedgerow case and a watercourse case. That
 * covers the matrix in a dozen uploads rather than thirty. Every other layer
 * is generated empty and every feature pinned, so no random feature can move
 * a verdict, and each scenario states the verdict of every band in play.
 *
 * The rules, as the metric's trading summaries state them:
 *
 *   Area habitats   Medium: same broad habitat or a higher distinctiveness
 *                   Low:    same distinctiveness or better
 *   Hedgerows       Medium, Low, Very Low: same distinctiveness or better
 *   Watercourses    Medium: same habitat
 *                   Low:    better distinctiveness
 *
 * Each is a test of units, not just of type: a loss must be replaced by at
 * least as many units of an acceptable habitat. A newly created habitat is
 * discounted for the years it takes to reach condition, so one-for-one
 * replacement usually falls short — the "too few units" scenario shows it.
 * A deficit in a lower band may be met from a surplus in a higher one, but
 * never the other way round.
 *
 * Not asserted: whether a culvert (Low) replaced by another culvert meets
 * the watercourse Low rule. The rule reads "better distinctiveness habitat
 * required", yet the recalculated metric meets it whenever the new culvert
 * brings enough units — which here turns on the random line lengths. A
 * service that enforces the wording would part company with the metric.
 *
 * High and Very High distinctiveness are out of reach: the service rejects
 * those habitats at upload, so they appear in no scenario.
 *
 * Verdicts were checked against the recalculated Defra workbook across
 * several seeds. Every hedgerow and watercourse is drawn 300–400m long, so
 * each loss-versus-replacement margin is designed rather than left to lines
 * whose lengths otherwise vary ~40-fold.
 */

import {
  HEDGE_CONDITIONS,
  STRATEGIC_SIGNIFICANCE
} from '../synthetic/synthetic-constants.mjs'

const SS = STRATEGIC_SIGNIFICANCE[2]

// Area habitats: two Medium grasslands, a Medium heathland (another broad
// habitat), two Low habitats in different broad habitats, and a Very Low one.
const MEDIUM_GRASSLAND = 'Grassland - Other neutral grassland'
const MEDIUM_GRASSLAND_2 = 'Grassland - Other lowland acid grassland'
const MEDIUM_HEATHLAND = 'Heathland and shrub - Mixed scrub'
const LOW_GRASSLAND = 'Grassland - Modified grassland'
const LOW_URBAN = 'Urban - Allotments'
// Built over: the usual fate of lost land. The metric gives creating it no
// units ("Not Possible"), which is the point.
const VERY_LOW = 'Urban - Developed land; sealed surface'
const VERY_LOW_CONDITION = 'N/A - Other'

const MEDIUM_HEDGE = 'Species-rich native hedgerow'
const MEDIUM_HEDGE_2 = 'Native hedgerow with trees'
const LOW_HEDGE = 'Native hedgerow'
const VERY_LOW_HEDGE = 'Non-native and ornamental hedgerow'
const [HEDGE_GOOD, HEDGE_MODERATE, HEDGE_POOR] = HEDGE_CONDITIONS

const DITCH = 'Ditches'
const CANAL = 'Canals'
const CULVERT = 'Culvert'
const NO_ENCROACHMENT = 'No Encroachment'
const NO_RIPARIAN = 'No Encroachment/No Encroachment'
const MAJOR_ENCROACHMENT = 'Major'
const MAJOR_RIPARIAN = 'Major/Major'

const NO_YEARS = { advanceYears: '0', delayYears: '0' }
// Random line lengths vary ~40-fold, enough to swamp any designed margin
// between a loss and its replacement, so every linear feature here is drawn
// within a narrow band.
const LENGTH = { lengthRange: [300, 400] }
// Creation started ten years late, heavily discounting what it delivers.
const LATE = { advanceYears: '0', delayYears: '10' }

// --- area habitats -------------------------------------------------------

function areaBaseline(habitat, condition = 'Moderate') {
  return {
    habitatFullName: habitat,
    baselineCondition: habitat === VERY_LOW ? VERY_LOW_CONDITION : condition,
    baselineStrategicSignificance: SS,
    proposedStrategicSignificance: SS
  }
}

const kept = (habitat) => ({ ...areaBaseline(habitat), retention: 'Retained' })

/** A parcel lost, and `created` made on the same land in Good condition. */
function replaced(habitat, created) {
  return {
    ...areaBaseline(habitat),
    retention: 'Created',
    proposedHabitatFullName: created,
    proposedCondition: created === VERY_LOW ? VERY_LOW_CONDITION : 'Good',
    ...NO_YEARS
  }
}

/** Poor → Good in place: a surplus in the parcel's own band and habitat. */
const improved = (habitat) => ({
  ...areaBaseline(habitat, 'Poor'),
  retention: 'Enhanced',
  proposedHabitatFullName: habitat,
  proposedCondition: 'Good'
})

// --- hedgerows (a small fixture draws exactly three) ---------------------

function hedgeBaseline(type) {
  return {
    ...LENGTH,
    hedgeType: type,
    baselineCondition: type === VERY_LOW_HEDGE ? HEDGE_POOR : HEDGE_MODERATE,
    baselineStrategicSignificance: SS,
    proposedStrategicSignificance: SS
  }
}

const keptHedge = (type) => ({
  ...hedgeBaseline(type),
  retention: 'Retained',
  proposedCondition: hedgeBaseline(type).baselineCondition
})
const lostHedge = (type) => ({ ...hedgeBaseline(type), retention: 'Lost' })
const newHedge = (type) => ({
  ...LENGTH,
  hedgeType: type,
  retention: 'Created',
  // The metric only offers Poor for a non-native hedgerow.
  proposedCondition: type === VERY_LOW_HEDGE ? HEDGE_POOR : HEDGE_GOOD,
  proposedStrategicSignificance: SS,
  ...NO_YEARS
})
/**
 * A hedgerow planted late and left in Poor condition: a replacement that
 * falls well short whatever the random line lengths.
 */
const neglectedHedge = (type) => ({
  ...newHedge(type),
  proposedCondition: HEDGE_POOR,
  ...LATE
})
/** A hedgerow in good shape lost, so a replacement has much to make up. */
const lostGoodHedge = (type) => ({
  ...lostHedge(type),
  baselineCondition: HEDGE_GOOD
})
/** A hedgerow in poor shape lost, so a replacement has units to spare. */
const lostPoorHedge = (type) => ({
  ...lostHedge(type),
  baselineCondition: HEDGE_POOR
})
const improvedHedge = (type) => ({
  ...hedgeBaseline(type),
  retention: 'Enhanced',
  baselineCondition: HEDGE_POOR,
  proposedCondition: HEDGE_GOOD
})

// --- watercourses (a small fixture draws exactly two) --------------------

function riverBaseline(type) {
  if (type === CULVERT) {
    return {
      ...LENGTH,
      riverType: type,
      baselineCondition: 'Poor',
      baselineStrategicSignificance: SS,
      proposedStrategicSignificance: SS
    }
  }
  return {
    ...LENGTH,
    riverType: type,
    baselineCondition: 'Moderate',
    baselineStrategicSignificance: SS,
    proposedStrategicSignificance: SS,
    baselineWaterEncroachment: NO_ENCROACHMENT,
    baselineRiparianEncroachment: NO_RIPARIAN,
    proposedWaterEncroachment: NO_ENCROACHMENT,
    proposedRiparianEncroachment: NO_RIPARIAN
  }
}

const keptRiver = (type) => ({
  ...riverBaseline(type),
  retention: 'Retained',
  proposedCondition: riverBaseline(type).baselineCondition
})
const lostRiver = (type) => ({ ...riverBaseline(type), retention: 'Lost' })
/**
 * A lost ditch already in a poor state — Poor condition, heavily encroached —
 * so its replacement has units to spare whatever the random line lengths.
 */
const lostDegradedDitch = () => ({
  ...riverBaseline(DITCH),
  retention: 'Lost',
  baselineCondition: 'Poor',
  baselineWaterEncroachment: MAJOR_ENCROACHMENT,
  baselineRiparianEncroachment: MAJOR_RIPARIAN
})
const newRiver = (type) => ({
  ...LENGTH,
  riverType: type,
  retention: 'Created',
  proposedCondition: type === CULVERT ? 'Poor' : 'Good',
  proposedStrategicSignificance: SS,
  ...NO_YEARS,
  ...(type === CULVERT
    ? {}
    : {
        proposedWaterEncroachment: NO_ENCROACHMENT,
        proposedRiparianEncroachment: NO_RIPARIAN
      })
})
/** A watercourse dug late and left in Poor condition. */
const neglectedRiver = (type) => ({
  ...newRiver(type),
  proposedCondition: 'Poor',
  ...LATE
})
const improvedRiver = (type) => ({
  ...riverBaseline(type),
  retention: 'Enhanced',
  proposedCondition: 'Good'
})

// --- verdicts --------------------------------------------------------------

const MET = 'met'
const BREACHED = 'breached'

const area = (medium, low) => ({ area: { Medium: medium, Low: low } })
const hedgerow = (medium, low, veryLow) => ({
  hedgerow: { Medium: medium, Low: low, 'Very Low': veryLow }
})
const watercourse = (medium, low) => ({
  watercourse: { Medium: medium, Low: low }
})

/**
 * One matrix row as a catalogue scenario. Layers with no case are generated
 * empty; the subject is always the first area parcel.
 */
function tradingScenario({
  id,
  title,
  description,
  habitats,
  hedgerows,
  rivers,
  expectTrading
}) {
  const emptyLayers = ['trees']
  if (!hedgerows) {
    emptyLayers.push('hedgerows')
  }
  if (!rivers) {
    emptyLayers.push('rivers')
  }
  return {
    id: `trading-${id}`,
    purpose: 'trading-rules',
    title: `Trading rules — ${title}`,
    description,
    size: habitats.length,
    emptyLayers,
    overrides: {
      habitats,
      ...(hedgerows ? { hedgerows } : {}),
      ...(rivers ? { rivers } : {})
    },
    expectTrading,
    subject: {
      layer: 'Habitats',
      ref: 'H001',
      note: 'the first area parcel; see the description for every layer'
    }
  }
}

export const TRADING_MATRIX = [
  tradingScenario({
    id: 'all-met',
    title: 'nothing lost, every rule met',
    description:
      'Control. Area: parcels retained and one enhanced. Hedgerows: retained and one enhanced. Watercourses: a canal retained, a ditch enhanced. Every trading rule is met.',
    habitats: [
      kept(MEDIUM_GRASSLAND),
      kept(LOW_GRASSLAND),
      improved(MEDIUM_GRASSLAND)
    ],
    hedgerows: [
      keptHedge(MEDIUM_HEDGE),
      improvedHedge(LOW_HEDGE),
      keptHedge(VERY_LOW_HEDGE)
    ],
    rivers: [keptRiver(CANAL), improvedRiver(DITCH)],
    expectTrading: {
      ...area(MET, MET),
      ...hedgerow(MET, MET, MET),
      ...watercourse(MET, MET)
    }
  }),
  tradingScenario({
    id: 'like-for-like',
    title: 'like-for-like replacement, enough units',
    description:
      'Area: a Medium grassland is lost and two Medium grasslands created (same broad habitat). Hedgerows: a Medium hedgerow in Poor condition is lost and two Medium hedgerows created. Watercourses: a poor, encroached ditch is lost and a ditch in Good condition created. Every rule is met.',
    habitats: [
      replaced(MEDIUM_GRASSLAND, MEDIUM_GRASSLAND_2),
      replaced(LOW_GRASSLAND, MEDIUM_GRASSLAND_2),
      kept(LOW_GRASSLAND)
    ],
    hedgerows: [
      lostPoorHedge(MEDIUM_HEDGE),
      newHedge(MEDIUM_HEDGE_2),
      newHedge(MEDIUM_HEDGE_2)
    ],
    rivers: [lostDegradedDitch(), newRiver(DITCH)],
    expectTrading: {
      ...area(MET, MET),
      ...hedgerow(MET, MET, MET),
      ...watercourse(MET, MET)
    }
  }),
  tradingScenario({
    id: 'too-few-units',
    title: 'right habitat, too few units',
    description:
      'Area: a Medium grassland is replaced one-for-one by another Medium grassland, which, discounted for the years it takes to reach condition, delivers fewer units than were lost. Hedgerows: a Medium hedgerow in Good condition is replaced by another planted ten years late and left in Poor condition. Watercourses: a ditch is replaced by one dug ten years late and left in Poor condition. Each replacement is the right habitat but too small a one, so each Medium rule is breached.',
    habitats: [
      replaced(MEDIUM_GRASSLAND, MEDIUM_GRASSLAND_2),
      kept(LOW_GRASSLAND)
    ],
    hedgerows: [
      lostGoodHedge(MEDIUM_HEDGE),
      neglectedHedge(MEDIUM_HEDGE_2),
      keptHedge(LOW_HEDGE)
    ],
    rivers: [lostRiver(DITCH), neglectedRiver(DITCH)],
    expectTrading: {
      ...area(BREACHED, MET),
      ...hedgerow(BREACHED, MET, MET),
      ...watercourse(BREACHED, MET)
    }
  }),
  tradingScenario({
    id: 'wrong-habitat',
    title: 'enough units, wrong habitat',
    description:
      'Area: a Medium grassland is lost and two Medium heathlands created — more units than were lost, but a different broad habitat. Hedgerows: a Medium hedgerow is lost and two Low hedgerows created. Watercourses: a poor, encroached ditch is lost and a canal created. Each Medium rule is breached however many units the replacement brings.',
    habitats: [
      replaced(MEDIUM_GRASSLAND, MEDIUM_HEATHLAND),
      replaced(LOW_GRASSLAND, MEDIUM_HEATHLAND),
      kept(LOW_GRASSLAND)
    ],
    hedgerows: [
      lostHedge(MEDIUM_HEDGE),
      newHedge(LOW_HEDGE),
      newHedge(LOW_HEDGE)
    ],
    rivers: [lostDegradedDitch(), newRiver(CANAL)],
    expectTrading: {
      ...area(BREACHED, MET),
      ...hedgerow(BREACHED, MET, MET),
      ...watercourse(BREACHED, MET)
    }
  }),
  tradingScenario({
    id: 'trade-down',
    title: 'replaced by a lower distinctiveness',
    description:
      'Area: a Medium grassland is replaced by a Low one. Hedgerows: a Low hedgerow is replaced by two non-native (Very Low) hedgerows. Watercourses: a ditch (Medium) is replaced by a culvert (Low). The rule for the band that was lost is breached — a surplus lower down never makes good a loss higher up.',
    habitats: [replaced(MEDIUM_GRASSLAND, LOW_GRASSLAND), kept(LOW_GRASSLAND)],
    hedgerows: [
      lostHedge(LOW_HEDGE),
      newHedge(VERY_LOW_HEDGE),
      newHedge(VERY_LOW_HEDGE)
    ],
    rivers: [lostRiver(DITCH), newRiver(CULVERT)],
    expectTrading: {
      ...area(BREACHED, MET),
      ...hedgerow(MET, BREACHED, MET),
      ...watercourse(BREACHED, MET)
    }
  }),
  tradingScenario({
    id: 'trade-up',
    title: 'replaced by a higher distinctiveness',
    description:
      'Area: a Low grassland is replaced by a Medium one. Hedgerows: a Low hedgerow is replaced by two Medium hedgerows. Watercourses: a culvert (Low) is replaced by a ditch (Medium). Trading up is always allowed, so every rule is met.',
    habitats: [
      replaced(LOW_GRASSLAND, MEDIUM_GRASSLAND),
      kept(MEDIUM_GRASSLAND)
    ],
    hedgerows: [
      lostHedge(LOW_HEDGE),
      newHedge(MEDIUM_HEDGE),
      newHedge(MEDIUM_HEDGE)
    ],
    rivers: [lostRiver(CULVERT), newRiver(DITCH)],
    expectTrading: {
      ...area(MET, MET),
      ...hedgerow(MET, MET, MET),
      ...watercourse(MET, MET)
    }
  }),
  tradingScenario({
    id: 'low-for-low',
    title: 'Low replaced by Low in another habitat',
    description:
      'Area: a Low grassland is replaced by Low urban allotments — a different broad habitat, which the Low rule allows. Hedgerows: a non-native (Very Low) hedgerow is replaced by a native one (Low). Both rules are met.',
    habitats: [replaced(LOW_GRASSLAND, LOW_URBAN), kept(MEDIUM_GRASSLAND)],
    hedgerows: [
      lostHedge(VERY_LOW_HEDGE),
      newHedge(LOW_HEDGE),
      keptHedge(MEDIUM_HEDGE)
    ],
    expectTrading: {
      ...area(MET, MET),
      ...hedgerow(MET, MET, MET)
    }
  }),
  tradingScenario({
    id: 'lost-to-development',
    title: 'lost to development, nothing in its place',
    description:
      'Area: a Low grassland is built over (Very Low sealed surface, which the metric gives no units). Hedgerows: a non-native (Very Low) hedgerow is removed. Nothing replaces either, so the Low area rule and the Very Low hedgerow rule are breached.',
    habitats: [replaced(LOW_GRASSLAND, VERY_LOW), kept(MEDIUM_GRASSLAND)],
    hedgerows: [
      lostHedge(VERY_LOW_HEDGE),
      keptHedge(MEDIUM_HEDGE),
      keptHedge(LOW_HEDGE)
    ],
    expectTrading: {
      ...area(MET, BREACHED),
      ...hedgerow(MET, MET, BREACHED)
    }
  }),
  tradingScenario({
    id: 'lower-deficit-covered-from-above',
    title: 'a Low deficit made good by a Medium surplus',
    description:
      'Area: a Low grassland is built over, while two Medium grasslands are improved from Poor to Good. Hedgerows: a Low hedgerow is lost while two Medium hedgerows are improved. A surplus may be carried down to a lower band, so every rule is met.',
    habitats: [
      replaced(LOW_GRASSLAND, VERY_LOW),
      improved(MEDIUM_GRASSLAND),
      improved(MEDIUM_GRASSLAND)
    ],
    hedgerows: [
      lostHedge(LOW_HEDGE),
      improvedHedge(MEDIUM_HEDGE),
      improvedHedge(MEDIUM_HEDGE)
    ],
    expectTrading: {
      ...area(MET, MET),
      ...hedgerow(MET, MET, MET)
    }
  }),
  tradingScenario({
    id: 'higher-deficit-not-covered-from-below',
    title: 'a Medium deficit beside a Low surplus',
    description:
      'Area: a Medium grassland is replaced by a Low one, while two Low grasslands are improved from Poor to Good. Hedgerows: a Medium hedgerow is lost while two Low hedgerows are improved. A surplus cannot be carried up, so the Medium rules are breached and the Low ones met. This is also the case the published metric totals wrongly (BMD-993): its cumulative surplus is reported uncorrected.',
    habitats: [
      replaced(MEDIUM_GRASSLAND, LOW_GRASSLAND),
      improved(LOW_GRASSLAND),
      improved(LOW_GRASSLAND)
    ],
    hedgerows: [
      lostHedge(MEDIUM_HEDGE),
      improvedHedge(LOW_HEDGE),
      improvedHedge(LOW_HEDGE)
    ],
    expectTrading: {
      ...area(BREACHED, MET),
      ...hedgerow(BREACHED, MET, MET)
    }
  }),
  tradingScenario({
    id: 'surplus-in-another-broad-habitat',
    title: 'a Medium surplus in one broad habitat, a deficit in another',
    description:
      'Area: three Medium grasslands are improved from Poor to Good, a large Medium surplus, while a Medium heathland is replaced by a Low grassland. The Medium rule is met habitat by habitat, so the grassland surplus cannot make good the heathland loss and the rule is breached despite the net gain.',
    habitats: [
      improved(MEDIUM_GRASSLAND),
      improved(MEDIUM_GRASSLAND),
      improved(MEDIUM_GRASSLAND),
      replaced(MEDIUM_HEATHLAND, LOW_GRASSLAND)
    ],
    expectTrading: area(BREACHED, MET)
  })
]
