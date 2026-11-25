import { describe, expect, it } from 'vitest'
import { readFeatureUnits } from '../src/workbook-writer/read-figures.mjs'
import { readMetricResults } from '../src/workbook-writer/read-results.mjs'
import {
  METRIC_SHEETS,
  PINNED_LAST_ROWS,
  LAYOUT_LAST_ROWS,
  capacity,
  inputLastRows,
  workbookLastRows
} from '../src/workbook-writer/template-layout.mjs'

const BASELINE = METRIC_SHEETS.habitatBaseline
// Rows the 1.1.1 sheets hold that earlier releases' did not.
const NEW_ROW = 300
const ROWS_FROM_1_1_0 = 350

/**
 * The habitat baseline sheet's row numbers as a release lays them out: 1 on
 * the first data row up to the last, then a totals row with none.
 */
function numberedRows(lastRow) {
  const cells = {}
  for (let row = BASELINE.firstRow; row <= lastRow; row += 1) {
    cells[`D${row}`] = { t: 'n', v: row - BASELINE.firstRow + 1 }
  }
  cells[`F${lastRow + 1}`] = { t: 's', v: 'Total habitat area ' }
  return cells
}

function workbookOf(lastRow, extra = {}) {
  return {
    Sheets: { [BASELINE.sheet]: { ...numberedRows(lastRow), ...extra } }
  }
}

const cellOf = (workbook) => (sheet, ref) => workbook.Sheets[sheet]?.[ref]?.v

describe('the input rows of each metric release', () => {
  it('gives every 1.1.1 sheet 350 data rows', () => {
    for (const key of Object.keys(METRIC_SHEETS)) {
      expect(capacity(key), key).toBe(ROWS_FROM_1_1_0)
      expect(capacity(key, LAYOUT_LAST_ROWS['from 1.1.0']), key).toBe(
        ROWS_FROM_1_1_0
      )
    }
  })

  it('keeps the fewer rows of releases before 1.1.0, ending before their totals rows', () => {
    expect(capacity('habitatBaseline', LAYOUT_LAST_ROWS['before 1.1.0'])).toBe(
      248
    )
    expect(capacity('habitatCreation', LAYOUT_LAST_ROWS['before 1.1.0'])).toBe(
      246
    )
  })

  it.each([
    ['from 1.1.0', PINNED_LAST_ROWS.habitatBaseline],
    ['before 1.1.0', LAYOUT_LAST_ROWS['before 1.1.0'].habitatBaseline]
  ])('tells a workbook laid out %s by its numbered rows', (layout, lastRow) => {
    const found = inputLastRows(cellOf(workbookOf(lastRow)))
    expect(found.layout).toBe(layout)
    expect(found.lastRows).toBe(LAYOUT_LAST_ROWS[layout])
  })

  it('reads numbers stored as text, as a template’s raw cells hold them', () => {
    const text = (sheet, ref) => {
      const v = cellOf(workbookOf(PINNED_LAST_ROWS.habitatBaseline))(sheet, ref)
      return v === undefined ? null : String(v)
    }
    expect(inputLastRows(text).layout).toBe('from 1.1.0')
  })

  it('knows no release whose rows end anywhere else', () => {
    expect(inputLastRows(cellOf(workbookOf(300)))).toBeNull()
    expect(inputLastRows(cellOf({ Sheets: {} }))).toBeNull()
  })

  it('reads a workbook with no row numbers as the pinned release', () => {
    expect(workbookLastRows({ Sheets: {} })).toBe(PINNED_LAST_ROWS)
  })
})

describe('reading features by the workbook’s own rows', () => {
  it('reads a 1.1.1 feature on a row earlier releases did not have', () => {
    const workbook = workbookOf(PINNED_LAST_ROWS.habitatBaseline, {
      [`AB${NEW_ROW}`]: { t: 's', v: 'H300' },
      [`Q${NEW_ROW}`]: { t: 'n', v: 4 }
    })
    const features = readFeatureUnits(workbook)
    expect(features.map((f) => [f.reference, f.cell])).toContainEqual([
      'H300',
      `Q${NEW_ROW}`
    ])
  })

  it('reads an earlier workbook only up to its last data row, never its totals', () => {
    const lastRow = LAYOUT_LAST_ROWS['before 1.1.0'].habitatBaseline
    const workbook = workbookOf(lastRow, {
      // A reference typed beside the totals is not a feature.
      [`AB${lastRow + 1}`]: { t: 's', v: 'not a feature' },
      [`Q${lastRow + 1}`]: { t: 'n', v: 459.8 }
    })
    expect(readFeatureUnits(workbook)).toEqual([])
  })
})

const WARNING = '▲ Check Data'
const WARNING_COLUMN = 'C'
const UNITS_COLUMN = 'Q'

/**
 * A recalculated workbook laid out as a release: the habitat baseline sheet
 * numbered to its last row, a feature with a warning on that row and,
 * straight after, a totals row carrying a warning of its own.
 */
function recalculated(lastRow, extra = {}) {
  const { reference } = BASELINE.columns
  const totals = lastRow + 1
  const cells = {
    ...numberedRows(lastRow),
    [`${reference}${lastRow}`]: { t: 's', v: 'H-last' },
    [`${UNITS_COLUMN}${lastRow}`]: { t: 'n', v: 2 },
    [`${WARNING_COLUMN}${lastRow}`]: { t: 's', v: WARNING },
    [`${reference}${totals}`]: { t: 's', v: 'totals' },
    [`${WARNING_COLUMN}${totals}`]: { t: 's', v: WARNING },
    ...extra
  }
  cells['!ref'] = `A1:AZ${totals}`
  return {
    Sheets: {
      'Headline Results': { H8: { t: 'n', v: 1 }, '!ref': 'A1:K20' },
      [BASELINE.sheet]: cells
    }
  }
}

describe.each(Object.entries(LAYOUT_LAST_ROWS))(
  'reading a recalculated %s workbook',
  (layout, lastRows) => {
    const lastRow = lastRows.habitatBaseline
    const results = readMetricResults(recalculated(lastRow))
    const baselineWarnings = results.rowWarnings.filter(
      (w) => w.sheet === 'habitatBaseline'
    )

    it('reads the warning and the feature on its last data row', () => {
      expect(baselineWarnings).toContainEqual(
        expect.objectContaining({ row: lastRow, reference: 'H-last' })
      )
      expect(results.features.map((f) => f.reference)).toContain('H-last')
    })

    it('never takes a warning past its last data row for a feature’s', () => {
      expect(baselineWarnings.map((w) => w.row)).not.toContain(lastRow + 1)
      expect(results.features.map((f) => f.reference)).not.toContain('totals')
    })
  }
)

it('reads a warning on a 1.1.1 row that earlier releases did not have', () => {
  const results = readMetricResults(
    recalculated(PINNED_LAST_ROWS.habitatBaseline, {
      [`${BASELINE.columns.reference}${NEW_ROW}`]: { t: 's', v: 'H300' },
      [`${WARNING_COLUMN}${NEW_ROW}`]: { t: 's', v: WARNING }
    })
  )
  expect(results.rowWarnings).toContainEqual(
    expect.objectContaining({ row: NEW_ROW, reference: 'H300' })
  )
})
