import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPostInterventionRows } from '../index.mjs'
import { createAllTables, openGeoPackage } from '../src/bng-schema.mjs'
import { openGeoPackageReadonly } from '../src/gpkg-io/index.mjs'
import { writeRiversPostIntervention } from '../src/workbook/workbook-layers.mjs'

// The BMD-1015 reader/row-builder tests stop short of the GeoPackage writer,
// where the proposed-encroachment bug actually lived. This suite drives
// buildPostInterventionRows → writeRiversPostIntervention → SELECT so the
// "Proposed Encroachment" columns are asserted on the written row, covering
// all three retentions: created (C-2), enhanced (C-3) and retained (which
// falls back to the C-1 baseline encroachment).

// Geometry is irrelevant to the encroachment columns; any in-boundary
// linestring per row keeps the writer's length/envelope maths happy.
const COORDS = [
  [0, 0],
  [10, 0]
]

// In-memory workbook shape mirroring readMetricWorkbook(): only the
// watercourse layer is populated; the rest stay empty.
function wb(watercourses) {
  return {
    habitats: { baseline: [], created: [], enhancements: [] },
    hedgerows: { baseline: [], created: [], enhancements: [] },
    watercourses: {
      baseline: [],
      created: [],
      enhancements: [],
      ...watercourses
    },
    trees: { baseline: [], created: [] }
  }
}

describe('writeRiversPostIntervention — proposed encroachment columns', () => {
  let outDir
  let rivers

  beforeAll(() => {
    outDir = mkdtempSync(path.join(tmpdir(), 'rivers-post-'))
    const gpkgPath = path.join(outDir, 'out.gpkg')

    // R001 Retained: fate columns mark the whole length retained, so proposed
    // encroachment must fall back to the C-1 baseline values.
    const retainedBaseline = {
      ref: 1,
      type: 'Ditches',
      distinctiveness: 'Medium',
      condition: 'Moderate',
      strategicSignificance: 'Low',
      lengthM: 100,
      lengthRetainedM: 100,
      lengthEnhancedM: 0,
      lengthLostM: 0,
      waterEncroachment: 'Minor',
      riparianEncroachment: 'Moderate/ Minor'
    }

    // R002 Enhanced: C-3 carries the proposed encroachment change.
    const enhancedBaseline = {
      ref: 2,
      type: 'Canals',
      distinctiveness: 'Medium',
      condition: 'Poor',
      strategicSignificance: 'Low',
      lengthM: 100,
      lengthRetainedM: 0,
      lengthEnhancedM: 100,
      lengthLostM: 0,
      waterEncroachment: 'Minor',
      riparianEncroachment: 'Minor/ Minor'
    }
    const enhancement = {
      baselineRef: 2,
      proposedType: 'Canals',
      proposedCondition: 'Fairly Poor',
      proposedWaterEncroachment: 'Minor',
      proposedRiparianEncroachment: 'Major/Major'
    }

    // R003 Created: C-2 carries the proposed encroachment onto a fresh ref
    // (baseline.length + 1).
    const created = {
      ref: 1,
      type: 'Ditches',
      distinctiveness: 'Medium',
      condition: 'Poor',
      strategicSignificance: 'Low',
      lengthM: 100,
      waterEncroachment: 'Major',
      riparianEncroachment: 'Major/No Encroachment'
    }

    const built = buildPostInterventionRows(
      wb({
        baseline: [retainedBaseline, enhancedBaseline],
        created: [created],
        enhancements: [enhancement]
      })
    )
    rivers = built.rivers

    const db = openGeoPackage(gpkgPath)
    try {
      createAllTables(db)
      writeRiversPostIntervention(
        db,
        rivers.map(() => COORDS),
        rivers
      )
    } finally {
      db.close()
    }

    const read = openGeoPackageReadonly(gpkgPath)
    try {
      rivers = rivers.map((r) => ({
        ref: r.ref,
        retention: r.retention,
        row: read
          .prepare('SELECT * FROM "Rivers" WHERE "Parcel Ref" = ?')
          .get(r.ref)
      }))
    } finally {
      read.close()
    }
  })

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true })
  })

  const find = (retention) => rivers.find((r) => r.retention === retention).row

  it('writes C-3 proposed encroachment on an enhanced row', () => {
    const row = find('Enhanced')
    expect(row['Retention Category']).toBe('Enhanced')
    expect(row['Proposed Encroachment into Watercourse']).toBe('Minor')
    expect(row['Proposed Encroachment into riparian zone']).toBe('Major/Major')
  })

  it('writes C-2 proposed encroachment on a created row', () => {
    const row = find('Created')
    expect(row['Proposed Encroachment into Watercourse']).toBe('Major')
    expect(row['Proposed Encroachment into riparian zone']).toBe(
      'Major/No Encroachment'
    )
  })

  it('falls back to the C-1 baseline encroachment on a retained row', () => {
    const row = find('Retained')
    expect(row['Retention Category']).toBe('Retained')
    expect(row['Baseline Encroachment into Watercourse']).toBe('Minor')
    expect(row['Baseline Encroachment into riparian zone']).toBe(
      'Moderate/ Minor'
    )
    expect(row['Proposed Encroachment into Watercourse']).toBe('Minor')
    expect(row['Proposed Encroachment into riparian zone']).toBe(
      'Moderate/ Minor'
    )
  })
})
