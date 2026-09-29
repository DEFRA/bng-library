import { describe, expect, it } from 'vitest'
import {
  readFeatureUnits,
  readTradingFigures
} from '../src/workbook-writer/read-figures.mjs'
import { METRIC_SHEETS } from '../src/workbook-writer/template-layout.mjs'

/** A sheet from `{ A1: value }`, shaped as the results reader receives it. */
function sheet(cells) {
  return Object.fromEntries(
    Object.entries(cells).map(([ref, v]) => [
      ref,
      { t: typeof v === 'number' ? 'n' : 's', v }
    ])
  )
}

const AREA_SUMMARY = {
  B11: 'High Distinctiveness',
  B12: 'Habitat group',
  B13: 'Woodland and forest - Wet woodland',
  F13: 3,
  B14: 'Lakes - Peat lakes',
  F14: 0,
  B20: 'Medium Distinctiveness',
  B21: 'Habitat group',
  B22: 'Grassland - Other neutral grassland',
  C22: 'Grassland',
  F22: 5,
  G22: 4,
  B23: 'Grassland - Upland acid grassland',
  C23: 'Grassland',
  F23: -1,
  B24: 'Lakes - Reservoirs',
  C24: 'Lakes',
  F24: 0,
  G24: 0,
  // The Low band has a blank row between its heading and its header.
  B30: 'Low Distinctiveness',
  B32: 'Habitat group',
  B33: 'Grassland - Modified grassland',
  F33: -2,
  K12: 3,
  K40: 0,
  K88: 4,
  K89: 0,
  K124: -2,
  K125: 2
}

function workbook(overrides = {}) {
  return {
    Sheets: {
      'Trading Summary Area Habitats': sheet(AREA_SUMMARY),
      'Trading Summary Hedgerows': sheet({
        B30: 'Medium Distinctiveness',
        B31: 'Habitat group',
        B32: 'Native hedgerow with trees',
        E32: -1.5,
        I32: -1.5
      }),
      "Trading Summary WaterC's": sheet({ I29: 0.5, I42: 0.5 }),
      ...overrides
    }
  }
}

describe('readTradingFigures', () => {
  const figures = readTradingFigures(workbook())

  it('reads each band’s habitats with a non-zero net change', () => {
    expect(figures.area.habitats).toEqual([
      {
        habitatType: 'Woodland and forest - Wet woodland',
        distinctiveness: 'High',
        netUnitChange: 3
      },
      {
        habitatType: 'Grassland - Other neutral grassland',
        distinctiveness: 'Medium',
        netUnitChange: 5
      },
      {
        habitatType: 'Grassland - Upland acid grassland',
        distinctiveness: 'Medium',
        netUnitChange: -1
      },
      {
        habitatType: 'Grassland - Modified grassland',
        distinctiveness: 'Low',
        netUnitChange: -2
      }
    ])
  })

  it('reads the Medium broad habitat totals, leaving out those at zero', () => {
    expect(figures.area.broadHabitats).toEqual([
      { broadHabitat: 'Grassland', netUnitChange: 4 }
    ])
  })

  it('reads the band totals from the cells the metric computes them in', () => {
    expect(figures.area.totals).toMatchObject({
      veryHighSurplus: 3,
      mediumSurplus: 4,
      mediumDeficit: 0,
      lowNetUnitChange: -2,
      lowCumulativeSurplus: 2
    })
    expect(figures.watercourse.totals).toMatchObject({
      mediumSurplus: 0.5,
      lowCumulativeAvailability: 0.5
    })
  })

  it('reads the linear summaries’ project-wide column', () => {
    expect(figures.hedgerow.habitats).toEqual([
      {
        habitatType: 'Native hedgerow with trees',
        distinctiveness: 'Medium',
        netUnitChange: -1.5
      }
    ])
    expect(figures.hedgerow.broadHabitats).toBeUndefined()
  })
})

describe('readFeatureUnits', () => {
  const baseline = METRIC_SHEETS.habitatBaseline
  const creation = METRIC_SHEETS.habitatCreation
  const units = readFeatureUnits(
    workbook({
      [baseline.sheet]: sheet({
        AB11: 'H1',
        H11: 1.5,
        O11: 1.15,
        Q11: 8,
        S11: 1.5,
        U11: 8,
        AB12: 'H2',
        Q12: 4,
        U12: 0
      }),
      [creation.sheet]: sheet({ AB11: 'H2', Y11: 6 })
    })
  )

  it('reads every feature’s units per stage, keyed by its reference', () => {
    expect(
      units.map(({ stage, reference, units: u, cell }) => [
        stage,
        reference,
        u,
        cell
      ])
    ).toEqual([
      ['baseline', 'H1', 8, 'Q11'],
      ['retained', 'H1', 8, 'U11'],
      ['baseline', 'H2', 4, 'Q12'],
      ['created', 'H2', 6, 'Y11']
    ])
  })

  it('reads the size and strategic significance each row was priced on', () => {
    expect(units[0]).toMatchObject({
      size: 1.5,
      strategicSignificanceMultiplier: 1.15
    })
    expect(units[1]).toMatchObject({
      size: 1.5,
      strategicSignificanceMultiplier: 1.15
    })
  })

  it('reads retained units only where the row retains something', () => {
    expect(
      units.filter((u) => u.reference === 'H2' && u.stage === 'retained')
    ).toEqual([])
  })
})
