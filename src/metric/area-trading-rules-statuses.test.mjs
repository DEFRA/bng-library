import { describe, expect, it } from 'vitest'

import { calculateAreaHabitatTradingRules } from './area-trading-rules.mjs'
import { deriveAreaHabitatTradingRuleStatuses } from './area-trading-rules-statuses.mjs'

// Real reference keys, so the bands under test are the ones the engine resolves.
const ARABLE_MARGINS = 'Cropland - Arable field margins tussocky' // Medium
const RESERVOIRS = 'Lakes - Reservoirs' // Medium
const NEUTRAL_GRASSLAND = 'Grassland - Other neutral grassland' // Medium
const UPLAND_ACID_GRASSLAND = 'Grassland - Upland acid grassland' // Medium
const MODIFIED_GRASSLAND = 'Grassland - Modified grassland' // Low
const ALLOTMENTS = 'Urban - Allotments' // Low

const MET = 'Met'
const NOT_MET = 'Not met'

const statusesFor = (baselineUnitsByType, deliveredUnitsByType, options) =>
  deriveAreaHabitatTradingRuleStatuses(
    calculateAreaHabitatTradingRules(baselineUnitsByType, deliveredUnitsByType),
    options
  )

describe('deriveAreaHabitatTradingRuleStatuses — AC1, the Medium band', () => {
  it('is Met when every Medium broad habitat is in surplus', () => {
    const statuses = statusesFor(
      { [ARABLE_MARGINS]: 2, [RESERVOIRS]: 2 },
      { [ARABLE_MARGINS]: 6, [RESERVOIRS]: 5 }
    )

    expect(statuses.medium).toBe(MET)
  })

  it('is Not met when any one Medium broad habitat is in deficit', () => {
    // Cropland +4, Lakes -1. The band is Not met on the strength of Lakes
    // alone, however large the surplus elsewhere: a surplus in one broad
    // habitat cannot satisfy a deficit in another.
    const statuses = statusesFor(
      { [ARABLE_MARGINS]: 2, [RESERVOIRS]: 2 },
      { [ARABLE_MARGINS]: 6, [RESERVOIRS]: 1 }
    )

    expect(statuses.medium).toBe(NOT_MET)
  })

  it('is Met when a broad habitat nets to exactly zero', () => {
    // Grassland's two Medium habitats cancel exactly. Zero is not a deficit,
    // so it does not make the band Not met — the worked example's "Woodland
    // and forest" row behaves the same way.
    const tradingRules = calculateAreaHabitatTradingRules(
      { [NEUTRAL_GRASSLAND]: 10 },
      { [UPLAND_ACID_GRASSLAND]: 10 }
    )

    expect(tradingRules.medium.broadHabitats).toEqual([
      { broadHabitat: 'Grassland', netUnitChange: 0 }
    ])
    expect(deriveAreaHabitatTradingRuleStatuses(tradingRules).medium).toBe(MET)
  })

  it('reads a negative zero as no deficit', () => {
    // -0 < 0 is false, so a broad habitat that arrives at a signed zero is Met
    // like any other zero. Pinned because the sign is invisible in the figures
    // and would otherwise be a silent way for a compliant site to read short.
    const statuses = deriveAreaHabitatTradingRuleStatuses({
      medium: { broadHabitats: [{ broadHabitat: 'Lakes', netUnitChange: -0 }] },
      low: { cumulativeAvailability: -0 }
    })

    expect(statuses).toEqual({ medium: MET, low: MET, areaHabitats: MET })
  })

  it('is Met when there are no Medium habitats at all', () => {
    const statuses = statusesFor({}, { [ALLOTMENTS]: 3 })

    expect(statuses.medium).toBe(MET)
  })
})

describe('deriveAreaHabitatTradingRuleStatuses — AC2, the Low band', () => {
  it('is Met when cumulative availability is positive', () => {
    const statuses = statusesFor({}, { [ALLOTMENTS]: 3 })

    expect(statuses.low).toBe(MET)
  })

  it('is Met when cumulative availability is exactly zero', () => {
    const statuses = statusesFor({ [ALLOTMENTS]: 3 }, { [ALLOTMENTS]: 3 })

    expect(statuses.low).toBe(MET)
  })

  it('is Not met when cumulative availability is negative', () => {
    const statuses = statusesFor({ [MODIFIED_GRASSLAND]: 8 }, {})

    expect(statuses.low).toBe(NOT_MET)
  })

  it('takes the Medium surplus undiminished by the Medium deficit', () => {
    // The point BMD-1008 calls out as a deliberate departure from the metric
    // spreadsheet. Cropland +6 and Lakes -4 give a Medium surplus of 6 and a
    // deficit of -4; the Low band is -5. AC7 carries the surplus down whole,
    // so availability is +1 and the Low band is Met. The spreadsheet would net
    // the deficit off first, reach -3, and report the Low band short.
    const tradingRules = calculateAreaHabitatTradingRules(
      { [RESERVOIRS]: 4, [MODIFIED_GRASSLAND]: 5 },
      { [ARABLE_MARGINS]: 6 }
    )
    expect(tradingRules.medium.surplus).toBe(6)
    expect(tradingRules.medium.deficit).toBe(-4)
    expect(tradingRules.low.netChange).toBe(-5)
    expect(tradingRules.low.cumulativeAvailability).toBe(1)

    const statuses = deriveAreaHabitatTradingRuleStatuses(tradingRules)

    expect(statuses.low).toBe(MET)
    // AC3 is what keeps this safe: the Medium deficit that the Low band was
    // allowed to ignore still makes the area-habitat status Not met.
    expect(statuses.medium).toBe(NOT_MET)
    expect(statuses.areaHabitats).toBe(NOT_MET)
  })
})

describe('deriveAreaHabitatTradingRuleStatuses — AC3, the area-habitat status', () => {
  it('is Met only when both bands are Met', () => {
    const statuses = statusesFor({}, { [ARABLE_MARGINS]: 6, [ALLOTMENTS]: 3 })

    expect(statuses).toEqual({ medium: MET, low: MET, areaHabitats: MET })
  })

  it('is Not met when only the Medium band is Not met', () => {
    const statuses = statusesFor(
      { [RESERVOIRS]: 4 },
      { [ALLOTMENTS]: 3, [RESERVOIRS]: 1 }
    )

    expect(statuses.medium).toBe(NOT_MET)
    expect(statuses.low).toBe(MET)
    expect(statuses.areaHabitats).toBe(NOT_MET)
  })

  it('is Not met when only the Low band is Not met', () => {
    const statuses = statusesFor(
      { [MODIFIED_GRASSLAND]: 8 },
      { [ARABLE_MARGINS]: 2 }
    )

    expect(statuses.medium).toBe(MET)
    expect(statuses.low).toBe(NOT_MET)
    expect(statuses.areaHabitats).toBe(NOT_MET)
  })
})

describe('deriveAreaHabitatTradingRuleStatuses — AC4, no post-intervention upload', () => {
  it('is Not met, with neither band derived', () => {
    const statuses = statusesFor(
      { [ARABLE_MARGINS]: 5 },
      {},
      { postInterventionUploaded: false }
    )

    expect(statuses).toEqual({
      medium: null,
      low: null,
      areaHabitats: NOT_MET
    })
  })

  it('stays Not met even where the figures alone would read Met', () => {
    // Nothing lost anywhere, so every band figure is zero and both bands would
    // otherwise be Met. AC4 overrides that: with nothing delivered there is
    // nothing to trade against.
    const statuses = statusesFor({}, {}, { postInterventionUploaded: false })

    expect(statuses.areaHabitats).toBe(NOT_MET)
  })

  it('derives both bands when a post-intervention file is uploaded', () => {
    const statuses = statusesFor(
      { [ARABLE_MARGINS]: 5 },
      { [ARABLE_MARGINS]: 5 },
      { postInterventionUploaded: true }
    )

    expect(statuses).toEqual({ medium: MET, low: MET, areaHabitats: MET })
  })
})

describe('deriveAreaHabitatTradingRuleStatuses — edge inputs', () => {
  it('treats a project with no area habitats as Met', () => {
    expect(
      deriveAreaHabitatTradingRuleStatuses(calculateAreaHabitatTradingRules())
    ).toEqual({ medium: MET, low: MET, areaHabitats: MET })
  })

  it('does not throw on a missing or partial figures object', () => {
    expect(deriveAreaHabitatTradingRuleStatuses(undefined)).toEqual({
      medium: MET,
      low: MET,
      areaHabitats: MET
    })
    expect(deriveAreaHabitatTradingRuleStatuses({ medium: {} })).toEqual({
      medium: MET,
      low: MET,
      areaHabitats: MET
    })
  })
})
