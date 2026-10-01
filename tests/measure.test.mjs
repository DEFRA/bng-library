// Through the package specifier, as the backend and the harness import it, so
// a mistake in package.json's "exports" map fails here rather than there.
import { describe, expect, it } from 'vitest'

import { areaSquareMetres, lengthMetres } from 'bng-library/measure'

// Baseline parcel H001 and hedgerow HG001 of the harness's
// example-files/permutations/intervention/area-enhanced-baseline.gpkg, on
// British National Grid, with the area and length the backend priced them on
// when it measured with GEOS (geos-wasm 3.1.1). Pinned to the last digit: the
// backend's sizes must not move now that it measures with this module. The
// textbook shoelace gives H001 as 144529.08115386963.
const H001 = [
  [530066.9373186704, 179556.3807426773],
  [530136.902344139, 179534.75631210193],
  [530408.2527507545, 179680.27897243464],
  [530444.5050301832, 179786.91852747035],
  [530109.2448720403, 180220.78137088363],
  [530066.9373186704, 179556.3807426773]
]
const H001_AREA = 144529.0811549303
const HG001 = [
  [530025.3587009454, 180211.10748672587],
  [530055.2245340901, 180027.52660581493],
  [530045.4303503721, 179841.79028252096]
]
const HG001_LENGTH = 371.98875157975516

// A 10 × 20 rectangle and a 5 × 5 square inside it.
const RECT = [
  [0, 0],
  [10, 0],
  [10, 20],
  [0, 20],
  [0, 0]
]
const SQUARE = [
  [1, 1],
  [6, 1],
  [6, 6],
  [1, 6],
  [1, 1]
]

describe('areaSquareMetres', () => {
  it('measures a polygon', () => {
    expect(areaSquareMetres({ type: 'Polygon', coordinates: [RECT] })).toBe(200)
  })

  it('measures the same whichever way the ring winds', () => {
    const reversed = [...RECT].reverse()
    expect(areaSquareMetres({ type: 'Polygon', coordinates: [reversed] })).toBe(
      200
    )
  })

  it('subtracts holes from the exterior ring', () => {
    expect(
      areaSquareMetres({ type: 'Polygon', coordinates: [RECT, SQUARE] })
    ).toBe(175)
  })

  it('sums the polygons of a multipolygon', () => {
    expect(
      areaSquareMetres({
        type: 'MultiPolygon',
        coordinates: [[RECT], [SQUARE]]
      })
    ).toBe(225)
  })

  it('measures a British National Grid parcel to the last digit', () => {
    expect(areaSquareMetres({ type: 'Polygon', coordinates: [H001] })).toBe(
      H001_AREA
    )
  })

  it('measures 0 for anything that is not a polygon', () => {
    expect(areaSquareMetres({ type: 'LineString', coordinates: HG001 })).toBe(0)
    expect(areaSquareMetres(null)).toBe(0)
    expect(areaSquareMetres(undefined)).toBe(0)
  })

  // GEOS (geos-wasm 3.1.1, GEOSArea) gives -96 for this invalid polygon too:
  // the measurement follows GEOS rather than clamp at 0.
  it('measures an invalid polygon whose hole exceeds its shell as GEOS does', () => {
    const shell = [
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
      [4, 4]
    ]
    const hole = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0]
    ]
    expect(
      areaSquareMetres({ type: 'Polygon', coordinates: [shell, hole] })
    ).toBe(-96)
  })

  it('measures 0 for a ring too short to enclose anything', () => {
    expect(
      areaSquareMetres({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 1],
            [0, 0]
          ]
        ]
      })
    ).toBe(0)
  })
})

describe('lengthMetres', () => {
  it('sums the segments of a line string', () => {
    expect(
      lengthMetres({
        type: 'LineString',
        coordinates: [
          [0, 0],
          [3, 4],
          [3, 10]
        ]
      })
    ).toBe(11)
  })

  it('sums the lines of a multi line string', () => {
    expect(
      lengthMetres({
        type: 'MultiLineString',
        coordinates: [
          [
            [0, 0],
            [3, 4]
          ],
          [
            [0, 0],
            [0, 2]
          ]
        ]
      })
    ).toBe(7)
  })

  it('measures a British National Grid hedgerow to the last digit', () => {
    expect(lengthMetres({ type: 'LineString', coordinates: HG001 })).toBe(
      HG001_LENGTH
    )
  })

  it('measures 0 for anything that is not a line', () => {
    expect(lengthMetres({ type: 'Polygon', coordinates: [RECT] })).toBe(0)
    expect(lengthMetres(null)).toBe(0)
  })
})
