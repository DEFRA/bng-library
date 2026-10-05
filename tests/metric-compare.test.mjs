import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  CAUSES,
  DIFFERENCE,
  causesOfFeatureDifference,
  OUTCOME,
  compareFigures,
  compareScenario,
  figuresFromProject,
  figuresFromWorkbook,
  findRegressions,
  knownDiscrepanciesFrom,
  findScenarios,
  readWorkbookAnswers,
  renderComparisonHtml,
  renderComparisonReport,
  renderComparisonXlsx
} from '../src/metric-compare/index.mjs'
import { lintWorkbook } from '../src/workbook-writer/lint.mjs'
import { createZip } from '../src/workbook-writer/xlsx-zip.mjs'
import { createRequire } from 'node:module'
import { MERGED_INTERTIDAL_BROAD_HABITAT } from '../src/metric/area-trading-rules.mjs'

const byModule = (area, hedgerow, watercourse) => ({
  area,
  hedgerow,
  watercourse
})

/** A workbook's answers, as readMetricResults reads them. */
function workbookResults(overrides = {}) {
  return {
    headline: {
      baselineUnits: byModule(10, 0, 0),
      postInterventionUnits: byModule(12, 0, 0),
      netUnitChange: byModule(2, 0, 0),
      netPercentChange: byModule(0.2, 0, 0),
      target: 0.1
    },
    trading: {
      area: [
        { distinctiveness: 'Very High', satisfied: 'Yes ✓' },
        { distinctiveness: 'High', satisfied: 'Yes ✓' },
        { distinctiveness: 'Medium', satisfied: 'No ▲' },
        { distinctiveness: 'Low', satisfied: 'Yes ✓' }
      ],
      hedgerow: [{ distinctiveness: 'Medium', satisfied: 'Yes ✓' }],
      watercourse: [{ distinctiveness: 'Medium', satisfied: 'Yes ✓' }]
    },
    features: [
      {
        module: 'area',
        stage: 'baseline',
        reference: 'H1',
        units: 10,
        sheet: 'habitatBaseline',
        cell: 'Q11'
      },
      {
        module: 'area',
        stage: 'enhanced',
        reference: 'H1',
        units: 12,
        sheet: 'habitatEnhancement',
        cell: 'AN12'
      }
    ],
    tradingFigures: {
      area: {
        habitats: [
          {
            habitatType: 'Grassland - Other neutral grassland',
            distinctiveness: 'Medium',
            netUnitChange: 2
          }
        ],
        broadHabitats: [
          { broadHabitat: 'Grassland', netUnitChange: 2 },
          { broadHabitat: 'Intertidal sediment', netUnitChange: -1 }
        ],
        totals: {
          mediumSurplus: 2,
          mediumDeficit: -1,
          lowNetUnitChange: 0,
          lowCumulativeSurplus: 2
        }
      },
      hedgerow: {
        habitats: [],
        totals: {
          mediumNetUnitChange: 0,
          mediumCumulativeAvailability: 0,
          lowNetUnitChange: 0,
          lowCumulativeAvailability: 0,
          veryLowNetUnitChange: 0,
          veryLowCumulativeAvailability: 0
        }
      },
      watercourse: {
        habitats: [],
        totals: {
          mediumSurplus: 0,
          mediumDeficit: 0,
          lowNetUnitChange: 0,
          lowCumulativeAvailability: 0
        }
      }
    },
    ...overrides
  }
}

/** A service project response for the same site. */
function projectResponse(overrides = {}) {
  return {
    project: {
      baseline: {
        habitats: [{ ref: 'H1', units: 10 }],
        trees: [],
        hedgerows: [],
        watercourses: [],
        units: {
          habitatsTotal: 10,
          treesTotal: 0,
          hedgerowsTotal: 0,
          watercoursesTotal: 0
        }
      },
      postIntervention: {
        habitats: [{ ref: 'H1', retentionCategory: 'Enhanced', units: 12 }],
        trees: [],
        hedgerows: [],
        watercourses: [],
        units: {
          habitatsTotal: 12,
          treesTotal: 0,
          hedgerowsTotal: 0,
          watercoursesTotal: 0,
          habitatsNetUnitChange: 2,
          habitatsNetUnitChangePercentage: 20,
          hedgerowsNetUnitChange: 0,
          watercoursesNetUnitChange: 0
        },
        tradingRules: {
          areaHabitats: {
            habitatTypes: [
              {
                habitatType: 'Grassland - Other neutral grassland',
                distinctiveness: 'Medium',
                netUnitChange: 2
              }
            ],
            medium: {
              broadHabitats: [
                { broadHabitat: 'Grassland', netUnitChange: 2 },
                {
                  broadHabitat: MERGED_INTERTIDAL_BROAD_HABITAT,
                  netUnitChange: -1
                }
              ],
              surplus: 2,
              deficit: -1
            },
            low: { netUnitChange: 0, cumulativeAvailability: 2 }
          },
          hedgerows: {
            habitatTypes: [],
            medium: { netUnitChange: 0 },
            low: { netUnitChange: 0, cumulativeAvailability: 0 },
            veryLow: { netUnitChange: 0, cumulativeAvailability: 0 }
          },
          watercourses: {
            habitats: [],
            medium: { surplus: 0, deficit: 0 },
            low: { netUnitChange: 0, cumulativeAvailability: 0 }
          }
        }
      }
    },
    tradingRuleStatuses: {
      areaHabitats: { medium: 'Not met', low: 'Met', overall: 'Not met' },
      watercourses: { medium: null, low: null, overall: null }
    },
    ...overrides
  }
}

const valueOf = (figures, key) => figures.find((f) => f.key === key)?.value

describe('figuresFromWorkbook', () => {
  const figures = figuresFromWorkbook(workbookResults())

  it('keys each feature by module, stage and reference', () => {
    expect(valueOf(figures, 'feature-units|area|baseline|H1')).toBe(10)
    expect(valueOf(figures, 'feature-units|area|enhanced|H1')).toBe(12)
  })

  it('reports the net change as a percentage and judges it against the target', () => {
    expect(valueOf(figures, 'net-gain|area|percentage')).toBe(20)
    expect(valueOf(figures, 'net-gain|area|verdict')).toBe('Met')
  })

  it('reads a trading verdict as Met or Not met', () => {
    expect(valueOf(figures, 'trading-status|area|Medium')).toBe('Not met')
    expect(valueOf(figures, 'trading-status|area|Low')).toBe('Met')
  })

  it('names the intertidal Medium group as the engine does', () => {
    expect(
      valueOf(
        figures,
        `trading-figures|area|broad-habitat|${MERGED_INTERTIDAL_BROAD_HABITAT}`
      )
    ).toBe(-1)
  })

  it('leaves out the net gain and statuses of a module the site does not have', () => {
    expect(valueOf(figures, 'net-gain|hedgerow|percentage')).toBeUndefined()
    expect(valueOf(figures, 'trading-status|hedgerow|Medium')).toBeUndefined()
    expect(valueOf(figures, 'totals|hedgerow|baseline')).toBe(0)
  })

  it('gives a module whose baseline is zero no net gain verdict', () => {
    const results = workbookResults()
    results.headline.netPercentChange.area = 'N/A'
    expect(valueOf(figuresFromWorkbook(results), 'net-gain|area|verdict')).toBe(
      'N/A'
    )
  })
})

describe('figuresFromProject', () => {
  it('produces the same keys as the workbook for the same site', () => {
    const actual = figuresFromProject(projectResponse())
    const comparison = compareFigures(
      figuresFromWorkbook(workbookResults()),
      actual
    )
    expect(comparison.discrepancies).toEqual([])
  })

  // From the corpus: the metric's trading summary spells the habitat
  // "Ruderal/ephemeral"; the template and the service, "Ruderal/Ephemeral".
  it('matches a trading habitat the metric spells in a different case', () => {
    const workbook = workbookResults()
    workbook.tradingFigures.area.habitats[0].habitatType =
      'Sparsely vegetated land - Ruderal/ephemeral'
    const response = projectResponse()
    response.project.postIntervention.tradingRules.areaHabitats.habitatTypes[0].habitatType =
      'Sparsely vegetated land - Ruderal/Ephemeral'

    const comparison = compareFigures(
      figuresFromWorkbook(workbook),
      figuresFromProject(response)
    )
    expect(comparison.discrepancies).toEqual([])
  })

  it('reads the hedgerow trading figures, keyed as the workbook keys them', () => {
    const workbook = workbookResults()
    workbook.tradingFigures.hedgerow = {
      habitats: [
        {
          habitatType: 'Species-rich native hedgerow',
          distinctiveness: 'Medium',
          netUnitChange: 1.5
        },
        {
          habitatType: 'Non-native and ornamental hedgerow',
          distinctiveness: 'Very Low',
          netUnitChange: -0.5
        }
      ],
      totals: {
        mediumNetUnitChange: 1.5,
        mediumCumulativeAvailability: 1.5,
        lowNetUnitChange: 0,
        lowCumulativeAvailability: 1.5,
        veryLowNetUnitChange: -0.5,
        veryLowCumulativeAvailability: 1
      }
    }
    const response = projectResponse()
    response.project.postIntervention.tradingRules.hedgerows = {
      habitatTypes: [
        {
          habitatType: 'Species-rich native hedgerow',
          distinctiveness: 'Medium',
          netUnitChange: 1.5
        },
        {
          habitatType: 'Non-native and ornamental hedgerow',
          distinctiveness: 'V.Low',
          netUnitChange: -0.5
        }
      ],
      medium: { netUnitChange: 1.5 },
      low: { netUnitChange: 0, cumulativeAvailability: 1.5 },
      veryLow: { netUnitChange: -0.5, cumulativeAvailability: 1 }
    }

    const figures = figuresFromProject(response)
    const comparison = compareFigures(figuresFromWorkbook(workbook), figures)
    expect(comparison.discrepancies).toEqual([])
    expect(
      figures.find(
        (f) =>
          f.key ===
          'trading-figures|hedgerow|habitat|non-native and ornamental hedgerow'
      )
    ).toMatchObject({
      label: 'Non-native and ornamental hedgerow (Very Low) net unit change',
      distinctiveness: 'Very Low'
    })
  })

  it('prefers a Medium hedgerow cumulative availability the service supplies', () => {
    const response = projectResponse()
    response.project.postIntervention.tradingRules.hedgerows.medium = {
      netUnitChange: 0,
      cumulativeAvailability: 0.75
    }
    const figures = figuresFromProject(response)
    expect(valueOf(figures, 'trading-figures|hedgerow|medium-cumulative')).toBe(
      0.75
    )
    expect(valueOf(figures, 'trading-figures|hedgerow|medium-net-change')).toBe(
      0
    )
  })

  it('reports a hedgerow trading figure the service differs on', () => {
    const response = projectResponse()
    response.project.postIntervention.tradingRules.hedgerows.low.cumulativeAvailability = 0.25
    const comparison = compareFigures(
      figuresFromWorkbook(workbookResults()),
      figuresFromProject(response)
    )
    expect(comparison.discrepancies.map((d) => d.key)).toEqual([
      'trading-figures|hedgerow|low-cumulative'
    ])
  })

  it('treats a lost area habitat as a creation, as the metric does', () => {
    const response = projectResponse()
    response.project.postIntervention.habitats = [
      { ref: 'H1', retentionCategory: '3. Lost', units: 4 }
    ]
    expect(
      valueOf(figuresFromProject(response), 'feature-units|area|created|H1')
    ).toBe(4)
  })

  it('counts trees as area habitats', () => {
    const response = projectResponse()
    response.project.baseline.trees = [{ ref: 'T1', units: 0.5 }]
    response.project.baseline.units.treesTotal = 0.5
    const figures = figuresFromProject(response)
    expect(valueOf(figures, 'feature-units|area|baseline|T1')).toBe(0.5)
    expect(valueOf(figures, 'totals|area|baseline')).toBe(10.5)
  })

  it('gives each feature the measured size it was priced on', () => {
    const response = projectResponse()
    response.project.baseline.habitats = [
      { ref: 'H1', units: 4, sizeSquareMetres: 10_000.4, area: 10_000 }
    ]
    response.project.baseline.hedgerows = [
      { ref: 'HG1', units: 1, sizeMetres: 500.7, length: 501 }
    ]
    const figures = figuresFromProject(response)
    const sizeOf = (key) => figures.find((f) => f.key === key)?.size
    expect(sizeOf('feature-units|area|baseline|H1')).toBeCloseTo(1.00004, 12)
    expect(sizeOf('feature-units|hedgerow|baseline|HG1')).toBeCloseTo(
      0.5007,
      12
    )
  })

  it('falls back to the rounded size from a service that priced it', () => {
    const response = projectResponse()
    response.project.baseline.habitats = [{ ref: 'H1', units: 4, area: 10_000 }]
    const figures = figuresFromProject(response)
    expect(
      figures.find((f) => f.key === 'feature-units|area|baseline|H1')?.size
    ).toBe(1)
  })

  it('skips a feature the service gave no units', () => {
    const response = projectResponse()
    response.project.baseline.trees = [{ ref: 'T5', units: undefined }]
    expect(
      valueOf(figuresFromProject(response), 'feature-units|area|baseline|T5')
    ).toBeUndefined()
  })

  it('judges net gain as the frontend shows it, on the percentage rounded to 2 dp', () => {
    const response = projectResponse()
    response.project.postIntervention.units.habitatsNetUnitChangePercentage = 9.996
    expect(valueOf(figuresFromProject(response), 'net-gain|area|verdict')).toBe(
      'Met'
    )
    response.project.postIntervention.units.habitatsNetUnitChangePercentage = 9.994
    expect(valueOf(figuresFromProject(response), 'net-gain|area|verdict')).toBe(
      'Not met'
    )
  })

  it('leaves out a status the service did not derive', () => {
    const figures = figuresFromProject(projectResponse())
    expect(
      valueOf(figures, 'trading-status|watercourse|Medium')
    ).toBeUndefined()
  })
})

const figure = (key, value, extra = {}) => {
  const [category, module] = key.split('|')
  return { key, category, module, label: key, value, ...extra }
}

describe('compareFigures', () => {
  it('matches numbers equal to 15 significant figures', () => {
    const result = compareFigures(
      [figure('totals|area|baseline', 108.28816610400001)],
      [figure('totals|area|baseline', 108.288166104)]
    )
    expect(result).toMatchObject({ compared: 1, matched: 1, discrepancies: [] })
  })

  // Pairs from the corpus once the service priced the measured size: the
  // same factors multiplied in a different order, one apart in
  // the 15th significant figure.
  it.each([
    [80.7823849663891, 80.782384966389],
    [0.443142747869206, 0.443142747869205],
    [347.485266934266, 347.485266934265]
  ])('matches %s and %s, one apart in the last digit', (metric, service) => {
    const result = compareFigures(
      [figure('feature-units|area|baseline|H1', metric)],
      [figure('feature-units|area|baseline|H1', service)]
    )
    expect(result).toMatchObject({ compared: 1, matched: 1, discrepancies: [] })
  })

  // From the corpus: a net change summed in a different order by the engine
  // and the workbook, apart in the 14th significant figure.
  it('matches figures apart by floating-point noise, and lists them', () => {
    const result = compareFigures(
      [figure('totals|area|net-change', 0.0586730378868658)],
      [figure('totals|area|net-change', 0.0586730378868601)]
    )
    expect(result).toMatchObject({ compared: 1, matched: 1, discrepancies: [] })
    expect(result.withinTolerance).toEqual([
      expect.objectContaining({
        key: 'totals|area|net-change',
        expected: 0.0586730378868658,
        actual: 0.0586730378868601
      })
    ])
  })

  it('lists no match that is exact as within tolerance', () => {
    const result = compareFigures(
      [figure('totals|area|baseline', 80.7823849663891)],
      [figure('totals|area|baseline', 80.7823849663891)]
    )
    expect(result.withinTolerance).toEqual([])
  })

  it.each([
    ['inside', 1000, 1000 + 9e-10, 1],
    ['beyond', 1000, 1000 + 1.1e-9, 0]
  ])(
    'matches a figure %s the relative tolerance (%s against %s)',
    (_, metric, service, matched) => {
      const result = compareFigures(
        [figure('totals|area|baseline', metric)],
        [figure('totals|area|baseline', service)]
      )
      expect(result.matched).toBe(matched)
      expect(result.discrepancies).toHaveLength(1 - matched)
    }
  )

  it.each([
    ['inside', 9e-13, 1],
    ['beyond', 2e-12, 0]
  ])(
    'matches a figure %s the absolute tolerance where the metric has zero',
    (_, service, matched) => {
      const result = compareFigures(
        [figure('trading-figures|area|low-surplus', 0)],
        [figure('trading-figures|area|low-surplus', service)]
      )
      expect(result.matched).toBe(matched)
    }
  )

  // The size-rounding regression the tolerance must not hide: a 1,000 ha
  // parcel priced at 8 units/ha on its area rounded to the whole square
  // metre is ~4e-8 out — far too little to change an outcome, but a
  // difference in how the service calculates.
  it('reports units priced on a size rounded to the whole square metre', () => {
    const measured = 1000.00004
    const rounded = 1000
    const result = compareFigures(
      [
        figure('feature-units|area|baseline|H1', 8 * measured, {
          size: measured
        })
      ],
      [figure('feature-units|area|baseline|H1', 8 * rounded, { size: rounded })]
    )
    expect(result.withinTolerance).toEqual([])
    expect(result.discrepancies).toEqual([
      expect.objectContaining({ causes: [CAUSES.sizeDiffers.id] })
    ])
  })

  it('never matches a different verdict', () => {
    const result = compareFigures(
      [figure('net-gain|area|verdict', 'Met')],
      [figure('net-gain|area|verdict', 'Not met')]
    )
    expect(result.discrepancies).toHaveLength(1)
  })

  it('counts the last digit of the larger figure across a power of ten', () => {
    const result = compareFigures(
      [figure('totals|area|baseline', 10)],
      [figure('totals|area|baseline', 9.99999999999999)]
    )
    expect(result.matched).toBe(1)
  })

  it('reports how far a differing figure is from the metric', () => {
    const [d] = compareFigures(
      [figure('totals|area|baseline', 115.623264923096)],
      [figure('totals|area|baseline', 115.62)]
    ).discrepancies
    expect(d).toMatchObject({
      kind: DIFFERENCE.different,
      expected: 115.623264923096,
      actual: 115.62
    })
    expect(d.difference).toBeCloseTo(-0.003264923096, 12)
    expect(d.relativeDifference).toBeCloseTo(
      -0.003264923096 / 115.623264923096,
      15
    )
  })

  it('takes a trading habitat one side leaves out as zero', () => {
    const key = 'trading-figures|area|habitat|Grassland - Modified grassland'
    const result = compareFigures(
      [],
      [figure(key, 3, { zeroWhenAbsent: true })]
    )
    expect(result.discrepancies[0]).toMatchObject({
      expected: 0,
      actual: 3,
      difference: 3
    })
  })

  it('reports a figure only one side has', () => {
    const result = compareFigures(
      [figure('feature-units|area|baseline|H1', 1)],
      [figure('feature-units|area|baseline|H2', 1)]
    )
    expect(result.discrepancies.map((d) => d.kind).sort()).toEqual([
      DIFFERENCE.missingFromService,
      DIFFERENCE.missingFromWorkbook
    ])
  })

  it('agrees where neither side has a value', () => {
    const result = compareFigures(
      [figure('feature-units|area|enhanced|H1', null)],
      []
    )
    expect(result).toMatchObject({ matched: 1, discrepancies: [] })
  })

  it('reports what the service does not implement rather than failing it', () => {
    const result = compareFigures(
      [
        figure('trading-status|hedgerow|Medium', 'Met', {
          distinctiveness: 'Medium'
        }),
        figure('trading-status|area|High', 'Met', { distinctiveness: 'High' }),
        figure('trading-figures|area|habitat|X', 1, {
          distinctiveness: 'High',
          zeroWhenAbsent: true
        })
      ],
      []
    )
    expect(result.discrepancies).toEqual([])
    expect(result.notImplemented.map((n) => n.gap)).toEqual([
      'hedgerow-trading-statuses',
      'higher-band-trading-statuses',
      'higher-band-trading-figures'
    ])
  })

  it('compares a gap figure like any other once the service produces it', () => {
    const key = 'trading-status|area|High'
    const result = compareFigures(
      [figure(key, 'Met', { distinctiveness: 'High' })],
      [figure(key, 'Not met', { distinctiveness: 'High' })]
    )
    expect(result.notImplemented).toEqual([])
    expect(result.discrepancies).toHaveLength(1)
  })
})

describe('causesOfFeatureDifference', () => {
  const metric = (value, size, strategicSignificanceMultiplier = 1) =>
    figure('feature-units|area|baseline|H1', value, {
      size,
      strategicSignificanceMultiplier
    })
  const service = (value, size) =>
    figure('feature-units|area|baseline|H1', value, { size })

  it('recognises units priced on a rounded size', () => {
    // 14.4529081 ha priced at 8 units/ha, against 14.4529 ha.
    expect(
      causesOfFeatureDifference(
        metric(115.6232648, 14.4529081),
        service(115.6232, 14.4529)
      )
    ).toEqual([CAUSES.sizeDiffers.id])
  })

  it('recognises a strategic significance multiplier the service leaves out', () => {
    expect(
      causesOfFeatureDifference(
        metric(0.01804, 0.0041, 1.1),
        service(0.0164, 0.0041)
      )
    ).toEqual([CAUSES.strategicSignificance.id])
  })

  it('recognises both at once', () => {
    expect(
      causesOfFeatureDifference(
        metric(8 * 2.00004 * 1.15, 2.00004, 1.15),
        service(16, 2)
      )
    ).toEqual([CAUSES.sizeDiffers.id, CAUSES.strategicSignificance.id])
  })

  it('explains nothing it cannot account for exactly', () => {
    expect(causesOfFeatureDifference(metric(10, 1), service(9, 1))).toEqual([])
    expect(causesOfFeatureDifference(metric(10, null), service(9, 1))).toEqual(
      []
    )
  })

  it('attaches the causes to the discrepancy, which still counts', () => {
    const result = compareFigures(
      [metric(0.01804, 0.0041, 1.1)],
      [service(0.0164, 0.0041)]
    )
    expect(result.discrepancies).toHaveLength(1)
    expect(result.discrepancies[0].causes).toEqual([
      CAUSES.strategicSignificance.id
    ])
  })
})

describe('units', () => {
  it('names the unit of every discrepancy, and of its difference', () => {
    const units = (key, expected, actual) =>
      compareFigures([figure(key, expected)], [figure(key, actual)])
        .discrepancies[0]
    expect(units('totals|hedgerow|baseline', 1, 2)).toMatchObject({
      unit: 'hedgerow units',
      differenceUnit: 'hedgerow units'
    })
    expect(units('net-gain|area|percentage', 9.09, 10.01)).toMatchObject({
      unit: '% of baseline units',
      differenceUnit: 'percentage points'
    })
    expect(units('trading-status|area|Low', 'Met', 'Not met')).toMatchObject({
      unit: 'Met / Not met',
      differenceUnit: null
    })
  })

  it('gives a feature’s priced sizes and unit', () => {
    const [d] = compareFigures(
      [
        figure('feature-units|hedgerow|baseline|HG1', 2, {
          size: 0.5001,
          strategicSignificanceMultiplier: 1
        })
      ],
      [figure('feature-units|hedgerow|baseline|HG1', 1.9, { size: 0.5 })]
    ).discrepancies
    expect(d).toMatchObject({
      unit: 'hedgerow units',
      metricSize: 0.5001,
      serviceSize: 0.5,
      sizeUnit: 'km',
      strategicSignificanceMultiplier: 1
    })
  })

  it('shows each value and difference with its unit in the HTML report', () => {
    const result = compareScenario({
      scenario: { id: 'site' },
      expected: [figure('net-gain|area|percentage', 9.09)],
      service: {
        accepted: true,
        figures: [figure('net-gain|area|percentage', 10.01)]
      }
    })
    const html = renderComparisonHtml([result])
    expect(html).toContain('9.0900%')
    expect(html).toContain('10.0100%')
    expect(html).toContain('+0.9200 percentage points')
  })
})

describe('compareScenario', () => {
  const expected = [figure('totals|area|baseline', 1)]

  it('is matched when every figure agrees', () => {
    const result = compareScenario({
      scenario: { id: 'a' },
      expected,
      service: { accepted: true, figures: expected }
    })
    expect(result.outcome).toBe(OUTCOME.matched)
  })

  it('fails a valid scenario the service refuses', () => {
    const result = compareScenario({
      scenario: { id: 'a' },
      expected,
      service: { accepted: false, rejectedFile: 'baseline', errors: [] }
    })
    expect(result.outcome).toBe(OUTCOME.rejected)
  })

  it('reports, without comparing, a scenario whose workbook could not be read', () => {
    const result = compareScenario({
      scenario: { id: 'site' },
      workbookError: 'no values',
      service: { accepted: true, figures: [] }
    })
    expect(result).toMatchObject({
      outcome: OUTCOME.workbookUnreadable,
      errors: [{ code: 'WORKBOOK_UNREADABLE', message: 'no values' }]
    })
  })

  it('expects a scenario built on invalid data to be refused', () => {
    const result = compareScenario({
      scenario: { id: 'invalid-x' },
      expected,
      service: { accepted: false, rejectedFile: 'baseline', errors: [] }
    })
    expect(result.outcome).toBe(OUTCOME.rejectedAsExpected)
  })

  it('fails a scenario built on invalid data that the service accepts, even when its figures agree', () => {
    const result = compareScenario({
      scenario: { id: 'invalid-x' },
      expected,
      service: { accepted: true, figures: expected }
    })
    expect(result).toMatchObject({
      outcome: OUTCOME.acceptedInvalid,
      compared: 1,
      matched: 1,
      discrepancies: []
    })
    expect(knownDiscrepanciesFrom([result])['invalid-x'].outcome).toBe(
      OUTCOME.acceptedInvalid
    )
  })
})

describe('regressions', () => {
  const run = (discrepancies, outcome = OUTCOME.discrepancies) => [
    { id: 's', outcome, discrepancies }
  ]
  const d = (key, expected, actual) => ({ key, expected, actual })
  const known = knownDiscrepanciesFrom(run([d('k1', 1, 2), d('k2', 1, 3)]))

  it('finds no change in an identical run', () => {
    expect(findRegressions(run([d('k2', 1, 3), d('k1', 1, 2)]), known)).toEqual(
      []
    )
  })

  it('finds a new, a changed and a resolved discrepancy', () => {
    const changes = findRegressions(
      run([d('k1', 1, 2.5), d('k3', 0, 1)]),
      known
    )
    expect(changes.map((c) => `${c.key}:${c.change}`).sort()).toEqual([
      'k1:changed',
      'k2:resolved',
      'k3:new'
    ])
  })

  it('finds a scenario whose outcome changed, and scenarios added or removed', () => {
    const changes = findRegressions(
      [
        { id: 's', outcome: OUTCOME.rejected },
        { id: 't', outcome: OUTCOME.matched }
      ],
      known
    )
    expect(changes.map((c) => c.change)).toEqual([
      'outcome',
      'resolved',
      'resolved',
      'new-scenario'
    ])
    expect(findRegressions([], known)).toEqual([
      { id: 's', change: 'scenario-removed' }
    ])
  })
})

describe('renderComparisonReport', () => {
  it('shows each discrepancy with its difference, and what is not implemented', () => {
    const result = compareScenario({
      scenario: { id: 'site' },
      expected: [
        figure('totals|area|baseline', 10),
        figure('trading-status|hedgerow|Low', 'Met', { distinctiveness: 'Low' })
      ],
      service: {
        accepted: true,
        figures: [figure('totals|area|baseline', 9.5)]
      }
    })
    const report = renderComparisonReport([result], { regressions: [] })
    expect(report).toContain(
      '| totals\\|area\\|baseline | area | 10 | 9.5 | habitat units | -0.5 | -5% | — | different |'
    )
    expect(report).toContain('hedgerow-trading-statuses')
    expect(report).toContain('No change from the recorded discrepancies.')
  })
})

describe('renderComparisonReport without details', () => {
  it('is a summary, leaving out each scenario’s discrepancies', () => {
    const result = compareScenario({
      scenario: { id: 'site' },
      expected: [figure('totals|area|baseline', 10)],
      service: {
        accepted: true,
        figures: [figure('totals|area|baseline', 9.5)]
      }
    })
    const report = renderComparisonReport([result], { details: false })
    expect(report).toContain('## Scenarios')
    expect(report).not.toContain('## Discrepancies per scenario')
  })
})

describe('renderComparisonHtml', () => {
  const results = [
    compareScenario({
      scenario: { id: 'site' },
      expected: [
        figure('totals|area|baseline', 10),
        figure('feature-units|area|baseline|<H1>', 0.01804, {
          size: 0.0041,
          strategicSignificanceMultiplier: 1.1
        })
      ],
      service: {
        accepted: true,
        figures: [
          figure('totals|area|baseline', 9.5),
          figure('feature-units|area|baseline|<H1>', 0.0164, { size: 0.0041 })
        ]
      }
    }),
    compareScenario({
      scenario: { id: 'invalid-x' },
      expected: [],
      service: {
        accepted: false,
        rejectedFile: 'postIntervention',
        errors: [{ code: 'ADVANCE_AND_DELAY', message: 'Both set' }]
      }
    })
  ]
  const html = renderComparisonHtml(results, { context: ['Commit abc'] })

  it('is a complete, self-contained page', () => {
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('<title>Metric comparison</title>')
    expect(html).not.toMatch(/<(script|link)[^>]+(src|href)=/)
    expect(html).toContain('Commit abc')
  })

  it('shows each difference as a number in its unit, with its cause', () => {
    expect(html).toContain('10.0000 habitat units')
    expect(html).toContain('9.5000 habitat units')
    expect(html).toContain('−0.5000 habitat units')
    expect(html).toContain('Strategic significance not applied')
  })

  it('escapes what it shows', () => {
    expect(html).toContain('&lt;H1&gt;')
    expect(html).not.toContain('<H1>')
  })

  it('leads with the answers that differ and the values no cause explains', () => {
    const result = compareScenario({
      scenario: { id: 'site' },
      expected: [
        figure('net-gain|area|verdict', 'Not met'),
        figure('net-gain|area|percentage', 9.09),
        figure('feature-units|area|created|T5', 0.1378)
      ],
      service: {
        accepted: true,
        figures: [
          figure('net-gain|area|verdict', 'Met'),
          figure('net-gain|area|percentage', 10.01),
          figure('feature-units|area|created|T5', 0.1116)
        ]
      }
    })
    const page = renderComparisonHtml([result])
    expect(page).toContain('1 Met / Not met answer differs from the metric')
    expect(page).toContain('1 feature value differs for no known reason')
    expect(page).toContain(
      'Net change: 9.0900% in the metric, 10.0100% in the service'
    )
  })

  it('never shows a tiny difference as zero', () => {
    const result = compareScenario({
      scenario: { id: 'site' },
      expected: [figure('totals|area|baseline', 1.2345391601563)],
      service: {
        accepted: true,
        figures: [figure('totals|area|baseline', 1.2346)]
      }
    })
    expect(renderComparisonHtml([result])).toContain('+0.000061 habitat units')
  })

  it('shows a difference too small for fixed notation in scientific notation', () => {
    const result = compareScenario({
      scenario: { id: 'site' },
      expected: [figure('totals|area|baseline', 97.3095391601563)],
      service: {
        accepted: true,
        figures: [figure('totals|area|baseline', 97.4)]
      }
    })
    // Inside the tolerance such a difference matches, but the report still
    // has to show one it is given without rounding it to zero.
    result.discrepancies[0].difference = 3e-13
    const html = renderComparisonHtml([result])
    expect(html).toMatch(/\+\d\.\de-1[34] habitat units/)
    expect(html).not.toContain('+0.000000000000')
  })

  it('fails a scenario with invalid data that the service accepted', () => {
    const result = compareScenario({
      scenario: { id: 'invalid-x' },
      expected: [figure('totals|area|baseline', 1)],
      service: {
        accepted: true,
        figures: [figure('totals|area|baseline', 1)]
      }
    })
    const page = renderComparisonHtml([result])
    expect(page).toContain('Accepted, though its data is invalid')
    expect(page).toContain(
      'The service accepted 1 scenario whose data is invalid.'
    )
  })

  it('lists why a refused scenario was refused', () => {
    expect(html).toContain('ADVANCE_AND_DELAY')
    expect(html).toContain('Refused, as expected (invalid data)')
  })
})

describe('renderComparisonXlsx', () => {
  const XLSX = createRequire(import.meta.url)('xlsx')
  const results = [
    compareScenario({
      scenario: { id: 'site' },
      expected: [
        figure('totals|area|baseline', 10),
        figure('feature-units|area|baseline|H&1', 0.01804, {
          size: 0.0041,
          strategicSignificanceMultiplier: 1.1
        }),
        figure('trading-status|hedgerow|Low', 'Met', { distinctiveness: 'Low' })
      ],
      service: {
        accepted: true,
        figures: [
          figure('totals|area|baseline', 9.5),
          figure('feature-units|area|baseline|H&1', 0.0164, { size: 0.0041 })
        ]
      }
    }),
    compareScenario({
      scenario: { id: 'invalid-x' },
      expected: [],
      service: {
        accepted: false,
        rejectedFile: 'postIntervention',
        errors: [{ code: 'ADVANCE_AND_DELAY', message: 'Both set' }]
      }
    })
  ]
  const buffer = renderComparisonXlsx(results, { context: ['Commit abc'] })
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const rows = (name) => XLSX.utils.sheet_to_json(workbook.Sheets[name])

  it('has a summary and a guide, then a sheet per scenario, discrepancy and gap', () => {
    expect(workbook.SheetNames).toEqual([
      'Summary',
      'Guide',
      'Scenarios',
      'Discrepancies',
      'Not implemented'
    ])
  })

  it('has none of the faults Excel would repair on opening', () => {
    expect(lintWorkbook(buffer)).toEqual([])
  })

  it('writes one row per discrepancy, with numbers as numbers', () => {
    const discrepancies = rows('Discrepancies')
    expect(discrepancies).toHaveLength(2)
    expect(discrepancies[0]).toMatchObject({
      Scenario: 'site',
      'Metric value': 10,
      'Service value': 9.5,
      Unit: 'habitat units',
      'Difference (service − metric)': -0.5,
      'Difference unit': 'habitat units',
      'Relative difference (% of metric value)': -5,
      Unexplained: 'Yes'
    })
    expect(discrepancies[1]).toMatchObject({
      Figure: 'feature-units|area|baseline|H&1',
      'Metric size': 0.0041,
      'Service size': 0.0041,
      'Size unit': 'ha',
      'Strategic significance × (metric)': 1.1,
      'Explained by': 'Strategic significance not applied',
      Unexplained: 'No'
    })
  })

  it('lists why a refused scenario was refused, and what is not implemented', () => {
    expect(rows('Scenarios')[1]).toMatchObject({
      Outcome: 'Rejected (invalid data)',
      Why: 'ADVANCE_AND_DELAY: Both set'
    })
    expect(rows('Not implemented')[0]).toMatchObject({
      Gap: 'hedgerow-trading-statuses',
      'Metric value': 'Met',
      Unit: 'Met / Not met'
    })
  })

  it('gives the same bytes for the same results', () => {
    const again = renderComparisonXlsx(results, { context: ['Commit abc'] })
    expect(Buffer.compare(again, buffer)).toBe(0)
  })
})

describe('findScenarios', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'scenarios-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const touch = (file) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), '')
  }
  for (const file of [
    'net-gain/met-baseline.gpkg',
    'net-gain/met-post-intervention.gpkg',
    'net-gain/met.xlsx',
    'invalid-interventions/invalid-x-baseline.gpkg',
    'invalid-interventions/invalid-x-post-intervention.gpkg',
    'invalid-interventions/invalid-x.xlsx',
    'site-baseline.gpkg',
    'site-post-intervention.gpkg',
    'site.xlsx',
    'lonely.xlsx',
    '.recalc-1/wb0001.xlsx'
  ]) {
    touch(file)
  }
  const { scenarios, unmatched } = findScenarios(dir)

  it('pairs each workbook with the GeoPackages named after it', () => {
    expect(scenarios.map((s) => s.id)).toEqual([
      'invalid-interventions/invalid-x',
      'net-gain/met',
      'site'
    ])
    expect(scenarios[1]).toMatchObject({
      name: 'met',
      purpose: 'net-gain',
      invalidData: false,
      files: {
        baseline: path.join(dir, 'net-gain/met-baseline.gpkg'),
        postIntervention: path.join(dir, 'net-gain/met-post-intervention.gpkg'),
        workbook: path.join(dir, 'net-gain/met.xlsx')
      }
    })
  })

  it('knows a scenario holds invalid data by its name', () => {
    expect(scenarios[0].invalidData).toBe(true)
  })

  it('lists a workbook without its GeoPackages, and ignores hidden folders', () => {
    expect(unmatched).toEqual(['lonely.xlsx'])
  })

  it('needs to be told where the scenarios are', () => {
    expect(() => findScenarios()).toThrow(/needs a folder/)
  })
})

/** The smallest workbook readMetricResults accepts, with the values given. */
function minimalWorkbook(headlineCells) {
  const cells = Object.entries(headlineCells)
    .map(([ref, v]) =>
      v === undefined
        ? `<c r="${ref}"><f>1+1</f></c>`
        : `<c r="${ref}"><v>${v}</v></c>`
    )
    .join('')
  const rows = `<row r="8">${cells}</row>`
  return createZip(
    new Map([
      [
        '[Content_Types].xml',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'
      ],
      [
        'xl/workbook.xml',
        '<workbook xmlns:r="r"><sheets><sheet name="Headline Results" sheetId="1" r:id="rId1"/></sheets></workbook>'
      ],
      [
        'xl/_rels/workbook.xml.rels',
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'
      ],
      [
        'xl/worksheets/sheet1.xml',
        `<worksheet><sheetData>${rows}</sheetData></worksheet>`
      ]
    ])
  )
}

describe('readWorkbookAnswers', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'answers-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const saved = path.join(dir, 'saved.xlsx')
  const formulasOnly = path.join(dir, 'formulas-only.xlsx')
  writeFileSync(saved, minimalWorkbook({ H8: 12.5 }))
  writeFileSync(formulasOnly, minimalWorkbook({ H8: undefined }))

  it('reads the values a workbook was saved with', async () => {
    const [answer] = await readWorkbookAnswers([saved])
    expect(answer.results.headline.baselineUnits.area).toBe(12.5)
  })

  it('reports a workbook with no values when LibreOffice is not there to recalculate it', async () => {
    const [answer] = await readWorkbookAnswers([formulasOnly], {
      soffice: path.join(dir, 'no-such-soffice')
    })
    expect(answer.error).toMatch(/without its calculated values/)
  })
})

describe('a scenario the service failed to import', () => {
  const XLSX = createRequire(import.meta.url)('xlsx')
  const failed = compareScenario({
    scenario: { id: 'net-gain/met' },
    serviceError: 'GEOS threw: TopologyException'
  })
  const compared = compareScenario({
    scenario: { id: 'net-gain/unmet' },
    expected: [figure('totals|area|baseline', 10)],
    service: { accepted: true, figures: [figure('totals|area|baseline', 10)] }
  })

  it('is reported, with the error, and nothing compared', () => {
    expect(failed).toEqual({
      id: 'net-gain/met',
      invalidData: false,
      outcome: OUTCOME.importFailed,
      errors: [
        { code: 'IMPORT_FAILED', message: 'GEOS threw: TopologyException' }
      ]
    })
  })

  it('is reported as unreadable when the workbook could not be read either', () => {
    const result = compareScenario({
      scenario: { id: 'site' },
      workbookError: 'no values',
      serviceError: 'boom'
    })
    expect(result.outcome).toBe(OUTCOME.workbookUnreadable)
  })

  it('leads the HTML report, and shows the error on the scenario', () => {
    const page = renderComparisonHtml([compared, failed])
    expect(page).toContain(
      'The service failed to import 1 scenario, so it was not compared.'
    )
    expect(page).toContain('The service failed to import it')
    expect(page).toContain('GEOS threw: TopologyException')
  })

  it('is counted in the Markdown summary and detailed with its error', () => {
    const report = renderComparisonReport([compared, failed])
    expect(report).toContain('1 the service failed to import')
    expect(report).toContain(
      'The service threw an error importing this scenario, so nothing was compared: GEOS threw: TopologyException'
    )
  })

  it('is counted in the spreadsheet and gives its error on the scenario row', () => {
    const workbook = XLSX.read(renderComparisonXlsx([compared, failed]), {
      type: 'buffer'
    })
    const rows = (name) =>
      XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 })
    expect(rows('Summary')).toContainEqual([
      'Import failed in the service (nothing compared)',
      1
    ])
    const scenario = rows('Scenarios').find((r) => r[0] === 'net-gain/met')
    expect(scenario).toContain('Import failed in the service')
    expect(scenario).toContain('IMPORT_FAILED: GEOS threw: TopologyException')
  })
})
