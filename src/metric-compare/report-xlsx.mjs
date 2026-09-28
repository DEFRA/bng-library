/**
 * The comparison as a spreadsheet (.xlsx): a summary sheet, then one row per
 * scenario, per discrepancy and per figure not implemented, each sheet with a
 * frozen, filterable header so the differences can be sorted and filtered.
 * Values are real numbers, not text, so they sort and sum.
 *
 * Written directly as SpreadsheetML with the library's own zip writer, so it
 * needs no spreadsheet dependency, and the same results always give the same
 * bytes.
 */

import { columnLetters } from '../workbook-writer/sheet-xml.mjs'
import { createZip } from '../workbook-writer/xlsx-zip.mjs'
import { CAUSES } from './causes.mjs'
import { CATEGORY_TITLES } from './figures.mjs'
import {
  CAUSES_NOTE,
  EXACTNESS_NOTE,
  OUTCOME_TITLES,
  causeTitles,
  isRejected,
  summariseComparison
} from './report-data.mjs'

const PERCENT = 100
const RELATIVE_SIGNIFICANT_FIGURES = 4
// Excel refuses a cell longer than this.
const MAX_CELL_TEXT = 32_767

// Indexes into cellXfs in STYLES.
const STYLE = Object.freeze({ plain: 0, header: 1, title: 2, wrap: 3, bold: 4 })

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7EBEE"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>
`

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
// Characters XML 1.0 does not allow, which Excel would refuse the file over.
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g

function xml(text) {
  return String(text)
    .replaceAll(INVALID_XML, '')
    .replaceAll(/[&<>"]/g, (ch) => XML_ESCAPES[ch])
}

/** A cell: a bare value, or `{ v, s }` with a style from STYLE. */
function cellXml(cell, ref) {
  const { v, s = STYLE.plain } =
    cell !== null && typeof cell === 'object' ? cell : { v: cell }
  const style = s === STYLE.plain ? '' : ` s="${s}"`
  if (v === null || v === undefined || v === '') {
    return style ? `<c r="${ref}"${style}/>` : ''
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    return `<c r="${ref}"${style}><v>${v}</v></c>`
  }
  const text = xml(String(v).slice(0, MAX_CELL_TEXT))
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`
}

function rowXml(cells, rowNumber) {
  const inner = cells
    .map((cell, c) => cellXml(cell, `${columnLetters(c + 1)}${rowNumber}`))
    .join('')
  return `<row r="${rowNumber}">${inner}</row>`
}

/**
 * @param {{ widths: number[], rows: Array<Array<unknown>>, table?: boolean }} sheet
 *   `table` freezes and filters the first row, a header over the rest
 */
function worksheetXml({ widths, rows, table = false }) {
  const lastColumn = columnLetters(widths.length)
  const views = table
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
  const cols = widths
    .map(
      (w, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`
    )
    .join('')
  const data = rows.map((cells, r) => rowXml(cells, r + 1)).join('')
  const filter = table
    ? `<autoFilter ref="A1:${lastColumn}${Math.max(rows.length, 1)}"/>`
    : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${views}<sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${data}</sheetData>${filter}</worksheet>
`
}

function sheetRange(name, widths, rows) {
  return `'${name.replaceAll("'", "''")}'!$A$1:$${columnLetters(widths.length)}$${Math.max(rows.length, 1)}`
}

function workbookXml(sheets) {
  const entries = sheets
    .map(
      (s, i) =>
        `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
    )
    .join('')
  const filters = sheets
    .map((s, i) =>
      s.table
        ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xml(sheetRange(s.name, s.widths, s.rows))}</definedName>`
        : ''
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${entries}</sheets>${filters ? `<definedNames>${filters}</definedNames>` : ''}</workbook>
`
}

function packageParts(sheets) {
  const sheetTypes = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join('')
  const sheetRels = sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    )
    .join('')
  const files = new Map([
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetTypes}</Types>
`
    ],
    [
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>
`
    ],
    ['xl/workbook.xml', workbookXml(sheets)],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>
`
    ],
    ['xl/styles.xml', STYLES]
  ])
  sheets.forEach((s, i) =>
    files.set(`xl/worksheets/sheet${i + 1}.xml`, worksheetXml(s))
  )
  return files
}

const header = (labels) => labels.map((v) => ({ v, s: STYLE.header }))
const bold = (v) => ({ v, s: STYLE.bold })
const wrap = (v) => ({ v, s: STYLE.wrap })

function relativePercent(value) {
  return typeof value === 'number'
    ? Number((value * PERCENT).toPrecision(RELATIVE_SIGNIFICANT_FIGURES))
    : null
}

function summarySheet(data, title, context) {
  const { scenarios, figures } = data
  const rows = [
    [{ v: title, s: STYLE.title }],
    ...context.map((line) => [line]),
    [],
    header(['Scenarios', 'Count']),
    ['Scenarios', scenarios.total],
    ['Matched', scenarios.matched],
    ['With discrepancies', scenarios.discrepancies],
    ['Rejected by the service', scenarios.rejected],
    ['Rejected as expected (invalid data)', scenarios.rejectedAsExpected],
    [],
    header(['Figures', 'Count']),
    ['Compared', figures.compared],
    ['Matched exactly', figures.matched],
    ['Differ', figures.discrepancies],
    ['Per-feature, no known cause', figures.unexplainedFeatures],
    ['Not implemented in the service yet', figures.notImplemented],
    [],
    [wrap(EXACTNESS_NOTE)],
    [],
    header(['Discrepancies by what was compared', 'Discrepancies']),
    ...data.byCategory.map((c) => [c.title, c.discrepancies]),
    [],
    header(['Per-feature discrepancies explained by', 'Discrepancies']),
    ...data.causeCombinations.map((c) => [
      c.causes ?? bold('Nothing known'),
      c.discrepancies
    ]),
    [wrap(CAUSES_NOTE)],
    [],
    header(['Known cause', 'What it means']),
    ...Object.values(CAUSES).map((c) => [bold(c.title), wrap(c.description)]),
    [],
    header([
      'Not implemented in the service yet',
      'What the service does not do yet',
      'Figures',
      'Scenarios'
    ]),
    ...data.notImplemented.map((g) => [
      g.id,
      wrap(g.description),
      g.figures,
      g.scenarios
    ])
  ]
  return { name: 'Summary', widths: [48, 90, 10, 10], rows }
}

function scenariosSheet(results) {
  const rows = [
    header([
      'Scenario',
      'Outcome',
      'Compared',
      'Matched',
      'Discrepancies',
      'Not implemented',
      'Refused file',
      'Why the service refused it'
    ]),
    ...results.map((r) => [
      r.id,
      OUTCOME_TITLES[r.outcome],
      r.compared ?? null,
      r.matched ?? null,
      r.discrepancies?.length ?? null,
      r.notImplemented?.length ?? null,
      isRejected(r) ? r.rejectedFile : null,
      isRejected(r)
        ? r.errors.map((e) => `${e.code}: ${e.message}`).join('\n')
        : null
    ])
  ]
  return {
    name: 'Scenarios',
    widths: [46, 24, 11, 11, 14, 16, 16, 60],
    rows,
    table: true
  }
}

function discrepanciesSheet(results) {
  const rows = [
    header([
      'Scenario',
      'What',
      'Module',
      'Figure',
      'Metric',
      'Service',
      'Difference',
      'Relative (%)',
      'Kind',
      'Explained by',
      'Unexplained',
      'Metric cell',
      'Key'
    ])
  ]
  for (const r of results) {
    for (const d of r.discrepancies ?? []) {
      const causes = causeTitles(d.causes)
      rows.push([
        r.id,
        CATEGORY_TITLES[d.category],
        d.module,
        d.label,
        d.expected,
        d.actual,
        d.difference,
        relativePercent(d.relativeDifference),
        d.kind,
        causes.join('; ') || null,
        causes.length > 0 ? 'No' : 'Yes',
        d.source ?? null,
        d.key
      ])
    }
  }
  return {
    name: 'Discrepancies',
    widths: [44, 26, 12, 56, 18, 18, 18, 13, 20, 44, 12, 26, 60],
    rows,
    table: true
  }
}

function notImplementedSheet(results) {
  const rows = [
    header(['Scenario', 'Gap', 'What', 'Module', 'Figure', 'Metric'])
  ]
  for (const r of results) {
    for (const n of r.notImplemented ?? []) {
      rows.push([
        r.id,
        n.gap,
        CATEGORY_TITLES[n.category],
        n.module,
        n.label,
        n.expected
      ])
    }
  }
  return {
    name: 'Not implemented',
    widths: [44, 30, 26, 12, 56, 18],
    rows,
    table: true
  }
}

/**
 * @param {object[]} results compareScenario results
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {string[]} [options.context] plain-text lines under the title on the
 *   summary sheet, such as the corpus and the commit compared
 * @returns {Buffer} the .xlsx file's bytes
 */
export function renderComparisonXlsx(results, options = {}) {
  const { title = 'Metric comparison', context = [] } = options
  const data = summariseComparison(results)
  const sheets = [
    summarySheet(data, title, context),
    scenariosSheet(results),
    discrepanciesSheet(results),
    notImplementedSheet(results)
  ]
  return createZip(packageParts(sheets))
}
