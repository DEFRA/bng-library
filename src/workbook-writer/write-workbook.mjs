/**
 * Write workbook rows into a copy of the metric template.
 *
 * Only input cells are written. The metric's formulas are left exactly as
 * Defra wrote them, so the recalculated workbook's answers are the metric's
 * own — comparing the service to them tests the service, not our agreement
 * with ourselves.
 */

import { MetricTemplate } from './metric-template.mjs'
import { ENHANCEMENT_OF, METRIC_SHEETS, capacity } from './template-layout.mjs'

function assertLayout(template) {
  const mismatches = template.layoutMismatches()
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

function assertFits(rows) {
  for (const [key, sheetRows] of Object.entries(rows)) {
    if (!METRIC_SHEETS[key]) {
      throw new Error(`Unknown workbook sheet key: ${key}`)
    }
    if (sheetRows.length > capacity(key)) {
      throw new Error(
        `${METRIC_SHEETS[key].sheet} holds ${capacity(key)} rows; ${sheetRows.length} were given`
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
function clearInputs(template) {
  for (const layout of Object.values(METRIC_SHEETS)) {
    const sheet = template.sheet(layout.sheet)
    for (let row = layout.firstRow; row <= layout.lastRow; row += 1) {
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

/**
 * @param {object} options
 * @param {Buffer} options.templateBuffer a Statutory Biodiversity Metric v4
 *   workbook; any rows it already holds are cleared first
 * @param {Record<string, object[]>} options.rows keyed as METRIC_SHEETS
 * @returns {Buffer} the new workbook, with every formula's cached value
 *   removed so it must be recalculated before its answers can be read
 */
export function writeMetricWorkbook({ templateBuffer, rows }) {
  const template = new MetricTemplate(templateBuffer)
  assertLayout(template)
  assertFits(rows)
  assertEnhancementsPaired(rows)
  clearInputs(template)
  for (const [key, sheetRows] of Object.entries(rows)) {
    writeRows(template, key, sheetRows)
  }
  template.stripCachedValues()
  template.setFullCalcOnLoad()
  return template.toBuffer()
}
