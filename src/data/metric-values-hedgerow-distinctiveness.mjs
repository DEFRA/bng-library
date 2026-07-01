// Hedgerow distinctiveness reference — hedge type → distinctiveness band.
//
// Vendored copy of bng-metric-engine's `hedgerow-distinctiveness-categories`
// table. The backend derives a hedgerow's band from its TYPE (not the
// GeoPackage distinctiveness column) when applying the High/V.High scope
// rejection, so the synthetic generator must pick hedge types from the
// in-scope subset of this table. Keep in sync with the engine reference.
//
// TODO(engine-move): when bng-metric-engine moves into this library (see
// docs/move-engine-into-bng-lib.md), delete this vendored copy and import the
// engine's canonical hedgerow-distinctiveness-categories table directly.
export const hedgerowDistinctivenessCategories = {
  'Species-rich native hedgerow with trees - associated with bank or ditch':
    'V.High',
  'Species-rich native hedgerow with trees': 'High',
  'Species-rich native hedgerow - associated with bank or ditch': 'High',
  'Native hedgerow with trees - associated with bank or ditch': 'High',
  'Species-rich native hedgerow': 'Medium',
  'Native hedgerow - associated with bank or ditch': 'Medium',
  'Native hedgerow with trees': 'Medium',
  'Ecologically valuable line of trees': 'Medium',
  'Ecologically valuable line of trees - associated with bank or ditch':
    'Medium',
  'Native hedgerow': 'Low',
  'Line of trees': 'Low',
  'Line of trees - associated with bank or ditch': 'Low',
  'Non-native and ornamental hedgerow': 'V.Low'
}
