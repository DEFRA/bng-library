/**
 * Pins what the generators write today, so the drawing step can be split
 * from the legacy writer, and the BNG Service format drawn natively, without
 * changing a byte of it.
 *
 * Each case is dumped table by table, row by row (geometry as hex), and the
 * dump is hashed: the snapshot holds one hash per case, which is stable
 * across SQLite versions, unlike the file's own bytes.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  generateOne,
  generatePermutations,
  generateSyntheticGpkg,
  listFlaws,
  resolveFlawSelection,
  setMode
} from '../index.mjs'

const CENTRE = [530000, 180000]
const SEED = 42
const FLAW_PARCELS = 8
const PERMUTATION_SEED = 1

let dir
beforeAll(() => {
  setMode('silent')
  dir = mkdtempSync(path.join(tmpdir(), 'bng-golden-'))
})
afterAll(() => {
  setMode('cli')
  rmSync(dir, { recursive: true, force: true })
})

function cell(value) {
  return Buffer.isBuffer(value) ? value.toString('hex') : value
}

/** Every table's rows, in a stable order, hashed. */
function dumpHash(file) {
  const db = new Database(file, { readonly: true })
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
      )
      .all()
      .map((t) => t.name)
    const hash = createHash('sha256')
    for (const table of tables) {
      hash.update(`\n## ${table}\n`)
      for (const row of db.prepare(`SELECT * FROM "${table}"`).all()) {
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

function bufferHash(name, buffer) {
  const file = path.join(dir, name)
  writeFileSync(file, buffer)
  return dumpHash(file)
}

function legacy(name, plan) {
  const file = path.join(dir, `${name}.gpkg`)
  generateOne(file, CENTRE, { seed: SEED, ...plan })
  return dumpHash(file)
}

function flawPlan(names) {
  const selection = resolveFlawSelection({
    flaws: names,
    numParcels: FLAW_PARCELS
  })
  return { numParcels: FLAW_PARCELS, ...selection }
}

const legacyFlaws = listFlaws().map((f) => f.name)
const standalone = new Set(
  listFlaws()
    .filter((f) => f.standalone)
    .map((f) => f.name)
)

describe('legacy output is pinned', () => {
  it.each([
    ['small', { numParcels: 6 }],
    ['default size', { numParcels: 50 }],
    ['explicit trees', { numParcels: 20, numTrees: 9 }]
  ])('%s', (name, plan) => {
    expect(legacy(name, plan)).toMatchSnapshot()
  })

  it.each(legacyFlaws)('flaw %s', (name) => {
    expect(legacy(`flaw-${name}`, flawPlan([name]))).toMatchSnapshot()
  })

  it('--bad', () => {
    const selection = resolveFlawSelection({
      bad: true,
      flaws: [],
      numParcels: FLAW_PARCELS
    })
    expect(
      legacy('bad', { numParcels: FLAW_PARCELS, ...selection })
    ).toMatchSnapshot()
  })

  it('the scenario catalogue', () => {
    const { scenarios } = generatePermutations({ seed: PERMUTATION_SEED })
    const hashes = Object.fromEntries(
      scenarios.map((s) => [
        s.id,
        [
          bufferHash(`${s.id}-b.gpkg`, s.baseline.buffer),
          bufferHash(`${s.id}-pi.gpkg`, s.postIntervention.buffer)
        ]
      ])
    )
    expect(hashes).toMatchSnapshot()
  })

  it('standalone flaws are among the pinned ones', () => {
    expect([...standalone].every((n) => legacyFlaws.includes(n))).toBe(true)
  })
})

describe('BNG Service output is pinned', () => {
  const bngFlaws = listFlaws({ format: 'bng-service' }).map((f) => f.name)

  it.each([3, 7, 21])('a default site, seed %i', (seed) => {
    const { buffer } = generateSyntheticGpkg({
      format: 'bng-service',
      numParcels: 20,
      seed
    })
    expect(bufferHash(`bng-${seed}.gpkg`, buffer)).toMatchSnapshot()
  })

  it('a baseline-stage site', () => {
    const { buffer } = generateSyntheticGpkg({
      format: 'bng-service',
      stage: 'baseline',
      numParcels: 12,
      seed: 5
    })
    expect(bufferHash('bng-baseline.gpkg', buffer)).toMatchSnapshot()
  })

  it.each(bngFlaws)('flaw %s', (name) => {
    const { buffer } = generateSyntheticGpkg({
      format: 'bng-service',
      flaws: [name],
      numParcels: FLAW_PARCELS,
      seed: 3
    })
    expect(bufferHash(`bng-flaw-${name}.gpkg`, buffer)).toMatchSnapshot()
  })

  it('the scenario catalogue', () => {
    const { scenarios } = generatePermutations({
      seed: PERMUTATION_SEED,
      format: 'bng-service'
    })
    const hashes = Object.fromEntries(
      scenarios.map((s) => [
        s.id,
        bufferHash(`bng-${s.id}.gpkg`, s.geoPackage.buffer)
      ])
    )
    expect(hashes).toMatchSnapshot()
  })
})
