#!/usr/bin/env node

/**
 * Copy the BNG Service QGIS template's GeoPackage specification and reference
 * lists into this library, from a checkout of the bng-metric-template
 * repository.
 *
 *   node scripts/sync-bng-service-template.mjs ../bng-metric-template
 *
 * Writes src/bng-service/template/:
 *
 *   gpkg-spec.json   the template's GeoPackage specification, copied byte for
 *                    byte: every table at its stage, every column of it, each
 *                    column's drop-down, and the version record. The library
 *                    reads its schema, drop-downs and version from it
 *                    (`src/bng-service/reference.mjs`)
 *   reference/       the template's CSV References, copied byte for byte
 *   allowed-values.json
 *                    each drop-down or filled-in column's every value, in
 *                    this template and the Natural England template together,
 *                    which the service checks an upload's values against
 *   source.json      the template repository and the commit these came from
 *
 * The generator writes tables to the specification's schema, and checks
 * every value it writes against its drop-downs and the reference lists, so a
 * change to the template reaches the library by running this again and
 * reviewing the diff. Nothing here is edited by hand.
 *
 * Importing this module runs nothing: `readAllowedValues` is exported for
 * its tests.
 */

import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import {
  parseCsv,
  templateDropDowns,
  templateVersion
} from '../src/bng-service/reference.mjs'
import { readZip } from '../src/workbook-writer/xlsx-zip.mjs'

const TEMPLATE_DIR = path.join('templates', 'bng-service')
const PROJECT_FILE = 'BNG Service Habitat Mapping.qgz'
const REFERENCE_DIR = 'CSV References'
const SPEC_FILE = path.join('spec', 'gpkg-spec.json')
const LEGACY_DIR = path.join('templates', 'legacy-ne')
const LEGACY_PROJECT_FILE = 'Net Gain Habitat Mapping.qgz'
const DISTINCTIVENESS_COLUMNS = [
  'Baseline Distinctiveness',
  'Proposed Distinctiveness'
]
const BASELINE_SIGNIFICANCE = 'Baseline Strategic Significance'
const PROPOSED_SIGNIFICANCE = 'Proposed Strategic Significance'
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

/**
 * Layers by id and, where a drop-down's layer id is stale, by the layer name
 * the drop-down also records: the Natural England project holds such links.
 */
function layersByIdOrName(layers, projectXml) {
  const byId = new Map(layers.map((layer) => [layer.id, layer]))
  const byName = new Map(
    layers.map((layer) => [
      decodeXml(/<layername>([^<]*)<\/layername>/.exec(layer.xml)?.[1] ?? ''),
      layer
    ])
  )
  for (const [widget] of projectXml.matchAll(
    /<editWidget type="ValueRelation">[\s\S]*?<\/editWidget>/g
  )) {
    const config = Object.fromEntries(
      options(widget).map((o) => [o.name, o.value])
    )
    if (!byId.has(config.Layer) && byName.has(config.LayerName)) {
      byId.set(config.Layer, byName.get(config.LayerName))
    }
  }
  return byId
}

/**
 * Whether a value relation reads one of the template's reference lists. The
 * Natural England project also has some that read another of its own
 * layers, such as a tree's, which offer no list of words.
 */
function listsReference(widget, layersById) {
  const layer = options(widget).find((o) => o.name === 'Layer')?.value
  return decodeURIComponent(layersById.get(layer)?.datasource ?? '').includes(
    `${REFERENCE_DIR}/`
  )
}

/** Every drop-down of every layer in a project, layer by layer. */
function everyDropDown(projectXml) {
  const layers = readLayers(projectXml)
  const layersById = layersByIdOrName(layers, projectXml)
  const dropDowns = []
  for (const layer of layers) {
    const fields = /<fieldConfiguration>([\s\S]*?)<\/fieldConfiguration>/.exec(
      layer.xml
    )
    for (const [, name, body] of fields?.[1].matchAll(
      /<field name="([^"]*)"[^>]*>([\s\S]*?)<\/field>/g
    ) ?? []) {
      const type = /<editWidget type="([^"]*)"/.exec(body)?.[1]
      if (type === 'ValueMap') {
        dropDowns.push([decodeXml(name), fixedList(body)])
      } else if (type === 'ValueRelation' && listsReference(body, layersById)) {
        dropDowns.push([decodeXml(name), referenceList(body, layersById)])
      }
    }
  }
  return dropDowns
}

function readCsvRecords(file) {
  const [header, ...rows] = parseCsv(readFileSync(file, 'utf8'))
  return rows.map((row) =>
    Object.fromEntries(header.map((h, i) => [h, row[i] ?? '']))
  )
}

function readProjectXml(projectFile) {
  const project = readZip(readFileSync(projectFile))
  const qgs = project.names.find((n) => n.endsWith('.qgs'))
  return project.read(qgs).toString('utf8')
}

/** Add `value` to the set for `column`, unless it is blank. */
function addAllowed(allowed, column, value) {
  const text = (value ?? '').trim()
  if (text === '') {
    return
  }
  if (!allowed.has(column)) {
    allowed.set(column, new Set())
  }
  allowed.get(column).add(text)
}

/**
 * The distinctiveness bands, which the BNG Service template fills in from a
 * list rather than offering in a drop-down: every value of every
 * distinctiveness column of every distinctiveness list.
 */
function addDistinctiveness(allowed, referenceDir) {
  for (const file of listCsvFiles(referenceDir)) {
    if (!path.basename(file).includes('Distinctiveness')) {
      continue
    }
    for (const record of readCsvRecords(file)) {
      for (const [header, value] of Object.entries(record)) {
        if (/distinctiv/i.test(header)) {
          for (const column of DISTINCTIVENESS_COLUMNS) {
            addAllowed(allowed, column, value)
          }
        }
      }
    }
  }
}

function listCsvFiles(dir) {
  return readdirSync(dir, { recursive: true })
    .filter((name) => name.endsWith('.csv'))
    .map((name) => path.join(dir, name))
    .sort()
}

/**
 * column → every value a drop-down or a filled-in column offers, in either
 * template: the BNG Service template, and the Natural England template that
 * legacy uploads follow. A list may differ from layer to layer, and the
 * Natural England template has several layers for one table, so a column's
 * values are those of all of them together. The service uses this to refuse
 * a value that no list offers (BMD-1175): a check that the value is one of
 * the template's words at all, not that it fits the rest of its row.
 */
export function readAllowedValues(templates) {
  const allowed = new Map()
  for (const { projectFile, referenceDir } of templates) {
    for (const [column, dropDown] of everyDropDown(
      readProjectXml(projectFile)
    )) {
      const values =
        dropDown.kind === 'list'
          ? dropDown.values
          : readCsvRecords(path.join(referenceDir, dropDown.list)).map(
              (record) => record[dropDown.key]
            )
      for (const value of values) {
        addAllowed(allowed, column, value)
      }
    }
    addDistinctiveness(allowed, referenceDir)
  }
  // The template fills in baseline strategic significance; the post-
  // intervention column's lists hold the same words.
  for (const value of allowed.get(PROPOSED_SIGNIFICANCE) ?? []) {
    addAllowed(allowed, BASELINE_SIGNIFICANCE, value)
  }
  return Object.fromEntries(
    [...allowed]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([column, values]) => [
        column,
        [...values].sort((a, b) => a.localeCompare(b))
      ])
  )
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
  const spec = path.resolve(checkout, SPEC_FILE)
  if (!existsSync(spec)) {
    fail(`no GeoPackage specification at ${spec}`)
  }
  const legacy = path.resolve(checkout, LEGACY_DIR)
  if (!existsSync(path.join(legacy, LEGACY_PROJECT_FILE))) {
    fail(`no Natural England template at ${legacy}`)
  }
  console.log(`Reading the BNG Service template at ${template}`)

  const allowedValues = readAllowedValues([
    {
      projectFile: path.join(template, PROJECT_FILE),
      referenceDir: path.join(template, REFERENCE_DIR)
    },
    {
      projectFile: path.join(legacy, LEGACY_PROJECT_FILE),
      referenceDir: path.join(legacy, REFERENCE_DIR)
    }
  ])
  const specification = JSON.parse(readFileSync(spec, 'utf8'))
  // Read the new specification's version record and drop-downs as the
  // library will, so one it cannot read stops the sync before anything is
  // copied.
  try {
    templateVersion(specification)
    templateDropDowns(specification)
  } catch (error) {
    fail(`the GeoPackage specification cannot be read: ${error.message}`)
  }
  const { tables } = specification

  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
  cpSync(spec, path.join(OUT_DIR, 'gpkg-spec.json'))
  cpSync(path.join(template, REFERENCE_DIR), path.join(OUT_DIR, 'reference'), {
    recursive: true
  })
  writeJson('allowed-values.json', allowedValues)
  writeJson('source.json', {
    repository: REPOSITORY,
    commit: templateCommit(checkout)
  })
  console.log(
    `Wrote the GeoPackage specification of ${tables.length} tables, the reference lists and the allowed values to ${OUT_DIR}`
  )
}

// Run only as a command, so that a test can import what it reads.
if (import.meta.main) {
  main()
}
