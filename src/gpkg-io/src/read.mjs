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
 * Planar area of a GeoJSON Polygon / MultiPolygon via the shoelace formula,
 * summed over exterior rings. The result is in the square of the coordinates'
 * own units, so it is only meaningful for projected coordinate systems (e.g.
 * m² on a metric grid such as EPSG:27700). Non-areal geometries return 0.
 *
 * @param {object} geometry  GeoJSON geometry
 * @returns {number}
 */
export function polygonAreaSqm(geometry) {
  if (!geometry) {
    return 0
  }
  if (geometry.type === 'Polygon') {
    return ringArea(geometry.coordinates[0])
  }
  if (geometry.type === 'MultiPolygon') {
    let total = 0
    for (const polygon of geometry.coordinates) {
      total += ringArea(polygon[0])
    }
    return total
  }
  return 0
}

function ringArea(ring) {
  if (!ring) {
    return 0
  }
  let area = 0
  const n = ring.length
  for (let i = 0; i < n - 1; i++) {
    area += ring[i][0] * ring[i + 1][1]
    area -= ring[i + 1][0] * ring[i][1]
  }
  return Math.abs(area / 2)
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
