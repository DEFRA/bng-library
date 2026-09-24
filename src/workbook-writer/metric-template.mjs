/**
 * An editable Statutory Biodiversity Metric v4 workbook.
 *
 * Wraps the zip and the worksheet parts: a sheet is looked up by its display
 * name, parsed on first use, and only the parts that were touched are
 * rewritten on the way out.
 */

import { SheetXml } from './sheet-xml.mjs'
import { METRIC_SHEETS } from './template-layout.mjs'
import { readZip, writeZip } from './xlsx-zip.mjs'

const WORKBOOK_PART = 'xl/workbook.xml'
const WORKBOOK_RELS_PART = 'xl/_rels/workbook.xml.rels'
const SHARED_STRINGS_PART = 'xl/sharedStrings.xml'
const CALC_CHAIN_PART = 'xl/calcChain.xml'
const CONTENT_TYPES_PART = '[Content_Types].xml'

function decodeEntities(text) {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

function readSharedStrings(zip) {
  if (!zip.has(SHARED_STRINGS_PART)) {
    return []
  }
  const xml = zip.read(SHARED_STRINGS_PART).toString('utf8')
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, item]) =>
    decodeEntities(
      [...item.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(([, t]) => t).join('')
    )
  )
}

function readSheetParts(zip) {
  const workbook = zip.read(WORKBOOK_PART).toString('utf8')
  const rels = zip.read(WORKBOOK_RELS_PART).toString('utf8')
  const targets = new Map()
  for (const [tag] of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\sId="([^"]+)"/.exec(tag)?.[1]
    const target = /\sTarget="([^"]+)"/.exec(tag)?.[1]
    targets.set(id, target)
  }
  const parts = new Map()
  for (const [tag] of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeEntities(/\sname="([^"]+)"/.exec(tag)[1])
    const id = /\sr:id="([^"]+)"/.exec(tag)[1]
    const target = targets.get(id)
    parts.set(name, target.startsWith('/') ? target.slice(1) : `xl/${target}`)
  }
  return { workbook, parts }
}

/** Collapse runs of whitespace so a header's line breaks don't matter. */
function normaliseHeader(text) {
  return (text ?? '').replaceAll(/\s+/g, ' ').trim()
}

export class MetricTemplate {
  /** @param {Buffer} buffer the .xlsx bytes */
  constructor(buffer) {
    this.zip = readZip(buffer)
    const { workbook, parts } = readSheetParts(this.zip)
    this.workbookXml = workbook
    this.parts = parts
    this.sharedStrings = readSharedStrings(this.zip)
    this.sheets = new Map()
    this.workbookChanged = false
  }

  sheetNames() {
    return [...this.parts.keys()]
  }

  /** The editable sheet with this display name. */
  sheet(name) {
    if (!this.sheets.has(name)) {
      const part = this.parts.get(name)
      if (!part) {
        throw new Error(`The workbook has no sheet named ${name}`)
      }
      this.sheets.set(name, new SheetXml(this.zip.read(part).toString('utf8')))
    }
    return this.sheets.get(name)
  }

  /** A cell's text as the template holds it, resolving shared strings. */
  text(sheetName, ref) {
    const cell = this.sheet(sheetName).cell(ref)
    if (!cell || cell.value === null) {
      return null
    }
    return cell.sharedString
      ? this.sharedStrings[Number(cell.value)]
      : cell.value
  }

  /**
   * Check every layout fingerprint and return the mismatches. An empty list
   * means the template is laid out the way `METRIC_SHEETS` expects.
   */
  layoutMismatches() {
    const mismatches = []
    for (const layout of Object.values(METRIC_SHEETS)) {
      for (const [ref, expected] of Object.entries(layout.fingerprint)) {
        const actual = normaliseHeader(this.text(layout.sheet, ref))
        if (actual !== normaliseHeader(expected)) {
          mismatches.push({ sheet: layout.sheet, ref, expected, actual })
        }
      }
    }
    return mismatches
  }

  /**
   * Ask Excel to recalculate everything when the file is opened, so a human
   * opening a generated workbook never sees an empty or stale result.
   */
  setFullCalcOnLoad() {
    const calcPr = /<calcPr\b[^>]*?\/?>/.exec(this.workbookXml)
    if (!calcPr) {
      this.workbookXml = this.workbookXml.replace(
        '</workbook>',
        '<calcPr fullCalcOnLoad="1"/></workbook>'
      )
    } else if (!/\sfullCalcOnLoad=/.test(calcPr[0])) {
      const tag = calcPr[0].replace(/\s*(\/?)>$/, ' fullCalcOnLoad="1"$1>')
      this.workbookXml = this.workbookXml.replace(calcPr[0], tag)
    }
    this.workbookChanged = true
  }

  /** Strip every formula's cached result, in every worksheet. */
  stripCachedValues() {
    for (const name of this.parts.keys()) {
      this.sheet(name).stripCachedValues()
    }
  }

  toBuffer() {
    const replacements = new Map()
    for (const [name, sheet] of this.sheets) {
      replacements.set(this.parts.get(name), sheet.toString())
    }
    if (this.workbookChanged) {
      replacements.set(WORKBOOK_PART, this.workbookXml)
    }
    return writeZip(this.zip, replacements, this.withoutCalcChain(replacements))
  }

  /**
   * Leave out the calculation chain, Excel's list of every formula cell.
   * Overriding a default formula leaves it naming cells that no longer hold
   * one, and Excel then "repairs" the workbook on opening. Without the part
   * Excel rebuilds the chain silently. Its relationship and content type go
   * with it, so nothing refers to a missing part.
   *
   * @param {Map<string, string>} replacements added to in place
   * @returns {Set<string>} the parts to remove
   */
  withoutCalcChain(replacements) {
    if (!this.zip.has(CALC_CHAIN_PART)) {
      return new Set()
    }
    const rels = this.zip.read(WORKBOOK_RELS_PART).toString('utf8')
    replacements.set(
      WORKBOOK_RELS_PART,
      rels.replace(
        /<Relationship\b[^>]*Target="[^"]*calcChain\.xml"[^>]*\/>/,
        ''
      )
    )
    const types = this.zip.read(CONTENT_TYPES_PART).toString('utf8')
    replacements.set(
      CONTENT_TYPES_PART,
      types.replace(
        /<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/,
        ''
      )
    )
    return new Set([CALC_CHAIN_PART])
  }
}
