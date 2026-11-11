/**
 * A BNG Service site is drawn natively: no route through the legacy
 * generator, the bad-fixture writer, the workbook writers or the legacy
 * converter is taken, so no legacy file is written. Each is mocked to throw
 * if called, and so is the legacy layout's file opener.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  checkLineage,
  checkTemplateValues,
  generateBngServiceFromWorkbook,
  generateBaselineFile,
  generateBngServiceSynthetic,
  generateOne,
  generatePermutations,
  generateSyntheticGpkg,
  listFlaws,
  setMode
} from '../index.mjs'
import { normaliseOverrides } from '../src/bng-service/native/overrides.mjs'

const { legacyCalled } = vi.hoisted(() => ({
  legacyCalled: (name) => () => {
    throw new Error(
      `${name} was called: the native route must not write legacy`
    )
  }
}))

vi.mock('../src/synthetic/synthetic.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  generateOne: vi.fn(legacyCalled('generateOne'))
}))
vi.mock('../src/synthetic/synthetic-bad.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  generateOneBad: vi.fn(legacyCalled('generateOneBad'))
}))
vi.mock('../src/orchestration.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  generateFromWorkbook: vi.fn(legacyCalled('generateFromWorkbook'))
}))
// Every legacy writer opens its file here, the workbook route's own
// writers inside orchestration.mjs included; the BNG Service writer opens
// its file through gpkg-io, so this catches any legacy file being written.
vi.mock('../src/bng-schema.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  openGeoPackage: vi.fn(legacyCalled('openGeoPackage'))
}))
vi.mock('../src/bng-service/from-legacy.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  siteFromLegacyFile: vi.fn(legacyCalled('siteFromLegacyFile')),
  siteFromLegacyPair: vi.fn(legacyCalled('siteFromLegacyPair'))
}))

const CENTRE = [530000, 180000]
const FLAW_PARCELS = 8

let dir
beforeAll(() => {
  setMode('silent')
  dir = mkdtempSync(path.join(tmpdir(), 'bng-native-'))
})
afterAll(() => {
  setMode('cli')
  rmSync(dir, { recursive: true, force: true })
})

function written(name, buffer) {
  const file = path.join(dir, name)
  writeFileSync(file, buffer)
  return file
}

function count(file, table) {
  const db = new Database(file, { readonly: true })
  try {
    return db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n
  } finally {
    db.close()
  }
}

describe('a BNG Service site is drawn natively', () => {
  it('would fail if the legacy generator were called', () => {
    expect(() =>
      generateOne(path.join(dir, 'legacy.gpkg'), CENTRE, { numParcels: 3 })
    ).toThrow(/must not write legacy/)
  })

  it('would fail if a legacy file were written, by any writer', () => {
    expect(() =>
      generateBaselineFile(
        path.join(dir, 'legacy-baseline.gpkg'),
        null,
        { habitats: [], hedgerows: [], rivers: [], trees: [] },
        { totalAreaM2: 10_000 },
        CENTRE
      )
    ).toThrow(/openGeoPackage was called/)
  })

  it('writes a default site, every value one the template offers', () => {
    const { buffer } = generateSyntheticGpkg({
      format: 'bng-service',
      numParcels: 20,
      seed: 7
    })
    const file = written('default.gpkg', buffer)
    expect(checkTemplateValues(file)).toEqual([])
    expect(count(file, 'Area Habitats Baseline')).toBe(20)
    expect(count(file, 'Hedgerows Post-Intervention')).toBeGreaterThan(0)
  })

  it('writes the baseline-stage file', () => {
    const { buffer } = generateSyntheticGpkg({
      format: 'bng-service',
      stage: 'baseline',
      numParcels: 10,
      seed: 7
    })
    const file = written('baseline.gpkg', buffer)
    expect(count(file, 'Area Habitats Baseline')).toBe(10)
    expect(count(file, 'Area Habitats Post-Intervention')).toBe(0)
  })

  it.each(listFlaws({ format: 'bng-service' }).map((f) => f.name))(
    'writes the %s flaw',
    (name) => {
      const { buffer } = generateSyntheticGpkg({
        format: 'bng-service',
        flaws: [name],
        numParcels: FLAW_PARCELS,
        seed: 3
      })
      expect(buffer.length).toBeGreaterThan(0)
    }
  )

  it('writes through the path API too', () => {
    const file = path.join(dir, 'path.gpkg')
    generateBngServiceSynthetic(file, CENTRE, { numParcels: 6, seed: 1 })
    expect(count(file, 'Area Habitats Baseline')).toBe(6)
  })
})

describe('the scenario catalogue is drawn natively', () => {
  it('writes every scenario, one file holding both stages', () => {
    const { scenarios } = generatePermutations({
      format: 'bng-service',
      seed: 1
    })
    expect(scenarios.length).toBeGreaterThan(0)
    const file = written('scenario.gpkg', scenarios[0].geoPackage.buffer)
    expect(count(file, 'Area Habitats Post-Intervention')).toBeGreaterThan(0)
  })

  it('writes the baseline-stage file of a scenario', () => {
    const { scenarios } = generatePermutations({
      format: 'bng-service',
      stage: 'baseline',
      only: 'net-gain',
      seed: 1
    })
    const file = written(
      'scenario-baseline.gpkg',
      scenarios[0].geoPackage.buffer
    )
    expect(count(file, 'Area Habitats Baseline')).toBeGreaterThan(0)
    expect(count(file, 'Area Habitats Post-Intervention')).toBe(0)
  })
})

describe('a workbook site is drawn natively', () => {
  const workbooks = JSON.parse(
    readFileSync(
      new URL('./fixtures/scenario-workbooks.json', import.meta.url),
      'utf8'
    )
  )

  it.each(Object.keys(workbooks))('writes the site %s describes', (id) => {
    const file = path.join(dir, `wb-${id.replaceAll('/', '-')}.gpkg`)
    const result = generateBngServiceFromWorkbook(
      file,
      workbooks[id],
      `${id}.xlsx`,
      { centre: CENTRE, seed: 2 }
    )
    expect(result.success).toBe(true)
    expect(count(file, 'Area Habitats Baseline')).toBeGreaterThan(0)
  })

  it('writes the baseline-stage file', () => {
    const file = path.join(dir, 'wb-baseline.gpkg')
    generateBngServiceFromWorkbook(
      file,
      workbooks['intervention/area-created'],
      'area-created.xlsx',
      { centre: CENTRE, seed: 2, stage: 'baseline' }
    )
    expect(count(file, 'Area Habitats Baseline')).toBeGreaterThan(0)
    expect(count(file, 'Area Habitats Post-Intervention')).toBe(0)
  })
})

describe('the row overrides a native site takes', () => {
  it('reads habitatRef as the Habitat Ref', () => {
    const file = path.join(dir, 'ref.gpkg')
    generateBngServiceSynthetic(
      file,
      CENTRE,
      {
        numParcels: 4,
        seed: 1,
        attributeOverrides: { habitats: [{ habitatRef: 'MY-REF' }] }
      },
      { templateFeatures: false }
    )
    const db = new Database(file, { readonly: true })
    const ref = db
      .prepare('SELECT "Habitat Ref" AS ref FROM "Area Habitats Baseline"')
      .get().ref
    db.close()
    expect(ref).toBe('MY-REF')
  })

  it('accepts Low or High significance, and documenting $comment keys', () => {
    expect(
      normaliseOverrides({
        habitats: [
          { proposedStrategicSignificance: 'High', $comment: 'a note' }
        ]
      })
    ).toEqual({
      habitats: [{ proposedStrategicSignificance: 'High', $comment: 'a note' }]
    })
  })

  it.each([
    [{ habitats: [{ parcleRef: 'x' }] }, /unknown override "parcleRef"/],
    [{ ponds: [{}] }, /unknown override layer "ponds"/],
    [
      { habitats: [{ habitatRef: 'A', parcelRef: 'B' }] },
      /habitatRef "A" and parcelRef "B" differ/
    ]
  ])('refuses %j', (overrides, message) => {
    expect(() => normaliseOverrides(overrides)).toThrow(message)
  })

  it('ignores a tree count, as the format always has: each point is one tree', () => {
    expect(normaliseOverrides({ trees: [{ count: 3 }] })).toEqual({
      trees: [{ count: 3 }]
    })
  })

  it('keeps a tree count of 1, which is what a tree point is', () => {
    expect(normaliseOverrides({ trees: [{ count: 1 }] })).toEqual({
      trees: [{ count: 1 }]
    })
  })
})

describe("a tree planted in a felled one's place", () => {
  const TREES = [
    { retention: 'Lost' },
    { retention: 'Created', replants: 'T001' },
    { retention: 'Created' }
  ]

  function trees(overrides, name) {
    const file = path.join(dir, name)
    generateBngServiceSynthetic(
      file,
      CENTRE,
      {
        numParcels: 1,
        numTrees: TREES.length,
        seed: 3,
        attributeOverrides: { trees: overrides }
      },
      { templateFeatures: false }
    )
    const db = new Database(file, { readonly: true })
    try {
      const read = (stage) =>
        db
          .prepare(
            `SELECT * FROM "Individual Trees ${stage}" ORDER BY "Habitat Ref"`
          )
          .all()
      return {
        file,
        baseline: read('Baseline'),
        post: read('Post-Intervention')
      }
    } finally {
      db.close()
    }
  }

  it('stands on its point, linked to it, and is still a newly planted creation', () => {
    const { file, baseline, post } = trees(TREES, 'replanted.gpkg')
    const [felled] = baseline
    expect(felled['Habitat Ref']).toBe('T001')
    const planted = post.find((row) => row['Habitat Ref'] === 'T002')
    expect(planted).toMatchObject({
      'Parent Ref': 'T001',
      parent_uuid: felled.feature_uuid,
      'Retention Category': 'Created',
      Category: 'Newly Planted',
      'Baseline Tree Size': 'N/A',
      'Baseline Condition': 'N/A'
    })
    expect(planted.geom.equals(felled.geom)).toBe(true)
    expect(
      post.find((row) => row['Habitat Ref'] === 'T003')['Parent Ref']
    ).toBeNull()
    expect(checkLineage(file)).toEqual([])
    expect(checkTemplateValues(file)).toEqual([])
  })

  it('leaves the rest of the site drawn as without the pin', () => {
    const plain = trees(
      TREES.map(({ replants, ...row }) => row),
      'plain.gpkg'
    )
    const pinned = trees(TREES, 'pinned.gpkg')
    const point = (rows, ref) =>
      rows.find((row) => row['Habitat Ref'] === ref).geom
    expect(point(pinned.post, 'T003').equals(point(plain.post, 'T003'))).toBe(
      true
    )
    expect(point(pinned.post, 'T002').equals(point(plain.post, 'T002'))).toBe(
      false
    )
  })
})
