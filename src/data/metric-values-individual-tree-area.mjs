// Individual-tree notional area per size band, in square metres.
//
// Derived from the engine's per-size RPA areas, which are held in hectares —
// the same values the metric's G-3 Multipliers "Tree size / Diameter / RPA"
// table produces, and the same ones the backend derives when it maps a tree's
// "Tree Size" band to an area. The workbook-driven generator decomposes a tree
// row's numeric area into a set of these bands so the backend re-derives an
// area close to the workbook's.
//
// The bands are whole square metres, so the hectare -> m2 conversion is rounded
// to shed the floating-point residue (0.0041 * 10_000 is 41.000000000000007).
import { INDIVIDUAL_TREE_AREA_HECTARES } from '../metric/index.mjs'

export const SQ_METRES_PER_HECTARE = 10_000

export const individualTreeAreaSquareMetres = Object.freeze(
  Object.fromEntries(
    Object.entries(INDIVIDUAL_TREE_AREA_HECTARES).map(([band, hectares]) => [
      band,
      Math.round(hectares * SQ_METRES_PER_HECTARE)
    ])
  )
)
