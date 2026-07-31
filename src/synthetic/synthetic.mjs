/**
 * Synthetic-mode GeoPackage generator. Produces a single file with all 5
 * feature layers, geometry sampled randomly inside a generated RLB. The
 * --bad fixture lives in `synthetic-bad.mjs`; pick-list constants and the
 * precomputed HABITATS table live in `synthetic-constants.mjs`.
 */

import { color, header, info } from '../log.mjs'
import {
  envelopeFromCoords,
  expandEnvelope,
  gpkgLineString,
  gpkgPoint,
  gpkgPolygon,
  openGeoPackageReadonly,
  placeholders
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
  generateIrregularPolygon,
  generateLinestring,
  lineInsideRing,
  linestringLength,
  partitionPolygon,
  pick,
  pickInteriorPoint,
  polygonArea,
  randInt
} from '../geometry.mjs'
import {
  FEATURE_REF_PAD,
  FEATURE_REF_PAD_CHAR
} from '../workbook/workbook-rows.mjs'
import { generateOneBad } from './synthetic-bad.mjs'
import { EMPTYABLE_LAYERS } from './flaws.mjs'
import {
  baselineLinearAttribute,
  baselineLinearType,
  gpkgAreaRetention,
  RETENTION_CREATED,
  treeCategory
} from '../retention.mjs'
import {
  BASE_MAP,
  CONDITIONS,
  CULVERT_ENCROACHMENT,
  CULVERT_TYPE,
  ENCROACHMENT_RIPARIAN,
  ENCROACHMENT_WATERCOURSE,
  HABITATS,
  HEDGEROW_DISTINCTIVENESS,
  IN_SCOPE_BROAD_HABITAT_TYPES,
  IN_SCOPE_HABITATS,
  IN_SCOPE_HABITATS_BY_BROAD,
  IN_SCOPE_HEDGE_TYPES,
  IN_SCOPE_RIVER_TYPES,
  HEDGE_CONDITIONS,
  HEDGEROW_PER_PARCEL_RATIO,
  LINE_FEATURE_REJECTION_BUDGET_FACTOR,
  LOCATIONS,
  MAPPED_BY,
  MIN_HEDGEROW_COUNT,
  MIN_RIVER_COUNT,
  DEFAULT_TREE_COUNT,
  RETENTION_CATEGORIES,
  RIVER_PER_PARCEL_RATIO,
  SITE_NAME,
  SPATIAL_RISK_HABITAT,
  SPATIAL_RISK_RIVER,
  STRATEGIC_SIGNIFICANCE,
  SURVEY_COMPANY,
  SURVEY_DATE,
  SYNTHETIC_RLB_RADIUS_M,
  TREE_PER_PARCEL_RATIO,
  TREE_TYPE_STREET,
  WATERCOURSE_DISTINCTIVENESS
} from './synthetic-constants.mjs'

// ---------------------------------------------------------------------------
// Tunables specific to synthetic-mode emission.
// ---------------------------------------------------------------------------

const MAX_CREATED_ADVANCE_YEARS = 5
const MAX_CREATED_DELAY_YEARS = 3
const MAX_HEDGE_ADVANCE_YEARS = 3
const MAX_HEDGE_DELAY_YEARS = 2
const MAX_RIVER_ADVANCE_YEARS = 3
const MAX_RIVER_DELAY_YEARS = 2
const TREE_COUNT_DEFAULT = 1
const ZERO_YEARS = '0'

// The first two rivers are deterministically seeded (culvert + non-culvert) to
// exercise both baseline watercourse branches; see `pickRiverType`.
const SEEDED_RIVER_COUNT = 2
// The next river (index 2, present once a fixture has three or more) is seeded
// Created, so any fixture large enough to reach it exercises the created
// watercourse branch without relying on the retention draw; see
// `pickRiverRetention`.
const CREATED_RIVER_INDEX = 2

// ---------------------------------------------------------------------------
// Synthetic generators
// ---------------------------------------------------------------------------

function generateRedLineBoundary(db, cx, cy, radius) {
  const ring = generateIrregularPolygon(cx, cy, radius)
  const geom = gpkgPolygon(SRS_ID, ring)
  const area = polygonArea(ring)

  db.prepare(
    `INSERT INTO "Red Line Boundary" (geometry, "Area", "Site Name") VALUES (?, ?, ?)`
  ).run(geom, Math.round(area), SITE_NAME)

  registerLayer(db, 'Red Line Boundary', 'POLYGON', envelopeFromCoords(ring))
  return ring
}

function syntheticRef(prefix, i) {
  return `${prefix}${String(i + 1).padStart(FEATURE_REF_PAD, FEATURE_REF_PAD_CHAR)}`
}

function pickProposedHabitat(baseline, retention) {
  if (retention === 'Retained') {
    return baseline
  }
  const proposedBroad =
    retention === 'Lost' ? pick(IN_SCOPE_BROAD_HABITAT_TYPES) : baseline.broad
  return pick(IN_SCOPE_HABITATS_BY_BROAD[proposedBroad])
}

function findHabitatByFullName(fullName) {
  const habitat = HABITATS.find((h) => h.fullName === fullName)
  if (!habitat) {
    throw new Error(
      `habitatFullName "${fullName}" not found in HABITATS reference data`
    )
  }
  return habitat
}

/**
 * Draw the advance/delay pair for a created feature. At most one of the two
 * is non-zero: the statutory metric (and the backend's
 * ADVANCE_AND_DELAY_BOTH_SET check) rejects a habitat carrying both, so a
 * random fixture must never produce the pair.
 */
function randomAdvanceDelay(maxAdvance, maxDelay) {
  if (randInt(0, 1) === 0) {
    return [String(randInt(0, maxAdvance)), ZERO_YEARS]
  }
  return [ZERO_YEARS, String(randInt(0, maxDelay))]
}

/**
 * Inserts one habitat row per partitioned parcel. `perRowOverrides[i]`,
 * if provided, pins column values on row i (currently `habitatFullName`,
 * `retention`, `parcelRef`, `advanceYears`, and `delayYears`); fields not
 * set there are randomised as normal. Used by attribute-override flaws.
 */
function generateHabitats(db, boundaryRing, numParcels, perRowOverrides) {
  const parcels = partitionPolygon(boundaryRing, numParcels)
  const stmt = db.prepare(`
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
  `)

  const allEnvelope = [Infinity, -Infinity, Infinity, -Infinity]
  for (let i = 0; i < parcels.length; i += 1) {
    const ring = parcels[i]
    expandEnvelope(allEnvelope, envelopeFromCoords(ring))
    const override = perRowOverrides?.[i]
    const baseline = override?.habitatFullName
      ? findHabitatByFullName(override.habitatFullName)
      : pick(IN_SCOPE_HABITATS)
    const retention = override?.retention ?? pick(RETENTION_CATEGORIES)
    const proposed = pickProposedHabitat(baseline, retention)
    const [advanceYears, delayYears] =
      retention === 'Created'
        ? randomAdvanceDelay(MAX_CREATED_ADVANCE_YEARS, MAX_CREATED_DELAY_YEARS)
        : [ZERO_YEARS, ZERO_YEARS]
    stmt.run(
      gpkgPolygon(SRS_ID, ring),
      override?.parcelRef ?? syntheticRef('H', i),
      baseline.broad,
      baseline.type,
      Math.round(polygonArea(ring)),
      pick(baseline.validConditions),
      pick(STRATEGIC_SIGNIFICANCE),
      gpkgAreaRetention(retention),
      proposed.broad,
      proposed.type,
      pick(proposed.validConditions),
      pick(STRATEGIC_SIGNIFICANCE),
      override?.advanceYears ?? advanceYears,
      override?.delayYears ?? delayYears,
      pick(SPATIAL_RISK_HABITAT),
      pick(LOCATIONS),
      SITE_NAME,
      SURVEY_DATE,
      'Phase 1 habitat survey',
      null,
      MAPPED_BY,
      SURVEY_COMPANY,
      BASE_MAP,
      baseline.distinctiveness,
      proposed.distinctiveness
    )
  }
  registerLayer(
    db,
    'Habitats',
    'POLYGON',
    parcels.length > 0 ? allEnvelope : null
  )
}

/**
 * Shared rejection-sampling driver for the synthetic line-feature layers.
 * Picks linestrings via `generateLinestring`, rejects any whose vertices
 * fall outside the boundary, and inserts up to `count` accepted features.
 */
function generateLineFeatures(
  db,
  boundaryRing,
  count,
  { tableName, sql, buildRow }
) {
  const stmt = db.prepare(sql)
  const allEnvelope = [Infinity, -Infinity, Infinity, -Infinity]
  let produced = 0
  let attempts = 0
  const maxAttempts = count * LINE_FEATURE_REJECTION_BUDGET_FACTOR
  while (produced < count && attempts < maxAttempts) {
    attempts += 1
    const coords = generateLinestring(boundaryRing)
    if (coords && lineInsideRing(coords, boundaryRing)) {
      expandEnvelope(allEnvelope, envelopeFromCoords(coords))
      stmt.run(...buildRow(coords, produced))
      produced += 1
    }
  }
  registerLayer(db, tableName, 'LINESTRING', produced > 0 ? allEnvelope : null)
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

function generateHedgerows(db, boundaryRing, count) {
  generateLineFeatures(db, boundaryRing, count, {
    tableName: 'Hedgerows',
    sql: HEDGEROWS_SQL_SYNTH,
    buildRow: (coords, i) => {
      const hedgeType = pick(IN_SCOPE_HEDGE_TYPES)
      const retention = pick(RETENTION_CATEGORIES)
      // A lost hedgerow's proposed type is drawn afresh, so it must also stay
      // in scope. The distinctiveness columns are stamped with the band each
      // chosen type actually implies (the backend derives the band from the
      // type, not from these columns). A created hedgerow has no baseline: the
      // drawn type describes what is being planted, and the baseline columns
      // fall back to the template's "To be created" / "N/A" placeholders.
      const proposedHedgeType =
        retention === 'Lost' ? pick(IN_SCOPE_HEDGE_TYPES) : hedgeType
      const [advanceYears, delayYears] =
        retention === 'Created'
          ? randomAdvanceDelay(MAX_HEDGE_ADVANCE_YEARS, MAX_HEDGE_DELAY_YEARS)
          : [ZERO_YEARS, ZERO_YEARS]
      return [
        gpkgLineString(SRS_ID, coords),
        syntheticRef('HG', i),
        baselineLinearType(retention, hedgeType),
        baselineLinearAttribute(retention, pick(HEDGE_CONDITIONS)),
        baselineLinearAttribute(retention, pick(STRATEGIC_SIGNIFICANCE)),
        retention,
        proposedHedgeType,
        pick(HEDGE_CONDITIONS),
        pick(STRATEGIC_SIGNIFICANCE),
        linestringLength(coords),
        advanceYears,
        delayYears,
        pick(SPATIAL_RISK_HABITAT),
        pick(LOCATIONS),
        SITE_NAME,
        SURVEY_DATE,
        'Hedgerow survey',
        null,
        MAPPED_BY,
        SURVEY_COMPANY,
        BASE_MAP,
        baselineLinearAttribute(retention, HEDGEROW_DISTINCTIVENESS[hedgeType]),
        HEDGEROW_DISTINCTIVENESS[proposedHedgeType]
      ]
    }
  })
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

// In-scope river types excluding culverts, used to seed the non-culvert row.
const NON_CULVERT_IN_SCOPE_RIVER_TYPES = IN_SCOPE_RIVER_TYPES.filter(
  (type) => type !== CULVERT_TYPE
)

// Guarantee both watercourse dropdown branches are represented: the
// first river is always a Culvert and the second a non-culvert, so any file
// with at least two rivers exercises the culvert and non-culvert cases.
// Remaining rivers are random.
function pickRiverType(index) {
  if (index === 0) {
    return CULVERT_TYPE
  }
  if (index === 1) {
    return pick(NON_CULVERT_IN_SCOPE_RIVER_TYPES)
  }
  return pick(IN_SCOPE_RIVER_TYPES)
}

// The seeded culvert and non-culvert rows exist to exercise their baseline
// dropdown branches, so they must carry a real baseline. A Created watercourse
// has none — it blanks the baseline type to "To be created" and every baseline
// attribute (including the "N/A - Culvert" encroachment sentinel) to "N/A" —
// so the seeded rows draw retention from the baseline-bearing categories only.
const RETENTION_WITH_BASELINE = RETENTION_CATEGORIES.filter(
  (retention) => retention !== RETENTION_CREATED
)

function pickRiverRetention(index) {
  if (index < SEEDED_RIVER_COUNT) {
    return pick(RETENTION_WITH_BASELINE)
  }
  if (index === CREATED_RIVER_INDEX) {
    return RETENTION_CREATED
  }
  return pick(RETENTION_CATEGORIES)
}

// Encroachment does not apply to a culvert: both columns take the fixed
// "N/A - Culvert" category. Non-culverts draw a random degree, and baseline vs
// proposed are resolved independently so they can differ (as before).
function riverEncroachment(riverType) {
  if (riverType === CULVERT_TYPE) {
    return { water: CULVERT_ENCROACHMENT, riparian: CULVERT_ENCROACHMENT }
  }
  return {
    water: pick(ENCROACHMENT_WATERCOURSE),
    riparian: pick(ENCROACHMENT_RIPARIAN)
  }
}

function generateRivers(db, boundaryRing, count) {
  generateLineFeatures(db, boundaryRing, count, {
    tableName: 'Rivers',
    sql: RIVERS_SQL_SYNTH,
    buildRow: (coords, i) => {
      const riverType = pickRiverType(i)
      const retention = pickRiverRetention(i)
      // Unlike a hedgerow, a watercourse keeps its baseline type through the
      // intervention: both encroachment columns and the distinctiveness band
      // are derived from the type, and the encroachment sentinel must stay
      // culvert-valued on exactly the culvert rows.
      const baselineEncroachment = riverEncroachment(riverType)
      const proposedEncroachment = riverEncroachment(riverType)
      return [
        gpkgLineString(SRS_ID, coords),
        syntheticRef('R', i),
        baselineLinearType(retention, riverType),
        baselineLinearAttribute(retention, pick(CONDITIONS)),
        baselineLinearAttribute(retention, pick(STRATEGIC_SIGNIFICANCE)),
        baselineLinearAttribute(retention, baselineEncroachment.water),
        baselineLinearAttribute(retention, baselineEncroachment.riparian),
        retention,
        riverType,
        pick(CONDITIONS),
        pick(STRATEGIC_SIGNIFICANCE),
        linestringLength(coords),
        retention === 'Created'
          ? String(randInt(0, MAX_RIVER_ADVANCE_YEARS))
          : ZERO_YEARS,
        retention === 'Created'
          ? String(randInt(0, MAX_RIVER_DELAY_YEARS))
          : ZERO_YEARS,
        pick(SPATIAL_RISK_RIVER),
        pick(LOCATIONS),
        proposedEncroachment.water,
        proposedEncroachment.riparian,
        SITE_NAME,
        SURVEY_DATE,
        'River corridor survey',
        null,
        MAPPED_BY,
        SURVEY_COMPANY,
        BASE_MAP,
        null,
        baselineLinearAttribute(
          retention,
          WATERCOURSE_DISTINCTIVENESS[riverType]
        ),
        WATERCOURSE_DISTINCTIVENESS[riverType]
      ]
    }
  })
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

const TREE_SIZES = ['Small', 'Medium', 'Large', 'Very large']
// The two individual-tree habitat types. Despite its name, the "Urban Trees"
// layer (a fixed name from the NE template) holds ALL individual trees — there
// is no separate rural layer — so it carries both 'Urban' and 'Rural' rows.
// Each row's type comes from the "Rural or Urban Tree" column, not the layer
// name, which is what the engine reads to classify a tree as urban or rural.
const TREE_RURAL_URBAN = ['Urban', 'Rural']
const TREE_TYPES = [
  TREE_TYPE_STREET,
  'Park/garden tree',
  'Woodland tree',
  'Hedgerow tree'
]

function generateUrbanTrees(db, boundaryRing, count) {
  const stmt = db.prepare(URBAN_TREES_SQL_SYNTH)
  const allEnvelope = [Infinity, -Infinity, Infinity, -Infinity]
  let produced = 0
  while (produced < count) {
    const point = pickInteriorPoint(boundaryRing)
    if (!point) {
      break
    }
    const [x, y] = point
    expandEnvelope(allEnvelope, [x, x, y, y])
    // Deterministically seed one tree of each size band before falling back to
    // random sizes, so a fixture covers all bands (incl. "Very large") as long
    // as it has at least TREE_SIZES.length trees. A smaller explicit count
    // simply covers the first few bands.
    const size =
      produced < TREE_SIZES.length ? TREE_SIZES[produced] : pick(TREE_SIZES)
    // Alternate urban/rural so both habitat types appear once there are at
    // least two trees (the engine keys area/units off this, not the layer).
    const ruralOrUrban = TREE_RURAL_URBAN[produced % TREE_RURAL_URBAN.length]
    const type = pick(TREE_TYPES)
    const retention = pick(['Retained', 'Enhanced', 'Lost'])
    stmt.run(
      gpkgPoint(SRS_ID, x, y),
      syntheticRef('T', produced),
      baselineLinearAttribute(retention, size),
      baselineLinearAttribute(retention, pick(CONDITIONS)),
      baselineLinearAttribute(retention, pick(STRATEGIC_SIGNIFICANCE)),
      baselineLinearAttribute(retention, type),
      retention,
      treeCategory(retention),
      retention === 'Lost' ? pick(TREE_SIZES) : size,
      pick(CONDITIONS),
      pick(STRATEGIC_SIGNIFICANCE),
      retention === 'Lost' ? pick(TREE_TYPES) : type,
      pick(LOCATIONS),
      ZERO_YEARS,
      ZERO_YEARS,
      pick(SPATIAL_RISK_HABITAT),
      SITE_NAME,
      SURVEY_DATE,
      'Tree survey',
      null,
      MAPPED_BY,
      SURVEY_COMPANY,
      BASE_MAP,
      TREE_COUNT_DEFAULT,
      baselineLinearAttribute(retention, ruralOrUrban),
      ruralOrUrban
    )
    produced += 1
  }
  registerLayer(db, 'Urban Trees', 'POINT', produced > 0 ? allEnvelope : null)
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

/**
 * Generate one synthetic GeoPackage (default mode). Pass `bad=true` to emit
 * the intentionally-invalid fixture instead.
 */
/**
 * Resolve the urban-tree count. An explicit `numTrees` (e.g. from the
 * prototype's input box) is honoured as-is — even below DEFAULT_TREE_COUNT, in
 * which case the fixture simply covers fewer size bands (a request for 0
 * yields an empty layer). When absent it derives from the parcel count,
 * floored at DEFAULT_TREE_COUNT. Negatives are clamped to 0.
 */
function resolveTreeCount(numParcels, numTrees) {
  if (Number.isFinite(numTrees)) {
    return Math.max(0, Math.floor(numTrees))
  }
  return Math.max(
    DEFAULT_TREE_COUNT,
    Math.floor(numParcels / TREE_PER_PARCEL_RATIO)
  )
}

function computeLayerCounts(numParcels, emptyLayers, numTrees) {
  const ifEmpty = (key, value) => (emptyLayers.has(key) ? 0 : value)
  return {
    numHabitats: ifEmpty('habitats', numParcels),
    numHedgerows: ifEmpty(
      'hedgerows',
      Math.max(
        MIN_HEDGEROW_COUNT,
        Math.floor(numParcels / HEDGEROW_PER_PARCEL_RATIO)
      )
    ),
    numRivers: ifEmpty(
      'rivers',
      Math.max(MIN_RIVER_COUNT, Math.floor(numParcels / RIVER_PER_PARCEL_RATIO))
    ),
    numTrees: ifEmpty('trees', resolveTreeCount(numParcels, numTrees))
  }
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

function runLayerGenerators(db, ring, ctx) {
  const { counts, emptyLayers, attributeOverrides } = ctx
  const generators = {
    habitats: () =>
      generateHabitats(
        db,
        ring,
        counts.numHabitats,
        attributeOverrides.habitats
      ),
    hedgerows: () => generateHedgerows(db, ring, counts.numHedgerows),
    rivers: () => generateRivers(db, ring, counts.numRivers),
    trees: () => generateUrbanTrees(db, ring, counts.numTrees)
  }
  for (const [key, generate] of Object.entries(generators)) {
    if (!emptyLayers.has(key)) {
      generate()
    }
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
 *   attributeOverrides   per-layer row data to pin on the first N rows
 */
export function generateOne(outPath, centre, plan) {
  const {
    numParcels,
    numTrees,
    geometricFlawNames = [],
    emptyLayers = new Set(),
    attributeOverrides = {}
  } = plan

  if (geometricFlawNames.length > 0) {
    generateOneBad(outPath, centre, geometricFlawNames)
    return
  }

  const counts = computeLayerCounts(numParcels, emptyLayers, numTrees)
  const ctx = { counts, emptyLayers, attributeOverrides }

  logSyntheticBanner(outPath, centre, ctx)

  const [cx, cy] = centre
  const db = openGeoPackage(outPath)
  createAllTables(db)

  const ring = generateRedLineBoundary(db, cx, cy, SYNTHETIC_RLB_RADIUS_M)
  registerEmptyLayers(db, emptyLayers)
  runLayerGenerators(db, ring, ctx)
  createLayerStyles(db)

  db.close()

  reportContents(outPath)
  info(color('green', `✔ Done. ${outPath}`))
}
