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
    expect(result.habitats).toEqual([
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
      result.habitats.some((habitat) => habitat.habitatType === SEALED_SURFACE)
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
    for (const habitat of result.habitats) {
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
    expect(result.low.netChange).toBe(-4)
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

    expect(result.habitats[0].broadHabitat).toBe('Intertidal hard structures')
  })

  it('does not merge a Low intertidal habitat into the Medium group', () => {
    const result = calculateAreaHabitatTradingRules(
      {},
      { [ARTIFICIAL_FEATURES]: 4 }
    )

    expect(result.medium.broadHabitats).toEqual([])
    expect(result.low.netChange).toBe(4)
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
      result.habitats.map((habitat) => [
        habitat.habitatType,
        habitat.tradingBroadHabitat
      ])
    ).toEqual([
      [ARTIFICIAL_FEATURES, 'Intertidal hard structures'],
      [ARTIFICIAL_LITTORAL_MUD, 'Intertidal sediment']
    ])
    expect(
      result.habitats.some(
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
      result.habitats.find((habitat) => habitat.habitatType === habitatType)
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

    expect(result.habitats).toEqual([])
    expect(result.medium.surplus).toBe(0)
  })

  it('skips habitat types absent from the reference data', () => {
    const result = calculateAreaHabitatTradingRules(
      {},
      { 'Not a - real habitat': 5, [ALLOTMENTS]: 2 }
    )

    expect(result.habitats.map((habitat) => habitat.habitatType)).toEqual([
      ALLOTMENTS
    ])
  })

  it('returns zeroed figures for a project with no area habitats', () => {
    expect(calculateAreaHabitatTradingRules()).toEqual({
      habitats: [],
      medium: { broadHabitats: [], surplus: 0, deficit: 0 },
      low: { netChange: 0, cumulativeAvailability: 0 }
    })
  })
})

describe('calculateAreaHabitatTradingRules — cumulative availability against the metric spreadsheet', () => {
  // WHAT THIS IS ABOUT
  //
  // Cumulative availability is how many units are left for the Low band once
  // the Medium surplus has been carried down to it. The metric spreadsheet
  // works out the same thing, but first cancels the Medium deficit against the
  // Medium surplus.
  //
  // The trading rules do not allow that cancellation. A surplus in one broad
  // habitat cannot make good a deficit in another, so the deficit has to be
  // settled some other way and the surplus units were never spoken for. They
  // really are available to the Low band. We treat the spreadsheet's step as a
  // bug and do not copy it.
  //
  // Our figure is therefore always higher than the spreadsheet's, by exactly
  // the Medium deficit.
  //
  // WHY WE TEST IT
  //
  // A 9.42-unit difference from the published metric looks like a defect to
  // anyone checking our output against a workbook. The obvious "fix" is to make
  // the numbers match — which would import the bug. These tests make that fix
  // fail the build.
  //
  // The worked-example test already proves the relationship, but only for one
  // workbook with its figures written out by hand. These prove it holds for the
  // calculator generally: 625 combinations of surplus, deficit and zero, with
  // the same relationship checked in every one.

  /** What the spreadsheet would report for the same project. */
  const metricCumulativeSurplus = (result) =>
    result.medium.surplus + result.medium.deficit + result.low.netChange

  // (baseline, delivered) pairs giving net unit changes of -8, -3, 0, +5, +11.
  const UNIT_PAIRS = [
    [8, 0],
    [5, 2],
    [4, 4],
    [1, 6],
    [0, 11]
  ]

  // Four habitats, each swept across those five net changes: two ordinary
  // Medium broad habitats, one Medium intertidal (so the intertidal merge is
  // active throughout) and one Low. 5^4 = 625 projects.
  const SWEPT_HABITATS = [
    ARABLE_MARGINS,
    RESERVOIRS,
    LITTORAL_SAND,
    MODIFIED_GRASSLAND
  ]

  const combinations = () => {
    let rows = [[]]
    for (let i = 0; i < SWEPT_HABITATS.length; i++) {
      rows = rows.flatMap((row) => UNIT_PAIRS.map((pair) => [...row, pair]))
    }
    return rows
  }

  const resultFor = (pairs) => {
    const baselineUnitsByType = {}
    const deliveredUnitsByType = {}
    pairs.forEach(([baseline, delivered], index) => {
      baselineUnitsByType[SWEPT_HABITATS[index]] = baseline
      deliveredUnitsByType[SWEPT_HABITATS[index]] = delivered
    })
    // Present in every project: a Low habitat that sits in an intertidal broad
    // habitat, which must count toward the Low band and never be swept into the
    // merged Medium group.
    deliveredUnitsByType[ARTIFICIAL_FEATURES] = 3
    return calculateAreaHabitatTradingRules(
      baselineUnitsByType,
      deliveredUnitsByType
    )
  }

  const netChangesOf = (pairs) =>
    pairs.map(([baseline, delivered]) => delivered - baseline).join(', ')

  it('differs from the metric by exactly the Medium deficit, in every case', () => {
    const failures = []

    for (const pairs of combinations()) {
      const result = resultFor(pairs)
      const gap =
        result.low.cumulativeAvailability - metricCumulativeSurplus(result)
      if (Math.abs(gap - Math.abs(result.medium.deficit)) > 1e-10) {
        failures.push(
          `net changes [${netChangesOf(pairs)}]: gap ${gap}, Medium deficit ${result.medium.deficit}`
        )
      }
    }

    expect(failures).toEqual([])
  })

  it('is the Medium surplus plus the Low net change, in every case', () => {
    const failures = []

    for (const pairs of combinations()) {
      const result = resultFor(pairs)
      const expected = result.medium.surplus + result.low.netChange
      if (Math.abs(result.low.cumulativeAvailability - expected) > 1e-10) {
        failures.push(
          `net changes [${netChangesOf(pairs)}]: ${result.low.cumulativeAvailability} !== ${expected}`
        )
      }
    }

    expect(failures).toEqual([])
  })

  it('is never below the metric figure', () => {
    // The gap is the Medium deficit, which is never positive, so our figure can
    // equal the spreadsheet's but never come out lower. That matters for the
    // Met / Not-met status: a site that looks short on our figure is short on
    // the spreadsheet's too, so we can never fail a site the metric would pass.
    const failures = []

    for (const pairs of combinations()) {
      const result = resultFor(pairs)
      if (
        result.low.cumulativeAvailability <
        metricCumulativeSurplus(result) - 1e-10
      ) {
        failures.push(`net changes [${netChangesOf(pairs)}]`)
      }
    }

    expect(failures).toEqual([])
  })

  it('holds for two cases you can check by hand', () => {
    // The sweep above is generated, so these two anchor it to arithmetic a
    // reader can verify: one project with no Medium deficit (the two figures
    // agree) and one with a deficit of 8 (they differ by 8).
    const noDeficit = resultFor([
      [0, 11],
      [0, 11],
      [0, 11],
      [0, 11]
    ])
    expect(noDeficit.medium.deficit).toBe(0)
    expect(noDeficit.low.cumulativeAvailability).toBe(
      metricCumulativeSurplus(noDeficit)
    )

    const withDeficit = resultFor([
      [0, 11],
      [8, 0],
      [4, 4],
      [0, 11]
    ])
    expect(withDeficit.medium.deficit).toBe(-8)
    expect(withDeficit.low.cumulativeAvailability).toBe(
      metricCumulativeSurplus(withDeficit) + 8
    )
  })
})
