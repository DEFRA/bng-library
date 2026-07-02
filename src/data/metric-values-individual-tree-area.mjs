// Individual-tree notional area per size band, in square metres.
//
// These are bng-metric-engine's per-size RPA areas (getIndividualTreeAreaHectares)
// converted to m² and rounded — i.e. exactly the values the backend derives when
// it maps a tree's "Tree Size" band to an area, and the same values the metric's
// own G-3 Multipliers "Tree size / Diameter / RPA" table produces. The
// workbook-driven generator decomposes a tree row's numeric area into a set of
// these bands so the backend re-derives an area close to the workbook's.
//
// TODO(engine-move): when bng-metric-engine moves into this library (see
// docs/move-engine-into-bng-lib.md), derive these from the engine's tree-area
// table directly instead of hard-coding them.
export const SQ_METRES_PER_HECTARE = 10_000

export const individualTreeAreaSquareMetres = {
  Small: 41,
  Medium: 163,
  Large: 366,
  'Very large': 765
}
