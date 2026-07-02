/**
 * Workbook-driven writers for the Urban Trees (point) layer. Baseline and
 * post-intervention paths share the writer loop helper.
 *
 * The metric workbook records individual trees by numeric area, not by size.
 * Each tree row is therefore expanded into one or more points whose size bands
 * sum to ≈ the workbook area (see tree-area-bands.mjs), so the backend — which
 * derives a tree's area from its band — reconstructs the workbook's tree units.
 * Retained/enhanced post-intervention trees reuse the baseline expansion (same
 * sub-refs, points and bands) so a tree keeps its identity across both files.
 */

import { expandEnvelope, gpkgPoint, placeholders } from '../gpkg-io/index.mjs'
import {
  SRS_ID,
  URBAN_TREES_INSERT_COLUMNS,
  registerLayer
} from '../bng-schema.mjs'
import { pickInteriorPoint } from '../geometry.mjs'
import {
  BASE_MAP,
  LOCATION_ON_SITE,
  RURAL_OR_URBAN_TREE_URBAN,
  SITE_NAME,
  SPATIAL_RISK_INSIDE_LPA,
  SURVEY_DATE,
  WORKBOOK_IMPORT_LABEL,
  WORKBOOK_SURVEY_DETAILS
} from './workbook-layers-shared.mjs'
import { decomposeAreaToTreeBands } from './tree-area-bands.mjs'
import { gpkgRetention } from '../retention.mjs'

const URBAN_TREES_SQL = `
  INSERT INTO "Urban Trees" (
    geometry, "Tree Ref", "Baseline Tree Size", "Baseline Condition",
    "Baseline Strategic Significance", "Baseline Tree Type",
    "Retention Category", "Category",
    "Proposed Tree Size", "Proposed Condition",
    "Proposed Strategic Significance", "Proposed Tree Type",
    "Location", "Habitat Created/Enhanced in advance/years",
    "Delay in starting habitat creation/enhancement in years",
    "Spatial risk category", "Site Name", "Survey Date",
    "Survey Details", "Comment", "Mapped by", "Company", "Base Map",
    "Count", "Baseline Rural or Urban Tree", "Proposed Rural or Urban Tree"
  ) VALUES (${placeholders(URBAN_TREES_INSERT_COLUMNS)})
`

// Each expanded point is a single tree of one size band.
const TREE_COUNT_DEFAULT = 1

// A sub-ref distinguishes the N points a single tree row expands into. A row
// that yields exactly one point keeps its original ref unchanged.
function treeSubRef(rowRef, bandIndex, bandCount) {
  return bandCount === 1 ? rowRef : `${rowRef}-${bandIndex + 1}`
}

/**
 * Expand one tree row (area → size bands) into per-point instances, each with
 * its own interior point, size band and sub-ref. `rowIndex` links the instance
 * back to its row so the writer can read the row's shared attributes.
 */
function expandTreeRow(boundaryRing, row, rowIndex) {
  const bands = decomposeAreaToTreeBands(row.area)
  return bands.map((band, bandIndex) => ({
    rowIndex,
    subRef: treeSubRef(row.ref, bandIndex, bands.length),
    band,
    point: pickInteriorPoint(boundaryRing)
  }))
}

export function generateBaselineTreePoints(boundaryRing, baselineRows) {
  const instances = []
  const byRef = new Map()
  for (let i = 0; i < baselineRows.length; i += 1) {
    const rowInstances = expandTreeRow(boundaryRing, baselineRows[i], i)
    instances.push(...rowInstances)
    byRef.set(baselineRows[i].baselineRef, rowInstances)
  }
  return { instances, byRef }
}

/**
 * Shared point-feature writer loop. Each per-mode writer supplies a
 * `bindings(row, instance)` function that maps to the INSERT placeholder order.
 * Instances whose point could not be placed (null) are skipped.
 */
function writePointFeatureLayer(db, sql, tableName, instances, rows, bindings) {
  const stmt = db.prepare(sql)
  const allEnvelope = [Infinity, -Infinity, Infinity, -Infinity]
  let written = 0
  for (const instance of instances) {
    if (!instance.point) {
      continue
    }
    const [x, y] = instance.point
    expandEnvelope(allEnvelope, [x, x, y, y])
    stmt.run(...bindings(rows[instance.rowIndex], instance))
    written += 1
  }
  registerLayer(db, tableName, 'POINT', written > 0 ? allEnvelope : null)
  return written
}

function treeBaselineBindings(r, instance) {
  const [x, y] = instance.point
  return [
    gpkgPoint(SRS_ID, x, y),
    instance.subRef,
    instance.band,
    r.condition,
    r.strategicSig,
    r.type,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    SITE_NAME,
    SURVEY_DATE,
    WORKBOOK_SURVEY_DETAILS,
    null,
    WORKBOOK_IMPORT_LABEL,
    WORKBOOK_IMPORT_LABEL,
    BASE_MAP,
    TREE_COUNT_DEFAULT,
    RURAL_OR_URBAN_TREE_URBAN,
    null
  ]
}

function treePostBindings(r, instance) {
  const [x, y] = instance.point
  return [
    gpkgPoint(SRS_ID, x, y),
    instance.subRef,
    instance.baselineBand,
    r.baseline?.condition ?? null,
    r.baseline?.strategicSig ?? null,
    r.baseline?.type ?? null,
    gpkgRetention(r.retention),
    gpkgRetention(r.retention) === 'Lost' ? 'Lost' : 'Retained',
    instance.proposedBand,
    r.proposed.condition,
    r.proposed.strategicSig,
    r.proposed.type,
    LOCATION_ON_SITE,
    String(r.proposed.advanceYears ?? 0),
    String(r.proposed.delayYears ?? 0),
    SPATIAL_RISK_INSIDE_LPA,
    SITE_NAME,
    SURVEY_DATE,
    WORKBOOK_SURVEY_DETAILS,
    null,
    WORKBOOK_IMPORT_LABEL,
    WORKBOOK_IMPORT_LABEL,
    BASE_MAP,
    TREE_COUNT_DEFAULT,
    r.baseline ? RURAL_OR_URBAN_TREE_URBAN : null,
    RURAL_OR_URBAN_TREE_URBAN
  ]
}

export function writeUrbanTreesBaseline(db, instances, rows) {
  return writePointFeatureLayer(
    db,
    URBAN_TREES_SQL,
    'Urban Trees',
    instances,
    rows,
    treeBaselineBindings
  )
}

/**
 * Derive post-intervention tree instances. Retained/enhanced rows reuse the
 * baseline expansion at the same baseline ref (same points, sub-refs and bands,
 * so the tree keeps its identity and size across files); Created rows expand
 * their own proposed area into fresh points.
 */
export function derivePostInterventionTreePoints(
  boundaryRing,
  baselinePointsByRef,
  postRows
) {
  const instances = []
  for (let i = 0; i < postRows.length; i += 1) {
    const r = postRows[i]
    if (r.retention === 'Created') {
      for (const inst of expandTreeRow(boundaryRing, r, i)) {
        instances.push({
          rowIndex: i,
          subRef: inst.subRef,
          baselineBand: null,
          proposedBand: inst.band,
          point: inst.point
        })
      }
    } else if (r.baselineRef && baselinePointsByRef.has(r.baselineRef)) {
      for (const base of baselinePointsByRef.get(r.baselineRef)) {
        instances.push({
          rowIndex: i,
          subRef: base.subRef,
          baselineBand: base.band,
          proposedBand: base.band,
          point: base.point
        })
      }
    }
    // else: baseline ref not present in geometry — emit nothing (writer skips).
  }
  return instances
}

export function writeUrbanTreesPostIntervention(db, instances, rows) {
  return writePointFeatureLayer(
    db,
    URBAN_TREES_SQL,
    'Urban Trees',
    instances,
    rows,
    treePostBindings
  )
}
