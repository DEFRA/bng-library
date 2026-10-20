/**
 * Workbook-driven orchestration. Lays out the baseline geometry, optionally
 * derives the post-intervention pair, and returns write statistics for the
 * caller's banner. Lives in the package so the CLI and the web handler share
 * a single code path — only the surrounding file-management differs.
 */

import {
  createAllTables,
  createLayerStyles,
  openGeoPackage
} from './bng-schema.mjs'
import { clearFixedTimestamp, setFixedTimestamp } from './gpkg-io/index.mjs'
import { clearSeed, setSeed } from './geometry.mjs'
import { color, header, info, warn } from './log.mjs'
import {
  buildBaselineRows,
  buildPostInterventionRows
} from './workbook/workbook-rows.mjs'
import {
  MIN_GENERATED_AREA_SQ_M,
  computeWorkbookFixturePlan,
  derivePostInterventionHabitatCells,
  derivePostInterventionLinearCoords,
  derivePostInterventionTreePoints,
  generateBaselineHedgerowGeometry,
  generateBaselineRiverGeometry,
  generateBaselineTreePoints,
  drawPostHabitatSpatialRisks,
  partitionBaselineHabitats,
  redLineRingFromArea,
  writeHabitatsBaseline,
  writeHabitatsPostIntervention,
  writeHedgerowsBaseline,
  writeHedgerowsPostIntervention,
  writeRiversBaseline,
  writeRiversPostIntervention,
  writeRedLineBoundary,
  writeUrbanTreesBaseline,
  writeUrbanTreesPostIntervention
} from './workbook/workbook-layers.mjs'

export const MODE_BASELINE = 'baseline'
export const MODE_POST_INTERVENTION = 'post-intervention'
export const MODE_BOTH = 'both'
export const VALID_MODES = new Set([
  MODE_BASELINE,
  MODE_POST_INTERVENTION,
  MODE_BOTH
])

const IN_MEMORY_DB = ':memory:'
// Fixed metadata timestamp for seeded generation, as the synthetic route uses.
const DETERMINISTIC_TIMESTAMP = '2020-01-01T00:00:00.000Z'

/**
 * Draw the baseline geometry: the red line sized to the habitat area, the
 * habitat parcels, the linear feature routes and the tree positions.
 */
export function drawBaselineGeometry(baselineRows, plan, centre) {
  const [cx, cy] = centre
  const ring = redLineRingFromArea(cx, cy, plan.totalAreaM2)
  const habitats = partitionBaselineHabitats(ring, baselineRows.habitats)
  const hedgerows = generateBaselineHedgerowGeometry(
    ring,
    baselineRows.hedgerows
  )
  const rivers = generateBaselineRiverGeometry(ring, baselineRows.rivers)
  const trees = generateBaselineTreePoints(ring, baselineRows.trees)
  return {
    ring,
    habitatCells: habitats.cells,
    habitatCellsByRef: habitats.byRef,
    hedgeCoords: hedgerows.coordsList,
    hedgeCoordsByRef: hedgerows.byRef,
    riverCoords: rivers.coordsList,
    riverCoordsByRef: rivers.byRef,
    treeInstances: trees.instances,
    treePointsByRef: trees.byRef
  }
}

/**
 * Derive the post-intervention geometry from the baseline's, and draw the
 * spatial risk each parcel records.
 */
export function drawPostInterventionGeometry(workbook, postRows, baselineGeom) {
  const { ring } = baselineGeom
  const { cells: habitatCells, extraRows: sealedSurfaceRows } =
    derivePostInterventionHabitatCells(
      baselineGeom.habitatCellsByRef,
      workbook.habitats.baseline,
      postRows.habitats,
      postRows.warnings
    )
  // Sealed-surface parcels cover the leftover lost-area footprint so the
  // post-intervention file tessellates the redline like its baseline does.
  // They're appended after the workbook-derived rows; habitatCells already
  // carries their geometry in the same trailing positions.
  const habitatRows =
    sealedSurfaceRows.length > 0
      ? postRows.habitats.concat(sealedSurfaceRows)
      : postRows.habitats
  const spatialRisks = drawPostHabitatSpatialRisks(habitatCells)
  return {
    habitatCells,
    habitatRows,
    spatialRisks,
    hedgeCoords: derivePostInterventionLinearCoords(
      ring,
      baselineGeom.hedgeCoordsByRef,
      postRows.hedgerows
    ),
    riverCoords: derivePostInterventionLinearCoords(
      ring,
      baselineGeom.riverCoordsByRef,
      postRows.rivers
    ),
    treeInstances: derivePostInterventionTreePoints(
      ring,
      baselineGeom.treePointsByRef,
      postRows.trees
    )
  }
}

function writeBaselineGeometry(outPath, baselineRows, geom) {
  const db = openGeoPackage(outPath)
  createAllTables(db)
  writeRedLineBoundary(db, geom.ring)
  const written = {
    habitats: writeHabitatsBaseline(
      db,
      geom.habitatCells,
      baselineRows.habitats
    ),
    hedgerows: writeHedgerowsBaseline(
      db,
      geom.hedgeCoords,
      baselineRows.hedgerows
    ),
    rivers: writeRiversBaseline(db, geom.riverCoords, baselineRows.rivers),
    trees: writeUrbanTreesBaseline(db, geom.treeInstances, baselineRows.trees)
  }
  createLayerStyles(db)
  db.close()
  return written
}

function writePostInterventionGeometry(outPath, postRows, geom, ring, plan) {
  const db = openGeoPackage(outPath)
  createAllTables(db)
  writeRedLineBoundary(db, ring, plan.siteName)
  const written = {
    habitats: writeHabitatsPostIntervention(
      db,
      geom.habitatCells,
      geom.habitatRows,
      geom.spatialRisks
    ),
    hedgerows: writeHedgerowsPostIntervention(
      db,
      geom.hedgeCoords,
      postRows.hedgerows
    ),
    rivers: writeRiversPostIntervention(db, geom.riverCoords, postRows.rivers),
    trees: writeUrbanTreesPostIntervention(
      db,
      geom.treeInstances,
      postRows.trees
    )
  }
  createLayerStyles(db)
  db.close()
  return written
}

/**
 * Generate the baseline GeoPackage. Lays out the RLB, partitions habitats,
 * picks linear feature routes and tree positions. Returns the geometry it
 * produced so the post-intervention pass can derive from it.
 */
export function generateBaselineFile(
  outPath,
  _workbook,
  baselineRows,
  plan,
  centre
) {
  const geom = drawBaselineGeometry(baselineRows, plan, centre)
  return {
    ...geom,
    written: writeBaselineGeometry(outPath, baselineRows, geom)
  }
}

/**
 * Generate the post-intervention GeoPackage, reusing the baseline RLB and
 * deriving each layer's geometry from the baseline's.
 */
export function generatePostInterventionFile(
  outPath,
  workbook,
  postRows,
  baselineGeom,
  plan
) {
  const geom = drawPostInterventionGeometry(workbook, postRows, baselineGeom)
  return {
    written: writePostInterventionGeometry(
      outPath,
      postRows,
      geom,
      baselineGeom.ring,
      plan
    )
  }
}

function logWorkbookFixtureBanner({
  workbook,
  sourceLabel,
  centre,
  outPath,
  habitatRows,
  plan,
  mode
}) {
  header(`Generating BNG GeoPackage from workbook`, 'cyan')
  info(`  source: ${sourceLabel}`)
  info(
    `  site: ${plan.siteName} (${workbook.siteInfo.planningAuthority ?? 'unknown LPA'})`
  )
  info(`  mode: ${mode ?? MODE_BOTH}`)
  info(
    `  total area: ${plan.totalAreaHa.toFixed(4)} ha (${Math.round(plan.totalAreaM2)} m²)`
  )
  info(
    `  habitats: ${habitatRows.length} (${workbook.habitats.baseline.length} baseline, ` +
      `${workbook.habitats.created.length} created, ${workbook.habitats.enhancements.length} enhanced)`
  )
  info(
    `  hedgerows: ${workbook.hedgerows.baseline.length} baseline + ${workbook.hedgerows.created.length} created`
  )
  info(
    `  rivers: ${workbook.watercourses.baseline.length} baseline + ${workbook.watercourses.created.length} created`
  )
  info(
    `  trees: ${workbook.trees.baseline.length} baseline + ${workbook.trees.created.length} created`
  )
  info(`  centre: ${centre[0]},${centre[1]} (BNG)`)
  info(`  → ${outPath}`)
}

function logWorkbookFileSummary(label, written, outPath) {
  info(
    `  ${label}: ${written.habitats} habitats, ${written.hedgerows} hedgerows, ${written.rivers} rivers, ${written.trees} trees → ${outPath}`
  )
}

function surfaceWorkbookWarnings(workbook, baselineRows, postRows) {
  for (const w of workbook.summary.warnings) {
    warn(`  ${w}`)
  }
  for (const s of workbook.summary.skipped) {
    warn(`  skipped ${s.sheet}:${s.row} (${s.reason})`)
  }
  for (const r of baselineRows.skipReasons) {
    warn(`  ${r}`)
  }
  if (postRows) {
    for (const r of postRows.skipReasons) {
      warn(`  ${r}`)
    }
    for (const r of postRows.warnings) {
      warn(`  ${r}`)
    }
  }
}

function bannerOutPath(outPaths, mode) {
  if (mode === MODE_BOTH) {
    return `${outPaths.baseline} + ${outPaths.postIntervention}`
  }
  return outPaths.baseline ?? outPaths.postIntervention
}

/**
 * Top-level workbook → gpkg orchestration. Caller picks file paths. Returns
 * { success, plan } so the caller can decide what to do with the produced
 * files (e.g. read them back as buffers, attach to a zip, etc).
 *
 * When `mode === MODE_POST_INTERVENTION` the baseline pipeline still runs
 * — its geometry is the input to post-intervention derivation — but it
 * writes to an in-memory throwaway db, so only outPaths.postIntervention
 * is produced.
 *
 * `seed` (a 32-bit integer) makes the output reproducible: the same workbook
 * and seed give the same files to the byte. Omit it for fresh draws.
 */
export function generateFromWorkbook(
  outPaths,
  workbook,
  sourceLabel,
  { strict = false, centre, mode = MODE_BOTH, seed } = {}
) {
  const seeded = Number.isInteger(seed)
  if (seeded) {
    // Pin both randomness (tree positions and line midpoints) and the
    // metadata clock, so the same workbook and seed give the same bytes.
    setSeed(seed)
    setFixedTimestamp(DETERMINISTIC_TIMESTAMP)
  }
  try {
    return generateFromWorkbookInner(outPaths, workbook, sourceLabel, {
      strict,
      centre,
      mode
    })
  } finally {
    if (seeded) {
      clearSeed()
      clearFixedTimestamp()
    }
  }
}

function generateFromWorkbookInner(
  outPaths,
  workbook,
  sourceLabel,
  { strict, centre, mode }
) {
  const baselineRows = buildBaselineRows(workbook, { strict })
  const postRows =
    mode === MODE_BASELINE
      ? null
      : buildPostInterventionRows(workbook, { strict })

  const habitatRowsForSizing = baselineRows.habitats.map((r) => ({
    area: r.area
  }))
  const plan = computeWorkbookFixturePlan(workbook, habitatRowsForSizing)

  logWorkbookFixtureBanner({
    workbook,
    sourceLabel,
    centre,
    outPath: bannerOutPath(outPaths, mode),
    habitatRows: baselineRows.habitats,
    plan,
    mode
  })

  if (plan.totalAreaM2 < MIN_GENERATED_AREA_SQ_M) {
    warn(
      `  total area is < ${MIN_GENERATED_AREA_SQ_M} m² — workbook may be empty or unparseable; aborting`
    )
    return { success: false, plan }
  }

  const baselineDest =
    mode === MODE_POST_INTERVENTION ? IN_MEMORY_DB : outPaths.baseline
  const baselineGeom = generateBaselineFile(
    baselineDest,
    workbook,
    baselineRows,
    plan,
    centre
  )
  if (mode !== MODE_POST_INTERVENTION) {
    logWorkbookFileSummary('baseline', baselineGeom.written, outPaths.baseline)
  }

  if (mode !== MODE_BASELINE) {
    const postWritten = generatePostInterventionFile(
      outPaths.postIntervention,
      workbook,
      postRows,
      baselineGeom,
      plan
    )
    logWorkbookFileSummary(
      'post-intervention',
      postWritten.written,
      outPaths.postIntervention
    )
  }

  surfaceWorkbookWarnings(workbook, baselineRows, postRows)
  info(color('green', `✔ Done.`))
  return { success: true, plan }
}
