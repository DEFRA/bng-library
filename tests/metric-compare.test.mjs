import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  loadScenarioCorpus,
  renderComparisonHtml,
  renderComparisonReport,
  renderComparisonXlsx
} from '../src/metric-compare/index.mjs'
import { lintWorkbook } from '../src/workbook-writer/lint.mjs'
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
      hedgerow: { habitats: [], totals: { mediumNetUnitChange: 0 } },
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

  it('reports how far a differing figure is from the metric', () => {
    const [d] = compareFigures(
      [figure('totals|area|baseline', 115.623264923096)],
      [figure('totals|area|baseline', 115.6232)]
    ).discrepancies
    expect(d).toMatchObject({
      kind: DIFFERENCE.different,
      expected: 115.623264923096,
      actual: 115.6232
    })
    expect(d.difference).toBeCloseTo(-0.000064923096, 12)
    expect(d.relativeDifference).toBeCloseTo(
      -0.000064923096 / 115.623264923096,
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
      'hedgerow-trading-rules',
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
    ).toEqual([CAUSES.sizeRounding.id])
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
    ).toEqual([CAUSES.sizeRounding.id, CAUSES.strategicSignificance.id])
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

  it('shows the units and a guide to them in the HTML report', () => {
    const result = compareScenario({
      scenario: { id: 'site' },
      expected: [figure('net-gain|area|percentage', 9.09)],
      service: {
        accepted: true,
        figures: [figure('net-gain|area|percentage', 10.01)]
      }
    })
    const html = renderComparisonHtml([result])
    expect(html).toContain('How to read this report')
    expect(html).toContain('% of baseline units')
    expect(html).toContain('percentage points')
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

  it('expects a scenario built on invalid data to be refused', () => {
    const result = compareScenario({
      scenario: { id: 'invalid-x' },
      expected,
      service: { accepted: false, rejectedFile: 'baseline', errors: [] }
    })
    expect(result.outcome).toBe(OUTCOME.rejectedAsExpected)
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
    expect(report).toContain('hedgerow-trading-rules')
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

  it('shows each discrepancy with its difference, relative difference and cause', () => {
    expect(html).toContain('>-0.5<')
    expect(html).toContain('>-5%<')
    expect(html).toContain('Strategic significance not applied')
    expect(html).toContain('Unexplained')
  })

  it('escapes what it shows', () => {
    expect(html).toContain('&lt;H1&gt;')
    expect(html).not.toContain('<H1>')
  })

  it('lists why a refused scenario was refused', () => {
    expect(html).toContain('ADVANCE_AND_DELAY')
    expect(html).toContain('Rejected (invalid data)')
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
      'Why the service refused it': 'ADVANCE_AND_DELAY: Both set'
    })
    expect(rows('Not implemented')[0]).toMatchObject({
      Gap: 'hedgerow-trading-rules',
      'Metric value': 'Met',
      Unit: 'Met / Not met'
    })
  })

  it('gives the same bytes for the same results', () => {
    const again = renderComparisonXlsx(results, { context: ['Commit abc'] })
    expect(Buffer.compare(again, buffer)).toBe(0)
  })
})

describe('loadScenarioCorpus', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'corpus-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const write = (manifest) =>
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest))

  it('resolves each scenario’s GeoPackage pair against the corpus folder', () => {
    write({
      seed: 1,
      template: 't.xlsx',
      corrections: [],
      recalculated: true,
      scenarios: [
        {
          id: 'net-gain-met',
          purpose: 'net-gain',
          title: 'Met',
          files: {
            baseline: 'net-gain/met-baseline.gpkg',
            postIntervention: 'net-gain/met-post-intervention.gpkg',
            workbook: 'net-gain/met.xlsx'
          },
          metric: { headline: {} }
        }
      ]
    })
    const corpus = loadScenarioCorpus(dir)
    expect(corpus.seed).toBe(1)
    expect(corpus.scenarios[0].files).toEqual({
      baseline: path.join(dir, 'net-gain/met-baseline.gpkg'),
      postIntervention: path.join(dir, 'net-gain/met-post-intervention.gpkg')
    })
  })

  it('refuses a corpus whose workbooks were never recalculated', () => {
    write({ recalculated: false, scenarios: [] })
    expect(() => loadScenarioCorpus(dir)).toThrow(/no metric results/)
  })

  it('needs to be told where the corpus is', () => {
    expect(() => loadScenarioCorpus()).toThrow(/needs a corpus folder/)
  })
})
