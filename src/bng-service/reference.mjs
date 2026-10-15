/**
 * The BNG Service template's schema and reference lists, as copied into
 * `template/` by `scripts/sync-bng-service-template.mjs`. Read once, on first
 * use. Nothing here restates a template value: the generator and the value
 * check both read the template's own lists.
 */

import { readFileSync } from 'node:fs'

const TEMPLATE_DIR = new URL('./template/', import.meta.url)

const readJson = (name) =>
  JSON.parse(readFileSync(new URL(name, TEMPLATE_DIR), 'utf8'))

/** The template commit, format name and version the copy came from. */
export const TEMPLATE_SOURCE = Object.freeze(readJson('source.json'))

/** Every table of the template's GeoPackage, with its columns in order. */
export const TEMPLATE_SCHEMA = Object.freeze(readJson('schema.json'))

/** table → column → { kind: 'list', values } | { kind: 'reference', list, key, filter? } */
export const TEMPLATE_DROP_DOWNS = Object.freeze(readJson('drop-downs.json'))

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
