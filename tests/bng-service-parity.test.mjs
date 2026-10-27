/**
 * The native BNG Service route and the converter agree: a site drawn
 * natively is the site the converter reads from the legacy file the same
 * plan and seed write. Kept as a test so the two cannot drift apart, now
 * that no generation route goes through the converter.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  generateBngServiceFromWorkbook,
  generateBngServiceSynthetic,
  generateFromWorkbook,
  generateOne,
  resolveFlawSelection,
  setMode,
  writeBngServiceFromLegacy
} from '../index.mjs'
import { areaLayerOffers } from '../src/bng-service/vocabulary.mjs'
import { SCENARIOS, scenarioInFormat } from '../src/permutations/catalogue.mjs'
import { scenarioPlan } from '../src/permutations/generate.mjs'
import { derivePermutationSeed } from '../src/permutations/seed.mjs'
import { workbookRowsFromGeoPackage } from '../src/workbook-writer/index.mjs'

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
  generateOne(legacyPath, CENTRE, {
    ...plan,
    habitatFilter: areaLayerOffers,
    excludeOwnTypeCreation: true,
    loseOnlyCanalsAndDitches: true
  })
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

const byReference = (a, b) =>
  String(a.reference).localeCompare(String(b.reference)) ||
  JSON.stringify(a).localeCompare(JSON.stringify(b))

function sortedRows(file) {
  const { rows } = workbookRowsFromGeoPackage(file)
  return Object.fromEntries(
    Object.entries(rows).map(([sheet, list]) => [
      sheet,
      [...list].sort(byReference)
    ])
  )
}

describe('a scenario’s workbook reads the same from either format', () => {
  it.each(
    SCENARIOS.filter((s) => scenarioInFormat(s, 'bng-service')).map((s) => s.id)
  )('%s', (id) => {
    const scenario = SCENARIOS.find((s) => s.id === id)
    const plan = {
      ...scenarioPlan(scenario),
      seed: derivePermutationSeed(1, id)
    }
    const legacyPath = path.join(dir, `${id}-legacy.gpkg`)
    const outPath = path.join(dir, `${id}-native.gpkg`)
    generateOne(legacyPath, CENTRE, {
      ...plan,
      habitatFilter: areaLayerOffers,
      excludeOwnTypeCreation: true,
      loseOnlyCanalsAndDitches: true
    })
    generateBngServiceSynthetic(outPath, CENTRE, plan, {
      templateFeatures: false
    })
    const legacy = sortedRows(legacyPath)
    const native = sortedRows(outPath)
    for (const sheet of Object.keys(legacy)) {
      expect(native[sheet], sheet).toHaveLength(legacy[sheet].length)
      legacy[sheet].forEach((row, i) => {
        for (const [key, value] of Object.entries(row)) {
          const actual = native[sheet][i][key]
          if (typeof value === 'number') {
            expect(actual, `${sheet} ${row.reference} ${key}`).toBeCloseTo(
              value,
              9
            )
          } else {
            expect(actual, `${sheet} ${row.reference} ${key}`).toBe(value)
          }
        }
      })
    }
  })
})

describe('a workbook site drawn natively is the one the converter reads from its legacy pair', () => {
  const workbooks = {
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

  it.each(Object.keys(workbooks))('%s', (id) => {
    const name = id.replaceAll('/', '-')
    const seed = 23
    const outPaths = {
      baseline: path.join(dir, `wbp-${name}-b.gpkg`),
      postIntervention: path.join(dir, `wbp-${name}-pi.gpkg`)
    }
    generateFromWorkbook(outPaths, workbooks[id], `${id}.xlsx`, {
      centre: CENTRE,
      seed
    })
    const converted = path.join(dir, `wbp-${name}-converted.gpkg`)
    writeBngServiceFromLegacy(
      {
        baselinePath: outPaths.baseline,
        postInterventionPath: outPaths.postIntervention
      },
      converted,
      { seed }
    )
    const native = path.join(dir, `wbp-${name}-native.gpkg`)
    generateBngServiceFromWorkbook(native, workbooks[id], `${id}.xlsx`, {
      centre: CENTRE,
      seed
    })
    expect(dumpHash(native)).toBe(dumpHash(converted))
  })
})
