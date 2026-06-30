import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openGeoPackageReadonly } from '../src/gpkg-io/index.mjs'
import { generateOne } from '../index.mjs'

// Small but non-trivial: 5 parcels exercises partition + line + point pipelines
// without making the test slow.
const NUM_PARCELS = 5
const CENTRE = [530000, 180000]

const EXPECTED_FEATURE_TABLES = [
  'Red Line Boundary',
  'Habitats',
  'Hedgerows',
  'Rivers',
  'Urban Trees'
]

describe('synthetic generateOne', () => {
  let outDir
  let outPath

  beforeAll(() => {
    outDir = mkdtempSync(path.join(tmpdir(), 'bng-synthetic-'))
    outPath = path.join(outDir, 'synthetic.gpkg')
    generateOne(outPath, CENTRE, { numParcels: NUM_PARCELS })
  })

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true })
  })

  it('produces a single .gpkg file with no WAL / SHM sidecars', () => {
    expect(existsSync(outPath)).toBe(true)
    // The default DELETE journal mode means the .gpkg is always a single file
    // — consumers that copy only the .gpkg get the complete contents.
    expect(existsSync(`${outPath}-wal`)).toBe(false)
    expect(existsSync(`${outPath}-shm`)).toBe(false)
  })

  it('registers all five BNG feature tables in gpkg_contents', () => {
    const db = openGeoPackageReadonly(outPath)
    try {
      const rows = db
        .prepare(
          "SELECT table_name FROM gpkg_contents WHERE data_type = 'features' ORDER BY table_name"
        )
        .all()
        .map((r) => r.table_name)
      for (const table of EXPECTED_FEATURE_TABLES) {
        expect(rows).toContain(table)
      }
    } finally {
      db.close()
    }
  })

  it('writes one Red Line Boundary row and one Habitats row per requested parcel', () => {
    const db = openGeoPackageReadonly(outPath)
    try {
      const rlb = db
        .prepare(`SELECT COUNT(*) AS n FROM "Red Line Boundary"`)
        .get()
      const habitats = db.prepare(`SELECT COUNT(*) AS n FROM "Habitats"`).get()
      expect(rlb.n).toBe(1)
      expect(habitats.n).toBe(NUM_PARCELS)
    } finally {
      db.close()
    }
  })

  it('writes at least one feature into each line / point layer', () => {
    // Hedgerows / Rivers use rejection sampling, so the exact count is not
    // pinned — we only guarantee the layer isn't empty for a non-degenerate
    // boundary.
    const db = openGeoPackageReadonly(outPath)
    try {
      for (const table of ['Hedgerows', 'Rivers', 'Urban Trees']) {
        const { n } = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get()
        expect(n, `${table} should have at least one feature`).toBeGreaterThan(
          0
        )
      }
    } finally {
      db.close()
    }
  })

  it('emits at least one Urban Tree of every size band', () => {
    // The first trees are seeded one-per-band, so the default fixture covers
    // the full set of engine size bands (incl. "Very large") for downstream
    // per-tree-area testing. DEFAULT_TREE_COUNT guarantees enough trees.
    const EXPECTED_TREE_SIZES = ['Small', 'Medium', 'Large', 'Very large']
    const db = openGeoPackageReadonly(outPath)
    try {
      const sizes = db
        .prepare(
          `SELECT DISTINCT "Baseline Tree Size" AS size FROM "Urban Trees"`
        )
        .all()
        .map((r) => r.size)
      for (const size of EXPECTED_TREE_SIZES) {
        expect(sizes, `expected a tree of size "${size}"`).toContain(size)
      }
    } finally {
      db.close()
    }
  })
})

describe('synthetic generateOne — rural and urban trees', () => {
  let outDir
  let outPath
  // Two trees is enough for the urban/rural alternation to surface both types.
  const NUM_TREES = 2

  beforeAll(() => {
    outDir = mkdtempSync(path.join(tmpdir(), 'bng-synthetic-trees-'))
    outPath = path.join(outDir, 'trees.gpkg')
    generateOne(outPath, CENTRE, {
      numParcels: NUM_PARCELS,
      numTrees: NUM_TREES
    })
  })

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true })
  })

  it('emits both rural and urban trees on the proposed (post-intervention) side', () => {
    const db = openGeoPackageReadonly(outPath)
    try {
      const types = db
        .prepare(
          `SELECT DISTINCT "Proposed Rural or Urban Tree" AS t FROM "Urban Trees"`
        )
        .all()
        .map((r) => r.t)
      expect(types).toContain('Urban')
      expect(types).toContain('Rural')
    } finally {
      db.close()
    }
  })
})

describe('synthetic generateOne — geometric flaws', () => {
  let outDir
  let outPath

  beforeAll(() => {
    outDir = mkdtempSync(path.join(tmpdir(), 'bng-synthetic-bad-'))
    outPath = path.join(outDir, 'bad.gpkg')
    generateOne(outPath, CENTRE, {
      numParcels: NUM_PARCELS,
      geometricFlawNames: ['bowtie-parcel']
    })
  })

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true })
  })

  it('routes through the bad-fixture builder and emits a file', () => {
    expect(existsSync(outPath)).toBe(true)
    const db = openGeoPackageReadonly(outPath)
    try {
      const tables = db
        .prepare(
          "SELECT table_name FROM gpkg_contents WHERE data_type = 'features'"
        )
        .all()
        .map((r) => r.table_name)
      expect(tables).toContain('Red Line Boundary')
      expect(tables).toContain('Habitats')
    } finally {
      db.close()
    }
  })
})

describe('synthetic generateOne — empty-layer flaw', () => {
  let outDir
  let outPath

  beforeAll(() => {
    outDir = mkdtempSync(path.join(tmpdir(), 'bng-synthetic-empty-'))
    outPath = path.join(outDir, 'empty.gpkg')
    generateOne(outPath, CENTRE, {
      numParcels: NUM_PARCELS,
      emptyLayers: new Set(['habitats'])
    })
  })

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true })
  })

  it('registers the Habitats layer with zero rows', () => {
    const db = openGeoPackageReadonly(outPath)
    try {
      const tables = db
        .prepare(
          "SELECT table_name FROM gpkg_contents WHERE data_type = 'features'"
        )
        .all()
        .map((r) => r.table_name)
      expect(tables).toContain('Habitats')
      const { n } = db.prepare(`SELECT COUNT(*) AS n FROM "Habitats"`).get()
      expect(n).toBe(0)
    } finally {
      db.close()
    }
  })

  it('still populates the other feature layers', () => {
    const db = openGeoPackageReadonly(outPath)
    try {
      const { n } = db
        .prepare(`SELECT COUNT(*) AS n FROM "Red Line Boundary"`)
        .get()
      expect(n).toBe(1)
    } finally {
      db.close()
    }
  })
})

describe('synthetic generateOne — attribute overrides', () => {
  let outDir
  let outPath

  beforeAll(() => {
    outDir = mkdtempSync(path.join(tmpdir(), 'bng-synthetic-attr-'))
    outPath = path.join(outDir, 'attr.gpkg')
    generateOne(outPath, CENTRE, {
      numParcels: NUM_PARCELS,
      attributeOverrides: {
        habitats: [
          {
            habitatFullName: 'Grassland - Lowland meadows',
            retention: 'Retained'
          }
        ]
      }
    })
  })

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true })
  })

  it("pins the overridden row's baseline habitat and retention", () => {
    const db = openGeoPackageReadonly(outPath)
    try {
      const row = db
        .prepare(
          `SELECT "Baseline Habitat Type", "Retention Category", "Proposed Habitat Type"
           FROM "Habitats" ORDER BY "Parcel Ref" LIMIT 1`
        )
        .get()
      expect(row['Baseline Habitat Type']).toBe('Lowland meadows')
      expect(row['Retention Category']).toBe('Retained')
      // Retained → proposed mirrors baseline, so the row stays coherent
      expect(row['Proposed Habitat Type']).toBe('Lowland meadows')
    } finally {
      db.close()
    }
  })

  it('leaves un-overridden rows in place (count matches numParcels)', () => {
    const db = openGeoPackageReadonly(outPath)
    try {
      const { n } = db.prepare(`SELECT COUNT(*) AS n FROM "Habitats"`).get()
      expect(n).toBe(NUM_PARCELS)
    } finally {
      db.close()
    }
  })
})

describe('synthetic generateOne — duplicate Parcel Ref override', () => {
  let outDir
  let outPath

  beforeAll(() => {
    outDir = mkdtempSync(path.join(tmpdir(), 'bng-synthetic-dup-ref-'))
    outPath = path.join(outDir, 'dup-ref.gpkg')
    generateOne(outPath, CENTRE, {
      numParcels: NUM_PARCELS,
      attributeOverrides: {
        habitats: [{ parcelRef: 'DUP-1' }, { parcelRef: 'DUP-1' }]
      }
    })
  })

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true })
  })

  it('emits two habitat rows sharing the same Parcel Ref', () => {
    const db = openGeoPackageReadonly(outPath)
    try {
      const rows = db
        .prepare(`SELECT "Parcel Ref" AS ref FROM "Habitats"`)
        .all()
      const duplicated = rows.filter((r) => r.ref === 'DUP-1')
      expect(duplicated).toHaveLength(2)
    } finally {
      db.close()
    }
  })

  it('leaves un-overridden rows with their generated H-prefixed refs', () => {
    const db = openGeoPackageReadonly(outPath)
    try {
      const rows = db
        .prepare(
          `SELECT "Parcel Ref" AS ref FROM "Habitats" WHERE "Parcel Ref" != 'DUP-1' ORDER BY "Parcel Ref"`
        )
        .all()
      const REMAINING = NUM_PARCELS - 2
      expect(rows).toHaveLength(REMAINING)
      for (const row of rows) {
        expect(row.ref).toMatch(/^H\d+$/)
      }
    } finally {
      db.close()
    }
  })
})

describe('synthetic generateOne — explicit numTrees', () => {
  let outDir

  beforeAll(() => {
    outDir = mkdtempSync(path.join(tmpdir(), 'bng-synthetic-trees-'))
  })

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true })
  })

  function treeCount(plan, filename) {
    const outPath = path.join(outDir, filename)
    generateOne(outPath, CENTRE, { numParcels: NUM_PARCELS, ...plan })
    const db = openGeoPackageReadonly(outPath)
    try {
      return db.prepare(`SELECT COUNT(*) AS n FROM "Urban Trees"`).get().n
    } finally {
      db.close()
    }
  }

  it('honours an explicit numTrees above the default', () => {
    const REQUESTED = 12
    expect(treeCount({ numTrees: REQUESTED }, 'trees-explicit.gpkg')).toBe(
      REQUESTED
    )
  })

  it('honours an explicit numTrees below the default count', () => {
    // Smaller-than-default counts are no longer bumped up; the fixture just
    // covers fewer size bands.
    const REQUESTED = 2
    expect(treeCount({ numTrees: REQUESTED }, 'trees-small.gpkg')).toBe(
      REQUESTED
    )
  })

  it('produces an empty Urban Trees layer for numTrees: 0', () => {
    expect(treeCount({ numTrees: 0 }, 'trees-zero.gpkg')).toBe(0)
  })
})
