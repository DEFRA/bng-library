/**
 * Metric workbook rows from a GeoPackage in the BNG Service template format,
 * which holds both stages, each kept feature naming its baseline parent.
 */
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const opened = vi.hoisted(() => ({ count: 0 }))
vi.mock('../src/gpkg-io/index.mjs', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    openGeoPackageReadonly: (...args) => {
      opened.count += 1
      return original.openGeoPackageReadonly(...args)
    }
  }
})

import { generateSyntheticGpkg, setMode } from '../index.mjs'
import {
  workbookRowsFromBngService,
  workbookRowsFromGeoPackage
} from '../src/workbook-writer/index.mjs'
import { WORSE_HABITAT_COMMENT } from '../src/bng-service/template-features.mjs'
import Database from 'better-sqlite3'

let dir
let file
beforeAll(() => {
  setMode('silent')
  dir = mkdtempSync(path.join(tmpdir(), 'bng-rows-'))
  file = path.join(dir, 'site.gpkg')
  const { buffer } = generateSyntheticGpkg({
    format: 'bng-service',
    numParcels: 30,
    seed: 4
  })
  writeFileSync(file, buffer)
})
afterAll(() => {
  setMode('cli')
  rmSync(dir, { recursive: true, force: true })
})

function rows(table, where = '1') {
  const db = new Database(file, { readonly: true })
  try {
    return db.prepare(`SELECT * FROM "${table}" WHERE ${where}`).all()
  } finally {
    db.close()
  }
}

describe('workbook rows from a BNG Service file', () => {
  it('reads it whichever reader is called', () => {
    expect(workbookRowsFromGeoPackage(file)).toEqual(
      workbookRowsFromBngService(file)
    )
  })

  it('has a baseline row per baseline feature', () => {
    const { rows: sheets } = workbookRowsFromBngService(file)
    const areas =
      rows('Area Habitats Baseline').length +
      rows('Vertical Area Habitats Baseline').length +
      rows('Individual Trees Baseline').length
    expect(sheets.habitatBaseline).toHaveLength(areas)
    expect(sheets.hedgerowBaseline).toHaveLength(
      rows('Hedgerows Baseline').length
    )
  })

  it('writes strategic significance in the workbook’s words', () => {
    const { rows: sheets } = workbookRowsFromBngService(file)
    const words = new Set(
      sheets.habitatBaseline.map((r) => r.strategicSignificance)
    )
    expect(words).toEqual(
      new Set(['Area/compensation not in local strategy/ no local strategy'])
    )
  })

  it('places a hedge that gets worse in part: its Retained part kept, its worse part created', () => {
    const parts = rows(
      'Hedgerows Post-Intervention',
      `"Habitat Ref" LIKE '%b' AND Comment = '${WORSE_HABITAT_COMMENT}'`
    )
    expect(parts).toHaveLength(1)
    const [worse] = parts
    const parentRef = worse['Parent Ref']
    const { rows: sheets } = workbookRowsFromBngService(file)
    const baseline = sheets.hedgerowBaseline.find(
      (r) => r.reference === parentRef
    )
    const kept = rows(
      'Hedgerows Post-Intervention',
      `"Habitat Ref" = '${parentRef}a'`
    )[0]
    expect(baseline.retained).toBeCloseTo(kept.Length / 1000, 9)
    expect(baseline.retained).toBeLessThan(baseline.size)
    const creation = sheets.hedgerowCreation.find(
      (r) => r.reference === worse['Habitat Ref']
    )
    expect(creation.advanceYears).toBe('30+')
    expect(creation.size).toBeCloseTo(worse.Length / 1000, 9)
  })

  it('places a vertical area habitat by its typed area', () => {
    const [vertical] = rows('Vertical Area Habitats Baseline')
    const { rows: sheets } = workbookRowsFromBngService(file)
    const row = sheets.habitatBaseline.find(
      (r) => r.reference === vertical['Habitat Ref']
    )
    expect(row.size).toBe(vertical.Area)
  })
})

/** A copy of the site with `sql` run on it, as a user's file could be. */
function edited(name, sql) {
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

const HEDGES = 'Hedgerows Post-Intervention'

describe('the edge cases a user’s file can hold', () => {
  it('opens the file once, whichever reader is called', () => {
    opened.count = 0
    workbookRowsFromGeoPackage(file)
    expect(opened.count).toBe(1)
  })

  it('places a hedge by its remaining length when part of it is removed', () => {
    const [worse] = rows(
      HEDGES,
      `"Habitat Ref" LIKE '%b' AND Comment = '${WORSE_HABITAT_COMMENT}'`
    )
    const parentRef = worse['Parent Ref']
    const kept = rows(HEDGES, `"Habitat Ref" = '${parentRef}a'`)[0]
    const shorter = edited(
      'shorter-hedge',
      `DELETE FROM "${HEDGES}" WHERE "Habitat Ref" = '${worse['Habitat Ref']}'`
    )
    const { rows: sheets } = workbookRowsFromBngService(shorter)
    const baseline = sheets.hedgerowBaseline.find(
      (r) => r.reference === parentRef
    )
    expect(baseline.retained).toBeCloseTo(kept.Length / 1000, 9)
    expect(baseline.retained).toBeLessThan(baseline.size)
  })

  it('reads a numbered retention, and notes one it does not recognise', () => {
    const [enhanced] = rows(HEDGES, `"Retention Category" = 'Enhanced'`)
    const [worse] = rows(
      HEDGES,
      `"Retention Category" = 'Created' AND parent_uuid IS NOT NULL AND "Habitat Ref" NOT LIKE '%b'`
    )
    const changed = edited(
      'retention-values',
      `UPDATE "${HEDGES}" SET "Retention Category" = '2. Enhanced'
         WHERE "Habitat Ref" = '${enhanced['Habitat Ref']}';
       UPDATE "${HEDGES}" SET "Retention Category" = 'Kept'
         WHERE "Habitat Ref" = '${worse['Habitat Ref']}';`
    )
    const { rows: sheets, notes } = workbookRowsFromBngService(changed)
    const row = (ref) =>
      sheets.hedgerowBaseline.find((r) => r.reference === ref)
    expect(row(enhanced['Parent Ref']).enhanced).toBeCloseTo(
      row(enhanced['Parent Ref']).size,
      9
    )
    expect(row(worse['Parent Ref']).retained).toBeUndefined()
    expect(
      sheets.hedgerowCreation.filter(
        (r) => r.reference === worse['Habitat Ref']
      )
    ).toEqual([])
    expect(notes).toEqual([
      expect.stringMatching(
        new RegExp(
          `${worse['Habitat Ref']}: unrecognised retention category "Kept"`
        )
      )
    ])
  })

  it('places a Created feature whose parent is missing as a creation, with a note', () => {
    const [worse] = rows(
      HEDGES,
      `"Retention Category" = 'Created' AND parent_uuid IS NOT NULL AND "Habitat Ref" NOT LIKE '%b'`
    )
    const orphaned = edited(
      'orphan-created',
      `UPDATE "${HEDGES}" SET parent_uuid = 'no-such-feature'
         WHERE "Habitat Ref" = '${worse['Habitat Ref']}'`
    )
    const { rows: sheets, notes } = workbookRowsFromBngService(orphaned)
    expect(
      sheets.hedgerowCreation.filter(
        (r) => r.reference === worse['Habitat Ref']
      )
    ).toHaveLength(1)
    expect(notes).toEqual([
      expect.stringMatching(/names no baseline feature; placed as a creation/)
    ])
  })

  it('notes a kept feature whose parent is unknown, as lineage-parent-unknown writes it', () => {
    const flawed = path.join(dir, 'parent-unknown.gpkg')
    writeFileSync(
      flawed,
      generateSyntheticGpkg({
        format: 'bng-service',
        numParcels: 8,
        seed: 3,
        flaws: ['lineage-parent-unknown']
      }).buffer
    )
    const { notes } = workbookRowsFromBngService(flawed)
    expect(notes).toEqual([
      expect.stringMatching(
        /Area Habitats Post-Intervention .*: its parent_uuid names no baseline feature; Retained row left out/
      )
    ])
  })
})
