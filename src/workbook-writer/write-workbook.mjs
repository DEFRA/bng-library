/**
 * Write workbook rows into a copy of the metric template.
 *
 * Only input cells are written, and the metric's formulas are left as Defra
 * wrote them, so the recalculated workbook's answers are the metric's own —
 * comparing the service to them tests the service, not our agreement with
 * ourselves. The one exception is the metric's known bugs, each corrected in
 * the formula that makes it (see corrections.mjs).
 */

import { METRIC_CORRECTIONS, applyCorrections } from './corrections.mjs'
import { MetricTemplate } from './metric-template.mjs'
import {
  ENHANCEMENT_OF,
  METRIC_SHEETS,
  PROJECT_DETAILS,
  capacity,
  inputLastRows
} from './template-layout.mjs'

const MS_PER_DAY = 86_400_000
// Day 0 of Excel's 1900 date system, as its serial numbers count it.
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)

function assertLayout(template, layouts) {
  const mismatches = template.layoutMismatches(layouts)
  if (mismatches.length > 0) {
    const detail = mismatches
      .map(
        (m) =>
          `${m.sheet}!${m.ref}: expected "${m.expected}", found "${m.actual}"`
      )
      .join('; ')
    throw new Error(
      `The workbook is not laid out as a Statutory Biodiversity Metric v4 template: ${detail}`
    )
  }
}

/**
 * The last data row of each sheet, from the template's own layout, so a
 * template from before 1.1.0 is filled and cleared only up to its own rows.
 */
function templateLastRows(template) {
  const found = inputLastRows((sheet, ref) => template.text(sheet, ref))
  if (!found) {
    throw new Error(
      `The workbook's ${METRIC_SHEETS.habitatBaseline.sheet} rows are not numbered as any Statutory Biodiversity Metric release this writer knows lays them out`
    )
  }
  return found.lastRows
}

function assertFits(rows, lastRows) {
  for (const [key, sheetRows] of Object.entries(rows)) {
    if (!METRIC_SHEETS[key]) {
      throw new Error(`Unknown workbook sheet key: ${key}`)
    }
    const holds = capacity(key, lastRows)
    if (sheetRows.length > holds) {
      throw new Error(
        `${METRIC_SHEETS[key].sheet} holds ${holds} rows; ${sheetRows.length} were given`
      )
    }
  }
}

/**
 * The enhancement sheets pair their rows with the enhanced baseline rows by
 * position, so the counts must agree or every row after the first gap would
 * describe the wrong feature.
 */
function assertEnhancementsPaired(rows) {
  for (const [enhancementKey, baselineKey] of Object.entries(ENHANCEMENT_OF)) {
    const enhanced = (rows[baselineKey] ?? []).filter((r) => r.enhanced > 0)
    const enhancements = rows[enhancementKey] ?? []
    if (enhanced.length !== enhancements.length) {
      throw new Error(
        `${METRIC_SHEETS[enhancementKey].sheet}: ${enhancements.length} rows for ${enhanced.length} enhanced baseline rows`
      )
    }
  }
}

function overridable(layout, field) {
  return layout.overridesFormula?.includes(field) ?? false
}

/**
 * Empty every input cell. A default formula is left in place: it is what a
 * blank template holds there, and it yields nothing on an empty row.
 */
function clearInputs(template, lastRows) {
  for (const [key, layout] of Object.entries(METRIC_SHEETS)) {
    const sheet = template.sheet(layout.sheet)
    for (let row = layout.firstRow; row <= lastRows[key]; row += 1) {
      for (const [field, column] of Object.entries(layout.columns)) {
        const ref = `${column}${row}`
        if (!(overridable(layout, field) && sheet.cell(ref)?.formula)) {
          sheet.clearValue(ref)
        }
      }
    }
  }
}

function writeRows(template, key, sheetRows) {
  const layout = METRIC_SHEETS[key]
  const sheet = template.sheet(layout.sheet)
  sheetRows.forEach((row, i) => {
    const rowNumber = layout.firstRow + i
    for (const [field, column] of Object.entries(layout.columns)) {
      if (row[field] === undefined) {
        continue
      }
      const ref = `${column}${rowNumber}`
      if (overridable(layout, field)) {
        sheet.overrideFormula(ref, row[field])
      } else {
        sheet.setValue(ref, row[field])
      }
    }
  })
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * A day as the serial day number Excel holds in a date-formatted cell.
 *
 * A `YYYY-MM-DD` string is that day, with no time zone to get wrong. A Date
 * is its UTC day: `new Date(2024, 5, 1)` built in London during British
 * Summer Time is 23:00 UTC on 31 May, and is written as 31 May. A caller
 * with a local day in mind passes it as a string.
 */
function excelDate(day) {
  // Date parses a bare YYYY-MM-DD as UTC midnight of that day.
  const date = typeof day === 'string' ? new Date(day) : day
  const utcDay = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  )
  return (utcDay - EXCEL_EPOCH_MS) / MS_PER_DAY
}

/** completionDate is a date however it is given; any other detail, if a Date. */
function isDateDetail(field, value) {
  if (field !== 'completionDate') {
    return value instanceof Date
  }
  const isDay =
    value instanceof Date ||
    (typeof value === 'string' &&
      ISO_DAY.test(value) &&
      !isNaN(new Date(value)))
  if (!isDay) {
    throw new Error(
      `completionDate must be a Date or a YYYY-MM-DD day, not ${JSON.stringify(value)}`
    )
  }
  return true
}

function assertKnownDetails(details) {
  for (const field of Object.keys(details)) {
    if (!Object.hasOwn(PROJECT_DETAILS.cells, field)) {
      throw new Error(`Unknown project detail: ${field}`)
    }
  }
}

/**
 * Fill the Start sheet's project details. A detail left out, or null, leaves
 * its cell as the template has it, for the user to fill in.
 */
function writeDetails(template, details) {
  const sheet = template.sheet(PROJECT_DETAILS.sheet)
  for (const [field, value] of Object.entries(details)) {
    if (value === undefined || value === null) {
      continue
    }
    sheet.setValue(
      PROJECT_DETAILS.cells[field],
      isDateDetail(field, value) ? excelDate(value) : value
    )
  }
}

/**
 * @param {object} options
 * @param {Buffer} options.templateBuffer a Statutory Biodiversity Metric v4
 *   workbook; any rows it already holds are cleared first
 * @param {Record<string, object[]>} options.rows keyed as METRIC_SHEETS
 * @param {readonly object[]} [options.corrections] the known bugs to correct;
 *   every one by default, and `[]` for the metric exactly as published
 * @param {Partial<Record<keyof typeof PROJECT_DETAILS.cells, string | number | Date | null>>} [options.details]
 *   the Start sheet's project details, keyed as PROJECT_DETAILS.cells; a
 *   date is written as its day, as the date-formatted cell expects. Pass
 *   `completionDate` as a `YYYY-MM-DD` string for a local day: a Date is
 *   taken as its UTC calendar day, which in British Summer Time can be the
 *   day before the local one
 * @returns {Buffer} the new workbook, with every formula's cached value
 *   removed so it must be recalculated before its answers can be read
 */
export function writeMetricWorkbook({
  templateBuffer,
  rows,
  corrections = METRIC_CORRECTIONS,
  details
}) {
  const template = new MetricTemplate(templateBuffer)
  const layouts = Object.values(METRIC_SHEETS)
  assertLayout(template, details ? [...layouts, PROJECT_DETAILS] : layouts)
  if (details) {
    assertKnownDetails(details)
  }
  const lastRows = templateLastRows(template)
  assertFits(rows, lastRows)
  assertEnhancementsPaired(rows)
  clearInputs(template, lastRows)
  applyCorrections(template, corrections)
  for (const [key, sheetRows] of Object.entries(rows)) {
    writeRows(template, key, sheetRows)
  }
  if (details) {
    writeDetails(template, details)
  }
  template.stripCachedValues()
  template.setFullCalcOnLoad()
  return template.toBuffer()
}
