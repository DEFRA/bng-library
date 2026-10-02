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
  resolveStrategicSignificance
} from './strategic-significance.mjs'

const HIGH = 'Formally identified in local strategy'
const MEDIUM = 'Location ecologically desirable but not in local strategy'
const LOW = 'Area/compensation not in local strategy/ no local strategy'

const HIGH_MULTIPLIER = 1.15
const MEDIUM_MULTIPLIER = 1.1
const LOW_MULTIPLIER = 1

const GRASSLAND = 'Grassland - Modified grassland'
const OTHER_NEUTRAL_GRASSLAND = 'Grassland - Other neutral grassland'
const NATIVE_HEDGEROW = 'Native hedgerow'
const DITCHES = 'Ditches'

describe('resolveStrategicSignificance', () => {
  it.each([
    [HIGH, 'High', HIGH_MULTIPLIER],
    [MEDIUM, 'Medium', MEDIUM_MULTIPLIER],
    [LOW, 'Low', LOW_MULTIPLIER]
  ])('resolves "%s" to %s (×%s)', (label, category, multiplier) => {
    expect(resolveStrategicSignificance(label)).toEqual({
      strategicSignificanceCategory: category,
      strategicSignificanceScore: multiplier
    })
  })

  it.each([
    ['High', HIGH_MULTIPLIER],
    ['medium strategic significance ', MEDIUM_MULTIPLIER],
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

  it('throws BaselineLookupError for an unrecognised label', () => {
    expect(() => resolveStrategicSignificance('Very important')).toThrow(
      BaselineLookupError
    )
  })

  it('throws BaselineLookupError for a non-string value', () => {
    expect(() => resolveStrategicSignificance(3)).toThrow(BaselineLookupError)
  })
})

describe('isRecognisedStrategicSignificance', () => {
  it.each([HIGH, MEDIUM, LOW, 'High', null, undefined, ''])(
    'recognises %j',
    (value) => {
      expect(isRecognisedStrategicSignificance(value)).toBe(true)
    }
  )

  it.each(['Very important', 'N/A', 42, {}])('rejects %j', (value) => {
    expect(isRecognisedStrategicSignificance(value)).toBe(false)
  })
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
      [MEDIUM, 'Medium', MEDIUM_MULTIPLIER],
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

    it('rejects an unrecognised value', () => {
      expect(() => calculate('Very important')).toThrow(BaselineLookupError)
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

  it('A-2 H001: created, Medium strategic significance', () => {
    const result = calculateCreatedAreaHabitatPostIntervention(
      12.4540503463745,
      'Sparsely vegetated land - Other inland rock and scree',
      'Fairly Good',
      0,
      0,
      MEDIUM
    )
    expect(result.units).toBeCloseTo(53.7882983392763, DECIMAL_PLACES)
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

  it('C-3 R002: enhanced watercourse, Medium strategic significance', () => {
    const lengthKm = 0.152964683190664
    const result = calculateEnhancedWatercoursePostIntervention(
      lengthKm,
      lengthKm,
      DITCHES,
      DITCHES,
      'Moderate',
      'Good',
      {
        watercourseEncroachment: 'Minor',
        riparianEncroachment: 'Minor/ No Encroachment',
        strategicSignificance: MEDIUM
      }
    )
    expect(result.units).toBeCloseTo(1.51291618661406, DECIMAL_PLACES)
  })
})
