import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  decodeGpkgBinary,
  encodeGpkgBinary,
  encodeWkbPolygon,
  envelopeFromCoords,
  gpkgLineString,
  gpkgPolygon,
  lineLengthMetres,
  openGeoPackage,
  polygonAreaSqm,
  readGeoPackage,
  registerLayer,
  wkbToGeoJSON
} from '../src/gpkg-io/index.mjs'

// SRS 4326 is one of the OGC-mandatory SRSes initGeoPackage always registers,
// so it satisfies the gpkg_contents.srs_id foreign key without extra setup.
// Areas here are planar over the raw coordinates (the shoelace formula), so the
// declared SRS does not affect the numbers the reader returns.
const SRS = 4326

// Baseline parcel H001 and hedgerow HG001 of the harness's
// example-files/permutations/intervention/area-enhanced-baseline.gpkg, on
// British National Grid, with the area and length GEOS (geos-wasm, as the
// backend uses) measures for them. The backend prices these figures unrounded
// (BMD-1042), so the reader must reproduce them to the last digit; the
// textbook shoelace gives H001 as 144529.08115386963.
const H001 = [
  [530066.9373186704, 179556.3807426773],
  [530136.902344139, 179534.75631210193],
  [530408.2527507545, 179680.27897243464],
  [530444.5050301832, 179786.91852747035],
  [530109.2448720403, 180220.78137088363],
  [530066.9373186704, 179556.3807426773]
]
const H001_GEOS_AREA = 144529.0811549303
const HG001 = [
  [530025.3587009454, 180211.10748672587],
  [530055.2245340901, 180027.52660581493],
  [530045.4303503721, 179841.79028252096]
]
const HG001_GEOS_LENGTH = 371.98875157975516

// A 10 × 20 axis-aligned rectangle: shoelace area = 200.
const RECT = [
  [0, 0],
  [10, 0],
  [10, 20],
  [0, 20],
  [0, 0]
]
const RECT_AREA = 200

// A 5 × 5 square: shoelace area = 25.
const SQUARE = [
  [0, 0],
  [5, 0],
  [5, 5],
  [0, 5],
  [0, 0]
]
const SQUARE_AREA = 25

function addPolygonTable(db, table, attr, rows) {
  db.exec(
    `CREATE TABLE "${table}" (fid INTEGER PRIMARY KEY, geometry BLOB, "${attr}" TEXT)`
  )
  const insert = db.prepare(
    `INSERT INTO "${table}" (geometry, "${attr}") VALUES (?, ?)`
  )
  for (const [geometry, value] of rows) {
    insert.run(geometry, value)
  }
  // Envelope value doesn't affect the area assertions; any valid box will do.
  registerLayer(db, table, 'POLYGON', envelopeFromCoords(RECT), SRS, 'geometry')
}

describe('gpkg-io reader', () => {
  let dir
  let file

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'gpkg-reader-'))
    file = path.join(dir, 'fixture.gpkg')

    const db = openGeoPackage(file)

    // habitats: two valid polygons plus one NULL-geometry row. The null row
    // counts toward featureCount but is excluded from the FeatureCollection.
    addPolygonTable(db, 'habitats', 'Habitat Type', [
      [gpkgPolygon(SRS, RECT), 'Grassland'],
      [gpkgPolygon(SRS, SQUARE), 'Woodland'],
      [null, 'No geometry']
    ])

    // mixed: one valid polygon then a non-null but undecodable blob, which the
    // reader must skip while still advancing the row index.
    addPolygonTable(db, 'mixed', 'Habitat Type', [
      [gpkgPolygon(SRS, RECT), 'Good'],
      [Buffer.from([1, 2, 3]), 'Garbage']
    ])

    // rivers: a single linestring (non-areal → area 0).
    db.exec(
      `CREATE TABLE rivers (fid INTEGER PRIMARY KEY, geometry BLOB, name TEXT)`
    )
    db.prepare(`INSERT INTO rivers (geometry, name) VALUES (?, ?)`).run(
      gpkgLineString(SRS, [
        [0, 0],
        [3, 4]
      ]),
      'Brook'
    )
    registerLayer(db, 'rivers', 'LINESTRING', null, SRS, 'geometry')

    // orphan: a gpkg_contents features row with no gpkg_geometry_columns entry.
    // readLayers must skip it rather than crash.
    db.exec(`CREATE TABLE orphan (fid INTEGER PRIMARY KEY, geometry BLOB)`)
    db.prepare(
      `INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id)
       VALUES ('orphan', 'features', 'orphan', ?)`
    ).run(SRS)

    db.close()
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  describe('decodeGpkgBinary', () => {
    it('is the inverse of encodeGpkgBinary', () => {
      const envelope = envelopeFromCoords(RECT)
      const wkb = encodeWkbPolygon([RECT])
      const decoded = decodeGpkgBinary(encodeGpkgBinary(SRS, wkb, envelope))

      expect(decoded.srsId).toBe(SRS)
      expect(decoded.envelope).toEqual(envelope)
      expect(Buffer.compare(decoded.wkb, wkb)).toBe(0)
    })

    it('treats a blob without the GP magic as bare WKB', () => {
      const wkb = encodeWkbPolygon([RECT])
      const decoded = decodeGpkgBinary(wkb)

      expect(decoded.srsId).toBeNull()
      expect(decoded.envelope).toBeNull()
      expect(Buffer.compare(decoded.wkb, wkb)).toBe(0)
    })
  })

  describe('wkbToGeoJSON', () => {
    it('decodes a GeoPackage polygon blob to GeoJSON', () => {
      const geojson = wkbToGeoJSON(gpkgPolygon(SRS, RECT))
      expect(geojson).toEqual({ type: 'Polygon', coordinates: [RECT] })
    })
  })

  describe('polygonAreaSqm', () => {
    it('computes the shoelace area of a polygon', () => {
      expect(polygonAreaSqm({ type: 'Polygon', coordinates: [RECT] })).toBe(
        RECT_AREA
      )
    })

    it('sums exterior rings of a multipolygon', () => {
      expect(
        polygonAreaSqm({
          type: 'MultiPolygon',
          coordinates: [[RECT], [SQUARE]]
        })
      ).toBe(RECT_AREA + SQUARE_AREA)
    })

    it('matches GEOS to the last digit on British National Grid coordinates', () => {
      expect(polygonAreaSqm({ type: 'Polygon', coordinates: [H001] })).toBe(
        H001_GEOS_AREA
      )
    })

    it('subtracts holes from the exterior ring', () => {
      expect(
        polygonAreaSqm({ type: 'Polygon', coordinates: [RECT, SQUARE] })
      ).toBe(RECT_AREA - SQUARE_AREA)
    })

    it('returns 0 for non-areal geometry', () => {
      expect(
        polygonAreaSqm({
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 1]
          ]
        })
      ).toBe(0)
    })
  })

  describe('lineLengthMetres', () => {
    it('sums the segments of a line string', () => {
      expect(
        lineLengthMetres({
          type: 'LineString',
          coordinates: [
            [0, 0],
            [3, 4],
            [3, 10]
          ]
        })
      ).toBe(11)
    })

    it('sums the lines of a multi line string', () => {
      expect(
        lineLengthMetres({
          type: 'MultiLineString',
          coordinates: [
            [
              [0, 0],
              [3, 4]
            ],
            [
              [0, 0],
              [0, 2]
            ]
          ]
        })
      ).toBe(7)
    })

    it('matches GEOS to the last digit on British National Grid coordinates', () => {
      expect(lineLengthMetres({ type: 'LineString', coordinates: HG001 })).toBe(
        HG001_GEOS_LENGTH
      )
    })

    it('returns 0 for non-linear geometry', () => {
      expect(lineLengthMetres({ type: 'Polygon', coordinates: [RECT] })).toBe(0)
    })
  })

  describe('readGeoPackage', () => {
    it('returns layer metadata and per-layer FeatureCollections', () => {
      const { layers, geometries } = readGeoPackage(file)

      // orphan (no geometry_columns row) is skipped; the three real layers remain.
      expect(layers.map((l) => l.name).sort()).toEqual([
        'habitats',
        'mixed',
        'rivers'
      ])

      const habitats = layers.find((l) => l.name === 'habitats')
      expect(habitats).toMatchObject({
        identifier: 'habitats',
        geometryType: 'POLYGON',
        srsId: SRS,
        featureCount: 3, // COUNT(*) includes the null-geometry row
        totalAreaSqm: RECT_AREA + SQUARE_AREA
      })

      const rivers = layers.find((l) => l.name === 'rivers')
      expect(rivers.geometryType).toBe('LINESTRING')
      expect(rivers.totalAreaSqm).toBe(0)

      // geometries are keyed by layer name and carry attributes + index.
      const feature = geometries.habitats.features[0]
      expect(feature.geometry).toEqual({ type: 'Polygon', coordinates: [RECT] })
      expect(feature.properties['Habitat Type']).toBe('Grassland')
      expect(feature.properties.index).toBe(0)
    })

    it('excludes null geometries from the FeatureCollection', () => {
      const { geometries } = readGeoPackage(file)
      // Two valid polygons out of three rows (one had a null geometry).
      expect(geometries.habitats.features).toHaveLength(2)
    })

    it('skips undecodable geometries but keeps the row index', () => {
      const { geometries } = readGeoPackage(file)
      const features = geometries.mixed.features
      // The garbage blob (row index 1) is dropped; only the good row survives.
      expect(features).toHaveLength(1)
      expect(features[0].properties.index).toBe(0)
      expect(features[0].properties['Habitat Type']).toBe('Good')
    })
  })
})
