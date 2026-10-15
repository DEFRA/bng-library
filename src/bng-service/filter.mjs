/**
 * The small part of the QGIS expression language the template's drop-down
 * filters use: comparisons with `=` or `IN (...)` between list columns
 * ("Name"), strings, and the functions current_value(), concat() and
 * coalesce(), joined by AND, OR and NOT, with brackets. Anything else is
 * refused rather than guessed at.
 *
 * Evaluated as QGIS does: a comparison with a blank side is NULL, NULL keeps
 * a list row out, and concat() reads a blank as empty text. A port of the
 * template repository's `scale-test-nsip/generator/dropdown_check.py`.
 */

const TOKEN = /\s*(?:("[^"]*")|('(?:[^']|'')*')|([A-Za-z_]+)|(\S))/y
const FUNCTIONS = new Set(['current_value', 'concat', 'coalesce'])

/** A blank (null, undefined or '') read as NULL. */
export const blankToNull = (value) =>
  value === null || value === undefined || value === '' ? null : value

function tokenise(text) {
  const tokens = []
  TOKEN.lastIndex = 0
  const source = text.trim()
  while (TOKEN.lastIndex < source.length) {
    const match = TOKEN.exec(source)
    if (!match) {
      break
    }
    const [, column, string, name, punct] = match
    tokens.push({ column, string, name, punct })
  }
  return tokens
}

class Parser {
  constructor(text) {
    this.text = text
    this.tokens = tokenise(text)
    this.pos = 0
  }

  fail() {
    throw new Error(`unsupported filter: ${JSON.stringify(this.text)}`)
  }

  peek() {
    return this.tokens[this.pos]
  }

  take() {
    const token = this.tokens[this.pos]
    if (!token) {
      this.fail()
    }
    this.pos += 1
    return token
  }

  expect(punct) {
    if (this.take().punct !== punct) {
      this.fail()
    }
  }

  keyword(word) {
    const token = this.peek()
    if (token?.name?.toUpperCase() === word) {
      this.pos += 1
      return true
    }
    return false
  }

  parse() {
    const tree = this.or()
    if (this.pos !== this.tokens.length) {
      this.fail()
    }
    return tree
  }

  or() {
    const terms = [this.and()]
    while (this.keyword('OR')) {
      terms.push(this.and())
    }
    return terms.length > 1 ? { kind: 'or', terms } : terms[0]
  }

  and() {
    const terms = [this.not()]
    while (this.keyword('AND')) {
      terms.push(this.not())
    }
    return terms.length > 1 ? { kind: 'and', terms } : terms[0]
  }

  not() {
    if (this.keyword('NOT')) {
      return { kind: 'not', term: this.not() }
    }
    if (this.peek()?.punct === '(') {
      this.pos += 1
      const inner = this.or()
      this.expect(')')
      return inner
    }
    const left = this.operand()
    if (this.keyword('IN')) {
      return { kind: 'in', left, items: this.operandList() }
    }
    this.expect('=')
    return { kind: 'eq', left, right: this.operand() }
  }

  operandList() {
    this.expect('(')
    const items = [this.operand()]
    for (;;) {
      const { punct } = this.take()
      if (punct === ')') {
        return items
      }
      if (punct !== ',') {
        this.fail()
      }
      items.push(this.operand())
    }
  }

  operand() {
    const { column, string, name } = this.take()
    if (column) {
      return { kind: 'column', name: column.slice(1, -1) }
    }
    if (string) {
      return { kind: 'str', value: string.slice(1, -1).replaceAll("''", "'") }
    }
    if (!FUNCTIONS.has(name)) {
      throw new Error(
        `unsupported function ${name} in ${JSON.stringify(this.text)}`
      )
    }
    return { kind: name, args: this.operandList() }
  }
}

function value(node, entry, row) {
  switch (node.kind) {
    case 'str':
      return node.value
    case 'column':
      return blankToNull(entry[node.name])
    case 'current_value':
      return blankToNull(row[node.args[0].value])
    case 'coalesce':
      return (
        node.args.map((a) => value(a, entry, row)).find((v) => v !== null) ??
        null
      )
    default:
      return node.args.map((a) => value(a, entry, row) ?? '').join('')
  }
}

function inList(left, items) {
  if (left === null) {
    return null
  }
  if (items.includes(left)) {
    return true
  }
  return items.includes(null) ? null : false
}

/** True, false or null (NULL), with SQL's three-valued logic. */
function truth(node, entry, row) {
  switch (node.kind) {
    case 'eq': {
      const left = value(node.left, entry, row)
      const right = value(node.right, entry, row)
      return left === null || right === null ? null : left === right
    }
    case 'in':
      return inList(
        value(node.left, entry, row),
        node.items.map((item) => value(item, entry, row))
      )
    case 'not': {
      const inner = truth(node.term, entry, row)
      return inner === null ? null : !inner
    }
    default: {
      const results = node.terms.map((t) => truth(t, entry, row))
      const decisive = node.kind === 'or'
      if (results.includes(decisive)) {
        return decisive
      }
      return results.includes(null) ? null : !decisive
    }
  }
}

function fieldsOf(node) {
  switch (node.kind) {
    case 'str':
    case 'column':
      return []
    case 'current_value':
      return [node.args[0].value]
    case 'not':
      return fieldsOf(node.term)
    case 'eq':
      return [...fieldsOf(node.left), ...fieldsOf(node.right)]
    case 'in':
      return [...fieldsOf(node.left), ...node.items.flatMap(fieldsOf)]
    case 'and':
    case 'or':
      return node.terms.flatMap(fieldsOf)
    default:
      return node.args.flatMap(fieldsOf)
  }
}

/**
 * Parse a drop-down filter.
 *
 * @param {string} text
 * @returns {{ fields: Set<string>, matches: (entry: object, row: object) => boolean }}
 *   `fields`: the feature's columns the filter reads; `matches`: whether a
 *   list entry is offered to a feature row
 */
export function parseFilter(text) {
  const tree = new Parser(text).parse()
  return {
    fields: new Set(fieldsOf(tree)),
    matches: (entry, row) => truth(tree, entry, row) === true
  }
}
