import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { lintWorkbook } from '../src/workbook-writer/lint.mjs'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const CALC_CHAIN_REL =
  '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/>'

/**
 * A minimal workbook package, as the `readZip` shape the lint takes: one
 * sheet ("One", sheetId 1) holding `rows`, and two shared strings.
 */
function workbook({ rows = '', calcChain, rels = '', parts = {} } = {}) {
  const files = new Map(
    Object.entries({
      '[Content_Types].xml':
        '<Types><Default Extension="rels" ContentType="r"/><Default Extension="xml" ContentType="x"/></Types>',
      '_rels/.rels':
        '<Relationships><Relationship Id="rId1" Type="officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml':
        '<workbook><sheets><sheet name="One" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': `<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="sharedStrings" Target="sharedStrings.xml"/>${calcChain ? CALC_CHAIN_REL : ''}${rels}</Relationships>`,
      'xl/sharedStrings.xml': '<sst><si><t>a</t></si><si><t>b</t></si></sst>',
      'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
      ...(calcChain
        ? { 'xl/calcChain.xml': `<calcChain>${calcChain}</calcChain>` }
        : {}),
      ...parts
    })
  )
  return {
    names: [...files.keys()],
    has: (name) => files.has(name),
    read: (name) => Buffer.from(files.get(name))
  }
}

const rules = (issues) => issues.map((i) => `${i.rule} ${i.ref}`)

describe('lintWorkbook', () => {
  it('passes a well-formed workbook', () => {
    const rows =
      '<row r="1"><c r="A1"><v>1.5</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="str"><f>A1</f><v xml:space="preserve"> </v></c><c r="D1"><f>A1*2</f></c></row>'
    expect(lintWorkbook(workbook({ rows }))).toEqual([])
  })

  it('passes what a spreadsheet library writes, read from bytes', () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['a', 1],
        ['b', { f: 'B1*2' }]
      ]),
      'One'
    )
    const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
    expect(lintWorkbook(buffer)).toEqual([])
  })

  describe('cached-value-type', () => {
    it('flags text left in a numeric cell, as Excel repairs it', () => {
      const rows =
        '<row r="16"><c r="K16" s="637"><f>IF(J16,"x"," ")</f><v xml:space="preserve"> </v></c></row>'
      const issues = lintWorkbook(workbook({ rows }))
      expect(issues).toEqual([
        {
          rule: 'cached-value-type',
          part: 'xl/worksheets/sheet1.xml',
          ref: 'K16',
          message: 'Value " " is not a number'
        }
      ])
    })

    it('flags a shared-string index past the end, and a boolean that is not 0 or 1', () => {
      const rows =
        '<row r="1"><c r="A1" t="s"><v>2</v></c><c r="B1" t="b"><v>2</v></c><c r="C1" t="b"><v>1</v></c></row>'
      expect(rules(lintWorkbook(workbook({ rows })))).toEqual([
        'cached-value-type A1',
        'cached-value-type B1'
      ])
    })
  })

  describe('stale-calc-chain', () => {
    it('flags an entry for a cell that holds no formula', () => {
      const rows =
        '<row r="12"><c r="Q12" t="inlineStr"><is><t>Grassland</t></is></c><c r="R12"><f>Q12</f></c></row>'
      const calcChain = '<c r="R12" i="1"/><c r="Q12"/>'
      expect(rules(lintWorkbook(workbook({ rows, calcChain })))).toEqual([
        'stale-calc-chain Q12'
      ])
    })

    it('flags an entry for a sheet the workbook does not have', () => {
      const rows = '<row r="1"><c r="A1"><f>1</f></c></row>'
      const calcChain = '<c r="A1" i="9"/>'
      expect(rules(lintWorkbook(workbook({ rows, calcChain })))).toEqual([
        'stale-calc-chain A1'
      ])
    })
  })

  describe('broken-shared-formula', () => {
    it('passes a shared formula whose followers lie in its range', () => {
      const rows =
        '<row r="1"><c r="A1"><f t="shared" ref="A1:A2" si="0">B1</f></c></row><row r="2"><c r="A2"><f t="shared" si="0"/></c></row>'
      expect(lintWorkbook(workbook({ rows }))).toEqual([])
    })

    it('flags a follower with no master, and one outside the range', () => {
      const rows =
        '<row r="1"><c r="A1"><f t="shared" ref="A1:A2" si="0">B1</f></c></row><row r="3"><c r="A3"><f t="shared" si="0"/></c><c r="B3"><f t="shared" si="7"/></c></row>'
      expect(rules(lintWorkbook(workbook({ rows })))).toEqual([
        'broken-shared-formula A3',
        'broken-shared-formula B3'
      ])
    })
  })

  describe('cell-order', () => {
    it('flags rows out of order, cells out of order, and a cell in the wrong row', () => {
      const rows =
        '<row r="2"><c r="B2"/><c r="A2"/></row><row r="1"><c r="A1"/></row><row r="3"><c r="A4"/></row>'
      expect(rules(lintWorkbook(workbook({ rows })))).toEqual([
        'cell-order A2',
        'cell-order row 1',
        'cell-order A4'
      ])
    })

    it('flags a repeated cell', () => {
      const rows = '<row r="1"><c r="A1"/><c r="A1"/></row>'
      expect(rules(lintWorkbook(workbook({ rows })))).toEqual(['cell-order A1'])
    })
  })

  describe('package parts', () => {
    it('flags a relationship to a missing part, but not an external link', () => {
      const rels =
        '<Relationship Id="rId8" Type="styles" Target="styles.xml"/><Relationship Id="rId9" Type="hyperlink" Target="https://example.org" TargetMode="External"/>'
      expect(lintWorkbook(workbook({ rels }))).toEqual([
        {
          rule: 'missing-part',
          part: 'xl/_rels/workbook.xml.rels',
          ref: 'rId8',
          message: 'No part xl/styles.xml'
        }
      ])
    })

    it('flags a part with no content type', () => {
      const parts = { 'xl/media/image1.png': 'png' }
      expect(lintWorkbook(workbook({ parts }))).toEqual([
        {
          rule: 'missing-content-type',
          part: 'xl/media/image1.png',
          ref: null,
          message: 'The part has no content type'
        }
      ])
    })
  })
})
