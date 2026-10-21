// The 'bng-library/bng-service' subpath: what a consumer needs to READ a BNG
// Service template GeoPackage (BMD-1082) — the template's schema and reference
// lists, its table and column names, its version record, and the checks that
// read a file.
//
// Kept apart from the root entry point because that one also loads the
// workbook code, which needs `xlsx`: an optional peer dependency the service
// does not install. Nothing reachable from here may load it — the entry-point
// test walks the imports to hold that. The generators and flaw lists stay on
// the root entry point, for the tools that build test files.

export {
  BASELINE,
  CURRENT_TEMPLATE_VERSION,
  FEATURE_UUID,
  FORMAT_BNG_SERVICE,
  FORMAT_LEGACY,
  GEOMETRY_COLUMN,
  HABITAT_REF,
  LAYERS,
  PARENT_GEOM,
  PARENT_REF,
  PARENT_UUID,
  POST_INTERVENTION,
  RED_LINE_BOUNDARY,
  STAGE_BASELINE,
  STAGE_POST_INTERVENTION,
  VALID_FORMATS,
  VALID_STAGES,
  readVersionRecords,
  tableName,
  templateTable,
  versionRecordText
} from './schema.mjs'
export {
  TEMPLATE_DROP_DOWNS,
  TEMPLATE_SCHEMA,
  TEMPLATE_SOURCE
} from './reference.mjs'
export { checkTemplateValues } from './check-values.mjs'
export { UNREADABLE_GEOMETRY, checkLineage } from './check-lineage.mjs'
