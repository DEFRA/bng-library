import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  BNG_SERVICE_FLAWS,
  CATEGORY_DEGRADE,
  FlawSelectionError,
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
  ENHANCED_PART_COMMENT,
  LOST_TO_DEVELOPMENT_COMMENT,
  WORSE_HABITAT_COMMENT,
  WORSE_WATERCOURSE_COMMENT
} from '../src/bng-service/template-features.mjs'
import { SEALED_SURFACE } from '../src/bng-service/vocabulary.mjs'
import { pointInRing } from '../src/geometry.mjs'
import { wkbToGeoJSON } from '../src/gpkg-io/index.mjs'
import { areaSquareMetres } from '../src/measure/index.mjs'
import { AREA, enhancementPairs } from '../src/synthetic/valid-draws.mjs'

const CENTRE = [530000, 180000]
const SEED = 6
const PARCELS = 15
// The smallest share of its parent a split parcel's part may have. The
// split keeps 0.3 to 0.4 of the whole and enhances 0.4 to 0.6 of the rest,
// so part a has 0.3 or more, and parts b and c 0.24 or more; the bound is
// lower, as a carve meets its target area only approximately.
const MIN_SPLIT_PART_SHARE = 0.15
const SQ_M_PER_HECTARE = 10_000
// Points sampled across a split parcel's envelope, on each side, to check
// its parts cover it once.
const COVERAGE_GRID = 40
// A sampled point this close to an edge, in metres, is skipped: which side
// of a shared edge it falls is a matter of rounding.
const EDGE_TOLERANCE_M = 0.01

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
      'worse-watercourse',
      'partly-worse-parcel',
      'split-parcel'
    ])
  })

  it('draws one of each by default, but no part-worse or split parcel, so a default site keeps its bytes', () => {
    const plain = readFileSync(synthetic())
    const defaults = resolveWorseCounts()
    expect(defaults).toEqual({
      ...Object.fromEntries(WORSE_KINDS.map((k) => [k, 1])),
      'partly-worse-parcel': 0,
      'split-parcel': 0
    })
    expect(readFileSync(synthetic({ worseHabitatCounts: {} }))).toEqual(plain)
    expect(readFileSync(synthetic({ worseHabitatCounts: defaults }))).toEqual(
      plain
    )
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

  it('splits area parcels into a Retained part a and a worse part b, both linked to the parent', () => {
    const large = { seed: 1, numParcels: 30 }
    const parcels = (file) => rows(file, 'Area Habitats Post-Intervention')
    const baseline = (file) => rows(file, 'Area Habitats Baseline')
    const file = synthetic(
      { worseHabitatCounts: { 'partly-worse-parcel': 3 } },
      large
    )
    const worseParts = parcels(file).filter(
      (r) => isWorse(r) && r['Habitat Ref'] === `${r['Parent Ref']}b`
    )
    expect(worseParts).toHaveLength(3)
    for (const part of worseParts) {
      const kept = parcels(file).find(
        (r) => r['Habitat Ref'] === `${part['Parent Ref']}a`
      )
      const parent = baseline(file).find(
        (r) => r.feature_uuid === part.parent_uuid
      )
      expect(kept?.['Retention Category'], part['Habitat Ref']).toBe('Retained')
      expect(kept.parent_uuid).toBe(part.parent_uuid)
      expect(part['Retention Category']).toBe('Created')
      expect(part['Proposed Habitat Type']).toBe(
        parent['Baseline Habitat Type']
      )
      expect(part['Habitat created in advance/years']).toBe('30+')
      expect(kept.Area).toBeLessThan(parent.Area)
      expect(kept.Area + part.Area).toBeCloseTo(parent.Area, 6)
    }
    expect(
      parcels(file).filter(
        (r) =>
          r['Retention Category'] === 'Retained' &&
          !/[ab]$/.test(r['Habitat Ref'])
      ).length
    ).toBeGreaterThanOrEqual(1)
    expect(checkLineage(file)).toEqual([])
    expect(checkTemplateValues(file)).toEqual([])
  })

  /** Each split parcel's parts and baseline parent, found by its lost part c. */
  function splitParcels(file) {
    const parcels = rows(file, 'Area Habitats Post-Intervention')
    const baseline = rows(file, 'Area Habitats Baseline')
    return parcels
      .filter((r) => r.Comment === LOST_TO_DEVELOPMENT_COMMENT)
      .map((lost) => {
        const ref = lost['Parent Ref']
        const part = (letter) =>
          parcels.find((r) => r['Habitat Ref'] === `${ref}${letter}`)
        return {
          ref,
          kept: part('a'),
          enhanced: part('b'),
          lost,
          parent: baseline.find((r) => r.feature_uuid === lost.parent_uuid)
        }
      })
  }

  /** A parcel row's outer ring, from its stored geometry. */
  function ringOf(row) {
    const geometry = wkbToGeoJSON(row.geom)
    expect(geometry.type, row['Habitat Ref']).toBe('Polygon')
    expect(geometry.coordinates, row['Habitat Ref']).toHaveLength(1)
    return geometry.coordinates[0]
  }

  function nearEdge(point, ring) {
    for (let i = 1; i < ring.length; i += 1) {
      const [[x1, y1], [x2, y2]] = [ring[i - 1], ring[i]]
      const [dx, dy] = [x2 - x1, y2 - y1]
      const t = Math.max(
        0,
        Math.min(
          1,
          ((point[0] - x1) * dx + (point[1] - y1) * dy) / (dx * dx + dy * dy)
        )
      )
      const gap = Math.hypot(point[0] - (x1 + t * dx), point[1] - (y1 + t * dy))
      if (gap < EDGE_TOLERANCE_M) {
        return true
      }
    }
    return false
  }

  /**
   * The parts' shapes cover their parent once: each point sampled inside
   * the parent lies in exactly one part, and each point outside it in none.
   */
  function expectPartsTileParent(parentRing, partRings) {
    const xs = parentRing.map(([x]) => x)
    const ys = parentRing.map(([, y]) => y)
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)]
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)]
    let inside = 0
    for (let i = 0; i < COVERAGE_GRID; i += 1) {
      for (let j = 0; j < COVERAGE_GRID; j += 1) {
        const point = [
          minX + ((i + 0.5) / COVERAGE_GRID) * (maxX - minX),
          minY + ((j + 0.5) / COVERAGE_GRID) * (maxY - minY)
        ]
        if (![parentRing, ...partRings].some((r) => nearEdge(point, r))) {
          const inParent = pointInRing(point, parentRing)
          const covering = partRings.filter((r) => pointInRing(point, r))
          expect(covering.length, `at ${point}`).toBe(inParent ? 1 : 0)
          inside += inParent ? 1 : 0
        }
      }
    }
    expect(inside).toBeGreaterThan(0)
  }

  function expectSplit({ ref, kept, enhanced, lost, parent }) {
    expect(kept, `${ref}a`).toBeDefined()
    expect(enhanced, `${ref}b`).toBeDefined()
    expect(parent, ref).toBeDefined()
    expect(lost['Habitat Ref']).toBe(`${ref}c`)
    expect(kept['Retention Category']).toBe('Retained')
    expect(kept['Proposed Condition']).toBe(parent['Baseline Condition'])
    expect(enhanced['Retention Category']).toBe('Enhanced')
    expect(enhanced.Comment).toBe(ENHANCED_PART_COMMENT)
    expect(enhanced['Proposed Broad Habitat Type']).toBe(
      parent['Baseline Broad Habitat Type']
    )
    expect(enhanced['Proposed Habitat Type']).toBe(
      parent['Baseline Habitat Type']
    )
    // A condition the Metric lets the habitat be enhanced to from its own.
    expect(
      enhancementPairs(
        AREA,
        `${parent['Baseline Broad Habitat Type']} - ${parent['Baseline Habitat Type']}`
      ),
      ref
    ).toContainEqual([
      parent['Baseline Condition'],
      enhanced['Proposed Condition']
    ])
    expect(lost['Retention Category']).toBe('Created')
    expect(lost['Proposed Broad Habitat Type']).toBe(SEALED_SURFACE.broad)
    expect(lost['Proposed Habitat Type']).toBe(SEALED_SURFACE.type)
    expect(lost['Habitat created in advance/years']).toBe('0')
    for (const row of [kept, enhanced, lost]) {
      expect(row.parent_uuid).toBe(lost.parent_uuid)
      // No part takes all but a sliver of the parent.
      expect(row.Area, row['Habitat Ref']).toBeGreaterThan(
        parent.Area * MIN_SPLIT_PART_SHARE
      )
    }
    expect(kept.Area + enhanced.Area + lost.Area).toBeCloseTo(parent.Area, 6)
    // Each part's Area is its own shape's, and the shapes tile the parent.
    const partRings = [kept, enhanced, lost].map(ringOf)
    for (const [row, ring] of [kept, enhanced, lost].map((r, i) => [
      r,
      partRings[i]
    ])) {
      expect(
        areaSquareMetres({ type: 'Polygon', coordinates: [ring] }) /
          SQ_M_PER_HECTARE,
        row['Habitat Ref']
      ).toBeCloseTo(row.Area, 6)
    }
    expectPartsTileParent(ringOf(parent), partRings)
  }

  /** The Retained parcels no split took: their ref is their parent's. */
  const wholeRetained = (file) =>
    rows(file, 'Area Habitats Post-Intervention').filter(
      (r) =>
        r['Retention Category'] === 'Retained' &&
        r['Habitat Ref'] === r['Parent Ref']
    )

  it('splits area parcels into a Retained part a, an Enhanced part b and a part c lost to development, none worse', () => {
    const file = synthetic(
      { worseHabitatCounts: { 'split-parcel': 2 } },
      { seed: 1, numParcels: 30 }
    )
    const splits = splitParcels(file)
    expect(splits).toHaveLength(2)
    splits.forEach(expectSplit)
    expect(wholeRetained(file).length).toBeGreaterThanOrEqual(1)
    expect(
      rows(file, 'Area Habitats Post-Intervention').filter(isWorse)
    ).toHaveLength(1)
    expect(checkLineage(file)).toEqual([])
    expect(checkTemplateValues(file)).toEqual([])
  })

  it.each([2, 5, 7, 11])(
    'splits parcels the same way on seed %i, and keeps a Retained parcel whole',
    (seed) => {
      const file = synthetic(
        { worseHabitatCounts: { 'split-parcel': MAX_WORSE_COUNT } },
        { seed, numParcels: 30 }
      )
      const splits = splitParcels(file)
      expect(splits.length).toBeGreaterThanOrEqual(1)
      splits.forEach(expectSplit)
      expect(wholeRetained(file).length).toBeGreaterThanOrEqual(1)
      expect(checkLineage(file)).toEqual([])
      expect(checkTemplateValues(file)).toEqual([])
    }
  )

  it('keeps a post-intervention comment an override pins on a split parcel', () => {
    const large = { seed: 1, numParcels: 30 }
    const counts = { worseHabitatCounts: { 'split-parcel': 1 } }
    const parcels = (file) => rows(file, 'Area Habitats Post-Intervention')
    const lostRef = (file) =>
      parcels(file).find(
        (r) =>
          r['Proposed Habitat Type'] === SEALED_SURFACE.type &&
          /c$/.test(r['Habitat Ref'])
      )?.['Parent Ref']
    const ref = lostRef(synthetic(counts, large))
    expect(ref).toMatch(/^H\d+$/)
    const index = Number(ref.slice(1)) - 1
    const habitats = Array.from({ length: index + 1 }, (_, i) =>
      i === index ? { postInterventionComment: 'Pinned PI note' } : {}
    )
    const file = synthetic(counts, {
      ...large,
      attributeOverrides: { habitats }
    })
    expect(lostRef(file)).toBe(ref)
    for (const letter of ['a', 'b', 'c']) {
      expect(
        parcels(file).find((r) => r['Habitat Ref'] === `${ref}${letter}`)
          ?.Comment,
        `${ref}${letter}`
      ).toBe('Pinned PI note')
    }
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

  describe('scenarioChanges: only what a scenario names', () => {
    const scenario = (scenarioChanges, plan = {}) =>
      synthetic({ templateFeatures: false }, { scenarioChanges, ...plan })

    it('draws exactly the kinds and counts named, and nothing else', () => {
      const file = scenario({
        worseHabitats: { hedge: 2, 'partly-worse-hedge': 1 }
      })
      expect(wholeWorseHedges(file)).toHaveLength(2)
      expect(
        hedgerows(file).filter((r) => /b$/.test(r['Habitat Ref']) && isWorse(r))
      ).toHaveLength(1)
      const others = [
        'Area Habitats Post-Intervention',
        'Vertical Area Habitats Post-Intervention',
        'Watercourses Post-Intervention'
      ].flatMap((table) => rows(file, table))
      expect(
        others.filter((r) =>
          [
            WORSE_HABITAT_COMMENT,
            ENCROACHED_WATERCOURSE_COMMENT,
            WORSE_WATERCOURSE_COMMENT
          ].includes(r.Comment)
        )
      ).toEqual([])
    })

    it('draws a split parcel a scenario names, counted by its lost part', () => {
      const file = scenario(
        { worseHabitats: { 'split-parcel': 1 } },
        { seed: 1, numParcels: 30 }
      )
      const splits = splitParcels(file)
      expect(splits).toHaveLength(1)
      splits.forEach(expectSplit)
      expect(checkLineage(file)).toEqual([])
    })

    it('refuses a split parcel a scenario cannot draw, saying why', () => {
      expect(() =>
        scenario({ worseHabitats: { 'split-parcel': 1 } }, { numParcels: 1 })
      ).toThrow(
        /split-parcel: asked for 1, the site drew 0 \(too few Retained parcels that can be enhanced/
      )
    })

    it('refuses a kind or a site change on a layer the site leaves empty', () => {
      const emptyLayers = new Set(['hedgerows', 'rivers'])
      expect(() =>
        scenario({ worseHabitats: { hedge: 1 } }, { emptyLayers })
      ).toThrow(/hedge is drawn on hedgerows, which the site leaves empty/)
      expect(() =>
        scenario({ siteChanges: ['shorter-watercourse'] }, { emptyLayers })
      ).toThrow(
        /shorter-watercourse is drawn on rivers, which the site leaves empty/
      )
    })

    it('refuses a site that draws fewer than it asks for', () => {
      expect(() =>
        scenario({ worseHabitats: { parcel: 1 } }, { numParcels: 1 })
      ).toThrow(/parcel: asked for 1, the site drew 0/)
    })

    it('is taken only without template features', () => {
      expect(() =>
        synthetic({}, { scenarioChanges: { worseHabitats: { hedge: 1 } } })
      ).toThrow(/scenarioChanges are drawn only without template features/)
    })
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
          ['degrade-watercourse-advance-not-encroachment'],
          resolveWorseCounts({ 'worse-watercourse': 0 })
        )
      ).toThrow(/cannot set worse-watercourse to 0/)
      expect(() =>
        assertDegradeSubjectsDrawn(
          ['degrade-watercourse-advance-not-encroachment'],
          resolveWorseCounts({ 'worse-watercourse': 2 })
        )
      ).not.toThrow()
    })

    it.each([
      ['an unknown name', 'no-such-flaw'],
      ['a flaw that is not a degrade flaw', 'lineage-parent-missing']
    ])('refuses %s by name, rather than failing on it', (_, name) => {
      const call = () =>
        assertDegradeSubjectsDrawn([name], resolveWorseCounts({}))
      expect(call).toThrow(FlawSelectionError)
      expect(call).toThrow(
        `"${name}" is not a degraded-habitat flaw; assertDegradeSubjectsDrawn takes only those`
      )
    })

    it('takes a zero count for a kind the flaw does not break', () => {
      const file = synthetic(
        { worseHabitatCounts: { hedge: 0 } },
        { degradeFlawNames: ['degrade-watercourse-encroachment-no-advance'] }
      )
      expect(
        rows(file, 'Watercourses Post-Intervention').filter(
          (r) =>
            r['Retention Category'] === 'Created' &&
            r['Habitat created in advance/years'] === null &&
            r['Proposed Condition'] === r['Baseline Condition'] &&
            r['Proposed Encroachment into Watercourse'] !==
              r['Baseline Encroachment into Watercourse']
        )
      ).toHaveLength(1)
    })
  })
})
