import { describe, expect, it } from 'vitest'

import { BaselineLookupError } from './errors.mjs'
import {
  calculateCumulativeAvailability,
  calculateHabitatNetUnitChanges,
  calculateWatercourseTradingRules,
  combineTradingRuleStatuses,
  resolveWatercourseDistinctiveness,
  sumDeficit,
  sumNetChange,
  sumSurplus,
  TRADING_RULE_MET,
  TRADING_RULE_NOT_MET,
  tradingRuleStatus
} from './trading-rules.mjs'

// Delivered = retained + created + enhanced units per proposed habitat type;
// baseline = baseline units per habitat type. These are the worked-example
// aggregates (2 dp) from the BMD-995 spreadsheet.
//   Ditches (Medium): 15.52 + 10.87 + 14.66 = 41.05 delivered, 28.13 baseline
//   Canals  (Medium):  9.60 +  0.00 +  9.08 = 18.68 delivered, 24.86 baseline
//   Culvert (Low):     0.95 +  0.00 +  0.00 =  0.95 delivered, 22.44 baseline
const WORKED_EXAMPLE_BASELINE_BY_TYPE = {
  Ditches: 28.13,
  Canals: 24.86,
  Culvert: 22.44
}
const WORKED_EXAMPLE_DELIVERED_BY_TYPE = {
  Ditches: 41.05,
  Canals: 18.68,
  Culvert: 0.95
}

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

  it('preserves full precision (no premature rounding to 2 dp)', () => {
    const result = calculateHabitatNetUnitChanges(
      { Ditches: 28.130102 },
      { Ditches: 41.053515 }
    )

    expect(result[0].netUnitChange).toBeCloseTo(12.923413, 6)
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

  it('reproduces the watercourse worked example', () => {
    expect(calculateCumulativeAvailability(12.92, -21.49)).toBe(-8.57)
  })
})

describe('resolveWatercourseDistinctiveness', () => {
  it('maps watercourse types to their statutory band', () => {
    expect(resolveWatercourseDistinctiveness('Ditches').distinctiveness).toBe(
      'Medium'
    )
    expect(resolveWatercourseDistinctiveness('Canals').distinctiveness).toBe(
      'Medium'
    )
    expect(resolveWatercourseDistinctiveness('Culvert').distinctiveness).toBe(
      'Low'
    )
  })

  it('throws for an unknown watercourse type', () => {
    expect(() => resolveWatercourseDistinctiveness('Nope')).toThrow(
      BaselineLookupError
    )
  })
})

describe('calculateWatercourseTradingRules', () => {
  it('reproduces the worked example', () => {
    const result = calculateWatercourseTradingRules(
      WORKED_EXAMPLE_BASELINE_BY_TYPE,
      WORKED_EXAMPLE_DELIVERED_BY_TYPE
    )

    expect(result.habitats).toEqual([
      {
        habitatType: 'Canals',
        distinctiveness: 'Medium',
        netUnitChange: -6.18
      },
      {
        habitatType: 'Culvert',
        distinctiveness: 'Low',
        netUnitChange: -21.49
      },
      {
        habitatType: 'Ditches',
        distinctiveness: 'Medium',
        netUnitChange: 12.92
      }
    ])

    expect(result.medium).toEqual({ surplus: 12.92, deficit: -6.18 })

    expect(result.low).toEqual({
      netChange: -21.49,
      cumulativeAvailability: -8.57
    })
  })

  it('produces zeroed aggregates when there are no watercourses', () => {
    const result = calculateWatercourseTradingRules({}, {})

    expect(result).toEqual({
      habitats: [],
      medium: { surplus: 0, deficit: 0 },
      low: { netChange: 0, cumulativeAvailability: 0 }
    })
  })
})

describe('tradingRuleStatus', () => {
  it('names the two statuses', () => {
    expect(TRADING_RULE_MET).toBe('Met')
    expect(TRADING_RULE_NOT_MET).toBe('Not met')
  })

  it('maps a boolean to a status', () => {
    expect(tradingRuleStatus(true)).toBe(TRADING_RULE_MET)
    expect(tradingRuleStatus(false)).toBe(TRADING_RULE_NOT_MET)
  })
})

describe('combineTradingRuleStatuses', () => {
  it('is Not met when any status is Not met', () => {
    expect(
      combineTradingRuleStatuses([TRADING_RULE_MET, TRADING_RULE_NOT_MET])
    ).toBe(TRADING_RULE_NOT_MET)
  })

  it('is Met when every status is Met', () => {
    expect(
      combineTradingRuleStatuses([TRADING_RULE_MET, TRADING_RULE_MET])
    ).toBe(TRADING_RULE_MET)
  })

  it('is Met for no statuses at all', () => {
    expect(combineTradingRuleStatuses()).toBe(TRADING_RULE_MET)
    expect(combineTradingRuleStatuses([])).toBe(TRADING_RULE_MET)
  })

  it('does not let an underived band decide the aggregate', () => {
    // A null band is one whose preconditions were not met, not one that failed.
    // The caller decides what that means — see AC4, where the area-habitat
    // status is Not met for a reason of its own, not because a band is null.
    expect(combineTradingRuleStatuses([null, TRADING_RULE_MET])).toBe(
      TRADING_RULE_MET
    )
  })
})
