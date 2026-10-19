import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  BNG_SERVICE_FLAW_NAMES,
  CURRENT_TEMPLATE_VERSION,
  TEMPLATE_SCHEMA,
  TEMPLATE_SOURCE,
  checkTemplateValues,
  generateBngServiceFromWorkbook,
  generateBngServiceSynthetic,
  generateOne,
  generatePermutations,
  generateSyntheticGpkg,
  listFlaws,
  readVersionRecords,
  resolveFlawSelection,
  setMode,
  writeBngServiceFromLegacy
} from '../index.mjs'
import { wkbToGeoJSON } from '../src/gpkg-io/index.mjs'
import { areaSquareMetres } from '../src/measure/index.mjs'
import { geometryWkt } from '../src/bng-service/site.mjs'
import {
  ENCROACHED_WATERCOURSE_COMMENT,
  WORSE_HABITAT_COMMENT
} from '../src/bng-service/template-features.mjs'
import { listIndex } from '../src/bng-service/reference.mjs'
import { uuidV5 } from '../src/bng-service/random.mjs'

const CENTRE = [530000, 180000]
const SQ_M_PER_HECTARE = 10_000
const RECORD_URI = 'tag:defra.gov.uk,2026:bng-metric/gpkg-format'
const RECORD_1_0 = '{"format": "bng-service", "version": "1.0"}'
const HABITAT_TYPES = [
  'Area Habitats',
  'Vertical Area Habitats',
  'Hedgerows',
  'Watercourses',
  'Individual Trees'
]
const BASELINE = (type) => `${type} Baseline`
const PI = (type) => `${type} Post-Intervention`
const WORKBOOK_FIXTURE = new URL(
  './fixtures/workbook-hedgerow-created.json',
  import.meta.url
)

let dir
let counter = 0
const nextPath = (name = 'site') =>
  path.join(dir, `${name}-${(counter += 1)}.gpkg`)

beforeAll(() => {
  setMode('silent')
  dir = mkdtempSync(path.join(tmpdir(), 'bng-service-test-'))
})

afterAll(() => {
  setMode('cli')
  rmSync(dir, { recursive: true, force: true })
})

function synthetic(plan = {}, options = {}) {
  const out = nextPath()
  generateBngServiceSynthetic(
    out,
    CENTRE,
    { numParcels: 12, seed: 7, ...plan },
    options
  )
  return out
}

function withDb(file, fn) {
  const db = new Database(file, { readonly: true })
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

const rows = (file, table) =>
  withDb(file, (db) =>
    db.prepare(`SELECT * FROM "${table}" ORDER BY fid`).all()
  )

function userTables(db) {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'gpkg_%' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all()
    .map((r) => r.name)
}

const geometryOf = (row) => wkbToGeoJSON(row.geom)

describe('the copy of the BNG Service template', () => {
  it('describes the five habitat types at both stages and the red line', () => {
    const names = TEMPLATE_SCHEMA.tables.map((t) => t.name)
    expect(names).toHaveLength(11)
    expect(names).toContain('Red Line Boundary')
    for (const type of HABITAT_TYPES) {
      expect(names).toContain(BASELINE(type))
      expect(names).toContain(PI(type))
    }
  })

  it('records the template format and version it came from', () => {
    expect(TEMPLATE_SOURCE).toMatchObject({
      format: 'bng-service',
      version: CURRENT_TEMPLATE_VERSION,
      metadataUri: RECORD_URI
    })
    expect(TEMPLATE_SOURCE.commit).toMatch(/^[0-9a-f]{40}$/)
  })

  const templateCheckout = process.env.BNG_METRIC_TEMPLATE
  it.skipIf(!templateCheckout)(
    'matches the template GeoPackage in BNG_METRIC_TEMPLATE, column for column',
    () => {
      const gpkg = path.join(
        templateCheckout,
        'templates/bng-service/Layers/BNG Service Layers.gpkg'
      )
      withDb(gpkg, (db) => {
        for (const table of TEMPLATE_SCHEMA.tables) {
          const columns = db
            .prepare(`PRAGMA table_info("${table.name}")`)
            .all()
            .map((c) => [c.name, c.type])
          expect(columns).toEqual([
            ['fid', 'INTEGER'],
            [table.geometryColumn, table.geometryType],
            ...table.columns.map((c) => [c.name, c.type])
          ])
        }
      })
    }
  )
})

describe('AC1: a synthetic site in the new format', () => {
  let file
  beforeAll(() => {
    file = synthetic()
  })

  it('holds exactly the template tables, with their columns, types and geometry', () => {
    withDb(file, (db) => {
      const expected = TEMPLATE_SCHEMA.tables.map((t) => t.name).sort()
      expect(userTables(db)).toEqual(expected)
      const contents = db
        .prepare(
          "SELECT table_name FROM gpkg_contents WHERE data_type = 'features'"
        )
        .all()
        .map((r) => r.table_name)
        .sort()
      expect(contents).toEqual(expected)
      for (const table of TEMPLATE_SCHEMA.tables) {
        const columns = db
          .prepare(`PRAGMA table_info("${table.name}")`)
          .all()
          .map((c) => [c.name, c.type])
        expect(columns).toEqual([
          ['fid', 'INTEGER'],
          [table.geometryColumn, table.geometryType],
          ...table.columns.map((c) => [c.name, c.type])
        ])
        const geometry = db
          .prepare('SELECT * FROM gpkg_geometry_columns WHERE table_name = ?')
          .get(table.name)
        expect(geometry).toMatchObject({
          column_name: table.geometryColumn,
          geometry_type_name: table.geometryType,
          srs_id: 27700
        })
      }
    })
  })

  it('records the template version once, referenced to the whole GeoPackage', () => {
    withDb(file, (db) => {
      expect(
        db
          .prepare(
            'SELECT md_scope, md_standard_uri, mime_type, metadata FROM gpkg_metadata'
          )
          .all()
      ).toEqual([
        {
          md_scope: 'dataset',
          md_standard_uri: RECORD_URI,
          mime_type: 'application/json',
          metadata: RECORD_1_0
        }
      ])
      expect(
        db
          .prepare(
            'SELECT reference_scope, table_name, md_file_id FROM gpkg_metadata_reference'
          )
          .all()
      ).toEqual([
        { reference_scope: 'geopackage', table_name: null, md_file_id: 1 }
      ])
      const extensions = db
        .prepare(
          'SELECT table_name, extension_name FROM gpkg_extensions ORDER BY table_name'
        )
        .all()
      expect(extensions).toEqual([
        { table_name: 'gpkg_metadata', extension_name: 'gpkg_metadata' },
        {
          table_name: 'gpkg_metadata_reference',
          extension_name: 'gpkg_metadata'
        }
      ])
      expect(readVersionRecords(db)).toEqual([
        { format: 'bng-service', version: '1.0' }
      ])
    })
  })

  it('writes the version the option names', () => {
    const out = synthetic({}, { templateVersion: '1.3' })
    expect(withDb(out, readVersionRecords)).toEqual([
      { format: 'bng-service', version: '1.3' }
    ])
  })

  it('refuses a version that is not <major>.<minor>', () => {
    expect(() => synthetic({}, { templateVersion: 'latest' })).toThrow(
      /templateVersion/
    )
  })

  it('is byte-identical for the same seed, and differs for another', () => {
    const a = readFileSync(synthetic({ seed: 21 }))
    const b = readFileSync(synthetic({ seed: 21 }))
    const c = readFileSync(synthetic({ seed: 22 }))
    expect(a.equals(b)).toBe(true)
    expect(a.equals(c)).toBe(false)
  })

  it('holds a red line with the site-wide details', () => {
    const [redline] = rows(file, 'Red Line Boundary')
    expect(redline['Site Name']).toBeTruthy()
    expect(redline.Location).toMatch(/^Centred on easting \d+, northing \d+$/)
    expect(redline['Survey Date']).toBeTruthy()
  })
})

describe('AC2: a baseline-stage site', () => {
  it('holds every template table, the baseline populated and the post-intervention empty', () => {
    const out = synthetic({ seed: 3 }, { stage: 'baseline' })
    withDb(out, (db) => {
      expect(userTables(db)).toHaveLength(TEMPLATE_SCHEMA.tables.length)
    })
    for (const type of HABITAT_TYPES) {
      expect(rows(out, PI(type))).toEqual([])
    }
    for (const type of [
      'Area Habitats',
      'Hedgerows',
      'Individual Trees',
      'Vertical Area Habitats'
    ]) {
      expect(rows(out, BASELINE(type)).length).toBeGreaterThan(0)
    }
  })

  it('refuses an unknown stage', () => {
    expect(() => synthetic({}, { stage: 'proposed' })).toThrow(/stage/)
  })
})

describe('AC3: every value is one the template offers', () => {
  it.each([
    [1, 3],
    [2, 8],
    [3, 30],
    [4, 50],
    [5, 12]
  ])('seed %i, %i parcels', (seed, numParcels) => {
    expect(checkTemplateValues(synthetic({ seed, numParcels }))).toEqual([])
  })

  it('stores significance as Low or High, and labels with no list numbers', () => {
    const out = synthetic({ seed: 9, numParcels: 30 })
    for (const type of HABITAT_TYPES) {
      for (const row of rows(out, BASELINE(type))) {
        expect(row['Baseline Strategic Significance']).toBe('Low')
        expect(String(row['Baseline Condition'])).not.toMatch(/^\d+\.\s/)
      }
      for (const row of rows(out, PI(type))) {
        expect(['Low', 'High']).toContain(
          row['Proposed Strategic Significance']
        )
        expect(String(row['Proposed Condition'])).not.toMatch(/^\d+\.\s/)
      }
    }
  })

  describe('the check itself', () => {
    function edited(sql) {
      const out = synthetic({ seed: 5 })
      const db = new Database(out)
      db.exec(sql)
      db.close()
      return checkTemplateValues(out)
    }

    it('reports a list-numbered label', () => {
      const found = edited(
        `UPDATE "Area Habitats Baseline" SET "Baseline Condition" = '4. Fairly Poor' WHERE fid = 1`
      )
      expect(found).toContainEqual(
        expect.objectContaining({
          table: 'Area Habitats Baseline',
          field: 'Baseline Condition',
          examples: ['4. Fairly Poor']
        })
      )
    })

    it('reports the legacy significance wording', () => {
      const found = edited(
        `UPDATE "Area Habitats Post-Intervention" SET "Proposed Strategic Significance" = 'Location ecologically desirable but not in local strategy' WHERE fid = 1`
      )
      expect(found.map((f) => f.field)).toContain(
        'Proposed Strategic Significance'
      )
    })

    it('reports a vertical habitat on the Area Habitats layer', () => {
      const found = edited(
        `UPDATE "Area Habitats Baseline" SET "Baseline Broad Habitat Type" = 'Urban', "Baseline Habitat Type" = 'Facade-bound green wall' WHERE fid = 1`
      )
      expect(found.map((f) => f.field)).toContain('Baseline Habitat Type')
    })

    it('reports a filled-in column left blank', () => {
      const found = edited(
        `UPDATE "Hedgerows Baseline" SET "Baseline Distinctiveness" = NULL WHERE fid = 1`
      )
      expect(found.map((f) => f.field)).toContain('Baseline Distinctiveness')
    })
  })
})

describe('AC4: lineage and removal', () => {
  let legacyPath
  let out
  beforeAll(() => {
    legacyPath = nextPath('legacy')
    generateOne(legacyPath, CENTRE, { numParcels: 30, seed: 13 })
    out = nextPath()
    writeBngServiceFromLegacy({ legacyPath }, out, { seed: 13 })
  })

  const legacy = (table) => rows(legacyPath, table)

  it('names each kept feature’s baseline parent by Parent Ref, parent_uuid and parent_geom', () => {
    for (const type of HABITAT_TYPES) {
      const parents = new Map(
        rows(out, BASELINE(type)).map((b) => [b.feature_uuid, b])
      )
      for (const row of rows(out, PI(type))) {
        if (
          row['Retention Category'] === 'Created' &&
          row.parent_uuid === null
        ) {
          continue
        }
        const parent = parents.get(row.parent_uuid)
        expect(parent, `${type} ${row['Habitat Ref']}`).toBeDefined()
        expect(row['Parent Ref']).toBe(parent['Habitat Ref'])
        expect(row.parent_geom).toBe(geometryWkt(geometryOf(parent)))
        expect(row['Baseline Condition']).toBe(parent['Baseline Condition'])
      }
    }
  })

  it('derives a seeded feature_uuid as a version 5 UUID, as Python does', () => {
    // python3 -c "import uuid; print(uuid.uuid5(uuid.NAMESPACE_URL, 'bng-site/1/area/AH-001'))"
    expect(uuidV5('bng-site/1/area/AH-001')).toBe(
      '3cd367b7-c2bf-5796-8ce0-b3cb4a564450'
    )
  })

  it('gives every baseline feature its own feature_uuid', () => {
    for (const type of HABITAT_TYPES) {
      const uuids = rows(out, BASELINE(type)).map((r) => r.feature_uuid)
      expect(new Set(uuids).size).toBe(uuids.length)
      for (const uuid of uuids) {
        expect(uuid).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        )
      }
    }
  })

  it('leaves a removed hedgerow, watercourse or tree out of the post-intervention table', () => {
    for (const [legacyTable, type, refColumn] of [
      ['Hedgerows', 'Hedgerows', 'Parcel Ref'],
      ['Rivers', 'Watercourses', 'Parcel Ref'],
      ['Urban Trees', 'Individual Trees', 'Tree Ref']
    ]) {
      const lost = legacy(legacyTable)
        .filter((r) => r['Retention Category'] === 'Lost')
        .map((r) => r[refColumn])
      const kept = new Set(rows(out, PI(type)).map((r) => r['Habitat Ref']))
      const baseline = new Set(
        rows(out, BASELINE(type)).map((r) => r['Habitat Ref'])
      )
      for (const ref of lost) {
        expect(kept.has(ref), `${type} ${ref}`).toBe(false)
        expect(baseline.has(ref), `${type} ${ref}`).toBe(true)
      }
    }
    expect(
      legacy('Hedgerows').some((r) => r['Retention Category'] === 'Lost')
    ).toBe(true)
  })

  it('writes a created hedgerow, watercourse or tree with no parent and no baseline row', () => {
    const created = rows(out, PI('Individual Trees')).filter(
      (r) => r['Retention Category'] === 'Created'
    )
    expect(created.length).toBeGreaterThan(0)
    for (const row of created) {
      expect(row).toMatchObject({
        'Parent Ref': null,
        parent_uuid: null,
        parent_geom: null,
        Category: 'Newly Planted',
        'Baseline Strategic Significance': null,
        'Irreplaceable Habitat': 'No'
      })
    }
  })

  it('makes a legacy area "Lost" a creation in the parcel’s place', () => {
    const lost = legacy('Habitats').filter(
      (r) => r['Retention Category'] === 'Lost'
    )
    expect(lost.length).toBeGreaterThan(0)
    const pi = new Map(
      rows(out, PI('Area Habitats')).map((r) => [r['Habitat Ref'], r])
    )
    for (const row of lost) {
      expect(pi.get(row['Parcel Ref'])).toMatchObject({
        'Retention Category': 'Created',
        'Parent Ref': row['Parcel Ref']
      })
    }
  })

  it('measures areas in hectares and lengths in metres, from the shape', () => {
    for (const row of rows(out, BASELINE('Area Habitats'))) {
      expect(row.Area).toBe(
        areaSquareMetres(geometryOf(row)) / SQ_M_PER_HECTARE
      )
      expect(row.Area).toBeLessThan(100)
    }
    const redlineHa = rows(out, BASELINE('Area Habitats')).reduce(
      (sum, r) => sum + r.Area,
      0
    )
    const piHa = rows(out, PI('Area Habitats')).reduce(
      (sum, r) => sum + r.Area,
      0
    )
    expect(piHa).toBeCloseTo(redlineHa, 9)
    for (const row of rows(out, PI('Hedgerows'))) {
      expect(row.Length).toBeGreaterThan(1)
      expect(row['Baseline Length']).toBeGreaterThanOrEqual(row.Length - 1e-9)
    }
  })
})

describe('AC5: what only the new template records', () => {
  let out
  beforeAll(() => {
    out = synthetic({ seed: 4, numParcels: 30 })
  })

  it('includes vertical area habitats, as lines with a typed area', () => {
    const baseline = rows(out, BASELINE('Vertical Area Habitats'))
    expect(baseline.length).toBeGreaterThanOrEqual(2)
    const allowed = listIndex(
      'Vertical Area Habitats/Vertical Area Habitat Options- pre.csv',
      'ID',
      'UKHAB'
    )
    for (const row of baseline) {
      expect(geometryOf(row).type).toBe('LineString')
      expect(
        allowed
          .get(row['Baseline Broad Habitat Type'])
          .has(row['Baseline Habitat Type'])
      ).toBe(true)
      expect(row.Area).toBeGreaterThan(0)
    }
    const retention = rows(out, PI('Vertical Area Habitats')).map(
      (r) => r['Retention Category']
    )
    expect(retention).toEqual(expect.arrayContaining(['Retained', 'Enhanced']))
  })

  it('includes comments on both stages', () => {
    const commented = (table) =>
      rows(out, table).filter((r) => r.Comment).length
    expect(
      HABITAT_TYPES.reduce((n, t) => n + commented(BASELINE(t)), 0)
    ).toBeGreaterThan(0)
    expect(
      HABITAT_TYPES.reduce((n, t) => n + commented(PI(t)), 0)
    ).toBeGreaterThan(0)
  })

  it('includes an irreplaceable area habitat, kept', () => {
    const [parcel] = rows(out, BASELINE('Area Habitats')).filter(
      (r) => r['Irreplaceable Habitat'] === 'Yes'
    )
    expect(parcel).toBeDefined()
    const children = rows(out, PI('Area Habitats')).filter(
      (r) => r.parent_uuid === parcel.feature_uuid
    )
    expect(children.map((c) => c['Retention Category'])).toEqual(['Retained'])
    expect(children[0]['Irreplaceable Habitat']).toBe('Yes')
  })

  it('includes an irreplaceable tree, never Enhanced, and Enhanced trees that improve', () => {
    const baseline = rows(out, BASELINE('Individual Trees'))
    const pi = rows(out, PI('Individual Trees'))
    const veteran = baseline.filter((r) => r['Irreplaceable Habitat'] === 'Yes')
    expect(veteran.length).toBeGreaterThan(0)
    const enhanced = pi.filter((r) => r['Retention Category'] === 'Enhanced')
    expect(enhanced.length).toBeGreaterThan(0)
    const better = listIndex(
      'Individual trees/Individual tree Condition - options.csv',
      'ID',
      'New'
    )
    for (const tree of enhanced) {
      expect(tree['Irreplaceable Habitat']).toBe('No')
      expect(
        better
          .get(`${tree['Baseline Condition']}Enhanced`)
          .has(tree['Proposed Condition'])
      ).toBe(true)
      expect(tree['Proposed Tree Size']).toBe(tree['Baseline Tree Size'])
    }
    for (const tree of veteran) {
      const child = pi.find((r) => r.parent_uuid === tree.feature_uuid)
      expect(child?.['Retention Category']).not.toBe('Enhanced')
    }
  })

  it('leaves them out with templateFeatures: false', () => {
    const plain = synthetic(
      { seed: 4, numParcels: 30 },
      { templateFeatures: false }
    )
    expect(rows(plain, BASELINE('Vertical Area Habitats'))).toEqual([])
    expect(checkTemplateValues(plain)).toEqual([])
  })

  it('takes vertical habitats and template-only fields from row overrides', () => {
    const pinned = synthetic(
      {
        seed: 2,
        numParcels: 6,
        attributeOverrides: {
          habitats: [
            { comment: 'Pinned comment', postInterventionComment: 'PI note' }
          ],
          verticalHabitats: [
            {
              habitatFullName: 'Urban - Facade-bound green wall',
              retention: 'Enhanced',
              baselineCondition: 'Poor',
              proposedCondition: 'Good',
              area: 0.0125
            }
          ]
        }
      },
      { templateFeatures: false }
    )
    expect(rows(pinned, BASELINE('Area Habitats'))[0].Comment).toBe(
      'Pinned comment'
    )
    expect(rows(pinned, PI('Area Habitats'))[0].Comment).toBe('PI note')
    expect(rows(pinned, PI('Vertical Area Habitats'))).toEqual([
      expect.objectContaining({
        'Baseline Habitat Type': 'Facade-bound green wall',
        'Baseline Condition': 'Poor',
        'Retention Category': 'Enhanced',
        'Proposed Condition': 'Good',
        Area: 0.0125
      })
    ])
  })

  it('refuses an irreplaceable tree that is Enhanced', () => {
    expect(() =>
      synthetic({
        seed: 2,
        numParcels: 6,
        attributeOverrides: {
          trees: [{ retention: 'Enhanced', irreplaceable: 'Yes' }]
        }
      })
    ).toThrow(/irreplaceable tree cannot be Enhanced/)
  })
})

describe('AC5: habitats that get worse', () => {
  // The Metric User Guide, section 5: a habitat whose condition cannot be
  // kept is lost and created again, in the same type, in a lower condition,
  // 30 plus years in advance. Section 7: a watercourse whose encroachment
  // increases, with no other impact, 10 years or more in advance.
  const CONDITIONS = ['Good', 'Fairly Good', 'Moderate', 'Fairly Poor', 'Poor']
  const WATER = ['No Encroachment', 'Minor', 'Major']
  const RIPARIAN = JSON.parse(
    readFileSync(
      new URL(
        '../src/metric/reference/watercourse-riparian-encroachment-multiplier.json',
        import.meta.url
      )
    )
  )
  const riparianMultiplier = (label) =>
    RIPARIAN[
      Object.keys(RIPARIAN).find(
        (k) => k.replaceAll(/\s+/g, '') === label.replaceAll(/\s+/g, '')
      )
    ]
  const TYPE = {
    'Area Habitats': 'Habitat Type',
    'Vertical Area Habitats': 'Habitat Type',
    Hedgerows: 'Hedge Type',
    Watercourses: 'River Type'
  }

  let out
  beforeAll(() => {
    out = synthetic({ seed: 4, numParcels: 30 })
  })

  const worseRows = (file, type, comment) =>
    rows(file, PI(type)).filter((r) => r.Comment === comment)

  it('records an area, vertical area and hedgerow habitat that gets worse, in its own type, 30+ years in advance', () => {
    for (const type of [
      'Area Habitats',
      'Vertical Area Habitats',
      'Hedgerows'
    ]) {
      const worse = worseRows(out, type, WORSE_HABITAT_COMMENT)
      expect(worse, type).toHaveLength(1)
      const [row] = worse
      const parent = rows(out, BASELINE(type)).find(
        (b) => b.feature_uuid === row.parent_uuid
      )
      expect(parent, type).toBeDefined()
      expect(row['Parent Ref']).toBe(parent['Habitat Ref'])
      expect(row['Retention Category']).toBe('Created')
      expect(row[`Proposed ${TYPE[type]}`]).toBe(
        parent[`Baseline ${TYPE[type]}`]
      )
      expect(row['Baseline Condition']).toBe(parent['Baseline Condition'])
      expect(CONDITIONS.indexOf(row['Proposed Condition'])).toBeGreaterThan(
        CONDITIONS.indexOf(row['Baseline Condition'])
      )
      expect(
        CONDITIONS.indexOf(row['Baseline Condition'])
      ).toBeGreaterThanOrEqual(0)
      expect(row['Habitat created in advance/years']).toBe('30+')
      expect(row['Delay in starting habitat creation/years']).toBeNull()
      expect(parent['Irreplaceable Habitat'] ?? 'No').not.toBe('Yes')
    }
  })

  it('records a watercourse whose encroachment gets worse, in its own type and condition, 10 years in advance', () => {
    const worse = worseRows(out, 'Watercourses', ENCROACHED_WATERCOURSE_COMMENT)
    expect(worse).toHaveLength(1)
    const [row] = worse
    expect(row['Retention Category']).toBe('Created')
    expect(row['Parent Ref']).not.toBeNull()
    expect(row['Proposed River Type']).toBe(row['Baseline River Type'])
    expect(row['Proposed River Type']).not.toBe('Culvert')
    expect(row['Proposed Condition']).toBe(row['Baseline Condition'])
    expect(
      WATER.indexOf(row['Proposed Encroachment into Watercourse'])
    ).toBeGreaterThan(
      WATER.indexOf(row['Baseline Encroachment into Watercourse'])
    )
    expect(
      riparianMultiplier(row['Proposed Encroachment into riparian zone'])
    ).toBeLessThan(
      riparianMultiplier(row['Baseline Encroachment into riparian zone'])
    )
    expect(row['Habitat created in advance/years']).toBe('10')
  })

  it('writes only values the template offers, and keeps a Retained area parcel', () => {
    expect(checkTemplateValues(out)).toEqual([])
    expect(
      rows(out, PI('Area Habitats')).some(
        (r) => r['Retention Category'] === 'Retained'
      )
    ).toBe(true)
  })

  it('leaves the only Retained area parcel as it is', () => {
    const small = synthetic({ seed: 3, numParcels: 6 })
    const retained = rows(small, PI('Area Habitats')).filter(
      (r) => r['Retention Category'] === 'Retained'
    )
    expect(retained).toHaveLength(1)
    expect(worseRows(small, 'Area Habitats', WORSE_HABITAT_COMMENT)).toEqual([])
    expect(worseRows(small, 'Hedgerows', WORSE_HABITAT_COMMENT)).toHaveLength(1)
  })

  it('leaves them out with templateFeatures: false', () => {
    const plain = synthetic(
      { seed: 4, numParcels: 30 },
      { templateFeatures: false }
    )
    for (const type of ['Area Habitats', 'Hedgerows', 'Watercourses']) {
      expect(
        rows(plain, PI(type)).filter((r) =>
          ['30+', '10'].includes(r['Habitat created in advance/years'])
        ),
        type
      ).toEqual([])
    }
  })
})

describe('AC6: flaws in the new format', () => {
  const bngFlaws = listFlaws({ format: 'bng-service' })

  it('lists the lineage and version flaws, and not the one the template cannot carry', () => {
    const names = bngFlaws.map((f) => f.name)
    expect(names).toEqual(expect.arrayContaining(BNG_SERVICE_FLAW_NAMES))
    expect(names).not.toContain('tree-count-not-whole')
    expect(names).toContain('parcel-too-small')
  })

  it.each(bngFlaws.map((f) => f.name))(
    '%s gives one new-format buffer',
    (name) => {
      const { buffer, filenameHint } = generateSyntheticGpkg({
        format: 'bng-service',
        flaws: [name],
        numParcels: 6,
        seed: 3
      })
      const out = nextPath(name)
      writeFileSync(out, buffer)
      withDb(out, (db) => {
        expect(userTables(db)).toContain('Area Habitats Baseline')
        expect(userTables(db)).not.toContain('Habitats')
      })
      expect(filenameHint).toMatch(
        new RegExp(`^bng-service-test-data.*${name}`)
      )
    }
  )

  it('refuses a flaw the template cannot carry', () => {
    expect(() =>
      generateSyntheticGpkg({
        format: 'bng-service',
        flaws: ['tree-count-not-whole']
      })
    ).toThrow(/no Count column/)
  })

  function flawed(name) {
    const out = nextPath(name)
    const selection = resolveFlawSelection({
      bad: false,
      flaws: [],
      numParcels: 6
    })
    generateBngServiceSynthetic(out, CENTRE, {
      numParcels: 6,
      seed: 3,
      ...selection,
      lineageFlawNames: name.startsWith('lineage') ? [name] : [],
      versionFlawNames: name.startsWith('version') ? [name] : []
    })
    return out
  }

  const firstContinuing = (out) =>
    rows(out, PI('Area Habitats')).find((r) =>
      ['Retained', 'Enhanced'].includes(r['Retention Category'])
    )

  it('lineage-parent-missing: no Parent Ref, parent_uuid or parent_geom', () => {
    expect(firstContinuing(flawed('lineage-parent-missing'))).toMatchObject({
      'Parent Ref': null,
      parent_uuid: null,
      parent_geom: null
    })
  })

  it('lineage-parent-unknown: a parent the baseline does not hold', () => {
    const out = flawed('lineage-parent-unknown')
    const row = firstContinuing(out)
    const baseline = rows(out, BASELINE('Area Habitats'))
    expect(baseline.map((b) => b.feature_uuid)).not.toContain(row.parent_uuid)
    expect(baseline.map((b) => b['Habitat Ref'])).not.toContain(
      row['Parent Ref']
    )
  })

  it('lineage-parent-wrong: another real parcel, which the feature lies outside', () => {
    const out = flawed('lineage-parent-wrong')
    const row = firstContinuing(out)
    const named = rows(out, BASELINE('Area Habitats')).find(
      (b) => b.feature_uuid === row.parent_uuid
    )
    expect(named).toBeDefined()
    expect(row['Parent Ref']).toBe(named['Habitat Ref'])
    expect(geometryWkt(geometryOf(named))).not.toBe(
      geometryWkt(geometryOf(row))
    )
  })

  it('lineage-parent-geom-mismatch: the right parent, with a shape that does not match it', () => {
    const out = flawed('lineage-parent-geom-mismatch')
    const row = firstContinuing(out)
    const parent = rows(out, BASELINE('Area Habitats')).find(
      (b) => b.feature_uuid === row.parent_uuid
    )
    expect(row['Parent Ref']).toBe(parent['Habitat Ref'])
    expect(row.parent_geom).not.toBe(geometryWkt(geometryOf(parent)))
  })

  it('lineage-parent-geom-missing: the right parent, with no parent_geom', () => {
    const out = flawed('lineage-parent-geom-missing')
    const row = firstContinuing(out)
    const parent = rows(out, BASELINE('Area Habitats')).find(
      (b) => b.feature_uuid === row.parent_uuid
    )
    expect(row['Parent Ref']).toBe(parent['Habitat Ref'])
    expect(row.parent_geom).toBeNull()
  })

  it.each([
    ['version-record-missing', []],
    [
      'version-record-duplicated',
      [
        { format: 'bng-service', version: '1.0' },
        { format: 'bng-service', version: '1.0' }
      ]
    ],
    ['version-unsupported', [{ format: 'bng-service', version: '2.0' }]]
  ])('%s', (name, records) => {
    expect(withDb(flawed(name), readVersionRecords)).toEqual(records)
  })

  it('maps the legacy IGGI polygon to a vertical area habitat outside the red line', () => {
    const { buffer } = generateSyntheticGpkg({
      format: 'bng-service',
      flaws: ['iggi-outside'],
      seed: 1
    })
    const out = nextPath('iggi')
    writeFileSync(out, buffer)
    const [iggi] = rows(out, BASELINE('Vertical Area Habitats'))
    expect(iggi['Baseline Habitat Type']).toMatch(/IGGI/)
    expect(geometryOf(iggi).type).toBe('LineString')
  })
})

describe('AC6: scenarios and workbooks in the new format', () => {
  it('gives each scenario one new-format buffer, valid unless the scenario is invalid-', () => {
    const { scenarios, manifest } = generatePermutations({
      seed: 5,
      only: 'intervention',
      format: 'bng-service'
    })
    expect(scenarios.length).toBeGreaterThan(0)
    for (const scenario of scenarios) {
      expect(scenario.baseline).toBeUndefined()
      expect(scenario.postIntervention).toBeUndefined()
      expect(scenario.geoPackage.path).toBe(`intervention/${scenario.id}.gpkg`)
      const out = nextPath(scenario.id)
      writeFileSync(out, scenario.geoPackage.buffer)
      expect(withDb(out, readVersionRecords)).toHaveLength(1)
      expect(checkTemplateValues(out)).toEqual([])
    }
    expect(manifest.scenarios[0].files).toEqual({
      geoPackage: `intervention/${scenarios[0].id}.gpkg`
    })
  })

  it('lists a scenario’s one file in the manifest-only preview', () => {
    const { manifest } = generatePermutations({
      manifestOnly: true,
      format: 'bng-service'
    })
    for (const entry of manifest.scenarios) {
      expect(Object.keys(entry.files)).toEqual(['geoPackage'])
    }
  })

  it('reproduces a scenario’s file from the same seed', () => {
    const a = generatePermutations({
      seed: 8,
      only: 'conditions',
      format: 'bng-service'
    })
    const b = generatePermutations({
      seed: 8,
      only: 'conditions',
      format: 'bng-service'
    })
    expect(
      a.scenarios[0].geoPackage.buffer.equals(b.scenarios[0].geoPackage.buffer)
    ).toBe(true)
  })

  describe('from a metric workbook', () => {
    const workbook = () => JSON.parse(readFileSync(WORKBOOK_FIXTURE, 'utf8'))

    it('writes one file, every value one the template offers', () => {
      const out = nextPath('workbook')
      const result = generateBngServiceFromWorkbook(
        out,
        workbook(),
        'hedgerow-created.xlsx',
        {
          centre: CENTRE
        }
      )
      expect(result.success).toBe(true)
      expect(checkTemplateValues(out)).toEqual([])
      expect(withDb(out, readVersionRecords)).toHaveLength(1)
      expect(
        rows(out, PI('Hedgerows')).some(
          (r) => r['Retention Category'] === 'Created'
        )
      ).toBe(true)
    })

    it('moves the green walls onto the vertical layers, with the ground under them', () => {
      const out = nextPath('workbook')
      generateBngServiceFromWorkbook(out, workbook(), 'hedgerow-created.xlsx', {
        centre: CENTRE
      })
      const walls = rows(out, BASELINE('Vertical Area Habitats'))
      expect(walls.map((w) => w['Baseline Habitat Type']).sort()).toEqual([
        'Facade-bound green wall',
        'Ground based green wall'
      ])
      const area = rows(out, BASELINE('Area Habitats'))
      for (const wall of walls) {
        const ground = area.find(
          (a) => a['Habitat Ref'] === wall['Habitat Ref']
        )
        expect(ground['Baseline Habitat Type']).toBe(
          'Developed land; sealed surface'
        )
        expect(wall.Area).toBeCloseTo(ground.Area, 9)
      }
    })

    it('writes the baseline-stage file', () => {
      const out = nextPath('workbook')
      generateBngServiceFromWorkbook(out, workbook(), 'hedgerow-created.xlsx', {
        centre: CENTRE,
        stage: 'baseline'
      })
      expect(rows(out, BASELINE('Area Habitats')).length).toBeGreaterThan(0)
      for (const type of HABITAT_TYPES) {
        expect(rows(out, PI(type))).toEqual([])
      }
    })
  })
})

describe('AC7: the legacy format stays the default', () => {
  it('writes the legacy tables with no format option', () => {
    const { buffer, filenameHint } = generateSyntheticGpkg({
      numParcels: 4,
      seed: 2
    })
    const out = nextPath('legacy')
    writeFileSync(out, buffer)
    withDb(out, (db) => {
      expect(userTables(db)).toEqual(
        expect.arrayContaining([
          'Habitats',
          'Hedgerows',
          'Rivers',
          'Urban Trees',
          'Red Line Boundary'
        ])
      )
      expect(userTables(db)).not.toContain('Area Habitats Baseline')
      expect(readVersionRecords(db)).toEqual([])
    })
    expect(filenameHint).toMatch(/^bng-test-data-/)
  })

  it('gives the same legacy file with a seed, whatever the BNG Service code does', () => {
    const a = generateSyntheticGpkg({ numParcels: 6, seed: 4 }).buffer
    generateSyntheticGpkg({ numParcels: 6, seed: 4, format: 'bng-service' })
    const b = generateSyntheticGpkg({ numParcels: 6, seed: 4 }).buffer
    expect(a.equals(b)).toBe(true)
  })

  it('lists the legacy flaws by default', () => {
    const names = listFlaws().map((f) => f.name)
    expect(names).toContain('tree-count-not-whole')
    for (const name of BNG_SERVICE_FLAW_NAMES) {
      expect(names).not.toContain(name)
    }
  })

  it('returns scenario pairs by default', () => {
    const { scenarios } = generatePermutations({ seed: 5, only: 'conditions' })
    expect(scenarios[0].baseline.buffer.length).toBeGreaterThan(0)
    expect(scenarios[0].postIntervention.buffer.length).toBeGreaterThan(0)
    expect(scenarios[0].geoPackage).toBeUndefined()
  })

  it('refuses an unknown format', () => {
    expect(() => generateSyntheticGpkg({ format: 'qgis' })).toThrow(
      /format must be one of/
    )
  })
})
