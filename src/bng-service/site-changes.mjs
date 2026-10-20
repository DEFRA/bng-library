/**
 * Changes a surveyor records with the template that are neither kept as
 * they were nor habitats that get worse:
 *
 * - A re-meandered watercourse: the copied line moved onto its new, longer
 *   route, so it keeps its link to the baseline, Enhanced by Realignment
 *   (template guide, Watercourses). Its Baseline Length stays the surveyed
 *   one.
 * - A watercourse that is only shorter: the copied line shortened, kept
 *   Retained, as the template guide records a shorter hedge. The service
 *   cannot measure part loss of a watercourse from the map, so it counts
 *   the stretch as continuing.
 * - Habitat Refs that repeat: a Retained parcel split into two parts that
 *   keep the parent's Habitat Ref, as a split leaves them until the refs are
 *   tidied (template guide, Part 6).
 *
 * Each is drawn with the site's chooser, so a seed gives the same site.
 */

import { carveAtAngle, pointInRing } from '../geometry.mjs'
import { areaSquareMetres, lengthMetres } from '../measure/index.mjs'
import {
  WATERCOURSE,
  baselineConditions,
  enhancementPairs
} from '../synthetic/valid-draws.mjs'
import { COMMENT, HABITAT_REF } from './site.mjs'
import {
  ADVANCE,
  RETAINED,
  RETENTION,
  ZERO_YEARS,
  drawnWatercourseBaseline,
  encroachmentOf,
  retainedPart,
  riverTypes,
  splitLine
} from './template-features.mjs'
import { LOW, NOT_APPLICABLE, YES, distinctiveness } from './vocabulary.mjs'

const ENHANCED = 'Enhanced'
const REALIGNMENT = 'Enhanced by Realignment'
const DELAY = 'Delay in starting habitat creation/years'
const IRREPLACEABLE = 'Irreplaceable Habitat'
const SQ_M_PER_HECTARE = 10_000
// A meander's bend sits off the straight line by this share of its length.
const MIN_BEND_SHARE = 0.25
const MAX_BEND_SHARE = 0.45
const BEND_TRIES = 6
const BEND_SHRINK = 0.7
// Chord angles tried before a parcel is left whole, as carveTargetArea tries.
const CARVE_TRIES = 8
// A shorter watercourse keeps this share of its surveyed length.
const MIN_KEPT_SHARE = 0.5
const MAX_KEPT_SHARE = 0.8
// A split parcel's first part takes this share of its area.
const MIN_SPLIT_SHARE = 0.35
const MAX_SPLIT_SHARE = 0.65
// The lineage flaws take the first Retained parcel, and one stays whole.
const MIN_RETAINED_PARCELS = 3

export const REALIGNED_WATERCOURSE_COMMENT =
  'Re-meandered: the channel moves onto a longer route'
export const SHORTER_WATERCOURSE_COMMENT =
  'Shorter: part of the stretch is culverted or filled'

/**
 * What each change is, held on the feature as `change` and never written,
 * so a test or a flaw can find the row.
 */
export const CHANGE = Object.freeze({
  realignedWatercourse: 'realigned-watercourse',
  shorterWatercourse: 'shorter-watercourse',
  repeatedRef: 'repeated-ref'
})

const hectares = (ring) =>
  areaSquareMetres({ type: 'Polygon', coordinates: [ring] }) / SQ_M_PER_HECTARE

/** A watercourse type that can be enhanced and has encroachment options. */
function enhanceableRiverTypes() {
  return riverTypes(
    (type) =>
      enhancementPairs(WATERCOURSE, type).length > 0 &&
      encroachmentOf(type).water.length > 0 &&
      encroachmentOf(type).riparian.length > 0
  )
}

/** Which side of the line through `a` and `b` the point `c` is on. */
function orientation(a, b, c) {
  return Math.sign(
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  )
}

/** Whether segments `p1`-`p2` and `q1`-`q2` cross each other. */
function segmentsCross(p1, p2, q1, q2) {
  return (
    orientation(p1, p2, q1) * orientation(p1, p2, q2) < 0 &&
    orientation(q1, q2, p1) * orientation(q1, q2, p2) < 0
  )
}

/**
 * Whether the segment `a`-`b` lies inside `ring`: both ends inside, and no
 * edge of the ring crossed, so it holds for a red line that is not convex.
 */
function segmentInsideRing(a, b, ring) {
  if (!pointInRing(a, ring) || !pointInRing(b, ring)) {
    return false
  }
  for (let i = 1; i < ring.length; i += 1) {
    if (segmentsCross(a, b, ring[i - 1], ring[i])) {
      return false
    }
  }
  return true
}

/**
 * The straight line `[start, end]` bent once to one side, both its legs
 * inside the red line, so the route is longer; null if no bend fits.
 */
function meander([start, end], ring, chooser) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const length = Math.hypot(dx, dy)
  const side = chooser.chance(0.5) ? 1 : -1
  let share = chooser.between(MIN_BEND_SHARE, MAX_BEND_SHARE)
  for (let attempt = 0; attempt < BEND_TRIES; attempt += 1) {
    const offset = side * share * length
    const bend = [
      (start[0] + end[0]) / 2 - (dy / length) * offset,
      (start[1] + end[1]) / 2 + (dx / length) * offset
    ]
    if (
      segmentInsideRing(start, bend, ring) &&
      segmentInsideRing(bend, end, ring)
    ) {
      return { type: 'LineString', coordinates: [start, bend, end] }
    }
    share *= BEND_SHRINK
  }
  return null
}

/** A watercourse drawn for the purpose and re-meandered. */
function realignedWatercourse(site, chooser) {
  const types = enhanceableRiverTypes()
  if (types.length === 0) {
    return
  }
  const type = chooser.pick(types)
  const options = encroachmentOf(type)
  const [from, to] = chooser.pick(enhancementPairs(WATERCOURSE, type))
  const water = chooser.pick(options.water)
  const riparian = chooser.pick(options.riparian)
  const parent = drawnWatercourseBaseline(site, chooser, 'realigned', {
    'Baseline River Type': type,
    'Baseline Condition': from,
    'Baseline Encroachment into Watercourse': water,
    'Baseline Encroachment into riparian zone': riparian
  })
  const route =
    parent &&
    meander(
      parent.geometry.coordinates,
      site.redline.geometry.coordinates[0],
      chooser
    )
  if (!route) {
    // No bend fits: take the baseline row back out, so the site holds no
    // watercourse lost unrecorded. The chooser's draws are spent either
    // way, so a seed still gives the same site.
    if (parent) {
      const { baseline } = site.layers.rivers
      baseline.splice(baseline.indexOf(parent), 1)
    }
    return
  }
  site.layers.rivers.postIntervention.push({
    geometry: route,
    parent,
    source: { index: parent.source.index, retention: ENHANCED },
    change: CHANGE.realignedWatercourse,
    values: {
      [HABITAT_REF]: parent.values[HABITAT_REF],
      [RETENTION]: ENHANCED,
      'Proposed River Type': type,
      'Proposed Distinctiveness': distinctiveness('rivers', type, true),
      'Proposed Condition': to,
      'Proposed Strategic Significance': LOW,
      // An enhancement that does not worsen encroachment keeps it.
      'Proposed Encroachment into Watercourse': water,
      'Proposed Encroachment into riparian zone': riparian,
      'Enhancement Type': REALIGNMENT,
      [ADVANCE]: ZERO_YEARS,
      [DELAY]: ZERO_YEARS,
      'Spatial risk category': NOT_APPLICABLE,
      Length: lengthMetres(route),
      [COMMENT]: REALIGNED_WATERCOURSE_COMMENT
    }
  })
}

/** A watercourse drawn for the purpose, kept Retained but shorter. */
function shorterWatercourse(site, chooser) {
  const types = riverTypes(
    (type) =>
      baselineConditions(WATERCOURSE, type).length > 0 &&
      encroachmentOf(type).water.length > 0 &&
      encroachmentOf(type).riparian.length > 0
  )
  if (types.length === 0) {
    return
  }
  const type = chooser.pick(types)
  const options = encroachmentOf(type)
  const water = chooser.pick(options.water)
  const riparian = chooser.pick(options.riparian)
  const parent = drawnWatercourseBaseline(site, chooser, 'shorter', {
    'Baseline River Type': type,
    'Baseline Condition': chooser.pick(baselineConditions(WATERCOURSE, type)),
    'Baseline Encroachment into Watercourse': water,
    'Baseline Encroachment into riparian zone': riparian
  })
  if (!parent) {
    return
  }
  const [kept] = splitLine(
    parent.geometry,
    chooser.between(MIN_KEPT_SHARE, MAX_KEPT_SHARE)
  )
  const part = retainedPart(parent, kept, parent.values[HABITAT_REF], {
    'Proposed River Type': type,
    'Proposed Distinctiveness': distinctiveness('rivers', type, true),
    'Proposed Condition': parent.values['Baseline Condition'],
    'Proposed Encroachment into Watercourse': water,
    'Proposed Encroachment into riparian zone': riparian,
    'Enhancement Type': NOT_APPLICABLE
  })
  part.values[COMMENT] = SHORTER_WATERCOURSE_COMMENT
  part.change = CHANGE.shorterWatercourse
  site.layers.rivers.postIntervention.push(part)
}

/**
 * A parcel's two parts, at a share of its area the chooser picks and the
 * first of up to CARVE_TRIES chord angles that splits it; null if none
 * does. The first angle is drawn before the share, as it always was.
 */
function carvedParts(ring, chooser) {
  let angle = chooser.between(0, Math.PI)
  const target =
    hectares(ring) *
    SQ_M_PER_HECTARE *
    chooser.between(MIN_SPLIT_SHARE, MAX_SPLIT_SHARE)
  for (let attempt = 0; attempt < CARVE_TRIES; attempt += 1) {
    const parts = carveAtAngle(ring, angle, target)
    if (parts) {
      return parts
    }
    angle = chooser.between(0, Math.PI)
  }
  return null
}

/**
 * A Retained parcel split into two parts that keep its Habitat Ref, as a
 * split leaves them until the refs are tidied. Not the first Retained
 * parcel, which the lineage flaws take, nor an irreplaceable one, nor one
 * that gets worse; only when another Retained parcel stays whole.
 */
function repeatedRefs(site, chooser) {
  const layer = site.layers.habitats
  const retained = layer.postIntervention.filter(
    (f) =>
      f.parent &&
      !f.worse &&
      f.values[RETENTION] === RETAINED &&
      f.parent.values[IRREPLACEABLE] !== YES
  )
  if (retained.length < MIN_RETAINED_PARCELS) {
    return
  }
  const [, feature] = retained
  const ring = feature.geometry.coordinates[0]
  const parts = carvedParts(ring, chooser)
  if (!parts) {
    return
  }
  const part = (piece) => ({
    ...feature,
    geometry: { type: 'Polygon', coordinates: [piece] },
    change: CHANGE.repeatedRef,
    values: { ...feature.values, Area: hectares(piece) }
  })
  layer.postIntervention.splice(
    layer.postIntervention.indexOf(feature),
    1,
    part(parts.piece),
    part(parts.rest)
  )
}

/**
 * Add the changes above. A layer in `emptyLayers`, which an empty-layer
 * flaw leaves with no rows, is left empty.
 *
 * @param {object} site
 * @param {ReturnType<import('./random.mjs').createChooser>} chooser
 * @param {Set<string>} [emptyLayers]
 */
export function addSiteChanges(site, chooser, emptyLayers = new Set()) {
  if (!emptyLayers.has('rivers')) {
    realignedWatercourse(site, chooser)
    shorterWatercourse(site, chooser)
  }
  if (!emptyLayers.has('habitats')) {
    repeatedRefs(site, chooser)
  }
}
