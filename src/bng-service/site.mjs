/**
 * Write a site, held as a two-stage model, into one GeoPackage in the BNG
 * Service template's format.
 *
 * The model:
 *
 *   {
 *     redline: { geometry, values },
 *     layers: {
 *       habitats | verticalHabitats | hedgerows | rivers | trees: {
 *         baseline: [{ geometry, values, uuid }],
 *         postIntervention: [{ geometry, values, parent, lineage? }]
 *       }
 *     }
 *   }
 *
 * `geometry` is GeoJSON in British National Grid metres; `values` holds the
 * template's columns by name. A post-intervention feature names its baseline
 * feature as `parent` (null for one created from nothing). The writer copies
 * the parent's baseline values onto the row, locked, as the template's copy
 * action does, and stamps the lineage: Parent Ref, parent_uuid, and the
 * parent's shape as WKT rounded to the millimetre in parent_geom. `lineage`
 * replaces that stamp, which is how the lineage flaws write a wrong one.
 */

import {
  envelopeFromCoords,
  expandEnvelope,
  gpkgLineString,
  gpkgPoint,
  gpkgPolygon
} from '../gpkg-io/index.mjs'
import { SRS_ID } from '../bng-schema.mjs'
import {
  BASELINE,
  COMMENT,
  FEATURE_UUID,
  HABITAT_REF,
  LAYERS,
  PARENT_GEOM,
  PARENT_REF,
  PARENT_UUID,
  POST_INTERVENTION,
  RED_LINE_BOUNDARY,
  STAGE_BASELINE,
  createTemplateTables,
  openTemplateGeoPackage,
  tableName,
  templateTable,
  writeVersionRecords
} from './schema.mjs'

export {
  COMMENT,
  FEATURE_UUID,
  HABITAT_REF,
  PARENT_GEOM,
  PARENT_REF,
  PARENT_UUID
}
const LENGTH = 'Length'
const BASELINE_LENGTH = 'Baseline Length'
const AREA = 'Area'

// Baseline columns a post-intervention row does not copy from its parent:
// its own ref, comment and size, and the baseline's identity.
const NOT_COPIED = new Set([HABITAT_REF, COMMENT, FEATURE_UUID, AREA, LENGTH])

// parent_geom is WKT rounded to three decimal places: one millimetre.
const WKT_DECIMALS = 3

const wktPoint = ([x, y]) =>
  `${x.toFixed(WKT_DECIMALS)} ${y.toFixed(WKT_DECIMALS)}`
const wktPath = (points) => `(${points.map(wktPoint).join(', ')})`

/** A geometry as the template writes parent_geom: WKT to the millimetre. */
export function geometryWkt(geometry) {
  switch (geometry.type) {
    case 'Point':
      return `POINT (${wktPoint(geometry.coordinates)})`
    case 'LineString':
      return `LINESTRING ${wktPath(geometry.coordinates)}`
    case 'Polygon':
      return `POLYGON (${geometry.coordinates.map(wktPath).join(', ')})`
    default:
      throw new Error(`No WKT for a ${geometry.type}`)
  }
}

function geometryBlob(geometry) {
  switch (geometry.type) {
    case 'Point':
      return gpkgPoint(SRS_ID, ...geometry.coordinates)
    case 'LineString':
      return gpkgLineString(SRS_ID, geometry.coordinates)
    case 'Polygon':
      return gpkgPolygon(SRS_ID, geometry.coordinates[0])
    default:
      throw new Error(`Cannot write a ${geometry.type}`)
  }
}

function geometryEnvelope(geometry) {
  if (geometry.type === 'Point') {
    const [x, y] = geometry.coordinates
    return [x, x, y, y]
  }
  const coords =
    geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates
  return envelopeFromCoords(coords)
}

/** The values a post-intervention row carries from its parent, locked. */
function inheritedValues(parent) {
  if (!parent) {
    return {}
  }
  const values = {}
  for (const [column, value] of Object.entries(parent.values)) {
    if (!NOT_COPIED.has(column)) {
      values[column] = value
    }
  }
  if (parent.values[LENGTH] !== undefined) {
    values[BASELINE_LENGTH] = parent.values[LENGTH]
  }
  return values
}

function lineageValues(feature) {
  if (feature.lineage) {
    return {
      [PARENT_REF]: feature.lineage.ref ?? null,
      [PARENT_UUID]: feature.lineage.uuid ?? null,
      [PARENT_GEOM]: feature.lineage.geom ?? null
    }
  }
  const { parent } = feature
  return {
    [PARENT_REF]: parent?.values[HABITAT_REF] ?? null,
    [PARENT_UUID]: parent?.uuid ?? null,
    [PARENT_GEOM]: parent ? geometryWkt(parent.geometry) : null
  }
}

/** The full row of one feature, by column. */
export function rowValues(feature, stage) {
  if (stage === BASELINE) {
    return { ...feature.values, [FEATURE_UUID]: feature.uuid ?? null }
  }
  return {
    ...inheritedValues(feature.parent),
    ...feature.values,
    ...lineageValues(feature)
  }
}

function insertRows(db, name, features, stage) {
  const table = templateTable(name)
  const columns = table.columns.map((c) => c.name)
  const statement = db.prepare(
    `INSERT INTO "${name}" ("${table.geometryColumn}", ${columns
      .map((c) => `"${c}"`)
      .join(', ')}) VALUES (?${', ?'.repeat(columns.length)})`
  )
  const envelope = [Infinity, -Infinity, Infinity, -Infinity]
  for (const feature of features) {
    const values = rowValues(feature, stage)
    statement.run(
      feature.geometry ? geometryBlob(feature.geometry) : null,
      ...columns.map((c) => values[c] ?? null)
    )
    if (feature.geometry) {
      expandEnvelope(envelope, geometryEnvelope(feature.geometry))
    }
  }
  return features.length > 0 && Number.isFinite(envelope[0]) ? envelope : null
}

/**
 * Write `site` to `outPath`.
 *
 * @param {string} outPath
 * @param {object} site  the model described above
 * @param {object} [options]
 * @param {string} [options.stage]  'baseline' leaves the post-intervention
 *   tables empty: the file an ecologist has before mapping post-intervention
 * @param {string[]} options.versionRecords  the gpkg_metadata texts to write
 */
export function writeSite(outPath, site, { stage, versionRecords }) {
  const db = openTemplateGeoPackage(outPath)
  try {
    createTemplateTables(db)
    const envelopes = new Map()
    envelopes.set(
      RED_LINE_BOUNDARY,
      insertRows(db, RED_LINE_BOUNDARY, [site.redline], BASELINE)
    )
    for (const key of Object.keys(LAYERS)) {
      const layer = site.layers[key] ?? { baseline: [], postIntervention: [] }
      const baselineTable = tableName(key, BASELINE)
      envelopes.set(
        baselineTable,
        insertRows(db, baselineTable, layer.baseline, BASELINE)
      )
      const piTable = tableName(key, POST_INTERVENTION)
      const piFeatures = stage === STAGE_BASELINE ? [] : layer.postIntervention
      envelopes.set(
        piTable,
        insertRows(db, piTable, piFeatures, POST_INTERVENTION)
      )
    }
    const updateEnvelope = db.prepare(
      'UPDATE gpkg_contents SET min_x = ?, min_y = ?, max_x = ?, max_y = ? WHERE table_name = ?'
    )
    for (const [name, env] of envelopes) {
      if (env) {
        updateEnvelope.run(env[0], env[2], env[1], env[3], name)
      }
    }
    writeVersionRecords(db, versionRecords)
  } finally {
    db.close()
  }
}
