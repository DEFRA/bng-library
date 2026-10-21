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
 *   or an area habitat lies outside the parent it names.
 * - `lineage-parent-geom-missing`: it names its parent but has no parent_geom.
 * - `lineage-parent-geom-mismatch`: its parent_geom is not the parent's shape,
 *   to the millimetre the service compares to.
 *
 * Only an area habitat is checked against its parent's shape: a hedgerow or
 * watercourse can move off its baseline line (a re-meandered channel does).
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

/** The points of a WKT POINT, LINESTRING or POLYGON, ring by ring; null if unread. */
function wktRings(wkt) {
  const match = /^\s*(POINT|LINESTRING|POLYGON)\s*\((.*)\)\s*$/is.exec(wkt)
  if (!match) {
    return null
  }
  const groups = match[2].includes('(')
    ? [...match[2].matchAll(/\(([^()]*)\)/g)].map((m) => m[1])
    : [match[2]]
  const rings = groups.map((group) =>
    group.split(',').map((point) => point.trim().split(/\s+/).map(Number))
  )
  return rings.flat(2).every(Number.isFinite) ? rings : null
}

/** A geometry's points, ring by ring, as `wktRings` gives them. */
function geometryRings(geometry) {
  switch (geometry.type) {
    case 'Point':
      return [[geometry.coordinates]]
    case 'LineString':
      return [geometry.coordinates]
    case 'Polygon':
      return geometry.coordinates
    default:
      return null
  }
}

/** Whether a parent_geom is the parent's shape, to the millimetre. */
function sameShape(wkt, geometry) {
  const a = wktRings(wkt)
  const b = geometry && geometryRings(geometry)
  if (!a || !b || a.length !== b.length) {
    return false
  }
  return a.every(
    (ring, i) =>
      ring.length === b[i].length &&
      ring.every(
        ([x, y], j) =>
          Math.abs(x - b[i][j][0]) <= TOLERANCE_M &&
          Math.abs(y - b[i][j][1]) <= TOLERANCE_M
      )
  )
}

/** Whether an area habitat lies within the parcel it names. */
function liesWithin(child, parent) {
  if (child?.type !== 'Polygon' || parent?.type !== 'Polygon') {
    return true
  }
  return pointInRing(interiorPoint(child.coordinates[0]), parent.coordinates[0])
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
      `lies outside the parent it names, ${parent[HABITAT_REF]}`
    ])
  }
  if (blank(row[PARENT_GEOM])) {
    problems.push(['lineage-parent-geom-missing', 'has no parent_geom'])
  } else if (!sameShape(row[PARENT_GEOM], parent.geometry)) {
    problems.push([
      'lineage-parent-geom-mismatch',
      `parent_geom is not the shape of ${parent[HABITAT_REF]}`
    ])
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
