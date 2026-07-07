/**
 * Workbook-driven writers for the line-feature layers (Hedgerows + Rivers).
 *
 * Both layers share:
 *   - the same random linestring generator
 *   - the same baseline-line derivation (cursor walks consecutive segments)
 *   - the same loop shape via `writeLineFeatureLayer`
 *
 * Per-layer specifics (column order, default values) live in small
 * `*Bindings` helpers — Sonar's S4144 duplicate-bodies rule is satisfied
 * because the loop is shared.
 */

import {
  envelopeFromCoords,
  expandEnvelope,
  filledArray,
  gpkgLineString,
  placeholders
} from '../gpkg-io/index.mjs'
import {
  HEDGEROWS_INSERT_COLUMNS,
  RIVERS_INSERT_COLUMNS,
  SRS_ID,
  registerLayer
} from '../bng-schema.mjs'
import {
  linestringLength,
  pickInteriorPoint,
  pointInRing,
  polygonCentroid,
  randBetween,
  randInt,
  randomAngle
} from '../geometry.mjs'
import {
  BASE_MAP,
  LOCATION_ON_SITE,
  SITE_NAME,
  SPATIAL_RISK_INSIDE_LPA,
  SURVEY_DATE,
  WORKBOOK_IMPORT_LABEL,
  WORKBOOK_SURVEY_DETAILS
} from './workbook-layers-shared.mjs'
import {
  CULVERT_ENCROACHMENT,
  CULVERT_TYPE
} from '../data/watercourse-encroachment.mjs'
import { gpkgRetention } from '../retention.mjs'

// ---------------------------------------------------------------------------
// Tunables for the random linestring sampler.
// ---------------------------------------------------------------------------

const LINESTRING_DEFAULT_MAX_ATTEMPTS = 20
const LINESTRING_MIDPOINT_OFFSET_FRACTION = 0.05
const LINESTRING_MIDPOINT_EXTRA = 2
const MIN_SEGMENT_LENGTH_M = 0.5

// How many straight-line attempts to make before falling back to a folded
// path. A line that fits straight (the common case) is placed exactly as
// before; only lines too long to fit straight inside the now-compact boundary
// fold.
const STRAIGHT_ATTEMPTS_BEFORE_FOLD = 8

// Folded-path tunables. The boundary is no longer oversized to swallow the
// longest linear feature, so a long line is laid as a path that bends to stay
// inside it (hedgerows / rivers meander in reality). Because the boundary is
// convex, every leg between two interior vertices is itself fully interior, so
// the whole line is guaranteed inside the redline.
const FOLD_STEP_FRACTION = 0.4
const FOLD_MIN_STEP_M = 0.5
const FOLD_HEADING_TRIES = 12
// When a leg would leave the boundary, redirect back toward the interior
// (centroid) within ±this spread, then retry.
const FOLD_REDIRECT_SPREAD = Math.PI / 2
// Guard against runaway loops for pathological length-to-boundary ratios.
const FOLD_MAX_SEGMENTS = 256

/**
 * Generate a linestring with vertices inside `boundaryRing` whose total length
 * is approximately `targetLengthM`. Tries a straight line first (fast path,
 * unchanged behaviour); if the line is too long to fit straight, falls back to
 * a folded path that bends to stay inside the boundary.
 */
function generateLinestringOfLength(
  boundaryRing,
  targetLengthM,
  maxAttempts = LINESTRING_DEFAULT_MAX_ATTEMPTS
) {
  const straight = generateStraightLinestring(
    boundaryRing,
    targetLengthM,
    Math.min(maxAttempts, STRAIGHT_ATTEMPTS_BEFORE_FOLD)
  )
  if (straight) {
    return straight
  }
  return generateFoldedLinestring(boundaryRing, targetLengthM, maxAttempts)
}

/**
 * Straight(ish) linestring: random interior start, random direction, end point
 * laid `targetLengthM` along it, plus 1–2 lightly-offset midpoints. Retries if
 * any vertex falls outside the boundary; returns null if it never fits.
 */
function generateStraightLinestring(boundaryRing, targetLengthM, maxAttempts) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const start = pickInteriorPoint(boundaryRing)
    if (!start) {
      return null
    }
    const candidate = tryLinestringFromStart(start, targetLengthM, boundaryRing)
    if (candidate) {
      return candidate
    }
  }
  return null
}

/** Diagonal extent of a ring's bounding box — a cheap "diameter" proxy. */
function boundaryDiameter(ring) {
  const [minX, maxX, minY, maxY] = envelopeFromCoords(ring)
  return Math.hypot(maxX - minX, maxY - minY)
}

/**
 * Fold a path of total length `targetLengthM` inside the boundary. Walks in
 * legs capped at a fraction of the boundary diameter, redirecting toward the
 * interior whenever a leg would escape, until the full length is laid down.
 */
function generateFoldedLinestring(boundaryRing, targetLengthM, maxAttempts) {
  const centroid = polygonCentroid(boundaryRing)
  const maxStep = Math.max(
    FOLD_MIN_STEP_M,
    boundaryDiameter(boundaryRing) * FOLD_STEP_FRACTION
  )
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const start = pickInteriorPoint(boundaryRing)
    if (!start) {
      return null
    }
    const path = tryFoldedFromStart(
      boundaryRing,
      start,
      targetLengthM,
      maxStep,
      centroid
    )
    if (path) {
      return path
    }
  }
  return null
}

function tryFoldedFromStart(ring, start, targetLengthM, maxStep, centroid) {
  const points = [start]
  let cur = start
  let heading = randomAngle()
  let remaining = targetLengthM
  let segments = 0
  while (remaining > FOLD_MIN_STEP_M && segments < FOLD_MAX_SEGMENTS) {
    const len = Math.min(remaining, maxStep)
    const next = advanceInside(ring, cur, heading, len, centroid)
    if (!next) {
      return null
    }
    points.push(next.point)
    cur = next.point
    heading = next.heading
    remaining -= len
    segments += 1
  }
  return remaining <= FOLD_MIN_STEP_M && points.length >= 2 ? points : null
}

/**
 * Advance `len` metres from `from`. Continue along `heading` if that stays
 * inside the ring; otherwise aim back toward the interior (centroid) within a
 * spread and take the first heading that lands inside. Returns the new point +
 * heading, or null if no interior-bound leg of this length could be found.
 */
function advanceInside(ring, from, heading, len, centroid) {
  const straight = [
    from[0] + len * Math.cos(heading),
    from[1] + len * Math.sin(heading)
  ]
  if (pointInRing(straight, ring)) {
    return { point: straight, heading }
  }
  const toInterior = Math.atan2(centroid[1] - from[1], centroid[0] - from[0])
  for (let k = 0; k < FOLD_HEADING_TRIES; k += 1) {
    const h =
      toInterior + randBetween(-FOLD_REDIRECT_SPREAD, FOLD_REDIRECT_SPREAD)
    const point = [from[0] + len * Math.cos(h), from[1] + len * Math.sin(h)]
    if (pointInRing(point, ring)) {
      return { point, heading: h }
    }
  }
  return null
}

function tryLinestringFromStart(start, targetLengthM, boundaryRing) {
  const angle = randomAngle()
  const end = [
    start[0] + targetLengthM * Math.cos(angle),
    start[1] + targetLengthM * Math.sin(angle)
  ]
  if (!pointInRing(end, boundaryRing)) {
    return null
  }
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const px = -dy / targetLengthM
  const py = dx / targetLengthM
  const numMid = 1 + randInt(0, LINESTRING_MIDPOINT_EXTRA)
  const maxOffset = targetLengthM * LINESTRING_MIDPOINT_OFFSET_FRACTION
  const points = [start]
  for (let i = 1; i <= numMid; i += 1) {
    const t = i / (numMid + 1)
    const offset = randBetween(-maxOffset, maxOffset)
    const mid = [
      start[0] + dx * t + px * offset,
      start[1] + dy * t + py * offset
    ]
    if (!pointInRing(mid, boundaryRing)) {
      return null
    }
    points.push(mid)
  }
  points.push(end)
  return points
}

// ---------------------------------------------------------------------------
// Baseline-line slicing for the post-intervention derivation.
// ---------------------------------------------------------------------------

/**
 * Bucket baseline-derived post rows by baselineRef. Created rows are written
 * out directly with fresh geometry and don't appear in the returned groups.
 */
function bucketLinearPostRowsForDerivation(postRows, boundaryRing, out) {
  const groupsByBaseline = new Map()
  for (let i = 0; i < postRows.length; i += 1) {
    const r = postRows[i]
    if (r.retention === 'Created') {
      out[i] = generateLinestringOfLength(boundaryRing, r.lengthM)
    } else if (r.baselineRef) {
      if (!groupsByBaseline.has(r.baselineRef)) {
        groupsByBaseline.set(r.baselineRef, [])
      }
      groupsByBaseline.get(r.baselineRef).push({ row: r, postIndex: i })
    } else {
      // baseline-less, non-Created rows can't carry geometry — defensive no-op
    }
  }
  return groupsByBaseline
}

/**
 * Walk a cursor along `baseCoords` handing out consecutive segments to each
 * row in `group`, writing into `out`. Falls back to the full line when the
 * baseline is exhausted (length will read shorter but geometry won't overlap).
 */
function distributeBaselineLinestring(baseCoords, group, out) {
  const totalLen = linestringLength(baseCoords)
  let cursor = 0
  for (const { row, postIndex } of group) {
    if (totalLen === 0 || cursor >= totalLen) {
      out[postIndex] = baseCoords
    } else {
      const segment = sliceLinestringSegment(
        baseCoords,
        cursor,
        cursor + row.lengthM
      )
      out[postIndex] = segment ?? baseCoords
      cursor += row.lengthM
    }
  }
}

/**
 * Derive post-intervention linear coords (hedgerows / rivers) — reuses each
 * baseline linestring by walking a cursor along it and handing out
 * consecutive, non-overlapping segments to its post rows. No fresh sampling
 * for retained/enhanced rows; only Created rows generate fresh.
 */
export function derivePostInterventionLinearCoords(
  boundaryRing,
  baselineCoordsByRef,
  postRows
) {
  const out = filledArray(postRows.length)
  const groupsByBaseline = bucketLinearPostRowsForDerivation(
    postRows,
    boundaryRing,
    out
  )
  for (const [baselineRef, group] of groupsByBaseline) {
    const baseCoords = baselineCoordsByRef.get(baselineRef)
    if (baseCoords) {
      distributeBaselineLinestring(baseCoords, group, out)
    }
  }
  return out
}

/**
 * Return the sub-linestring between distances `startM` and `endM` along
 * `coords`. Walks vertex-to-vertex, interpolating on the segments that the
 * start and end points fall on.
 */
function sliceLinestringSegment(coords, startM, endM) {
  if (!coords || coords.length < 2 || endM <= startM) {
    return null
  }
  const totalLen = linestringLength(coords)
  const sStart = Math.max(0, Math.min(startM, totalLen))
  const sEnd = Math.max(sStart, Math.min(endM, totalLen))
  if (sEnd - sStart < MIN_SEGMENT_LENGTH_M) {
    return null
  }
  return walkLinestringSlice(coords, sStart, sEnd)
}

/** Interpolate the point at distance `target` along a segment descriptor. */
function interpOnSegment(segment, target) {
  const { a, dx, dy, seg, segStart } = segment
  const t = seg === 0 ? 0 : (target - segStart) / seg
  return [a[0] + dx * t, a[1] + dy * t]
}

function walkLinestringSlice(coords, sStart, sEnd) {
  const out = []
  let acc = 0
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1]
    const b = coords[i]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const seg = Math.hypot(dx, dy)
    const segment = { a, b, dx, dy, seg, segStart: acc, segEnd: acc + seg }
    const result = appendSliceSegment(out, segment, sStart, sEnd)
    if (result === SLICE_DONE) {
      return out
    }
    if (result === SLICE_BREAK) {
      break
    }
    acc += seg
  }
  return out.length >= 2 ? out : null
}

const SLICE_CONTINUE = 0
const SLICE_DONE = 1
const SLICE_BREAK = 2

/**
 * One iteration of walkLinestringSlice: emits the start interpolation, any
 * pass-through vertex, and the end interpolation. Returns a marker telling
 * the caller whether to keep walking, stop with the result, or break out.
 */
function appendSliceSegment(out, segment, sStart, sEnd) {
  const { b, segStart, segEnd } = segment
  if (segEnd < sStart) {
    return SLICE_CONTINUE
  }
  if (segStart > sEnd) {
    return SLICE_BREAK
  }
  if (out.length === 0) {
    out.push(interpOnSegment(segment, sStart))
  }
  if (segEnd >= sEnd) {
    out.push(interpOnSegment(segment, sEnd))
    return SLICE_DONE
  }
  out.push([b[0], b[1]])
  return SLICE_CONTINUE
}

// ---------------------------------------------------------------------------
// Shared writer loop. Each per-mode writer just supplies a bindings function.
// ---------------------------------------------------------------------------

function writeLineFeatureLayer(db, sql, tableName, coordsList, rows, bindings) {
  const stmt = db.prepare(sql)
  const allEnvelope = [Infinity, -Infinity, Infinity, -Infinity]
  let written = 0
  for (let i = 0; i < rows.length; i += 1) {
    const coords = coordsList[i]
    if (coords) {
      expandEnvelope(allEnvelope, envelopeFromCoords(coords))
      stmt.run(...bindings(rows[i], coords))
      written += 1
    }
  }
  registerLayer(db, tableName, 'LINESTRING', written > 0 ? allEnvelope : null)
  return written
}

// ---------------------------------------------------------------------------
// Hedgerows
// ---------------------------------------------------------------------------

const HEDGEROWS_SQL = `
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

export function generateBaselineHedgerowGeometry(boundaryRing, baselineRows) {
  return generateBaselineLineGeometry(boundaryRing, baselineRows)
}

function generateBaselineLineGeometry(boundaryRing, baselineRows) {
  const coordsList = []
  const byRef = new Map()
  for (const row of baselineRows) {
    const coords = generateLinestringOfLength(boundaryRing, row.lengthM)
    coordsList.push(coords)
    if (coords) {
      byRef.set(row.baselineRef, coords)
    }
  }
  return { coordsList, byRef }
}

function hedgerowBaselineBindings(r, coords) {
  return [
    gpkgLineString(SRS_ID, coords),
    r.ref,
    r.type,
    r.condition,
    r.strategicSig,
    null, // Retention Category
    null, // Proposed Hedge Type
    null, // Proposed Condition
    null, // Proposed Strategic Significance
    r.lengthM,
    null, // advance/years
    null, // delay/years
    null, // Spatial risk category
    null, // Location
    SITE_NAME,
    SURVEY_DATE,
    WORKBOOK_SURVEY_DETAILS,
    null, // Comments
    WORKBOOK_IMPORT_LABEL,
    WORKBOOK_IMPORT_LABEL,
    BASE_MAP,
    r.distinctiveness,
    null // Proposed Distinctiveness
  ]
}

function hedgerowPostBindings(r, coords) {
  return [
    gpkgLineString(SRS_ID, coords),
    r.ref,
    r.baseline?.type ?? null,
    r.baseline?.condition ?? null,
    r.baseline?.strategicSig ?? null,
    gpkgRetention(r.retention),
    r.proposed.type,
    r.proposed.condition,
    r.proposed.strategicSig,
    Math.round(linestringLength(coords)),
    String(r.proposed.advanceYears ?? 0),
    String(r.proposed.delayYears ?? 0),
    SPATIAL_RISK_INSIDE_LPA,
    LOCATION_ON_SITE,
    SITE_NAME,
    SURVEY_DATE,
    WORKBOOK_SURVEY_DETAILS,
    null,
    WORKBOOK_IMPORT_LABEL,
    WORKBOOK_IMPORT_LABEL,
    BASE_MAP,
    r.baseline?.distinctiveness ?? null,
    r.proposed.distinctiveness
  ]
}

export function writeHedgerowsBaseline(db, coordsList, rows) {
  return writeLineFeatureLayer(
    db,
    HEDGEROWS_SQL,
    'Hedgerows',
    coordsList,
    rows,
    hedgerowBaselineBindings
  )
}

export function writeHedgerowsPostIntervention(db, coordsList, rows) {
  return writeLineFeatureLayer(
    db,
    HEDGEROWS_SQL,
    'Hedgerows',
    coordsList,
    rows,
    hedgerowPostBindings
  )
}

// ---------------------------------------------------------------------------
// Rivers
// ---------------------------------------------------------------------------

const RIVERS_SQL = `
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

const RIVER_ENCROACHMENT_NONE = 'No Encroachment'
const RIVER_ENCROACHMENT_RIPARIAN_NONE = 'No Encroachment/No Encroachment'
const RIVER_SPATIAL_RISK_DEFAULT = 'Within waterbody catchment'

export function generateBaselineRiverGeometry(boundaryRing, baselineRows) {
  return generateBaselineLineGeometry(boundaryRing, baselineRows)
}

function riverBaselineBindings(r, coords) {
  // Prefer the real encroachment read from the workbook. Fall back to the
  // fixed "N/A - Culvert" category for culverts (the workbook stores that same
  // literal, so this only matters if the column was blank), and otherwise leave
  // it null — the backend treats blank as the default multiplier.
  const isCulvert = r.type === CULVERT_TYPE
  const baselineWaterEncroachment =
    r.waterEncroachment ?? (isCulvert ? CULVERT_ENCROACHMENT : null)
  const baselineRiparianEncroachment =
    r.riparianEncroachment ?? (isCulvert ? CULVERT_ENCROACHMENT : null)
  return [
    gpkgLineString(SRS_ID, coords),
    r.ref,
    r.type,
    r.condition,
    r.strategicSig,
    baselineWaterEncroachment,
    baselineRiparianEncroachment,
    null,
    null,
    null,
    null,
    r.lengthM,
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
    null,
    r.distinctiveness,
    null
  ]
}

function riverPostBindings(r, coords) {
  // Baseline side: prefer the real encroachment carried from the baseline
  // workbook row, then culvert-by-type, then the "No Encroachment" default.
  // Proposed side: the workbook does not carry a proposed encroachment, so keep
  // the culvert-by-type override over the "No Encroachment" default. Baseline
  // and proposed are resolved from their own type, since retention may change it.
  const baselineIsCulvert = r.baseline?.type === CULVERT_TYPE
  const proposedIsCulvert = r.proposed.type === CULVERT_TYPE
  const baselineWaterEncroachment =
    r.baseline?.waterEncroachment ??
    (baselineIsCulvert ? CULVERT_ENCROACHMENT : RIVER_ENCROACHMENT_NONE)
  const baselineRiparianEncroachment =
    r.baseline?.riparianEncroachment ??
    (baselineIsCulvert
      ? CULVERT_ENCROACHMENT
      : RIVER_ENCROACHMENT_RIPARIAN_NONE)
  const proposedWaterEncroachment = proposedIsCulvert
    ? CULVERT_ENCROACHMENT
    : RIVER_ENCROACHMENT_NONE
  const proposedRiparianEncroachment = proposedIsCulvert
    ? CULVERT_ENCROACHMENT
    : RIVER_ENCROACHMENT_RIPARIAN_NONE
  return [
    gpkgLineString(SRS_ID, coords),
    r.ref,
    r.baseline?.type ?? null,
    r.baseline?.condition ?? null,
    r.baseline?.strategicSig ?? null,
    baselineWaterEncroachment,
    baselineRiparianEncroachment,
    gpkgRetention(r.retention),
    r.proposed.type,
    r.proposed.condition,
    r.proposed.strategicSig,
    Math.round(linestringLength(coords)),
    String(r.proposed.advanceYears ?? 0),
    String(r.proposed.delayYears ?? 0),
    RIVER_SPATIAL_RISK_DEFAULT,
    LOCATION_ON_SITE,
    proposedWaterEncroachment,
    proposedRiparianEncroachment,
    SITE_NAME,
    SURVEY_DATE,
    WORKBOOK_SURVEY_DETAILS,
    null,
    WORKBOOK_IMPORT_LABEL,
    WORKBOOK_IMPORT_LABEL,
    BASE_MAP,
    null,
    r.baseline?.distinctiveness ?? null,
    r.proposed.distinctiveness
  ]
}

export function writeRiversBaseline(db, coordsList, rows) {
  return writeLineFeatureLayer(
    db,
    RIVERS_SQL,
    'Rivers',
    coordsList,
    rows,
    riverBaselineBindings
  )
}

export function writeRiversPostIntervention(db, coordsList, rows) {
  return writeLineFeatureLayer(
    db,
    RIVERS_SQL,
    'Rivers',
    coordsList,
    rows,
    riverPostBindings
  )
}
