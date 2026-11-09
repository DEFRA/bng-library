import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { checkTemplateValues } from '../src/bng-service/check-values.mjs'
import { TEMPLATE_SCHEMA } from '../src/bng-service/reference.mjs'

// The template lets an existing tree whose condition gets worse be Created:
// the same tree, kept Existing and linked to its parent, in its own size
// class, type and setting and any condition (bng-metric-template, BMD-1184).
// The value checks read the template's lists, so they offer it too.

const TABLE = 'Individual Trees Post-Intervention'

/** A degraded Medium Rural native tree, Good at baseline and Poor after. */
const DEGRADED = {
  'Habitat Ref': 'T001',
  'Parent Ref': 'T001',
  'Baseline Tree Size': 'Medium',
  'Baseline Tree Type': 'Native',
  'Baseline Rural or Urban Tree': 'Rural tree',
  'Baseline Condition': 'Good',
  'Baseline Strategic Significance': 'Low',
  'Irreplaceable Habitat': 'No',
  'Retention Category': 'Created',
  Category: 'Existing',
  'Proposed Tree Size': 'Medium',
  'Proposed Tree Type': 'Native',
  'Proposed Rural or Urban Tree': 'Rural tree',
  'Proposed Condition': 'Poor',
  'Proposed Strategic Significance': 'Low',
  // The template greys out the delay while years in advance are above 0.
  'Habitat Created/Enhanced in advance/years': '30+',
  'Spatial risk category': 'N/A'
}

let db

afterEach(() => db?.close())

/** An in-memory copy of the table holding one row. */
function withRow(row) {
  const table = TEMPLATE_SCHEMA.tables.find((t) => t.name === TABLE)
  db = new Database(':memory:')
  const columns = table.columns.map((c) => `"${c.name}" ${c.type}`)
  db.exec(`CREATE TABLE "${TABLE}" (fid INTEGER PRIMARY KEY, ${columns})`)
  const names = Object.keys(row)
  db.prepare(
    `INSERT INTO "${TABLE}" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`
  ).run(...Object.values(row))
  return db
}

const fieldsRefused = (row) =>
  checkTemplateValues(withRow(row)).map(({ field }) => field)

describe('the value checks on a tree whose condition gets worse', () => {
  it('accept an Existing tree Created in its own size class, type and setting', () => {
    expect(checkTemplateValues(withRow(DEGRADED))).toEqual([])
  })

  it.each(['Good', 'Fairly Good', 'Moderate', 'Fairly Poor', 'Poor'])(
    'accept it in %s condition',
    (condition) => {
      expect(
        fieldsRefused({ ...DEGRADED, 'Proposed Condition': condition })
      ).not.toContain('Proposed Condition')
    }
  )

  it.each([
    ['Proposed Tree Size', 'Large'],
    ['Proposed Tree Type', 'Non-native'],
    ['Proposed Rural or Urban Tree', 'Urban tree']
  ])('refuse a %s other than its own (%s)', (field, value) => {
    expect(fieldsRefused({ ...DEGRADED, [field]: value })).toContain(field)
  })
})
