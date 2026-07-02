/**
 * Decompose a workbook individual-tree area into a set of GeoPackage tree-size
 * bands.
 *
 * The metric workbook records individual trees by numeric area (itself an
 * aggregate of count × per-size RPA area), whereas the NE GeoPackage template
 * records each tree as a point carrying a text size band. The backend re-derives
 * a tree's area from that band, so to keep the workbook's tree units we emit one
 * point per band whose areas sum to ≈ the workbook area.
 *
 * Bands are discrete quanta (41 / 163 / 366 / 765 m²), so the reconstruction is
 * approximate — the residual is rounded to the nearest Small band, leaving the
 * total within ~half a Small band (~20 m²) of the input.
 */
import {
  SQ_METRES_PER_HECTARE,
  individualTreeAreaSquareMetres
} from '../data/metric-values-individual-tree-area.mjs'
import { TREE_SIZE_DEFAULT } from './workbook-layers-shared.mjs'

// Largest → smallest so the greedy fill uses as few points as possible.
const BANDS_LARGEST_FIRST = Object.entries(individualTreeAreaSquareMetres).sort(
  ([, a], [, b]) => b - a
)

const [SMALLEST_BAND_NAME, SMALLEST_BAND_AREA] =
  BANDS_LARGEST_FIRST[BANDS_LARGEST_FIRST.length - 1]

// Round the leftover up to one more Small tree once it exceeds half a Small
// band — nearest-quantum rounding of the residual.
const RESIDUAL_ROUNDING_THRESHOLD = SMALLEST_BAND_AREA / 2

/**
 * @param {number} areaHectares tree area from the workbook, in hectares
 * @returns {string[]} tree-size band names whose areas sum to ≈ the input area
 */
export function decomposeAreaToTreeBands(areaHectares) {
  if (!Number.isFinite(areaHectares) || areaHectares <= 0) {
    // No usable area (missing / zero) — fall back to a single default-size tree
    // so the tree still appears on the layer, matching the prior behaviour.
    return [TREE_SIZE_DEFAULT]
  }

  // Round to whole m² exactly as the backend does when deriving a tree's area,
  // both to match its arithmetic and to avoid float error (e.g. 0.0163 ha ×
  // 10000 = 162.9999…) pushing an exact single band just below its threshold.
  let remaining = Math.round(areaHectares * SQ_METRES_PER_HECTARE)
  const bands = []
  for (const [name, bandArea] of BANDS_LARGEST_FIRST) {
    const count = Math.floor(remaining / bandArea)
    for (let i = 0; i < count; i += 1) {
      bands.push(name)
    }
    remaining -= count * bandArea
  }

  if (remaining >= RESIDUAL_ROUNDING_THRESHOLD) {
    bands.push(SMALLEST_BAND_NAME)
  }
  // A positive area always yields at least one tree (its nearest band).
  if (bands.length === 0) {
    bands.push(SMALLEST_BAND_NAME)
  }
  return bands
}
