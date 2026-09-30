/**
 * GeoPackage reader — decode an existing GeoPackage into GeoJSON.
 *
 * The inverse of the writer side: where `wkb.mjs` / `init.mjs` encode geometry
 * and register layers, this reads `gpkg_contents` / `gpkg_geometry_columns`
 * back out and turns each feature's GeoPackage-Binary geometry into GeoJSON.
 * Schema-agnostic: every `features` layer is returned, whatever its columns.
 */

import wkx from 'wkx'
import { decodeGpkgBinary } from './wkb.mjs'
import { openGeoPackageReadonly } from './init.mjs'

// A closed ring needs at least three distinct points plus the closing one.
const MIN_RING_POINTS = 4

/**
 * Decode a single GeoPackage-Binary geometry blob to a GeoJSON geometry.
 *
 * @param {Buffer} blob  raw bytes from a feature table's geometry column
 * @returns {object} GeoJSON geometry
 */
export function wkbToGeoJSON(blob) {
  const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob)
  const { wkb } = decodeGpkgBinary(buffer)
  return wkx.Geometry.parse(wkb).toGeoJSON()
}

/**
 * Planar area of a GeoJSON Polygon / MultiPolygon, measured the way GEOS's
 * `GEOSArea` measures it: each polygon is its exterior ring less its holes,
 * and each ring is summed relative to its first vertex. The result is in the
 * square of the coordinates' own units, so it is only meaningful for projected
 * coordinate systems (e.g. m² on a metric grid such as EPSG:27700).
 * Non-areal geometries return 0.
 *
 * The backend prices each area habitat on its GEOS-measured area, unrounded
 * (BMD-1042), so a workbook built from this figure must carry the same number
 * to the last digit. The textbook shoelace (`x[i]·y[i+1] − x[i+1]·y[i]`) does
 * not: on British National Grid coordinates its products run to ~10¹¹, and
 * the cancellation between them loses about five significant figures. Taking
 * each vertex relative to the first keeps the products small, and matches
 * GEOS bit for bit.
 *
 * @param {object} geometry  GeoJSON geometry
 * @returns {number}
 */
export function polygonAreaSqm(geometry) {
  if (!geometry) {
    return 0
  }
  if (geometry.type === 'Polygon') {
    return polygonArea(geometry.coordinates)
  }
  if (geometry.type === 'MultiPolygon') {
    let total = 0
    for (const polygon of geometry.coordinates) {
      total += polygonArea(polygon)
    }
    return total
  }
  return 0
}

function polygonArea(rings) {
  const [shell, ...holes] = rings ?? []
  let area = ringArea(shell)
  for (const hole of holes) {
    area -= ringArea(hole)
  }
  return area
}

// GEOS's Area::ofRing: the shoelace in its "x times the change in y" form,
// with x taken relative to the first vertex.
function ringArea(ring) {
  if (!ring || ring.length < MIN_RING_POINTS) {
    return 0
  }
  const x0 = ring[0][0]
  let sum = 0
  for (let i = 1; i < ring.length - 1; i++) {
    const x = ring[i][0] - x0
    sum += x * (ring[i - 1][1] - ring[i + 1][1])
  }
  return Math.abs(sum / 2)
}

/**
 * Planar length of a GeoJSON LineString / MultiLineString, measured the way
 * GEOS's `GEOSLength` measures it — each segment as `√(dx² + dy²)` rather than
 * `Math.hypot`, whose extra care over range can differ in the last bit, and
 * each line summed before the lines are added — so a workbook carries the
 * length the backend prices, to the last digit (BMD-1042). Other geometries
 * return 0.
 *
 * @param {object} geometry  GeoJSON geometry
 * @returns {number}
 */
export function lineLengthMetres(geometry) {
  if (geometry?.type === 'LineString') {
    return lineLength(geometry.coordinates)
  }
  if (geometry?.type === 'MultiLineString') {
    let total = 0
    for (const line of geometry.coordinates) {
      total += lineLength(line)
    }
    return total
  }
  return 0
}

function lineLength(coords) {
  let length = 0
  for (let i = 1; i < (coords?.length ?? 0); i++) {
    const dx = coords[i][0] - coords[i - 1][0]
    const dy = coords[i][1] - coords[i - 1][1]
    length += Math.sqrt(dx * dx + dy * dy)
  }
  return length
}

/**
 * List the feature layers declared in a GeoPackage by joining `gpkg_contents`
 * (data_type = 'features') with `gpkg_geometry_columns`. Contents rows without
 * a matching geometry-column row are skipped.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<{name:string, identifier:string, description:string,
 *   geometryType:string, srsId:number, geometryColumn:string}>}
 */
export function readLayers(db) {
  const contents = db
    .prepare(
      `SELECT table_name, identifier, description
         FROM gpkg_contents
        WHERE data_type = 'features'`
    )
    .all()
  const geomByTable = new Map(
    db
      .prepare(
        `SELECT table_name, column_name, geometry_type_name, srs_id
           FROM gpkg_geometry_columns`
      )
      .all()
      .map((row) => [row.table_name, row])
  )

  const layers = []
  for (const row of contents) {
    const geom = geomByTable.get(row.table_name)
    if (!geom) {
      continue
    }
    layers.push({
      name: row.table_name,
      identifier: row.identifier || row.table_name,
      description: row.description,
      geometryType: geom.geometry_type_name,
      srsId: geom.srs_id,
      geometryColumn: geom.column_name
    })
  }
  return layers
}

/**
 * Read one feature layer as a GeoJSON FeatureCollection. Rows whose geometry is
 * null, or fails to decode, are skipped; each surviving feature keeps its
 * non-geometry columns as `properties` plus a zero-based `index` into the
 * non-null-geometry rows.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} tableName
 * @param {string} geometryColumn
 * @returns {{ featureCollection: object, featureCount: number,
 *   totalAreaSqm: number }}
 */
export function readFeatures(db, tableName, geometryColumn) {
  const { count: featureCount } = db
    .prepare(`SELECT COUNT(*) AS count FROM "${tableName}"`)
    .get()

  const columns = db
    .prepare(`PRAGMA table_info("${tableName}")`)
    .all()
    .map((col) => col.name)
  const selectList = columns.map((col) => `"${col}"`).join(', ')
  const rows = db
    .prepare(
      `SELECT ${selectList} FROM "${tableName}" WHERE "${geometryColumn}" IS NOT NULL`
    )
    .all()

  const features = []
  let totalAreaSqm = 0
  rows.forEach((row, index) => {
    const geometry = tryDecodeGeometry(row[geometryColumn])
    if (!geometry) {
      return
    }
    totalAreaSqm += polygonAreaSqm(geometry)
    const properties = {}
    for (const column of columns) {
      if (column !== geometryColumn) {
        properties[column] = row[column]
      }
    }
    properties.index = index
    features.push({ type: 'Feature', properties, geometry })
  })

  return {
    featureCollection: { type: 'FeatureCollection', features },
    featureCount,
    totalAreaSqm
  }
}

function tryDecodeGeometry(value) {
  if (!value) {
    return null
  }
  try {
    return wkbToGeoJSON(value)
  } catch {
    return null
  }
}

/**
 * Read an entire GeoPackage file into layer metadata and per-layer GeoJSON.
 * Mirrors the shape a host app needs to render or validate an uploaded file:
 *
 *   {
 *     layers: [{ name, identifier, description, geometryType, srsId,
 *                featureCount, totalAreaSqm }],
 *     geometries: { [layerName]: <GeoJSON FeatureCollection> }
 *   }
 *
 * Opens the file read-only and always closes it before returning.
 *
 * @param {string} filename  path to a `.gpkg` file
 * @returns {{ layers: object[], geometries: Record<string, object> }}
 */
export function readGeoPackage(filename) {
  const db = openGeoPackageReadonly(filename)
  try {
    const layers = []
    const geometries = {}
    for (const layer of readLayers(db)) {
      const { featureCollection, featureCount, totalAreaSqm } = readFeatures(
        db,
        layer.name,
        layer.geometryColumn
      )
      layers.push({
        name: layer.name,
        identifier: layer.identifier,
        description: layer.description,
        geometryType: layer.geometryType,
        srsId: layer.srsId,
        featureCount,
        totalAreaSqm
      })
      geometries[layer.name] = featureCollection
    }
    return { layers, geometries }
  } finally {
    db.close()
  }
}
