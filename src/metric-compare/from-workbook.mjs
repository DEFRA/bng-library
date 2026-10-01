/**
 * The expected figures: a recalculated metric workbook's own answers, as
 * readMetricResults reads them (and generate:scenarios records them in its
 * manifest), turned into comparable figures.
 */

import { MERGED_INTERTIDAL_BROAD_HABITAT } from '../metric/area-trading-rules.mjs'
import {
  CATEGORY,
  FigureList,
  habitatKeyPart,
  MET,
  MODULES,
  NOT_APPLICABLE,
  NOT_MET
} from './figures.mjs'

const PERCENT = 100

// A trading summary's verdict reads "Yes ✓" or "No ▲".
const SATISFIED = /^yes\b/i
const NOT_SATISFIED = /^no\b/i

// The area summary's Medium broad habitat total for its intertidal group sums
// both intertidal broad habitats, which is the merge the engine names.
const INTERTIDAL_GROUP = 'Intertidal sediment'

const TOTALS = [
  ['baselineUnits', 'baseline', 'Baseline units'],
  ['postInterventionUnits', 'post-intervention', 'Post-intervention units'],
  ['netUnitChange', 'net-change', 'Net unit change']
]

// Band totals per module: [workbook total, figure path, label].
const BAND_TOTALS = {
  area: [
    ['mediumSurplus', 'medium-surplus', 'Medium surplus'],
    ['mediumDeficit', 'medium-deficit', 'Medium deficit'],
    ['lowNetUnitChange', 'low-net-change', 'Low net unit change'],
    ['lowCumulativeSurplus', 'low-cumulative', 'Low cumulative surplus']
  ],
  hedgerow: [
    ['mediumNetUnitChange', 'medium-net-change', 'Medium net unit change'],
    [
      'mediumCumulativeAvailability',
      'medium-cumulative',
      'Medium cumulative availability'
    ],
    ['lowNetUnitChange', 'low-net-change', 'Low net unit change'],
    [
      'lowCumulativeAvailability',
      'low-cumulative',
      'Low cumulative availability'
    ],
    ['veryLowNetUnitChange', 'very-low-net-change', 'Very Low net unit change'],
    [
      'veryLowCumulativeAvailability',
      'very-low-cumulative',
      'Very Low cumulative availability'
    ]
  ],
  watercourse: [
    ['mediumSurplus', 'medium-surplus', 'Medium surplus'],
    ['mediumDeficit', 'medium-deficit', 'Medium deficit'],
    ['lowNetUnitChange', 'low-net-change', 'Low net unit change'],
    [
      'lowCumulativeAvailability',
      'low-cumulative',
      'Low cumulative availability'
    ]
  ]
}

function verdict(satisfied) {
  if (SATISFIED.test(satisfied ?? '')) {
    return MET
  }
  return NOT_SATISFIED.test(satisfied ?? '') ? NOT_MET : satisfied
}

function netGainVerdict(fraction, target) {
  if (typeof fraction !== 'number') {
    return NOT_APPLICABLE
  }
  return fraction >= target ? MET : NOT_MET
}

function addFeatures(list, features = []) {
  for (const f of features) {
    list.add({
      category: CATEGORY.featureUnits,
      module: f.module,
      parts: [f.stage, f.reference],
      label: `${f.reference} ${f.stage} units`,
      value: f.units,
      size: f.size ?? null,
      strategicSignificanceMultiplier:
        f.strategicSignificanceMultiplier ?? null,
      source: `${f.sheet} ${f.cell}`
    })
  }
}

/**
 * The modules the site has a feature in. For a module it has none of, the
 * metric still shows a net change of 0% and its trading rules satisfied —
 * placeholders the service, rightly, does not repeat — so a module's net gain
 * and trading statuses are only figures where the site has the module.
 */
function modulesPresent(results) {
  if (results.features) {
    return new Set(results.features.map((f) => f.module))
  }
  const { baselineUnits, postInterventionUnits } = results.headline
  return new Set(
    MODULES.filter((m) => baselineUnits[m] || postInterventionUnits[m])
  )
}

function addHeadline(list, headline, present) {
  for (const module of MODULES) {
    for (const [field, path, label] of TOTALS) {
      list.add({
        category: CATEGORY.totals,
        module,
        parts: [path],
        label,
        value: headline[field][module]
      })
    }
    if (!present.has(module)) {
      continue
    }
    const fraction = headline.netPercentChange[module]
    list.add({
      category: CATEGORY.netGain,
      module,
      parts: ['percentage'],
      label: 'Net change (%)',
      value: typeof fraction === 'number' ? fraction * PERCENT : null
    })
    list.add({
      category: CATEGORY.netGain,
      module,
      parts: ['verdict'],
      label: `Net gain target (${headline.target * PERCENT}%)`,
      value: netGainVerdict(fraction, headline.target)
    })
  }
}

function addTradingStatuses(list, trading, present) {
  for (const module of MODULES.filter((m) => present.has(m))) {
    for (const { distinctiveness, satisfied } of trading[module] ?? []) {
      list.add({
        category: CATEGORY.tradingStatus,
        module,
        parts: [distinctiveness],
        label: `${distinctiveness} band`,
        value: verdict(satisfied),
        distinctiveness
      })
    }
  }
}

function tradingBroadHabitat(broadHabitat) {
  return broadHabitat === INTERTIDAL_GROUP
    ? MERGED_INTERTIDAL_BROAD_HABITAT
    : broadHabitat
}

function addTradingFigures(list, tradingFigures) {
  for (const module of MODULES) {
    const figures = tradingFigures[module]
    for (const h of figures.habitats) {
      list.add({
        category: CATEGORY.tradingFigures,
        module,
        parts: ['habitat', habitatKeyPart(h.habitatType)],
        label: `${h.habitatType} (${h.distinctiveness}) net unit change`,
        value: h.netUnitChange,
        distinctiveness: h.distinctiveness,
        zeroWhenAbsent: true
      })
    }
    for (const b of figures.broadHabitats ?? []) {
      const broadHabitat = tradingBroadHabitat(b.broadHabitat)
      list.add({
        category: CATEGORY.tradingFigures,
        module,
        parts: ['broad-habitat', broadHabitat],
        label: `${broadHabitat} (Medium) cumulative net unit change`,
        value: b.netUnitChange,
        zeroWhenAbsent: true
      })
    }
    for (const [field, path, label] of BAND_TOTALS[module]) {
      list.add({
        category: CATEGORY.tradingFigures,
        module,
        parts: [path],
        label,
        value: figures.totals[field]
      })
    }
  }
}

/**
 * @param {object} results readMetricResults' result, or a manifest entry's
 *   `metric`: `headline` and `trading` at least, and `features` and
 *   `tradingFigures` where the workbook was read with them
 * @returns {import('./figures.mjs').Figure[]}
 */
export function figuresFromWorkbook(results) {
  const list = new FigureList()
  const present = modulesPresent(results)
  addFeatures(list, results.features)
  addHeadline(list, results.headline, present)
  if (results.tradingFigures) {
    addTradingFigures(list, results.tradingFigures)
  }
  addTradingStatuses(list, results.trading, present)
  return list.figures
}
