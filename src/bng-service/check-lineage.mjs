/**
 * Check the lineage in a BNG Service file: how each post-intervention feature
 * names its baseline parent, by Parent Ref, parent_uuid and parent_geom.
 *
 * Each problem is named by the lineage flaw that writes it
 * (`flaws.mjs`), so a file made with a lineage flaw reports exactly that
 * flaw, and a valid file reports none. The one exception is
 * `unreadable-geometry`, which no flaw writes (see below).
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
import { interiorPoint, pointInRing } from '../geometry.mjs'
import {
  BASELINE,
  FEATURE_UUID,
  GEOMETRY_COLUMN,
  HABITAT_REF,
  LAYERS,
  PARENT_GEOM,
  PARENT_REF,
  PARENT_UUID,
  POST_INTERVENTION,
  tableName
} from './schema.mjs'

/**
 * The one problem no lineage flaw writes: a parent_geom or parent shape that
 * cannot be read, so cannot be compared.
 */
export const UNREADABLE_GEOMETRY = 'unreadable-geometry'

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

const WKT = /^\s*(MULTI)?(POINT|LINESTRING|POLYGON)\s*\((.*)\)\s*$/is

/** The parenthesised groups at the top level of `text`, without their parentheses. */
function groups(text) {
  const found = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') {
      depth += 1
      if (depth === 1) {
        start = i + 1
      }
    } else if (text[i] === ')') {
      depth -= 1
      if (depth === 0) {
        found.push(text.slice(start, i))
      }
    }
  }
  return found
}

const points = (text) =>
  text.split(',').map((point) => point.trim().split(/\s+/).map(Number))

/** A multi-part body's parts, each as a list of rings of points. */
const MULTI_PARTS = {
  POINT: (body) =>
    body.includes('(')
      ? groups(body).map((part) => [points(part)])
      : points(body).map((point) => [[point]]),
  LINESTRING: (body) => groups(body).map((part) => [points(part)]),
  POLYGON: (body) => groups(body).map((part) => groups(part).map(points))
}

/** A single-part body as its one part, a list of rings of points. */
const SINGLE_PART = {
  POINT: (body) => [points(body)],
  LINESTRING: (body) => [points(body)],
  POLYGON: (body) => groups(body).map(points)
}

const readable = (parts) =>
  parts.length > 0 &&
  parts
    .flat(2)
    .every((point) => point.length >= 2 && point.every(Number.isFinite))

/**
 * A WKT Point, LineString or Polygon, or a multi-part one, as its parts,
 * each a list of rings of points; null if it cannot be read. A single-part
 * shape is one part, so a single-part MULTIPOLYGON reads as its Polygon.
 */
function wktParts(wkt) {
  const match = WKT.exec(wkt)
  if (!match) {
    return null
  }
  const [, multi, type, body] = match
  const kind = type.toUpperCase()
  const parts = multi ? MULTI_PARTS[kind](body) : [SINGLE_PART[kind](body)]
  return readable(parts) ? parts : null
}

/** A geometry as `wktParts` reads its WKT; null if it is no such shape. */
function geometryParts(geometry) {
  const c = geometry?.coordinates
  switch (geometry?.type) {
    case 'Point':
      return [[[c]]]
    case 'LineString':
      return [[c]]
    case 'Polygon':
      return [c]
    case 'MultiPoint':
      return c.map((point) => [[point]])
    case 'MultiLineString':
      return c.map((line) => [line])
    case 'MultiPolygon':
      return c
    default:
      return null
  }
}

const samePoint = ([x, y], [bx, by]) =>
  Math.abs(x - bx) <= TOLERANCE_M && Math.abs(y - by) <= TOLERANCE_M

const sameRing = (a, b) =>
  a.length === b.length && a.every((point, i) => samePoint(point, b[i]))

const samePart = (a, b) =>
  a.length === b.length && a.every((ring, i) => sameRing(ring, b[i]))

/**
 * Whether a parent_geom is the parent's shape, to the millimetre: the same
 * parts, each with the same rings, each with the same points.
 */
function sameShape(a, b) {
  return a.length === b.length && a.every((part, i) => samePart(part, b[i]))
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
  const named = wktParts(row[PARENT_GEOM])
  const actual = geometryParts(parent.geometry)
  if (!named || !actual) {
    return [
      UNREADABLE_GEOMETRY,
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
 *   empty when every post-intervention feature names its parent correctly.
 *   `flaw` is the name of the lineage flaw that writes the problem (one of
 *   `listFlaws({ format: 'bng-service' })`), except
 *   `UNREADABLE_GEOMETRY`, which no flaw writes: a shape the check cannot
 *   read, so cannot compare
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
