import { describe, expect, it } from 'vitest'
import { MetricTemplate } from '../src/workbook-writer/metric-template.mjs'
import {
  ENHANCEMENT_OF,
  METRIC_SHEETS,
  RELEASE_LAST_ROWS,
  capacity
} from '../src/workbook-writer/template-layout.mjs'
import { writeMetricWorkbook } from '../src/workbook-writer/write-workbook.mjs'
import {
  syntheticMetricTemplate,
  totalsFormula
} from './synthetic-metric-template.mjs'

const SHEET_KEYS = Object.keys(METRIC_SHEETS)
const LEFT_OVER = 'left over'

/**
 * `count` rows for one sheet, each with its own reference. An enhancement
 * sheet's rows pair with enhanced baseline rows, so those come too, after it,
 * so that a sheet over its capacity is the one the writer names.
 */
function rowsFor(key, count) {
  const rows = {
    [key]: Array.from({ length: count }, (_, i) => ({ reference: `R${i + 1}` }))
  }
  const baseline = ENHANCEMENT_OF[key]
  if (baseline) {
    rows[baseline] = Array.from({ length: count }, (_, i) => ({
      reference: `B${i + 1}`,
      enhanced: 1
    }))
  }
  return rows
}

function write(templateBuffer, rows) {
  return new MetricTemplate(
    writeMetricWorkbook({ templateBuffer, rows, corrections: [] })
  )
}

/** The totals row after a sheet's last data row is as the template had it. */
function expectTotalsKept(workbook, key, lastRow) {
  const { sheet, firstRow, columns } = METRIC_SHEETS[key]
  for (const column of new Set(Object.values(columns))) {
    const cell = workbook.sheet(sheet).cell(`${column}${lastRow + 1}`)
    expect(cell?.formula, `${sheet}!${column}${lastRow + 1}`).toBe(true)
    expect(workbook.sheet(sheet).formula(`${column}${lastRow + 1}`)).toBe(
      totalsFormula(column, firstRow, lastRow)
    )
  }
}

describe.each(Object.entries(RELEASE_LAST_ROWS))(
  'writing a workbook laid out as %s',
  (release, lastRows) => {
    const template = syntheticMetricTemplate(lastRows)

    it.each(SHEET_KEYS)(
      'fills %s to its last data row, and keeps its totals',
      (key) => {
        const count = capacity(key, lastRows)
        const workbook = write(template, rowsFor(key, count))
        const { sheet, columns } = METRIC_SHEETS[key]
        expect(
          workbook.text(sheet, `${columns.reference}${lastRows[key]}`)
        ).toBe(`R${count}`)
        expectTotalsKept(workbook, key, lastRows[key])
      }
    )

    it.each(SHEET_KEYS)('refuses one row more than %s holds', (key) => {
      const count = capacity(key, lastRows)
      expect(() => write(template, rowsFor(key, count + 1))).toThrow(
        `${METRIC_SHEETS[key].sheet} holds ${count} rows; ${count + 1} were given`
      )
    })

    it('clears an input left on every sheet’s last data row, and keeps the totals', () => {
      const inputs = Object.fromEntries(
        SHEET_KEYS.map((key) => [
          key,
          {
            [`${METRIC_SHEETS[key].columns.reference}${lastRows[key]}`]:
              LEFT_OVER
          }
        ])
      )
      const workbook = write(syntheticMetricTemplate(lastRows, inputs), {})
      for (const key of SHEET_KEYS) {
        const { sheet, columns } = METRIC_SHEETS[key]
        expect(
          workbook.text(sheet, `${columns.reference}${lastRows[key]}`),
          `${release} ${sheet}`
        ).toBeNull()
        expectTotalsKept(workbook, key, lastRows[key])
      }
    })
  }
)

describe('a workbook laid out as no release the writer knows', () => {
  it('is refused before anything is written', () => {
    const odd = Object.fromEntries(
      SHEET_KEYS.map((key) => [key, METRIC_SHEETS[key].firstRow + 99])
    )
    expect(() => write(syntheticMetricTemplate(odd), {})).toThrow(
      /not numbered as any Statutory Biodiversity Metric release/
    )
  })
})
