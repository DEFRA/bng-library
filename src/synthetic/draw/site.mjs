/**
 * Draw a whole synthetic site: the red line, then each layer's features with
 * their values. The result is plain data, written by the legacy writer
 * (`synthetic.mjs`) or built into a BNG Service site
 * (`bng-service/native/`), so both formats draw the same site from a seed.
 */

import { generateIrregularPolygon } from '../../geometry.mjs'
import {
  DEFAULT_TREE_COUNT,
  HEDGEROW_PER_PARCEL_RATIO,
  MIN_HEDGEROW_COUNT,
  MIN_RIVER_COUNT,
  RIVER_PER_PARCEL_RATIO,
  SYNTHETIC_RLB_RADIUS_M,
  TREE_PER_PARCEL_RATIO
} from '../synthetic-constants.mjs'
import { drawHabitats } from './area.mjs'
import { drawHedgerows, drawRivers } from './linear.mjs'
import { habitatPools } from './rules.mjs'
import { drawTrees } from './trees.mjs'

/**
 * Resolve the urban-tree count. An explicit `numTrees` is honoured as-is —
 * even below DEFAULT_TREE_COUNT, in which case the fixture simply covers
 * fewer size bands (a request for 0 yields an empty layer). When absent it
 * derives from the parcel count, floored at DEFAULT_TREE_COUNT. Negatives
 * are clamped to 0.
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

/**
 * The feature counts a plan draws: habitats, hedgerows, rivers and trees,
 * each 0 for an emptied layer. Exported so a caller pinning rows by position
 * (the BNG Service format pins its last tree) knows how many rows there will
 * be.
 */
export function computeLayerCounts(numParcels, emptyLayers, numTrees) {
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

/**
 * Draw a site from a plan: `{ numParcels, numTrees, emptyLayers,
 * attributeOverrides, habitatFilter, excludeOwnTypeCreation }` (see
 * `generateOne`). `excludeOwnTypeCreation`, which the BNG Service format sets,
 * keeps an area creation out of its parcel's own habitat type (see
 * `habitatPools`). Draws read the geometry module's random source; seed it
 * first for a reproducible site.
 *
 * @returns {{ ring: number[][], counts: object, habitats: object[] | null,
 *   hedgerows: object[] | null, rivers: object[] | null,
 *   trees: object[] | null }} an emptied layer is null
 */
export function drawSite(centre, plan) {
  const {
    numParcels,
    numTrees,
    emptyLayers = new Set(),
    attributeOverrides = {},
    habitatFilter,
    excludeOwnTypeCreation = false
  } = plan
  const counts = computeLayerCounts(numParcels, emptyLayers, numTrees)
  const [cx, cy] = centre
  const ring = generateIrregularPolygon(cx, cy, SYNTHETIC_RLB_RADIUS_M)
  const drawers = {
    habitats: () =>
      drawHabitats(
        ring,
        counts.numHabitats,
        attributeOverrides.habitats,
        habitatPools(habitatFilter, { excludeOwnTypeCreation })
      ),
    hedgerows: () =>
      drawHedgerows(ring, counts.numHedgerows, attributeOverrides.hedgerows),
    rivers: () => drawRivers(ring, counts.numRivers, attributeOverrides.rivers),
    trees: () => drawTrees(ring, counts.numTrees, attributeOverrides.trees)
  }
  const site = { ring, counts }
  for (const [key, draw] of Object.entries(drawers)) {
    site[key] = emptyLayers.has(key) ? null : draw()
  }
  return site
}
