import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  HDR_CONDITION,
  HDR_DELAY_HABITAT_CREATION,
  HDR_DISTINCTIVENESS,
  HDR_HABITAT_CREATED_IN_ADVANCE,
  HDR_LENGTH_KM,
  HDR_REF,
  SHEETS
} from '../src/workbook/metric-workbook-helpers.mjs'
import { readLinearFeatures } from '../src/workbook/metric-workbook-linear.mjs'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

function workbookFromAoa(sheetName, aoa) {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  return { Sheets: { [sheetName]: ws }, SheetNames: [sheetName] }
}

describe('readLinearFeatures — C-2 / B-2 advance and delay years', () => {
  it('reads Habitat created in advance / delay columns from C-2', () => {
    const sheet = SHEETS.watercoursesCreation
    const headers = [
      HDR_REF,
      'Watercourse type',
      HDR_LENGTH_KM,
      HDR_DISTINCTIVENESS,
      HDR_CONDITION,
      HDR_HABITAT_CREATED_IN_ADVANCE,
      HDR_DELAY_HABITAT_CREATION
    ]
    const wb = workbookFromAoa(sheet, [
      ['C-2 On-Site Watercourse Creation'],
      headers,
      [1, 'Ditches', 0.01, 'Medium', 'Poor', 1, 0],
      [2, 'Ditches', 0.02, 'Medium', 'Moderate', 2, 3]
    ])
    const summary = { skipped: [] }
    const created = readLinearFeatures(wb, sheet, 'river', summary)
    expect(created).toHaveLength(2)
    expect(created[0]).toMatchObject({
      type: 'Ditches',
      advanceYears: 1,
      delayYears: 0
    })
    expect(created[1]).toMatchObject({
      type: 'Ditches',
      advanceYears: 2,
      delayYears: 3
    })
  })

  it('reads the same columns from B-2 created hedgerows', () => {
    const sheet = SHEETS.hedgesCreation
    const headers = [
      HDR_REF,
      'Habitat type',
      HDR_LENGTH_KM,
      HDR_DISTINCTIVENESS,
      HDR_CONDITION,
      HDR_HABITAT_CREATED_IN_ADVANCE,
      HDR_DELAY_HABITAT_CREATION
    ]
    const wb = workbookFromAoa(sheet, [
      ['B-2 On-Site Hedge Creation'],
      headers,
      [1, 'Native hedgerow', 0.05, 'Low', 'Poor', 4, 1]
    ])
    const created = readLinearFeatures(wb, sheet, 'hedge', { skipped: [] })
    expect(created[0]).toMatchObject({
      type: 'Native hedgerow',
      advanceYears: 4,
      delayYears: 1
    })
  })

  it('defaults advance and delay years to 0 on C-1 (no timing columns)', () => {
    const sheet = SHEETS.watercoursesBaseline
    const headers = [
      HDR_REF,
      'Watercourse type',
      HDR_LENGTH_KM,
      HDR_DISTINCTIVENESS,
      HDR_CONDITION
    ]
    const wb = workbookFromAoa(sheet, [
      ['C-1 On-Site Watercourse Baseline'],
      headers,
      [1, 'Ditches', 0.1, 'Medium', 'Poor']
    ])
    const baseline = readLinearFeatures(
      wb,
      sheet,
      'river',
      { skipped: [] },
      {
        withFate: true
      }
    )
    expect(baseline[0]).toMatchObject({
      type: 'Ditches',
      advanceYears: 0,
      delayYears: 0
    })
  })
})
