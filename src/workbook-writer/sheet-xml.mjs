/**
 * Cell-level editing of one worksheet part, as text.
 *
 * The worksheet XML is split into its rows once; only rows that are edited
 * are parsed into cells, and everything else — row attributes, cell styles,
 * formulas, the parts of the sheet around <sheetData> — is written back as
 * the exact text it was.
 */

const ROW_PATTERN = /<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g
const CELL_PATTERN = /<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g
const ALPHABET_SIZE = 26
const CHAR_CODE_A = 65

/** "A" → 1, "AA" → 27. */
export function columnIndex(letters) {
  let index = 0
  for (const ch of letters) {
    index = index * ALPHABET_SIZE + (ch.codePointAt(0) - CHAR_CODE_A + 1)
  }
  return index
}

export function splitRef(ref) {
  const match = /^([A-Z]+)(\d+)$/.exec(ref)
  if (!match) {
    throw new Error(`Not a cell reference: ${ref}`)
  }
  return { column: match[1], row: Number(match[2]) }
}

function escapeXml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function unescapeXml(text) {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

function attribute(tag, name) {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)
  return match ? match[1] : null
}

function openingTag(xml) {
  return xml.slice(0, xml.indexOf('>') + 1)
}

function styleAttr(cellXml) {
  const style = attribute(openingTag(cellXml), 's')
  return style === null ? '' : ` s="${style}"`
}

function hasFormula(cellXml) {
  return /<f[\s>/]/.test(cellXml)
}

function columnLetters(index) {
  let letters = ''
  let n = index
  while (n > 0) {
    const rem = (n - 1) % ALPHABET_SIZE
    letters = String.fromCodePoint(CHAR_CODE_A + rem) + letters
    n = Math.floor((n - 1) / ALPHABET_SIZE)
  }
  return letters
}

// A1 references outside string literals and quoted sheet names. A token
// followed by "(" is a function name (LOG10), not a reference.
const FORMULA_PARTS = /("(?:[^"]|"")*"|'(?:[^']|'')*')/
const A1_REFERENCE =
  /(?<![A-Za-z0-9_.])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g

/**
 * Move a formula's relative references by `rows` and `columns`, as Excel
 * does when it fills a shared formula into the cells of its range.
 */
export function shiftFormula(formula, rows, columns) {
  return formula
    .split(FORMULA_PARTS)
    .map((part, i) => {
      if (i % 2 === 1) {
        return part
      }
      return part.replaceAll(
        A1_REFERENCE,
        (_, colAbs, col, rowAbs, row) =>
          `${colAbs}${colAbs ? col : columnLetters(columnIndex(col) + columns)}` +
          `${rowAbs}${rowAbs ? row : Number(row) + rows}`
      )
    })
    .join('')
}

function sharedIndex(cellXml) {
  const tag = /<f\b[^>]*>/.exec(cellXml)?.[0] ?? ''
  if (!/\st="shared"/.test(tag)) {
    return null
  }
  return /\ssi="(\d+)"/.exec(tag)?.[1] ?? null
}

function isSharedMaster(cellXml, si) {
  return sharedIndex(cellXml) === si && /<f\b[^>]*\sref="/.test(cellXml)
}

/** A literal cell, keeping `style`. Strings go inline, not via sharedStrings. */
function literalCell(ref, style, value) {
  if (value === null || value === undefined || value === '') {
    return `<c r="${ref}"${style}/>`
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${ref}: cannot write non-finite number ${value}`)
    }
    return `<c r="${ref}"${style}><v>${value}</v></c>`
  }
  const text = escapeXml(String(value))
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`
}

/**
 * Drop a formula cell's cached result, keeping the formula. Its result type
 * attribute goes with it — an empty `t="str"` cell would claim a value it no
 * longer has.
 */
function withoutCachedValue(cellXml) {
  if (!hasFormula(cellXml) || !/<v[\s>/]/.test(cellXml)) {
    return cellXml
  }
  const tag = openingTag(cellXml)
  const bareTag = tag.replace(/\st="[^"]*"/, '')
  const body = cellXml.slice(tag.length).replace(/<v\/>|<v>[\s\S]*?<\/v>/, '')
  return bareTag + body
}

class Row {
  constructor(xml) {
    this.number = Number(attribute(openingTag(xml), 'r'))
    this.xml = xml
    this.cells = null
  }

  parse() {
    if (this.cells) {
      return
    }
    const open = openingTag(this.xml)
    this.open = open.endsWith('/>') ? `${open.slice(0, -2)}>` : open
    const body = open.endsWith('/>')
      ? ''
      : this.xml.slice(open.length, -'</row>'.length)
    this.cells = (body.match(CELL_PATTERN) ?? []).map((cellXml) => {
      const ref = attribute(openingTag(cellXml), 'r')
      return { column: columnIndex(splitRef(ref).column), ref, xml: cellXml }
    })
  }

  find(ref) {
    this.parse()
    return this.cells.find((cell) => cell.ref === ref) ?? null
  }

  put(ref, xml) {
    this.parse()
    const existing = this.find(ref)
    if (existing) {
      existing.xml = xml
      return
    }
    const column = columnIndex(splitRef(ref).column)
    const at = this.cells.findIndex((cell) => cell.column > column)
    const cell = { column, ref, xml }
    if (at === -1) {
      this.cells.push(cell)
    } else {
      this.cells.splice(at, 0, cell)
    }
  }

  toString() {
    if (!this.cells) {
      return this.xml
    }
    return `${this.open}${this.cells.map((cell) => cell.xml).join('')}</row>`
  }
}

/**
 * An editable view of one worksheet's XML.
 */
export class SheetXml {
  constructor(xml) {
    const start = xml.indexOf('<sheetData')
    const end = xml.indexOf('</sheetData>')
    if (start === -1 || end === -1) {
      throw new Error('Worksheet has no <sheetData> element')
    }
    const openEnd = xml.indexOf('>', start) + 1
    this.head = xml.slice(0, openEnd)
    this.tail = xml.slice(end)
    this.rows = (xml.slice(openEnd, end).match(ROW_PATTERN) ?? []).map(
      (rowXml) => new Row(rowXml)
    )
  }

  row(number, create = false) {
    let row = this.rows.find((r) => r.number === number)
    if (!row && create) {
      row = new Row(`<row r="${number}"/>`)
      const at = this.rows.findIndex((r) => r.number > number)
      this.rows.splice(at === -1 ? this.rows.length : at, 0, row)
    }
    return row ?? null
  }

  /** `{ formula, value }` for a cell, or null when the sheet has no such cell. */
  cell(ref) {
    const found = this.row(splitRef(ref).row)?.find(ref)
    if (!found) {
      return null
    }
    const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(found.xml)
    const cached = /<v>([\s\S]*?)<\/v>/.exec(found.xml)
    const raw = inline?.[1] ?? cached?.[1] ?? null
    return {
      formula: hasFormula(found.xml),
      sharedString: attribute(openingTag(found.xml), 't') === 's',
      value: raw === null ? null : unescapeXml(raw)
    }
  }

  /**
   * Write a literal into an input cell, keeping its style. Refuses to write
   * over a formula: an input column that turned out to be computed means the
   * layout is wrong, and overwriting it would quietly change the metric.
   */
  setValue(ref, value) {
    const row = this.row(splitRef(ref).row, true)
    const existing = row.find(ref)
    if (existing && hasFormula(existing.xml)) {
      throw new Error(`${ref} holds a formula, not an input`)
    }
    const style = existing ? styleAttr(existing.xml) : ''
    row.put(ref, literalCell(ref, style, value))
  }

  /**
   * Turn a shared formula group into one explicit formula per cell, so that
   * any of its cells can be overwritten without orphaning the others. A
   * group's first cell holds the formula text and the range; the rest only
   * point at it by index, so replacing that first cell would break them all.
   */
  unshare(si) {
    const members = this.sharedGroup(si)
    const master = members.find((cell) => isSharedMaster(cell.xml, si))
    if (!master) {
      throw new Error(`Shared formula ${si} has no master cell`)
    }
    const text = unescapeXml(/<f\b[^>]*>([\s\S]*?)<\/f>/.exec(master.xml)[1])
    const origin = splitRef(master.ref)
    for (const cell of members) {
      const at = splitRef(cell.ref)
      const formula = shiftFormula(
        text,
        at.row - origin.row,
        columnIndex(at.column) - columnIndex(origin.column)
      )
      cell.xml = cell.xml.replace(
        /<f\b[^>]*?(?:\/>|>[\s\S]*?<\/f>)/,
        `<f>${escapeXml(formula)}</f>`
      )
    }
  }

  /** Every cell of one shared formula group, wherever it sits. */
  sharedGroup(si) {
    const marker = `si="${si}"`
    return this.rows
      .filter((row) => row.xml.includes(marker))
      .flatMap((row) => {
        row.parse()
        return row.cells.filter((cell) => sharedIndex(cell.xml) === si)
      })
  }

  /**
   * Put a literal into a cell that holds a default formula a user is meant to
   * overwrite — the template's own convenience defaults, such as A-3's
   * proposed broad habitat, which starts as the baseline's.
   */
  overrideFormula(ref, value) {
    const row = this.row(splitRef(ref).row, true)
    const existing = row.find(ref)
    if (existing) {
      const si = sharedIndex(existing.xml)
      if (si !== null) {
        this.unshare(si)
      }
    }
    const current = row.find(ref)
    const style = current ? styleAttr(current.xml) : ''
    row.put(ref, literalCell(ref, style, value))
  }

  /** Empty an input cell, keeping its style. A missing cell is already empty. */
  clearValue(ref) {
    const row = this.row(splitRef(ref).row)
    const existing = row?.find(ref)
    if (!existing) {
      return
    }
    if (hasFormula(existing.xml)) {
      throw new Error(`${ref} holds a formula, not an input`)
    }
    row.put(ref, `<c r="${ref}"${styleAttr(existing.xml)}/>`)
  }

  /**
   * Remove every formula's cached result. A workbook that has not been
   * recalculated then reads as empty rather than as the template's old
   * answers — the stale-value failure BMD-1011 warned about becomes loud.
   */
  stripCachedValues() {
    for (const row of this.rows) {
      if (!/<f[\s>/]/.test(row.xml)) {
        continue
      }
      row.parse()
      for (const cell of row.cells) {
        cell.xml = withoutCachedValue(cell.xml)
      }
    }
  }

  toString() {
    return `${this.head}${this.rows.map(String).join('')}${this.tail}`
  }
}
