/**
 * Check the lineage in a BNG Service file: how each post-intervention feature
 * names its baseline parent, by Parent Ref, parent_uuid and parent_geom.
 *
 * Each problem is named by the lineage flaw that writes it
 * (`flaws.mjs`), so a file made with a lineage flaw reports exactly that
 * flaw, and a valid file reports none:
 *
 * - `lineage-parent-missing`: a Retained or Enhanced feature names no parent.
 *   (A Created feature with no parent is new, and fine.)
 * - `lineage-parent-unknown`: its parent_uuid names no baseline feature.
 * - `lineage-parent-wrong`: its Parent Ref is not the parent's Habitat Ref,
 *   or a point inside an area habitat falls outside the parent it names (or
 *   in one of its holes). One interior point is checked, not every edge: a
 *   split part's edges lie on its parent's boundary, where rounding would
 *   decide.
 * - `lineage-parent-geom-missing`: it names its parent but has no parent_geom.
 * - `lineage-parent-geom-mismatch`: its parent_geom is not the parent's shape,
 *   to the millimetre the service compares to.
 *
 * Only an area habitat is checked against its parent's shape: a hedgerow or
 * watercourse can move off its baseline line (a re-meandered channel does).
 *
 * The template's layers hold Polygons, LineStrings and Points, but a file
 * edited elsewhere can hold their multi-part forms, which are read part by
 * part. A shape that cannot be read at all is reported as
 * `unreadable-geometry`, not as a mismatch.
 */

import Database from 'better-sqlite3'
import { wkbToGeoJSON } from '../gpkg-io/index.mjs'
import { pointInRing } from '../geometry.mjs'
import { interiorPoint } from './pair.mjs'
import {
  BASELINE,
  GEOMETRY_COLUMN,
  LAYERS,
  POST_INTERVENTION,
  tableName
} from './schema.mjs'
import {
  FEATURE_UUID,
  HABITAT_REF,
  PARENT_GEOM,
  PARENT_REF,
  PARENT_UUID
} from './site.mjs'

const KEPT = new Set(['Retained', 'Enhanced'])
const RETENTION = 'Retention Category'
// The service compares parent_geom to the millimetre (WKT to 3 places).
const TOLERANCE_M = 0.001

const blank = (value) =>
  value === null || value === undefined || String(value).trim() === ''

function tableExists(db, table) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table)
  )
}

function rows(db, layerKey, stage) {
  const table = tableName(layerKey, stage)
  if (!tableExists(db, table)) {
    return []
  }
  return db
    .prepare(`SELECT * FROM "${table}" ORDER BY fid`)
    .all()
    .map((row) => ({
      ...row,
      geometry: row[GEOMETRY_COLUMN] ? wkbToGeoJSON(row[GEOMETRY_COLUMN]) : null
    }))
}

const WKT = /^\s*(?:MULTI)?(?:POINT|LINESTRING|POLYGON)\s*\((.*)\)\s*$/is

/** The points of a WKT Point, LineString or Polygon, or a multi-part one, in order; null if unread. */
function wktPoints(wkt) {
  const match = WKT.exec(wkt)
  if (!match) {
    return null
  }
  const points = match[1]
    .replaceAll(/[()]/g, ' ')
    .split(',')
    .map((point) => point.trim().split(/\s+/).map(Number))
  return points.every((p) => p.length >= 2 && p.every(Number.isFinite))
    ? points
    : null
}

/** A geometry's points, in the order its WKT lists them; null if unread. */
function geometryPoints(geometry) {
  switch (geometry?.type) {
    case 'Point':
      return [geometry.coordinates]
    case 'LineString':
    case 'MultiPoint':
      return geometry.coordinates
    case 'Polygon':
    case 'MultiLineString':
      return geometry.coordinates.flat(1)
    case 'MultiPolygon':
      return geometry.coordinates.flat(2)
    default:
      return null
  }
}

/** Whether a parent_geom is the parent's shape, to the millimetre. */
function sameShape(a, b) {
  return (
    a.length === b.length &&
    a.every(
      ([x, y], i) =>
        Math.abs(x - b[i][0]) <= TOLERANCE_M &&
        Math.abs(y - b[i][1]) <= TOLERANCE_M
    )
  )
}

/** A Polygon or MultiPolygon as its polygons, each a list of rings; else null. */
function polygonsOf(geometry) {
  if (geometry?.type === 'Polygon') {
    return [geometry.coordinates]
  }
  return geometry?.type === 'MultiPolygon' ? geometry.coordinates : null
}

const insidePolygon = (point, [outer, ...holes]) =>
  pointInRing(point, outer) && !holes.some((hole) => pointInRing(point, hole))

/**
 * Whether a point inside an area habitat falls within the parcel it names:
 * inside one of the parent's polygons and not in one of its holes.
 */
function liesWithin(child, parent) {
  const [childPolygon] = polygonsOf(child) ?? []
  const parentPolygons = polygonsOf(parent)
  if (!childPolygon || !parentPolygons) {
    return true
  }
  const point = interiorPoint(childPolygon[0])
  return parentPolygons.some((polygon) => insidePolygon(point, polygon))
}

/** The parent_geom problem of a linked row, if it has one. */
function parentGeomProblem(row, parent) {
  if (blank(row[PARENT_GEOM])) {
    return ['lineage-parent-geom-missing', 'has no parent_geom']
  }
  const named = wktPoints(row[PARENT_GEOM])
  const actual = geometryPoints(parent.geometry)
  if (!named || !actual) {
    return [
      'unreadable-geometry',
      `cannot read ${named ? `${parent[HABITAT_REF]}'s shape` : 'its parent_geom'} to compare them`
    ]
  }
  return sameShape(named, actual)
    ? null
    : [
        'lineage-parent-geom-mismatch',
        `parent_geom is not the shape of ${parent[HABITAT_REF]}`
      ]
}

/** The lineage flaws one post-intervention row shows. */
function rowProblems(layerKey, row, parents) {
  const linked = !blank(row[PARENT_UUID])
  if (!linked) {
    return KEPT.has(row[RETENTION])
      ? [['lineage-parent-missing', 'names no parent']]
      : []
  }
  const parent = parents.get(row[PARENT_UUID])
  if (!parent) {
    return [
      [
        'lineage-parent-unknown',
        `parent_uuid ${row[PARENT_UUID]} names no baseline feature`
      ]
    ]
  }
  const problems = []
  if (row[PARENT_REF] !== parent[HABITAT_REF]) {
    problems.push([
      'lineage-parent-wrong',
      `Parent Ref ${row[PARENT_REF]} is not its parent's Habitat Ref ${parent[HABITAT_REF]}`
    ])
  } else if (
    layerKey === 'habitats' &&
    !liesWithin(row.geometry, parent.geometry)
  ) {
    problems.push([
      'lineage-parent-wrong',
      `a point inside it falls outside the parent it names, ${parent[HABITAT_REF]}`
    ])
  }
  const geomProblem = parentGeomProblem(row, parent)
  if (geomProblem) {
    problems.push(geomProblem)
  }
  return problems
}

/**
 * Every lineage problem in a BNG Service file.
 *
 * @param {string | import('better-sqlite3').Database} source  a GeoPackage
 *   path, or an open handle (left open)
 * @returns {{ table: string, ref: string | null, flaw: string, detail: string }[]}
 *   empty when every post-intervention feature names its parent correctly
 */
export function checkLineage(source) {
  const db =
    typeof source === 'string'
      ? new Database(source, { readonly: true })
      : source
  try {
    const problems = []
    for (const layerKey of Object.keys(LAYERS)) {
      const parents = new Map(
        rows(db, layerKey, BASELINE).map((b) => [b[FEATURE_UUID], b])
      )
      const table = tableName(layerKey, POST_INTERVENTION)
      for (const row of rows(db, layerKey, POST_INTERVENTION)) {
        for (const [flaw, detail] of rowProblems(layerKey, row, parents)) {
          problems.push({ table, ref: row[HABITAT_REF] ?? null, flaw, detail })
        }
      }
    }
    return problems
  } finally {
    if (typeof source === 'string') {
      db.close()
    }
  }
}
