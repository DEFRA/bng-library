import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openGeoPackageReadonly, wkbToGeoJSON } from '../src/gpkg-io/index.mjs'
import { polygonAreaSqm } from '../src/gpkg-io/src/read.mjs'
import { generateOne, setMode } from '../index.mjs'
import { workbookRowsFromGeoPackage } from '../src/workbook-writer/gpkg-rows.mjs'
import { checkVocabulary } from '../src/workbook-writer/template-vocabulary.mjs'
import { checkScenarioExpectations } from '../src/workbook-writer/expectations.mjs'

const CENTRE = [530000, 180000]
const SS = 'Area/compensation not in local strategy/ no local strategy'
const MEDIUM = 'Grassland - Other neutral grassland'
const LOW = 'Grassland - Modified grassland'
const SQ_METRES_PER_HECTARE = 10_000

const parcel = (o) => ({
  habitatFullName: MEDIUM,
  baselineCondition: 'Moderate',
  baselineStrategicSignificance: SS,
  proposedStrategicSignificance: SS,
  ...o
})

const hedge = (o) => ({
  hedgeType: 'Native hedgerow',
  baselineCondition: 'Good',
  proposedCondition: 'Good',
  baselineStrategicSignificance: SS,
  proposedStrategicSignificance: SS,
  ...o
})

describe('workbookRowsFromGeoPackage', () => {
  let dir
  let rows
  let habitatAreas

  beforeAll(() => {
    setMode('silent')
    dir = mkdtempSync(path.join(tmpdir(), 'bng-wb-rows-'))
    const pi = path.join(dir, 'pi.gpkg')
    generateOne(pi, CENTRE, {
      numParcels: 4,
      seed: 3,
      emptyLayers: new Set(['trees']),
      attributeOverrides: {
        habitats: [
          parcel({ retention: 'Retained' }),
          parcel({
            retention: 'Enhanced',
            proposedHabitatFullName: MEDIUM,
            proposedCondition: 'Good'
          }),
          parcel({
            retention: 'Created',
            proposedHabitatFullName: LOW,
            proposedCondition: 'Good',
            advanceYears: '2'
          }),
          parcel({
            retention: 'Enhanced',
            proposedHabitatFullName: MEDIUM,
            proposedCondition: 'Good'
          })
        ],
        hedgerows: [
          hedge({ retention: 'Retained' }),
          hedge({ retention: 'Lost' }),
          hedge({ retention: 'Created', delayYears: '1' })
        ],
        rivers: [
          {
            riverType: 'Ditches',
            retention: 'Retained',
            baselineCondition: 'Moderate',
            proposedCondition: 'Moderate',
            baselineStrategicSignificance: SS,
            proposedStrategicSignificance: SS,
            baselineWaterEncroachment: 'Minor',
            proposedWaterEncroachment: 'Minor',
            baselineRiparianEncroachment: 'Minor/No Encroachment',
            proposedRiparianEncroachment: 'Minor/No Encroachment'
          }
        ]
      }
    })
    rows = workbookRowsFromGeoPackage(pi).rows
    const db = openGeoPackageReadonly(pi)
    habitatAreas = db
      .prepare('SELECT geom FROM "Habitats" ORDER BY rowid')
      .all()
      .map((r) => polygonAreaSqm(wkbToGeoJSON(r.geom)) / SQ_METRES_PER_HECTARE)
    db.close()
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('puts every area parcel on the baseline sheet, sized from its geometry', () => {
    expect(rows.habitatBaseline.map((r) => r.reference)).toEqual([
      'H001',
      'H002',
      'H003',
      'H004'
    ])
    expect(rows.habitatBaseline.map((r) => r.size)).toEqual(habitatAreas)
  })

  it('retains, enhances and loses whole parcels', () => {
    const [retained, enhanced, lost] = rows.habitatBaseline
    expect(retained.retained).toBe(retained.size)
    expect(enhanced.enhanced).toBe(enhanced.size)
    expect(lost.retained).toBeUndefined()
    expect(lost.enhanced).toBeUndefined()
  })

  it('pairs each enhancement row with its enhanced baseline row, in order', () => {
    expect(rows.habitatEnhancement.map((r) => r.reference)).toEqual([
      'H002',
      'H004'
    ])
    expect(rows.habitatEnhancement[0].condition).toBe('Good')
  })

  it('creates a lost area parcel’s proposed habitat on the same land', () => {
    expect(rows.habitatCreation).toHaveLength(1)
    const [created] = rows.habitatCreation
    expect(created.reference).toBe('H003')
    expect(created.habitatType).toBe('Modified grassland')
    expect(created.size).toBe(habitatAreas[2])
    expect(created.advanceYears).toBe(2)
  })

  it('keeps a created hedgerow off the baseline, and a lost one on it', () => {
    expect(rows.hedgerowBaseline.map((r) => r.reference)).toEqual([
      'HG001',
      'HG002'
    ])
    expect(rows.hedgerowCreation.map((r) => r.reference)).toEqual(['HG003'])
    expect(rows.hedgerowCreation[0].delayYears).toBe(1)
    expect(rows.hedgerowBaseline[0].size).toBeGreaterThan(0)
  })

  it('writes riparian encroachment the way the workbook spells it', () => {
    expect(rows.watercourseBaseline[0].riparianEncroachment).toBe(
      'Minor/ No Encroachment'
    )
    expect(rows.watercourseBaseline[0].watercourseEncroachment).toBe('Minor')
  })
})

describe('checkVocabulary', () => {
  const vocabulary = {
    broadHabitats: ['Grassland'],
    habitatTypes: { Grassland: ['Modified grassland'] },
    habitatConditions: {
      'Grassland - Modified grassland': ['Good', 'Moderate', 'Poor']
    },
    strategicSignificance: [SS],
    years: ['0', '1', '30+'],
    irreplaceable: ['Yes', 'No'],
    hedgeTypes: [],
    hedgeConditions: {},
    watercourseTypes: ['Ditches', 'Culvert'],
    enhanceableWatercourseTypes: ['Ditches'],
    watercourseStrategicSignificance: [SS],
    watercourseConditions: { ditches: ['Good'], Culvert: ['Poor'] },
    watercourseEncroachment: { culvert: ['N/A - Culvert'], other: ['Minor'] },
    riparianEncroachment: {
      culvert: ['N/A - Culvert'],
      other: ['Minor/ Minor']
    }
  }
  const areaRow = {
    reference: 'H001',
    broadHabitat: 'Grassland',
    habitatType: 'Modified grassland',
    irreplaceable: 'No',
    size: 1,
    condition: 'Good',
    strategicSignificance: SS
  }

  it('accepts values on the workbook’s lists, ignoring case as its lookups do', () => {
    expect(
      checkVocabulary(
        {
          habitatBaseline: [{ ...areaRow, habitatType: 'modified GRASSLAND' }],
          watercourseBaseline: [
            {
              reference: 'R001',
              habitatType: 'Ditches',
              size: 0.1,
              condition: 'Good',
              strategicSignificance: SS,
              watercourseEncroachment: 'Minor',
              riparianEncroachment: 'Minor/ Minor'
            }
          ]
        },
        vocabulary
      )
    ).toEqual([])
  })

  it('reports values off the list, missing values and bad sizes', () => {
    const issues = checkVocabulary(
      {
        habitatBaseline: [
          {
            ...areaRow,
            condition: 'Fairly Good',
            strategicSignificance: null,
            size: 0
          }
        ]
      },
      vocabulary
    )
    expect(issues.map((i) => [i.field, i.problem])).toEqual([
      ['size', 'not-positive'],
      ['condition', 'not-in-list'],
      ['strategicSignificance', 'missing']
    ])
    expect(issues[1].reference).toBe('H001')
  })

  it('is sensitive to spacing, which the metric’s lookups are too', () => {
    const issues = checkVocabulary(
      {
        habitatBaseline: [
          {
            ...areaRow,
            strategicSignificance:
              'Area/compensation not in local strategy/no local strategy'
          }
        ]
      },
      vocabulary
    )
    expect(issues.map((i) => i.field)).toEqual(['strategicSignificance'])
  })

  it('does not offer a culvert for enhancement', () => {
    const issues = checkVocabulary(
      {
        watercourseEnhancement: [
          {
            reference: 'R001',
            habitatType: 'Culvert',
            condition: 'Poor',
            strategicSignificance: SS,
            watercourseEncroachment: 'N/A - Culvert',
            riparianEncroachment: 'N/A - Culvert',
            advanceYears: 0,
            delayYears: 0
          }
        ]
      },
      vocabulary
    )
    expect(issues.map((i) => i.field)).toEqual(['habitatType'])
  })
})

describe('checkScenarioExpectations', () => {
  const results = {
    headline: { netPercentChange: { area: 0.12 }, target: 0.1 },
    trading: {
      area: [
        { distinctiveness: 'Medium', satisfied: 'No ▲' },
        { distinctiveness: 'Low', satisfied: 'Yes ✓' }
      ]
    },
    rowWarnings: [
      {
        sheet: 'habitatEnhancement',
        cell: 'U12',
        reference: 'H001',
        message: 'Error - Can not reduce condition ▲'
      },
      {
        sheet: 'habitatEnhancement',
        cell: 'U13',
        reference: 'H002',
        message: 'Error - No enhancement ▲'
      }
    ],
    sheetWarnings: []
  }
  const subject = { ref: 'H001' }

  it('passes what the metric shows and fails what it does not', () => {
    const checks = checkScenarioExpectations(
      {
        subject,
        expectGain: 'met',
        expectMetricWarnings: ['Can not reduce condition', 'No enhancement'],
        expectTradingBreaches: { area: ['Medium', 'Low'] },
        expectRejectedInputs: ['habitatBaseline.condition']
      },
      results,
      [
        {
          sheet: 'habitatBaseline',
          field: 'condition',
          reference: 'H001',
          value: 'x',
          problem: 'not-in-list'
        }
      ]
    )
    expect(checks.map((c) => [c.check, c.passed])).toEqual([
      ['net gain', true],
      ['warning on H001', true],
      // Raised, but on H002 — not on the subject.
      ['warning on H001', false],
      ['area trading rule, Medium', true],
      ['area trading rule, Low', false],
      ['input rejected on H001', true]
    ])
  })

  it('declares nothing for a scenario with no expectations', () => {
    expect(checkScenarioExpectations({ subject }, results)).toEqual([])
  })
})
