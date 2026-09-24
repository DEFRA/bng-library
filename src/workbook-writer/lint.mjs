/**
 * Structural checks for a generated workbook: the faults Excel "repairs" on
 * opening but LibreOffice and the spreadsheet libraries read straight past.
 *
 * Excel does not publish its repair rules, so this checks the ones a writer
 * that edits worksheet XML in place can break:
 *
 *   cached-value-type      a cell's value does not fit its type (a space in
 *                          a numeric cell, a shared-string index past the end)
 *   stale-calc-chain       xl/calcChain.xml names a cell with no formula
 *   broken-shared-formula  a shared formula's follower has no master, or
 *                          lies outside the master's range
 *   cell-order             rows or cells out of order, repeated, or a cell
 *                          filed under the wrong row
 *   missing-part           a relationship points at a part that is not there
 *   missing-content-type   a part has no content type
 *
 * A clean workbook returns an empty list.
 */

import path from 'node:path'
import { columnIndex, splitRef } from './sheet-xml.mjs'
import { readZip } from './xlsx-zip.mjs'

const WORKBOOK_PART = 'xl/workbook.xml'
const WORKBOOK_RELS_PART = 'xl/_rels/workbook.xml.rels'
const CALC_CHAIN_PART = 'xl/calcChain.xml'
const CONTENT_TYPES_PART = '[Content_Types].xml'
const SHARED_STRINGS_PART = 'xl/sharedStrings.xml'

const ROW_PATTERN = /<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g
const CELL_PATTERN = /<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g
const VALUE_PATTERN = /<v(?:\s[^>]*[^/])?>([\s\S]*?)<\/v>/
const FORMULA_PATTERN = /<f\b[^>]*?(?:\/>|>[\s\S]*?<\/f>)/
const NUMBER_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/
const BOOLEAN_VALUES = new Set(['0', '1'])

function attribute(tag, name) {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null
}

function openingTag(xml) {
  return xml.slice(0, xml.indexOf('>') + 1)
}

function text(zip, name) {
  return zip.read(name).toString('utf8')
}

function issue(rule, part, ref, message) {
  return { rule, part, ref, message }
}

/** "xl/a.XML" → "xml"; "_rels/.rels" → "rels", which path.extname would miss. */
function extension(name) {
  const base = path.posix.basename(name)
  const dot = base.lastIndexOf('.')
  return dot === -1 ? '' : base.slice(dot + 1).toLowerCase()
}

/** Every part's content type comes from an Override or its extension's Default. */
function lintContentTypes(zip) {
  const types = text(zip, CONTENT_TYPES_PART)
  const defaults = new Set(
    [...types.matchAll(/<Default\b[^>]*\sExtension="([^"]+)"/g)].map((m) =>
      m[1].toLowerCase()
    )
  )
  const overrides = new Set(
    [...types.matchAll(/<Override\b[^>]*\sPartName="([^"]+)"/g)].map((m) =>
      m[1].slice(1)
    )
  )
  return zip.names
    .filter((name) => name !== CONTENT_TYPES_PART && !name.endsWith('/'))
    .filter((name) => !overrides.has(name) && !defaults.has(extension(name)))
    .map((name) =>
      issue('missing-content-type', name, null, 'The part has no content type')
    )
}

/** Where a .rels file's relative targets resolve from. */
function relsBaseDir(relsName) {
  const dir = path.posix.dirname(path.posix.dirname(relsName))
  return dir === '.' ? '' : dir
}

function resolveTarget(relsName, target) {
  if (target.startsWith('/')) {
    return target.slice(1)
  }
  return path.posix.normalize(path.posix.join(relsBaseDir(relsName), target))
}

/** Every internal relationship, in every .rels part, points at a real part. */
function lintRelationships(zip) {
  const issues = []
  for (const name of zip.names.filter((n) => n.endsWith('.rels'))) {
    for (const [tag] of text(zip, name).matchAll(/<Relationship\b[^>]*>/g)) {
      const target = attribute(tag, 'Target')
      if (attribute(tag, 'TargetMode') === 'External' || !target) {
        continue
      }
      const resolved = resolveTarget(name, decodeURI(target))
      if (!zip.has(resolved)) {
        issues.push(
          issue(
            'missing-part',
            name,
            attribute(tag, 'Id'),
            `No part ${resolved}`
          )
        )
      }
    }
  }
  return issues
}

/** sheetId → worksheet part, as xl/workbook.xml and its relationships say. */
function worksheetParts(zip) {
  const targets = new Map()
  for (const [tag] of text(zip, WORKBOOK_RELS_PART).matchAll(
    /<Relationship\b[^>]*>/g
  )) {
    targets.set(attribute(tag, 'Id'), attribute(tag, 'Target'))
  }
  const parts = new Map()
  for (const [tag] of text(zip, WORKBOOK_PART).matchAll(/<sheet\b[^>]*>/g)) {
    const target = targets.get(attribute(tag, 'r:id'))
    if (target) {
      parts.set(
        attribute(tag, 'sheetId'),
        resolveTarget(WORKBOOK_RELS_PART, target)
      )
    }
  }
  return parts
}

function sharedStringCount(zip) {
  if (!zip.has(SHARED_STRINGS_PART)) {
    return 0
  }
  return (text(zip, SHARED_STRINGS_PART).match(/<si[\s>/]/g) ?? []).length
}

/** Why a cell's cached value does not fit its type, or null when it does. */
function valueProblem(type, value, stringCount) {
  if (type === 'n') {
    return NUMBER_PATTERN.test(value) ? null : 'is not a number'
  }
  if (type === 'b') {
    return BOOLEAN_VALUES.has(value) ? null : 'is not 0 or 1'
  }
  if (type === 's') {
    const index = Number(value)
    return Number.isInteger(index) && index >= 0 && index < stringCount
      ? null
      : `is not a shared string index (0–${stringCount - 1})`
  }
  return null
}

function parseRange(range) {
  const [from, to = from] = range.split(':').map(splitRef)
  return {
    top: from.row,
    bottom: to.row,
    left: columnIndex(from.column),
    right: columnIndex(to.column)
  }
}

function inRange(range, ref) {
  const { column, row } = splitRef(ref)
  const col = columnIndex(column)
  return (
    row >= range.top &&
    row <= range.bottom &&
    col >= range.left &&
    col <= range.right
  )
}

/** A cell's cached-value problem, as an issue, or null. */
function cellValueIssue(part, ref, tag, cellXml, stringCount) {
  const value = VALUE_PATTERN.exec(cellXml)?.[1]
  if (value === undefined) {
    return null
  }
  const problem = valueProblem(attribute(tag, 't') ?? 'n', value, stringCount)
  return problem
    ? issue(
        'cached-value-type',
        part,
        ref,
        `Value ${JSON.stringify(value)} ${problem}`
      )
    : null
}

function scanCell(sheet, rowNumber, cellXml) {
  const tag = openingTag(cellXml)
  const ref = attribute(tag, 'r')
  if (!ref) {
    // Legal, but every writer this lints gives each cell its reference.
    sheet.issues.push(
      issue(
        'cell-order',
        sheet.part,
        null,
        `A cell in row ${rowNumber} has no reference`
      )
    )
    return
  }
  const { column, row } = splitRef(ref)
  const col = columnIndex(column)
  if (row !== rowNumber || col <= sheet.lastColumn) {
    sheet.issues.push(
      issue(
        'cell-order',
        sheet.part,
        ref,
        `Cell is out of place in row ${rowNumber}`
      )
    )
  }
  sheet.lastColumn = col
  const formula = FORMULA_PATTERN.exec(cellXml)?.[0]
  if (formula) {
    sheet.formulas.add(ref)
    noteShared(formula, ref, sheet.masters, sheet.followers)
  }
  const valueIssue = cellValueIssue(
    sheet.part,
    ref,
    tag,
    cellXml,
    sheet.stringCount
  )
  if (valueIssue) {
    sheet.issues.push(valueIssue)
  }
}

function scanRow(sheet, rowXml) {
  const rowNumber = Number(attribute(openingTag(rowXml), 'r'))
  if (rowNumber <= sheet.lastRow) {
    sheet.issues.push(
      issue(
        'cell-order',
        sheet.part,
        `row ${rowNumber}`,
        `Row follows row ${sheet.lastRow}`
      )
    )
  }
  sheet.lastRow = rowNumber
  sheet.lastColumn = 0
  for (const [cellXml] of rowXml.matchAll(CELL_PATTERN)) {
    scanCell(sheet, rowNumber, cellXml)
  }
}

/**
 * One pass over a worksheet: the cells that hold a formula, and every
 * value, order and shared-formula problem found on the way.
 */
function scanWorksheet(part, xml, stringCount) {
  const sheet = {
    part,
    stringCount,
    formulas: new Set(),
    issues: [],
    masters: new Map(),
    followers: [],
    lastRow: 0,
    lastColumn: 0
  }
  for (const [rowXml] of xml.matchAll(ROW_PATTERN)) {
    scanRow(sheet, rowXml)
  }
  sheet.issues.push(
    ...sharedFormulaIssues(part, sheet.masters, sheet.followers)
  )
  return { formulas: sheet.formulas, issues: sheet.issues }
}

function noteShared(formula, ref, masters, followers) {
  const tag = openingTag(formula)
  if (attribute(tag, 't') !== 'shared') {
    return
  }
  const si = attribute(tag, 'si')
  const range = attribute(tag, 'ref')
  if (range) {
    masters.set(si, parseRange(range))
  } else {
    followers.push({ si, ref })
  }
}

function sharedFormulaIssues(part, masters, followers) {
  const issues = []
  for (const { si, ref } of followers) {
    const range = masters.get(si)
    if (!range) {
      issues.push(
        issue(
          'broken-shared-formula',
          part,
          ref,
          `Shared formula ${si} has no master cell`
        )
      )
    } else if (!inRange(range, ref)) {
      issues.push(
        issue(
          'broken-shared-formula',
          part,
          ref,
          `Outside shared formula ${si}'s range`
        )
      )
    }
  }
  return issues
}

/** Every calc-chain entry names a cell that holds a formula. */
function lintCalcChain(zip, formulasBySheetId) {
  if (!zip.has(CALC_CHAIN_PART)) {
    return []
  }
  const issues = []
  let sheetId = null
  for (const [tag] of text(zip, CALC_CHAIN_PART).matchAll(/<c\b[^>]*>/g)) {
    sheetId = attribute(tag, 'i') ?? sheetId
    const ref = attribute(tag, 'r')
    const formulas = formulasBySheetId.get(sheetId)
    if (!formulas?.has(ref)) {
      issues.push(
        issue(
          'stale-calc-chain',
          CALC_CHAIN_PART,
          ref,
          `Sheet ${sheetId} has no formula in ${ref}`
        )
      )
    }
  }
  return issues
}

/**
 * @param {Buffer|ReturnType<typeof readZip>} workbook the .xlsx bytes, or a
 *   zip already read
 * @returns {{ rule: string, part: string, ref: string|null, message: string }[]}
 */
export function lintWorkbook(workbook) {
  const zip = Buffer.isBuffer(workbook) ? readZip(workbook) : workbook
  const stringCount = sharedStringCount(zip)
  const issues = [...lintContentTypes(zip), ...lintRelationships(zip)]
  const formulasBySheetId = new Map()
  for (const [sheetId, part] of worksheetParts(zip)) {
    if (!zip.has(part)) {
      continue
    }
    const scan = scanWorksheet(part, text(zip, part), stringCount)
    formulasBySheetId.set(sheetId, scan.formulas)
    issues.push(...scan.issues)
  }
  issues.push(...lintCalcChain(zip, formulasBySheetId))
  return issues
}
