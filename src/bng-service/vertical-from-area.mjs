/**
 * Move the vertical area habitats a legacy site holds as area habitats onto
 * the template's Vertical Area Habitats layers.
 *
 * The Statutory Metric lists green walls and artificial hard structures
 * among its area habitats, and the legacy template and the workbook route
 * map them as polygons. The BNG Service template maps the five habitats the
 * Metric counts by vertical area on their own layers, as a line along the
 * structure's base with the face area typed in, and the ground under the
 * structure on the Area Habitats layers (its section 1.5). So each such
 * polygon becomes:
 *
 * - on Area Habitats, the ground under it: Developed land; sealed surface,
 *   at the same ref, so the area habitats still tile the red line; and
 * - on Vertical Area Habitats, the structure: a line along the polygon's
 *   longest edge, with the polygon's area as its typed area.
 *
 * A post-intervention polygon follows its parent: a structure kept, enhanced
 * or replaced by another structure stays on the vertical layer, and one
 * replaced by a habitat on the ground leaves the vertical layer (removed)
 * while the ground is created as that habitat.
 */

import { warn } from '../log.mjs'
import { COMMENT, HABITAT_REF } from './schema.mjs'
import {
  LOW,
  NO,
  distinctiveness,
  irreplaceableAnswers,
  verticalHabitatNames
} from './vocabulary.mjs'

const SEALED_SURFACE = {
  broad: 'Urban',
  type: 'Developed land; sealed surface',
  condition: 'N/A - Other'
}
const RETAINED = 'Retained'
const CREATED = 'Created'
// Kept ground is Retained, so nothing is created in advance or late.
const KEPT_GROUND_TIMING = {
  'Habitat created in advance/years': '0',
  'Delay in starting habitat creation/years': '0'
}

const areaName = (values, side) =>
  `${values[`${side} Broad Habitat Type`]} - ${values[`${side} Habitat Type`]}`

let verticalNames = null
function isVertical(name) {
  verticalNames ??= new Set(verticalHabitatNames())
  return verticalNames.has(name)
}

/** The polygon's longest edge: the base of the structure it stood for. */
function longestEdge(geometry) {
  const ring = geometry.coordinates[0]
  let best = null
  for (let i = 1; i < ring.length; i += 1) {
    const length = Math.hypot(
      ring[i][0] - ring[i - 1][0],
      ring[i][1] - ring[i - 1][1]
    )
    if (!best || length > best.length) {
      best = { length, coordinates: [ring[i - 1], ring[i]] }
    }
  }
  return { type: 'LineString', coordinates: best.coordinates }
}

function singleIrreplaceable(type) {
  const answers = irreplaceableAnswers(type)
  return answers.size === 1 ? [...answers][0] : NO
}

const SEALED_BASELINE = () => ({
  'Baseline Broad Habitat Type': SEALED_SURFACE.broad,
  'Baseline Habitat Type': SEALED_SURFACE.type,
  'Baseline Distinctiveness': distinctiveness('habitats', SEALED_SURFACE.type),
  'Baseline Condition': SEALED_SURFACE.condition,
  'Irreplaceable Habitat': singleIrreplaceable(SEALED_SURFACE.type)
})

const SEALED_PROPOSED = () => ({
  'Proposed Broad Habitat Type': SEALED_SURFACE.broad,
  'Proposed Habitat Type': SEALED_SURFACE.type,
  'Proposed Distinctiveness': distinctiveness(
    'habitats',
    SEALED_SURFACE.type,
    true
  ),
  'Proposed Condition': SEALED_SURFACE.condition
})

function verticalBaseline(feature, uuid) {
  const type = feature.values['Baseline Habitat Type']
  return {
    geometry: longestEdge(feature.geometry),
    uuid,
    source: feature.source,
    values: {
      [HABITAT_REF]: feature.values[HABITAT_REF],
      'Baseline Broad Habitat Type':
        feature.values['Baseline Broad Habitat Type'],
      'Baseline Habitat Type': type,
      'Baseline Distinctiveness': distinctiveness('verticalHabitats', type),
      'Baseline Condition': feature.values['Baseline Condition'],
      'Baseline Strategic Significance': LOW,
      'Irreplaceable Habitat': singleIrreplaceable(type),
      Area: feature.values.Area,
      [COMMENT]: feature.values[COMMENT]
    }
  }
}

function verticalPostIntervention(feature, parent) {
  const type = feature.values['Proposed Habitat Type']
  return {
    geometry: parent?.geometry ?? longestEdge(feature.geometry),
    parent,
    source: feature.source,
    values: {
      ...feature.values,
      'Proposed Distinctiveness': distinctiveness(
        'verticalHabitats',
        type,
        true
      )
    }
  }
}

/**
 * Move every vertical area habitat in `site.layers.habitats` onto
 * `site.layers.verticalHabitats`, in place.
 *
 * @param {object} site
 * @param {(index: number) => string} uuidFor  the feature_uuid of the nth
 *   vertical habitat moved
 */
export function moveVerticalHabitats(site, uuidFor) {
  const area = site.layers.habitats
  const vertical = site.layers.verticalHabitats
  const moved = new Map()
  for (const feature of area.baseline) {
    if (isVertical(areaName(feature.values, 'Baseline'))) {
      const structure = verticalBaseline(feature, uuidFor(moved.size))
      moved.set(feature, structure)
      vertical.baseline.push(structure)
      Object.assign(feature.values, SEALED_BASELINE())
    }
  }
  for (const feature of area.postIntervention) {
    const structure = moved.get(feature.parent) ?? null
    if (!isVertical(areaName(feature.values, 'Proposed'))) {
      continue
    }
    if (!structure) {
      warn(
        `  ${feature.values[HABITAT_REF]}: a vertical area habitat created on ground that had none has no baseline structure; the template offers no proposed broad habitat type for it`
      )
    }
    vertical.postIntervention.push(verticalPostIntervention(feature, structure))
    // The ground under the structure: kept as sealed surface under a kept
    // structure, created as sealed surface under a new one.
    Object.assign(feature.values, SEALED_PROPOSED(), {
      'Retention Category': structure ? RETAINED : CREATED,
      'Proposed Strategic Significance': LOW,
      [COMMENT]: null,
      ...(structure ? KEPT_GROUND_TIMING : {})
    })
  }
}
