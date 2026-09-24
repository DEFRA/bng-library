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
import { INVALID_PREFIX } from './invalid-data.mjs'

const CATALOGUE_FILE = new URL('./scenarios.json', import.meta.url)

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const WORKBOOK_FIELD = /^[a-zA-Z]+\.[a-zA-Z]+$/
const COMMENT = '$comment'

const LAYERS = ['habitats', 'hedgerows', 'rivers', 'trees']
const GAIN_VERDICTS = ['met', 'unmet']
const TRADING_VERDICTS = ['met', 'breached']
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
  hedgerows: ['hedgeType', 'proposedHedgeType', 'lengthRange'],
  rivers: [
    'riverType',
    'proposedRiverType',
    'baselineWaterEncroachment',
    'proposedWaterEncroachment',
    'baselineRiparianEncroachment',
    'proposedRiparianEncroachment',
    'lengthRange'
  ]
}

/** A catalogue that cannot be read or does not check out; a CLI can report it plainly. */
export class ScenarioCatalogueError extends Error {
  name = 'ScenarioCatalogueError'
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isText = (v) => typeof v === 'string' && v.trim() !== ''
const isPositiveInteger = (v) => Number.isInteger(v) && v > 0
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

function checkOverrideValue(field, value, where) {
  if (field === 'lengthRange') {
    return checkLengthRange(value, where)
  }
  if (field === 'incomplete') {
    return typeof value === 'boolean' ? [] : [`${where}: must be true or false`]
  }
  return typeof value === 'string' ? [] : [`${where}: must be text`]
}

function checkOverrideRow(layer, row, where) {
  if (!isObject(row)) {
    return [`${where}: must be an object`]
  }
  const allowed = [
    ...COMMON_OVERRIDE_FIELDS,
    ...OVERRIDE_FIELDS[layer],
    COMMENT
  ]
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
  const layers = Object.keys(OVERRIDE_FIELDS)
  return [
    ...unknownKeys(overrides, layers, where),
    ...Object.entries(overrides)
      .filter(([layer]) => layers.includes(layer))
      .flatMap(([layer, rows]) =>
        Array.isArray(rows)
          ? rows.flatMap((row, i) =>
              checkOverrideRow(layer, row, `${where}.${layer}[${i}]`)
            )
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

function checkSubject(subject, where) {
  if (!isObject(subject)) {
    return [`${where}: must be an object with layer, ref and note`]
  }
  const fields = ['layer', 'ref', 'note']
  return [
    ...unknownKeys(subject, fields, where),
    ...fields
      .filter((field) => !isText(subject[field]))
      .map((field) => `${where}.${field}: is required text`)
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

// Each optional field's check; a field not listed here is unknown.
const OPTIONAL_FIELDS = {
  size: (v, where) =>
    isPositiveInteger(v) ? [] : [`${where}: must be a whole number above 0`],
  emptyLayers: checkEmptyLayers,
  overrides: checkOverrides,
  expectGain: (v, where) => checkOneOf(v, GAIN_VERDICTS, where),
  expectTrading: checkTrading,
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
    ...checkSubject(scenario.subject, `${where}.subject`),
    ...checkInvalidNaming(scenario, where),
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
