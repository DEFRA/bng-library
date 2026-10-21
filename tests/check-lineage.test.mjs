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
