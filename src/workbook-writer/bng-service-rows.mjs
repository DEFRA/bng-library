/**
 * Turn a GeoPackage in the BNG Service template format into metric workbook
 * rows: the workbook that describes exactly the file a user uploads.
 *
 * One file holds both stages. Each baseline feature is placed by what
 * becomes of it, read from the post-intervention feature that names it as
 * its parent (by parent_uuid):
 *
 * - Retained or Enhanced: a baseline row retained or enhanced, as the legacy
 *   reader places it (`gpkg-rows.mjs`).
 * - Created with a parent: an area habitat that cannot be kept is lost and
 *   created in its place (a baseline loss plus a creation row).
 * - Split into parts (a hedge that gets worse in part): each part placed by
 *   its own retention, the rest lost.
 * - No post-intervention feature: lost.
 * - A post-intervention feature with no parent: a creation only.
 *
 * Area and vertical area habitats and trees go to the habitat sheets.
 * Sizes are measured from the shape as the service measures them, except a
 * vertical habitat's, whose face area is typed in. Strategic significance is
 * Low or High in the template, and is written in the workbook's own words.
 */

import { INDIVIDUAL_TREE_AREA_HECTARES } from '../metric/index.mjs'
import { openGeoPackageReadonly, wkbToGeoJSON } from '../gpkg-io/index.mjs'
import { areaSquareMetres, lengthMetres } from '../measure/index.mjs'
import { GEOMETRY_COLUMN, tableName } from '../bng-service/schema.mjs'
import { STRATEGIC_SIGNIFICANCE } from '../synthetic/synthetic-constants.mjs'
import { WORKBOOK_SPELLINGS } from './gpkg-rows.mjs'

const SQ_METRES_PER_HECTARE = 10_000
const METRES_PER_KM = 1000
const BASELINE = 'Baseline'
const POST_INTERVENTION = 'Post-Intervention'
const RETAINED = 'Retained'
const ENHANCED = 'Enhanced'
const CREATED = 'Created'
const INDIVIDUAL_TREES = 'Individual trees'
const NOT_IRREPLACEABLE = 'No'
const [HIGH_WORDING, , LOW_WORDING] = STRATEGIC_SIGNIFICANCE
const WORKBOOK_SIGNIFICANCE = { Low: LOW_WORDING, High: HIGH_WORDING }
const TREE_TIMING = [
  'Habitat Created/Enhanced in advance/years',
  'Delay in starting habitat creation/enhancement in years'
]
const TIMING = [
  'Habitat created in advance/years',
  'Delay in starting habitat creation/years'
]

/** The table that tells a BNG Service file from a legacy one. */
export const BNG_SERVICE_MARKER = tableName('habitats', BASELINE)

const significance = (value) => WORKBOOK_SIGNIFICANCE[value] ?? value ?? null

/** Years as the workbook's list holds them: a number where there is one. */
function years(value) {
  if (value === null || value === undefined || value === '') {
    return 0
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : value
}

function readTable(db, layerKey, stage) {
  return db
    .prepare(`SELECT * FROM "${tableName(layerKey, stage)}" ORDER BY fid`)
    .all()
    .map((row) => ({
      ...row,
      geometry: row[GEOMETRY_COLUMN] ? wkbToGeoJSON(row[GEOMETRY_COLUMN]) : null
    }))
}

// ------------------------------------------------------------ per layer

const areaSize = (row) => areaSquareMetres(row.geometry) / SQ_METRES_PER_HECTARE
const verticalSize = (row) => row.Area
const lineSize = (row) => lengthMetres(row.geometry) / METRES_PER_KM

function habitatSide(size) {
  return {
    baseline: (row) => ({
      broadHabitat: row['Baseline Broad Habitat Type'],
      habitatType: row['Baseline Habitat Type'],
      irreplaceable: row['Irreplaceable Habitat'] ?? NOT_IRREPLACEABLE,
      size: size(row)
    }),
    proposed: (row) => ({
      broadHabitat: row['Proposed Broad Habitat Type'],
      habitatType: row['Proposed Habitat Type'],
      size: size(row)
    }),
    timing: TIMING
  }
}

function treeArea(size) {
  return INDIVIDUAL_TREE_AREA_HECTARES[size] ?? null
}

const TREES = {
  baseline: (row) => ({
    broadHabitat: INDIVIDUAL_TREES,
    habitatType: row['Baseline Rural or Urban Tree'],
    irreplaceable: row['Irreplaceable Habitat'] ?? NOT_IRREPLACEABLE,
    size: treeArea(row['Baseline Tree Size'])
  }),
  proposed: (row) => ({
    broadHabitat: INDIVIDUAL_TREES,
    habitatType: row['Proposed Rural or Urban Tree'],
    size: treeArea(row['Proposed Tree Size'])
  }),
  timing: TREE_TIMING
}

function linear(typeColumn, extra) {
  return {
    baseline: (row) => ({
      habitatType: row[`Baseline ${typeColumn}`],
      size: lineSize(row),
      ...extra(row, BASELINE)
    }),
    proposed: (row) => ({
      habitatType: row[`Proposed ${typeColumn}`],
      size: lineSize(row),
      ...extra(row, 'Proposed')
    }),
    timing: TIMING
  }
}

function encroachment(row, side) {
  const riparian = row[`${side} Encroachment into riparian zone`]
  return {
    watercourseEncroachment: row[`${side} Encroachment into Watercourse`],
    riparianEncroachment:
      WORKBOOK_SPELLINGS.riparianEncroachment[riparian] ?? riparian
  }
}

const LAYERS = {
  habitats: habitatSide(areaSize),
  verticalHabitats: habitatSide(verticalSize),
  hedgerows: linear('Hedge Type', () => ({})),
  rivers: linear('River Type', encroachment),
  trees: TREES
}

function baselineRow(layer, row) {
  return {
    reference: row['Habitat Ref'],
    ...layer.baseline(row),
    condition: row['Baseline Condition'],
    strategicSignificance: significance(row['Baseline Strategic Significance'])
  }
}

function proposedRow(layer, row) {
  const [advance, delay] = layer.timing
  return {
    reference: row['Habitat Ref'],
    ...layer.proposed(row),
    condition: row['Proposed Condition'],
    strategicSignificance: significance(row['Proposed Strategic Significance']),
    advanceYears: years(row[advance]),
    delayYears: years(row[delay])
  }
}

/** Where a baseline feature goes when it becomes one feature, whole. */
function placeWhole(layer, baseline, child) {
  const proposed = proposedRow(layer, child)
  switch (child['Retention Category']) {
    case RETAINED:
      return { baseline: { ...baseline, retained: baseline.size } }
    case ENHANCED:
      return {
        baseline: {
          ...baseline,
          enhanced: baseline.size,
          enhancement: proposed
        },
        creations: []
      }
    case CREATED:
      return { baseline, creations: [proposed] }
    default:
      return { baseline }
  }
}

const sizeOf = (rows) => rows.reduce((sum, row) => sum + (row.size ?? 0), 0)

/**
 * Where a baseline feature goes when it is split, as a hedge that gets worse
 * in part is: its Retained parts are retained, an Enhanced part enhanced, and
 * each Created part a creation; the rest is lost. The enhancement sheet pairs
 * one enhancement with each baseline row, so two Enhanced parts are refused.
 */
function placeSplit(layer, baseline, parts) {
  const byRetention = (retention) =>
    parts
      .filter((p) => p['Retention Category'] === retention)
      .map((p) => proposedRow(layer, p))
  const retained = byRetention(RETAINED)
  const enhanced = byRetention(ENHANCED)
  if (enhanced.length > 1) {
    throw new Error(
      `${baseline.reference}: split into ${enhanced.length} Enhanced parts, which the workbook pairs with one baseline row`
    )
  }
  const placed = { ...baseline }
  if (retained.length > 0) {
    placed.retained = sizeOf(retained)
  }
  if (enhanced.length > 0) {
    placed.enhanced = sizeOf(enhanced)
    placed.enhancement = enhanced[0]
  }
  return { baseline: placed, creations: byRetention(CREATED) }
}

/** Where a baseline feature goes, by the features it becomes. */
function placeBaseline(layer, parent, parts) {
  const baseline = baselineRow(layer, parent)
  if (parts.length === 0) {
    return { baseline }
  }
  return parts.length === 1
    ? placeWhole(layer, baseline, parts[0])
    : placeSplit(layer, baseline, parts)
}

function layerEntries(db, layerKey) {
  const layer = LAYERS[layerKey]
  const children = readTable(db, layerKey, POST_INTERVENTION)
  const byParent = Map.groupBy(
    children.filter((c) => c.parent_uuid),
    (c) => c.parent_uuid
  )
  const kept = readTable(db, layerKey, BASELINE).map((parent) =>
    placeBaseline(layer, parent, byParent.get(parent.feature_uuid) ?? [])
  )
  const created = children
    .filter((c) => !c.parent_uuid)
    .map((c) => ({ creations: [proposedRow(layer, c)] }))
  return [...kept, ...created]
}

/** Split placed entries into the three sheets of one habitat kind. */
function toSheets(entries) {
  const baseline = entries.filter((e) => e.baseline).map((e) => e.baseline)
  return {
    baseline: baseline.map(({ enhancement, ...row }) => row),
    creation: entries.flatMap((e) => e.creations ?? []),
    enhancement: baseline.filter((b) => b.enhancement).map((b) => b.enhancement)
  }
}

/** Whether an open GeoPackage is in the BNG Service template format. */
export function isBngServiceGeoPackage(db) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(BNG_SERVICE_MARKER)
  )
}

/**
 * Read a BNG Service GeoPackage into rows for each input sheet.
 *
 * @param {string} path
 * @returns {{ rows: Record<string, object[]>, notes: string[] }} as
 *   `workbookRowsFromGeoPackage`
 */
export function workbookRowsFromBngService(path) {
  const db = openGeoPackageReadonly(path)
  try {
    const areas = toSheets([
      ...layerEntries(db, 'habitats'),
      ...layerEntries(db, 'verticalHabitats'),
      ...layerEntries(db, 'trees')
    ])
    const hedgerows = toSheets(layerEntries(db, 'hedgerows'))
    const watercourses = toSheets(layerEntries(db, 'rivers'))
    return {
      rows: {
        habitatBaseline: areas.baseline,
        habitatCreation: areas.creation,
        habitatEnhancement: areas.enhancement,
        hedgerowBaseline: hedgerows.baseline,
        hedgerowCreation: hedgerows.creation,
        hedgerowEnhancement: hedgerows.enhancement,
        watercourseBaseline: watercourses.baseline,
        watercourseCreation: watercourses.creation,
        watercourseEnhancement: watercourses.enhancement
      },
      notes: []
    }
  } finally {
    db.close()
  }
}
