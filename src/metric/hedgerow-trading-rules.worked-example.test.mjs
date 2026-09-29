// AC7 — validate the hedgerow trading-rules figures against the published
// worked example.
//
// Source: "Example - Hedgerows MVS.xlsx" (a Statutory Biodiversity Metric 4.0
// workbook with the example filled in) and its accompanying Confluence page
// "Hedgerow Trading Rules - Worked example".
//
// The site has 5 baseline hedgerows (1 Medium-with-bank, 1 Medium, 2 Low, 1
// Very Low), 4 created and 3 enhanced. Every figure below is taken at full
// precision from the workbook, via the per-type totals on G-2 Habitat groups
// (rows 154–162), which sum these source cells:
//
//   - baseline units      B-1 On-Site Hedge Baseline, column N   (G-2 column F)
//   - retained units      B-1, column R                           (G-2 column H)
//   - created units       B-2 On-Site Hedge Creation, column W    (G-2 column L)
//   - enhanced units      B-3 On-Site Hedge Enhancement, column AH (G-2 column N),
//                         keyed by the proposed type in B-3 column M
//   - expected per type   Trading Summary Hedgerows, column E
//   - expected per band   Trading Summary Hedgerows, column I
//
// Two properties make it a good oracle: one Low hedgerow is enhanced into a
// Medium type (so units cross bands), and the Medium band holds both a gain and
// a loss (so it tells a net Medium figure apart from a surplus one).
//
// There is no off-site hedgerow data in the example (G-2 column AD is zero
// throughout), so on-site and project-wide figures are the same.

import { describe, expect, it } from 'vitest'

import { calculateHedgerowTradingRules } from './hedgerow-trading-rules.mjs'
import { sumNetChange, sumSurplus } from './trading-rules.mjs'

// The workbook's stored values carry IEEE-754 noise in their last digit or two;
// the engine normalises results to 15 significant figures. Ten decimal places
// checks the calculation while ignoring that, and is still far tighter than the
// 4 dp the example is quoted to.
const DECIMAL_PLACES = 10

const SPECIES_RICH = 'Species-rich native hedgerow'
const NATIVE_BANK = 'Native hedgerow - associated with bank or ditch'
const NATIVE_TREES = 'Native hedgerow with trees'
const NATIVE = 'Native hedgerow'
const LINE_OF_TREES = 'Line of trees'
const LINE_OF_TREES_BANK = 'Line of trees - associated with bank or ditch'
const NON_NATIVE = 'Non-native and ornamental hedgerow'

// G-2 column F.
const baselineUnitsByType = {
  [SPECIES_RICH]: 2.2,
  [NATIVE_BANK]: 4.4,
  [NATIVE]: 2.2,
  [LINE_OF_TREES_BANK]: 1,
  [NON_NATIVE]: 0.5
}

// Retained (G-2 H) + created (G-2 L) + enhanced (G-2 N). The Species-rich
// native hedgerow units are the enhancement of a baseline Native hedgerow: they
// count towards the proposed type, not the one it started as.
const deliveredUnitsByType = {
  [SPECIES_RICH]: 0.5230158784400001,
  [NATIVE_BANK]: 2.2 + 0.5602258193599999 + 2.931225,
  [NATIVE_TREES]: 0.8,
  [NATIVE]: 0.22000000000000003,
  [LINE_OF_TREES]: 0.16415073244,
  [LINE_OF_TREES_BANK]: 0.1 + 0.16868302208000002,
  [NON_NATIVE]: 0.05 + 0.1
}

const result = calculateHedgerowTradingRules(
  baselineUnitsByType,
  deliveredUnitsByType
)

/** @param {string} habitatType */
function habitatFor(habitatType) {
  return result.habitatTypes.find(
    (habitat) => habitat.habitatType === habitatType
  )
}

describe('worked example — AC1 net unit change per habitat type', () => {
  it('covers the 7 hedgerow types present on either side', () => {
    expect(result.habitatTypes).toHaveLength(7)
  })

  it.each([
    // Trading Summary Hedgerows E32–E34, E44–E46, E54.
    [SPECIES_RICH, 'Medium', -1.67698412156],
    [NATIVE_BANK, 'Medium', 1.2914508193599996],
    [NATIVE_TREES, 'Medium', 0.8],
    [NATIVE, 'Low', -1.9800000000000002],
    [LINE_OF_TREES, 'Low', 0.16415073244],
    [LINE_OF_TREES_BANK, 'Low', -0.7313169779199999],
    [NON_NATIVE, 'V.Low', -0.35]
  ])('%s (%s) nets to %d', (habitatType, band, expected) => {
    const habitat = habitatFor(habitatType)
    expect(habitat.distinctiveness).toBe(band)
    expect(habitat.netUnitChange).toBeCloseTo(expected, DECIMAL_PLACES)
  })
})

describe('worked example — AC2 to AC4 band net change', () => {
  it('AC2 nets the Medium band (I32)', () => {
    expect(result.medium.netUnitChange).toBeCloseTo(
      0.41446669779999956,
      DECIMAL_PLACES
    )
  })

  it('AC3 nets the Low band (I43)', () => {
    expect(result.low.netUnitChange).toBeCloseTo(-2.54716624548, DECIMAL_PLACES)
  })

  it('AC4 nets the Very Low band (I53)', () => {
    expect(result.veryLow.netUnitChange).toBeCloseTo(-0.35, DECIMAL_PLACES)
  })
})

describe('worked example — AC5 and AC6 cumulative availability', () => {
  it('AC5 adds the positive Medium net change to the Low net change (I44)', () => {
    expect(result.low.cumulativeAvailability).toBeCloseTo(
      -2.1326995476800006,
      DECIMAL_PLACES
    )
  })

  it('AC6 carries nothing into Very Low, as Low availability is negative (I54)', () => {
    expect(result.veryLow.cumulativeAvailability).toBeCloseTo(
      -0.35,
      DECIMAL_PLACES
    )
  })

  it('AC5 carries the Medium net, not the Medium surplus', () => {
    // Area habitats and watercourses carry down the Medium surplus (positive
    // nets only). The hedgerow sheet carries the net, and this example tells
    // the two apart: the surplus shape would give -0.4557, not -2.1327. Pinned
    // so that aligning hedgerows with the other modules has to be a decision.
    const mediumNets = result.habitatTypes
      .filter((habitat) => habitat.distinctiveness === 'Medium')
      .map((habitat) => habitat.netUnitChange)
    const surplusShape = sumSurplus(mediumNets) + result.low.netUnitChange

    expect(surplusShape).toBeCloseTo(-0.45571542612, DECIMAL_PLACES)
    expect(result.low.cumulativeAvailability).toBeCloseTo(
      sumNetChange(mediumNets) + result.low.netUnitChange,
      DECIMAL_PLACES
    )
  })
})
