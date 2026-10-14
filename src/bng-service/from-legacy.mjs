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
 * Either way the rules are the template's (its plugin/README.md, "What the
 * tools translate"):
 *
 * - An area habitat cannot be removed: the legacy "Lost" row of an area
 *   habitat is a creation in its place, and becomes Created with the parcel as
 *   its parent.
 * - A lost hedgerow, watercourse or tree is absent from the post-intervention
 *   table. Its absence is the record.
 * - A created hedgerow, watercourse or tree has no parent and no baseline row.
 * - Sizes are measured from the shape: areas in hectares, lengths in metres.
 * - Values lose their list numbers, strategic significance becomes Low or
 *   High (Low at baseline and on a Retained row), spatial risk is N/A, and
 *   distinctiveness and a single allowed Irreplaceable Habitat answer come
 *   from the template's own lists.
 */

import { randomUUID } from 'node:crypto'
import { openGeoPackageReadonly, wkbToGeoJSON } from '../gpkg-io/index.mjs'
import { areaSquareMetres, lengthMetres } from '../measure/index.mjs'
import { pointInRing, polygonCentroid } from '../geometry.mjs'
import { warn } from '../log.mjs'
import { listIndex } from './reference.mjs'
import { COMMENT, HABITAT_REF } from './site.mjs'
import { moveVerticalHabitats } from './vertical-from-area.mjs'
import {
  LOW,
  NO,
  NOT_APPLICABLE,
  TO_BE_CREATED,
  distinctiveness,
  irreplaceableAnswers,
  riparianEncroachment,
  significance,
  treeSetting,
  withoutListNumber
} from './vocabulary.mjs'

const SQ_M_PER_HECTARE = 10_000
const RETAINED = 'Retained'
const ENHANCED = 'Enhanced'
const CREATED = 'Created'
const LOST = 'Lost'
const NEWLY_PLANTED = 'Newly Planted'
const EXISTING = 'Existing'
const ON_SITE_RISK = NOT_APPLICABLE
const STANDARD_ENHANCEMENT = 'Standard Enhancement'
const NATIVE = 'Native'
const NON_NATIVE = 'Non-native'
const NATIVE_SHARE = 0.8
const POINT_TOLERANCE_M = 1e-6
const IGGI_HABITAT = {
  broad: 'Intertidal hard structures',
  type: 'Artificial hard structures with integrated greening of grey infrastructure (IGGI)'
}
const IGGI_CONDITION = 'Moderate'

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

const text = (value) =>
  value === null || value === undefined ? null : String(value)

const hectares = (geometry) => areaSquareMetres(geometry) / SQ_M_PER_HECTARE

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

function defaultIrreplaceable(habitatType) {
  const answers = irreplaceableAnswers(habitatType)
  return answers.size === 1 ? [...answers][0] : NO
}

// --------------------------------------------------------------- baseline

function areaBaseline(row, geometry, ref) {
  const type = withoutListNumber(row['Baseline Habitat Type'])
  return {
    [HABITAT_REF]: ref,
    'Baseline Broad Habitat Type': row['Baseline Broad Habitat Type'],
    'Baseline Habitat Type': type,
    'Baseline Distinctiveness': distinctiveness('habitats', type),
    'Baseline Condition': withoutListNumber(row['Baseline Condition']),
    'Baseline Strategic Significance': LOW,
    'Irreplaceable Habitat': defaultIrreplaceable(type),
    Area: hectares(geometry),
    [COMMENT]: row[LEGACY.habitats.comment] ?? null
  }
}

function hedgerowBaseline(row, geometry, ref) {
  const type = row['Baseline Hedge Type']
  return {
    [HABITAT_REF]: ref,
    'Baseline Hedge Type': type,
    'Baseline Distinctiveness': distinctiveness('hedgerows', type),
    'Baseline Condition': withoutListNumber(row['Baseline Condition']),
    'Baseline Strategic Significance': LOW,
    Length: lengthMetres(geometry),
    [COMMENT]: row[LEGACY.hedgerows.comment] ?? null
  }
}

function riverBaseline(row, geometry, ref) {
  const type = row['Baseline River Type']
  return {
    [HABITAT_REF]: ref,
    'Baseline River Type': type,
    'Baseline Distinctiveness': distinctiveness('rivers', type),
    'Baseline Condition': withoutListNumber(row['Baseline Condition']),
    'Baseline Strategic Significance': LOW,
    'Baseline Encroachment into Watercourse':
      row['Baseline Encroachment into Watercourse'],
    'Baseline Encroachment into riparian zone': riparianEncroachment(
      type,
      row['Baseline Encroachment into riparian zone']
    ),
    Length: lengthMetres(geometry),
    [COMMENT]: row[LEGACY.rivers.comment] ?? null
  }
}

function treeType(value, choose) {
  if (value === NATIVE || value === NON_NATIVE) {
    return value
  }
  return choose() < NATIVE_SHARE ? NATIVE : NON_NATIVE
}

function treeBaseline(row, geometry, ref, choose) {
  return {
    [HABITAT_REF]: ref,
    'Baseline Tree Size': row['Baseline Tree Size'],
    'Baseline Tree Type': treeType(row['Baseline Tree Type'], choose),
    'Baseline Rural or Urban Tree': treeSetting(
      row['Baseline Rural or Urban Tree']
    ),
    'Baseline Condition': withoutListNumber(row['Baseline Condition']),
    'Baseline Strategic Significance': LOW,
    'Irreplaceable Habitat': NO,
    [COMMENT]: row[LEGACY.trees.comment] ?? null
  }
}

const BASELINE_VALUES = {
  habitats: areaBaseline,
  hedgerows: hedgerowBaseline,
  rivers: riverBaseline,
  trees: treeBaseline
}

// ------------------------------------------------------- post-intervention

/** Retention as the template stores it: an area habitat's "Lost" is Created. */
function templateRetention(layerKey, retention) {
  return layerKey === 'habitats' && retention === LOST ? CREATED : retention
}

function proposedSignificance(retention, value) {
  return retention === RETAINED ? LOW : significance(value)
}

const aboveZero = (value) => value !== null && value !== '0'

/**
 * The advance and delay years. The template allows both at 0, but greys out
 * one while the other is above 0, so that one is blank, not 0.
 */
export function timingValues(advance, delay) {
  const a = text(advance)
  const d = text(delay)
  return [
    aboveZero(d) && a === '0' ? null : a,
    aboveZero(a) && d === '0' ? null : d
  ]
}

function timing(layerKey, row) {
  const [advance, delay] = TIMING_COLUMNS[layerKey] ?? TIMING_COLUMNS.default
  const [a, d] = timingValues(row[advance], row[delay])
  return { [advance]: a, [delay]: d }
}

function areaProposed(row, geometry, retention) {
  const type = withoutListNumber(row['Proposed Habitat Type'])
  return {
    'Retention Category': retention,
    'Proposed Broad Habitat Type': row['Proposed Broad Habitat Type'],
    'Proposed Habitat Type': type,
    'Proposed Distinctiveness': distinctiveness('habitats', type, true),
    'Proposed Condition': withoutListNumber(row['Proposed Condition']),
    'Proposed Strategic Significance': proposedSignificance(
      retention,
      row['Proposed Strategic Significance']
    ),
    ...timing('habitats', row),
    'Spatial risk category': ON_SITE_RISK,
    Area: hectares(geometry)
  }
}

function hedgerowProposed(row, geometry, retention) {
  const type = row['Proposed Hedge Type']
  return {
    'Retention Category': retention,
    'Proposed Hedge Type': type,
    'Proposed Distinctiveness': distinctiveness('hedgerows', type, true),
    'Proposed Condition': withoutListNumber(row['Proposed Condition']),
    'Proposed Strategic Significance': proposedSignificance(
      retention,
      row['Proposed Strategic Significance']
    ),
    ...timing('hedgerows', row),
    'Spatial risk category': ON_SITE_RISK,
    Length: lengthMetres(geometry)
  }
}

function riverProposed(row, geometry, retention) {
  const type = row['Proposed River Type']
  return {
    'Retention Category': retention,
    'Proposed River Type': type,
    'Proposed Distinctiveness': distinctiveness('rivers', type, true),
    'Proposed Condition': withoutListNumber(row['Proposed Condition']),
    'Proposed Strategic Significance': proposedSignificance(
      retention,
      row['Proposed Strategic Significance']
    ),
    'Proposed Encroachment into Watercourse':
      row['Proposed Encroachment into Watercourse'],
    'Proposed Encroachment into riparian zone': riparianEncroachment(
      type,
      row['Proposed Encroachment into riparian zone']
    ),
    'Enhancement Type':
      retention === ENHANCED ? STANDARD_ENHANCEMENT : NOT_APPLICABLE,
    ...timing('rivers', row),
    'Spatial risk category': ON_SITE_RISK,
    Length: lengthMetres(geometry)
  }
}

function treeProposed(row, geometry, retention) {
  return {
    'Retention Category': retention,
    'Proposed Tree Size': row['Proposed Tree Size'],
    'Proposed Rural or Urban Tree': treeSetting(
      row['Proposed Rural or Urban Tree']
    ),
    'Proposed Condition': withoutListNumber(row['Proposed Condition']),
    'Proposed Strategic Significance': proposedSignificance(
      retention,
      row['Proposed Strategic Significance']
    ),
    Category: retention === CREATED ? NEWLY_PLANTED : EXISTING,
    ...timing('trees', row),
    'Spatial risk category': ON_SITE_RISK
  }
}

const PROPOSED_VALUES = {
  habitats: areaProposed,
  hedgerows: hedgerowProposed,
  rivers: riverProposed,
  trees: treeProposed
}

/**
 * The baseline columns of a post-intervention row created from nothing,
 * which the template fills with "To be created" and "N/A", and leaves the
 * baseline significance blank.
 */
const PARENTLESS_BASELINE = {
  hedgerows: () => ({
    'Baseline Hedge Type': TO_BE_CREATED,
    'Baseline Distinctiveness': NOT_APPLICABLE,
    'Baseline Condition': NOT_APPLICABLE,
    'Baseline Strategic Significance': null,
    'Baseline Length': null
  }),
  rivers: () => ({
    'Baseline River Type': TO_BE_CREATED,
    'Baseline Distinctiveness': NOT_APPLICABLE,
    'Baseline Condition': NOT_APPLICABLE,
    'Baseline Strategic Significance': null,
    'Baseline Encroachment into Watercourse': NOT_APPLICABLE,
    'Baseline Encroachment into riparian zone': NOT_APPLICABLE,
    'Baseline Length': null
  }),
  trees: (row, choose) => ({
    'Baseline Tree Size': NOT_APPLICABLE,
    'Baseline Tree Type': NOT_APPLICABLE,
    'Baseline Rural or Urban Tree': NOT_APPLICABLE,
    'Baseline Condition': NOT_APPLICABLE,
    'Baseline Strategic Significance': null,
    'Irreplaceable Habitat': NO,
    'Proposed Tree Type': treeType(row['Proposed Tree Type'], choose)
  })
}

function postInterventionFeature(layerKey, source, parent, ref, choose) {
  const retention = templateRetention(
    layerKey,
    source.row['Retention Category']
  )
  const values = {
    [HABITAT_REF]: ref,
    ...PROPOSED_VALUES[layerKey](source.row, source.geometry, retention),
    [COMMENT]: null
  }
  if (!parent) {
    Object.assign(
      values,
      PARENTLESS_BASELINE[layerKey]?.(source.row, choose) ?? {}
    )
  } else if (layerKey === 'trees') {
    // A kept tree keeps its type: the Metric does not record a change.
    values['Proposed Tree Type'] = parent.values['Baseline Tree Type']
    keepTreeEnhancementBetter(values, parent)
  }
  return {
    geometry: source.geometry,
    values,
    parent,
    source: { index: source.index, retention: source.row['Retention Category'] }
  }
}

let enhancedTreeConditions = null

/**
 * An Enhanced tree moves to a better condition only: the template offers
 * nothing else. The legacy workbook route can mark a tree Enhanced without
 * one, because it reads no enhancement for trees, so such a tree is written
 * as the Retained tree it is, with a warning.
 */
function keepTreeEnhancementBetter(values, parent) {
  if (values['Retention Category'] !== ENHANCED) {
    return
  }
  enhancedTreeConditions ??= listIndex(
    'Individual trees/Individual tree Condition - options.csv',
    'ID',
    'New'
  )
  const baseline = parent.values['Baseline Condition']
  const better =
    enhancedTreeConditions.get(`${baseline}${ENHANCED}`) ?? new Set()
  if (better.has(values['Proposed Condition'])) {
    return
  }
  warn(
    `  tree ${values[HABITAT_REF]}: Enhanced with no better condition (${baseline} → ${values['Proposed Condition']}); written as Retained`
  )
  values['Retention Category'] = RETAINED
  values['Proposed Condition'] = baseline
  values['Proposed Strategic Significance'] = LOW
}

function hasBaseline(layerKey, retention) {
  return layerKey === 'habitats' || retention !== CREATED
}

function hasPostIntervention(layerKey, retention) {
  if (
    retention === RETAINED ||
    retention === ENHANCED ||
    retention === CREATED
  ) {
    return true
  }
  return layerKey === 'habitats' && retention === LOST
}

function baselineFeature(layerKey, source, ref, options) {
  return {
    geometry: source.geometry,
    values: BASELINE_VALUES[layerKey](
      source.row,
      source.geometry,
      ref,
      options.choose
    ),
    uuid: options.uuidFor(layerKey, source.index),
    source: { index: source.index }
  }
}

// ---------------------------------------------------------------- redline

const ring = (geometry) => geometry.coordinates[0]

function redline(db, rows) {
  const [first] = readRows(db, 'Red Line Boundary')
  if (!first?.geometry) {
    throw new Error('The legacy GeoPackage has no Red Line Boundary')
  }
  const [cx, cy] = polygonCentroid(ring(first.geometry))
  const survey = rows.find((r) => r.row['Survey Date'])?.row ?? {}
  return {
    geometry: first.geometry,
    values: {
      'Site Name': first.row['Site Name'] ?? survey['Site Name'] ?? null,
      Location: `Centred on easting ${Math.round(cx)}, northing ${Math.round(cy)}`,
      'Survey Date': survey['Survey Date'] ?? null,
      'Survey Details': survey['Survey Details'] ?? null,
      'Mapped by': survey['Mapped by'] ?? null,
      Company: survey.Company ?? null,
      'Base Map': survey['Base Map'] ?? null
    }
  }
}

// ---------------------------------------------- IGGI, as a vertical habitat

/**
 * The legacy bad fixture can draw an IGGI polygon. The template maps IGGI as
 * a vertical area habitat, drawn as a line along its base, so the polygon's
 * edge becomes the line and its area the area typed in.
 */
function iggiFeatures(db, options) {
  const baseline = []
  const postIntervention = []
  for (const source of readRows(db, LEGACY_IGGIS)) {
    const geometry = {
      type: 'LineString',
      coordinates: ring(source.geometry).slice(0, -1)
    }
    const ref = source.row['IGGI Ref']
    const area = hectares(source.geometry)
    const parent = {
      geometry,
      uuid: options.uuidFor('verticalHabitats', source.index),
      values: {
        [HABITAT_REF]: ref,
        'Baseline Broad Habitat Type': IGGI_HABITAT.broad,
        'Baseline Habitat Type': IGGI_HABITAT.type,
        'Baseline Distinctiveness': distinctiveness(
          'verticalHabitats',
          IGGI_HABITAT.type
        ),
        'Baseline Condition': IGGI_CONDITION,
        'Baseline Strategic Significance': LOW,
        'Irreplaceable Habitat': defaultIrreplaceable(IGGI_HABITAT.type),
        Area: area,
        [COMMENT]: null
      },
      source: { index: source.index }
    }
    baseline.push(parent)
    postIntervention.push({
      geometry,
      parent,
      values: {
        [HABITAT_REF]: ref,
        'Retention Category': RETAINED,
        'Proposed Broad Habitat Type': IGGI_HABITAT.broad,
        'Proposed Habitat Type': IGGI_HABITAT.type,
        'Proposed Distinctiveness': distinctiveness(
          'verticalHabitats',
          IGGI_HABITAT.type,
          true
        ),
        'Proposed Condition': IGGI_CONDITION,
        'Proposed Strategic Significance': LOW,
        'Spatial risk category': ON_SITE_RISK,
        Area: area,
        [COMMENT]: null
      },
      source: { index: source.index, retention: RETAINED }
    })
  }
  return { baseline, postIntervention }
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
      const layer = emptyLayer()
      for (const source of readRows(db, legacy.table)) {
        allRows.push(source)
        const retention = source.row['Retention Category']
        const ref = text(source.row[legacy.ref])
        const parent = hasBaseline(layerKey, retention)
          ? baselineFeature(layerKey, source, ref, resolved)
          : null
        if (parent) {
          layer.baseline.push(parent)
        }
        if (hasPostIntervention(layerKey, retention)) {
          layer.postIntervention.push(
            postInterventionFeature(
              layerKey,
              source,
              parent,
              ref,
              resolved.choose
            )
          )
        }
      }
      layers[layerKey] = layer
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
      for (const source of readRows(baselineDb, legacy.table)) {
        allRows.push(source)
        layer.baseline.push(
          baselineFeature(
            layerKey,
            source,
            text(source.row[legacy.ref]),
            resolved
          )
        )
      }
      for (const source of readRows(piDb, legacy.table)) {
        const retention = source.row['Retention Category']
        if (!source.geometry || !hasPostIntervention(layerKey, retention)) {
          continue
        }
        const ref = text(source.row[legacy.ref])
        const created = layerKey !== 'habitats' && retention === CREATED
        const probe = {
          geometry: source.geometry,
          values: { [HABITAT_REF]: ref }
        }
        const parent = created ? null : findParent(probe, layer.baseline)
        if (!created && !parent) {
          throw new Error(
            `${legacy.table} ${ref}: no baseline feature holds this post-intervention feature`
          )
        }
        layer.postIntervention.push(
          postInterventionFeature(
            layerKey,
            source,
            parent,
            ref,
            resolved.choose
          )
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
