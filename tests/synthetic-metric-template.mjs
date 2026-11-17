/**
 * A synthetic metric workbook laid out as one release lays out its input
 * sheets, for testing the writer's row bounds without the real template.
 *
 * Each input sheet holds its layout's fingerprint headers, and after its last
 * data row a totals row: a label, and a formula in every input column, as
 * the real totals rows hold. The writer refuses to write or clear a formula,
 * so a writer that strays into the totals row fails loudly. The habitat
 * baseline sheet numbers its data rows in column D, as the metric does, which
 * is how the writer tells the release.
 */

import { columnIndex, splitRef } from '../src/workbook-writer/sheet-xml.mjs'
import { METRIC_SHEETS } from '../src/workbook-writer/template-layout.mjs'
import { createZip } from '../src/workbook-writer/xlsx-zip.mjs'

const CONTENT_TYPES =
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>'
export const TOTALS_LABEL = 'Total'
const LABEL_COLUMN = 'A'
const ROW_NUMBER_COLUMN = 'D'

const escapeXml = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

const inline = (ref, text) =>
  `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(text)}</t></is></c>`
const number = (ref, n) => `<c r="${ref}"><v>${n}</v></c>`
const formula = (ref, f) => `<c r="${ref}"><f>${f}</f><v>0</v></c>`

/** The totals formula a sheet's input column holds after its last row. */
export function totalsFormula(column, firstRow, lastRow) {
  return `SUM(${column}${firstRow}:${column}${lastRow})`
}

function worksheet(cells) {
  const rows = new Map()
  for (const [ref, xml] of cells) {
    const { row } = splitRef(ref)
    if (!rows.has(row)) {
      rows.set(row, [])
    }
    rows.get(row).push([ref, xml])
  }
  const rowXml = [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([row, rowCells]) => {
      const sorted = rowCells
        .sort(
          ([a], [b]) =>
            columnIndex(splitRef(a).column) - columnIndex(splitRef(b).column)
        )
        .map(([, xml]) => xml)
        .join('')
      return `<row r="${row}">${sorted}</row>`
    })
    .join('')
  return `<worksheet><sheetData>${rowXml}</sheetData></worksheet>`
}

function sheetCells(key, layout, lastRow, extraCells) {
  const cells = new Map(
    Object.entries(layout.fingerprint).map(([ref, text]) => [
      ref,
      inline(ref, text)
    ])
  )
  if (key === 'habitatBaseline') {
    for (let row = layout.firstRow; row <= lastRow; row += 1) {
      const ref = `${ROW_NUMBER_COLUMN}${row}`
      cells.set(ref, number(ref, row - layout.firstRow + 1))
    }
  }
  const totals = lastRow + 1
  cells.set(
    `${LABEL_COLUMN}${totals}`,
    inline(`${LABEL_COLUMN}${totals}`, TOTALS_LABEL)
  )
  for (const column of new Set(Object.values(layout.columns))) {
    const ref = `${column}${totals}`
    cells.set(
      ref,
      formula(ref, totalsFormula(column, layout.firstRow, lastRow))
    )
  }
  for (const [ref, value] of Object.entries(extraCells)) {
    cells.set(
      ref,
      typeof value === 'number' ? number(ref, value) : inline(ref, value)
    )
  }
  return cells
}

/**
 * @param {Record<string, number>} lastRows each sheet's last data row, keyed
 *   as METRIC_SHEETS
 * @param {Record<string, Record<string, string | number>>} [inputs] values
 *   already in a sheet's cells, keyed by sheet key then cell reference
 * @returns {Buffer} the .xlsx bytes
 */
export function syntheticMetricTemplate(lastRows, inputs = {}) {
  const layouts = Object.entries(METRIC_SHEETS)
  const files = new Map([
    ['[Content_Types].xml', CONTENT_TYPES],
    [
      '_rels/.rels',
      '<Relationships><Relationship Id="rId1" Type="officeDocument" Target="xl/workbook.xml"/></Relationships>'
    ],
    [
      'xl/workbook.xml',
      `<workbook xmlns:r="r"><sheets>${layouts
        .map(
          ([, layout], i) =>
            `<sheet name="${escapeXml(layout.sheet)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
        )
        .join('')}</sheets></workbook>`
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<Relationships>${layouts
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`
        )
        .join('')}</Relationships>`
    ]
  ])
  layouts.forEach(([key, layout], i) => {
    files.set(
      `xl/worksheets/sheet${i + 1}.xml`,
      worksheet(sheetCells(key, layout, lastRows[key], inputs[key] ?? {}))
    )
  })
  return createZip(files)
}
