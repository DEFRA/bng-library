import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openGeoPackageReadonly } from '../src/gpkg-io/index.mjs'
import { deriveBaselineFromSynthetic, generateOne } from '../index.mjs'

const NUM_PARCELS = 40
const CENTRE = [530000, 180000]
const LAYERS = ['Habitats', 'Hedgerows', 'Rivers', 'Urban Trees']

describe('deriveBaselineFromSynthetic', () => {
  let outDir
  let piPath
  let baselinePath

  beforeAll(() => {
    outDir = mkdtempSync(path.join(tmpdir(), 'bng-synthetic-baseline-'))
    piPath = path.join(outDir, 'post-intervention.gpkg')
    baselinePath = path.join(outDir, 'baseline.gpkg')
    generateOne(piPath, CENTRE, { numParcels: NUM_PARCELS })
    deriveBaselineFromSynthetic(piPath, baselinePath)
  })

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true })
  })

  const read = (file, sql) => {
    const db = openGeoPackageReadonly(file)
    try {
      return db.prepare(sql).all()
    } finally {
      db.close()
    }
  }

  it('shares a byte-identical redline with the post-intervention half', () => {
    const sql = `SELECT hex(geometry) AS g FROM "Red Line Boundary"`
    expect(read(baselinePath, sql)).toEqual(read(piPath, sql))
  })

  it('keeps every feature, so refs line up across the pair', () => {
    for (const layer of LAYERS) {
      const sql = `SELECT count(*) AS n FROM "${layer}"`
      expect(read(baselinePath, sql)).toEqual(read(piPath, sql))
    }
  })

  it('clears Retention Category on every layer', () => {
    for (const layer of LAYERS) {
      const rows = read(
        baselinePath,
        `SELECT count(*) AS n FROM "${layer}" WHERE "Retention Category" IS NOT NULL`
      )
      expect(rows[0].n).toBe(0)
    }
  })

  it('clears the proposed columns but keeps the baseline ones', () => {
    const [row] = read(
      baselinePath,
      `SELECT "Proposed Habitat Type" AS proposed,
              "Proposed Distinctiveness" AS proposedBand,
              "Baseline Habitat Type" AS baseline,
              "Area" AS area
       FROM "Habitats" LIMIT 1`
    )
    expect(row.proposed).toBeNull()
    expect(row.proposedBand).toBeNull()
    expect(row.baseline).toBeTruthy()
    expect(row.area).toBeGreaterThan(0)
  })

  it('clears the watercourse-only proposed columns', () => {
    const [row] = read(
      baselinePath,
      `SELECT count(*) AS n FROM "Rivers"
       WHERE "Proposed Encroachment into Watercourse" IS NOT NULL
          OR "Enhancement Type" IS NOT NULL`
    )
    expect(row.n).toBe(0)
  })

  it('leaves the post-intervention file untouched', () => {
    const [row] = read(
      piPath,
      `SELECT count(*) AS n FROM "Habitats" WHERE "Retention Category" IS NOT NULL`
    )
    expect(row.n).toBeGreaterThan(0)
  })
})
