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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  MODE_BASELINE,
  generateBngServiceFromWorkbook,
  generateFromWorkbook,
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

// Parsed metric workbooks: the hedgerow-created fixture and a dozen of the
// harness's scenario workbooks, covering creation, enhancement and loss on
// every layer, culverts, lost trees, trading and a tree count above one.
const WORKBOOKS = {
  'hedgerow-created': JSON.parse(
    readFileSync(
      new URL('./fixtures/workbook-hedgerow-created.json', import.meta.url),
      'utf8'
    )
  ),
  ...JSON.parse(
    readFileSync(
      new URL('./fixtures/scenario-workbooks.json', import.meta.url),
      'utf8'
    )
  )
}
const WORKBOOK_SEED = 17
const workbookName = (id) => id.replaceAll('/', '-')

describe('workbook output is pinned', () => {
  it.each(Object.keys(WORKBOOKS))('legacy pair from %s', (id) => {
    const name = workbookName(id)
    const outPaths = {
      baseline: path.join(dir, `wb-${name}-b.gpkg`),
      postIntervention: path.join(dir, `wb-${name}-pi.gpkg`)
    }
    const result = generateFromWorkbook(outPaths, WORKBOOKS[id], `${id}.xlsx`, {
      centre: CENTRE,
      seed: WORKBOOK_SEED
    })
    expect(result.success).toBe(true)
    expect([
      dumpHash(outPaths.baseline),
      dumpHash(outPaths.postIntervention)
    ]).toMatchSnapshot()
  })

  it.each(Object.keys(WORKBOOKS))('BNG Service file from %s', (id) => {
    const out = path.join(dir, `wb-${workbookName(id)}-bng.gpkg`)
    const result = generateBngServiceFromWorkbook(
      out,
      WORKBOOKS[id],
      `${id}.xlsx`,
      { centre: CENTRE, seed: WORKBOOK_SEED }
    )
    expect(result.success).toBe(true)
    expect(dumpHash(out)).toMatchSnapshot()
  })

  it('a BNG Service baseline-stage file from a workbook', () => {
    const out = path.join(dir, 'wb-bng-baseline.gpkg')
    generateBngServiceFromWorkbook(
      out,
      WORKBOOKS['intervention/area-created'],
      'area-created.xlsx',
      { centre: CENTRE, seed: WORKBOOK_SEED, stage: 'baseline' }
    )
    expect(dumpHash(out)).toMatchSnapshot()
  })

  it('a legacy baseline file alone', () => {
    const outPaths = { baseline: path.join(dir, 'wb-mode-b.gpkg') }
    generateFromWorkbook(
      outPaths,
      WORKBOOKS['trading-rules/trading-lost-trees'],
      'trading-lost-trees.xlsx',
      { centre: CENTRE, seed: WORKBOOK_SEED, mode: MODE_BASELINE }
    )
    expect(dumpHash(outPaths.baseline)).toMatchSnapshot()
  })
})
