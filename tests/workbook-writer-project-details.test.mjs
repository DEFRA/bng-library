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

  it('writes a YYYY-MM-DD day as that day, whatever the time zone', () => {
    const workbook = write(template, { completionDate: '2024-01-01' })
    expect(Number(workbook.text(START, cells.completionDate))).toBe(
      NEW_YEAR_2024
    )
  })

  it('takes a Date as its UTC day, which in British Summer Time can be the local day before', () => {
    // new Date(2024, 5, 1) built in London is this instant: 1 June locally,
    // 31 May in UTC. 1 June 2024 is day 45444, so 31 May is 45443.
    const workbook = write(template, {
      completionDate: new Date('2024-05-31T23:00:00Z')
    })
    expect(Number(workbook.text(START, cells.completionDate))).toBe(45443)
  })

  it.each([['01/06/2024'], ['2024-6-1'], ['2024-13-01'], [45444]])(
    'refuses a completion date of %j',
    (completionDate) => {
      expect(() => write(template, { completionDate })).toThrow(
        'completionDate must be a Date or a YYYY-MM-DD day'
      )
    }
  )

  it('leaves a detail it is not given, null or undefined as the template has it', () => {
    const filledIn = syntheticMetricTemplate(PINNED_LAST_ROWS, {
      start: {
        [cells.applicant]: 'Existing applicant',
        [cells.applicationType]: 'Existing type',
        [cells.completedBy]: 'Existing completer'
      }
    })
    const workbook = write(filledIn, {
      projectName: 'Riverside Farm',
      applicant: null,
      applicationType: undefined
    })
    expect(workbook.text(START, cells.projectName)).toBe('Riverside Farm')
    expect(workbook.text(START, cells.applicant)).toBe('Existing applicant')
    expect(workbook.text(START, cells.applicationType)).toBe('Existing type')
    expect(workbook.text(START, cells.completedBy)).toBe('Existing completer')
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
