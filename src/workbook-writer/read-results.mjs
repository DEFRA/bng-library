/**
 * Read a recalculated metric workbook's answers: the headline figures, the
 * trading-rule verdicts, and every warning the metric raised on a row.
 *
 * These are the metric's own outputs — nothing here computes anything — so
 * they are the expected results a service run is compared against.
 */

import { createRequire } from 'node:module'
import { columnIndex, columnLetters } from './sheet-xml.mjs'
import { METRIC_SHEETS } from './template-layout.mjs'

const require = createRequire(import.meta.url)

const HEADLINE = 'Headline Results'
const TRADING_AREA = 'Trading Summary Area Habitats'
const TRADING_HEDGEROW = 'Trading Summary Hedgerows'
const TRADING_WATERCOURSE = "Trading Summary WaterC's"

const HABITAT_KINDS = ['area', 'hedgerow', 'watercourse']

// Headline Results rows for [area, hedgerow, watercourse].
const HEADLINE_CELLS = {
  baselineUnits: ['H8', 'H9', 'H10'],
  postInterventionUnits: ['H12', 'H13', 'H14'],
  netUnitChange: ['H16', 'H17', 'H18'],
  netPercentChange: ['J16', 'J17', 'J18'],
  netGainMessage: ['K16', 'K17', 'K18'],
  unitsRequired: ['F61', 'F62', 'F63'],
  unitDeficit: ['H61', 'H62', 'H63']
}

const TARGET_CELL = 'D61'
const TRADING_RULES_CELL = 'F55'
const OVERALL_MESSAGE_CELLS = ['B56', 'B57', 'B58', 'B59', 'B94']

// Each trading summary lists its distinctiveness bands in column B from row
// 5, with the verdict in the column given.
const TRADING_SUMMARIES = {
  area: { sheet: TRADING_AREA, verdict: 'G', rows: [5, 6, 7, 8] },
  hedgerow: { sheet: TRADING_HEDGEROW, verdict: 'F', rows: [5, 6, 7, 8, 9] },
  watercourse: { sheet: TRADING_WATERCOURSE, verdict: 'G', rows: [5, 6, 7, 8] }
}

/** Every sheet the results are read from. */
export const RESULT_SHEETS = [
  HEADLINE,
  TRADING_AREA,
  TRADING_HEDGEROW,
  TRADING_WATERCOURSE,
  ...Object.values(METRIC_SHEETS).map((layout) => layout.sheet)
]

/**
 * The area habitat cumulative surplus: the units left for the Low band once
 * its own losses are offset. The published metric computes it with a known
 * error, which the writer corrects (see corrections.mjs), so a workbook it
 * wrote reports the corrected figure. It is named for that, so nobody
 * mistakes it for the figure the published metric would give.
 */
const CUMULATIVE_SURPLUS_CELL = 'K125'

/**
 * Hidden columns whose "errors" are not about the input, so reporting them
 * would bury the warnings that mean something:
 *
 * - A-1 AH, the "Succession" check, is broken in the published template: it
 *   reads IF(#REF!>0, …), the range it once referred to having been deleted,
 *   so it errors on every filled row.
 * - A-2 AE, "Time to Poor condition", looks up how long the habitat takes to
 *   reach Poor whatever was entered, so any habitat that has no Poor
 *   condition (a sealed surface, say) shows "Not Possible" on a valid row.
 *
 * Both are hidden, so nobody opening the workbook sees them.
 */
const TEMPLATE_DEFECT_COLUMNS = {
  habitatBaseline: new Set(['AH']),
  habitatCreation: new Set(['AE'])
}

// A metric warning carries one of these markers.
const WARNING_MARKERS = ['▲', '⚠', 'Check Data', 'Error']

function loadXlsx() {
  try {
    return require('xlsx')
  } catch {
    throw new Error(
      'Reading metric results needs the optional peer dependency "xlsx" — npm install xlsx'
    )
  }
}

function value(sheet, ref) {
  const v = sheet?.[ref]?.v
  if (v === undefined || v === null) {
    return null
  }
  return typeof v === 'string' ? v.trim() || null : v
}

function isWarning(v) {
  return typeof v === 'string' && WARNING_MARKERS.some((m) => v.includes(m))
}

/**
 * The warning a cell shows, if any: one of the metric's own messages, or a
 * spreadsheet error such as #VALUE! where a formula failed outright.
 */
function warningAt(sheet, ref) {
  const cell = sheet?.[ref]
  if (cell?.t === 'e') {
    return cell.w ?? '#ERROR'
  }
  const v = value(sheet, ref)
  return isWarning(v) ? v : null
}

function byKind(sheet, refs) {
  return Object.fromEntries(
    HABITAT_KINDS.map((k, i) => [k, value(sheet, refs[i])])
  )
}

function readHeadline(sheet) {
  const headline = {}
  for (const [field, refs] of Object.entries(HEADLINE_CELLS)) {
    headline[field] = byKind(sheet, refs)
  }
  headline.target = value(sheet, TARGET_CELL)
  headline.tradingRulesSatisfied = value(sheet, TRADING_RULES_CELL)
  headline.messages = OVERALL_MESSAGE_CELLS.map((ref) =>
    value(sheet, ref)
  ).filter(Boolean)
  return headline
}

function readTrading(workbook) {
  const trading = {}
  for (const [kind, summary] of Object.entries(TRADING_SUMMARIES)) {
    const sheet = workbook.Sheets[summary.sheet]
    trading[kind] = summary.rows.map((row) => ({
      distinctiveness: value(sheet, `B${row}`),
      satisfied: value(sheet, `${summary.verdict}${row}`)
    }))
  }
  return trading
}

const LAST_CELL = /:([A-Z]+)(\d+)$/

/** The last column (as an index) and row of a sheet's used range. */
function extent(sheet) {
  const [, letters, row] = LAST_CELL.exec(sheet?.['!ref'] ?? '') ?? []
  if (!letters) {
    return { lastColumn: -1, lastRow: 0 }
  }
  return { lastColumn: columnIndex(letters) - 1, lastRow: Number(row) }
}

function scanRows(sheet, from, to, visit) {
  const { lastColumn, lastRow } = extent(sheet)
  for (let row = from; row <= Math.min(to, lastRow); row += 1) {
    for (let c = 0; c <= lastColumn; c += 1) {
      const ref = `${columnLetters(c + 1)}${row}`
      const message = warningAt(sheet, ref)
      if (message) {
        visit(row, ref, message)
      }
    }
  }
}

/**
 * Every warning the metric shows on an input sheet. A warning on a data row
 * is keyed to the feature reference the writer put on that row; one in the
 * summary block above the rows applies to the sheet as a whole.
 */
function readWarnings(workbook) {
  const rowWarnings = []
  const sheetWarnings = []
  for (const [key, layout] of Object.entries(METRIC_SHEETS)) {
    const sheet = workbook.Sheets[layout.sheet]
    scanRows(sheet, 1, layout.firstRow - 1, (row, cell, message) => {
      if (cell !== layout.titleCell) {
        sheetWarnings.push({ sheet: key, cell, message })
      }
    })
    const defects = TEMPLATE_DEFECT_COLUMNS[key] ?? new Set()
    scanRows(sheet, layout.firstRow, layout.lastRow, (row, cell, message) => {
      if (defects.has(cell.replace(/\d+$/, ''))) {
        return
      }
      const reference = value(sheet, `${layout.columns.reference}${row}`)
      rowWarnings.push({ sheet: key, row, cell, reference, message })
    })
  }
  return { rowWarnings, sheetWarnings }
}

function loadWorkbook(source) {
  if (!Buffer.isBuffer(source)) {
    return source
  }
  return loadXlsx().read(source, { type: 'buffer' })
}

/**
 * @param {Buffer | { Sheets: object }} source a recalculated workbook: one of
 *   recalculateWorkbooks' results, or the bytes of an .xlsx saved by Excel
 *   or LibreOffice with its values in place
 */
export function readMetricResults(source) {
  const workbook = loadWorkbook(source)
  const headlineSheet = workbook.Sheets[HEADLINE]
  const results = {
    headline: readHeadline(headlineSheet),
    trading: readTrading(workbook),
    corrected: {
      areaCumulativeSurplus: value(
        workbook.Sheets[TRADING_AREA],
        CUMULATIVE_SURPLUS_CELL
      )
    },
    ...readWarnings(workbook)
  }
  // The writer strips every cached value. A baseline figure of nothing at
  // all means the workbook was never recalculated.
  if (results.headline.baselineUnits.area === null) {
    throw new Error(
      'The workbook has no computed results — it has not been recalculated (see recalculateWorkbooks)'
    )
  }
  return results
}
