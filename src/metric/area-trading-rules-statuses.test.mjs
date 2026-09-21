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

// The band tests here exercise the derivation itself, so unless a test says
// otherwise they run as a site whose post-intervention file is uploaded.
const statusesFor = (
  baselineUnitsByType,
  deliveredUnitsByType,
  options = { postInterventionUploaded: true }
) =>
  deriveAreaHabitatTradingRuleStatuses(
    calculateAreaHabitatTradingRules(baselineUnitsByType, deliveredUnitsByType),
    options
  )

describe('deriveAreaHabitatTradingRuleStatuses — the Medium band', () => {
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
    expect(
      deriveAreaHabitatTradingRuleStatuses(tradingRules, {
        postInterventionUploaded: true
      }).medium
    ).toBe(MET)
  })

  it('reads a negative zero as no deficit', () => {
    // -0 < 0 is false, so a broad habitat that arrives at a signed zero is Met
    // like any other zero. Pinned because the sign is invisible in the figures
    // and would otherwise be a silent way for a compliant site to read short.
    const statuses = deriveAreaHabitatTradingRuleStatuses(
      {
        medium: {
          broadHabitats: [{ broadHabitat: 'Lakes', netUnitChange: -0 }]
        },
        low: { cumulativeAvailability: -0 }
      },
      { postInterventionUploaded: true }
    )

    expect(statuses).toEqual({ medium: MET, low: MET, overall: MET })
  })

  it('is Met when there are no Medium habitats at all', () => {
    const statuses = statusesFor({}, { [ALLOTMENTS]: 3 })

    expect(statuses.medium).toBe(MET)
  })
})

describe('deriveAreaHabitatTradingRuleStatuses — the Low band', () => {
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

  it('carries the Medium surplus down whole, where the spreadsheet does not', () => {
    // A site that enhances one Medium parcel and loses two others:
    //
    //   Cropland    4 units of Medium habitat, fully enhanced into Grassland
    //   Grassland   10 units delivered by that enhancement
    //   Lakes       4 units of Medium habitat, lost
    //   Low band    5 units lost
    //
    // Cropland therefore ends at -4, Grassland at +10 and Lakes at -4: a Medium
    // surplus of 10 and a deficit of -8, sitting in different broad habitats.
    // The surplus cannot be used to make that deficit good, so it is still
    // available to the Low band. Carried down whole against the Low band's -5,
    // it leaves 5 units available and the Low band Met.
    //
    // The metric spreadsheet cancels the deficit against the surplus first,
    // reaches -3, and reports the Low band short. This test fails if we ever
    // adopt that: both the figure and the status change.
    const tradingRules = calculateAreaHabitatTradingRules(
      {
        [ARABLE_MARGINS]: 4,
        [RESERVOIRS]: 4,
        [MODIFIED_GRASSLAND]: 5
      },
      { [NEUTRAL_GRASSLAND]: 10 }
    )

    expect(tradingRules.medium.broadHabitats).toEqual([
      { broadHabitat: 'Cropland', netUnitChange: -4 },
      { broadHabitat: 'Grassland', netUnitChange: 10 },
      { broadHabitat: 'Lakes', netUnitChange: -4 }
    ])
    expect(tradingRules.medium.surplus).toBe(10)
    expect(tradingRules.medium.deficit).toBe(-8)
    expect(tradingRules.low.netUnitChange).toBe(-5)
    expect(tradingRules.low.cumulativeAvailability).toBe(5)

    // What the spreadsheet would report for the same site.
    expect(
      tradingRules.medium.surplus +
        tradingRules.medium.deficit +
        tradingRules.low.netUnitChange
    ).toBe(-3)

    const statuses = deriveAreaHabitatTradingRuleStatuses(tradingRules, {
      postInterventionUploaded: true
    })

    expect(statuses.low).toBe(MET)
    // The deficit the Low band was allowed to ignore is not overlooked: it
    // still makes the Medium band Not met, and with it the site as a whole.
    // That pairing is what makes it safe to carry the surplus down whole.
    expect(statuses.medium).toBe(NOT_MET)
    expect(statuses.overall).toBe(NOT_MET)
  })
})

describe('deriveAreaHabitatTradingRuleStatuses — the area-habitat status', () => {
  it('is Met only when both bands are Met', () => {
    const statuses = statusesFor({}, { [ARABLE_MARGINS]: 6, [ALLOTMENTS]: 3 })

    expect(statuses).toEqual({ medium: MET, low: MET, overall: MET })
  })

  it('is Not met when only the Medium band is Not met', () => {
    const statuses = statusesFor(
      { [RESERVOIRS]: 4 },
      { [ALLOTMENTS]: 3, [RESERVOIRS]: 1 }
    )

    expect(statuses.medium).toBe(NOT_MET)
    expect(statuses.low).toBe(MET)
    expect(statuses.overall).toBe(NOT_MET)
  })

  it('is Not met when only the Low band is Not met', () => {
    const statuses = statusesFor(
      { [MODIFIED_GRASSLAND]: 8 },
      { [ARABLE_MARGINS]: 2 }
    )

    expect(statuses.medium).toBe(MET)
    expect(statuses.low).toBe(NOT_MET)
    expect(statuses.overall).toBe(NOT_MET)
  })
})

describe('deriveAreaHabitatTradingRuleStatuses — no post-intervention upload', () => {
  it('is Not met, with neither band derived', () => {
    const statuses = statusesFor(
      { [ARABLE_MARGINS]: 5 },
      {},
      { postInterventionUploaded: false }
    )

    expect(statuses).toEqual({
      medium: null,
      low: null,
      overall: NOT_MET
    })
  })

  it('stays Not met even where the figures alone would read Met', () => {
    // Nothing lost anywhere, so every band figure is zero and both bands would
    // otherwise be Met. The upload rule overrides that: with nothing
    // delivered there is nothing to trade against.
    const statuses = statusesFor({}, {}, { postInterventionUploaded: false })

    expect(statuses.overall).toBe(NOT_MET)
  })

  it('fails safe when the caller does not say whether a file was uploaded', () => {
    // The flag cannot be inferred from the figures, so omitting it must never
    // read as Met — a forgotten flag on a no-upload site would otherwise
    // report exactly the false pass this derivation exists to prevent.
    const statuses = deriveAreaHabitatTradingRuleStatuses(
      calculateAreaHabitatTradingRules({}, { [ALLOTMENTS]: 3 })
    )

    expect(statuses).toEqual({
      medium: null,
      low: null,
      overall: NOT_MET
    })
  })

  it('derives both bands when a post-intervention file is uploaded', () => {
    const statuses = statusesFor(
      { [ARABLE_MARGINS]: 5 },
      { [ARABLE_MARGINS]: 5 },
      { postInterventionUploaded: true }
    )

    expect(statuses).toEqual({ medium: MET, low: MET, overall: MET })
  })
})

describe('deriveAreaHabitatTradingRuleStatuses — edge inputs', () => {
  const UPLOADED = { postInterventionUploaded: true }

  it('treats a project with no area habitats as Met', () => {
    expect(
      deriveAreaHabitatTradingRuleStatuses(
        calculateAreaHabitatTradingRules(),
        UPLOADED
      )
    ).toEqual({ medium: MET, low: MET, overall: MET })
  })

  it('does not throw on a missing or partial figures object', () => {
    expect(deriveAreaHabitatTradingRuleStatuses(undefined, UPLOADED)).toEqual({
      medium: MET,
      low: MET,
      overall: MET
    })
    expect(
      deriveAreaHabitatTradingRuleStatuses({ medium: {} }, UPLOADED)
    ).toEqual({
      medium: MET,
      low: MET,
      overall: MET
    })
  })
})
