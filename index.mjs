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

// Permutations: a declarative catalogue of BNG test scenarios and a buffer-out
// generator, so both the harness CLI and the prototype web form draw from one
// source. `derivePermutationSeed` is exported so a path-based caller reproduces
// the same seeded files the buffer API produces.
export {
  DEFAULT_SIZE as PERMUTATION_DEFAULT_SIZE,
  PURPOSES as PERMUTATION_PURPOSES,
  SCENARIOS as PERMUTATION_SCENARIOS,
  generatePermutations,
  scenarioPlan as permutationScenarioPlan
} from './src/permutations/generate.mjs'
export { derivePermutationSeed } from './src/permutations/seed.mjs'
// A scenario that lists `formats` is generated in those formats only: every
// consumer of PERMUTATION_SCENARIOS applies this, as generatePermutations does.
export { scenarioInFormat } from './src/permutations/catalogue.mjs'

// The BNG Service template format (BMD-1080): one GeoPackage holding both
// stages, in the template the service's users upload. Opt-in: every
// generator writes the legacy format unless asked for `format: 'bng-service'`.
// The template's schema and reference lists are copied in by
// scripts/sync-bng-service-template.mjs; `checkTemplateValues` checks a file
// against the template's own drop-downs.
export {
  CURRENT_TEMPLATE_VERSION,
  FORMAT_BNG_SERVICE,
  FORMAT_LEGACY,
  LAYERS as BNG_SERVICE_LAYERS,
  STAGE_BASELINE,
  STAGE_POST_INTERVENTION,
  VALID_FORMATS,
  VALID_STAGES,
  readVersionRecords,
  versionRecordText
} from './src/bng-service/schema.mjs'
export {
  TEMPLATE_DROP_DOWNS,
  TEMPLATE_SCHEMA,
  TEMPLATE_SOURCE
} from './src/bng-service/reference.mjs'
export { checkTemplateValues } from './src/bng-service/check-values.mjs'
// `checkLineage` checks how each post-intervention feature names its parent,
// reporting each problem by the lineage flaw that writes it.
export { checkLineage } from './src/bng-service/check-lineage.mjs'
export {
  generateBngServiceFromWorkbook,
  generateBngServiceSynthetic,
  writeBngServiceFromLegacy
} from './src/bng-service/generate.mjs'
export {
  BNG_SERVICE_FLAWS,
  BNG_SERVICE_FLAW_NAMES,
  CATEGORY_DEGRADE,
  CATEGORY_LINEAGE,
  CATEGORY_VERSION,
  LEGACY_ONLY_FLAWS
} from './src/bng-service/flaws.mjs'
