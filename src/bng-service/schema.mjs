/**
 * The BNG Service template's GeoPackage: its tables, written from the copy of
 * the template's schema in `template/schema.json`, and the record that names
 * the format and its version (BMD-1096, and the template's MAINTAINERS.md).
 */

import {
  initGeoPackage,
  openGeoPackage,
  registerLayer
} from '../gpkg-io/index.mjs'
import { currentTimestamp } from '../gpkg-io/src/clock.mjs'
import { BNG_SRS, SRS_ID } from '../bng-schema.mjs'
import { TEMPLATE_SCHEMA, TEMPLATE_SOURCE } from './reference.mjs'

export const FORMAT_LEGACY = 'legacy'
export const FORMAT_BNG_SERVICE = TEMPLATE_SOURCE.format
export const VALID_FORMATS = new Set([FORMAT_LEGACY, FORMAT_BNG_SERVICE])

/** The template version this copy of the template records. */
export const CURRENT_TEMPLATE_VERSION = TEMPLATE_SOURCE.version

export const STAGE_BASELINE = 'baseline'
export const STAGE_POST_INTERVENTION = 'post-intervention'
export const VALID_STAGES = new Set([STAGE_BASELINE, STAGE_POST_INTERVENTION])

export const RED_LINE_BOUNDARY = 'Red Line Boundary'
export const BASELINE = 'Baseline'
export const POST_INTERVENTION = 'Post-Intervention'

/** The five habitat types, keyed as the generators key their layers. */
export const LAYERS = Object.freeze({
  habitats: 'Area Habitats',
  verticalHabitats: 'Vertical Area Habitats',
  hedgerows: 'Hedgerows',
  rivers: 'Watercourses',
  trees: 'Individual Trees'
})

export const tableName = (layerKey, stage) => `${LAYERS[layerKey]} ${stage}`

export const GEOMETRY_COLUMN = 'geom'

// The columns that name a feature and its parent. Here rather than in
// site.mjs, which writes them, so a reader can have them without the writer.
export const HABITAT_REF = 'Habitat Ref'
export const PARENT_REF = 'Parent Ref'
export const FEATURE_UUID = 'feature_uuid'
export const PARENT_UUID = 'parent_uuid'
export const PARENT_GEOM = 'parent_geom'

const TABLES = new Map(TEMPLATE_SCHEMA.tables.map((t) => [t.name, t]))

/** A template table's description: geometry column and type, and columns. */
export function templateTable(name) {
  const table = TABLES.get(name)
  if (!table) {
    throw new Error(`The BNG Service template has no table "${name}"`)
  }
  return table
}

// The GeoPackage metadata extension, as the template's own file declares it.
const METADATA_EXTENSION = 'gpkg_metadata'
const METADATA_EXTENSION_URI =
  'http://www.geopackage.org/spec120/#extension_metadata'
const METADATA_SCOPE = 'dataset'
const REFERENCE_SCOPE = 'geopackage'

/** Open (or create) `outPath` as a GeoPackage with the BNG SRS. */
export function openTemplateGeoPackage(outPath) {
  return openGeoPackage(outPath, { srs: [BNG_SRS] })
}

export { initGeoPackage }

/**
 * Create every table the template's GeoPackage holds, with its columns in
 * the template's order and of the template's types, and register each as a
 * feature layer. `envelopes` maps a table to its extent; a table with none is
 * registered with a null extent, as an empty layer is.
 */
export function createTemplateTables(db, envelopes = new Map()) {
  for (const table of TEMPLATE_SCHEMA.tables) {
    const columns = table.columns.map((c) => `"${c.name}" ${c.type}`)
    db.exec(
      `CREATE TABLE "${table.name}" (` +
        `"fid" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, ` +
        `"${table.geometryColumn}" ${table.geometryType}` +
        (columns.length ? `, ${columns.join(', ')}` : '') +
        ')'
    )
    registerLayer(
      db,
      table.name,
      table.geometryType,
      envelopes.get(table.name) ?? null,
      SRS_ID,
      table.geometryColumn
    )
  }
}

/** The metadata text of a version record, spelled as the template spells it. */
export function versionRecordText(
  version = CURRENT_TEMPLATE_VERSION,
  format = FORMAT_BNG_SERVICE
) {
  return `{"format": ${JSON.stringify(format)}, "version": ${JSON.stringify(version)}}`
}

function createMetadataTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gpkg_extensions (
      table_name TEXT, column_name TEXT, extension_name TEXT NOT NULL,
      definition TEXT NOT NULL, scope TEXT NOT NULL,
      CONSTRAINT ge_tce UNIQUE (table_name, column_name, extension_name)
    );
    CREATE TABLE IF NOT EXISTS gpkg_metadata (
      id INTEGER CONSTRAINT m_pk PRIMARY KEY ASC NOT NULL,
      md_scope TEXT NOT NULL DEFAULT 'dataset',
      md_standard_uri TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'text/xml',
      metadata TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS gpkg_metadata_reference (
      reference_scope TEXT NOT NULL, table_name TEXT, column_name TEXT,
      row_id_value INTEGER,
      timestamp DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      md_file_id INTEGER NOT NULL, md_parent_id INTEGER,
      CONSTRAINT crmr_mfi_fk FOREIGN KEY (md_file_id) REFERENCES gpkg_metadata(id),
      CONSTRAINT crmr_mpi_fk FOREIGN KEY (md_parent_id) REFERENCES gpkg_metadata(id)
    );
  `)
  const extension = db.prepare(
    'INSERT OR IGNORE INTO gpkg_extensions VALUES (?, NULL, ?, ?, ?)'
  )
  for (const table of ['gpkg_metadata', 'gpkg_metadata_reference']) {
    extension.run(
      table,
      METADATA_EXTENSION,
      METADATA_EXTENSION_URI,
      'read-write'
    )
  }
}

/**
 * Write the template version records: one row of `gpkg_metadata` per text
 * in `records`, each referenced to the whole GeoPackage. The template writes
 * exactly one; the version flaws write none, two, or one naming a version the
 * service does not support.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} records  metadata texts, normally `[versionRecordText(v)]`
 */
export function writeVersionRecords(db, records) {
  createMetadataTables(db)
  const metadata = db.prepare(
    'INSERT INTO gpkg_metadata (md_scope, md_standard_uri, mime_type, metadata) VALUES (?, ?, ?, ?)'
  )
  const reference = db.prepare(
    'INSERT INTO gpkg_metadata_reference (reference_scope, table_name, column_name, row_id_value, timestamp, md_file_id, md_parent_id) VALUES (?, NULL, NULL, NULL, ?, ?, NULL)'
  )
  for (const text of records) {
    const { lastInsertRowid } = metadata.run(
      METADATA_SCOPE,
      TEMPLATE_SOURCE.metadataUri,
      TEMPLATE_SOURCE.metadataMimeType,
      text
    )
    reference.run(REFERENCE_SCOPE, currentTimestamp(), lastInsertRowid)
  }
}

/**
 * The version records a GeoPackage holds, parsed: `[{ format, version }]`.
 * A record whose text is not JSON is returned as `{ text }`.
 */
export function readVersionRecords(db) {
  const exists = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'gpkg_metadata'"
    )
    .get()
  if (!exists) {
    return []
  }
  return db
    .prepare(
      'SELECT metadata FROM gpkg_metadata WHERE md_standard_uri = ? ORDER BY id'
    )
    .all(TEMPLATE_SOURCE.metadataUri)
    .map(({ metadata }) => {
      try {
        return JSON.parse(metadata)
      } catch {
        return { text: metadata }
      }
    })
}
