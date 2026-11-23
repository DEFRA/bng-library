import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MetricTemplate } from '../src/workbook-writer/metric-template.mjs'
import {
  PINNED_LAST_ROWS,
  PROJECT_DETAILS
} from '../src/workbook-writer/template-layout.mjs'
import { writeMetricWorkbook } from '../src/workbook-writer/write-workbook.mjs'
import { syntheticMetricTemplate } from './synthetic-metric-template.mjs'

const { sheet: START, cells } = PROJECT_DETAILS
// 1 January 2024 is day 45292 in Excel's 1900 date system.
const NEW_YEAR_2024 = 45292

const DETAILS = {
  planningAuthority: 'Riverside District Council',
  projectName: 'Riverside Farm',
  applicant: 'Riverside Homes Ltd',
  applicationType: 'Outline',
  planningApplicationReference: 'RDC/24/0001'
}

function write(templateBuffer, details) {
  return new MetricTemplate(
    writeMetricWorkbook({ templateBuffer, rows: {}, corrections: [], details })
  )
}

describe('writing the project details onto the Start sheet', () => {
  const template = syntheticMetricTemplate(PINNED_LAST_ROWS)

  it('puts each detail in the cell beside its label', () => {
    const workbook = write(template, DETAILS)
    for (const [field, value] of Object.entries(DETAILS)) {
      expect(workbook.text(START, cells[field]), field).toBe(value)
    }
  })

  it('writes a date as the day Excel counts it, without its time', () => {
    const workbook = write(template, {
      completionDate: new Date('2024-01-01T15:30:00Z')
    })
    expect(Number(workbook.text(START, cells.completionDate))).toBe(
      NEW_YEAR_2024
    )
  })

  it('leaves a detail it is not given as the template has it', () => {
    const workbook = write(template, {
      projectName: 'Riverside Farm',
      applicant: null
    })
    expect(workbook.text(START, cells.applicant)).toBeNull()
    expect(workbook.text(START, cells.completedBy)).toBeNull()
  })

  it('refuses a detail it has no cell for', () => {
    expect(() => write(template, { gridReference: 'SU 123 456' })).toThrow(
      'Unknown project detail: gridReference'
    )
  })

  it('refuses to write details onto a Start sheet laid out otherwise', () => {
    const moved = syntheticMetricTemplate(PINNED_LAST_ROWS, {
      start: { D12: 'Applicant:' }
    })
    expect(() => write(moved, DETAILS)).toThrow(
      'Start!D12: expected "Project name:", found "Applicant:"'
    )
  })

  it('does not look at the Start sheet when given no details', () => {
    const moved = syntheticMetricTemplate(PINNED_LAST_ROWS, {
      start: { D12: 'Applicant:' }
    })
    expect(() => write(moved, undefined)).not.toThrow()
  })
})

const TEMPLATE = process.env.METRIC_TEMPLATE

describe.skipIf(!TEMPLATE || !existsSync(TEMPLATE))(
  'writing the project details into the real metric template',
  () => {
    it('finds the Start sheet laid out as PROJECT_DETAILS expects', () => {
      const workbook = write(readFileSync(TEMPLATE), DETAILS)
      expect(workbook.text(START, cells.projectName)).toBe(DETAILS.projectName)
    })
  }
)
