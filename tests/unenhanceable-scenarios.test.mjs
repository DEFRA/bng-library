/**
 * The BMD-1182 scenarios draw what they say they draw: each enhances a
 * baseline the service cannot enhance at all, by the rule it names, and
 * nothing else in the file does. Their companions, the same moves from a
 * condition that can still improve, enhance no such baseline, so the service
 * nulls them rather than refusing the file.
 *
 * Checked against the generated GeoPackages, in every format a scenario is
 * drawn in, rather than against the catalogue's overrides: a generator that
 * drops or rewrites a subject (as the BNG Service one writes an Enhanced tree
 * in Good condition as Retained) fails here, where a snapshot update would let
 * it through.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { generatePermutations, setMode } from '../index.mjs'
import {
  ENHANCEMENT_KIND,
  checkEnhancement
} from '../src/metric/enhancement-rules.mjs'
import {
  UNENHANCEABLE_BASELINE,
  unenhanceableBaseline
} from '../src/metric/unenhanceable-baselines.mjs'
import { SCENARIOS, scenarioInFormat } from '../src/permutations/catalogue.mjs'
import { workbookRowsFromGeoPackage } from '../src/workbook-writer/gpkg-rows.mjs'

const PURPOSE = 'invalid-interventions'
// The committed corpus's seed.
const SEED = 1
const FORMATS = ['legacy', 'bng-service']
const GENERATE_TIMEOUT_MS = 60_000

/** Each workbook module's sheets, and the enhancement rules it is held to. */
const MODULES = Object.freeze({
  habitat: {
    kind: ENHANCEMENT_KIND.area,
    habitatOf: (row) => `${row.broadHabitat} - ${row.habitatType}`
  },
  hedgerow: {
    kind: ENHANCEMENT_KIND.hedgerow,
    habitatOf: (row) => row.habitatType
  },
  watercourse: {
    kind: ENHANCEMENT_KIND.watercourse,
    habitatOf: (row) => row.habitatType
  }
})

/** The scenarios the service refuses, and the rule each subject breaks. */
const REFUSED = [
  [
    'invalid-area-medium-good-enhanced',
    'H001',
    UNENHANCEABLE_BASELINE.MEDIUM_AREA_GOOD
  ],
  [
    'invalid-tree-good-enhanced',
    'T001',
    UNENHANCEABLE_BASELINE.MEDIUM_AREA_GOOD
  ],
  [
    'invalid-hedgerow-medium-good-enhanced',
    'HG001',
    UNENHANCEABLE_BASELINE.MEDIUM_HEDGEROW_GOOD
  ],
  [
    'invalid-watercourse-medium-good-enhanced',
    'R001',
    UNENHANCEABLE_BASELINE.MEDIUM_WATERCOURSE_GOOD
  ],
  [
    'invalid-hedgerow-very-low-enhanced',
    'HG001',
    UNENHANCEABLE_BASELINE.VERY_LOW_HEDGEROW
  ],
  [
    'invalid-hedgerow-low-good-no-medium-target',
    'HG001',
    UNENHANCEABLE_BASELINE.LOW_HEDGEROW_GOOD_NO_MEDIUM_TARGET
  ]
]

/** The same moves from a condition that can still improve: nulled, not refused. */
const NULLED = [
  'invalid-hedgerow-bank-or-ditch-dropped',
  'invalid-watercourse-medium-condition-reduced'
]

let dir
/** @type {Record<string, Record<string, object>>} rows by format, then scenario */
const rowsByFormat = {}

beforeAll(() => {
  setMode('silent')
  dir = mkdtempSync(path.join(tmpdir(), 'bng-unenhanceable-'))
  for (const format of FORMATS) {
    rowsByFormat[format] = {}
    const { scenarios } = generatePermutations({
      seed: SEED,
      only: PURPOSE,
      format
    })
    for (const s of scenarios) {
      const file = path.join(dir, `${format}-${s.id}.gpkg`)
      const { buffer } = s.geoPackage ?? s.postIntervention
      writeFileSync(file, buffer)
      rowsByFormat[format][s.id] = workbookRowsFromGeoPackage(file).rows
    }
  }
}, GENERATE_TIMEOUT_MS)

afterAll(() => {
  setMode('cli')
  rmSync(dir, { recursive: true, force: true })
})

/**
 * Every enhanced feature in a file: its baseline and proposed sides, and the
 * BMD-1182 rule its baseline breaks, if any.
 */
function enhancements(rows) {
  return Object.entries(MODULES).flatMap(([module, { kind, habitatOf }]) => {
    const baselines = new Map(
      rows[`${module}Baseline`].map((row) => [row.reference, row])
    )
    return rows[`${module}Enhancement`].map((proposedRow) => {
      const baselineRow = baselines.get(proposedRow.reference)
      const baseline = {
        habitat: habitatOf(baselineRow),
        condition: baselineRow.condition
      }
      const proposed = {
        habitat: habitatOf(proposedRow),
        condition: proposedRow.condition
      }
      return {
        ref: proposedRow.reference,
        kind,
        baseline,
        proposed,
        rule: unenhanceableBaseline(kind, baseline)?.rule ?? null
      }
    })
  })
}

function scenario(id) {
  return SCENARIOS.find((s) => s.id === id)
}

/** [format, id, ...rest] for each format a scenario is drawn in. */
function inEachFormat(cases) {
  return FORMATS.flatMap((format) =>
    cases
      .filter(([id]) => scenarioInFormat(scenario(id), format))
      .map((c) => [format, ...c])
  )
}

describe('the BMD-1182 scenarios', () => {
  it('are all in the catalogue', () => {
    for (const [id] of REFUSED) {
      expect(scenario(id)?.purpose).toBe(PURPOSE)
    }
  })

  it.each(inEachFormat(REFUSED))(
    '%s %s: only %s is enhanced from a baseline the service cannot enhance (%s)',
    (format, id, ref, rule) => {
      const refused = enhancements(rowsByFormat[format][id]).filter(
        (e) => e.rule
      )
      expect(refused.map((e) => [e.ref, e.rule])).toEqual([[ref, rule]])
      expect(scenario(id).subject.ref).toBe(ref)
    }
  )

  it.each(FORMATS)(
    '%s invalid-area-medium-good-enhanced: H002 beside it is a valid enhancement',
    (format) => {
      const h002 = enhancements(
        rowsByFormat[format]['invalid-area-medium-good-enhanced']
      ).find((e) => e.ref === 'H002')
      expect(h002.rule).toBeNull()
      expect(
        checkEnhancement(h002.kind, h002.baseline, h002.proposed).valid
      ).toBe(true)
    }
  )

  it('leave the tree out of the BNG Service format, which cannot draw it', () => {
    expect(
      scenarioInFormat(scenario('invalid-tree-good-enhanced'), 'bng-service')
    ).toBe(false)
  })

  it.each(inEachFormat(NULLED.map((id) => [id])))(
    '%s %s: enhances no baseline the service cannot enhance, only invalidly',
    (format, id) => {
      const found = enhancements(rowsByFormat[format][id])
      const subject = found.find((e) => e.ref === scenario(id).subject.ref)
      expect(found.filter((e) => e.rule)).toEqual([])
      expect(
        checkEnhancement(subject.kind, subject.baseline, subject.proposed).valid
      ).toBe(false)
    }
  )
})
