import { describe, expect, it } from 'vitest'

import {
  calculateCumulativeAvailability,
  calculateHabitatNetUnitChanges,
  sumDeficit,
  sumNetChange,
  sumSurplus
} from './trading-rules.mjs'

describe('calculateHabitatNetUnitChanges', () => {
  it('returns delivered minus baseline for every type on either side', () => {
    const result = calculateHabitatNetUnitChanges(
      { 'Lakes - Reservoirs': 10, 'Grassland - Bracken': 4 },
      { 'Lakes - Reservoirs': 12, 'Urban - Allotments': 3 }
    )

    expect(result).toEqual([
      { habitatType: 'Grassland - Bracken', netUnitChange: -4 },
      { habitatType: 'Lakes - Reservoirs', netUnitChange: 2 },
      { habitatType: 'Urban - Allotments', netUnitChange: 3 }
    ])
  })

  it('orders entries by habitat type', () => {
    const result = calculateHabitatNetUnitChanges(
      { Zebra: 1, Apple: 1 },
      { Mango: 1 }
    )

    expect(result.map((entry) => entry.habitatType)).toEqual([
      'Apple',
      'Mango',
      'Zebra'
    ])
  })

  it('treats a non-finite total as zero rather than producing NaN', () => {
    const result = calculateHabitatNetUnitChanges(
      { 'Lakes - Reservoirs': null },
      { 'Lakes - Reservoirs': 5 }
    )

    expect(result).toEqual([
      { habitatType: 'Lakes - Reservoirs', netUnitChange: 5 }
    ])
  })

  it('rounds away floating-point artefacts', () => {
    const result = calculateHabitatNetUnitChanges(
      { 'Lakes - Reservoirs': 0.1 },
      { 'Lakes - Reservoirs': 0.3 }
    )

    expect(result[0].netUnitChange).toBe(0.2)
  })

  it('returns an empty list when neither side has habitats', () => {
    expect(calculateHabitatNetUnitChanges()).toEqual([])
  })
})

describe('sumSurplus', () => {
  it('sums only the strictly positive changes', () => {
    expect(sumSurplus([3, -5, 2, 0])).toBe(5)
  })

  it('is zero when nothing is in surplus', () => {
    expect(sumSurplus([-3, -2, 0])).toBe(0)
    expect(sumSurplus()).toBe(0)
  })
})

describe('sumDeficit', () => {
  it('sums only the strictly negative changes', () => {
    expect(sumDeficit([3, -5, 2, -1, 0])).toBe(-6)
  })

  it('is zero when nothing is in deficit', () => {
    expect(sumDeficit([3, 2, 0])).toBe(0)
    expect(sumDeficit()).toBe(0)
  })
})

describe('sumNetChange', () => {
  it('sums every change regardless of sign', () => {
    expect(sumNetChange([3, -5, 2])).toBe(0)
  })

  it('is zero for no changes', () => {
    expect(sumNetChange()).toBe(0)
  })
})

describe('calculateCumulativeAvailability', () => {
  it('adds the lower band net change to the higher band surplus', () => {
    expect(calculateCumulativeAvailability(8, -3)).toBe(5)
  })

  it('can go negative when the lower band deficit exceeds the surplus', () => {
    expect(calculateCumulativeAvailability(2, -6)).toBe(-4)
  })
})
