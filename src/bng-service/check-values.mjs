/**
 * Check every value in a BNG Service template GeoPackage against the
 * template's own drop-downs, as the template applies them.
 *
 * A value written straight into a GeoPackage never passes through a
 * drop-down, so nothing stops it being one the list would not have offered.
 * This applies each drop-down's filter to each row exactly as QGIS would and
 * reports every value the list would not offer. A blank passes a drop-down:
 * it is a missing value, which the service reports as such.
 *
 * The columns the template fills in itself (distinctiveness, strategic
 * significance, spatial risk, Irreplaceable Habitat) are checked against
 * their lists and rules directly, and a blank there is wrong wherever the
 * template would have filled a value in.
 *
 * A port of the template repository's
 * `scale-test-nsip/generator/dropdown_check.py`, reading the copy of the
 * template's drop-downs and lists in `template/`.
 */

import Database from 'better-sqlite3'
import { blankToNull, parseFilter } from './filter.mjs'
import {
  TEMPLATE_DROP_DOWNS,
  TEMPLATE_SCHEMA,
  listIndex,
  referenceList
} from './reference.mjs'

const EXAMPLES_PER_FIELD = 3
const LOW = 'Low'
const HIGH = 'High'
const NOT_APPLICABLE = 'N/A'
const RETAINED = 'Retained'
const NO_HABITAT_TYPES = new Set(['To be created', NOT_APPLICABLE])
const BLANK = new Set([null])
const ANYTHING = { has: () => true }

const RULE_FIELDS = new Set([
  'Baseline Distinctiveness',
  'Proposed Distinctiveness',
  'Baseline Strategic Significance',
  'Proposed Strategic Significance',
  'Spatial risk category',
  'Irreplaceable Habitat'
])

const AREA_DISTINCTIVENESS = [
  [
    'Habitats/Habitat Distinctiveness- pre.csv',
    'Habitat',
    'Baseline Distinctivness'
  ],
  [
    'Habitats/Habitat Distinctiveness- post.csv',
    'Habitat',
    'Proposed Distinctivness'
  ]
]
// Layer → [type column stem, [baseline, proposed] distinctiveness lists].
const KINDS = {
  'Area Habitats': ['Habitat Type', AREA_DISTINCTIVENESS],
  'Vertical Area Habitats': [
    'Habitat Type',
    [
      [
        'Vertical Area Habitats/Vertical Area Habitat Distinctiveness- pre.csv',
        'Habitat',
        'Baseline Distinctivness'
      ],
      [
        'Vertical Area Habitats/Vertical Area Habitat Distinctiveness- post.csv',
        'Habitat',
        'Proposed Distinctivness'
      ]
    ]
  ],
  Hedgerows: [
    'Hedge Type',
    [
      [
        'Hedgerows/Hedgerow Distinctiveness- pre.csv',
        'Value',
        'Distinctiveness'
      ],
      [
        'Hedgerows/Hedgerow Distinctiveness - post.csv',
        'Value',
        'Distinctiveness'
      ]
    ]
  ],
  Watercourses: [
    'River Type',
    [
      [
        'Watercourses/Watercourse Distinctiveness- pre.csv',
        'Value',
        'Distinctiveness'
      ],
      [
        'Watercourses/Watercourse Distinctiveness- post.csv',
        'Value',
        'Distinctiveness'
      ]
    ]
  ],
  'Individual Trees': ['Tree Type', null]
}
const IRREPLACEABLE_LIST = [
  'Habitats/Habitat Irreplaceable.csv',
  'UKHAB',
  'Irreplaceable'
]
const STAGES = [
  ['Baseline', false],
  ['Post-Intervention', true]
]
// Years created in advance and years of delay: both above 0 is not allowed.
const TIMING = {
  'Individual Trees': [
    'Habitat Created/Enhanced in advance/years',
    'Delay in starting habitat creation/enhancement in years'
  ]
}
const DEFAULT_TIMING = [
  'Habitat created in advance/years',
  'Delay in starting habitat creation/years'
]

const hasType = (value) =>
  blankToNull(value) !== null && !NO_HABITAT_TYPES.has(value)

const aboveZero = (value) => ![null, '0'].includes(blankToNull(value))

function fromType(values, typeColumn) {
  return (row) => {
    const habitat = blankToNull(row[typeColumn])
    return habitat === null ? BLANK : (values.get(habitat) ?? new Set())
  }
}

function irreplaceableRule(values, typeColumn) {
  return (row) => {
    const habitat = blankToNull(row[typeColumn])
    if (habitat === null) {
      return BLANK
    }
    const allowed = values.get(habitat) ?? new Set()
    return allowed.size === 1 ? allowed : new Set([...allowed, null])
  }
}

function baselineSignificance(typeColumn, post) {
  if (!post) {
    return () => new Set([LOW])
  }
  return (row) => (hasType(row[typeColumn]) ? new Set([LOW]) : BLANK)
}

const proposedSignificance = (row) =>
  blankToNull(row['Retention Category']) === RETAINED
    ? new Set([LOW])
    : new Set([LOW, HIGH])

const blankWhileOtherSet = (other) => (row) =>
  aboveZero(row[other]) ? BLANK : ANYTHING

function stageRuleChecks(stem, typeStem, lists, post, irreplaceable) {
  const baselineType = `Baseline ${typeStem}`
  const fields = [
    [
      'Baseline Strategic Significance',
      baselineSignificance(baselineType, post)
    ]
  ]
  if (lists) {
    fields.push([
      'Baseline Distinctiveness',
      fromType(listIndex(...lists[0]), baselineType)
    ])
  }
  if (post) {
    const [advance, delay] = TIMING[stem] ?? DEFAULT_TIMING
    fields.push(
      ['Proposed Strategic Significance', proposedSignificance],
      [advance, blankWhileOtherSet(delay)],
      [delay, blankWhileOtherSet(advance)],
      ['Spatial risk category', () => new Set([NOT_APPLICABLE])]
    )
    if (lists) {
      fields.push([
        'Proposed Distinctiveness',
        fromType(listIndex(...lists[1]), `Proposed ${typeStem}`)
      ])
    }
  }
  if (stem === 'Area Habitats' || stem === 'Vertical Area Habitats') {
    fields.push([
      'Irreplaceable Habitat',
      irreplaceableRule(irreplaceable, baselineType)
    ])
  }
  return fields
}

/** table → [[field, allowed(row)]] for the columns the template fills in. */
function ruleChecks() {
  const irreplaceable = listIndex(...IRREPLACEABLE_LIST)
  const checks = {}
  for (const [stem, [typeStem, lists]] of Object.entries(KINDS)) {
    for (const [stage, post] of STAGES) {
      checks[`${stem} ${stage}`] = stageRuleChecks(
        stem,
        typeStem,
        lists,
        post,
        irreplaceable
      )
    }
  }
  return checks
}

function allowedBy(rows, key, filter) {
  if (!filter) {
    const every = new Set(rows.map((r) => r[key]))
    return () => every
  }
  const fields = [...filter.fields].sort((a, b) => a.localeCompare(b))
  const cache = new Map()
  return (row) => {
    const cacheKey = JSON.stringify(fields.map((f) => blankToNull(row[f])))
    if (!cache.has(cacheKey)) {
      cache.set(
        cacheKey,
        new Set(rows.filter((r) => filter.matches(r, row)).map((r) => r[key]))
      )
    }
    return cache.get(cacheKey)
  }
}

function dropDownCheck(dropDown, columnNames) {
  if (dropDown.kind === 'list') {
    const allowed = new Set(dropDown.values)
    return () => allowed
  }
  let filter = dropDown.filter ? parseFilter(dropDown.filter) : null
  // QGIS ignores a filter that reads a column the layer lacks, and offers
  // the whole list, so the check does the same.
  if (filter && ![...filter.fields].every((f) => columnNames.has(f))) {
    filter = null
  }
  return allowedBy(referenceList(dropDown.list), dropDown.key, filter)
}

let cachedChecks = null

/** table → [[field, allowed(row)]], for every column the check reads. */
function buildChecks() {
  if (cachedChecks) {
    return cachedChecks
  }
  const checks = {}
  for (const table of TEMPLATE_SCHEMA.tables) {
    const names = new Set(table.columns.map((c) => c.name))
    checks[table.name] = Object.entries(TEMPLATE_DROP_DOWNS[table.name] ?? {})
      .filter(([field]) => !RULE_FIELDS.has(field))
      .map(([field, dropDown]) => [field, dropDownCheck(dropDown, names)])
  }
  for (const [table, fields] of Object.entries(ruleChecks())) {
    checks[table] = [...(checks[table] ?? []), ...fields]
  }
  cachedChecks = checks
  return checks
}

function tableExists(db, table) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table)
  )
}

/**
 * Every value in the file that the template's drop-downs would not offer.
 *
 * @param {string | import('better-sqlite3').Database} source  a GeoPackage
 *   path, or an open handle (left open)
 * @returns {{ table: string, field: string, count: number, examples: unknown[] }[]}
 *   empty when every value is one the template offers
 */
export function checkTemplateValues(source) {
  const db =
    typeof source === 'string'
      ? new Database(source, { readonly: true })
      : source
  try {
    const invalid = new Map()
    for (const [table, fields] of Object.entries(buildChecks())) {
      if (!tableExists(db, table)) {
        continue
      }
      for (const row of db.prepare(`SELECT * FROM "${table}"`).iterate()) {
        for (const [field, allowed] of fields) {
          const value = blankToNull(row[field])
          if (value === null && !RULE_FIELDS.has(field)) {
            continue
          }
          if (allowed(row).has(value)) {
            continue
          }
          const key = `${table}\u0000${field}`
          const found = invalid.get(key) ?? {
            table,
            field,
            count: 0,
            examples: []
          }
          found.count += 1
          if (found.examples.length < EXAMPLES_PER_FIELD) {
            found.examples.push(value)
          }
          invalid.set(key, found)
        }
      }
    }
    return [...invalid.values()].sort(
      (a, b) => a.table.localeCompare(b.table) || a.field.localeCompare(b.field)
    )
  } finally {
    if (typeof source === 'string') {
      db.close()
    }
  }
}
