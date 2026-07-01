// Watercourse distinctiveness reference — river type → distinctiveness band.
//
// Vendored copy of bng-metric-engine's `watercourse-distinctiveness-categories`
// table. As with hedgerows, the backend derives a watercourse's band from its
// TYPE (not the GeoPackage distinctiveness column) when applying the High/V.High
// scope rejection, so the synthetic generator must pick river types from the
// in-scope subset of this table. Keep in sync with the engine reference.
export const watercourseDistinctivenessCategories = {
  'Priority habitat': 'V.High',
  'Other rivers and streams': 'High',
  Ditches: 'Medium',
  Canals: 'Medium',
  Culvert: 'Low'
}
