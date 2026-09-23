/**
 * Read a recalculated workbook that LibreOffice exported as one CSV per
 * sheet, into the same `{ Sheets: { name: { A1: { v, t } } } }` shape a
 * spreadsheet library produces, so the results reader need not care which
 * it was given.
 *
 * Exporting CSV rather than saving an .xlsx halves LibreOffice's time per
 * workbook: it recalculates the same, but skips re-serialising the styles.
 * Values are exported unformatted, at full precision.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { columnLetters } from './sheet-xml.mjs'

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:E[-+]?\d+)?$/i
// LibreOffice keeps a percentage cell's format even when exporting values
// unformatted: 0.148 arrives as "14.8084720247642%".
const PERCENTAGE = /^(-?(?:\d+\.?\d*|\.\d+)(?:E[-+]?\d+)?)%$/i
const PERCENT = 100
const SPREADSHEET_ERROR = /^#(?:REF!|N\/A|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!)$/

/** A quoted field from just after its opening quote: [text, next index]. */
function readQuoted(text, start) {
  let value = ''
  let i = start
  while (i < text.length) {
    if (text[i] !== '"') {
      value += text[i]
      i += 1
    } else if (text[i + 1] === '"') {
      value += '"'
      i += 2
    } else {
      return [value, i + 1]
    }
  }
  return [value, i]
}

/** RFC 4180 CSV: quoted fields may hold commas, doubled quotes and newlines. */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '"') {
      const [quoted, next] = readQuoted(text, i + 1)
      field += quoted
      i = next
    } else if (ch === ',') {
      row.push(field)
      field = ''
      i += 1
    } else if (ch === '\n' || ch === '\r') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1
    } else {
      field += ch
      i += 1
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function toCell(raw) {
  if (SPREADSHEET_ERROR.test(raw)) {
    return { t: 'e', v: raw, w: raw }
  }
  if (NUMBER.test(raw)) {
    return { t: 'n', v: Number(raw) }
  }
  const percentage = PERCENTAGE.exec(raw)
  if (percentage) {
    return { t: 'n', v: Number(percentage[1]) / PERCENT }
  }
  return { t: 's', v: raw }
}

/** One CSV's text as a sheet object keyed by A1 references. */
export function csvToSheet(text) {
  const sheet = {}
  const rows = parseCsv(text)
  let lastColumn = 0
  rows.forEach((cells, r) => {
    cells.forEach((raw, c) => {
      if (raw === '') {
        return
      }
      sheet[`${columnLetters(c + 1)}${r + 1}`] = toCell(raw)
      lastColumn = Math.max(lastColumn, c)
    })
  })
  sheet['!ref'] =
    `A1:${columnLetters(lastColumn + 1)}${Math.max(rows.length, 1)}`
  return sheet
}

/**
 * Load every sheet LibreOffice exported for one workbook. It names each file
 * `<workbook name>-<sheet name>.csv`.
 *
 * @param {string} dir the export directory
 * @param {string} name the workbook's file name without its extension
 * @param {string[]} sheetNames the sheets to load; a missing one is skipped
 */
export function readCsvWorkbook(dir, name, sheetNames) {
  const Sheets = {}
  for (const sheetName of sheetNames) {
    const file = path.join(dir, `${name}-${sheetName}.csv`)
    if (existsSync(file)) {
      Sheets[sheetName] = csvToSheet(readFileSync(file, 'utf8'))
    }
  }
  return { Sheets }
}
