import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { generateBngServiceSynthetic, setMode } from '../index.mjs'
import { clearSeed, setSeed } from '../src/geometry.mjs'
import { drawSite } from '../src/synthetic/draw/site.mjs'
import {
  REMOVABLE_RIVER_TYPES as REMOVABLE,
  lostRiverTypes
} from './lineage-rules.mjs'

const CENTRE = [530000, 180000]
const SEEDS = [1, 2, 3, 6, 7, 21]
const LARGE_SITE = 30

let dir
let counter = 0

beforeAll(() => {
  setMode('silent')
  dir = mkdtempSync(path.join(tmpdir(), 'bng-service-natural-rivers-'))
})

afterAll(() => {
  setMode('cli')
  rmSync(dir, { recursive: true, force: true })
})

// The template records a lost watercourse by its absence from the
// Post-Intervention table, and the service refuses any but a canal or a
// ditch left out (guide: natural rivers cannot be permanently lost).
describe('a random BNG Service site loses no watercourse but a canal or a ditch', () => {
  for (const seed of SEEDS) {
    for (const numParcels of [undefined, LARGE_SITE]) {
      it(`seed ${seed}, ${numParcels ?? 'default'} parcels`, () => {
        counter += 1
        const out = path.join(dir, `site-${counter}.gpkg`)
        generateBngServiceSynthetic(out, CENTRE, { seed, numParcels })

        for (const type of lostRiverTypes(out)) {
          expect(REMOVABLE.has(type), type).toBe(true)
        }
      })
    }
  }
})

describe('the natural river rule is its own option', () => {
  const DRAW_SEEDS = Array.from({ length: 30 }, (_, i) => i + 1)

  /** The types of the watercourses drawn Lost, over every seed. */
  function lostTypes(plan) {
    return DRAW_SEEDS.flatMap((seed) => {
      setSeed(seed)
      try {
        return drawSite(CENTRE, { numParcels: 10, ...plan })
          .rivers.filter((river) => river.retention === 'Lost')
          .map((river) => river.type)
      } finally {
        clearSeed()
      }
    })
  }

  it('a legacy draw still loses watercourses of any type', () => {
    expect(lostTypes({}).some((type) => !REMOVABLE.has(type))).toBe(true)
  })

  it('a BNG Service draw loses only canals and ditches, and still loses them', () => {
    const lost = lostTypes({ loseOnlyCanalsAndDitches: true })
    expect(lost.length).toBeGreaterThan(0)
    expect(lost.filter((type) => !REMOVABLE.has(type))).toEqual([])
  })
})

// With Lost kept from it, a culvert (row 0, which a culvert cannot enhance)
// has only Retained to draw, and a pinned proposed type drops Retained too.
describe('a culvert that changes type in a BNG Service draw', () => {
  const ditchFromCulvert = { proposedRiverType: 'Ditches' }

  function drawRivers(override, plan) {
    setSeed(1)
    try {
      return drawSite(CENTRE, {
        numParcels: 10,
        attributeOverrides: { rivers: [override] },
        ...plan
      }).rivers
    } finally {
      clearSeed()
    }
  }

  it('fails, naming the row, rather than write it with no retention', () => {
    expect(() =>
      drawRivers(ditchFromCulvert, { loseOnlyCanalsAndDitches: true })
    ).toThrow(/^rivers row 0: no retention category is left to draw/)
  })

  it('is drawn with the retention the override pins', () => {
    const [river] = drawRivers(
      { ...ditchFromCulvert, retention: 'Created' },
      { loseOnlyCanalsAndDitches: true }
    )
    expect(river).toMatchObject({ type: 'Culvert', retention: 'Created' })
  })

  it('is still drawn Lost in a legacy draw', () => {
    const [river] = drawRivers(ditchFromCulvert, {})
    expect(river).toMatchObject({ type: 'Culvert', retention: 'Lost' })
  })
})
