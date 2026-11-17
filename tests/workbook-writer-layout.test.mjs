import { describe, expect, it } from 'vitest'
import { readFeatureUnits } from '../src/workbook-writer/read-figures.mjs'
import {
  METRIC_SHEETS,
  PINNED_LAST_ROWS,
  RELEASE_LAST_ROWS,
  capacity,
  inputLastRows,
  workbookLastRows
} from '../src/workbook-writer/template-layout.mjs'

const BASELINE = METRIC_SHEETS.habitatBaseline
// Rows the 1.1.1 sheets hold that 1.0.4's did not.
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
      expect(capacity(key, RELEASE_LAST_ROWS['1.1.1']), key).toBe(
        ROWS_FROM_1_1_0
      )
    }
  })

  it('keeps 1.0.4’s fewer rows, ending before its totals rows', () => {
    expect(capacity('habitatBaseline', RELEASE_LAST_ROWS['1.0.4'])).toBe(248)
    expect(capacity('habitatCreation', RELEASE_LAST_ROWS['1.0.4'])).toBe(246)
  })

  it.each([
    ['1.1.1', PINNED_LAST_ROWS.habitatBaseline],
    ['1.0.4', RELEASE_LAST_ROWS['1.0.4'].habitatBaseline]
  ])('tells a %s workbook by its numbered rows', (release, lastRow) => {
    const found = inputLastRows(cellOf(workbookOf(lastRow)))
    expect(found.release).toBe(release)
    expect(found.lastRows).toBe(RELEASE_LAST_ROWS[release])
  })

  it('reads numbers stored as text, as a template’s raw cells hold them', () => {
    const text = (sheet, ref) => {
      const v = cellOf(workbookOf(PINNED_LAST_ROWS.habitatBaseline))(sheet, ref)
      return v === undefined ? null : String(v)
    }
    expect(inputLastRows(text).release).toBe('1.1.1')
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
  it('reads a 1.1.1 feature on a row 1.0.4 did not have', () => {
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

  it('reads a 1.0.4 workbook only up to its last data row, never its totals', () => {
    const lastRow = RELEASE_LAST_ROWS['1.0.4'].habitatBaseline
    const workbook = workbookOf(lastRow, {
      // A reference typed beside the totals is not a feature.
      [`AB${lastRow + 1}`]: { t: 's', v: 'not a feature' },
      [`Q${lastRow + 1}`]: { t: 'n', v: 459.8 }
    })
    expect(readFeatureUnits(workbook)).toEqual([])
  })
})
