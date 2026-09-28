/**
 * The actual figures: what the service computed for the same site, read from
 * its project response (the body of `GET /projects/{id}`), turned into the
 * same comparable figures as the workbook's.
 */

import {
  CATEGORY,
  FigureList,
  MET,
  MODULES,
  NOT_APPLICABLE,
  NOT_MET
} from './figures.mjs'

// The frontend decides the net gain verdict (unit-summary.js): the
// percentage, at 15 significant figures and then rounded to 2 dp for
// display, against a 10% target. The service reports only the percentage, so
// the verdict it shows a user is reproduced here, rule for rule.
const NET_GAIN_TARGET_PERCENTAGE = 10
const DISPLAY_SIGNIFICANT_FIGURES = 15
const DISPLAY_DECIMAL_PLACES = 2

// Which of a project's feature lists belong to each module. Individual trees
// are area habitats in the metric, and sit on its area sheets.
const FEATURE_LISTS = {
  area: ['habitats', 'trees'],
  hedgerow: ['hedgerows'],
  watercourse: ['watercourses']
}

const UNIT_FIELDS = {
  area: { totals: ['habitatsTotal', 'treesTotal'], net: 'habitats' },
  hedgerow: { totals: ['hedgerowsTotal'], net: 'hedgerows' },
  watercourse: { totals: ['watercoursesTotal'], net: 'watercourses' }
}

const TRADING_RULES = {
  area: { figures: 'areaHabitats', habitats: 'habitatTypes' },
  watercourse: { figures: 'watercourses', habitats: 'habitats' }
}

const BANDS = { medium: 'Medium', low: 'Low' }

// The size a feature was priced on, in the metric's terms: hectares, or
// kilometres for the linear modules. The service stores square metres and
// metres.
const SQ_METRES_PER_HECTARE = 10_000
const METRES_PER_KM = 1000

function pricedSize(module, feature) {
  const size = module === 'area' ? feature.area : feature.length
  if (!isNumber(size)) {
    return null
  }
  return module === 'area' ? size / SQ_METRES_PER_HECTARE : size / METRES_PER_KM
}

const NUMBERED_PREFIX = /^\d+\.\s*/
// A lost area habitat is a creation on the lost land, as the metric has it.
const STAGE_BY_RETENTION = {
  retained: 'retained',
  enhanced: 'enhanced',
  created: 'created',
  lost: 'created'
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function stageOf(retentionCategory) {
  const normalised = String(retentionCategory ?? '')
    .trim()
    .replace(NUMBERED_PREFIX, '')
    .toLowerCase()
  return STAGE_BY_RETENTION[normalised] ?? null
}

/**
 * Only features the service gave units to are figures. A feature it priced
 * at nothing where the metric prices it is caught as missing from the
 * service; one neither side prices is not a figure at all.
 */
function addFeatures(list, document, stageFor) {
  for (const module of MODULES) {
    for (const listName of FEATURE_LISTS[module]) {
      for (const feature of document?.[listName] ?? []) {
        const stage = stageFor(feature)
        if (stage && isNumber(feature.units)) {
          list.add({
            category: CATEGORY.featureUnits,
            module,
            parts: [stage, String(feature.ref)],
            label: `${feature.ref} ${stage} units`,
            value: feature.units,
            size: pricedSize(module, feature)
          })
        }
      }
    }
  }
}

/**
 * The modules the site has a feature in, on either side. As on the workbook
 * side, a module's net gain and trading statuses are only figures where the
 * site has the module.
 */
function modulesPresent(baseline, postIntervention) {
  return new Set(
    MODULES.filter((module) =>
      FEATURE_LISTS[module].some(
        (listName) =>
          (baseline?.[listName]?.length ?? 0) > 0 ||
          (postIntervention?.[listName]?.length ?? 0) > 0
      )
    )
  )
}

function moduleTotal(units, fields) {
  const present = fields.map((f) => units?.[f]).filter(isNumber)
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null
}

function netGainVerdict(percentage) {
  if (!isNumber(percentage)) {
    return NOT_APPLICABLE
  }
  const displayed = Number(
    Number(percentage.toPrecision(DISPLAY_SIGNIFICANT_FIGURES)).toFixed(
      DISPLAY_DECIMAL_PLACES
    )
  )
  return displayed >= NET_GAIN_TARGET_PERCENTAGE ? MET : NOT_MET
}

function addTotals(list, baseline, postIntervention, present) {
  for (const module of MODULES) {
    const { totals, net } = UNIT_FIELDS[module]
    const add = (parts, label, value) =>
      list.add({ category: CATEGORY.totals, module, parts, label, value })
    add(['baseline'], 'Baseline units', moduleTotal(baseline?.units, totals))
    add(
      ['post-intervention'],
      'Post-intervention units',
      moduleTotal(postIntervention?.units, totals)
    )
    add(
      ['net-change'],
      'Net unit change',
      postIntervention?.units?.[`${net}NetUnitChange`] ?? null
    )
    if (!present.has(module)) {
      continue
    }
    const percentage =
      postIntervention?.units?.[`${net}NetUnitChangePercentage`] ?? null
    list.add({
      category: CATEGORY.netGain,
      module,
      parts: ['percentage'],
      label: 'Net change (%)',
      value: percentage
    })
    list.add({
      category: CATEGORY.netGain,
      module,
      parts: ['verdict'],
      label: `Net gain target (${NET_GAIN_TARGET_PERCENTAGE}%)`,
      value: netGainVerdict(percentage)
    })
  }
}

function addTradingFigures(list, tradingRules) {
  for (const [module, names] of Object.entries(TRADING_RULES)) {
    const figures = tradingRules?.[names.figures]
    if (!figures) {
      continue
    }
    const add = (parts, label, value, extra = {}) =>
      list.add({
        category: CATEGORY.tradingFigures,
        module,
        parts,
        label,
        value,
        ...extra
      })
    for (const h of figures[names.habitats] ?? []) {
      add(
        ['habitat', h.habitatType],
        `${h.habitatType} (${h.distinctiveness}) net unit change`,
        h.netUnitChange,
        { distinctiveness: h.distinctiveness, zeroWhenAbsent: true }
      )
    }
    for (const b of figures.medium?.broadHabitats ?? []) {
      add(
        ['broad-habitat', b.broadHabitat],
        `${b.broadHabitat} (Medium) cumulative net unit change`,
        b.netUnitChange,
        { zeroWhenAbsent: true }
      )
    }
    add(['medium-surplus'], 'Medium surplus', figures.medium?.surplus ?? null)
    add(['medium-deficit'], 'Medium deficit', figures.medium?.deficit ?? null)
    add(
      ['low-net-change'],
      'Low net unit change',
      figures.low?.netUnitChange ?? null
    )
    add(
      ['low-cumulative'],
      'Low cumulative availability',
      figures.low?.cumulativeAvailability ?? null
    )
  }
}

function addTradingStatuses(list, statuses, present) {
  for (const [module, names] of Object.entries(TRADING_RULES)) {
    if (!present.has(module)) {
      continue
    }
    for (const [field, band] of Object.entries(BANDS)) {
      const status = statuses?.[names.figures]?.[field]
      if (status) {
        list.add({
          category: CATEGORY.tradingStatus,
          module,
          parts: [band],
          label: `${band} band`,
          value: status,
          distinctiveness: band
        })
      }
    }
  }
}

/**
 * @param {object} response a `GET /projects/{id}` body: `project` holds the
 *   `baseline` and `postIntervention` documents, and `tradingRuleStatuses`
 *   sits beside it
 * @returns {import('./figures.mjs').Figure[]}
 */
export function figuresFromProject(response) {
  const baseline = response?.project?.baseline
  const postIntervention = response?.project?.postIntervention
  const list = new FigureList()
  const present = modulesPresent(baseline, postIntervention)
  addFeatures(list, baseline, () => 'baseline')
  addFeatures(list, postIntervention, (feature) =>
    stageOf(feature.retentionCategory)
  )
  addTotals(list, baseline, postIntervention, present)
  addTradingFigures(list, postIntervention?.tradingRules)
  addTradingStatuses(list, response?.tradingRuleStatuses, present)
  return list.figures
}
