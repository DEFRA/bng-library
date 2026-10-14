#!/usr/bin/env node

/**
 * Copy the BNG Service QGIS template's schema and reference lists into this
 * library, from a checkout of the bng-metric-template repository.
 *
 *   node scripts/sync-bng-service-template.mjs ../bng-metric-template
 *
 * Writes src/bng-service/template/:
 *
 *   schema.json      every table of the template's GeoPackage: its geometry
 *                    column and type, and its columns in order
 *   drop-downs.json  each column's drop-down, read from the QGIS project: a
 *                    fixed list, or a reference list with its key column and
 *                    the filter that narrows it by an earlier choice
 *   source.json      the template commit these came from, and the format and
 *                    version its GeoPackage records
 *   reference/       the template's CSV References, copied byte for byte
 *
 * The generator writes files to schema.json, and checks every value it writes
 * against drop-downs.json and the reference lists, so a change to the template
 * reaches the library by running this again and reviewing the diff. Nothing
 * here is edited by hand.
 */

import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { readZip } from '../src/workbook-writer/xlsx-zip.mjs'

const TEMPLATE_DIR = path.join('templates', 'bng-service')
const PROJECT_FILE = 'BNG Service Habitat Mapping.qgz'
const LAYERS_FILE = path.join('Layers', 'BNG Service Layers.gpkg')
const REFERENCE_DIR = 'CSV References'
const OUT_DIR = path.resolve(
  import.meta.dirname,
  '..',
  'src',
  'bng-service',
  'template'
)
const REPOSITORY = 'https://github.com/DEFRA/bng-metric-template'
const JSON_INDENT = 2
// The value QGIS stores for the blank choice it adds to every fixed list.
const QGIS_NULL_SENTINEL = /^\{[0-9A-F-]{36}\}$/i

function fail(message) {
  console.error(`✖ ${message}`)
  process.exit(1)
}

function decodeXml(text) {
  return text
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&#xa;', '\n')
    .replaceAll('&#xd;', '\r')
    .replaceAll('&amp;', '&')
}

function attribute(tag, name) {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)
  return match ? decodeXml(match[1]) : undefined
}

/** Every `<Option name=… value=…/>` leaf in an XML fragment. */
function options(fragment) {
  return [...fragment.matchAll(/<Option\s[^>]*\/>/g)].map(([tag]) => ({
    name: attribute(tag, 'name'),
    type: attribute(tag, 'type'),
    value: attribute(tag, 'value')
  }))
}

/** A CSV layer's file, relative to the template's CSV References folder. */
function referenceListPath(datasource) {
  const file = decodeURIComponent(datasource.split('?')[0])
  const marker = `${REFERENCE_DIR}/`
  const at = file.indexOf(marker)
  if (at < 0) {
    fail(`reference list outside ${REFERENCE_DIR}: ${datasource}`)
  }
  return file.slice(at + marker.length)
}

function readLayers(projectXml) {
  return [...projectXml.matchAll(/<maplayer\s[\s\S]*?<\/maplayer>/g)].map(
    ([xml]) => ({
      xml,
      id: /<id>([^<]*)<\/id>/.exec(xml)?.[1],
      datasource: decodeXml(
        /<datasource>([^<]*)<\/datasource>/.exec(xml)?.[1] ?? ''
      )
    })
  )
}

function fixedList(widget) {
  const values = options(widget)
    .filter((o) => o.type === 'QString' && o.name)
    .map((o) => o.value)
    .filter((value) => !QGIS_NULL_SENTINEL.test(value))
  return { kind: 'list', values }
}

function referenceList(widget, layersById) {
  const config = Object.fromEntries(
    options(widget)
      .filter((o) => o.name)
      .map((o) => [o.name, o.value])
  )
  const list = layersById.get(config.Layer)
  if (!list) {
    fail(`drop-down names a layer the project does not hold: ${config.Layer}`)
  }
  const filter = (config.FilterExpression ?? '').trim()
  return {
    kind: 'reference',
    list: referenceListPath(list.datasource),
    key: config.Key,
    ...(filter ? { filter } : {})
  }
}

/** table → field → drop-down, for every GeoPackage layer in the project. */
function readDropDowns(projectXml) {
  const layers = readLayers(projectXml)
  const layersById = new Map(layers.map((layer) => [layer.id, layer]))
  const dropDowns = {}
  for (const layer of layers) {
    const table = /layername=([^|]+)/.exec(layer.datasource)?.[1]
    const fields = /<fieldConfiguration>([\s\S]*?)<\/fieldConfiguration>/.exec(
      layer.xml
    )
    if (!table || !fields) {
      continue
    }
    const columns = {}
    for (const [, name, body] of fields[1].matchAll(
      /<field name="([^"]*)"[^>]*>([\s\S]*?)<\/field>/g
    )) {
      const type = /<editWidget type="([^"]*)"/.exec(body)?.[1]
      if (type === 'ValueMap') {
        columns[decodeXml(name)] = fixedList(body)
      } else if (type === 'ValueRelation') {
        columns[decodeXml(name)] = referenceList(body, layersById)
      }
    }
    dropDowns[table] = columns
  }
  return dropDowns
}

function readSchema(gpkgPath) {
  const db = new Database(gpkgPath, { readonly: true })
  try {
    const geometry = new Map(
      db
        .prepare(
          'SELECT table_name, column_name, geometry_type_name, srs_id FROM gpkg_geometry_columns'
        )
        .all()
        .map((row) => [row.table_name, row])
    )
    const tables = db
      .prepare(
        "SELECT table_name FROM gpkg_contents WHERE data_type = 'features' ORDER BY rowid"
      )
      .all()
      .map(({ table_name: name }) => ({
        name,
        geometryColumn: geometry.get(name).column_name,
        geometryType: geometry.get(name).geometry_type_name,
        srsId: geometry.get(name).srs_id,
        columns: db
          .prepare(`PRAGMA table_info("${name}")`)
          .all()
          .filter(
            (c) => c.name !== 'fid' && c.name !== geometry.get(name).column_name
          )
          .map((c) => ({ name: c.name, type: c.type }))
      }))
    const metadata = db
      .prepare('SELECT md_standard_uri, mime_type, metadata FROM gpkg_metadata')
      .all()
    return { tables, metadata }
  } finally {
    db.close()
  }
}

function templateCommit(checkout) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: checkout,
      encoding: 'utf8'
    }).trim()
  } catch {
    return null
  }
}

function writeJson(name, value) {
  writeFileSync(
    path.join(OUT_DIR, name),
    `${JSON.stringify(value, null, JSON_INDENT)}\n`
  )
}

function main() {
  const checkout = process.argv[2]
  if (!checkout) {
    fail(
      'usage: node scripts/sync-bng-service-template.mjs <bng-metric-template checkout>'
    )
  }
  const template = path.resolve(checkout, TEMPLATE_DIR)
  if (!existsSync(path.join(template, PROJECT_FILE))) {
    fail(`no BNG Service template at ${template}`)
  }
  console.log(`Reading the BNG Service template at ${template}`)

  const project = readZip(readFileSync(path.join(template, PROJECT_FILE)))
  const qgs = project.names.find((n) => n.endsWith('.qgs'))
  const dropDowns = readDropDowns(project.read(qgs).toString('utf8'))
  const { tables, metadata } = readSchema(path.join(template, LAYERS_FILE))
  if (metadata.length !== 1) {
    fail(`expected one template version record, found ${metadata.length}`)
  }
  const record = JSON.parse(metadata[0].metadata)

  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
  cpSync(path.join(template, REFERENCE_DIR), path.join(OUT_DIR, 'reference'), {
    recursive: true
  })
  writeJson('schema.json', { tables })
  writeJson('drop-downs.json', dropDowns)
  writeJson('source.json', {
    repository: REPOSITORY,
    commit: templateCommit(checkout),
    format: record.format,
    version: record.version,
    metadataUri: metadata[0].md_standard_uri,
    metadataMimeType: metadata[0].mime_type
  })
  console.log(
    `Wrote ${tables.length} tables, the drop-downs of ${Object.keys(dropDowns).length} layers and the reference lists to ${OUT_DIR}`
  )
}

main()
