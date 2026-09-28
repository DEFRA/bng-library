import { describe, expect, it } from 'vitest'
import { lintWorkbook } from '../src/workbook-writer/lint.mjs'
import { readWorkbookValues } from '../src/workbook-writer/read-values.mjs'
import {
  normaliseSavedWorkbook,
  removeDanglingRelationships
} from '../src/workbook-writer/repair.mjs'
import { createZip, readZip } from '../src/workbook-writer/xlsx-zip.mjs'

const CONTENT_TYPES = `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>`

function workbook(sheetXml, extra = []) {
  return createZip(
    new Map([
      ['[Content_Types].xml', CONTENT_TYPES],
      [
        '_rels/.rels',
        `<Relationships><Relationship Id="rId1" Type="officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId9" Type="customXml" Target="customXml/item1.xml"/><Relationship Id="rId10" Type="hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>`
      ],
      [
        'xl/workbook.xml',
        '<workbook xmlns:r="r"><sheets><sheet name="Headline &amp; more" sheetId="1" r:id="rId1"/></sheets></workbook>'
      ],
      [
        'xl/_rels/workbook.xml.rels',
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'
      ],
      [
        'xl/sharedStrings.xml',
        '<sst><si><t>Yes ✓</t></si><si><r><t>No </t></r><r><t>▲</t></r></si></sst>'
      ],
      [
        'xl/worksheets/sheet1.xml',
        `<worksheet><sheetData>${sheetXml}</sheetData></worksheet>`
      ],
      ...extra
    ])
  )
}

describe('readWorkbookValues', () => {
  const { Sheets } = readWorkbookValues(
    workbook(
      '<row r="1"><c r="A1"><v>1.5</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="str"><f>X</f><v>a &amp; b</v></c><c r="D1" t="inlineStr"><is><t>inline</t></is></c></row>' +
        '<row r="3"><c r="A3" t="b"><v>1</v></c><c r="B3" t="e"><v>#REF!</v></c><c r="C3"><f>1+1</f></c><c r="E3" s="2"/></row>'
    ),
    ['Headline & more', 'Missing']
  )
  const sheet = Sheets['Headline & more']

  it('reads each kind of saved value', () => {
    expect(sheet.A1).toEqual({ t: 'n', v: 1.5 })
    expect(sheet.B1).toEqual({ t: 's', v: 'No ▲' })
    expect(sheet.C1).toEqual({ t: 's', v: 'a & b' })
    expect(sheet.D1).toEqual({ t: 's', v: 'inline' })
    expect(sheet.A3).toEqual({ t: 'b', v: true })
    expect(sheet.B3).toEqual({ t: 'e', v: '#REF!', w: '#REF!' })
  })

  it('reads a formula saved without its value as empty', () => {
    expect(sheet.C3).toBeUndefined()
    expect(sheet.E3).toBeUndefined()
  })

  it('records the used range and skips sheets the workbook lacks', () => {
    expect(sheet['!ref']).toBe('A1:D3')
    expect(Sheets.Missing).toBeUndefined()
  })
})

describe('removeDanglingRelationships', () => {
  const damaged = workbook('<row r="1"><c r="A1"><v>1</v></c></row>')

  it('removes relationships to parts that are not there, and only those', () => {
    expect(lintWorkbook(damaged).map((i) => i.rule)).toContain('missing-part')
    const repaired = removeDanglingRelationships(damaged)
    const rels = readZip(repaired).read('_rels/.rels').toString('utf8')
    expect(rels).toContain('Id="rId1"')
    expect(rels).toContain('TargetMode="External"')
    expect(rels).not.toContain('customXml')
    expect(
      lintWorkbook(repaired).filter((i) => i.rule === 'missing-part')
    ).toEqual([])
  })

  it('leaves a workbook with nothing to repair untouched', () => {
    const repaired = removeDanglingRelationships(damaged)
    expect(removeDanglingRelationships(repaired)).toBe(repaired)
  })
})

describe('normaliseSavedWorkbook', () => {
  const saved = (guidA, guidB, axis) =>
    workbook(`<row r="1"><c r="A1"><v>1</v></c></row>`, [
      [
        'xl/worksheets/sheet2.xml',
        `<worksheet><x14:cfRule id="${guidA}"/><x14:id>${guidA}</x14:id><x14:cfRule id="${guidB}"/></worksheet>`
      ],
      [
        'xl/charts/chart1.xml',
        `<c:axId val="${axis}"/><c:axId val="7"/><c:crossAx val="${axis}"/>`
      ]
    ])
  const first = normaliseSavedWorkbook(
    saved(
      '{B4A6FC90-2E1A-4ABF-B744-A133402B2B5A}',
      '{11111111-2222-3333-4444-555555555555}',
      13929232
    )
  )
  const second = normaliseSavedWorkbook(
    saved(
      '{575A1557-9683-4EC3-BACA-603243D6B796}',
      '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}',
      92334772
    )
  )

  it('gives the same bytes for saves that differ only in made-up identifiers', () => {
    expect(Buffer.compare(first, second)).toBe(0)
  })

  it('keeps what refers to what', () => {
    const zip = readZip(first)
    const sheet = zip.read('xl/worksheets/sheet2.xml').toString('utf8')
    const [a, b] = [...sheet.matchAll(/id="(\{[^}]+\})"/g)].map(([, g]) => g)
    expect(a).not.toBe(b)
    expect(sheet).toContain(`<x14:id>${a}</x14:id>`)
    const chart = zip.read('xl/charts/chart1.xml').toString('utf8')
    const [axis, other, crossed] = [...chart.matchAll(/val="(\d+)"/g)].map(
      ([, v]) => v
    )
    expect(crossed).toBe(axis)
    expect(other).not.toBe(axis)
  })

  it('also removes relationships to missing parts', () => {
    expect(
      lintWorkbook(first).filter((i) => i.rule === 'missing-part')
    ).toEqual([])
  })
})
