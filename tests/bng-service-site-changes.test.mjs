/**
 * A default BNG Service site records the changes a surveyor makes that are
 * neither kept as they were nor habitats that get worse: a re-meandered
 * watercourse, a watercourse that is only shorter, Habitat Refs that
 * repeat after a split, and a delay of 30+ years on each layer.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  checkTemplateValues,
  generateBngServiceSynthetic,
  generateSyntheticGpkg,
  setMode
} from '../index.mjs'
import { wkbToGeoJSON } from '../src/gpkg-io/index.mjs'
import { areaSquareMetres } from '../src/measure/index.mjs'
import {
  REALIGNED_WATERCOURSE_COMMENT,
  SHORTER_WATERCOURSE_COMMENT,
  addSiteChanges
} from '../src/bng-service/site-changes.mjs'
import { createChooser } from '../src/bng-service/random.mjs'
import { workbookRowsFromBngService } from '../src/workbook-writer/index.mjs'

const SQ_M_PER_HECTARE = 10_000
const POST_INTERVENTION_TABLES = [
  'Area Habitats Post-Intervention',
  'Hedgerows Post-Intervention',
  'Watercourses Post-Intervention',
  'Individual Trees Post-Intervention',
  'Vertical Area Habitats Post-Intervention'
]

/** A row's [advance, delay] values, whichever layer's columns it has. */
function timing(row) {
  const advance = Object.keys(row).find((k) => k.includes('in advance'))
  const delay = Object.keys(row).find((k) => k.startsWith('Delay'))
  return [row[advance], row[delay]]
}

const delayedRows = (file, table) =>
  rows(file, table).filter((r) => timing(r)[1] === '30+')

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

  it.each(POST_INTERVENTION_TABLES)(
    'delays one Created or Enhanced row by 30+ years, its advance blank: %s',
    (table) => {
      const delayed = delayedRows(file, table)
      expect(delayed).toHaveLength(1)
      const [row] = delayed
      expect(['Created', 'Enhanced']).toContain(row['Retention Category'])
      expect(timing(row)[0]).toBeNull()
      expect(row.Comment).not.toBeNull()
    }
  )

  it('reads into workbook rows with the 30+ delay', () => {
    const { rows: sheets } = workbookRowsFromBngService(file)
    const delays = Object.values(sheets)
      .flat()
      .filter((r) => r.delayYears === '30+')
    expect(delays.length).toBeGreaterThanOrEqual(1)
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
  it('leaves them out with templateFeatures: false: no changed watercourse, no repeated Habitat Ref', () => {
    const file = path.join(dir, 'no-template-features.gpkg')
    generateBngServiceSynthetic(
      file,
      [530000, 180000],
      { numParcels: 30, seed: 4 },
      { templateFeatures: false }
    )
    expect(
      rows(file, 'Watercourses Post-Intervention').filter((r) =>
        [REALIGNED_WATERCOURSE_COMMENT, SHORTER_WATERCOURSE_COMMENT].includes(
          r.Comment
        )
      )
    ).toEqual([])
    const refs = rows(file, 'Area Habitats Post-Intervention').map(
      (r) => r['Habitat Ref']
    )
    expect(new Set(refs).size).toBe(refs.length)
    for (const table of POST_INTERVENTION_TABLES) {
      expect(delayedRows(file, table), table).toEqual([])
    }
  })

  it('leaves them out of a geometric flaw’s fixture', () => {
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

describe('a delay of 30+ years', () => {
  it('leaves the row advance-delay-both-set pins as it is', () => {
    const file = site('both-set', {
      numParcels: 1,
      seed: 1,
      flaws: ['advance-delay-both-set']
    })
    const [row] = rows(file, 'Area Habitats Post-Intervention')
    expect(timing(row)).toEqual(['2', '3'])
  })

  it.each([4, 9])(
    'keeps the comment of a re-meandered watercourse it delays, seed %i',
    (seed) => {
      const file = site(`delayed-river-${seed}`, { numParcels: 30, seed })
      const [row] = delayedRows(file, 'Watercourses Post-Intervention')
      expect(row.Comment).toBe(REALIGNED_WATERCOURSE_COMMENT)
    }
  )
})

describe('a change that cannot be drawn leaves nothing behind', () => {
  // A red line 400 m long and 2 m wide: a watercourse fits along it, but
  // no bend that makes the route longer fits beside it.
  const LENGTH_M = 400
  const WIDTH_M = 2
  const thin = () => ({
    redline: {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [LENGTH_M, 0],
            [LENGTH_M, WIDTH_M],
            [0, WIDTH_M],
            [0, 0]
          ]
        ]
      }
    },
    layers: {
      habitats: { baseline: [], postIntervention: [] },
      rivers: { baseline: [], postIntervention: [] }
    }
  })

  // Seeds on which both watercourses fit along the red line, so the
  // re-meander is drawn and then fails, rather than never being tried.
  it.each([2, 3, 6, 8, 10])(
    'takes back a watercourse that cannot be re-meandered, seed %i',
    (seed) => {
      const site = thin()
      const { rivers } = site.layers
      const drawn = []
      rivers.baseline.push = (...features) => {
        drawn.push(...features)
        return Array.prototype.push.apply(rivers.baseline, features)
      }
      addSiteChanges(site, createChooser(seed), new Set(['habitats']))
      // The re-meandered and the shorter watercourse were both drawn, and
      // only the shorter one, which needs no bend, is kept.
      expect(drawn).toHaveLength(2)
      expect(rivers.baseline).toHaveLength(1)
      expect(rivers.baseline[0]).toBe(drawn[1])
      for (const feature of rivers.baseline) {
        expect(
          rivers.postIntervention.some((p) => p.parent === feature),
          feature.values['Habitat Ref']
        ).toBe(true)
      }
      expect(
        rivers.postIntervention.filter(
          (p) => p.values.Comment === REALIGNED_WATERCOURSE_COMMENT
        )
      ).toEqual([])
    }
  )
})

describe('a split parcel', () => {
  it.each([1, 2, 3, 5, 6, 7, 8, 10, 11, 12, 13, 14])(
    'repeats a Habitat Ref, seed %i',
    (seed) => {
      const file = site(`split-${seed}`, { numParcels: 30, seed })
      const refs = rows(file, 'Area Habitats Post-Intervention').map(
        (r) => r['Habitat Ref']
      )
      expect(refs.length - new Set(refs).size).toBe(1)
    }
  )
})
