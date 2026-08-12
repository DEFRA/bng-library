/**
 * bng-library — BNG test GeoPackage generator.
 *
 * Two entry points for the common cases:
 *   generateSyntheticGpkg(opts)         — buffer-out, synthetic-mode
 *   generateFromWorkbookBuffer(opts)    — buffer-in/out, workbook-driven
 *
 * The path-based pipeline that powers both is also re-exported so callers
 * that already manage their own output paths can drive it directly.
 */

// Buffer-out wrappers + flaw introspection used by both the CLI and a host UI.
export {
  generateSyntheticGpkg,
  generateFromWorkbookBuffer,
  listFlaws
} from './src/api.mjs'

// Path-based orchestration — CLI uses these directly so it can stream output
// to the user's chosen --outdir without going through the temp-file dance.
export {
  MODE_BASELINE,
  MODE_POST_INTERVENTION,
  MODE_BOTH,
  VALID_MODES,
  generateBaselineFile,
  generatePostInterventionFile,
  generateFromWorkbook
} from './src/orchestration.mjs'

// Logger plumbing — buffer-API callers normally let `generateSyntheticGpkg` /
// `generateFromWorkbookBuffer` capture messages, but expose `captureMessages`
// for callers that want to drive the orchestration entry points directly.
export {
  FlawSelectionError,
  captureMessages,
  drainMessages,
  setMode
} from './src/log.mjs'

// Domain primitives the CLI still uses around the orchestration entry points
// (centre defaulting, workbook --inspect, etc).
export { generateOne } from './src/synthetic/synthetic.mjs'
export { deriveBaselineFromSynthetic } from './src/synthetic/synthetic-baseline.mjs'
// Attribute vocabularies, so a caller building `generateOne`'s
// attributeOverrides can validate or draw from the same value sets the random
// generator uses. `ALL_HABITATS` is the full area-habitat vocabulary (each
// entry carries its distinctiveness band and valid conditions); the linear
// distinctiveness maps key a hedge/river type to its band.
export {
  ALL_HABITATS,
  CONDITIONS,
  CULVERT_TYPE,
  ENCROACHMENT_RIPARIAN,
  ENCROACHMENT_WATERCOURSE,
  HEDGEROW_DISTINCTIVENESS,
  HEDGE_CONDITIONS,
  IN_SCOPE_HEDGE_TYPES,
  IN_SCOPE_RIVER_TYPES,
  RETENTION_CATEGORIES,
  STRATEGIC_SIGNIFICANCE,
  WATERCOURSE_DISTINCTIVENESS
} from './src/synthetic/synthetic-constants.mjs'
export {
  ALL_FLAW_NAMES,
  CATEGORY_ATTRIBUTE,
  CATEGORY_EMPTY,
  CATEGORY_GEOMETRIC,
  FLAWS,
  resolveFlawSelection
} from './src/synthetic/flaws.mjs'
export {
  readMetricWorkbook,
  readMetricWorkbookFromBuffer
} from './src/workbook/metric-workbook.mjs'
export {
  FEATURE_REF_PAD,
  FEATURE_REF_PAD_CHAR,
  buildBaselineRows,
  buildPostInterventionRows
} from './src/workbook/workbook-rows.mjs'
