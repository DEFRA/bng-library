import { describe, expect, it } from 'vitest'

import {
  broadHabitatOf,
  calculateAreaHabitatTradingRules,
  MERGED_INTERTIDAL_BROAD_HABITAT
} from './area-trading-rules.mjs'

// Real reference keys, so the bands under test are the ones the engine resolves.
const NEUTRAL_GRASSLAND = 'Grassland - Other neutral grassland' // Medium
const UPLAND_ACID_GRASSLAND = 'Grassland - Upland acid grassland' // Medium
const ARABLE_MARGINS = 'Cropland - Arable field margins tussocky' // Medium
const RESERVOIRS = 'Lakes - Reservoirs' // Medium
const URBAN_TREE = 'Individual trees - Urban tree' // Medium
const LITTORAL_SAND = 'Intertidal sediment - Littoral sand' // Medium
const LITTORAL_COARSE = 'Intertidal sediment - Littoral coarse sediment' // Medium
const IGGI =
  'Intertidal hard structures - Artificial hard structures with integrated greening of grey infrastructure (IGGI)' // Medium

const MODIFIED_GRASSLAND = 'Grassland - Modified grassland' // Low
const ALLOTMENTS = 'Urban - Allotments' // Low
const ARTIFICIAL_FEATURES =
  'Intertidal hard structures - Artificial features of hard structures' // Low
const ARTIFICIAL_LITTORAL_MUD = 'Intertidal sediment - Artificial littoral mud' // Low

const SEALED_SURFACE = 'Urban - Developed land; sealed surface' // V.Low
const CALCAREOUS_GRASSLAND = 'Grassland - Lowland calcareous grassland' // High

describe('broadHabitatOf', () => {
  it('splits on the first separator only', () => {
    expect(
      broadHabitatOf('Intertidal sediment - Littoral biogenic reefs - Mussels')
    ).toBe('Intertidal sediment')
    expect(
      broadHabitatOf(
        'Rocky shore - High energy littoral rock - on peat, clay or chalk'
      )
    ).toBe('Rocky shore')
  })

  it('returns the whole key when it carries no separator', () => {
    expect(broadHabitatOf('Watercourse footprint')).toBe(
      'Watercourse footprint'
    )
  })

  it('returns an empty string for a non-string key', () => {
    expect(broadHabitatOf(undefined)).toBe('')
  })
})

describe('calculateAreaHabitatTradingRules', () => {
  // Baseline and post-intervention for one project, chosen so that Grassland's
  // two Medium habitats offset each other exactly — the case that separates
  // aggregating per broad habitat (AC2) from aggregating per habitat.
  const baselineUnitsByType = {
    [NEUTRAL_GRASSLAND]: 10,
    [ARABLE_MARGINS]: 5,
    [RESERVOIRS]: 4,
    [MODIFIED_GRASSLAND]: 8,
    [SEALED_SURFACE]: 3
  }
  const deliveredUnitsByType = {
    [NEUTRAL_GRASSLAND]: 4,
    [UPLAND_ACID_GRASSLAND]: 6,
    [ARABLE_MARGINS]: 9,
    [RESERVOIRS]: 1,
    [MODIFIED_GRASSLAND]: 2,
    [ALLOTMENTS]: 2,
    [URBAN_TREE]: 3,
    [SEALED_SURFACE]: 3
  }

  const result = calculateAreaHabitatTradingRules(
    baselineUnitsByType,
    deliveredUnitsByType
  )

  it('AC1 — nets each unique habitat, keeping Medium and Low only', () => {
    expect(result.habitatTypes).toEqual([
      {
        habitatType: ARABLE_MARGINS,
        broadHabitat: 'Cropland',
        tradingBroadHabitat: 'Cropland',
        distinctiveness: 'Medium',
        netUnitChange: 4
      },
      {
        habitatType: MODIFIED_GRASSLAND,
        broadHabitat: 'Grassland',
        tradingBroadHabitat: 'Grassland',
        distinctiveness: 'Low',
        netUnitChange: -6
      },
      {
        habitatType: NEUTRAL_GRASSLAND,
        broadHabitat: 'Grassland',
        tradingBroadHabitat: 'Grassland',
        distinctiveness: 'Medium',
        netUnitChange: -6
      },
      {
        habitatType: UPLAND_ACID_GRASSLAND,
        broadHabitat: 'Grassland',
        tradingBroadHabitat: 'Grassland',
        distinctiveness: 'Medium',
        netUnitChange: 6
      },
      {
        habitatType: URBAN_TREE,
        broadHabitat: 'Individual trees',
        tradingBroadHabitat: 'Individual trees',
        distinctiveness: 'Medium',
        netUnitChange: 3
      },
      {
        habitatType: RESERVOIRS,
        broadHabitat: 'Lakes',
        tradingBroadHabitat: 'Lakes',
        distinctiveness: 'Medium',
        netUnitChange: -3
      },
      {
        habitatType: ALLOTMENTS,
        broadHabitat: 'Urban',
        tradingBroadHabitat: 'Urban',
        distinctiveness: 'Low',
        netUnitChange: 2
      }
    ])
  })

  it('AC1 — excludes Very Low habitats, which hold no units to trade', () => {
    expect(
      result.habitatTypes.some(
        (habitat) => habitat.habitatType === SEALED_SURFACE
      )
    ).toBe(false)
  })

  it('AC2 — cumulates Medium net changes per broad habitat', () => {
    expect(result.medium.broadHabitats).toEqual([
      { broadHabitat: 'Cropland', netUnitChange: 4 },
      { broadHabitat: 'Grassland', netUnitChange: 0 },
      { broadHabitat: 'Individual trees', netUnitChange: 3 },
      { broadHabitat: 'Lakes', netUnitChange: -3 }
    ])
  })

  it('AC2 — habitats can be grouped by tradingBroadHabitat to match the broad habitat rows', () => {
    // A consumer rendering habitats under their broad-habitat row must not have
    // to re-implement the intertidal merge to do it.
    const grouped = new Map()
    for (const habitat of result.habitatTypes) {
      if (habitat.distinctiveness !== 'Medium') {
        continue
      }
      grouped.set(
        habitat.tradingBroadHabitat,
        (grouped.get(habitat.tradingBroadHabitat) ?? 0) + habitat.netUnitChange
      )
    }

    expect([...grouped.keys()].sort()).toEqual(
      result.medium.broadHabitats.map((entry) => entry.broadHabitat)
    )
    for (const entry of result.medium.broadHabitats) {
      expect(grouped.get(entry.broadHabitat)).toBeCloseTo(
        entry.netUnitChange,
        10
      )
    }
  })

  it('AC4 — totals only the broad habitats in surplus', () => {
    // Cropland +4 and Individual trees +3. Grassland's +6 does not count: it is
    // cancelled by the -6 in the same broad habitat before the surplus is taken.
    expect(result.medium.surplus).toBe(7)
  })

  it('AC5 — totals only the broad habitats in deficit', () => {
    expect(result.medium.deficit).toBe(-3)
  })

  it('AC6 — nets the Low band across the band, not per broad habitat', () => {
    expect(result.low.netUnitChange).toBe(-4)
  })

  it('AC7 — cumulative availability is the Medium surplus plus the Low net change', () => {
    expect(result.low.cumulativeAvailability).toBe(3)
  })
})

describe('calculateAreaHabitatTradingRules — intertidal merge (AC3)', () => {
  it('cumulates both intertidal broad habitats into a single entry', () => {
    const result = calculateAreaHabitatTradingRules(
      { [LITTORAL_SAND]: 5 },
      { [LITTORAL_COARSE]: 2, [IGGI]: 6 }
    )

    expect(result.medium.broadHabitats).toEqual([
      { broadHabitat: MERGED_INTERTIDAL_BROAD_HABITAT, netUnitChange: 3 }
    ])
    expect(result.medium.surplus).toBe(3)
    expect(result.medium.deficit).toBe(0)
  })

  it('keeps the un-merged broad habitat on each habitat entry', () => {
    const result = calculateAreaHabitatTradingRules({}, { [IGGI]: 1 })

    expect(result.habitatTypes[0].broadHabitat).toBe(
      'Intertidal hard structures'
    )
  })

  it('does not merge a Low intertidal habitat into the Medium group', () => {
    const result = calculateAreaHabitatTradingRules(
      {},
      { [ARTIFICIAL_FEATURES]: 4 }
    )

    expect(result.medium.broadHabitats).toEqual([])
    expect(result.low.netUnitChange).toBe(4)
  })

  it('leaves a Low intertidal habitat its ordinary trading broad habitat', () => {
    // The merge is Medium-only, so a consumer grouping every returned habitat
    // by tradingBroadHabitat must not find a Low habitat under the merged
    // Medium label. Both intertidal broad habitats carry Low types.
    const result = calculateAreaHabitatTradingRules(
      {},
      { [ARTIFICIAL_FEATURES]: 4, [ARTIFICIAL_LITTORAL_MUD]: 2 }
    )

    expect(
      result.habitatTypes.map((habitat) => [
        habitat.habitatType,
        habitat.tradingBroadHabitat
      ])
    ).toEqual([
      [ARTIFICIAL_FEATURES, 'Intertidal hard structures'],
      [ARTIFICIAL_LITTORAL_MUD, 'Intertidal sediment']
    ])
    expect(
      result.habitatTypes.some(
        (habitat) =>
          habitat.tradingBroadHabitat === MERGED_INTERTIDAL_BROAD_HABITAT
      )
    ).toBe(false)
  })

  it('merges a Medium intertidal habitat sharing a broad habitat with a Low one', () => {
    // Both bands present in Intertidal sediment: only the Medium entry moves to
    // the merged key, pinning the boundary from both sides in one data set.
    const result = calculateAreaHabitatTradingRules(
      {},
      { [LITTORAL_SAND]: 5, [ARTIFICIAL_LITTORAL_MUD]: 2 }
    )

    const tradingKeyFor = (habitatType) =>
      result.habitatTypes.find((habitat) => habitat.habitatType === habitatType)
        .tradingBroadHabitat

    expect(tradingKeyFor(LITTORAL_SAND)).toBe(MERGED_INTERTIDAL_BROAD_HABITAT)
    expect(tradingKeyFor(ARTIFICIAL_LITTORAL_MUD)).toBe('Intertidal sediment')
    expect(result.medium.broadHabitats).toEqual([
      { broadHabitat: MERGED_INTERTIDAL_BROAD_HABITAT, netUnitChange: 5 }
    ])
  })
})

describe('calculateAreaHabitatTradingRules — habitats outside the MVS bands', () => {
  it('excludes High and Very High habitats', () => {
    const result = calculateAreaHabitatTradingRules(
      { [CALCAREOUS_GRASSLAND]: 9 },
      {}
    )

    expect(result.habitatTypes).toEqual([])
    expect(result.medium.surplus).toBe(0)
  })

  it('skips habitat types absent from the reference data', () => {
    const result = calculateAreaHabitatTradingRules(
      {},
      { 'Not a - real habitat': 5, [ALLOTMENTS]: 2 }
    )

    expect(result.habitatTypes.map((habitat) => habitat.habitatType)).toEqual([
      ALLOTMENTS
    ])
  })

  it('returns zeroed figures for a project with no area habitats', () => {
    expect(calculateAreaHabitatTradingRules()).toEqual({
      habitatTypes: [],
      medium: { broadHabitats: [], surplus: 0, deficit: 0 },
      low: { netUnitChange: 0, cumulativeAvailability: 0 }
    })
  })
})
