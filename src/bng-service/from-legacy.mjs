/**
 * Read what the legacy generators write into the two-stage site model that
 * `site.mjs` writes in the BNG Service template's format.
 *
 * Two inputs:
 *
 * - One legacy file whose every row carries both stages (`siteFromLegacyFile`).
 *   The synthetic generator, the flaw fixtures and the permutations write
 *   this. A row is its own parent: its baseline columns become the baseline
 *   feature and its proposed columns the post-intervention one.
 * - A legacy baseline and post-intervention pair (`siteFromLegacyPair`), as the
 *   workbook route writes. Each post-intervention feature is matched to its
 *   baseline parent: by reference first, then by shape.
 *
 * No generator uses this: they draw the BNG Service format natively. It
 * converts legacy files that already exist. Each legacy row is read as a
 * feature source, its values without their list numbers, and the site is
 * built by `site-features.mjs`, whose rules are the template's.
 */

import { randomUUID } from 'node:crypto'
import { openGeoPackageReadonly, wkbToGeoJSON } from '../gpkg-io/index.mjs'
import { pointInRing, polygonCentroid } from '../geometry.mjs'
import { HABITAT_REF } from './site.mjs'
import {
  baselineFeature,
  hasPostIntervention,
  iggiVertical,
  layerFromSources,
  postInterventionFeature,
  redlineFeature,
  text
} from './site-features.mjs'
import { moveVerticalHabitats } from './vertical-from-area.mjs'
import { withoutListNumber } from './vocabulary.mjs'

export { timingValues } from './site-features.mjs'

const CREATED = 'Created'
const POINT_TOLERANCE_M = 1e-6

/** The legacy layers, keyed as the generators key them. */
const LEGACY = {
  habitats: { table: 'Habitats', ref: 'Parcel Ref', comment: 'Comment' },
  hedgerows: { table: 'Hedgerows', ref: 'Parcel Ref', comment: 'Comments' },
  rivers: { table: 'Rivers', ref: 'Parcel Ref', comment: 'Comments' },
  trees: { table: 'Urban Trees', ref: 'Tree Ref', comment: 'Comment' }
}
const LEGACY_IGGIS = 'iggis'

const TIMING_COLUMNS = {
  default: [
    'Habitat created in advance/years',
    'Delay in starting habitat creation/years'
  ],
  trees: [
    'Habitat Created/Enhanced in advance/years',
    'Delay in starting habitat creation/enhancement in years'
  ]
}

function tableExists(db, table) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table)
  )
}

function geometryColumn(db, table) {
  return (
    db
      .prepare(
        'SELECT column_name FROM gpkg_geometry_columns WHERE table_name = ?'
      )
      .get(table)?.column_name ?? 'geometry'
  )
}

/** A legacy table's rows in file order, each with its shape as GeoJSON. */
function readRows(db, table) {
  if (!tableExists(db, table)) {
    return []
  }
  const column = geometryColumn(db, table)
  return db
    .prepare(`SELECT * FROM "${table}" ORDER BY fid`)
    .all()
    .map((row, index) => ({
      index,
      row,
      geometry: row[column] ? simpleGeometry(wkbToGeoJSON(row[column])) : null
    }))
}

// The template's area layers hold Polygons: a single-part MultiPolygon is
// read as the Polygon it is.
function simpleGeometry(geometry) {
  if (geometry.type === 'MultiPolygon' && geometry.coordinates.length === 1) {
    return { type: 'Polygon', coordinates: geometry.coordinates[0] }
  }
  return geometry
}

// ------------------------------------------------- legacy row → source

const condition = (row, side) => withoutListNumber(row[`${side} Condition`])

function timingOf(layerKey, row) {
  const [advance, delay] = TIMING_COLUMNS[layerKey] ?? TIMING_COLUMNS.default
  return { advance: row[advance], delay: row[delay] }
}

const LEGACY_VALUES = {
  habitats: (row) => ({
    baseline: {
      broad: row['Baseline Broad Habitat Type'],
      type: withoutListNumber(row['Baseline Habitat Type']),
      condition: condition(row, 'Baseline')
    },
    proposed: {
      broad: row['Proposed Broad Habitat Type'],
      type: withoutListNumber(row['Proposed Habitat Type']),
      condition: condition(row, 'Proposed'),
      significance: row['Proposed Strategic Significance'],
      ...timingOf('habitats', row)
    }
  }),
  hedgerows: (row) => ({
    baseline: {
      type: row['Baseline Hedge Type'],
      condition: condition(row, 'Baseline')
    },
    proposed: {
      type: row['Proposed Hedge Type'],
      condition: condition(row, 'Proposed'),
      significance: row['Proposed Strategic Significance'],
      ...timingOf('hedgerows', row)
    }
  }),
  rivers: (row) => ({
    baseline: {
      type: row['Baseline River Type'],
      condition: condition(row, 'Baseline'),
      water: row['Baseline Encroachment into Watercourse'],
      riparian: row['Baseline Encroachment into riparian zone']
    },
    proposed: {
      type: row['Proposed River Type'],
      condition: condition(row, 'Proposed'),
      significance: row['Proposed Strategic Significance'],
      water: row['Proposed Encroachment into Watercourse'],
      riparian: row['Proposed Encroachment into riparian zone'],
      ...timingOf('rivers', row)
    }
  }),
  trees: (row) => ({
    baseline: {
      size: row['Baseline Tree Size'],
      type: row['Baseline Tree Type'],
      setting: row['Baseline Rural or Urban Tree'],
      condition: condition(row, 'Baseline')
    },
    proposed: {
      size: row['Proposed Tree Size'],
      type: row['Proposed Tree Type'],
      setting: row['Proposed Rural or Urban Tree'],
      condition: condition(row, 'Proposed'),
      significance: row['Proposed Strategic Significance'],
      ...timingOf('trees', row)
    }
  })
}

/** A legacy row as a feature source. */
function legacySource(layerKey, { index, row, geometry }) {
  const legacy = LEGACY[layerKey]
  return {
    index,
    geometry,
    ref: text(row[legacy.ref]),
    retention: row['Retention Category'],
    comment: row[legacy.comment] ?? null,
    ...LEGACY_VALUES[layerKey](row)
  }
}

// ---------------------------------------------------------------- redline

function redline(db, rows) {
  const [first] = readRows(db, 'Red Line Boundary')
  if (!first?.geometry) {
    throw new Error('The legacy GeoPackage has no Red Line Boundary')
  }
  const survey = rows.find((r) => r.row['Survey Date'])?.row ?? {}
  return redlineFeature(first.geometry, first.row['Site Name'], survey)
}

/** The legacy bad fixture's IGGI polygons, as vertical habitats. */
function iggiFeatures(db, options) {
  const layer = { baseline: [], postIntervention: [] }
  for (const source of readRows(db, LEGACY_IGGIS)) {
    const { parent, child } = iggiVertical(
      source.geometry,
      source.row['IGGI Ref'],
      source.index,
      options.uuidFor('verticalHabitats', source.index)
    )
    layer.baseline.push(parent)
    layer.postIntervention.push(child)
  }
  return layer
}

// ---------------------------------------------------------------- options

function resolveOptions({ uuidFor, choose } = {}) {
  return {
    uuidFor: uuidFor ?? (() => randomUUID()),
    choose: choose ?? Math.random
  }
}

const emptyLayer = () => ({ baseline: [], postIntervention: [] })

/**
 * The site in one legacy file whose every row carries both stages.
 *
 * @param {string} legacyPath
 * @param {object} [options]
 * @param {(layerKey: string, index: number) => string} [options.uuidFor]
 *   the feature_uuid of the baseline feature from legacy row `index`; random
 *   by default
 * @param {() => number} [options.choose]  a source of numbers in [0, 1) for
 *   the values the legacy file does not hold, such as a tree's native or
 *   non-native type; Math.random by default
 */
export function siteFromLegacyFile(legacyPath, options) {
  const resolved = resolveOptions(options)
  const db = openGeoPackageReadonly(legacyPath)
  try {
    const layers = {}
    const allRows = []
    for (const [layerKey, legacy] of Object.entries(LEGACY)) {
      const rows = readRows(db, legacy.table)
      allRows.push(...rows)
      layers[layerKey] = layerFromSources(
        layerKey,
        rows.map((row) => legacySource(layerKey, row)),
        resolved
      )
    }
    layers.verticalHabitats = iggiFeatures(db, resolved)
    const site = { redline: redline(db, allRows), layers }
    moveVerticalHabitats(site, (i) =>
      resolved.uuidFor('verticalHabitats/moved', i)
    )
    return site
  } finally {
    db.close()
  }
}

// ------------------------------------------------------------ pair matching

const ring = (geometry) => geometry.coordinates[0]

const SPLIT_SUFFIX = /(?:[a-z]|-\d+)$/

/** A post-intervention ref's baseline ref: "H001a" → "H001", "T003-2" → "T003". */
function baselineRefOf(ref) {
  return ref?.replace(SPLIT_SUFFIX, '') ?? null
}

function samePoint([ax, ay], [bx, by]) {
  return Math.hypot(ax - bx, ay - by) <= POINT_TOLERANCE_M
}

function distanceToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)
        )
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function onLine(point, coords) {
  for (let i = 1; i < coords.length; i += 1) {
    if (
      distanceToSegment(point, coords[i - 1], coords[i]) <= POINT_TOLERANCE_M
    ) {
      return true
    }
  }
  return false
}

/**
 * A point strictly inside a polygon: the middle of the widest stretch a
 * horizontal line through its centroid crosses. Works for the concave cells
 * the partitioner can draw, where the centroid itself may fall outside.
 */
export function interiorPoint(coords) {
  const [, cy] = polygonCentroid(coords)
  const crossings = []
  for (let i = 1; i < coords.length; i += 1) {
    const [ax, ay] = coords[i - 1]
    const [bx, by] = coords[i]
    if (ay > cy !== by > cy) {
      crossings.push(ax + ((cy - ay) / (by - ay)) * (bx - ax))
    }
  }
  crossings.sort((a, b) => a - b)
  let best = null
  for (let i = 1; i < crossings.length; i += 2) {
    const width = crossings[i] - crossings[i - 1]
    if (!best || width > best.width) {
      best = { width, x: (crossings[i] + crossings[i - 1]) / 2 }
    }
  }
  return best ? [best.x, cy] : polygonCentroid(coords)
}

/** Whether a post-intervention shape lies within (or on) a baseline shape. */
function liesWithin(child, parent) {
  if (child.type === 'Point') {
    return samePoint(child.coordinates, parent.coordinates)
  }
  if (child.type === 'LineString') {
    return child.coordinates.every((p) => onLine(p, parent.coordinates))
  }
  return pointInRing(interiorPoint(ring(child)), ring(parent))
}

function findParent(feature, candidates) {
  const ref = feature.values[HABITAT_REF]
  const byRef = [ref, baselineRefOf(ref)]
    .map((r) => candidates.find((c) => c.values[HABITAT_REF] === r))
    .find((c) => c && liesWithin(feature.geometry, c.geometry))
  return (
    byRef ??
    candidates.find((c) => liesWithin(feature.geometry, c.geometry)) ??
    null
  )
}

/**
 * The site in a legacy baseline and post-intervention pair, as the workbook
 * route writes them. Options as for `siteFromLegacyFile`.
 *
 * @param {string} baselinePath
 * @param {string} postInterventionPath
 * @param {object} [options]
 */
export function siteFromLegacyPair(
  baselinePath,
  postInterventionPath,
  options
) {
  const resolved = resolveOptions(options)
  const baselineDb = openGeoPackageReadonly(baselinePath)
  const piDb = openGeoPackageReadonly(postInterventionPath)
  try {
    const layers = {}
    const allRows = []
    for (const [layerKey, legacy] of Object.entries(LEGACY)) {
      const layer = emptyLayer()
      for (const row of readRows(baselineDb, legacy.table)) {
        allRows.push(row)
        layer.baseline.push(
          baselineFeature(layerKey, legacySource(layerKey, row), resolved)
        )
      }
      for (const row of readRows(piDb, legacy.table)) {
        const source = legacySource(layerKey, row)
        if (
          !source.geometry ||
          !hasPostIntervention(layerKey, source.retention)
        ) {
          continue
        }
        const created = layerKey !== 'habitats' && source.retention === CREATED
        const probe = {
          geometry: source.geometry,
          values: { [HABITAT_REF]: source.ref }
        }
        const parent = created ? null : findParent(probe, layer.baseline)
        if (!created && !parent) {
          throw new Error(
            `${legacy.table} ${source.ref}: no baseline feature holds this post-intervention feature`
          )
        }
        layer.postIntervention.push(
          postInterventionFeature(layerKey, source, parent, resolved.choose)
        )
      }
      layers[layerKey] = layer
    }
    layers.verticalHabitats = emptyLayer()
    const site = { redline: redline(baselineDb, allRows), layers }
    moveVerticalHabitats(site, (i) =>
      resolved.uuidFor('verticalHabitats/moved', i)
    )
    return site
  } finally {
    baselineDb.close()
    piDb.close()
  }
}
