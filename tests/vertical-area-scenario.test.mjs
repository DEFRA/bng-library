/**
 * The vertical area habitat scenario (BMD-1084) holds what it pins: the
 * harness compares it with the metric, and AC9 rests on V001's 400 m²
 * reaching the metric as 0.04 ha. Drawn as the catalogue draws it, from the
 * same plan and seed, so a change to addVerticalHabitats or the overrides
 * that loses a pinned value fails here rather than only moving a hash.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { generateBngServiceSynthetic, setMode } from '../index.mjs'
import { SCENARIOS } from '../src/permutations/catalogue.mjs'
import { scenarioPlan } from '../src/permutations/generate.mjs'
import { derivePermutationSeed } from '../src/permutations/seed.mjs'
import { workbookRowsFromGeoPackage } from '../src/workbook-writer/index.mjs'

const ID = 'vertical-area-every-retention'
const CENTRE = [530000, 180000]
const SEED = 1

let dir
let file
beforeAll(() => {
  setMode('silent')
  dir = mkdtempSync(path.join(tmpdir(), 'bng-vertical-'))
  file = path.join(dir, `${ID}.gpkg`)
  const scenario = SCENARIOS.find((s) => s.id === ID)
  generateBngServiceSynthetic(
    file,
    CENTRE,
    { ...scenarioPlan(scenario), seed: derivePermutationSeed(SEED, ID) },
    { templateFeatures: false }
  )
})
afterAll(() => {
  setMode('cli')
  rmSync(dir, { recursive: true, force: true })
})

function rows(table) {
  const db = new Database(file, { readonly: true })
  try {
    return db.prepare(`SELECT * FROM "${table}" ORDER BY "Habitat Ref"`).all()
  } finally {
    db.close()
  }
}

describe(`${ID} as drawn`, () => {
  it('holds the four pinned walls and structures, with their typed Area in hectares', () => {
    expect(
      rows('Vertical Area Habitats Baseline').map((row) => [
        row['Habitat Ref'],
        `${row['Baseline Broad Habitat Type']} - ${row['Baseline Habitat Type']}`,
        row['Baseline Condition'],
        row.Area
      ])
    ).toEqual([
      ['V001', 'Urban - Facade-bound green wall', 'Moderate', 0.04],
      ['V002', 'Urban - Ground based green wall', 'Poor', 0.025],
      [
        'V003',
        'Intertidal hard structures - Artificial hard structures',
        'Moderate',
        0.015
      ],
      [
        'V004',
        'Intertidal hard structures - Artificial features of hard structures',
        'Fairly Poor',
        0.006
      ]
    ])
  })

  it('keeps each one at its pinned retention, the Lost one with no post-intervention row', () => {
    expect(
      rows('Vertical Area Habitats Post-Intervention').map((row) => [
        row['Habitat Ref'],
        row['Retention Category'],
        row['Proposed Habitat Type'],
        row['Proposed Condition'],
        row.Area
      ])
    ).toEqual([
      ['V001', 'Retained', 'Facade-bound green wall', 'Moderate', 0.04],
      ['V002', 'Enhanced', 'Ground based green wall', 'Moderate', 0.025],
      [
        'V003',
        'Created',
        'Artificial hard structures with integrated greening of grey infrastructure (IGGI)',
        'Moderate',
        0.015
      ]
    ])
  })

  it('gives the metric workbook V001 at 0.04 ha, as typed (AC9)', () => {
    const { habitatBaseline } = workbookRowsFromGeoPackage(file).rows
    const v001 = habitatBaseline.find((row) => row.reference === 'V001')
    expect(v001.size).toBe(0.04)
    expect(v001.retained).toBe(0.04)
  })
})
