/**
 * The native BNG Service route and the converter agree: a site drawn
 * natively is the site the converter reads from the legacy file the same
 * plan and seed write. Kept as a test so the two cannot drift apart, now
 * that no generation route goes through the converter.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  generateBngServiceSynthetic,
  generateOne,
  resolveFlawSelection,
  setMode,
  writeBngServiceFromLegacy
} from '../index.mjs'
import { areaLayerOffers } from '../src/bng-service/vocabulary.mjs'

const CENTRE = [530000, 180000]

let dir
beforeAll(() => {
  setMode('silent')
  dir = mkdtempSync(path.join(tmpdir(), 'bng-parity-'))
})
afterAll(() => {
  setMode('cli')
  rmSync(dir, { recursive: true, force: true })
})

function cell(value) {
  return Buffer.isBuffer(value) ? value.toString('hex') : value
}

function dumpHash(file) {
  const db = new Database(file, { readonly: true })
  try {
    const hash = createHash('sha256')
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
      )
      .all()
    for (const { name } of tables) {
      hash.update(`\n## ${name}\n`)
      for (const row of db.prepare(`SELECT * FROM "${name}"`).all()) {
        hash.update(
          JSON.stringify(Object.entries(row).map(([k, v]) => [k, cell(v)]))
        )
      }
    }
    return hash.digest('hex')
  } finally {
    db.close()
  }
}

function converted(name, plan) {
  const legacyPath = path.join(dir, `${name}-legacy.gpkg`)
  const outPath = path.join(dir, `${name}-converted.gpkg`)
  generateOne(legacyPath, CENTRE, { ...plan, habitatFilter: areaLayerOffers })
  writeBngServiceFromLegacy({ legacyPath }, outPath, {
    seed: plan.seed,
    overrides: plan.attributeOverrides,
    emptyLayers: plan.emptyLayers
  })
  return dumpHash(outPath)
}

function native(name, plan) {
  const outPath = path.join(dir, `${name}-native.gpkg`)
  generateBngServiceSynthetic(outPath, CENTRE, plan, {
    templateFeatures: false
  })
  return dumpHash(outPath)
}

function flawPlan(flaws, seed) {
  return {
    numParcels: 8,
    seed,
    ...resolveFlawSelection({ flaws, numParcels: 8 })
  }
}

describe('native and converted sites agree', () => {
  it.each([
    ['small', { numParcels: 5, seed: 1 }],
    ['medium', { numParcels: 20, seed: 9 }],
    ['large', { numParcels: 60, seed: 11 }],
    ['explicit trees', { numParcels: 12, numTrees: 9, seed: 4 }]
  ])('%s site', (name, plan) => {
    expect(native(name, plan)).toBe(converted(name, plan))
  })

  it.each([
    'no-hedgerows',
    'duplicate-habitat-ref',
    'missing-habitat-ref',
    'advance-delay-both-set',
    'bowtie-parcel',
    'iggi-outside',
    'redline-not-in-england'
  ])('flaw %s', (name) => {
    const plan = flawPlan([name], 5)
    expect(native(name, plan)).toBe(converted(name, plan))
  })
})

describe('the converter checks its row overrides as every route does', () => {
  it('refuses a mistyped key', () => {
    const legacyPath = path.join(dir, 'checked-legacy.gpkg')
    generateOne(legacyPath, CENTRE, { numParcels: 4, seed: 1 })
    expect(() =>
      writeBngServiceFromLegacy(
        { legacyPath },
        path.join(dir, 'checked.gpkg'),
        { overrides: { habitats: [{ irreplacable: 'Yes' }] } }
      )
    ).toThrow(/unknown override "irreplacable"/)
  })
})
