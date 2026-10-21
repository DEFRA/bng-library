/**
 * Link a stage's post-intervention features to their baseline parents, as
 * the template's own conversion tools do when a file holds the two stages
 * apart: by reference first ("H001a" is a part of "H001"), then by shape (a
 * post-intervention feature lies within its parent). The converter reads a
 * legacy pair this way, and the native workbook route its drawn pair.
 */

import { interiorPoint, pointInRing } from '../geometry.mjs'
import { HABITAT_REF } from './schema.mjs'
import {
  baselineFeature,
  hasPostIntervention,
  postInterventionFeature
} from './site-features.mjs'

const CREATED = 'Created'
const POINT_TOLERANCE_M = 1e-6

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
 * One layer from its baseline and post-intervention sources: each baseline
 * source a baseline feature, and each kept or created post-intervention
 * source linked to the baseline feature it lies within. A created hedgerow,
 * watercourse or tree has no parent.
 *
 * @param {string} layerKey
 * @param {object[]} baselineSources
 * @param {object[]} postSources
 * @param {{ uuidFor: Function, choose: Function }} options
 * @param {string} label  the layer as an error names it
 */
export function pairedLayer(
  layerKey,
  baselineSources,
  postSources,
  options,
  label
) {
  const layer = { baseline: [], postIntervention: [] }
  for (const source of baselineSources) {
    layer.baseline.push(baselineFeature(layerKey, source, options))
  }
  for (const source of postSources) {
    if (!source.geometry || !hasPostIntervention(layerKey, source.retention)) {
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
        `${label} ${source.ref}: no baseline feature holds this post-intervention feature`
      )
    }
    layer.postIntervention.push(
      postInterventionFeature(layerKey, source, parent, options.choose)
    )
  }
  return layer
}
