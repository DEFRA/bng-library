/**
 * Synthetic-mode GeoPackage generator, legacy layout. The site is drawn by
 * `draw/site.mjs` (geometry and values, as plain data) and written here as
 * Natural England rows: one file with all 5 feature layers. The --bad fixture
 * lives in `synthetic-bad.mjs`; pick-list constants and the precomputed
 * HABITATS table live in `synthetic-constants.mjs`.
 */

import { color, header, info } from '../log.mjs'
import {
  clearFixedTimestamp,
  envelopeFromCoords,
  expandEnvelope,
  gpkgLineString,
  gpkgPoint,
  gpkgPolygon,
  openGeoPackageReadonly,
  placeholders,
  setFixedTimestamp
} from '../gpkg-io/index.mjs'
import {
  HABITATS_INSERT_COLUMNS,
  HEDGEROWS_INSERT_COLUMNS,
  RIVERS_INSERT_COLUMNS,
  SRS_ID,
  URBAN_TREES_INSERT_COLUMNS,
  createAllTables,
  createLayerStyles,
  openGeoPackage,
  registerLayer
} from '../bng-schema.mjs'
import {
  clearSeed,
  linestringLength,
  polygonArea,
  setSeed
} from '../geometry.mjs'
import { generateOneBad } from './synthetic-bad.mjs'
import { EMPTYABLE_LAYERS } from './flaws.mjs'
import {
  baselineLinearAttribute,
  baselineLinearType,
  gpkgAreaRetention,
  treeCategory
} from '../retention.mjs'
import {
  BASE_MAP,
  HEDGEROW_DISTINCTIVENESS,
  MAPPED_BY,
  SITE_NAME,
  SURVEY_COMPANY,
  SURVEY_DATE,
  WATERCOURSE_DISTINCTIVENESS
} from './synthetic-constants.mjs'
import { computeLayerCounts, drawSite } from './draw/site.mjs'

export { computeLayerCounts } from './draw/site.mjs'
export { CREATED_TREE_INDEX } from './draw/trees.mjs'

// Fixed metadata timestamp used for seeded (reproducible) generation, so the
// gpkg_contents / layer_styles times don't reintroduce per-run byte differences.
const DETERMINISTIC_TIMESTAMP = '2020-01-01T00:00:00.000Z'

// ---------------------------------------------------------------------------
// The legacy writer: a drawn site (`draw/site.mjs`) as Natural England rows.
// ---------------------------------------------------------------------------

function writeRedLineBoundary(db, ring) {
  db.prepare(
    `INSERT INTO "Red Line Boundary" (geometry, "Area", "Site Name") VALUES (?, ?, ?)`
  ).run(gpkgPolygon(SRS_ID, ring), Math.round(polygonArea(ring)), SITE_NAME)
  registerLayer(db, 'Red Line Boundary', 'POLYGON', envelopeFromCoords(ring))
}

function envelopeOf(coordsList) {
  const envelope = [Infinity, -Infinity, Infinity, -Infinity]
  for (const coords of coordsList) {
    expandEnvelope(envelope, envelopeFromCoords(coords))
  }
  return coordsList.length > 0 ? envelope : null
}

const HABITATS_SQL_SYNTH = `
  INSERT INTO "Habitats" (
    geom, "Parcel Ref", "Baseline Broad Habitat Type", "Baseline Habitat Type",
    "Area", "Baseline Condition", "Baseline Strategic Significance",
    "Retention Category", "Proposed Broad Habitat Type", "Proposed Habitat Type",
    "Proposed Condition", "Proposed Strategic Significance",
    "Habitat created in advance/years", "Delay in starting habitat creation/years",
    "Spatial risk category", "Location", "Site Name", "Survey Date",
    "Survey Details", "Comment", "Mapped by", "Company", "Base Map",
    "Baseline Distinctiveness", "Proposed Distinctiveness"
  ) VALUES (${placeholders(HABITATS_INSERT_COLUMNS)})
`

function habitatRow(parcel) {
  return [
    gpkgPolygon(SRS_ID, parcel.ring),
    parcel.ref,
    parcel.baseline.broad,
    parcel.baseline.type,
    Math.round(polygonArea(parcel.ring)),
    parcel.baselineCondition,
    parcel.baselineSignificance,
    gpkgAreaRetention(parcel.retention),
    parcel.proposed.broad,
    parcel.proposed.type,
    parcel.proposedCondition,
    parcel.proposedSignificance,
    parcel.advanceYears,
    parcel.delayYears,
    parcel.spatialRisk,
    parcel.location,
    SITE_NAME,
    SURVEY_DATE,
    'Phase 1 habitat survey',
    null,
    MAPPED_BY,
    SURVEY_COMPANY,
    BASE_MAP,
    parcel.baseline.distinctiveness,
    parcel.proposed.distinctiveness
  ]
}

function writeHabitats(db, parcels) {
  const stmt = db.prepare(HABITATS_SQL_SYNTH)
  for (const parcel of parcels) {
    stmt.run(...habitatRow(parcel))
  }
  registerLayer(
    db,
    'Habitats',
    'POLYGON',
    envelopeOf(parcels.map((p) => p.ring))
  )
}

const HEDGEROWS_SQL_SYNTH = `
  INSERT INTO "Hedgerows" (
    geom, "Parcel Ref", "Baseline Hedge Type", "Baseline Condition",
    "Baseline Strategic Significance", "Retention Category",
    "Proposed Hedge Type", "Proposed Condition", "Proposed Strategic Significance",
    "Length", "Habitat created in advance/years",
    "Delay in starting habitat creation/years", "Spatial risk category",
    "Location", "Site Name", "Survey Date", "Survey Details", "Comments",
    "Mapped by", "Company", "Base Map",
    "Baseline Distinctiveness", "Proposed Distinctiveness"
  ) VALUES (${placeholders(HEDGEROWS_INSERT_COLUMNS)})
`

// The distinctiveness columns are stamped with the band each type implies. A
// created hedgerow has no baseline: the baseline columns fall back to the
// template's "To be created" / "N/A" placeholders.
function hedgerowRow(hedge) {
  const { retention } = hedge
  return [
    gpkgLineString(SRS_ID, hedge.coords),
    hedge.ref,
    baselineLinearType(retention, hedge.type),
    baselineLinearAttribute(retention, hedge.baselineCondition),
    baselineLinearAttribute(retention, hedge.baselineSignificance),
    retention,
    hedge.proposedType,
    hedge.proposedCondition,
    hedge.proposedSignificance,
    linestringLength(hedge.coords),
    hedge.advanceYears,
    hedge.delayYears,
    hedge.spatialRisk,
    hedge.location,
    SITE_NAME,
    SURVEY_DATE,
    'Hedgerow survey',
    null,
    MAPPED_BY,
    SURVEY_COMPANY,
    BASE_MAP,
    baselineLinearAttribute(retention, HEDGEROW_DISTINCTIVENESS[hedge.type]),
    HEDGEROW_DISTINCTIVENESS[hedge.proposedType]
  ]
}

const RIVERS_SQL_SYNTH = `
  INSERT INTO "Rivers" (
    geom, "Parcel Ref", "Baseline River Type", "Baseline Condition",
    "Baseline Strategic Significance",
    "Baseline Encroachment into Watercourse",
    "Baseline Encroachment into riparian zone",
    "Retention Category", "Proposed River Type", "Proposed Condition",
    "Proposed Strategic Significance", "Length",
    "Habitat created in advance/years",
    "Delay in starting habitat creation/years",
    "Spatial risk category", "Location",
    "Proposed Encroachment into Watercourse",
    "Proposed Encroachment into riparian zone",
    "Site Name", "Survey Date", "Survey Details", "Comments",
    "Mapped by", "Company", "Base Map",
    "Enhancement Type", "Baseline Distinctiveness", "Proposed Distinctiveness"
  ) VALUES (${placeholders(RIVERS_INSERT_COLUMNS)})
`

function riverRow(river) {
  const { retention } = river
  return [
    gpkgLineString(SRS_ID, river.coords),
    river.ref,
    baselineLinearType(retention, river.type),
    baselineLinearAttribute(retention, river.baselineCondition),
    baselineLinearAttribute(retention, river.baselineSignificance),
    baselineLinearAttribute(retention, river.baselineEncroachment.water),
    baselineLinearAttribute(retention, river.baselineEncroachment.riparian),
    retention,
    river.proposedType,
    river.proposedCondition,
    river.proposedSignificance,
    linestringLength(river.coords),
    river.advanceYears,
    river.delayYears,
    river.spatialRisk,
    river.location,
    river.proposedEncroachment.water,
    river.proposedEncroachment.riparian,
    SITE_NAME,
    SURVEY_DATE,
    'River corridor survey',
    null,
    MAPPED_BY,
    SURVEY_COMPANY,
    BASE_MAP,
    null,
    baselineLinearAttribute(retention, WATERCOURSE_DISTINCTIVENESS[river.type]),
    WATERCOURSE_DISTINCTIVENESS[river.proposedType]
  ]
}

function writeLines(db, tableName, sql, features, toRow) {
  const stmt = db.prepare(sql)
  for (const feature of features) {
    stmt.run(...toRow(feature))
  }
  registerLayer(
    db,
    tableName,
    'LINESTRING',
    envelopeOf(features.map((f) => f.coords))
  )
}

const URBAN_TREES_SQL_SYNTH = `
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

// Despite its name, the "Urban Trees" layer (a fixed name from the NE
// template) holds ALL individual trees, Urban and Rural. A created tree
// writes Created straight through, with Category "Newly Planted" and every
// baseline column "N/A".
function treeRow(tree) {
  const { retention } = tree
  const [x, y] = tree.point
  return [
    gpkgPoint(SRS_ID, x, y),
    tree.ref,
    baselineLinearAttribute(retention, tree.size),
    baselineLinearAttribute(retention, tree.baselineCondition),
    baselineLinearAttribute(retention, tree.baselineSignificance),
    baselineLinearAttribute(retention, tree.type),
    retention,
    treeCategory(retention),
    tree.proposedSize,
    tree.proposedCondition,
    tree.proposedSignificance,
    tree.proposedType,
    tree.location,
    tree.advanceYears,
    tree.delayYears,
    tree.spatialRisk,
    SITE_NAME,
    SURVEY_DATE,
    'Tree survey',
    null,
    MAPPED_BY,
    SURVEY_COMPANY,
    BASE_MAP,
    tree.count,
    baselineLinearAttribute(retention, tree.ruralOrUrban),
    tree.ruralOrUrban
  ]
}

function writeTrees(db, trees) {
  const stmt = db.prepare(URBAN_TREES_SQL_SYNTH)
  for (const tree of trees) {
    stmt.run(...treeRow(tree))
  }
  registerLayer(
    db,
    'Urban Trees',
    'POINT',
    envelopeOf(trees.map((t) => [t.point]))
  )
}

function reportContents(outPath) {
  const verify = openGeoPackageReadonly(outPath)
  const layers = verify
    .prepare(
      "SELECT table_name FROM gpkg_contents WHERE data_type = 'features'"
    )
    .all()
  for (const layer of layers) {
    const count = verify
      .prepare(`SELECT COUNT(*) as n FROM "${layer.table_name}"`)
      .get()
    info(`  ${layer.table_name}: ${count.n} feature(s)`)
  }
  verify.close()
}

function logSyntheticBanner(outPath, centre, ctx) {
  const { counts, emptyLayers, attributeOverrides } = ctx
  const { numHabitats, numHedgerows, numRivers, numTrees } = counts
  header(`Generating BNG test GeoPackage`, 'cyan')
  info(`  ${SITE_NAME}`)
  info(
    `  ${numHabitats} habitat parcels, ${numHedgerows} hedgerows, ${numRivers} rivers, ${numTrees} urban trees`
  )
  if (emptyLayers.size > 0) {
    info(
      `  empty layers: ${[...emptyLayers].sort((a, b) => a.localeCompare(b)).join(', ')}`
    )
  }
  for (const [layer, perRow] of Object.entries(attributeOverrides)) {
    info(`  attribute overrides: ${layer} rows 0..${perRow.length - 1}`)
  }
  info(`  centre: ${centre[0]},${centre[1]} (BNG)`)
  info(`  → ${outPath}`)
}

// For an "empty" layer we want the table to exist with zero rows. We can't
// just call generateHabitats(0) — it would still emit one parcel covering the
// whole boundary. Instead, register the layer here with a null envelope and
// skip the matching generator in runLayerGenerators.
function registerEmptyLayers(db, emptyLayers) {
  for (const [key, { table, geom }] of Object.entries(EMPTYABLE_LAYERS)) {
    if (emptyLayers.has(key)) {
      registerLayer(db, table, geom, null)
    }
  }
}

function writeLayers(db, site) {
  if (site.habitats) {
    writeHabitats(db, site.habitats)
  }
  if (site.hedgerows) {
    writeLines(
      db,
      'Hedgerows',
      HEDGEROWS_SQL_SYNTH,
      site.hedgerows,
      hedgerowRow
    )
  }
  if (site.rivers) {
    writeLines(db, 'Rivers', RIVERS_SQL_SYNTH, site.rivers, riverRow)
  }
  if (site.trees) {
    writeTrees(db, site.trees)
  }
}

/**
 * Writes one synthetic GeoPackage at `outPath`. The plan controls the
 * fixture shape:
 *   numParcels           how many habitat parcels to partition
 *   numTrees             explicit urban-tree count (honoured as-is, incl. 0);
 *                        omitted → derived from numParcels
 *   geometricFlawNames   non-empty → routes to the bad-fixture builder;
 *                        the rest of the plan is ignored
 *   emptyLayers          Set of layer keys to leave empty (table is still
 *                        registered, just has zero rows)
 *   attributeOverrides   per-layer arrays of per-row overrides pinned on the
 *                        first N rows. Recognised layer keys: `habitats`,
 *                        `hedgerows`, `rivers`, `trees`. Any field left unset on a row
 *                        falls back to the random draw. Recognised fields:
 *                          all layers  retention, baselineCondition,
 *                                      proposedCondition,
 *                                      baselineStrategicSignificance,
 *                                      proposedStrategicSignificance,
 *                                      advanceYears, delayYears, incomplete
 *                          habitats    habitatFullName, proposedHabitatFullName,
 *                                      parcelRef
 *                          hedgerows   hedgeType, proposedHedgeType
 *                          hedgerows,  lengthRange — [min, max] metres; the
 *                          rivers      line is redrawn until it fits, so a
 *                                      scenario comparing units between
 *                                      lines is not at the mercy of lengths
 *                                      that otherwise vary ~40-fold
 *                          hedgerows,  sameLineAs — the ref of an earlier
 *                          rivers      feature in the layer ("HG001"),
 *                                      whose line the row takes as its own:
 *                                      a feature recreated in place of a
 *                                      lost one, the same length
 *                          rivers      riverType, proposedRiverType,
 *                                      baselineWaterEncroachment,
 *                                      proposedWaterEncroachment,
 *                                      baselineRiparianEncroachment,
 *                                      proposedRiparianEncroachment
 *                          trees       treeSize, treeType, ruralOrUrban —
 *                                      each pins both sides of the row (a
 *                                      Lost tree's proposed size and type
 *                                      stay random; a Created tree's
 *                                      baseline stays "N/A"); count — the
 *                                      "Count" column, the number of trees
 *                                      the point stands for (default 1)
 *                        `incomplete: true` blanks the row's proposed-side
 *                        condition, strategic-significance and encroachment
 *                        cells to model unfinished post-intervention data;
 *                        a field the row also overrides explicitly keeps its
 *                        pinned value.
 *                        Fields bound by a template invariant resolve as a
 *                        unit: naming either of advanceYears / delayYears
 *                        pins the pair; a proposed type differing from the
 *                        baseline excludes Retained from the retention draw;
 *                        an encroachment override steers the river-type draw
 *                        away from Culvert (and an explicit Culvert pinned
 *                        with a non-sentinel encroachment throws).
 *   habitatFilter        optional (fullName) => boolean, narrowing the area
 *                        habitats a random draw picks from (a pinned habitat
 *                        is never filtered). The BNG Service template format
 *                        passes the habitats its Area Habitats layers offer.
 *   seed                 optional 32-bit integer. When set, every random draw
 *                        (geometry and attributes) is drawn from a deterministic
 *                        sequence, so the same seed + plan yields a
 *                        byte-identical file. Omit for non-reproducible output.
 */
export function generateOne(outPath, centre, plan) {
  const {
    numParcels,
    numTrees,
    geometricFlawNames = [],
    emptyLayers = new Set(),
    attributeOverrides = {},
    habitatFilter,
    seed
  } = plan

  const seeded = Number.isInteger(seed)
  if (seeded) {
    // Pin both randomness and the metadata clock so the whole file — geometry,
    // attributes and gpkg_contents/layer_styles timestamps — is reproducible.
    setSeed(seed)
    setFixedTimestamp(DETERMINISTIC_TIMESTAMP)
  }
  try {
    generateOneInner(outPath, centre, {
      numParcels,
      numTrees,
      geometricFlawNames,
      emptyLayers,
      attributeOverrides,
      habitatFilter
    })
  } finally {
    if (seeded) {
      clearSeed()
      clearFixedTimestamp()
    }
  }
}

function generateOneInner(outPath, centre, plan) {
  const {
    numParcels,
    numTrees,
    geometricFlawNames,
    emptyLayers,
    attributeOverrides,
    habitatFilter
  } = plan

  if (geometricFlawNames.length > 0) {
    generateOneBad(outPath, centre, geometricFlawNames)
    return
  }

  const counts = computeLayerCounts(numParcels, emptyLayers, numTrees)
  logSyntheticBanner(outPath, centre, {
    counts,
    emptyLayers,
    attributeOverrides
  })

  const site = drawSite(centre, {
    numParcels,
    numTrees,
    emptyLayers,
    attributeOverrides,
    habitatFilter
  })
  const db = openGeoPackage(outPath)
  createAllTables(db)
  writeRedLineBoundary(db, site.ring)
  registerEmptyLayers(db, emptyLayers)
  writeLayers(db, site)
  createLayerStyles(db)
  db.close()

  reportContents(outPath)
  info(color('green', `✔ Done. ${outPath}`))
}
