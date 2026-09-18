// AC8 — validate the area-habitat trading-rules figures against the published
// worked example.
//
// Source: "Example - Area Habitats MVS.xlsx" (a Statutory Biodiversity Metric
// 4.0 workbook with the example filled in) and its accompanying Confluence page
// "Area Habitat Trading Rules - Worked example".
//
// The site has 12 baseline parcels (8 Medium, 2 Low, 2 Very Low), of which 6 are
// retained, 4 enhanced and 2 created into. Every figure below is taken at full
// precision from the workbook, from these cells:
//
//   - baseline units      A-1 On-Site Habitat Baseline, column Q
//   - retained units      A-1, column U
//   - created units       A-2 On-Site Habitat Creation, column Y
//   - enhanced units      A-3 On-Site Habitat Enhancement, column AN
//   - expected net change  Trading Summary Area Habitats, column F
//   - expected aggregates  Trading Summary Area Habitats, columns G and K
//
// Two properties of the example make it a good oracle: enhancement moves units
// out of both intertidal broad habitats into Grassland and Lakes (so the merge
// in AC3 is exercised by habitats that lose all their units), and three habitats
// net to exactly zero (so the treatment of a zero broad habitat is pinned down).

import { describe, expect, it } from 'vitest'

import { calculateAreaHabitatTradingRules } from './area-trading-rules.mjs'

// The figures below are the workbook's raw stored values, which carry IEEE-754
// noise in their last digit or two (108.28816610400001 for a number the metric
// reports as 108.2882). The engine normalises every result to 15 significant
// figures, so comparing to ten decimal places checks the calculation while
// ignoring a difference neither the workbook nor the metric considers real —
// and is still five orders of magnitude tighter than the 4 dp the worked
// example is quoted to.
const DECIMAL_PLACES = 10

const IGGI =
  'Intertidal hard structures - Artificial hard structures with integrated greening of grey infrastructure (IGGI)'
const SCOTS_PINE = "Woodland and forest - Other Scot's pine woodland"
const LITTORAL_COARSE = 'Intertidal sediment - Littoral coarse sediment'
const NEUTRAL_GRASSLAND = 'Grassland - Other neutral grassland'
const BLACKTHORN = 'Heathland and shrub - Blackthorn scrub'

// A-1 column Q. The two Very Low parcels (Urban - Built linear features) hold
// zero units, and are carried here to prove they stay out of the output.
const baselineUnitsByType = {
  'Heathland and shrub - Mixed scrub': 4,
  [BLACKTHORN]: 4,
  'Heathland and shrub - Gorse scrub': 4,
  [LITTORAL_COARSE]: 4,
  'Intertidal sediment - Littoral sand': 4,
  [IGGI]: 4,
  [SCOTS_PINE]: 8,
  [NEUTRAL_GRASSLAND]: 4,
  'Urban - Bioswale': 60,
  'Urban - Allotments': 60,
  'Urban - Built linear features': 0
}

// Retained (A-1 column U) plus created (A-2 column Y) plus enhanced (A-3 column
// AN). Enhancement is attributed to the proposed habitat, which is why the two
// intertidal baselines deliver into Grassland and Lakes.
const deliveredUnitsByType = {
  'Heathland and shrub - Mixed scrub': 4,
  [BLACKTHORN]: 3.2 + 0.9805448904800002,
  'Heathland and shrub - Gorse scrub': 2,
  [LITTORAL_COARSE]: 0,
  'Intertidal sediment - Littoral sand': 4,
  [IGGI]: 0,
  [SCOTS_PINE]: 8,
  [NEUTRAL_GRASSLAND]: 10.18689120268,
  'Urban - Bioswale': 0,
  'Urban - Allotments': 30,
  'Urban - Built linear features': 0,
  'Grassland - Other lowland acid grassland': 108.28816610400001,
  'Heathland and shrub - Willow scrub': 0.3984354038561601,
  'Grassland - Upland acid grassland': 5.09344560134,
  'Lakes - Reservoirs': 2.953733156276
}

const result = calculateAreaHabitatTradingRules(
  baselineUnitsByType,
  deliveredUnitsByType
)

/** @param {string} habitatType */
function netChangeFor(habitatType) {
  return result.habitats.find((habitat) => habitat.habitatType === habitatType)
    ?.netUnitChange
}

/** @param {string} broadHabitat */
function broadChangeFor(broadHabitat) {
  return result.medium.broadHabitats.find(
    (entry) => entry.broadHabitat === broadHabitat
  )?.netUnitChange
}

describe('worked example — AC1 net unit change per habitat', () => {
  it('covers the 14 Medium and Low habitats across baseline and post-intervention', () => {
    // 15 unique habitats in the example, less the Very Low one.
    expect(result.habitats).toHaveLength(14)
  })

  it.each([
    ['Grassland - Other lowland acid grassland', 108.28816610400001],
    [NEUTRAL_GRASSLAND, 6.18689120268],
    ['Grassland - Upland acid grassland', 5.09344560134],
    ['Heathland and shrub - Mixed scrub', 0],
    [BLACKTHORN, 0.18054489048000022],
    ['Heathland and shrub - Gorse scrub', -2],
    ['Heathland and shrub - Willow scrub', 0.3984354038561601],
    ['Lakes - Reservoirs', 2.953733156276],
    [SCOTS_PINE, 0],
    [LITTORAL_COARSE, -4],
    ['Intertidal sediment - Littoral sand', 0],
    [IGGI, -4],
    ['Urban - Bioswale', -60],
    ['Urban - Allotments', -30]
  ])('%s nets to %d', (habitatType, expected) => {
    expect(netChangeFor(habitatType)).toBeCloseTo(expected, DECIMAL_PLACES)
  })

  it('leaves the Very Low habitat out entirely', () => {
    expect(netChangeFor('Urban - Built linear features')).toBeUndefined()
  })
})

describe('worked example — AC2 cumulative broad habitat change', () => {
  it.each([
    ['Grassland', 119.56850290802001],
    ['Heathland and shrub', -1.4210197056638396],
    ['Lakes', 2.953733156276],
    // Retained at its baseline units, so the broad habitat nets to zero. It is
    // still reported: it has Medium habitats, it is simply neither in surplus
    // nor in deficit.
    ['Woodland and forest', 0]
  ])('%s cumulates to %d', (broadHabitat, expected) => {
    expect(broadChangeFor(broadHabitat)).toBeCloseTo(expected, DECIMAL_PLACES)
  })
})

describe('worked example — AC3 intertidal merge', () => {
  it('reports one merged entry for the two intertidal broad habitats', () => {
    expect(
      broadChangeFor('Intertidal sediment and hard structures')
    ).toBeCloseTo(-8, DECIMAL_PLACES)
    expect(broadChangeFor('Intertidal sediment')).toBeUndefined()
    expect(broadChangeFor('Intertidal hard structures')).toBeUndefined()
  })
})

describe('worked example — AC4 to AC7 band aggregates', () => {
  it('AC4 totals the broad habitats in surplus', () => {
    // Grassland + Lakes. Woodland and forest is zero, so it is in neither total.
    expect(result.medium.surplus).toBeCloseTo(
      122.52223606429601,
      DECIMAL_PLACES
    )
  })

  it('AC5 totals the broad habitats in deficit, merged intertidals included', () => {
    // Heathland and shrub + the merged intertidal group.
    expect(result.medium.deficit).toBeCloseTo(-9.42101970566384, DECIMAL_PLACES)
  })

  it('AC6 nets the Low band', () => {
    expect(result.low.netChange).toBeCloseTo(-90, DECIMAL_PLACES)
  })

  it('AC7 adds the Low net change to the Medium surplus', () => {
    expect(result.cumulativeSurplus).toBeCloseTo(
      32.52223606429601,
      DECIMAL_PLACES
    )
  })

  it('AC7 deliberately does not reconcile to the metric', () => {
    // The workbook's own "Cumulative surplus of units" (Trading Summary Area
    // Habitats, K125) is 23.101216358632172, because it nets the Medium deficit
    // off the Medium surplus before offsetting the Low band. AC7 carries the
    // surplus down undiminished, because the deficit still has to be offset by
    // trading up — it is not available to absorb a Low deficit as well. The two
    // therefore differ by exactly the AC5 Medium deficit.
    const metricFigure = 23.101216358632172
    expect(result.cumulativeSurplus - metricFigure).toBeCloseTo(
      Math.abs(result.medium.deficit),
      10
    )
  })
})
