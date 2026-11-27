/**
 * The BNG Service template's GeoPackage specification and reference lists, as
 * copied into `template/` by `scripts/sync-bng-service-template.mjs`. The
 * specification and the allowed values are read once, when this module loads,
 * since the schema, drop-downs and version below are derived from them; each
 * reference list is read once, on first use. Nothing here restates a template
 * value: the generator and the value check both read the template's own
 * lists.
 */

import { readFileSync } from 'node:fs'

const TEMPLATE_DIR = new URL('./template/', import.meta.url)

const readJson = (name) =>
  JSON.parse(readFileSync(new URL(name, TEMPLATE_DIR), 'utf8'))

/**
 * The template's GeoPackage specification, as bng-metric-template publishes
 * it: every table, at its stage, with every column, fid and geometry
 * included, each column's drop-down, and the version record. The schema,
 * the drop-downs and the version below are read from it, so the library
 * holds one description of the template.
 */
export const GPKG_SPEC = Object.freeze(readJson('gpkg-spec.json'))

/** Each field of TEMPLATE_SOURCE → where the version record holds it. */
const VERSION_RECORD_FIELDS = Object.freeze([
  ['format', ['metadata', 'format']],
  ['version', ['metadata', 'version']],
  ['metadataUri', ['mdStandardUri']],
  ['metadataMimeType', ['mimeType']]
])

/**
 * The format name and version a specification's version record names, with
 * the record's metadata URI and MIME type. Throws, naming the field, when the
 * record lacks one. Exported so the sync script can check a new
 * specification before it copies it.
 *
 * @param {{ versionRecord?: object }} spec
 * @returns {{ format: string, version: string, metadataUri: string, metadataMimeType: string }}
 */
export function templateVersion(spec) {
  return Object.fromEntries(
    VERSION_RECORD_FIELDS.map(([field, keys]) => {
      const value = keys.reduce((held, key) => held?.[key], spec.versionRecord)
      if (typeof value !== 'string' || value === '') {
        throw new Error(
          `the version record has no versionRecord.${keys.join('.')}`
        )
      }
      return [field, value]
    })
  )
}

/**
 * The template commit the copy came from, and the format name and version
 * its GeoPackage records, with the record's metadata URI and MIME type.
 */
export const TEMPLATE_SOURCE = Object.freeze({
  ...readJson('source.json'),
  ...templateVersion(GPKG_SPEC)
})

const FID = 'fid'

/** A table's columns besides fid and the geometry, as `{ name, type }`. */
const attributeColumns = (table) =>
  table.columns
    .filter(({ name }) => name !== FID && name !== table.geometryColumn)
    .map(({ name, type }) => ({ name, type }))

/** Every table of the template's GeoPackage, with its columns in order. */
export const TEMPLATE_SCHEMA = Object.freeze({
  tables: GPKG_SPEC.tables.map((table) => ({
    name: table.name,
    geometryColumn: table.geometryColumn,
    geometryType: table.geometryType,
    srsId: table.srsId,
    columns: attributeColumns(table)
  }))
})

const SPEC_FIXED_LIST = 'fixed list'
const SPEC_REFERENCE_LIST = 'list'
const SPEC_LIST_FOLDER = 'CSV References/'

/**
 * A column's drop-down, as the specification describes it, in this shape.
 * Throws, naming the column, on a kind this library does not know or a list
 * outside the template's CSV References, rather than misread either.
 */
function dropDownOf(table, column, dropDown) {
  const { kind, values, list, storedColumn, filter } = dropDown
  if (kind === SPEC_FIXED_LIST) {
    return { kind: 'list', values: values.map(({ stored }) => stored) }
  }
  const label = `"${table}"."${column}"`
  if (kind !== SPEC_REFERENCE_LIST) {
    throw new Error(`${label} has a drop-down of unknown kind "${kind}"`)
  }
  if (!list?.startsWith(SPEC_LIST_FOLDER)) {
    throw new Error(
      `${label} reads a list outside ${SPEC_LIST_FOLDER}: ${list}`
    )
  }
  return {
    kind: 'reference',
    list: list.slice(SPEC_LIST_FOLDER.length),
    key: storedColumn,
    ...(filter ? { filter } : {})
  }
}

/**
 * table → column → drop-down, from a GeoPackage specification. Exported so
 * the sync script can check a new specification before it copies it.
 *
 * @param {{ tables: Array<{ name: string, columns: Array<{ name: string, dropDown?: object }> }> }} spec
 */
export function templateDropDowns(spec) {
  return Object.fromEntries(
    spec.tables.map((table) => [
      table.name,
      Object.fromEntries(
        table.columns
          .filter(({ dropDown }) => dropDown)
          .map(({ name, dropDown }) => [
            name,
            dropDownOf(table.name, name, dropDown)
          ])
      )
    ])
  )
}

/** table → column → { kind: 'list', values } | { kind: 'reference', list, key, filter? } */
export const TEMPLATE_DROP_DOWNS = Object.freeze(templateDropDowns(GPKG_SPEC))

/**
 * column → every value that a drop-down or filled-in column offers, in this
 * template or the Natural England template, as each list spells it (with or
 * without a list number).
 */
export const TEMPLATE_ALLOWED_VALUES = Object.freeze(
  readJson('allowed-values.json')
)

const BOM = '﻿'

/**
 * Parse CSV text into rows of strings: quoted fields, doubled quotes inside
 * them, and commas or line breaks inside quotes, as the template's lists use.
 */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const source = text.startsWith(BOM) ? text.slice(1) : text
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (ch === '"') {
        quoted = false
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') {
        i += 1
      }
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((value) => value !== ''))
}

const listCache = new Map()

/**
 * One reference list as records keyed by its header, such as
 * `referenceList('Habitats/Habitat Condition.csv')`.
 *
 * @param {string} name  path inside the template's CSV References
 * @returns {Record<string, string>[]}
 */
export function referenceList(name) {
  if (!listCache.has(name)) {
    const text = readFileSync(
      new URL(`reference/${name}`, TEMPLATE_DIR),
      'utf8'
    )
    const [header, ...rows] = parseCsv(text)
    listCache.set(
      name,
      Object.freeze(
        rows.map((row) =>
          Object.freeze(
            Object.fromEntries(header.map((h, i) => [h, row[i] ?? '']))
          )
        )
      )
    )
  }
  return listCache.get(name)
}

/**
 * key → Set of values, from two columns of one list: the conditions of each
 * habitat, say. Rows with a blank value are skipped.
 */
export function listIndex(name, keyColumn, valueColumn) {
  const index = new Map()
  for (const row of referenceList(name)) {
    const value = row[valueColumn]
    if (!value) {
      continue
    }
    if (!index.has(row[keyColumn])) {
      index.set(row[keyColumn], new Set())
    }
    index.get(row[keyColumn]).add(value)
  }
  return index
}

/** The one value a list gives each key, such as a habitat's distinctiveness. */
export function listLookup(name, keyColumn, valueColumn) {
  return new Map(
    referenceList(name).map((row) => [row[keyColumn], row[valueColumn]])
  )
}

/** The values a column's fixed list offers, in the template's order. */
export function fixedListValues(table, column) {
  const dropDown = TEMPLATE_DROP_DOWNS[table]?.[column]
  if (dropDown?.kind !== 'list') {
    throw new Error(`"${table}"."${column}" has no fixed list in the template`)
  }
  return dropDown.values
}
