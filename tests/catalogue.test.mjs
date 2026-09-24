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

  it('checks the other expectations and settings', () => {
    const doc = catalogue(
      scenario({
        id: 'invalid-area-enhanced',
        size: 0,
        emptyLayers: ['trees', 'ponds', 'trees'],
        expectGain: 'yes',
        expectMetricWarnings: [],
        expectRejectedInputs: ['habitatType']
      })
    )
    expect(problems(doc)).toEqual([
      expect.stringMatching(/size: must be a whole number above 0/),
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
