import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { readZip, writeZip } from '../src/workbook-writer/xlsx-zip.mjs'
import { csvToSheet } from '../src/workbook-writer/csv-sheets.mjs'
import {
  SheetXml,
  columnIndex,
  shiftFormula
} from '../src/workbook-writer/sheet-xml.mjs'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

function smallWorkbook() {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['a', 1],
      ['b', 2]
    ]),
    'One'
  )
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
}

function sheet(rows) {
  return new SheetXml(
    `<worksheet><sheetData>${rows}</sheetData><dataValidations count="0"/></worksheet>`
  )
}

describe('xlsx-zip', () => {
  it('writes back every entry unchanged when nothing is replaced', () => {
    const original = readZip(smallWorkbook())
    const copy = readZip(writeZip(original, new Map()))
    expect(copy.names).toEqual(original.names)
    for (const name of original.names) {
      expect(copy.read(name).equals(original.read(name))).toBe(true)
    }
  })

  it('replaces only the named entry', () => {
    const original = readZip(smallWorkbook())
    const target = original.names.find((n) => n.endsWith('sheet1.xml'))
    const copy = readZip(
      writeZip(original, new Map([[target, '<worksheet>new</worksheet>']]))
    )
    expect(copy.read(target).toString()).toBe('<worksheet>new</worksheet>')
    const others = original.names.filter((n) => n !== target)
    for (const name of others) {
      expect(copy.read(name).equals(original.read(name))).toBe(true)
    }
  })

  it('stays readable by a spreadsheet library', () => {
    const original = readZip(smallWorkbook())
    const workbook = XLSX.read(writeZip(original, new Map()), {
      type: 'buffer'
    })
    expect(workbook.Sheets.One.B2.v).toBe(2)
  })

  it('leaves out the entries named for removal', () => {
    const original = readZip(smallWorkbook())
    const target = original.names.find((n) => n.endsWith('theme1.xml'))
    const copy = readZip(writeZip(original, new Map(), new Set([target])))
    expect(copy.names).toEqual(original.names.filter((n) => n !== target))
    const workbook = XLSX.read(
      writeZip(original, new Map(), new Set([target])),
      {
        type: 'buffer'
      }
    )
    expect(workbook.Sheets.One.B2.v).toBe(2)
  })

  it('refuses to remove an entry that is not there', () => {
    const original = readZip(smallWorkbook())
    expect(() => writeZip(original, new Map(), new Set(['nope.xml']))).toThrow(
      /not in the zip/
    )
  })

  it('refuses to replace an entry that is not there', () => {
    const original = readZip(smallWorkbook())
    expect(() => writeZip(original, new Map([['nope.xml', 'x']]))).toThrow(
      /not in the zip/
    )
  })
})

describe('SheetXml', () => {
  it('writes a string inline, escaped, keeping the cell style', () => {
    const s = sheet('<row r="3"><c r="B3" s="7"/></row>')
    s.setValue('B3', 'Area/compensation <&> "x"')
    expect(s.toString()).toContain(
      '<c r="B3" s="7" t="inlineStr"><is><t xml:space="preserve">Area/compensation &lt;&amp;&gt; &quot;x&quot;</t></is></c>'
    )
    expect(s.cell('B3').value).toBe('Area/compensation <&> "x"')
  })

  it('writes numbers, and inserts missing cells and rows in order', () => {
    const s = sheet('<row r="2"><c r="A2"/><c r="C2"/></row>')
    s.setValue('B2', 1.5)
    s.setValue('A1', 4)
    expect(s.toString()).toBe(
      '<worksheet><sheetData><row r="1"><c r="A1"><v>4</v></c></row><row r="2"><c r="A2"/><c r="B2"><v>1.5</v></c><c r="C2"/></row></sheetData><dataValidations count="0"/></worksheet>'
    )
  })

  it('refuses to overwrite or clear a formula', () => {
    const s = sheet('<row r="1"><c r="A1"><f>B1*2</f><v>4</v></c></row>')
    expect(() => s.setValue('A1', 3)).toThrow(/formula/)
    expect(() => s.clearValue('A1')).toThrow(/formula/)
  })

  it('clears an input to an empty, still-styled cell', () => {
    const s = sheet('<row r="1"><c r="A1" s="3" t="s"><v>12</v></c></row>')
    s.clearValue('A1')
    expect(s.toString()).toContain('<c r="A1" s="3"/>')
  })

  it('strips cached formula results and their type, keeping literals', () => {
    const s = sheet(
      '<row r="1"><c r="A1" t="str"><f>B1</f><v>old</v></c><c r="B1" t="s"><v>0</v></c></row>'
    )
    s.stripCachedValues()
    expect(s.toString()).toContain('<c r="A1"><f>B1</f></c>')
    expect(s.toString()).toContain('<c r="B1" t="s"><v>0</v></c>')
  })

  it('strips a cached result written with xml:space, leaving no untyped text', () => {
    const s = sheet(
      '<row r="16"><c r="K16" s="637" t="str"><f>IF(J16&gt;0," ","Short")</f><v xml:space="preserve"> </v></c><c r="L16" t="str"><f>K16</f><v xml:space="preserve"/></c></row>'
    )
    s.stripCachedValues()
    expect(s.toString()).toContain(
      '<c r="K16" s="637"><f>IF(J16&gt;0," ","Short")</f></c>'
    )
    expect(s.toString()).toContain('<c r="L16"><f>K16</f></c>')
    expect(s.toString()).not.toContain('<v')
  })

  it('reads a cached value written with xml:space', () => {
    const s = sheet(
      '<row r="1"><c r="A1" t="str"><f>B1</f><v xml:space="preserve"> padded </v></c></row>'
    )
    expect(s.cell('A1').value).toBe(' padded ')
  })

  it('overrides a shared formula without orphaning the rest of its group', () => {
    const s = sheet(
      [
        '<row r="16"><c r="Q16" s="1" t="str"><f t="shared" ref="Q16:Q18" si="10">A16</f><v/></c></row>',
        '<row r="17"><c r="Q17" s="1" t="str"><f t="shared" si="10"/><v/></c></row>',
        '<row r="18"><c r="Q18" s="1" t="str"><f t="shared" si="10"/><v/></c></row>'
      ].join('')
    )
    s.overrideFormula('Q16', 'Grassland')
    const xml = s.toString()
    expect(xml).toContain(
      '<c r="Q16" s="1" t="inlineStr"><is><t xml:space="preserve">Grassland</t></is></c>'
    )
    expect(xml).toContain('<f>A17</f>')
    expect(xml).toContain('<f>A18</f>')
    expect(xml).not.toContain('si="10"')
  })

  it('replaces a formula it was told to expect, keeping the style', () => {
    const s = sheet(
      '<row r="91"><c r="K91" s="5"><f>K90+K88</f><v>-3</v></c></row>'
    )
    s.replaceFormula('K91', 'K90+K88', 'IF(K90>0,K90,0)+K88')
    expect(s.toString()).toContain(
      '<c r="K91" s="5"><f>IF(K90&gt;0,K90,0)+K88</f></c>'
    )
    expect(s.formula('K91')).toBe('IF(K90>0,K90,0)+K88')
  })

  it('refuses to replace a formula other than the one expected', () => {
    const s = sheet(
      '<row r="1"><c r="A1"><f>B1*3</f></c><c r="B1"><v>2</v></c></row>'
    )
    expect(() => s.replaceFormula('A1', 'B1*2', 'B1')).toThrow(
      'A1 holds =B1*3, not =B1*2'
    )
    expect(() => s.replaceFormula('B1', 'B1*2', 'B1')).toThrow(
      'B1 holds no formula'
    )
    expect(() => s.replaceFormula('C9', 'B1*2', 'B1')).toThrow(
      'C9 holds no formula'
    )
  })

  it('refuses to replace one cell of a shared formula', () => {
    const s = sheet(
      '<row r="1"><c r="A1"><f t="shared" ref="A1:A2" si="0">B1</f></c></row>'
    )
    expect(() => s.replaceFormula('A1', 'B1', 'C1')).toThrow(/shared/)
  })
})

describe('shiftFormula', () => {
  it('moves relative references and leaves absolute ones', () => {
    expect(shiftFormula('A16', 1, 0)).toBe('A17')
    expect(shiftFormula('$A$1+B2+$C3+D$4', 2, 1)).toBe('$A$1+C4+$C5+E$4')
  })

  it('leaves string literals, sheet names and function names alone', () => {
    expect(shiftFormula(`IF(A1="B2",'A-1 Sheet'!AL11,LOG10(C3))`, 1, 0)).toBe(
      `IF(A2="B2",'A-1 Sheet'!AL12,LOG10(C4))`
    )
  })

  it('carries column letters over Z', () => {
    expect(shiftFormula('Z1', 0, 1)).toBe('AA1')
    expect(columnIndex('AA')).toBe(27)
  })
})

describe('csvToSheet', () => {
  it('reads LibreOffice’s unformatted export back into typed cells', () => {
    const sheet = csvToSheet(
      [
        ',Area habitat units,23.1012163586322,14.8084720247642%',
        '"On-site\npost-intervention","say ""hi""",#REF!,Check Data ⚠',
        ''
      ].join('\n')
    )
    expect(sheet.B1).toEqual({ t: 's', v: 'Area habitat units' })
    expect(sheet.C1).toEqual({ t: 'n', v: 23.1012163586322 })
    expect(sheet.D1.t).toBe('n')
    expect(sheet.D1.v).toBeCloseTo(0.148084720247642, 15)
    expect(sheet.A2.v).toBe('On-site\npost-intervention')
    expect(sheet.B2.v).toBe('say "hi"')
    expect(sheet.C2).toEqual({ t: 'e', v: '#REF!', w: '#REF!' })
    expect(sheet.A1).toBeUndefined()
    expect(sheet['!ref']).toBe('A1:D2')
  })
})
