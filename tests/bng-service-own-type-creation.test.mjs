import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { generateBngServiceSynthetic, setMode } from '../index.mjs'
import { clearSeed, setSeed } from '../src/geometry.mjs'
import { drawSite } from '../src/synthetic/draw/site.mjs'
import { habitatPools } from '../src/synthetic/draw/rules.mjs'
import { WORSE_HABITAT_COMMENT } from '../src/bng-service/template-features.mjs'

const CENTRE = [530000, 180000]
const SEEDS = [1, 2, 3, 6, 7, 21]
const LARGE_SITE = 30

let dir
let counter = 0

beforeAll(() => {
  setMode('silent')
  dir = mkdtempSync(path.join(tmpdir(), 'bng-service-own-type-'))
})

afterAll(() => {
  setMode('cli')
  rmSync(dir, { recursive: true, force: true })
})

/** The Created area rows in their parent's own type, by Habitat Ref. */
function ownTypeCreations(file) {
  const db = new Database(file, { readonly: true })
  try {
    return db
      .prepare(
        `SELECT p."Habitat Ref" AS ref, p."Comment" AS comment
           FROM "Area Habitats Post-Intervention" p
           JOIN "Area Habitats Baseline" b ON b.feature_uuid = p.parent_uuid
          WHERE p."Retention Category" = 'Created'
            AND p."Proposed Habitat Type" = b."Baseline Habitat Type"`
      )
      .all()
  } finally {
    db.close()
  }
}

function synthetic(plan, options) {
  counter += 1
  const out = path.join(dir, `site-${counter}.gpkg`)
  generateBngServiceSynthetic(out, CENTRE, plan, options)
  return out
}

// The template reads a Created area habitat in its parent's own type as one
// that gets worse, which the service refuses without 30+ years in advance,
// or as a same-type creation that is not worse, which it refuses outright.
// Only the habitats drawn for the purpose may be one.
describe('a random BNG Service site creates no area habitat in its own type by chance', () => {
  for (const seed of SEEDS) {
    for (const numParcels of [undefined, LARGE_SITE]) {
      it(`seed ${seed}, ${numParcels ?? 'default'} parcels`, () => {
        const plain = synthetic(
          { seed, numParcels },
          { templateFeatures: false }
        )
        expect(ownTypeCreations(plain)).toEqual([])

        const full = synthetic({ seed, numParcels })
        for (const row of ownTypeCreations(full)) {
          expect(row.comment, row.ref).toBe(WORSE_HABITAT_COMMENT)
        }
      })
    }
  }
})

describe('the own-type creation rule is its own option', () => {
  const NEUTRAL = 'Grassland - Other neutral grassland'
  const onlyNeutral = (fullName) => fullName === NEUTRAL
  const PARCELS = 40

  function retentions(plan) {
    setSeed(1)
    try {
      return drawSite(CENTRE, { numParcels: PARCELS, ...plan }).habitats.map(
        (parcel) => parcel.retention
      )
    } finally {
      clearSeed()
    }
  }

  it('a habitat filter alone only narrows the pools', () => {
    expect(habitatPools(onlyNeutral).excludeOwnType).toBe(false)
    expect(
      habitatPools(onlyNeutral, { excludeOwnTypeCreation: true }).excludeOwnType
    ).toBe(true)
    expect(retentions({ habitatFilter: onlyNeutral })).toEqual(
      expect.arrayContaining(['Created', 'Lost'])
    )
  })

  it('draws neither Created nor Lost where the parcel own type is all there is to create', () => {
    const drawn = retentions({
      habitatFilter: onlyNeutral,
      excludeOwnTypeCreation: true
    })
    expect(drawn).toHaveLength(PARCELS)
    expect(drawn).not.toContain('Created')
    expect(drawn).not.toContain('Lost')
  })
})
