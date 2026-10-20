/**
 * Metric workbook rows from a GeoPackage in the BNG Service template format,
 * which holds both stages, each kept feature naming its baseline parent.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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
