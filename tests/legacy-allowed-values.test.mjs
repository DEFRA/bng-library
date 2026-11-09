/**
 * Every value the legacy (Natural England) generators write into a
 * drop-down or filled-in column is one the template's lists offer for that
 * column (BMD-1175): the service refuses any other value at upload.
 *
 * Values are compared as the service compares them: without a list number,
 * with runs of whitespace as one space and none around a slash, in lower
 * case, and a whole number of years without its decimal places. A blank
 * value, or the word "Null", passes. The Red Line Boundary is not checked,
 * as the service does not check it.
 */
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  TEMPLATE_ALLOWED_VALUES,
  generateFromWorkbook,
  generateOne,
  generatePermutations,
  listFlaws,
  resolveFlawSelection,
  setMode
} from '../index.mjs'
import { workbookRowsFromGeoPackage } from '../src/workbook-writer/index.mjs'

const CENTRE = [530000, 180000]
const SEED = 42
const FLAW_PARCELS = 8
const PERMUTATION_SEED = 1
const WORKBOOK_SEED = 17
const RED_LINE_BOUNDARY = 'red line boundary'

const LIST_NUMBER = /^\d+\.\s*/
const WHOLE_DECIMAL = /^(\d+)\.0+$/
const WHITESPACE_RUN = /\s+/g
const SPACED_SLASH = /\s*\/\s*/g

const columnKey = (column) => String(column).trim().toLowerCase()

function normalise(value) {
  return String(value)
    .trim()
    .replace(LIST_NUMBER, '')
    .replaceAll(WHITESPACE_RUN, ' ')
    .replaceAll(SPACED_SLASH, '/')
    .replace(WHOLE_DECIMAL, '$1')
    .toLowerCase()
}

const ALLOWED = new Map(
  Object.entries(TEMPLATE_ALLOWED_VALUES).map(([column, values]) => [
    columnKey(column),
    new Set(values.map(normalise))
  ])
)

/** Every value in a file that its column's lists do not offer. */
function disallowedValues(file) {
  const db = new Database(file, { readonly: true })
  try {
    const tables = db
      .prepare(
        "SELECT table_name FROM gpkg_contents WHERE data_type = 'features'"
      )
      .all()
      .map((row) => row.table_name)
      .filter((table) => columnKey(table) !== RED_LINE_BOUNDARY)
    const found = new Set()
    for (const table of tables) {
      for (const row of db.prepare(`SELECT * FROM "${table}"`).all()) {
        for (const [column, value] of Object.entries(row)) {
          const allowed = ALLOWED.get(columnKey(column))
          if (!allowed || value === null || Buffer.isBuffer(value)) {
            continue
          }
          const shown = normalise(value)
          if (shown === '' || shown === 'null' || allowed.has(shown)) {
            continue
          }
          found.add(`${table}.${column} = ${JSON.stringify(value)}`)
        }
      }
    }
    return [...found].sort((a, b) => a.localeCompare(b))
  } finally {
    db.close()
  }
}

let dir
beforeAll(() => {
  setMode('silent')
  dir = mkdtempSync(path.join(tmpdir(), 'bng-allowed-'))
})
afterAll(() => {
  setMode('cli')
  rmSync(dir, { recursive: true, force: true })
})

function synthetic(name, plan) {
  const file = path.join(dir, `${name}.gpkg`)
  generateOne(file, CENTRE, { seed: SEED, ...plan })
  return disallowedValues(file)
}

function flawPlan(selection) {
  return {
    numParcels: FLAW_PARCELS,
    ...resolveFlawSelection({ numParcels: FLAW_PARCELS, ...selection })
  }
}

describe('the legacy generators write only values the template offers', () => {
  it.each([
    ['small', { numParcels: 6 }],
    ['default size', { numParcels: 50 }],
    ['explicit trees', { numParcels: 20, numTrees: 9 }]
  ])('a synthetic site: %s', (name, plan) => {
    expect(synthetic(name, plan)).toEqual([])
  })

  it.each(listFlaws().map((f) => f.name))('the flaw %s', (name) => {
    expect(synthetic(`flaw-${name}`, flawPlan({ flaws: [name] }))).toEqual([])
  })

  it('--bad', () => {
    expect(synthetic('bad', flawPlan({ bad: true, flaws: [] }))).toEqual([])
  })

  it('the scenario catalogue', () => {
    const { scenarios } = generatePermutations({ seed: PERMUTATION_SEED })
    const found = scenarios.flatMap((s) =>
      [
        ['b', s.baseline.buffer],
        ['pi', s.postIntervention.buffer]
      ].flatMap(([stage, buffer]) => {
        const file = path.join(
          dir,
          `${s.id.replaceAll('/', '-')}-${stage}.gpkg`
        )
        writeFileSync(file, buffer)
        return disallowedValues(file).map((v) => `${s.id} ${stage}: ${v}`)
      })
    )
    expect(found).toEqual([])
  })

  const workbooks = {
    'hedgerow-created': JSON.parse(
      readFileSync(
        new URL('./fixtures/workbook-hedgerow-created.json', import.meta.url),
        'utf8'
      )
    ),
    ...JSON.parse(
      readFileSync(
        new URL('./fixtures/scenario-workbooks.json', import.meta.url),
        'utf8'
      )
    )
  }

  it.each(Object.keys(workbooks))('the legacy pair from workbook %s', (id) => {
    const name = id.replaceAll('/', '-')
    const outPaths = {
      baseline: path.join(dir, `wb-${name}-b.gpkg`),
      postIntervention: path.join(dir, `wb-${name}-pi.gpkg`)
    }
    const result = generateFromWorkbook(outPaths, workbooks[id], `${id}.xlsx`, {
      centre: CENTRE,
      seed: WORKBOOK_SEED
    })
    expect(result.success).toBe(true)
    expect([
      ...disallowedValues(outPaths.baseline),
      ...disallowedValues(outPaths.postIntervention)
    ]).toEqual([])
  })
})

describe('a legacy tree setting reads the same in either spelling', () => {
  const treeTypes = (file) =>
    workbookRowsFromGeoPackage(file)
      .rows.habitatBaseline.filter(
        (row) => row.broadHabitat === 'Individual trees'
      )
      .map((row) => row.habitatType)

  it('reads "Urban tree" and the older "Urban" as the same habitat', () => {
    const file = path.join(dir, 'settings.gpkg')
    generateOne(file, CENTRE, { seed: SEED, numParcels: 20, numTrees: 9 })
    const older = path.join(dir, 'settings-older.gpkg')
    copyFileSync(file, older)
    const db = new Database(older)
    for (const column of [
      'Baseline Rural or Urban Tree',
      'Proposed Rural or Urban Tree'
    ]) {
      db.prepare(
        `UPDATE "Urban Trees" SET "${column}" = replace("${column}", ' tree', '')`
      ).run()
    }
    db.close()

    const types = treeTypes(file)
    expect(new Set(types)).toEqual(new Set(['Urban tree', 'Rural tree']))
    expect(treeTypes(older)).toEqual(types)
  })
})
