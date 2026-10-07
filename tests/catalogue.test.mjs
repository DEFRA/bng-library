import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SIZE,
  PURPOSES,
  SCENARIOS,
  parseScenarioCatalogue
} from '../src/permutations/catalogue.mjs'

const shipped = JSON.parse(
  readFileSync(
    new URL('../src/permutations/scenarios.json', import.meta.url),
    'utf8'
  )
)

function scenario(fields = {}) {
  return {
    id: 'area-enhanced',
    purpose: 'intervention',
    title: 'Area habitat — Enhanced',
    description: 'One parcel is enhanced.',
    subject: { layer: 'Habitats', ref: 'H001', note: 'an enhanced parcel' },
    ...fields
  }
}

function catalogue(...scenarios) {
  return { defaultSize: 6, scenarios }
}

/** The problems reported for a catalogue, one per line. */
function problems(doc) {
  try {
    parseScenarioCatalogue(doc)
  } catch (error) {
    return error.message
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
  }
  return []
}

describe('scenarios.json', () => {
  it('loads every shipped scenario', () => {
    expect(SCENARIOS).toEqual(shipped.scenarios)
    expect(DEFAULT_SIZE).toBe(shipped.defaultSize)
    expect(PURPOSES).toEqual([...new Set(SCENARIOS.map((s) => s.purpose))])
  })
})

describe('parseScenarioCatalogue', () => {
  it('accepts a minimal scenario, and a $comment on scenarios and rows', () => {
    const doc = catalogue(
      scenario({
        $comment: 'why this scenario exists',
        overrides: {
          hedgerows: [
            { $comment: 'long enough to matter', lengthRange: [300, 400] }
          ]
        }
      })
    )
    expect(problems(doc)).toEqual([])
    expect(parseScenarioCatalogue(doc).purposes).toEqual(['intervention'])
  })

  it('rejects a misspelt field instead of ignoring it', () => {
    expect(problems(catalogue(scenario({ expectGian: 'met' })))).toEqual([
      expect.stringMatching(
        /^scenarios\[0\] \(area-enhanced\): unknown field "expectGian"/
      )
    ])
  })

  it('rejects an override field the generator does not recognise', () => {
    const doc = catalogue(
      scenario({ overrides: { habitats: [{ habitatName: 'Grassland' }] } })
    )
    expect(problems(doc)).toEqual([
      expect.stringMatching(
        /overrides\.habitats\[0\]: unknown field "habitatName"/
      )
    ])
  })

  it('rejects a layer-specific field on the wrong layer', () => {
    const doc = catalogue(
      scenario({ overrides: { habitats: [{ lengthRange: [300, 400] }] } })
    )
    expect(problems(doc)).toEqual([
      expect.stringMatching(/habitats\[0\]: unknown field "lengthRange"/)
    ])
  })

  it('accepts the tree fields on trees only', () => {
    const tree = { treeSize: 'Medium', treeType: 'Street tree' }
    expect(
      problems(catalogue(scenario({ overrides: { trees: [tree] } })))
    ).toEqual([])
    expect(
      problems(catalogue(scenario({ overrides: { habitats: [tree] } })))
    ).toEqual([
      expect.stringMatching(/habitats\[0\]: unknown field "treeSize"/),
      expect.stringMatching(/habitats\[0\]: unknown field "treeType"/)
    ])
  })

  it('accepts a whole-number tree count on trees only', () => {
    const tree = { count: 3 }
    expect(
      problems(catalogue(scenario({ overrides: { trees: [tree] } })))
    ).toEqual([])
    expect(
      problems(catalogue(scenario({ overrides: { habitats: [tree] } })))
    ).toEqual([expect.stringMatching(/habitats\[0\]: unknown field "count"/)])
    for (const count of ['3', 0, 2.5]) {
      expect(
        problems(catalogue(scenario({ overrides: { trees: [{ count }] } })))
      ).toEqual([
        expect.stringMatching(
          /trees\[0\]\.count: must be a whole number above 0/
        )
      ])
    }
  })

  it('checks override values', () => {
    const doc = catalogue(
      scenario({
        overrides: {
          rivers: [{ lengthRange: [400, 300], incomplete: 'yes', riverType: 3 }]
        }
      })
    )
    expect(problems(doc)).toEqual([
      expect.stringMatching(/rivers\[0\]\.lengthRange: must be \[min, max\]/),
      expect.stringMatching(/rivers\[0\]\.incomplete: must be true or false/),
      expect.stringMatching(/rivers\[0\]\.riverType: must be text/)
    ])
  })

  it('allows only the strategic significance the LNRS guidance does', () => {
    const LOW = 'Area/compensation not in local strategy/ no local strategy'
    const MEDIUM = 'Location ecologically desirable but not in local strategy'
    const HIGH = 'Formally identified in local strategy'
    const doc = catalogue(
      scenario({
        overrides: {
          habitats: [
            {
              baselineStrategicSignificance: LOW,
              proposedStrategicSignificance: HIGH
            },
            { proposedStrategicSignificance: LOW },
            {
              baselineStrategicSignificance: HIGH,
              proposedStrategicSignificance: MEDIUM
            }
          ]
        }
      })
    )
    expect(problems(doc)).toEqual([
      expect.stringMatching(
        /habitats\[2\]\.baselineStrategicSignificance: "Formally identified in local strategy" is not one of/
      ),
      expect.stringMatching(
        /habitats\[2\]\.proposedStrategicSignificance: "Location ecologically desirable but not in local strategy" is not one of/
      )
    ])
  })

  it('checks trading expectations band by band', () => {
    const doc = catalogue(
      scenario({
        expectTrading: {
          area: { Medium: 'breached', 'Very Low': 'met' },
          watercourse: { Low: 'failed' },
          trees: {}
        }
      })
    )
    expect(problems(doc)).toEqual([
      expect.stringMatching(/expectTrading: unknown field "trees"/),
      expect.stringMatching(/expectTrading\.area: unknown field "Very Low"/),
      expect.stringMatching(
        /expectTrading\.watercourse\.Low: "failed" is not one of "met", "breached"/
      )
    ])
  })

  it('checks a unit order expectation', () => {
    const doc = catalogue(
      scenario({
        id: 'a',
        expectUnitOrder: { stage: 'planted', references: ['T001'], by: 'x' }
      }),
      scenario({
        id: 'b',
        expectUnitOrder: { stage: 'created', references: ['T001', 'T001'] }
      }),
      scenario({
        id: 'c',
        expectUnitOrder: { stage: 'created', references: ['T002', 'T001'] }
      })
    )
    expect(problems(doc)).toEqual([
      expect.stringMatching(/\(a\)\.expectUnitOrder: unknown field "by"/),
      expect.stringMatching(
        /\(a\)\.expectUnitOrder\.stage: "planted" is not one of/
      ),
      expect.stringMatching(
        /\(a\)\.expectUnitOrder\.references: must list at least two features/
      ),
      expect.stringMatching(
        /\(b\)\.expectUnitOrder\.references: "T001" is listed twice/
      )
    ])
  })

  it('checks a units equal expectation', () => {
    const doc = catalogue(
      scenario({
        id: 'a',
        expectUnitsEqual: { stage: 'created', references: ['T001'] }
      }),
      scenario({
        id: 'b',
        expectUnitsEqual: { stage: 'created', references: ['T001', 'T003'] }
      })
    )
    expect(problems(doc)).toEqual([
      expect.stringMatching(
        /\(a\)\.expectUnitsEqual\.references: must list at least two features/
      )
    ])
  })

  it('checks a unit ratio expectation', () => {
    const ratio = { stage: 'created', reference: 'T003', control: 'T005' }
    const doc = catalogue(
      scenario({ id: 'a', expectUnitRatio: { ...ratio, factor: 2 } }),
      scenario({
        id: 'b',
        expectUnitRatio: [
          { stage: 'planted', reference: 'T003', control: 'T003', by: 'x' },
          { ...ratio, factor: 0 },
          { ...ratio, factor: '2' }
        ]
      }),
      scenario({ id: 'c', expectUnitRatio: [{ ...ratio, factor: 2 }] })
    )
    expect(problems(doc)).toEqual([
      expect.stringMatching(/\(a\)\.expectUnitRatio: must be a non-empty list/),
      expect.stringMatching(/\(b\)\.expectUnitRatio\[0\]: unknown field "by"/),
      expect.stringMatching(
        /\(b\)\.expectUnitRatio\[0\]\.stage: "planted" is not one of/
      ),
      expect.stringMatching(
        /\(b\)\.expectUnitRatio\[0\]\.control: must differ from reference/
      ),
      expect.stringMatching(
        /\(b\)\.expectUnitRatio\[0\]\.factor: must be a number above 0/
      ),
      expect.stringMatching(
        /\(b\)\.expectUnitRatio\[1\]\.factor: must be a number above 0/
      ),
      expect.stringMatching(
        /\(b\)\.expectUnitRatio\[2\]\.factor: must be a number above 0/
      ),
      expect.stringMatching(
        /\(b\)\.expectUnitRatio: created T003 is listed twice/
      )
    ])
  })

  it('checks a time to target expectation', () => {
    const entry = {
      stage: 'created',
      references: ['H001'],
      years: '30+',
      multiplier: 0.3197967361
    }
    const doc = catalogue(
      scenario({ id: 'a', expectTimeToTarget: [] }),
      scenario({
        id: 'b',
        expectTimeToTarget: [
          { ...entry, stage: 'baseline', years: 30.5, multiplier: 1.2 },
          { ...entry, references: [], by: 'x' }
        ]
      }),
      scenario({ id: 'c', expectTimeToTarget: [entry, entry] }),
      scenario({
        id: 'd',
        expectTimeToTarget: [entry, { ...entry, years: 25, references: ['H2'] }]
      })
    )
    expect(problems(doc)).toEqual([
      expect.stringMatching(
        /\(a\)\.expectTimeToTarget: must be a non-empty list/
      ),
      expect.stringMatching(
        /\(b\)\.expectTimeToTarget\[0\]\.stage: "baseline" is not one of "created", "enhanced"/
      ),
      expect.stringMatching(
        /\(b\)\.expectTimeToTarget\[0\]\.years: must be a whole number above 0 or "30\+"/
      ),
      expect.stringMatching(
        /\(b\)\.expectTimeToTarget\[0\]\.multiplier: must be a number above 0, at most 1/
      ),
      expect.stringMatching(
        /\(b\)\.expectTimeToTarget\[1\]: unknown field "by"/
      ),
      expect.stringMatching(
        /\(b\)\.expectTimeToTarget\[1\]\.references: must be a non-empty list/
      ),
      expect.stringMatching(
        /\(c\)\.expectTimeToTarget: created H001 is listed twice/
      )
    ])
  })

  it('checks the other expectations and settings', () => {
    const doc = catalogue(
      scenario({
        id: 'invalid-area-enhanced',
        size: 0,
        treeCount: 1.5,
        emptyLayers: ['trees', 'ponds', 'trees'],
        expectGain: 'yes',
        expectMetricWarnings: [],
        expectRejectedInputs: ['habitatType']
      })
    )
    expect(problems(doc)).toEqual([
      expect.stringMatching(/size: must be a whole number above 0/),
      expect.stringMatching(/treeCount: must be a whole number above 0/),
      expect.stringMatching(/emptyLayers\[1\]: "ponds" is not one of/),
      expect.stringMatching(/emptyLayers: "trees" is listed twice/),
      expect.stringMatching(/expectGain: "yes" is not one of "met", "unmet"/),
      expect.stringMatching(/expectMetricWarnings: must be a non-empty list/),
      expect.stringMatching(
        /expectRejectedInputs\[0\]: "habitatType" is not valid/
      )
    ])
  })

  it('requires the descriptive fields and a subject, and kebab-case ids', () => {
    const doc = catalogue(
      scenario({
        id: 'Area Enhanced',
        title: '',
        subject: { layer: 'Habitats' }
      })
    )
    expect(problems(doc)).toEqual([
      expect.stringMatching(/\.title: is required text/),
      expect.stringMatching(/\.id: must be kebab-case/),
      expect.stringMatching(/\.subject\.ref: is required text/),
      expect.stringMatching(/\.subject\.note: is required text/)
    ])
  })

  it('requires an invalid- scenario to declare its errors, and no other to', () => {
    const doc = catalogue(
      scenario({ id: 'invalid-quiet' }),
      scenario({ id: 'noisy', expectMetricWarnings: ['No enhancement'] }),
      scenario({
        id: 'invalid-declared',
        expectRejectedInputs: ['habitatEnhancement.condition']
      })
    )
    expect(problems(doc)).toEqual([
      expect.stringMatching(
        /^scenarios\[0\] \(invalid-quiet\): an "invalid-" scenario must declare the errors it expects/
      ),
      expect.stringMatching(
        /^scenarios\[1\] \(noisy\)\.expectMetricWarnings: only a scenario whose id starts "invalid-" may expect errors/
      )
    ])
  })

  it('rejects a repeated id', () => {
    expect(problems(catalogue(scenario(), scenario()))).toEqual([
      expect.stringMatching(
        /^scenarios\[1\] \(area-enhanced\): id "area-enhanced" is used by an earlier scenario/
      )
    ])
  })

  it('checks the file itself, and reports every problem at once', () => {
    expect(problems({ scenarios: [], extra: 1 })).toEqual([
      expect.stringMatching(/the file: unknown field "extra"/),
      'defaultSize: must be a whole number above 0',
      'scenarios: must be a non-empty list'
    ])
    expect(() => parseScenarioCatalogue(null, 'my.json')).toThrow(
      /^my\.json has 1 problem\(s\)/
    )
    expect(() => parseScenarioCatalogue(null)).toThrow(
      expect.objectContaining({ name: 'ScenarioCatalogueError' })
    )
  })
})
