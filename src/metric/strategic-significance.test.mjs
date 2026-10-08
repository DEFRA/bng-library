import { describe, expect, it } from 'vitest'

import { BaselineLookupError } from './errors.mjs'
import {
  calculateCreatedAreaHabitatPostIntervention,
  calculateEnhancedAreaHabitatPostIntervention,
  calculateRetainedAreaHabitatPostIntervention
} from './post-intervention.mjs'
import {
  calculateCreatedHedgerowPostIntervention,
  calculateEnhancedHedgerowPostIntervention,
  calculateRetainedHedgerowPostIntervention
} from './hedgerow-post-intervention.mjs'
import {
  calculateCreatedWatercoursePostIntervention,
  calculateEnhancedWatercoursePostIntervention,
  calculateRetainedWatercoursePostIntervention
} from './watercourse-post-intervention.mjs'
import {
  isRecognisedStrategicSignificance,
  isValidProposedStrategicSignificance,
  resolveStrategicSignificance
} from './strategic-significance.mjs'

const HIGH = 'Formally identified in local strategy'
// Medium (×1.10) is not supported by the service (BMD-1051): it is not reference
// data, so it is rejected like any other unrecognised value.
const MEDIUM = 'Location ecologically desirable but not in local strategy'
const LOW = 'Area/compensation not in local strategy/ no local strategy'

const HIGH_MULTIPLIER = 1.15
const LOW_MULTIPLIER = 1

const GRASSLAND = 'Grassland - Modified grassland'
const OTHER_NEUTRAL_GRASSLAND = 'Grassland - Other neutral grassland'
const NATIVE_HEDGEROW = 'Native hedgerow'
const DITCHES = 'Ditches'

describe('resolveStrategicSignificance', () => {
  it.each([
    [HIGH, 'High', HIGH_MULTIPLIER],
    [LOW, 'Low', LOW_MULTIPLIER]
  ])('resolves "%s" to %s (×%s)', (label, category, multiplier) => {
    expect(resolveStrategicSignificance(label)).toEqual({
      strategicSignificanceCategory: category,
      strategicSignificanceScore: multiplier
    })
  })

  it.each([
    ['High', HIGH_MULTIPLIER],
    ['high strategic significance ', HIGH_MULTIPLIER],
    ['Low Strategic Significance', LOW_MULTIPLIER],
    ['  formally identified in LOCAL strategy ', HIGH_MULTIPLIER],
    [
      'Area/compensation not in local strategy/no local strategy',
      LOW_MULTIPLIER
    ]
  ])(
    'tolerates category names, case, whitespace and slash spacing: "%s"',
    (label, multiplier) => {
      expect(
        resolveStrategicSignificance(label).strategicSignificanceScore
      ).toBe(multiplier)
    }
  )

  it.each([null, undefined, '', '   '])(
    'resolves an absent value (%j) to Low',
    (value) => {
      expect(resolveStrategicSignificance(value)).toEqual({
        strategicSignificanceCategory: 'Low',
        strategicSignificanceScore: LOW_MULTIPLIER
      })
    }
  )

  it.each([
    ['an unrecognised label', 'Very important'],
    ['Medium, which the service does not support', MEDIUM],
    ['the Medium category name', 'Medium']
  ])('throws BaselineLookupError for %s', (_name, value) => {
    expect(() => resolveStrategicSignificance(value)).toThrow(
      BaselineLookupError
    )
  })

  it('throws BaselineLookupError for a non-string value', () => {
    expect(() => resolveStrategicSignificance(3)).toThrow(BaselineLookupError)
  })
})

describe('isRecognisedStrategicSignificance', () => {
  it.each([HIGH, LOW, 'High', null, undefined, ''])(
    'recognises %j',
    (value) => {
      expect(isRecognisedStrategicSignificance(value)).toBe(true)
    }
  )

  it.each(['Very important', 'N/A', MEDIUM, 'Medium', 42, {}])(
    'rejects %j',
    (value) => {
      expect(isRecognisedStrategicSignificance(value)).toBe(false)
    }
  )
})

// BMD-1051 — what an imported created or enhanced habitat may carry: Low or
// High. A blank is not a value the user supplied, so it is invalid here even
// though the calculators default it to Low.
describe('isValidProposedStrategicSignificance', () => {
  it.each([HIGH, LOW, 'High', 'Low', ' low strategic significance '])(
    'accepts %j',
    (value) => {
      expect(isValidProposedStrategicSignificance(value)).toBe(true)
    }
  )

  it.each([null, undefined, '', '   ', MEDIUM, 'Medium', 'Very important', 42])(
    'rejects %j',
    (value) => {
      expect(isValidProposedStrategicSignificance(value)).toBe(false)
    }
  )
})

// Created and enhanced units are multiplied by the Proposed Strategic
// Significance; retained units carry the baseline value, which is always Low.
// Each case prices the same feature at Low and at the given significance.
describe('post-intervention calculators apply the proposed strategic significance', () => {
  const calculators = {
    'created area habitat': (ss) =>
      calculateCreatedAreaHabitatPostIntervention(
        1,
        GRASSLAND,
        'Moderate',
        0,
        0,
        ss
      ),
    'enhanced area habitat': (ss) =>
      calculateEnhancedAreaHabitatPostIntervention(
        1,
        GRASSLAND,
        OTHER_NEUTRAL_GRASSLAND,
        'Poor',
        'Moderate',
        0,
        0,
        ss
      ),
    'created hedgerow': (ss) =>
      calculateCreatedHedgerowPostIntervention(
        1,
        NATIVE_HEDGEROW,
        'Moderate',
        0,
        0,
        ss
      ),
    'enhanced hedgerow': (ss) =>
      calculateEnhancedHedgerowPostIntervention(
        1,
        1,
        NATIVE_HEDGEROW,
        NATIVE_HEDGEROW,
        'Poor',
        'Good',
        { strategicSignificance: ss }
      ),
    'created watercourse': (ss) =>
      calculateCreatedWatercoursePostIntervention(
        1,
        DITCHES,
        'Moderate',
        'No Encroachment',
        'Minor/ No Encroachment',
        0,
        0,
        ss
      ),
    'enhanced watercourse': (ss) =>
      calculateEnhancedWatercoursePostIntervention(
        1,
        1,
        DITCHES,
        DITCHES,
        'Moderate',
        'Good',
        { strategicSignificance: ss }
      )
  }

  describe.each(Object.entries(calculators))('%s', (_name, calculate) => {
    const lowUnits = calculate(LOW).units

    it.each([
      [HIGH, 'High', HIGH_MULTIPLIER],
      [LOW, 'Low', LOW_MULTIPLIER]
    ])('prices "%s" at ×%s', (label, category, multiplier) => {
      const result = calculate(label)
      expect(result.strategicSignificanceCategory).toBe(category)
      expect(result.strategicSignificanceScore).toBe(multiplier)
      expect(result.units).toBeCloseTo(lowUnits * multiplier, 10)
    })

    it('prices an absent value at Low', () => {
      expect(calculate(undefined).units).toBe(lowUnits)
      expect(calculate(null).strategicSignificanceScore).toBe(LOW_MULTIPLIER)
    })

    it.each([
      ['an unrecognised value', 'Very important'],
      ['Medium', MEDIUM]
    ])('rejects %s', (_name, value) => {
      expect(() => calculate(value)).toThrow(BaselineLookupError)
    })
  })

  it('keeps retained features at Low (×1)', () => {
    expect(
      calculateRetainedAreaHabitatPostIntervention(1, GRASSLAND, 'Moderate')
        .strategicSignificanceScore
    ).toBe(LOW_MULTIPLIER)
    expect(
      calculateRetainedHedgerowPostIntervention(1, NATIVE_HEDGEROW, 'Good')
        .strategicSignificanceScore
    ).toBe(LOW_MULTIPLIER)
    expect(
      calculateRetainedWatercoursePostIntervention(1, DITCHES, 'Good')
        .strategicSignificanceScore
    ).toBe(LOW_MULTIPLIER)
  })
})

// Rows from a Statutory Biodiversity Metric 4.0 workbook recalculated in the
// metric itself (the BMD-1011 scenario intervention/watercourse-retained.xlsx),
// at the stored full precision. See area-trading-rules.worked-example.test.mjs
// for why ten decimal places.
describe('agrees with the metric workbook', () => {
  const DECIMAL_PLACES = 10

  // A-2 H001 in that workbook is created at Medium (×1.10), which the metric
  // prices at 53.788 units. The service does not support Medium, so the engine
  // refuses it rather than agreeing with the metric here (BMD-1051).
  it('A-2 H001: created, Medium strategic significance, is refused', () => {
    expect(() =>
      calculateCreatedAreaHabitatPostIntervention(
        12.4540503463745,
        'Sparsely vegetated land - Other inland rock and scree',
        'Fairly Good',
        0,
        0,
        MEDIUM
      )
    ).toThrow(BaselineLookupError)
  })

  it('A-2 H005: created, High strategic significance', () => {
    const result = calculateCreatedAreaHabitatPostIntervention(
      7.95925502319336,
      'Woodland and forest - Other woodland; broadleaved',
      'Moderate',
      0,
      0,
      HIGH
    )
    expect(result.units).toBeCloseTo(42.9111296536616, DECIMAL_PLACES)
  })
})
