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
 *   its own retention and size, the rest lost. A hedgerow is always placed
 *   by its parts' lengths, so a shorter hedge loses the rest.
 * - No post-intervention feature: lost.
 * - A post-intervention feature with no parent: a creation only.
 * - A parent_uuid that names no baseline feature: noted, and placed as a
 *   creation if Created.
 *
 * Retention is read as the service reads it, without a list number; an
 * unrecognised value is noted.
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
import {
  CREATED,
  ENHANCED,
  RETAINED,
  normaliseRetention,
  workbookSpelling,
  years
} from './workbook-values.mjs'

const SQ_METRES_PER_HECTARE = 10_000
const METRES_PER_KM = 1000
const BASELINE = 'Baseline'
const POST_INTERVENTION = 'Post-Intervention'
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
    riparianEncroachment: workbookSpelling('riparianEncroachment', riparian)
  }
}

const LAYERS = {
  habitats: habitatSide(areaSize),
  verticalHabitats: habitatSide(verticalSize),
  hedgerows: { ...linear('Hedge Type', () => ({})), byParts: true },
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

/**
 * A post-intervention feature's retention, as the service reads it: without
 * a list number, in its own case. An unknown value is noted, and the
 * feature is then read as not continuing.
 */
function retentionOf(child, context) {
  const retention = normaliseRetention(child['Retention Category'])
  if (retention === null) {
    context.notes.push(
      `${context.table} ${child['Habitat Ref']}: unrecognised retention category ${JSON.stringify(child['Retention Category'])}; read as not continuing`
    )
  }
  return retention
}

/** Where a baseline feature goes when it becomes one feature, whole. */
function placeWhole(layer, baseline, child, context) {
  const proposed = proposedRow(layer, child)
  switch (retentionOf(child, context)) {
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
 * Where a baseline feature goes by its parts' own sizes: its Retained parts
 * are retained, an Enhanced part enhanced, and each Created part a
 * creation; the rest is lost. The enhancement sheet pairs one enhancement
 * with each baseline row, so two Enhanced parts are refused.
 */
function placeParts(layer, baseline, parts, context) {
  const retentions = parts.map((p) => retentionOf(p, context))
  const byRetention = (retention) =>
    parts
      .filter((p, i) => retentions[i] === retention)
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

/**
 * Where a baseline feature goes, by the features it becomes. A split is
 * placed by its parts' sizes. A hedgerow always is, as the service counts
 * a shorter hedge's lost length (template guide, Hedgerows). A watercourse
 * kept whole keeps its surveyed length however its line changes, as the
 * service cannot measure a watercourse's part loss from the map.
 */
function placeBaseline(layer, parent, parts, context) {
  const baseline = baselineRow(layer, parent)
  if (parts.length === 0) {
    return { baseline }
  }
  return parts.length === 1 && !layer.byParts
    ? placeWhole(layer, baseline, parts[0], context)
    : placeParts(layer, baseline, parts, context)
}

/**
 * A post-intervention feature whose parent_uuid names no baseline feature,
 * as a broken link leaves it: noted, and placed as a creation if Created,
 * as nothing can be retained or enhanced from no baseline.
 */
function placeOrphan(layer, child, context) {
  const retention = retentionOf(child, context)
  const created = retention === CREATED
  context.notes.push(
    `${context.table} ${child['Habitat Ref']}: its parent_uuid names no baseline feature; ${created ? 'placed as a creation' : `${retention ?? 'its'} row left out`}`
  )
  return created ? { creations: [proposedRow(layer, child)] } : {}
}

function layerEntries(db, layerKey, notes) {
  const layer = LAYERS[layerKey]
  const context = { notes, table: tableName(layerKey, POST_INTERVENTION) }
  const children = readTable(db, layerKey, POST_INTERVENTION)
  const parents = readTable(db, layerKey, BASELINE)
  const uuids = new Set(parents.map((p) => p.feature_uuid))
  const byParent = Map.groupBy(
    children.filter((c) => uuids.has(c.parent_uuid)),
    (c) => c.parent_uuid
  )
  const kept = parents.map((parent) =>
    placeBaseline(
      layer,
      parent,
      byParent.get(parent.feature_uuid) ?? [],
      context
    )
  )
  const created = children
    .filter((c) => !c.parent_uuid)
    .map((c) => ({ creations: [proposedRow(layer, c)] }))
  const orphans = children
    .filter((c) => c.parent_uuid && !uuids.has(c.parent_uuid))
    .map((c) => placeOrphan(layer, c, context))
  return [...kept, ...created, ...orphans]
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
 * Read an open BNG Service GeoPackage into rows for each input sheet.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{ rows: Record<string, object[]>, notes: string[] }} as
 *   `workbookRowsFromGeoPackage`
 */
export function workbookRowsFromBngServiceDb(db) {
  const notes = []
  const areas = toSheets([
    ...layerEntries(db, 'habitats', notes),
    ...layerEntries(db, 'verticalHabitats', notes),
    ...layerEntries(db, 'trees', notes)
  ])
  const hedgerows = toSheets(layerEntries(db, 'hedgerows', notes))
  const watercourses = toSheets(layerEntries(db, 'rivers', notes))
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
    notes
  }
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
    return workbookRowsFromBngServiceDb(db)
  } finally {
    db.close()
  }
}
