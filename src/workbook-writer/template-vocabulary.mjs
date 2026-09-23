/**
 * The values a metric workbook will accept, read from the workbook itself.
 *
 * Every input cell in the template is a drop-down fed from the reference
 * sheets (G-1 … G-8). A value that is not on the list does not raise
 * anything: the lookups that use it are wrapped in IFERROR, so the row
 * reports "Check Data" and generates no units. A corpus built from such rows
 * computes nothing, and a comparison against it passes because both sides are
 * empty. So the lists are taken from the template — never from
 * the library's own reference data — and every row is checked against them.
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const ALL_HABITATS = 'G-1 All Habitats'
const MULTIPLIERS = 'G-3 Multipliers'
const TEMPORAL = 'G-4 Temporal multipliers'
const HEDGE_DATA = 'G-6 Hedgerow Data'
const WATER_DATA = "G-7 WaterC' Data"
const CONDITION_LOOKUP = 'G-8 Condition Look up'

// Ranges the template's own data validation points at (see each input
// sheet's <dataValidations>). Broad habitat → named range of habitat types
// follows A-1's column A formula; condition groups follow column B.
const RANGES = {
  broadHabitats: [ALL_HABITATS, 'AF3:AF17'],
  broadHabitatRangeNames: [ALL_HABITATS, 'AG3:AG17'],
  strategicSignificance: [MULTIPLIERS, 'L4:L6'],
  years: [TEMPORAL, 'A42:A73'],
  hedgeTypes: [HEDGE_DATA, 'B3:B15'],
  hedgeConditionGroups: [HEDGE_DATA, 'BJ3:BJ15'],
  watercourseTypes: [WATER_DATA, 'B4:B8'],
  enhanceableWatercourseTypes: [WATER_DATA, 'B4:B7'],
  watercourseStrategicSignificance: [WATER_DATA, 'AK4:AK6'],
  watercourseConditionTypes: [WATER_DATA, 'AY3:AY7'],
  watercourseConditionGroups: [WATER_DATA, 'AZ3:AZ7'],
  conditionHabitats: [CONDITION_LOOKUP, 'A4:A135'],
  conditionGroups: [CONDITION_LOOKUP, 'I4:I135']
}

const CULVERT = 'Culvert'
const YES_NO = ['Yes', 'No']

function loadXlsx() {
  try {
    return require('xlsx')
  } catch {
    throw new Error(
      'Reading the metric template needs the optional peer dependency "xlsx" — npm install xlsx'
    )
  }
}

function text(value) {
  return value === null || value === undefined ? null : String(value).trim()
}

function rangeValues(XLSX, workbook, sheetName, range) {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    throw new Error(`The metric template has no sheet named ${sheetName}`)
  }
  const { s, e } = XLSX.utils.decode_range(range)
  const values = []
  for (let r = s.r; r <= e.r; r += 1) {
    for (let c = s.c; c <= e.c; c += 1) {
      values.push(sheet[XLSX.utils.encode_cell({ r, c })]?.v ?? null)
    }
  }
  return values
}

function namedRangeValues(XLSX, workbook, name) {
  const definition = workbook.Workbook?.Names?.find(
    (n) => n.Name === name && n.Sheet === undefined
  )
  if (!definition) {
    return []
  }
  const match = /^'?(.+?)'?!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(
    definition.Ref
  )
  if (!match) {
    return []
  }
  const [, sheetName, c1, r1, c2 = c1, r2 = r1] = match
  return rangeValues(
    XLSX,
    workbook,
    sheetName.replaceAll("''", "'"),
    `${c1}${r1}:${c2}${r2}`
  )
    .map(text)
    .filter(Boolean)
}

function zipToMap(keys, values) {
  const map = {}
  keys.forEach((key, i) => {
    const k = text(key)
    if (k && values[i] !== null && values[i] !== undefined) {
      map[k] = values[i]
    }
  })
  return map
}

function listsByGroup(XLSX, workbook, keyToGroup) {
  const lists = {}
  for (const [key, group] of Object.entries(keyToGroup)) {
    lists[key] = namedRangeValues(XLSX, workbook, text(group))
  }
  return lists
}

/**
 * @param {Buffer} templateBuffer the unmodified template (its cached values
 *   are what hold the lists)
 */
export function readTemplateVocabulary(templateBuffer) {
  const XLSX = loadXlsx()
  const workbook = XLSX.read(templateBuffer, { type: 'buffer' })
  const read = (key) => rangeValues(XLSX, workbook, ...RANGES[key])
  const list = (key) => read(key).map(text).filter(Boolean)

  const broadHabitats = list('broadHabitats')
  const rangeNames = zipToMap(broadHabitats, read('broadHabitatRangeNames'))
  const habitatTypes = listsByGroup(XLSX, workbook, rangeNames)

  const conditionGroupByHabitat = zipToMap(
    read('conditionHabitats'),
    read('conditionGroups')
  )
  const hedgeGroups = zipToMap(list('hedgeTypes'), read('hedgeConditionGroups'))
  const watercourseGroups = zipToMap(
    read('watercourseConditionTypes'),
    read('watercourseConditionGroups')
  )

  return {
    broadHabitats,
    habitatTypes,
    habitatConditions: listsByGroup(XLSX, workbook, conditionGroupByHabitat),
    strategicSignificance: list('strategicSignificance'),
    years: read('years')
      .map(text)
      .filter((v) => v !== null && v !== ''),
    irreplaceable: YES_NO,
    hedgeTypes: list('hedgeTypes'),
    hedgeConditions: listsByGroup(XLSX, workbook, hedgeGroups),
    watercourseTypes: list('watercourseTypes'),
    enhanceableWatercourseTypes: list('enhanceableWatercourseTypes'),
    watercourseStrategicSignificance: list('watercourseStrategicSignificance'),
    watercourseConditions: listsByGroup(XLSX, workbook, watercourseGroups),
    // The template's names for these two lists are the wrong way round —
    // "riparianencroachment" feeds the watercourse column and "Encroachment"
    // the riparian one — so they are keyed here by what they hold.
    watercourseEncroachment: {
      culvert: namedRangeValues(XLSX, workbook, 'riparianencroachment2'),
      other: namedRangeValues(XLSX, workbook, 'riparianencroachment1')
    },
    riparianEncroachment: {
      culvert: namedRangeValues(XLSX, workbook, 'Encroachment2'),
      other: namedRangeValues(XLSX, workbook, 'Encroachment1')
    }
  }
}

// ---------------------------------------------------------------------------
// Checking rows against the vocabulary
// ---------------------------------------------------------------------------

function isBlank(value) {
  return value === null || value === undefined || value === ''
}

// The metric's lookups (MATCH, VLOOKUP, INDIRECT) ignore case, and the
// template relies on it: G-7 keys "Priority Habitat" where the type list
// says "Priority habitat". Spacing is not ignored, so neither is it here.
function lookupKey(value) {
  return String(value).trim().toLowerCase()
}

function lookup(map, name) {
  const wanted = lookupKey(name)
  const found = Object.keys(map).find((k) => lookupKey(k) === wanted)
  return found === undefined ? [] : map[found]
}

/**
 * The rules for one kind of sheet: each names a field and the list its value
 * must come from, given the rest of the row. A rule returning null does not
 * apply to that row.
 */
function areaRules(v) {
  return {
    broadHabitat: () => v.broadHabitats,
    habitatType: (row) => lookup(v.habitatTypes, row.broadHabitat),
    condition: (row) =>
      lookup(v.habitatConditions, `${row.broadHabitat} - ${row.habitatType}`),
    strategicSignificance: () => v.strategicSignificance,
    irreplaceable: (row) => ('irreplaceable' in row ? v.irreplaceable : null),
    advanceYears: (row) => ('advanceYears' in row ? v.years : null),
    delayYears: (row) => ('delayYears' in row ? v.years : null)
  }
}

function hedgeRules(v) {
  return {
    habitatType: () => v.hedgeTypes,
    condition: (row) => lookup(v.hedgeConditions, row.habitatType),
    strategicSignificance: () => v.strategicSignificance,
    advanceYears: (row) => ('advanceYears' in row ? v.years : null),
    delayYears: (row) => ('delayYears' in row ? v.years : null)
  }
}

function watercourseRules(v, types) {
  const side = (row) =>
    lookupKey(row.habitatType ?? '') === lookupKey(CULVERT)
      ? 'culvert'
      : 'other'
  return {
    habitatType: () => types,
    condition: (row) => lookup(v.watercourseConditions, row.habitatType),
    strategicSignificance: () => v.watercourseStrategicSignificance,
    watercourseEncroachment: (row) => v.watercourseEncroachment[side(row)],
    riparianEncroachment: (row) => v.riparianEncroachment[side(row)],
    advanceYears: (row) => ('advanceYears' in row ? v.years : null),
    delayYears: (row) => ('delayYears' in row ? v.years : null)
  }
}

function rulesFor(key, vocabulary) {
  if (key.startsWith('habitat')) {
    return areaRules(vocabulary)
  }
  if (key.startsWith('hedgerow')) {
    return hedgeRules(vocabulary)
  }
  const types =
    key === 'watercourseEnhancement'
      ? vocabulary.enhanceableWatercourseTypes
      : vocabulary.watercourseTypes
  return watercourseRules(vocabulary, types)
}

function sizeIssue(row) {
  if (!('size' in row)) {
    return null
  }
  if (typeof row.size !== 'number' || !(row.size > 0)) {
    return { field: 'size', value: row.size ?? null, problem: 'not-positive' }
  }
  return null
}

function rowIssues(row, rules) {
  const issues = []
  const size = sizeIssue(row)
  if (size) {
    issues.push(size)
  }
  for (const [field, allowedFor] of Object.entries(rules)) {
    const allowed = allowedFor(row)
    if (allowed === null) {
      continue
    }
    const value = row[field]
    if (isBlank(value)) {
      issues.push({ field, value: null, problem: 'missing' })
    } else if (
      !allowed.some((entry) => lookupKey(entry) === lookupKey(value))
    ) {
      issues.push({ field, value, problem: 'not-in-list', allowed })
    }
  }
  return issues
}

/**
 * Check every row against the template's lists.
 *
 * @param {Record<string, object[]>} rows keyed as METRIC_SHEETS
 * @param {ReturnType<typeof readTemplateVocabulary>} vocabulary
 * @returns {object[]} one entry per offending field:
 *   { sheet, index, reference, field, value, problem, allowed? }
 */
export function checkVocabulary(rows, vocabulary) {
  const issues = []
  for (const [sheet, sheetRows] of Object.entries(rows)) {
    const rules = rulesFor(sheet, vocabulary)
    sheetRows.forEach((row, index) => {
      for (const issue of rowIssues(row, rules)) {
        issues.push({
          sheet,
          index,
          reference: row.reference ?? null,
          ...issue
        })
      }
    })
  }
  return issues
}
