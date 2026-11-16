import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { generatePermutations, setMode } from '../index.mjs'
import { SCENARIOS } from '../src/permutations/catalogue.mjs'
import { WORSE_HABITAT_COMMENT } from '../src/bng-service/template-features.mjs'
import {
  REMOVABLE_RIVER_TYPES,
  lostRiverTypes,
  ownTypeCreations
} from './lineage-rules.mjs'

let dir

beforeAll(() => {
  setMode('silent')
  dir = mkdtempSync(path.join(tmpdir(), 'bng-service-scenario-lineage-'))
})

afterAll(() => {
  setMode('cli')
  rmSync(dir, { recursive: true, force: true })
})

const { scenarios } = generatePermutations({ format: 'bng-service', seed: 1 })

/**
 * A habitat that gets worse that the scenario asks for (`worseHabitats`):
 * an own-type creation by design, created again 30+ years in advance.
 */
function askedToGetWorse(id, row) {
  const asked = SCENARIOS.find((s) => s.id === id)?.worseHabitats
  return (
    asked !== undefined &&
    row.comment === WORSE_HABITAT_COMMENT &&
    row.advance === '30+'
  )
}

// A scenario pins its retention, which skips the draw's own guards against
// an own-type creation and a lost natural river, so each scenario the BNG
// Service format writes is checked against the rules here (BMD-1083). An
// own-type creation is allowed only where the scenario asks for a habitat
// that gets worse, which the backend reads as one.
describe('a BNG Service scenario keeps the backend lineage rules', () => {
  it.each(scenarios.map((s) => [s.id, s]))('%s', (id, scenario) => {
    const file = path.join(dir, `${id}.gpkg`)
    writeFileSync(file, scenario.geoPackage.buffer)

    expect(
      ownTypeCreations(file)
        .filter((row) => !askedToGetWorse(id, row))
        .map(({ ref, comment }) => ({ ref, comment }))
    ).toEqual([])
    expect(
      lostRiverTypes(file).filter((type) => !REMOVABLE_RIVER_TYPES.has(type))
    ).toEqual([])
  })

  it('leaves out the legacy-only trading-trade-up, keeping its area and hedgerow halves in a twin', () => {
    const ids = scenarios.map((s) => s.id)
    expect(ids).not.toContain('trading-trade-up')
    expect(ids).toContain('trading-trade-up-without-watercourse')
  })
})
