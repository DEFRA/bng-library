/**
 * checkLineage reports how each post-intervention feature names its parent,
 * each problem by the lineage flaw that writes it.
 */
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  encodeGpkgBinary,
  encodeWkbPolygon,
  envelopeFromCoords,
  wkbToGeoJSON
} from '../src/gpkg-io/index.mjs'
import { geometryWkt } from '../src/bng-service/site.mjs'
import { interiorPoint } from '../src/bng-service/pair.mjs'
import {
  checkLineage,
  generatePermutations,
  generateSyntheticGpkg,
  listFlaws,
  setMode
} from '../index.mjs'

let dir
beforeAll(() => {
  setMode('silent')
  dir = mkdtempSync(path.join(tmpdir(), 'bng-lineage-'))
})
afterAll(() => {
  setMode('cli')
  rmSync(dir, { recursive: true, force: true })
})

function site(name, options) {
  const file = path.join(dir, `${name}.gpkg`)
  writeFileSync(
    file,
    generateSyntheticGpkg({ format: 'bng-service', ...options }).buffer
  )
  return file
}

/** A copy of `file` with `sql` run on it, as a user's file could be. */
function edited(file, name, sql) {
  const copy = path.join(dir, `${name}.gpkg`)
  copyFileSync(file, copy)
  const db = new Database(copy)
  try {
    db.exec(sql)
  } finally {
    db.close()
  }
  return copy
}

const lineageFlaws = listFlaws({ format: 'bng-service' })
  .map((f) => f.name)
  .filter((name) => name.startsWith('lineage-'))

describe('checkLineage', () => {
  it.each([1, 4, 7, 15])(
    'finds nothing wrong in a default site, seed %i',
    (seed) => {
      expect(
        checkLineage(site(`default-${seed}`, { numParcels: 30, seed }))
      ).toEqual([])
    }
  )

  it('finds nothing wrong in any scenario', () => {
    for (const s of generatePermutations({ format: 'bng-service', seed: 1 })
      .scenarios) {
      const file = path.join(dir, `scenario-${s.id}.gpkg`)
      writeFileSync(file, s.geoPackage.buffer)
      expect(checkLineage(file), s.id).toEqual([])
    }
  })

  it.each(lineageFlaws)('reports %s by its own name, once', (flaw) => {
    const problems = checkLineage(
      site(flaw, { numParcels: 8, seed: 3, flaws: [flaw] })
    )
    expect(problems).toEqual([
      expect.objectContaining({
        table: 'Area Habitats Post-Intervention',
        flaw
      })
    ])
  })

  it('reads parent_geom as a shape, not as text', () => {
    const file = site('wkt', { numParcels: 8, seed: 3 })
    const respelt = edited(
      file,
      'wkt-respelt',
      `UPDATE "Area Habitats Post-Intervention"
         SET parent_geom = lower(replace(parent_geom, 'POLYGON (', 'Polygon(('))
           || ')'
         WHERE parent_geom LIKE 'POLYGON%'`
    )
    // 'POLYGON ((…))' respelt 'polygon((((…)))': still the parent's shape.
    const db = new Database(respelt, { readonly: true })
    const sample = db
      .prepare(
        `SELECT parent_geom FROM "Area Habitats Post-Intervention" WHERE parent_geom IS NOT NULL`
      )
      .get().parent_geom
    db.close()
    expect(sample.startsWith('polygon')).toBe(true)
    expect(checkLineage(respelt)).toEqual([])
  })

  it('accepts a Created feature with no parent, and flags a kept one', () => {
    const file = site('parentless', { numParcels: 30, seed: 4 })
    const db = new Database(file, { readonly: true })
    const [created] = db
      .prepare(
        `SELECT "Habitat Ref" AS ref FROM "Hedgerows Post-Intervention"
          WHERE "Retention Category" = 'Created' AND parent_uuid IS NULL`
      )
      .all()
    const [kept] = db
      .prepare(
        `SELECT "Habitat Ref" AS ref FROM "Hedgerows Post-Intervention"
          WHERE "Retention Category" IN ('Retained', 'Enhanced')`
      )
      .all()
    db.close()
    expect(created).toBeDefined()
    expect(kept).toBeDefined()
    const unlinked = edited(
      file,
      'unlinked-hedge',
      `UPDATE "Hedgerows Post-Intervention"
         SET "Parent Ref" = NULL, parent_uuid = NULL, parent_geom = NULL
         WHERE "Habitat Ref" = '${kept.ref}'`
    )
    expect(checkLineage(unlinked)).toEqual([
      {
        table: 'Hedgerows Post-Intervention',
        ref: kept.ref,
        flaw: 'lineage-parent-missing',
        detail: 'names no parent'
      }
    ])
  })

  it('leaves an open handle open', () => {
    const db = new Database(site('handle', { numParcels: 6, seed: 2 }), {
      readonly: true
    })
    expect(checkLineage(db)).toEqual([])
    expect(db.open).toBe(true)
    db.close()
  })
})

const AREA_PI = 'Area Habitats Post-Intervention'
const AREA_BASELINE = 'Area Habitats Baseline'
const SRS_ID = 27700

/** A GeoPackage blob of a MultiPolygon holding `polygons` (lists of rings). */
function multiPolygonBlob(polygons) {
  const header = Buffer.alloc(9)
  header.writeUInt8(1, 0)
  header.writeUInt32LE(6, 1)
  header.writeUInt32LE(polygons.length, 5)
  const wkb = Buffer.concat([header, ...polygons.map(encodeWkbPolygon)])
  return encodeGpkgBinary(SRS_ID, wkb, envelopeFromCoords(polygons[0][0]))
}

/** A copy of `file` changed by `edit(db)`, as a user's file could be. */
function changed(file, name, edit) {
  const copy = path.join(dir, `${name}.gpkg`)
  copyFileSync(file, copy)
  const db = new Database(copy)
  try {
    edit(db)
  } finally {
    db.close()
  }
  return copy
}

/** The first Retained area habitat and its parent, as rows with shapes. */
function keptParcel(db) {
  const child = db
    .prepare(
      `SELECT * FROM "${AREA_PI}" WHERE "Retention Category" = 'Retained' ORDER BY fid LIMIT 1`
    )
    .get()
  const parent = db
    .prepare(`SELECT * FROM "${AREA_BASELINE}" WHERE feature_uuid = ?`)
    .get(child.parent_uuid)
  return {
    child: { ...child, shape: wkbToGeoJSON(child.geom) },
    parent: { ...parent, shape: wkbToGeoJSON(parent.geom) }
  }
}

describe('checkLineage on files written outside the generator', () => {
  let file
  beforeAll(() => {
    file = site('outside', { numParcels: 12, seed: 5 })
  })

  it('reads single-part MultiPolygons, and a MULTIPOLYGON parent_geom, as the shapes they hold', () => {
    const multi = changed(file, 'multipolygon', (db) => {
      const { child, parent } = keptParcel(db)
      db.prepare(`UPDATE "${AREA_BASELINE}" SET geom = ? WHERE fid = ?`).run(
        multiPolygonBlob([parent.shape.coordinates]),
        parent.fid
      )
      db.prepare(
        `UPDATE "${AREA_PI}" SET geom = ?, parent_geom = ? WHERE fid = ?`
      ).run(
        multiPolygonBlob([child.shape.coordinates]),
        geometryWkt(parent.shape).replace('POLYGON (', 'MULTIPOLYGON ((') + ')',
        child.fid
      )
    })
    expect(checkLineage(multi)).toEqual([])
  })

  it('finds an area habitat whose inside point falls in a hole of its parent', () => {
    const holed = changed(file, 'in-a-hole', (db) => {
      const { child, parent } = keptParcel(db)
      const [x, y] = interiorPoint(child.shape.coordinates[0])
      const half = 0.5
      const hole = [
        [x - half, y - half],
        [x - half, y + half],
        [x + half, y + half],
        [x + half, y - half],
        [x - half, y - half]
      ]
      const shape = {
        type: 'Polygon',
        coordinates: [parent.shape.coordinates[0], hole]
      }
      db.prepare(`UPDATE "${AREA_BASELINE}" SET geom = ? WHERE fid = ?`).run(
        encodeGpkgBinary(
          SRS_ID,
          encodeWkbPolygon(shape.coordinates),
          envelopeFromCoords(shape.coordinates[0])
        ),
        parent.fid
      )
      db.prepare(`UPDATE "${AREA_PI}" SET parent_geom = ? WHERE fid = ?`).run(
        geometryWkt(shape),
        child.fid
      )
    })
    expect(checkLineage(holed)).toEqual([
      expect.objectContaining({ table: AREA_PI, flaw: 'lineage-parent-wrong' })
    ])
  })

  it('finds a Parent Ref that names another feature than its parent_uuid', () => {
    const db = new Database(file, { readonly: true })
    const { child } = keptParcel(db)
    const other = db
      .prepare(
        `SELECT "Habitat Ref" AS ref FROM "${AREA_BASELINE}" WHERE feature_uuid != ? LIMIT 1`
      )
      .get(child.parent_uuid)
    db.close()
    const misnamed = changed(file, 'parent-ref', (edit) =>
      edit
        .prepare(`UPDATE "${AREA_PI}" SET "Parent Ref" = ? WHERE fid = ?`)
        .run(other.ref, child.fid)
    )
    expect(checkLineage(misnamed)).toEqual([
      expect.objectContaining({
        ref: child['Habitat Ref'],
        flaw: 'lineage-parent-wrong',
        detail: expect.stringContaining(`Parent Ref ${other.ref}`)
      })
    ])
  })

  it('reports a parent_geom it cannot read as unreadable, not as a mismatch', () => {
    const unreadable = changed(file, 'unreadable', (db) =>
      db
        .prepare(
          `UPDATE "${AREA_PI}" SET parent_geom = 'GEOMETRYCOLLECTION EMPTY' WHERE fid = ?`
        )
        .run(keptParcel(db).child.fid)
    )
    expect(checkLineage(unreadable)).toEqual([
      expect.objectContaining({ flaw: 'unreadable-geometry' })
    ])
  })
})
