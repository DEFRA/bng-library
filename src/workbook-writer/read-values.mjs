/**
 * Read the values an .xlsx holds — its cached results, as Excel or LibreOffice
 * saved them — from the sheets asked for, into the same
 * `{ Sheets: { name: { A1: { t, v } } } }` shape the CSV reader produces.
 *
 * Reads the zip and the worksheet XML directly, so reading a workbook's answers
 * needs no spreadsheet library. Nothing is calculated: a formula cell saved
 * without a value (as every workbook the writer produces is, until it has been
 * recalculated) reads as empty.
 */

import {
  decodeEntities,
  readSharedStrings,
  readSheetParts
} from './metric-template.mjs'
import { columnIndex, columnLetters } from './sheet-xml.mjs'
import { readZip } from './xlsx-zip.mjs'

const CELL = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
const ATTRIBUTE = (name) => new RegExp(`\\s${name}="([^"]*)"`)
const REF = ATTRIBUTE('r')
const TYPE = ATTRIBUTE('t')
const VALUE = /<v>([\s\S]*?)<\/v>/
const INLINE_TEXT = /<t[^>]*>([\s\S]*?)<\/t>/g
const SPLIT_REF = /^([A-Z]+)(\d+)$/

function inlineText(inner) {
  return decodeEntities(
    [...inner.matchAll(INLINE_TEXT)].map(([, text]) => text).join('')
  )
}

/** One cell's value, or null for a cell with nothing in it. */
function cellValue(attributes, inner, sharedStrings) {
  const type = TYPE.exec(attributes)?.[1] ?? 'n'
  if (type === 'inlineStr') {
    return { t: 's', v: inlineText(inner) }
  }
  const raw = VALUE.exec(inner)?.[1]
  if (raw === undefined) {
    return null
  }
  switch (type) {
    case 's':
      return { t: 's', v: sharedStrings[Number(raw)] ?? '' }
    case 'str':
      return { t: 's', v: decodeEntities(raw) }
    case 'b':
      return { t: 'b', v: raw === '1' }
    case 'e': {
      const error = decodeEntities(raw)
      return { t: 'e', v: error, w: error }
    }
    default:
      return { t: 'n', v: Number(raw) }
  }
}

function readSheet(xml, sharedStrings) {
  const sheet = {}
  let lastColumn = 1
  let lastRow = 1
  for (const [, attributes, inner = ''] of xml.matchAll(CELL)) {
    const ref = REF.exec(attributes)?.[1]
    const cell = ref ? cellValue(attributes, inner, sharedStrings) : null
    if (cell === null || (cell.t === 's' && cell.v === '')) {
      continue
    }
    sheet[ref] = cell
    const [, letters, row] = SPLIT_REF.exec(ref)
    lastColumn = Math.max(lastColumn, columnIndex(letters))
    lastRow = Math.max(lastRow, Number(row))
  }
  sheet['!ref'] = `A1:${columnLetters(lastColumn)}${lastRow}`
  return sheet
}

/**
 * @param {Buffer} buffer the .xlsx bytes
 * @param {string[]} sheetNames the sheets to read; a missing one is skipped
 * @returns {{ Sheets: Record<string, object> }}
 */
export function readWorkbookValues(buffer, sheetNames) {
  const zip = readZip(buffer)
  const { parts } = readSheetParts(zip)
  const sharedStrings = readSharedStrings(zip)
  const Sheets = {}
  for (const name of sheetNames) {
    const part = parts.get(name)
    if (part && zip.has(part)) {
      Sheets[name] = readSheet(zip.read(part).toString('utf8'), sharedStrings)
    }
  }
  return { Sheets }
}
