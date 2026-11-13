import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SIZE,
  PURPOSES,
  SCENARIOS,
  parseScenarioCatalogue,
  scenarioInFormat
} from '../src/permutations/catalogue.mjs'
import * as library from '../index.mjs'
import { generatePermutations } from '../index.mjs'

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

  it('accepts the formats a scenario is generated in, and rejects an unknown or repeated one', () => {
    expect(problems(catalogue(scenario({ formats: ['legacy'] })))).toEqual([])
    expect(
      problems(catalogue(scenario({ formats: ['legacy', 'qgis', 'legacy'] })))
    ).toEqual([
      expect.stringMatching(/formats\[1\]: "qgis" is not one of/),
      expect.stringMatching(/formats: "legacy" is listed twice/)
    ])
    expect(problems(catalogue(scenario({ formats: [] })))).toEqual([
      expect.stringMatching(/formats: must be a non-empty list of formats/)
    ])
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

  it('accepts vertical area habitat rows, with only the fields their generator reads', () => {
    const vertical = (row) =>
      catalogue(
        scenario({
          formats: ['bng-service'],
          overrides: { verticalHabitats: [row] }
        })
      )
    expect(
      problems(
        vertical({
          habitatFullName: 'Urban - Facade-bound green wall',
          retention: 'Created',
          baselineCondition: 'Moderate',
          proposedHabitatFullName: 'Urban - Ground based green wall',
          proposedCondition: 'Good',
          area: 0.04
        })
      )
    ).toEqual([])
    expect(
      problems(vertical({ proposedStrategicSignificance: 'High', area: 0 }))
    ).toEqual([
      expect.stringMatching(
        /verticalHabitats\[0\]: unknown field "proposedStrategicSignificance"/
      ),
      expect.stringMatching(
        /verticalHabitats\[0\]\.area: must be a number of hectares above 0/
      )
    ])
  })

  it('requires a scenario pinning vertical area habitats to be BNG Service only', () => {
    const pinned = { verticalHabitats: [{ area: 400 }] }
    const rule =
      /formats: a scenario pinning verticalHabitats must list \["bng-service"\] only/
    expect(problems(catalogue(scenario({ overrides: pinned })))).toEqual([
      expect.stringMatching(rule)
    ])
    expect(
      problems(
        catalogue(
          scenario({ formats: ['legacy', 'bng-service'], overrides: pinned })
        )
      )
    ).toEqual([expect.stringMatching(rule)])
  })

  it('accepts sameLineAs naming an earlier feature of the same layer', () => {
    const doc = catalogue(
      scenario({
        overrides: {
          hedgerows: [{}, { sameLineAs: 'HG001' }],
          rivers: [{}, {}, { sameLineAs: 'R002' }]
        }
      })
    )
    expect(problems(doc)).toEqual([])
  })

  it('rejects sameLineAs naming itself, a later row or another layer', () => {
    const doc = catalogue(
      scenario({
        overrides: {
          hedgerows: [
            { sameLineAs: 'HG001' },
            { sameLineAs: 'HG003' },
            { sameLineAs: 'R001' }
          ]
        }
      })
    )
    expect(problems(doc)).toEqual([
      expect.stringMatching(
        /hedgerows\[0\]\.sameLineAs: must be the ref of an earlier hedgerows row/
      ),
      expect.stringMatching(
        /hedgerows\[1\]\.sameLineAs: must be the ref of an earlier hedgerows row/
      ),
      expect.stringMatching(
        /hedgerows\[2\]\.sameLineAs: must be the ref of an earlier hedgerows row/
      )
    ])
  })

  it('rejects sameLineAs with a lengthRange of its own', () => {
    const doc = catalogue(
      scenario({
        overrides: {
          hedgerows: [{}, { sameLineAs: 'HG001', lengthRange: [300, 400] }]
        }
      })
    )
    expect(problems(doc)).toEqual([
      expect.stringMatching(
        /hedgerows\[1\]: takes the length of the line it copies/
      )
    ])
  })

  it('accepts replants on a Created tree, naming an earlier Lost one', () => {
    const doc = catalogue(
      scenario({
        overrides: {
          trees: [
            { retention: 'Lost' },
            { retention: 'Created', replants: 'T001' }
          ]
        }
      })
    )
    expect(problems(doc)).toEqual([])
  })

  it('rejects replants on a tree that is not Created, or naming a tree that is not an earlier Lost one', () => {
    const doc = catalogue(
      scenario({
        overrides: {
          trees: [
            { retention: 'Lost' },
            { retention: 'Retained', replants: 'T001' },
            { retention: 'Created', replants: 'T002' },
            { retention: 'Created', replants: 'T004' },
            { retention: 'Created', replants: 'HG001' }
          ]
        }
      })
    )
    const earlierLost = /must be the ref of an earlier trees row that is Lost/
    expect(problems(doc)).toEqual([
      expect.stringMatching(
        /trees\[1\]\.replants: only a Created tree is planted in another's place/
      ),
      expect.stringMatching(
        new RegExp(`trees\\[2\\]\\.replants: ${earlierLost.source}`)
      ),
      expect.stringMatching(
        new RegExp(`trees\\[3\\]\\.replants: ${earlierLost.source}`)
      ),
      expect.stringMatching(
        new RegExp(`trees\\[4\\]\\.replants: ${earlierLost.source}`)
      )
    ])
  })

  it('accepts the tree fields on trees only', () => {
    const tree = { treeSize: 'Medium', treeType: 'Native' }
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

  it('accepts a whole-number tree count on trees only, in a legacy-only scenario', () => {
    const tree = { count: 3 }
    const legacy = (overrides) => scenario({ formats: ['legacy'], overrides })
    expect(problems(catalogue(legacy({ trees: [tree] })))).toEqual([])
    expect(problems(catalogue(legacy({ habitats: [tree] })))).toEqual([
      expect.stringMatching(/habitats\[0\]: unknown field "count"/)
    ])
    for (const count of ['3', 0, 2.5]) {
      expect(problems(catalogue(legacy({ trees: [{ count }] })))).toEqual([
        expect.stringMatching(
          /trees\[0\]\.count: must be a whole number above 0/
        )
      ])
    }
  })

  it.each([
    ['in every format', undefined],
    ['in the BNG Service format', ['bng-service']],
    ['in both formats', ['legacy', 'bng-service']]
  ])(
    'refuses a tree count in a scenario generated %s: each BNG Service tree point is one tree',
    (_, formats) => {
      expect(
        problems(
          catalogue(
            scenario({
              ...(formats && { formats }),
              overrides: { trees: [{ count: 1 }] }
            })
          )
        )
      ).toEqual([
        expect.stringMatching(
          /formats: a scenario giving a tree a count must list \["legacy"\] only/
        )
      ])
    }
  )

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
        /\(b\)\.expectTimeToTarget\[0\]\.years: must be a whole number or "30\+"/
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

  it('names the subject layer by its legacy name, or the vertical layer in a BNG Service only scenario', () => {
    const vertical = {
      layer: 'Vertical Area Habitats',
      ref: 'V001',
      note: 'a wall'
    }
    expect(
      problems(
        catalogue(scenario({ formats: ['bng-service'], subject: vertical }))
      )
    ).toEqual([])
    expect(problems(catalogue(scenario({ subject: vertical })))).toEqual([
      expect.stringMatching(
        /subject\.layer: "Vertical Area Habitats" is a BNG Service template layer, so only a scenario listing \["bng-service"\] only may name it/
      )
    ])
    expect(
      problems(
        catalogue(
          scenario({
            subject: { layer: 'Area Habitats', ref: 'H001', note: 'a parcel' }
          })
        )
      )
    ).toEqual([
      expect.stringMatching(/subject\.layer: "Area Habitats" is not one of/)
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

describe('the formats a scenario is generated in', () => {
  it('generates a scenario in every format unless it lists them', () => {
    expect(scenarioInFormat(scenario(), 'bng-service')).toBe(true)
    expect(
      scenarioInFormat(scenario({ formats: ['legacy'] }), 'bng-service')
    ).toBe(false)
    expect(scenarioInFormat(scenario({ formats: ['legacy'] }), 'legacy')).toBe(
      true
    )
  })

  it('keeps the tree count scenario legacy only, until the service decides how several trees at one point are recorded', () => {
    const ids = (format) =>
      generatePermutations({
        format,
        only: 'trees',
        manifestOnly: true
      }).scenarios.map((s) => s.id)
    expect(ids('legacy')).toContain('trees-count-above-one')
    expect(ids('bng-service')).not.toContain('trees-count-above-one')
  })
})

describe('the vertical area habitat scenario (BMD-1084)', () => {
  const [vertical] = generatePermutations({
    format: 'bng-service',
    only: 'vertical-area',
    manifestOnly: true
  }).scenarios

  it('is generated in the BNG Service format only', () => {
    expect(vertical.id).toBe('vertical-area-every-retention')
    expect(
      generatePermutations({
        format: 'legacy',
        only: 'vertical-area',
        manifestOnly: true
      }).scenarios
    ).toEqual([])
  })

  it('pins a Retained 0.04 ha (400 m²) wall, and one wall at each other retention', () => {
    const rows = SCENARIOS.find((s) => s.id === vertical.id).overrides
      .verticalHabitats
    expect(rows[0]).toMatchObject({ retention: 'Retained', area: 0.04 })
    expect(rows.map((row) => row.retention)).toEqual([
      'Retained',
      'Enhanced',
      'Created',
      'Lost'
    ])
  })
})

describe('the formats rule, for consumers of the catalogue', () => {
  it('is exported from the package, as the catalogue is', () => {
    expect(library.scenarioInFormat).toBe(scenarioInFormat)
    expect(library.PERMUTATION_SCENARIOS).toBe(SCENARIOS)
  })
})
