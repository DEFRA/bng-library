/**
 * A re-meandered watercourse, counted as the Metric does (BMD-1212): the
 * scenarios drawn to the story's set lengths, the workbook rows that describe
 * them, and the flaw that takes a re-meandered channel outside the red line.
 *
 * The Metric records the total enhanced length of a re-meandered channel and
 * no loss of length; a baseline section partly retained and partly enhanced
 * is split into a retained and an enhanced section (user guide, Watercourse
 * enhancement). One baseline row both retained and enhanced is refused by the
 * Metric itself ("Split retained and enhanced into separate entries").
 */
import {
  copyFileSync,
  existsSync,
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
  BNG_SERVICE_FLAWS,
  CATEGORY_CHANGE,
  STAGE_BASELINE,
  generateBngServiceSynthetic,
  generateSyntheticGpkg,
  setMode
} from '../index.mjs'
import { pointInRing } from '../src/geometry.mjs'
import { wkbToGeoJSON } from '../src/gpkg-io/index.mjs'
import { lengthMetres } from '../src/measure/index.mjs'
import { figuresFromWorkbook } from '../src/metric-compare/from-workbook.mjs'
import { SCENARIOS } from '../src/permutations/catalogue.mjs'
import { scenarioPlan } from '../src/permutations/generate.mjs'
import { derivePermutationSeed } from '../src/permutations/seed.mjs'
import {
  isLibreOfficeAvailable,
  recalculateWorkbooks,
  workbookRowsFromBngService,
  writeMetricWorkbook
} from '../src/workbook-writer/index.mjs'

// The metric workbook is Crown copyright and not committed (see
// workbook-writer-template.test.mjs), so the recalculation runs only when
// METRIC_TEMPLATE names a copy, and LibreOffice is installed.
const TEMPLATE = process.env.METRIC_TEMPLATE
const canRecalculate =
  Boolean(TEMPLATE) && existsSync(TEMPLATE) && isLibreOfficeAvailable()
const CENTRE = [530000, 180000]
const SEED = 1
const METRES_PER_KM = 1000
const WATERCOURSES = 'Watercourses Post-Intervention'
const BASELINE = 'Watercourses Baseline'
const SUBJECT_PARENT = 'R003'
const IDS = {
  whole: 'intervention-watercourse-remeandered',
  standard: 'intervention-watercourse-remeandered-standard',
  split: 'intervention-watercourse-remeandered-split',
  shorter: 'intervention-watercourse-enhanced-shorter'
}

let dir
const files = {}
beforeAll(() => {
  setMode('silent')
  dir = mkdtempSync(path.join(tmpdir(), 'bng-remeander-'))
  for (const [key, id] of Object.entries(IDS)) {
    const scenario = SCENARIOS.find((s) => s.id === id)
    files[key] = path.join(dir, `${id}.gpkg`)
    generateBngServiceSynthetic(
      files[key],
      CENTRE,
      { ...scenarioPlan(scenario), seed: derivePermutationSeed(SEED, id) },
      { templateFeatures: false }
    )
  }
})
afterAll(() => {
  setMode('cli')
  rmSync(dir, { recursive: true, force: true })
})

function tableRows(file, table) {
  const db = new Database(file, { readonly: true })
  try {
    return db
      .prepare(`SELECT * FROM "${table}" ORDER BY "Habitat Ref"`)
      .all()
      .map((row) => ({ ...row, metres: lengthMetres(wkbToGeoJSON(row.geom)) }))
  } finally {
    db.close()
  }
}

const subjectParent = (file) =>
  tableRows(file, BASELINE).find((r) => r['Habitat Ref'] === SUBJECT_PARENT)
const subjectParts = (file) =>
  tableRows(file, WATERCOURSES).filter((r) =>
    r['Habitat Ref'].startsWith(SUBJECT_PARENT)
  )
const km = (metres) => metres / METRES_PER_KM

describe('the re-meandered watercourse scenarios as drawn', () => {
  it('draws each subject from a 100 m Moderate ditch with no encroachment', () => {
    for (const file of Object.values(files)) {
      const parent = subjectParent(file)
      expect(parent.metres).toBeCloseTo(100, 6)
      expect(parent['Baseline River Type']).toBe('Ditches')
      expect(parent['Baseline Condition']).toBe('Moderate')
      expect(parent['Baseline Encroachment into Watercourse']).toBe(
        'No Encroachment'
      )
    }
  })

  it.each([
    ['whole', 'Enhanced by Realignment', 130],
    ['standard', 'Standard Enhancement', 130],
    ['shorter', 'Standard Enhancement', 80]
  ])(
    'enhances the %s one whole, %s, to Good, %i m drawn',
    (key, type, metres) => {
      const [part] = subjectParts(files[key])
      expect(subjectParts(files[key])).toHaveLength(1)
      expect(part['Habitat Ref']).toBe(SUBJECT_PARENT)
      expect(part['Retention Category']).toBe('Enhanced')
      expect(part['Enhancement Type']).toBe(type)
      expect(part['Proposed Condition']).toBe('Good')
      expect(part.metres).toBeCloseTo(metres, 6)
      expect(part['Parent Ref']).toBe(SUBJECT_PARENT)
    }
  )

  it('splits the split one into 40 m Retained and 90 m Enhanced by Realignment', () => {
    const [retained, enhanced] = subjectParts(files.split)
    expect(retained['Habitat Ref']).toBe(`${SUBJECT_PARENT}a`)
    expect(retained['Retention Category']).toBe('Retained')
    expect(retained.metres).toBeCloseTo(40, 6)
    expect(enhanced['Habitat Ref']).toBe(`${SUBJECT_PARENT}b`)
    expect(enhanced['Retention Category']).toBe('Enhanced')
    expect(enhanced['Enhancement Type']).toBe('Enhanced by Realignment')
    expect(enhanced['Proposed Condition']).toBe('Good')
    expect(enhanced.metres).toBeCloseTo(90, 6)
    for (const part of [retained, enhanced]) {
      expect(part['Parent Ref']).toBe(SUBJECT_PARENT)
    }
  })
})

describe('the workbook rows for a re-meandered watercourse', () => {
  const subjectRows = (key) => {
    const { rows, notes } = workbookRowsFromBngService(files[key])
    return {
      baseline: rows.watercourseBaseline.filter((r) =>
        r.reference.startsWith(SUBJECT_PARENT)
      ),
      enhancement: rows.watercourseEnhancement.filter((r) =>
        r.reference.startsWith(SUBJECT_PARENT)
      ),
      notes
    }
  }

  it.each([
    ['whole', 130],
    ['standard', 130],
    ['shorter', 80]
  ])(
    'keeps one baseline row for the %s one, enhanced by its %i m as drawn',
    (key, metres) => {
      const { baseline, enhancement, notes } = subjectRows(key)
      expect(notes).toEqual([])
      expect(baseline).toHaveLength(1)
      expect(baseline[0].reference).toBe(SUBJECT_PARENT)
      expect(baseline[0].size).toBeCloseTo(km(100), 9)
      expect(baseline[0].enhanced).toBeCloseTo(km(metres), 9)
      expect(baseline[0].retained).toBeUndefined()
      expect(enhancement).toHaveLength(1)
      expect(enhancement[0].size).toBeCloseTo(km(metres), 9)
    }
  )

  it('splits the baseline into a 40 m retained section and a 60 m one enhanced by 90 m', () => {
    const { baseline, enhancement, notes } = subjectRows('split')
    expect(notes).toEqual([])
    expect(baseline.map((r) => r.reference)).toEqual([
      `${SUBJECT_PARENT} (section 1)`,
      `${SUBJECT_PARENT} (section 2)`
    ])
    const [retained, enhanced] = baseline
    expect(retained.size).toBeCloseTo(km(40), 9)
    expect(retained.retained).toBeCloseTo(km(40), 9)
    expect(retained.enhanced).toBeUndefined()
    expect(enhanced.size).toBeCloseTo(km(60), 9)
    expect(enhanced.enhanced).toBeCloseTo(km(90), 9)
    expect(enhanced.retained).toBeUndefined()
    expect(enhancement).toHaveLength(1)
    expect(enhancement[0].reference).toBe(`${SUBJECT_PARENT}b`)
    expect(enhancement[0].size).toBeCloseTo(km(90), 9)
  })

  it('shares what is left among several Enhanced parts by their drawn lengths', () => {
    const twice = path.join(dir, 'two-enhanced-parts.gpkg')
    copyFileSync(files.split, twice)
    const edit = new Database(twice)
    // The Retained 40 m part becomes a second Enhanced part, so the two
    // parts, 40 m and 90 m drawn, share the whole 100 m: 40/130 and 90/130.
    edit
      .prepare(
        `UPDATE "${WATERCOURSES}" SET "Retention Category" = 'Enhanced',
           "Proposed Condition" = 'Good', "Enhancement Type" = 'Standard Enhancement'
           WHERE "Habitat Ref" = ?`
      )
      .run(`${SUBJECT_PARENT}a`)
    edit.close()
    const { rows, notes } = workbookRowsFromBngService(twice)
    expect(notes).toEqual([])
    const sections = rows.watercourseBaseline.filter((r) =>
      r.reference.startsWith(`${SUBJECT_PARENT} (section`)
    )
    expect(sections.map((r) => [r.size, r.enhanced])).toEqual([
      [expect.closeTo(km((100 * 40) / 130), 9), expect.closeTo(km(40), 9)],
      [expect.closeTo(km((100 * 90) / 130), 9), expect.closeTo(km(90), 9)]
    ])
    expect(
      rows.watercourseEnhancement
        .filter((r) => r.reference.startsWith(SUBJECT_PARENT))
        .map((r) => r.reference)
    ).toEqual([`${SUBJECT_PARENT}a`, `${SUBJECT_PARENT}b`])
  })

  it('leaves out an Enhanced part with no line drawn, so every enhancement row stays paired', () => {
    const undrawn = path.join(dir, 'undrawn-enhanced-part.gpkg')
    copyFileSync(files.split, undrawn)
    const edit = new Database(undrawn)
    // The Retained part becomes a second Enhanced part with no line, as an
    // empty or deleted shape leaves it: it has no length to enhance.
    edit
      .prepare(
        `UPDATE "${WATERCOURSES}" SET "Retention Category" = 'Enhanced',
           "Proposed Condition" = 'Good', "Enhancement Type" = 'Standard Enhancement',
           geom = NULL
           WHERE "Habitat Ref" = ?`
      )
      .run(`${SUBJECT_PARENT}a`)
    edit.close()
    const { rows, notes } = workbookRowsFromBngService(undrawn)
    expect(notes).toEqual([
      `${WATERCOURSES} ${SUBJECT_PARENT}a: Enhanced parts of ${SUBJECT_PARENT} with no length drawn; left out, as they enhance nothing`
    ])
    expect(rows.watercourseBaseline.filter((r) => r.enhanced > 0)).toHaveLength(
      rows.watercourseEnhancement.length
    )
    // One drawn Enhanced part and no Retained one: the parent needs no
    // sections, and is enhanced by the 90 m drawn, the rest lost.
    expect(
      rows.watercourseBaseline
        .filter((r) => r.reference.startsWith(SUBJECT_PARENT))
        .map((r) => [r.reference, r.size, r.enhanced])
    ).toEqual([
      [SUBJECT_PARENT, expect.closeTo(km(100), 9), expect.closeTo(km(90), 9)]
    ])
  })

  /** A copy of the split file, `sql` run on it, and its rows for R003. */
  function editedSplit(name, sql) {
    const copy = path.join(dir, `${name}.gpkg`)
    copyFileSync(files.split, copy)
    const edit = new Database(copy)
    edit.exec(sql)
    edit.close()
    const { rows, notes } = workbookRowsFromBngService(copy)
    return {
      notes,
      rows,
      subject: rows.watercourseBaseline.filter((r) =>
        r.reference.startsWith(SUBJECT_PARENT)
      )
    }
  }

  it('keeps the whole parent, the rest lost, when its only Enhanced part has no line', () => {
    // The 90 m Enhanced part loses its line; the 40 m Retained part stays.
    const { subject, notes } = editedSplit(
      'undrawn-beside-retained',
      `UPDATE "${WATERCOURSES}" SET geom = NULL
         WHERE "Habitat Ref" = '${SUBJECT_PARENT}b'`
    )
    expect(notes).toEqual([
      `${WATERCOURSES} ${SUBJECT_PARENT}b: Enhanced parts of ${SUBJECT_PARENT} with no length drawn; left out, as they enhance nothing`
    ])
    expect(
      subject.map((r) => [r.reference, r.size, r.retained, r.enhanced])
    ).toEqual([
      [
        SUBJECT_PARENT,
        expect.closeTo(km(100), 9),
        expect.closeTo(km(40), 9),
        undefined
      ]
    ])
  })

  it('keeps the parent’s baseline row, all of it lost, when none of its Enhanced parts has a line', () => {
    const { subject, rows } = editedSplit(
      'all-undrawn',
      `UPDATE "${WATERCOURSES}" SET "Retention Category" = 'Enhanced',
         "Proposed Condition" = 'Good', "Enhancement Type" = 'Standard Enhancement',
         geom = NULL
         WHERE "Habitat Ref" LIKE '${SUBJECT_PARENT}_'`
    )
    expect(
      subject.map((r) => [r.reference, r.size, r.retained, r.enhanced])
    ).toEqual([
      [SUBJECT_PARENT, expect.closeTo(km(100), 9), undefined, undefined]
    ])
    expect(rows.watercourseBaseline.filter((r) => r.enhanced > 0)).toHaveLength(
      rows.watercourseEnhancement.length
    )
  })

  it.skipIf(!canRecalculate)(
    'recalculates the split with no "Split retained and enhanced" warning, compared under the parent',
    async () => {
      const { rows } = workbookRowsFromBngService(files.split)
      const xlsx = path.join(dir, 'split.xlsx')
      writeFileSync(
        xlsx,
        writeMetricWorkbook({ templateBuffer: readFileSync(TEMPLATE), rows })
      )
      const [results] = await recalculateWorkbooks([xlsx], {
        workDir: path.join(dir, 'recalc')
      })
      expect(
        results.rowWarnings.filter((w) => /split retained/i.test(w.message))
      ).toEqual([])
      expect(results.rowWarnings.filter((w) => /water/i.test(w.sheet))).toEqual(
        []
      )
      const figures = figuresFromWorkbook(results).filter(
        (f) => f.module === 'watercourse' && f.label.startsWith(SUBJECT_PARENT)
      )
      expect(figures.map((f) => f.label)).toEqual([
        `${SUBJECT_PARENT} baseline units`,
        `${SUBJECT_PARENT} retained units`,
        `${SUBJECT_PARENT}b enhanced units`
      ])
      const [baseline, retained] = figures
      // Moderate ditch, 0.1 km at 8 units per km: the parent whole.
      expect(baseline.value).toBeCloseTo(0.8, 9)
      expect(baseline.size).toBeCloseTo(km(100), 9)
      expect(retained.value).toBeCloseTo(0.32, 9)
    },
    120_000
  )
})

describe('the remeandered-watercourse-outside flaw', () => {
  let file
  beforeAll(() => {
    file = path.join(dir, 'remeandered-outside.gpkg')
    const { buffer } = generateSyntheticGpkg({
      format: 'bng-service',
      flaws: ['remeandered-watercourse-outside'],
      seed: SEED
    })
    writeFileSync(file, buffer)
  })

  function redline() {
    const db = new Database(file, { readonly: true })
    try {
      const geometry = wkbToGeoJSON(
        db.prepare('SELECT geom FROM "Red Line Boundary"').get().geom
      )
      return geometry.type === 'MultiPolygon'
        ? geometry.coordinates[0][0]
        : geometry.coordinates[0]
    } finally {
      db.close()
    }
  }

  function distanceToRing(point, ring) {
    let best = Infinity
    for (let i = 1; i < ring.length; i += 1) {
      const [a, b] = [ring[i - 1], ring[i]]
      const ex = b[0] - a[0]
      const ey = b[1] - a[1]
      const t = Math.max(
        0,
        Math.min(
          1,
          ((point[0] - a[0]) * ex + (point[1] - a[1]) * ey) /
            (ex * ex + ey * ey)
        )
      )
      best = Math.min(
        best,
        Math.hypot(point[0] - a[0] - ex * t, point[1] - a[1] - ey * t)
      )
    }
    return best
  }

  it('moves only the re-meandered channel’s bend 5 m outside the red line', () => {
    const ring = redline()
    const realigned = tableRows(file, WATERCOURSES).filter(
      (r) => r['Enhancement Type'] === 'Enhanced by Realignment'
    )
    expect(realigned).toHaveLength(1)
    const [start, bend, end] = wkbToGeoJSON(realigned[0].geom).coordinates
    expect(pointInRing(start, ring)).toBe(true)
    expect(pointInRing(end, ring)).toBe(true)
    expect(pointInRing(bend, ring)).toBe(false)
    expect(distanceToRing(bend, ring)).toBeCloseTo(5, 6)
    expect(realigned[0].Length).toBeCloseTo(realigned[0].metres, 6)
    for (const row of tableRows(file, BASELINE)) {
      for (const point of wkbToGeoJSON(row.geom).coordinates) {
        expect(pointInRing(point, ring)).toBe(true)
      }
    }
  })
})

describe('a change flaw on a site that cannot hold it', () => {
  const FLAW = 'remeandered-watercourse-outside'
  const generate = (options) => () =>
    generateSyntheticGpkg({
      format: 'bng-service',
      flaws: [FLAW],
      seed: SEED,
      ...options
    })

  it('is refused before drawing without template features', () => {
    expect(generate({ templateFeatures: false })).toThrow(
      /remeandered-watercourse-outside breaks a change the default site draws, so it needs template features on and no geometric flaw/
    )
  })

  it('is refused before drawing on a geometrically bad site', () => {
    expect(generate({ bad: true })).toThrow(
      /needs template features on and no geometric flaw/
    )
  })

  it('is refused before drawing with the rivers layer empty', () => {
    expect(generate({ flaws: ['no-rivers', FLAW] })).toThrow(
      /cannot be drawn with the rivers layer empty/
    )
  })

  it('is refused for a baseline-only file, which could not hold it', () => {
    expect(generate({ stage: STAGE_BASELINE })).toThrow(
      /cannot be written to a baseline-only file/
    )
  })

  it('says the red line had no room when the site drew no re-meander', () => {
    const site = { layers: { rivers: { postIntervention: [] } } }

    expect(() => BNG_SERVICE_FLAWS[FLAW].applyToSite(site)).toThrow(
      /found no re-meandered watercourse to move: the red line had no room for one on this site/
    )
  })

  it('is exported with its category, so a caller can sort it', () => {
    expect(BNG_SERVICE_FLAWS[FLAW].category).toBe(CATEGORY_CHANGE)
  })
})
