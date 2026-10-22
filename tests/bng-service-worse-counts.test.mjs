import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  BNG_SERVICE_FLAWS,
  CATEGORY_DEGRADE,
  MAX_WORSE_COUNT,
  WORSE_KINDS,
  assertDegradeSubjectsDrawn,
  checkLineage,
  checkTemplateValues,
  generateBngServiceSynthetic,
  generateSyntheticGpkg,
  resolveWorseCounts,
  setMode
} from '../index.mjs'
import {
  ENCROACHED_WATERCOURSE_COMMENT,
  WORSE_HABITAT_COMMENT,
  WORSE_WATERCOURSE_COMMENT
} from '../src/bng-service/template-features.mjs'

const CENTRE = [530000, 180000]
const SEED = 6
const PARCELS = 15

let dir
let counter = 0
const nextPath = (name = 'site') =>
  path.join(dir, `${name}-${(counter += 1)}.gpkg`)

beforeAll(() => {
  setMode('silent')
  dir = mkdtempSync(path.join(tmpdir(), 'bng-service-worse-counts-'))
})

afterAll(() => {
  setMode('cli')
  rmSync(dir, { recursive: true, force: true })
})

function synthetic(options = {}, plan = {}) {
  const out = nextPath()
  generateBngServiceSynthetic(
    out,
    CENTRE,
    { numParcels: PARCELS, seed: SEED, ...plan },
    options
  )
  return out
}

function rows(file, table) {
  const db = new Database(file, { readonly: true })
  try {
    return db.prepare(`SELECT * FROM "${table}" ORDER BY fid`).all()
  } finally {
    db.close()
  }
}

const hedgerows = (file) => rows(file, 'Hedgerows Post-Intervention')
const isWorse = (r) => r.Comment === WORSE_HABITAT_COMMENT
/** The hedges that get worse as a whole: a worse row with no sibling part. */
const wholeWorseHedges = (file) =>
  hedgerows(file).filter(
    (r) => isWorse(r) && r['Habitat Ref'] === r['Parent Ref']
  )
/** The hedges that get worse in part: a worse "b" part of a split. */
const partlyWorseHedges = (file) =>
  hedgerows(file).filter(
    (r) => isWorse(r) && r['Habitat Ref'] !== r['Parent Ref']
  )

function expectDistinctIdentities(file, table) {
  const uuids = rows(file, table).map((r) => r.feature_uuid)
  expect(new Set(uuids).size, `${table}: ${uuids.join()}`).toBe(uuids.length)
}

describe('worseHabitatCounts: how many habitats that get worse a site draws', () => {
  it('names each kind of habitat that gets worse', () => {
    expect(WORSE_KINDS).toEqual([
      'parcel',
      'vertical',
      'hedge',
      'partly-worse-hedge',
      'encroached-watercourse',
      'worse-watercourse'
    ])
  })

  it('draws one of each by default, so a default site keeps its bytes', () => {
    const plain = readFileSync(synthetic())
    const ones = Object.fromEntries(WORSE_KINDS.map((k) => [k, 1]))
    expect(readFileSync(synthetic({ worseHabitatCounts: {} }))).toEqual(plain)
    expect(readFileSync(synthetic({ worseHabitatCounts: ones }))).toEqual(plain)
  })

  it('draws more hedgerows that get worse, as a whole and in part, each linked to its own parent', () => {
    const file = synthetic({
      worseHabitatCounts: { hedge: 4, 'partly-worse-hedge': 3 }
    })
    expect(wholeWorseHedges(file)).toHaveLength(4)
    expect(partlyWorseHedges(file)).toHaveLength(3)
    for (const part of partlyWorseHedges(file)) {
      const kept = hedgerows(file).find(
        (r) => r['Habitat Ref'] === `${part['Parent Ref']}a`
      )
      expect(kept?.['Retention Category'], part['Habitat Ref']).toBe('Retained')
      expect(kept.parent_uuid).toBe(part.parent_uuid)
    }
    for (const row of [...wholeWorseHedges(file), ...partlyWorseHedges(file)]) {
      expect(row['Retention Category']).toBe('Created')
      expect(row['Habitat created in advance/years']).toBe('30+')
    }
    expectDistinctIdentities(file, 'Hedgerows Baseline')
    expect(checkLineage(file)).toEqual([])
    expect(checkTemplateValues(file)).toEqual([])
  })

  it('draws more watercourses that get worse, each with its own identity', () => {
    const file = synthetic({
      worseHabitatCounts: {
        'encroached-watercourse': 3,
        'worse-watercourse': 2
      }
    })
    const watercourses = rows(file, 'Watercourses Post-Intervention')
    const withComment = (comment) =>
      watercourses.filter((r) => r.Comment === comment)
    expect(withComment(ENCROACHED_WATERCOURSE_COMMENT)).toHaveLength(3)
    expect(withComment(WORSE_WATERCOURSE_COMMENT)).toHaveLength(2)
    expectDistinctIdentities(file, 'Watercourses Baseline')
    expect(checkLineage(file)).toEqual([])
    expect(checkTemplateValues(file)).toEqual([])
  })

  it('draws more vertical habitats that get worse, each with its own identity', () => {
    const file = synthetic({ worseHabitatCounts: { vertical: 3 } })
    expect(
      rows(file, 'Vertical Area Habitats Post-Intervention').filter(isWorse)
    ).toHaveLength(3)
    expectDistinctIdentities(file, 'Vertical Area Habitats Baseline')
    expect(checkLineage(file)).toEqual([])
  })

  it('draws none of a kind counted 0, and leaves the other kinds as they were', () => {
    const file = synthetic({
      worseHabitatCounts: { hedge: 0, 'partly-worse-hedge': 0 }
    })
    expect(wholeWorseHedges(file)).toEqual([])
    expect(partlyWorseHedges(file)).toEqual([])
    expect(
      rows(file, 'Area Habitats Post-Intervention').filter(isWorse)
    ).toHaveLength(1)
  })

  it('sets more area parcels worse, but only while another Retained parcel stays', () => {
    // A site with several Retained parcels that can get worse: one at the
    // lowest condition, or with no condition to assess, cannot.
    const large = { seed: 1, numParcels: 30 }
    const parcels = (file) => rows(file, 'Area Habitats Post-Intervention')
    const retained = (file) =>
      parcels(file).filter((r) => r['Retention Category'] === 'Retained')

    const two = synthetic({ worseHabitatCounts: { parcel: 2 } }, large)
    expect(parcels(two).filter(isWorse)).toHaveLength(2)

    const all = synthetic(
      { worseHabitatCounts: { parcel: MAX_WORSE_COUNT } },
      large
    )
    expect(parcels(all).filter(isWorse).length).toBeGreaterThan(2)
    expect(parcels(all).filter(isWorse).length).toBeLessThan(MAX_WORSE_COUNT)
    expect(retained(all).length).toBeGreaterThanOrEqual(1)
    expect(checkLineage(all)).toEqual([])
  })

  it('is byte-identical for the same seed and counts', () => {
    const counts = { hedge: 3, 'partly-worse-hedge': 2 }
    expect(readFileSync(synthetic({ worseHabitatCounts: counts }))).toEqual(
      readFileSync(synthetic({ worseHabitatCounts: counts }))
    )
  })

  it('passes through generateSyntheticGpkg', () => {
    const file = nextPath('buffer')
    const { buffer } = generateSyntheticGpkg({
      format: 'bng-service',
      numParcels: PARCELS,
      seed: SEED,
      worseHabitatCounts: { hedge: 3 }
    })
    writeFileSync(file, buffer)
    expect(wholeWorseHedges(file)).toHaveLength(3)
  })

  it('refuses a kind it does not know, and a count that is not a whole number in range', () => {
    expect(() => resolveWorseCounts({ hedgerow: 2 })).toThrow(
      /unknown kind of habitat that gets worse: hedgerow/
    )
    for (const count of [-1, 1.5, MAX_WORSE_COUNT + 1, '2']) {
      expect(() => resolveWorseCounts({ hedge: count }), String(count)).toThrow(
        /whole number from 0/
      )
    }
  })

  it('refuses counts for a site that draws no habitats that get worse', () => {
    expect(() =>
      synthetic({ templateFeatures: false, worseHabitatCounts: { hedge: 2 } })
    ).toThrow(/needs a site that draws habitats that get worse/)
    expect(() =>
      synthetic(
        { worseHabitatCounts: { hedge: 2 } },
        { geometricFlawNames: ['bowtie-parcel'] }
      )
    ).toThrow(/needs a site that draws habitats that get worse/)
  })

  describe('with a degrade flaw', () => {
    const DEGRADE_FLAWS = Object.entries(BNG_SERVICE_FLAWS)
      .filter(([, flaw]) => flaw.category === CATEGORY_DEGRADE)
      .map(([name, flaw]) => [name, flaw.worse.kind])

    it('names a kind for every degrade flaw', () => {
      expect(DEGRADE_FLAWS.length).toBeGreaterThan(0)
      for (const [name, kind] of DEGRADE_FLAWS) {
        expect(WORSE_KINDS, name).toContain(kind)
      }
    })

    it.each(DEGRADE_FLAWS)(
      'refuses %s with no %s drawn, naming the count as the cause',
      (name, kind) => {
        expect(() =>
          synthetic(
            { worseHabitatCounts: { [kind]: 0 } },
            { degradeFlawNames: [name] }
          )
        ).toThrow(
          `${name} breaks a habitat that gets worse of kind ${kind}, so worseHabitatCounts cannot set ${kind} to 0`
        )
      }
    )

    it.each(DEGRADE_FLAWS)(
      'writes %s when more than one %s is drawn',
      (name, kind) => {
        const file = synthetic(
          { worseHabitatCounts: { [kind]: 3 } },
          { degradeFlawNames: [name] }
        )
        expect(checkLineage(file)).toEqual([])
      }
    )

    it('exports the check, for a caller to run before generating', () => {
      expect(() =>
        assertDegradeSubjectsDrawn(
          ['degrade-not-worse'],
          resolveWorseCounts({ hedge: 0 })
        )
      ).toThrow(/cannot set hedge to 0/)
      expect(() =>
        assertDegradeSubjectsDrawn(
          ['degrade-not-worse'],
          resolveWorseCounts({ hedge: 2 })
        )
      ).not.toThrow()
    })

    it('takes a zero count for a kind the flaw does not break', () => {
      const file = synthetic(
        { worseHabitatCounts: { 'worse-watercourse': 0 } },
        { degradeFlawNames: ['degrade-not-worse'] }
      )
      expect(
        hedgerows(file).filter(
          (r) =>
            r['Retention Category'] === 'Created' &&
            r['Habitat created in advance/years'] === '30+' &&
            r['Proposed Condition'] === r['Baseline Condition']
        )
      ).toHaveLength(1)
    })
  })
})
