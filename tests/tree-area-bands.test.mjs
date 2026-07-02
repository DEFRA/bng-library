import { describe, expect, it } from 'vitest'
import { decomposeAreaToTreeBands } from '../src/workbook/tree-area-bands.mjs'
import {
  SQ_METRES_PER_HECTARE,
  individualTreeAreaSquareMetres
} from '../src/data/metric-values-individual-tree-area.mjs'
import {
  derivePostInterventionTreePoints,
  generateBaselineTreePoints
} from '../src/workbook/workbook-layers-trees.mjs'

const SMALLEST_BAND = Math.min(...Object.values(individualTreeAreaSquareMetres))
const HALF_SMALLEST = SMALLEST_BAND / 2

const reconstructSquareMetres = (bands) =>
  bands.reduce((sum, band) => sum + individualTreeAreaSquareMetres[band], 0)

describe('decomposeAreaToTreeBands', () => {
  it('decomposes a real aggregate area into multiple bands (1018 m² example)', () => {
    // 0.1018 ha = 1018 m² — larger than the biggest single band (765), so it
    // must expand to several points rather than round to one.
    const bands = decomposeAreaToTreeBands(0.1018)
    expect(bands).toEqual(['Very large', 'Medium', 'Small', 'Small'])
    expect(reconstructSquareMetres(bands)).toBe(1010)
  })

  it('reconstructs every area to within half the smallest band', () => {
    // At/above the smallest representable tree. Sub-band areas necessarily
    // overshoot (a tree can't be smaller than one Small) — covered separately.
    for (let m2 = SMALLEST_BAND; m2 <= 5000; m2 += 7) {
      const bands = decomposeAreaToTreeBands(m2 / SQ_METRES_PER_HECTARE)
      expect(Math.abs(reconstructSquareMetres(bands) - m2)).toBeLessThanOrEqual(
        HALF_SMALLEST
      )
    }
  })

  it('maps a single-band area to exactly that band', () => {
    expect(decomposeAreaToTreeBands(163 / SQ_METRES_PER_HECTARE)).toEqual([
      'Medium'
    ])
  })

  it('always emits at least one tree for a positive sub-band area', () => {
    // 10 m² is below every band; nearest is Small.
    expect(decomposeAreaToTreeBands(10 / SQ_METRES_PER_HECTARE)).toEqual([
      'Small'
    ])
  })

  it('falls back to a single default-size tree when area is missing or zero', () => {
    expect(decomposeAreaToTreeBands(undefined)).toEqual(['Medium'])
    expect(decomposeAreaToTreeBands(0)).toEqual(['Medium'])
    expect(decomposeAreaToTreeBands(-1)).toEqual(['Medium'])
    expect(decomposeAreaToTreeBands(Number.NaN)).toEqual(['Medium'])
  })
})

const SQUARE_RING = [
  [0, 0],
  [1000, 0],
  [1000, 1000],
  [0, 1000],
  [0, 0]
]

describe('generateBaselineTreePoints — expansion', () => {
  it('expands one tree row into a point per band, with unique sub-refs', () => {
    const rows = [{ ref: 'T007', baselineRef: '7', area: 0.1018 }]
    const { instances, byRef } = generateBaselineTreePoints(SQUARE_RING, rows)

    expect(instances.map((i) => i.band)).toEqual([
      'Very large',
      'Medium',
      'Small',
      'Small'
    ])
    expect(instances.map((i) => i.subRef)).toEqual([
      'T007-1',
      'T007-2',
      'T007-3',
      'T007-4'
    ])
    expect(byRef.get('7')).toHaveLength(4)
  })

  it('keeps the original ref (no suffix) when a row yields a single point', () => {
    const rows = [{ ref: 'T003', baselineRef: '3', area: 163 / 10000 }]
    const { instances } = generateBaselineTreePoints(SQUARE_RING, rows)
    expect(instances).toHaveLength(1)
    expect(instances[0].subRef).toBe('T003')
    expect(instances[0].band).toBe('Medium')
  })
})

describe('derivePostInterventionTreePoints — baseline reuse', () => {
  it('reuses the baseline expansion for retained trees (same refs, points, bands)', () => {
    const baselineRows = [{ ref: 'T007', baselineRef: '7', area: 0.1018 }]
    const { byRef } = generateBaselineTreePoints(SQUARE_RING, baselineRows)

    const postRows = [
      {
        ref: 'T001',
        baselineRef: '7',
        retention: 'Retained',
        baseline: {
          condition: 'Good',
          strategicSig: 'Low',
          type: 'Urban tree'
        },
        proposed: {
          condition: 'Good',
          strategicSig: 'Low',
          type: 'Urban tree',
          advanceYears: 0,
          delayYears: 0
        }
      }
    ]
    const instances = derivePostInterventionTreePoints(
      SQUARE_RING,
      byRef,
      postRows
    )

    const baseInstances = byRef.get('7')
    expect(instances).toHaveLength(baseInstances.length)
    instances.forEach((inst, k) => {
      expect(inst.subRef).toBe(baseInstances[k].subRef)
      expect(inst.point).toBe(baseInstances[k].point)
      expect(inst.baselineBand).toBe(baseInstances[k].band)
      expect(inst.proposedBand).toBe(baseInstances[k].band)
    })
  })

  it('expands a created tree into proposed-only banded points', () => {
    const postRows = [
      {
        ref: 'T009',
        baselineRef: null,
        retention: 'Created',
        area: 0.02,
        proposed: {
          condition: 'Good',
          strategicSig: 'Low',
          type: 'Urban tree',
          advanceYears: 0,
          delayYears: 0
        }
      }
    ]
    const instances = derivePostInterventionTreePoints(
      SQUARE_RING,
      new Map(),
      postRows
    )

    expect(instances.length).toBeGreaterThan(0)
    for (const inst of instances) {
      expect(inst.baselineBand).toBeNull()
      expect(inst.proposedBand).not.toBeNull()
      expect(inst.subRef.startsWith('T009')).toBe(true)
    }
  })
})
