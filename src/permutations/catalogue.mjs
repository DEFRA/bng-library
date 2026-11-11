/**
 * The permutations catalogue, loaded from `scenarios.json` beside this file.
 *
 * The scenarios are configuration, not code: each is a plain recipe the
 * runner turns into paired baseline / post-intervention GeoPackages. The
 * fields are documented in the README ("Scenario catalogue"). The file is
 * checked as it is loaded, and every problem is reported at once, so a typo
 * in a field name fails loudly instead of being ignored by the generator.
 */

import { readFileSync } from 'node:fs'
import {
  BASELINE_STRATEGIC_SIGNIFICANCE,
  PROPOSED_STRATEGIC_SIGNIFICANCE
} from '../synthetic/synthetic-constants.mjs'
import { INVALID_PREFIX } from './invalid-data.mjs'
import { FORMAT_BNG_SERVICE, VALID_FORMATS } from '../bng-service/schema.mjs'

const CATALOGUE_FILE = new URL('./scenarios.json', import.meta.url)

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const WORKBOOK_FIELD = /^[a-zA-Z]+\.[a-zA-Z]+$/
const COMMENT = '$comment'

const LAYERS = ['habitats', 'hedgerows', 'rivers', 'trees']
const GAIN_VERDICTS = ['met', 'unmet']
const TRADING_VERDICTS = ['met', 'breached']
const UNIT_STAGES = ['baseline', 'retained', 'created', 'enhanced']
const UNIT_ORDER_FIELDS = ['stage', 'references']
const UNIT_RATIO_FIELDS = ['stage', 'reference', 'control', 'factor']
// Only a created or enhanced feature has a time to target condition.
const TIME_TO_TARGET_STAGES = ['created', 'enhanced']
const TIME_TO_TARGET_FIELDS = ['stage', 'references', 'years', 'multiplier']
// The metric's longest time to target condition, "more than 30 years".
const THIRTY_PLUS = '30+'
const TRADING_BANDS = {
  area: ['Very High', 'High', 'Medium', 'Low'],
  hedgerow: ['Very High', 'High', 'Medium', 'Low', 'Very Low'],
  watercourse: ['Very High', 'High', 'Medium', 'Low']
}

// The generator's `attributeOverrides` contract (see `generateOne`).
const COMMON_OVERRIDE_FIELDS = [
  'retention',
  'baselineCondition',
  'proposedCondition',
  'baselineStrategicSignificance',
  'proposedStrategicSignificance',
  'advanceYears',
  'delayYears',
  'incomplete'
]
const OVERRIDE_FIELDS = {
  habitats: ['habitatFullName', 'proposedHabitatFullName', 'parcelRef'],
  hedgerows: ['hedgeType', 'proposedHedgeType', 'lengthRange', 'sameLineAs'],
  rivers: [
    'riverType',
    'proposedRiverType',
    'baselineWaterEncroachment',
    'proposedWaterEncroachment',
    'baselineRiparianEncroachment',
    'proposedRiparianEncroachment',
    'lengthRange',
    'sameLineAs'
  ],
  trees: ['treeSize', 'treeType', 'ruralOrUrban', 'count', 'replants']
}
// Vertical area habitats are drawn by the BNG Service generator alone
// (`addVerticalHabitats`), which takes these fields and no others: its
// strategic significance and timing are drawn, so none of the common fields
// but the retention and conditions would be read.
const VERTICAL_LAYER = 'verticalHabitats'
const VERTICAL_FIELDS = [
  'retention',
  'baselineCondition',
  'proposedCondition',
  'habitatFullName',
  'proposedHabitatFullName',
  'area'
]
const OVERRIDE_LAYERS = [...Object.keys(OVERRIDE_FIELDS), VERTICAL_LAYER]

/** Every field an override row on `layer` may pin. */
function overrideFieldsFor(layer) {
  return layer === VERTICAL_LAYER
    ? VERTICAL_FIELDS
    : [...COMMON_OVERRIDE_FIELDS, ...OVERRIDE_FIELDS[layer]]
}

/** A catalogue that cannot be read or does not check out; a CLI can report it plainly. */
export class ScenarioCatalogueError extends Error {
  name = 'ScenarioCatalogueError'
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isText = (v) => typeof v === 'string' && v.trim() !== ''
const isPositiveInteger = (v) => Number.isInteger(v) && v > 0
const isWholeNumber = (v) => Number.isInteger(v) && v >= 0
const list = (values) => values.map((v) => JSON.stringify(v)).join(', ')

function unknownKeys(value, allowed, where) {
  return Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .map(
      (key) =>
        `${where}: unknown field "${key}"; expected one of ${list(allowed)}`
    )
}

function checkOneOf(value, allowed, where) {
  return allowed.includes(value)
    ? []
    : [`${where}: ${JSON.stringify(value)} is not one of ${list(allowed)}`]
}

function checkTextList(value, where, pattern) {
  if (!Array.isArray(value) || value.length === 0) {
    return [`${where}: must be a non-empty list of text`]
  }
  return value
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => !isText(item) || (pattern && !pattern.test(item)))
    .map(
      ({ item, i }) => `${where}[${i}]: ${JSON.stringify(item)} is not valid`
    )
}

function checkLengthRange(value, where) {
  const valid =
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => typeof n === 'number' && n > 0) &&
    value[0] <= value[1]
  return valid
    ? []
    : [`${where}: must be [min, max] metres, with 0 < min ≤ max`]
}

// The ref prefix of each line layer's features, as the generator writes
// them: HG001 is the first hedgerow.
const LINE_REF_PREFIX = { hedgerows: 'HG', rivers: 'R' }

// `sameLineAs` names an earlier feature of the same layer, by its ref, and
// takes its line, so the row cannot pin a length range of its own.
function checkSameLineAs(layer, row, index, where) {
  if (!isObject(row) || !('sameLineAs' in row)) {
    return []
  }
  const match = new RegExp(`^${LINE_REF_PREFIX[layer]}(\\d+)$`).exec(
    row.sameLineAs
  )
  const target = match ? Number(match[1]) : 0
  const problems =
    target >= 1 && target <= index
      ? []
      : [
          `${where}.sameLineAs: must be the ref of an earlier ${layer} row, ${LINE_REF_PREFIX[layer]}001 to the row before this one`
        ]
  if ('lengthRange' in row) {
    problems.push(
      `${where}: takes the length of the line it copies, so cannot pin lengthRange too`
    )
  }
  return problems
}

// `replants` names an earlier tree, by its ref, that a Created tree is
// planted in place of: the earlier tree must be lost, and the row takes its
// point.
function checkReplants(layer, rows, row, index, where) {
  if (layer !== 'trees' || !isObject(row) || !('replants' in row)) {
    return []
  }
  const problems =
    row.retention === 'Created'
      ? []
      : [`${where}.replants: only a Created tree is planted in another's place`]
  const match = /^T(\d+)$/.exec(row.replants)
  const target = match ? Number(match[1]) : 0
  if (target < 1 || target > index || rows[target - 1]?.retention !== 'Lost') {
    problems.push(
      `${where}.replants: must be the ref of an earlier trees row that is Lost, T001 to the row before this one`
    )
  }
  return problems
}

// The strategic significance a scenario may pin, per Defra's LNRS guidance:
// Low at baseline, and Low or High for a proposed feature.
const ALLOWED_STRATEGIC_SIGNIFICANCE = {
  baselineStrategicSignificance: [BASELINE_STRATEGIC_SIGNIFICANCE],
  proposedStrategicSignificance: PROPOSED_STRATEGIC_SIGNIFICANCE
}

function checkOverrideValue(field, value, where) {
  if (ALLOWED_STRATEGIC_SIGNIFICANCE[field]) {
    return checkOneOf(value, ALLOWED_STRATEGIC_SIGNIFICANCE[field], where)
  }
  if (field === 'lengthRange') {
    return checkLengthRange(value, where)
  }
  if (field === 'incomplete') {
    return typeof value === 'boolean' ? [] : [`${where}: must be true or false`]
  }
  if (field === 'area') {
    return typeof value === 'number' && value > 0
      ? []
      : [`${where}: must be a number of hectares above 0`]
  }
  if (field === 'count') {
    return isPositiveInteger(value)
      ? []
      : [`${where}: must be a whole number above 0`]
  }
  return typeof value === 'string' ? [] : [`${where}: must be text`]
}

function checkOverrideRow(layer, row, where) {
  if (!isObject(row)) {
    return [`${where}: must be an object`]
  }
  const allowed = [...overrideFieldsFor(layer), COMMENT]
  return [
    ...unknownKeys(row, allowed, where),
    ...Object.entries(row)
      .filter(([field]) => field !== COMMENT && allowed.includes(field))
      .flatMap(([field, value]) =>
        checkOverrideValue(field, value, `${where}.${field}`)
      )
  ]
}

function checkOverrides(overrides, where) {
  if (!isObject(overrides)) {
    return [`${where}: must be an object of layers`]
  }
  const layers = OVERRIDE_LAYERS
  return [
    ...unknownKeys(overrides, layers, where),
    ...Object.entries(overrides)
      .filter(([layer]) => layers.includes(layer))
      .flatMap(([layer, rows]) =>
        Array.isArray(rows)
          ? rows.flatMap((row, i) => [
              ...checkOverrideRow(layer, row, `${where}.${layer}[${i}]`),
              ...checkSameLineAs(layer, row, i, `${where}.${layer}[${i}]`),
              ...checkReplants(layer, rows, row, i, `${where}.${layer}[${i}]`)
            ])
          : [`${where}.${layer}: must be a list of rows`]
      )
  ]
}

function checkTradingBands(type, bands, where) {
  if (!isObject(bands)) {
    return [`${where}: must be an object of bands`]
  }
  return [
    ...unknownKeys(bands, TRADING_BANDS[type], where),
    ...Object.entries(bands).flatMap(([band, verdict]) =>
      checkOneOf(verdict, TRADING_VERDICTS, `${where}.${band}`)
    )
  ]
}

function checkTrading(expectTrading, where) {
  if (!isObject(expectTrading)) {
    return [`${where}: must be an object of habitat types`]
  }
  const types = Object.keys(TRADING_BANDS)
  return [
    ...unknownKeys(expectTrading, types, where),
    ...Object.entries(expectTrading)
      .filter(([type]) => types.includes(type))
      .flatMap(([type, bands]) =>
        checkTradingBands(type, bands, `${where}.${type}`)
      )
  ]
}

/** A stage and two or more distinct features: `expectUnitOrder`, `expectUnitsEqual`. */
function checkStageReferences(value, where) {
  if (!isObject(value)) {
    return [`${where}: must be an object with stage and references`]
  }
  const { stage, references } = value
  const problems = [
    ...unknownKeys(value, UNIT_ORDER_FIELDS, where),
    ...checkOneOf(stage, UNIT_STAGES, `${where}.stage`)
  ]
  if (!Array.isArray(references) || references.length < 2) {
    return [...problems, `${where}.references: must list at least two features`]
  }
  const repeated = references.filter((ref, i) => references.indexOf(ref) !== i)
  return [
    ...problems,
    ...checkTextList(references, `${where}.references`),
    ...repeated.map((ref) => `${where}.references: "${ref}" is listed twice`)
  ]
}

/**
 * A feature whose units at one stage are a set multiple of a control's:
 * one `expectUnitRatio` entry.
 */
function checkUnitRatioEntry(entry, where) {
  if (!isObject(entry)) {
    return [`${where}: must be an object with ${list(UNIT_RATIO_FIELDS)}`]
  }
  const { stage, reference, control, factor } = entry
  const problems = [
    ...unknownKeys(entry, UNIT_RATIO_FIELDS, where),
    ...checkOneOf(stage, UNIT_STAGES, `${where}.stage`),
    ...['reference', 'control']
      .filter((field) => !isText(entry[field]))
      .map((field) => `${where}.${field}: is required text`)
  ]
  if (isText(reference) && reference === control) {
    problems.push(`${where}.control: must differ from reference`)
  }
  if (typeof factor !== 'number' || !(factor > 0)) {
    problems.push(`${where}.factor: must be a number above 0`)
  }
  return problems
}

function checkUnitRatio(value, where) {
  if (!Array.isArray(value) || value.length === 0) {
    return [`${where}: must be a non-empty list`]
  }
  const references = value.map((entry) => `${entry?.stage} ${entry?.reference}`)
  const repeated = references.filter((ref, i) => references.indexOf(ref) !== i)
  return [
    ...value.flatMap((entry, i) =>
      checkUnitRatioEntry(entry, `${where}[${i}]`)
    ),
    ...repeated.map((ref) => `${where}: ${ref} is listed twice`)
  ]
}

function checkTimeToTargetEntry(entry, where) {
  if (!isObject(entry)) {
    return [`${where}: must be an object with ${list(TIME_TO_TARGET_FIELDS)}`]
  }
  const { stage, references, years, multiplier } = entry
  const problems = [
    ...unknownKeys(entry, TIME_TO_TARGET_FIELDS, where),
    ...checkOneOf(stage, TIME_TO_TARGET_STAGES, `${where}.stage`),
    ...checkTextList(references, `${where}.references`)
  ]
  // 0 is a creation advanced to its target condition before the losses.
  if (!isWholeNumber(years) && years !== THIRTY_PLUS) {
    problems.push(`${where}.years: must be a whole number or "${THIRTY_PLUS}"`)
  }
  if (typeof multiplier !== 'number' || multiplier <= 0 || multiplier > 1) {
    problems.push(`${where}.multiplier: must be a number above 0, at most 1`)
  }
  return problems
}

function checkTimeToTarget(value, where) {
  if (!Array.isArray(value) || value.length === 0) {
    return [`${where}: must be a non-empty list`]
  }
  const references = value.flatMap((entry) =>
    TIME_TO_TARGET_STAGES.includes(entry?.stage) &&
    Array.isArray(entry.references)
      ? entry.references.map((ref) => `${entry.stage} ${ref}`)
      : []
  )
  const repeated = references.filter((ref, i) => references.indexOf(ref) !== i)
  return [
    ...value.flatMap((entry, i) =>
      checkTimeToTargetEntry(entry, `${where}[${i}]`)
    ),
    ...repeated.map((ref) => `${where}: ${ref} is listed twice`)
  ]
}

// The layer a subject is on, by the legacy template's name for it, which a
// consumer maps to its own (the harness to a BNG Service table). Vertical
// area habitats have no legacy layer, so a BNG Service only scenario names
// theirs by the BNG Service template's name.
const SUBJECT_LAYERS = ['Habitats', 'Hedgerows', 'Rivers', 'Urban Trees']
const VERTICAL_SUBJECT_LAYER = 'Vertical Area Habitats'

function checkSubjectLayer(layer, scenario, where) {
  if (!isText(layer) || SUBJECT_LAYERS.includes(layer)) {
    return []
  }
  if (layer === VERTICAL_SUBJECT_LAYER) {
    return isBngServiceOnly(scenario)
      ? []
      : [
          `${where}: "${VERTICAL_SUBJECT_LAYER}" is a BNG Service template layer, so only a scenario listing ["${FORMAT_BNG_SERVICE}"] only may name it`
        ]
  }
  return [
    `${where}: ${JSON.stringify(layer)} is not one of ${list([...SUBJECT_LAYERS, VERTICAL_SUBJECT_LAYER])}`
  ]
}

function checkSubject(subject, scenario, where) {
  if (!isObject(subject)) {
    return [`${where}: must be an object with layer, ref and note`]
  }
  const fields = ['layer', 'ref', 'note']
  return [
    ...unknownKeys(subject, fields, where),
    ...fields
      .filter((field) => !isText(subject[field]))
      .map((field) => `${where}.${field}: is required text`),
    ...checkSubjectLayer(subject.layer, scenario, `${where}.layer`)
  ]
}

function checkEmptyLayers(value, where) {
  if (!Array.isArray(value)) {
    return [`${where}: must be a list of layers`]
  }
  const repeated = value.filter((layer, i) => value.indexOf(layer) !== i)
  return [
    ...value.flatMap((layer, i) => checkOneOf(layer, LAYERS, `${where}[${i}]`)),
    ...repeated.map((layer) => `${where}: "${layer}" is listed twice`)
  ]
}

/**
 * The legacy template has no vertical area habitats layer, so a scenario
 * that pins one is generated in the BNG Service format only, and must say so.
 */
function isBngServiceOnly(scenario) {
  return (
    Array.isArray(scenario.formats) &&
    scenario.formats.length === 1 &&
    scenario.formats[0] === FORMAT_BNG_SERVICE
  )
}

function checkVerticalFormats(scenario, where) {
  const pinsVertical =
    isObject(scenario.overrides) && VERTICAL_LAYER in scenario.overrides
  return pinsVertical && !isBngServiceOnly(scenario)
    ? [
        `${where}.formats: a scenario pinning ${VERTICAL_LAYER} must list ["${FORMAT_BNG_SERVICE}"] only, as the legacy template has no vertical area habitats`
      ]
    : []
}

/** A non-empty list of output formats, each named once. */
function checkFormats(value, where) {
  if (!Array.isArray(value) || value.length === 0) {
    return [`${where}: must be a non-empty list of formats`]
  }
  const formats = [...VALID_FORMATS]
  return [
    ...value.flatMap((f, i) => checkOneOf(f, formats, `${where}[${i}]`)),
    ...value
      .filter((f, i) => value.indexOf(f) !== i)
      .map((f) => `${where}: "${f}" is listed twice`)
  ]
}

// Each optional field's check; a field not listed here is unknown.
const OPTIONAL_FIELDS = {
  formats: checkFormats,
  size: (v, where) =>
    isPositiveInteger(v) ? [] : [`${where}: must be a whole number above 0`],
  treeCount: (v, where) =>
    isPositiveInteger(v) ? [] : [`${where}: must be a whole number above 0`],
  emptyLayers: checkEmptyLayers,
  overrides: checkOverrides,
  expectGain: (v, where) => checkOneOf(v, GAIN_VERDICTS, where),
  expectTrading: checkTrading,
  expectUnitOrder: checkStageReferences,
  expectUnitsEqual: checkStageReferences,
  expectUnitRatio: checkUnitRatio,
  expectTimeToTarget: checkTimeToTarget,
  expectMetricWarnings: (v, where) => checkTextList(v, where),
  expectRejectedInputs: (v, where) => checkTextList(v, where, WORKBOOK_FIELD),
  [COMMENT]: (v, where) =>
    typeof v === 'string' ? [] : [`${where}: must be text`]
}
const REQUIRED_TEXT = ['id', 'purpose', 'title', 'description']
const SCENARIO_FIELDS = [
  ...REQUIRED_TEXT,
  'subject',
  ...Object.keys(OPTIONAL_FIELDS)
]

const ERROR_EXPECTATIONS = ['expectMetricWarnings', 'expectRejectedInputs']

/**
 * The naming rule: a scenario holding invalid data starts `invalid-` and
 * says which errors it expects; every other scenario expects none.
 */
function checkInvalidNaming(scenario, where) {
  if (!isText(scenario.id)) {
    return []
  }
  const declared = ERROR_EXPECTATIONS.filter((field) => field in scenario)
  if (scenario.id.startsWith(INVALID_PREFIX)) {
    return declared.length > 0
      ? []
      : [
          `${where}: an "${INVALID_PREFIX}" scenario must declare the errors it expects, in ${ERROR_EXPECTATIONS.join(' or ')}`
        ]
  }
  return declared.map(
    (field) =>
      `${where}.${field}: only a scenario whose id starts "${INVALID_PREFIX}" may expect errors`
  )
}

function checkScenario(scenario, where) {
  if (!isObject(scenario)) {
    return [`${where}: must be an object`]
  }
  return [
    ...unknownKeys(scenario, SCENARIO_FIELDS, where),
    ...REQUIRED_TEXT.filter((field) => !isText(scenario[field])).map(
      (field) => `${where}.${field}: is required text`
    ),
    ...['id', 'purpose']
      .filter(
        (field) => isText(scenario[field]) && !KEBAB_CASE.test(scenario[field])
      )
      .map(
        (field) => `${where}.${field}: must be kebab-case, like "net-gain-met"`
      ),
    ...checkSubject(scenario.subject, scenario, `${where}.subject`),
    ...checkInvalidNaming(scenario, where),
    ...checkVerticalFormats(scenario, where),
    ...Object.entries(OPTIONAL_FIELDS)
      .filter(([field]) => field in scenario)
      .flatMap(([field, check]) => check(scenario[field], `${where}.${field}`))
  ]
}

function checkCatalogue(doc) {
  if (!isObject(doc)) {
    return ['the file must hold an object with defaultSize and scenarios']
  }
  const errors = unknownKeys(
    doc,
    [COMMENT, 'defaultSize', 'scenarios'],
    'the file'
  )
  if (!isPositiveInteger(doc.defaultSize)) {
    errors.push('defaultSize: must be a whole number above 0')
  }
  if (!Array.isArray(doc.scenarios) || doc.scenarios.length === 0) {
    return [...errors, 'scenarios: must be a non-empty list']
  }
  const seen = new Set()
  doc.scenarios.forEach((scenario, i) => {
    const where = `scenarios[${i}]${isText(scenario?.id) ? ` (${scenario.id})` : ''}`
    errors.push(...checkScenario(scenario, where))
    if (seen.has(scenario?.id)) {
      errors.push(
        `${where}: id "${scenario.id}" is used by an earlier scenario`
      )
    }
    seen.add(scenario?.id)
  })
  return errors
}

/**
 * Check a parsed catalogue and return its scenarios.
 *
 * @param {unknown} doc the parsed JSON
 * @param {string} [source] named in the error
 * @returns {{ defaultSize: number, scenarios: object[], purposes: string[] }}
 * @throws {ScenarioCatalogueError} listing every problem found
 */
export function parseScenarioCatalogue(doc, source = 'the scenario catalogue') {
  const errors = checkCatalogue(doc)
  if (errors.length > 0) {
    throw new ScenarioCatalogueError(
      `${source} has ${errors.length} problem(s):\n  ${errors.join('\n  ')}`
    )
  }
  return {
    defaultSize: doc.defaultSize,
    scenarios: doc.scenarios,
    purposes: [...new Set(doc.scenarios.map((s) => s.purpose))]
  }
}

function loadCatalogue() {
  let doc
  try {
    doc = JSON.parse(readFileSync(CATALOGUE_FILE, 'utf8'))
  } catch (error) {
    throw new ScenarioCatalogueError(
      `Cannot read ${CATALOGUE_FILE.pathname}: ${error.message}`
    )
  }
  return parseScenarioCatalogue(doc, CATALOGUE_FILE.pathname)
}

const catalogue = loadCatalogue()

export const DEFAULT_SIZE = catalogue.defaultSize
export const SCENARIOS = catalogue.scenarios
export const PURPOSES = catalogue.purposes

/**
 * Whether a scenario is generated in `format`. A scenario lists `formats`
 * only when it holds what another format cannot express; without the list
 * it is generated in every format.
 */
export function scenarioInFormat(scenario, format) {
  return !scenario.formats || scenario.formats.includes(format)
}
