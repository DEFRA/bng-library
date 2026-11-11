/**
 * The sync script's reading of each column's allowed values from a QGIS
 * project and its CSV References (BMD-1175), on two small projects written
 * here: one in the BNG Service template's shape, one in the Natural England
 * template's, with the stale drop-down link that project holds.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readAllowedValues } from '../scripts/sync-bng-service-template.mjs'
import { createZip } from '../src/workbook-writer/xlsx-zip.mjs'

const NULL_SENTINEL = '{2839923C-8B7D-419E-B84B-CA2FE9B80EC7}'

const option = (name, value) =>
  `<Option type="QString" name="${name}" value="${value}"/>`

function valueMap(...values) {
  const entries = [option('&lt;NULL&gt;', NULL_SENTINEL)]
    .concat(values.map((value) => option(value, value)))
    .map((entry) => `<Option type="Map">${entry}</Option>`)
    .join('')
  return `<editWidget type="ValueMap"><config><Option type="Map"><Option type="List" name="map">${entries}</Option></Option></config></editWidget>`
}

function valueRelation({ layer, layerName = '', key }) {
  return `<editWidget type="ValueRelation"><config><Option type="Map">${option('Layer', layer)}${option('LayerName', layerName)}${option('Key', key)}${option('Value', key)}${option('FilterExpression', '')}</Option></config></editWidget>`
}

const field = (name, widget) =>
  `<field name="${name}" configurationFlags="NoFlag">${widget}</field>`

function csvLayer(id, name, file) {
  const source = `file:///anywhere/CSV%20References/${encodeURI(file)}?type=csv&amp;detectTypes=yes`
  return `<maplayer type="vector"><id>${id}</id><datasource>${source}</datasource><layername>${name}</layername></maplayer>`
}

function gpkgLayer(id, table, fields) {
  return `<maplayer type="vector"><id>${id}</id><datasource>./Layers/Layers.gpkg|layername=${table}</datasource><layername>${table}</layername><fieldConfiguration>${fields.join('')}</fieldConfiguration></maplayer>`
}

/** A template folder: a .qgz holding `layers`, and its CSV References. */
function writeTemplate(dir, layers, csvs) {
  const referenceDir = path.join(dir, 'CSV References')
  for (const [file, text] of Object.entries(csvs)) {
    mkdirSync(path.dirname(path.join(referenceDir, file)), { recursive: true })
    writeFileSync(path.join(referenceDir, file), text)
  }
  const qgs = `<?xml version="1.0" encoding="UTF-8"?><qgis><projectlayers>${layers.join('')}</projectlayers></qgis>`
  const projectFile = path.join(dir, 'Project.qgz')
  writeFileSync(projectFile, createZip(new Map([['Project.qgs', qgs]])))
  return { projectFile, referenceDir }
}

let work

beforeAll(() => {
  work = mkdtempSync(path.join(tmpdir(), 'sync-allowed-values-'))
})

afterAll(() => {
  rmSync(work, { recursive: true, force: true })
})

function serviceTemplate() {
  return writeTemplate(
    path.join(work, 'service'),
    [
      csvLayer('broad_list', 'Broad list', 'Area habitats/Broad.csv'),
      csvLayer('significance_list', 'Significance', 'Significance.csv'),
      gpkgLayer('habitats_layer', 'Habitats', [
        field(
          'Baseline Broad Habitat Type',
          valueRelation({ layer: 'broad_list', key: 'Name' })
        ),
        field('Baseline Condition', valueMap('Good', 'Poor')),
        field(
          'Proposed Strategic Significance',
          valueRelation({ layer: 'significance_list', key: 'Value' })
        )
      ]),
      gpkgLayer('trees_layer', 'Trees', [
        // A second layer's list for the same column: its values join the
        // first layer's.
        field('Baseline Condition', valueMap('Good', 'Moderate')),
        // Reads another GeoPackage layer, not a reference list: no words.
        field(
          'Proposed Tree Type',
          valueRelation({ layer: 'habitats_layer', key: 'fid' })
        )
      ])
    ],
    {
      'Area habitats/Broad.csv': 'ID,Name\n1,Grassland\n2,Woodland\n3,\n',
      'Significance.csv': 'Value\nLow\nHigh\n',
      'Distinctiveness/Habitat Distinctiveness.csv':
        'Habitat,Distinctiveness\nGrassland,Low\nWoodland,High\n'
    }
  )
}

function legacyTemplate() {
  return writeTemplate(
    path.join(work, 'legacy'),
    [
      csvLayer('broad_list_current', 'Broad list', 'Broad.csv'),
      gpkgLayer('habitats_layer', 'Habitats', [
        // The drop-down's layer id is stale; its layer name still holds.
        field(
          'Baseline Broad Habitat Type',
          valueRelation({
            layer: 'broad_list_stale',
            layerName: 'Broad list',
            key: 'Name'
          })
        )
      ])
    ],
    {
      // A distinctiveness column in a list not named for distinctiveness:
      // not a band the template fills in.
      'Broad.csv': 'Name,Distinctiveness\nWoodland,V.High\nHeathland,Medium\n',
      'Hedgerow Distinctiveness.csv':
        'Hedge,Distinctiveness Score\nNative hedgerow,V.Low\n'
    }
  )
}

describe('readAllowedValues', () => {
  it('reads every column’s values from both templates’ projects and lists', () => {
    const allowed = readAllowedValues([serviceTemplate(), legacyTemplate()])
    const bands = ['High', 'Low', 'V.Low']
    expect(allowed).toStrictEqual({
      'Baseline Broad Habitat Type': ['Grassland', 'Heathland', 'Woodland'],
      'Baseline Condition': ['Good', 'Moderate', 'Poor'],
      'Baseline Distinctiveness': bands,
      'Baseline Strategic Significance': ['High', 'Low'],
      'Proposed Distinctiveness': bands,
      'Proposed Strategic Significance': ['High', 'Low']
    })
    expect(Object.keys(allowed)).toEqual(
      Object.keys(allowed).toSorted((a, b) => a.localeCompare(b))
    )
  })
})
