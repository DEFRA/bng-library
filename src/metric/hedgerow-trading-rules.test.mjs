import { describe, expect, it } from 'vitest'

import { calculateHedgerowTradingRules } from './hedgerow-trading-rules.mjs'

// One real reference type per band, so the band comes from the reference data
// rather than from the test.
const MEDIUM_A = 'Species-rich native hedgerow'
const MEDIUM_B = 'Native hedgerow with trees'
const LOW_A = 'Native hedgerow'
const LOW_B = 'Line of trees'
const VERY_LOW = 'Non-native and ornamental hedgerow'
const HIGH = 'Species-rich native hedgerow with trees'
const VERY_HIGH =
  'Species-rich native hedgerow with trees - associated with bank or ditch'

describe('calculateHedgerowTradingRules', () => {
  it('returns zeroed bands and no habitat types for empty input', () => {
    expect(calculateHedgerowTradingRules()).toEqual({
      habitatTypes: [],
      medium: { netUnitChange: 0 },
      low: { netUnitChange: 0, cumulativeAvailability: 0 },
      veryLow: { netUnitChange: 0, cumulativeAvailability: 0 }
    })
  })

  it('reports no change when every hedgerow is retained as it was', () => {
    const units = { [MEDIUM_A]: 2.2, [LOW_A]: 1, [VERY_LOW]: 0.5 }
    const result = calculateHedgerowTradingRules(units, units)

    expect(result.habitatTypes.map((h) => h.netUnitChange)).toEqual([0, 0, 0])
    expect(result.medium.netUnitChange).toBe(0)
    expect(result.low).toEqual({ netUnitChange: 0, cumulativeAvailability: 0 })
    expect(result.veryLow).toEqual({
      netUnitChange: 0,
      cumulativeAvailability: 0
    })
  })

  it('treats a created-only type as having zero baseline units', () => {
    const result = calculateHedgerowTradingRules({}, { [MEDIUM_B]: 0.8 })

    expect(result.habitatTypes).toEqual([
      { habitatType: MEDIUM_B, distinctiveness: 'Medium', netUnitChange: 0.8 }
    ])
    expect(result.medium.netUnitChange).toBe(0.8)
    expect(result.low.cumulativeAvailability).toBe(0.8)
    expect(result.veryLow.cumulativeAvailability).toBe(0.8)
  })

  it('attributes an enhancement across bands to the delivered type', () => {
    // A Low hedgerow enhanced into a Medium one: the Low type loses its whole
    // baseline and the Medium type gains the enhanced units.
    const result = calculateHedgerowTradingRules(
      { [LOW_A]: 2.2 },
      { [MEDIUM_A]: 1.5 }
    )

    expect(result.medium.netUnitChange).toBe(1.5)
    expect(result.low.netUnitChange).toBe(-2.2)
    expect(result.low.cumulativeAvailability).toBeCloseTo(-0.7, 12)
  })

  it('nets the Medium band rather than taking its surplus', () => {
    // +5 and -5 cancel: nothing is available to the Low band. Carrying the
    // surplus (as area habitats and watercourses do) would report +2 here.
    const result = calculateHedgerowTradingRules(
      { [MEDIUM_B]: 5, [LOW_A]: 3 },
      { [MEDIUM_A]: 5 }
    )

    expect(result.medium.netUnitChange).toBe(0)
    expect(result.low.cumulativeAvailability).toBe(-3)
  })

  it('does not carry a Medium deficit down to the Low band', () => {
    const result = calculateHedgerowTradingRules(
      { [MEDIUM_A]: 1, [VERY_LOW]: 0.2 },
      { [LOW_A]: 0.5 }
    )

    expect(result.medium.netUnitChange).toBe(-1)
    expect(result.low).toEqual({
      netUnitChange: 0.5,
      cumulativeAvailability: 0.5
    })
    expect(result.veryLow).toEqual({
      netUnitChange: -0.2,
      cumulativeAvailability: 0.3
    })
  })

  it('cascades a positive Medium net through Low into Very Low', () => {
    const result = calculateHedgerowTradingRules(
      { [LOW_A]: 0.5, [VERY_LOW]: 1 },
      { [MEDIUM_A]: 2 }
    )

    expect(result.low.cumulativeAvailability).toBe(1.5)
    expect(result.veryLow.cumulativeAvailability).toBe(0.5)
  })

  it('does not carry a negative Low cumulative availability into Very Low', () => {
    const result = calculateHedgerowTradingRules(
      { [MEDIUM_A]: 1, [LOW_A]: 2, [VERY_LOW]: 0.5 },
      { [MEDIUM_A]: 2, [VERY_LOW]: 0.15 }
    )

    // Low: -2 + 1 = -1, so nothing reaches Very Low.
    expect(result.low.cumulativeAvailability).toBe(-1)
    expect(result.veryLow).toEqual({
      netUnitChange: -0.35,
      cumulativeAvailability: -0.35
    })
  })

  it('carries nothing from a band that nets to exactly zero', () => {
    const result = calculateHedgerowTradingRules(
      { [MEDIUM_A]: 1, [LOW_A]: 1 },
      { [MEDIUM_A]: 1, [LOW_B]: 0.4 }
    )

    expect(result.medium.netUnitChange).toBe(0)
    expect(result.low.cumulativeAvailability).toBeCloseTo(-0.6, 12)
  })

  it('leaves High, Very High and unrecognised types out of every figure', () => {
    const result = calculateHedgerowTradingRules(
      { [HIGH]: 10, [VERY_HIGH]: 10, 'Not a hedgerow': 10 },
      { [MEDIUM_A]: 1 }
    )

    expect(result.habitatTypes.map((h) => h.habitatType)).toEqual([MEDIUM_A])
    expect(result.medium.netUnitChange).toBe(1)
    expect(result.low.cumulativeAvailability).toBe(1)
  })

  it('does not treat inherited object keys as reference types', () => {
    const result = calculateHedgerowTradingRules({ toString: 1 }, {})
    expect(result.habitatTypes).toEqual([])
  })

  it('labels the Very Low band as the reference data spells it', () => {
    const [habitat] = calculateHedgerowTradingRules(
      { [VERY_LOW]: 0.5 },
      {}
    ).habitatTypes
    expect(habitat.distinctiveness).toBe('V.Low')
  })

  it('orders habitat types by name', () => {
    const result = calculateHedgerowTradingRules(
      { [VERY_LOW]: 1, [MEDIUM_A]: 1, [LOW_A]: 1 },
      {}
    )
    expect(result.habitatTypes.map((h) => h.habitatType)).toEqual([
      LOW_A,
      VERY_LOW,
      MEDIUM_A
    ])
  })
})
