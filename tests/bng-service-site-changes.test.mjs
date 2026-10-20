/**
 * A default BNG Service site records the changes a surveyor makes that are
 * neither kept as they were nor habitats that get worse: a re-meandered
 * watercourse, a watercourse that is only shorter, and Habitat Refs that
 * repeat after a split.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  checkTemplateValues,
  generateSyntheticGpkg,
  setMode
} from '../index.mjs'
import { wkbToGeoJSON } from '../src/gpkg-io/index.mjs'
import { areaSquareMetres } from '../src/measure/index.mjs'
import {
  REALIGNED_WATERCOURSE_COMMENT,
  SHORTER_WATERCOURSE_COMMENT
} from '../src/bng-service/site-changes.mjs'
import { workbookRowsFromBngService } from '../src/workbook-writer/index.mjs'

const SQ_M_PER_HECTARE = 10_000

let dir
beforeAll(() => {
  setMode('silent')
  dir = mkdtempSync(path.join(tmpdir(), 'bng-changes-'))
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

function rows(file, table) {
  const db = new Database(file, { readonly: true })
  try {
    return db.prepare(`SELECT * FROM "${table}"`).all()
  } finally {
    db.close()
  }
}

describe.each([4, 9, 15])('a default site, seed %i', (seed) => {
  let file
  beforeAll(() => {
    file = site(`default-${seed}`, { numParcels: 30, seed })
  })

  it('holds only values the template offers', () => {
    expect(checkTemplateValues(file)).toEqual([])
  })

  it('re-meanders a watercourse: Enhanced by Realignment, longer, still linked', () => {
    const baseline = rows(file, 'Watercourses Baseline')
    const [row] = rows(file, 'Watercourses Post-Intervention').filter(
      (r) => r.Comment === REALIGNED_WATERCOURSE_COMMENT
    )
    expect(row['Retention Category']).toBe('Enhanced')
    expect(row['Enhancement Type']).toBe('Enhanced by Realignment')
    expect(row['Proposed River Type']).toBe(row['Baseline River Type'])
    expect(row.Length).toBeGreaterThan(row['Baseline Length'])
    const parent = baseline.find((b) => b.feature_uuid === row.parent_uuid)
    expect(row['Parent Ref']).toBe(parent['Habitat Ref'])
    expect(row['Baseline Length']).toBeCloseTo(parent.Length, 9)
  })

  it('shortens a watercourse, kept Retained', () => {
    const [row] = rows(file, 'Watercourses Post-Intervention').filter(
      (r) => r.Comment === SHORTER_WATERCOURSE_COMMENT
    )
    expect(row['Retention Category']).toBe('Retained')
    expect(row.Length).toBeLessThan(row['Baseline Length'])
    expect(row['Proposed Condition']).toBe(row['Baseline Condition'])
  })

  it('splits a Retained parcel into two parts that share its Habitat Ref', () => {
    const parcels = rows(file, 'Area Habitats Post-Intervention')
    const byRef = Map.groupBy(parcels, (r) => r['Habitat Ref'])
    const repeated = [...byRef.values()].filter((group) => group.length > 1)
    expect(repeated).toHaveLength(1)
    const [parts] = repeated
    expect(parts.every((p) => p['Retention Category'] === 'Retained')).toBe(
      true
    )
    expect(new Set(parts.map((p) => p.parent_uuid)).size).toBe(1)
    const parent = rows(file, 'Area Habitats Baseline').find(
      (b) => b.feature_uuid === parts[0].parent_uuid
    )
    const measured = parts.map(
      (p) => areaSquareMetres(wkbToGeoJSON(p.geom)) / SQ_M_PER_HECTARE
    )
    parts.forEach((p, i) => expect(p.Area).toBeCloseTo(measured[i], 9))
    expect(measured[0] + measured[1]).toBeCloseTo(parent.Area, 6)
  })

  it('reads into workbook rows: the split parcel retained whole', () => {
    const { rows: sheets } = workbookRowsFromBngService(file)
    const parcels = rows(file, 'Area Habitats Post-Intervention')
    const [ref] = [
      ...Map.groupBy(parcels, (r) => r['Habitat Ref']).entries()
    ].find(([, group]) => group.length > 1)
    const baseline = sheets.habitatBaseline.find((r) => r.reference === ref)
    expect(baseline.retained).toBeCloseTo(baseline.size, 6)
  })
})

describe('the changes are template features', () => {
  it('leaves them out with templateFeatures: false', () => {
    const { buffer } = generateSyntheticGpkg({
      format: 'bng-service',
      numParcels: 30,
      seed: 4,
      flaws: ['bowtie-parcel']
    })
    const file = path.join(dir, 'bad.gpkg')
    writeFileSync(file, buffer)
    expect(
      rows(file, 'Watercourses Post-Intervention').filter((r) =>
        [REALIGNED_WATERCOURSE_COMMENT, SHORTER_WATERCOURSE_COMMENT].includes(
          r.Comment
        )
      )
    ).toEqual([])
  })

  it('leaves an emptied layer empty', () => {
    const file = site('no-rivers', {
      numParcels: 30,
      seed: 4,
      flaws: ['no-rivers']
    })
    expect(rows(file, 'Watercourses Baseline')).toEqual([])
    expect(rows(file, 'Watercourses Post-Intervention')).toEqual([])
  })
})
