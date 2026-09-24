/**
 * Integration tests against the real Defra metric v4 workbook.
 *
 * The workbook is not committed here (see the README's "Synthetic metric
 * workbooks"), so these run only when METRIC_TEMPLATE points at a copy; the
 * recalculation test also needs LibreOffice. Without them the suite is
 * skipped, not failed.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateOne, setMode } from '../index.mjs'
import { SCENARIOS } from '../src/permutations/catalogue.mjs'
import {
  generatePermutations,
  scenarioPlan
} from '../src/permutations/generate.mjs'
import {
  METRIC_CORRECTIONS,
  METRIC_SHEETS,
  checkScenarioExpectations,
  isLibreOfficeAvailable,
  lintWorkbook,
  readMetricResults,
  readTemplateVocabulary,
  recalculateWorkbooks,
  workbookFromGeoPackage
} from '../src/workbook-writer/index.mjs'
import { readZip } from '../src/workbook-writer/xlsx-zip.mjs'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const TEMPLATE = process.env.METRIC_TEMPLATE
const hasTemplate = Boolean(TEMPLATE) && existsSync(TEMPLATE)
const CENTRE = [530000, 180000]
const SEED = 11
// The template is ~3.6MB; re-serialising it with a spreadsheet library takes
// it to ~82MB. Editing in place must keep it near its original size.
const MAX_WORKBOOK_BYTES = 4_000_000
// LibreOffice takes a few seconds a workbook.
const RECALC_TIMEOUT_MS = 180_000
// Writing a purpose's worth of GeoPackages and workbooks.
const GENERATE_TIMEOUT_MS = 60_000

function scenario(id) {
  return SCENARIOS.find((s) => s.id === id)
}

describe.skipIf(!hasTemplate)('workbook writer — real metric template', () => {
  let dir
  let template
  let vocabulary
  const written = {}

  function write(id) {
    const s = scenario(id)
    const pi = path.join(dir, `${id}.gpkg`)
    generateOne(pi, CENTRE, { ...scenarioPlan(s), seed: SEED })
    const result = workbookFromGeoPackage({
      postInterventionPath: pi,
      templateBuffer: template,
      vocabulary
    })
    const file = path.join(dir, `${id}.xlsx`)
    writeFileSync(file, result.buffer)
    written[id] = { ...result, file, scenario: s }
    return written[id]
  }

  beforeAll(() => {
    setMode('silent')
    dir = mkdtempSync(path.join(tmpdir(), 'bng-wb-template-'))
    template = readFileSync(TEMPLATE)
    vocabulary = readTemplateVocabulary(template)
    write('invalid-area-condition-reduced')
    write('trading-higher-deficit-not-covered-from-below')
    write('trading-low-deficit-covered-beside-medium-deficit')
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads the drop-down lists out of the template', () => {
    expect(vocabulary.broadHabitats).toContain('Grassland')
    expect(vocabulary.habitatTypes.Grassland).toContain(
      'Other neutral grassland'
    )
    expect(vocabulary.watercourseConditions.Culvert).toEqual(['Poor'])
    expect(vocabulary.riparianEncroachment.other).toContain(
      'No Encroachment/ No Encroachment'
    )
  })

  it('keeps the workbook the size the template was', () => {
    const { buffer } = written['invalid-area-condition-reduced']
    expect(buffer.length).toBeLessThan(MAX_WORKBOOK_BYTES)
  })

  it('puts inputs in the input cells and clears the example’s own rows', () => {
    const { file, rows } = written['invalid-area-condition-reduced']
    const workbook = XLSX.readFile(file)
    const a1 = workbook.Sheets[METRIC_SHEETS.habitatBaseline.sheet]
    const [first, second] = rows.habitatBaseline
    expect(a1.F11.v).toBe(first.habitatType)
    expect(a1.H11.v).toBe(first.size)
    expect(a1.T11.v).toBe(first.enhanced)
    expect(a1.S12.v).toBe(second.retained)
    // The example workbook held twelve habitats; only two remain.
    expect(a1.E13?.v ?? null).toBeNull()
    const a3 = workbook.Sheets[METRIC_SHEETS.habitatEnhancement.sheet]
    expect(a3.Q12.v).toBe('Grassland')
    expect(a3.Y12.v).toBe('Poor')
  })

  it('corrects the metric’s known bugs, and nothing else', () => {
    const corrected = XLSX.read(
      written['invalid-area-condition-reduced'].buffer,
      { type: 'buffer', cellFormula: true, sheetStubs: true }
    )
    const published = XLSX.read(template, {
      type: 'buffer',
      cellFormula: true,
      sheetStubs: true
    })
    for (const {
      sheet,
      ref,
      published: before,
      corrected: after
    } of METRIC_CORRECTIONS) {
      expect(published.Sheets[sheet][ref].f).toBe(before)
      expect(corrected.Sheets[sheet][ref].f).toBe(after)
    }
  })

  it('refuses a template whose formula a correction does not expect', () => {
    const [correction] = METRIC_CORRECTIONS
    expect(() =>
      workbookFromGeoPackage({
        postInterventionPath: path.join(
          dir,
          'invalid-area-condition-reduced.gpkg'
        ),
        templateBuffer: template,
        vocabulary,
        corrections: [{ ...correction, published: 'K88' }]
      })
    ).toThrow(/Cannot correct Trading Summary Area Habitats!K91/)
  })

  it('lints the published template clean, so the lint has no false alarms', () => {
    expect(lintWorkbook(template)).toEqual([])
  })

  it('writes a workbook Excel opens without repairing', () => {
    const zip = readZip(written['invalid-area-condition-reduced'].buffer)
    // A formula list that names overridden cells is removed by Excel's repair.
    expect(zip.has('xl/calcChain.xml')).toBe(false)
    expect(zip.read('xl/_rels/workbook.xml.rels').toString()).not.toContain(
      'calcChain'
    )
    expect(zip.read('[Content_Types].xml').toString()).not.toContain(
      'calcChain'
    )
    for (const { buffer } of Object.values(written)) {
      expect(lintWorkbook(buffer)).toEqual([])
    }
  })

  it('writes a workbook every input of which the template accepts', () => {
    expect(written['invalid-area-condition-reduced'].issues).toEqual([])
    expect(
      written['trading-higher-deficit-not-covered-from-below'].issues
    ).toEqual([])
  })

  it.skipIf(!isLibreOfficeAvailable())(
    'recalculates to the metric’s own verdict',
    async () => {
      const ids = Object.keys(written)
      const recalculated = await recalculateWorkbooks(
        ids.map((id) => written[id].file),
        { workDir: path.join(dir, 'recalc') }
      )
      ids.forEach((id, i) => {
        const results = recalculated[i]
        expect(typeof results.headline.baselineUnits.area).toBe('number')
        const checks = checkScenarioExpectations(written[id].scenario, results)
        expect(checks.length).toBeGreaterThan(0)
        expect(checks.filter((c) => !c.passed)).toEqual([])
      })
    },
    RECALC_TIMEOUT_MS
  )

  it('refuses to read results from a workbook that was never recalculated', () => {
    const { buffer } = written['invalid-area-condition-reduced']
    expect(() => readMetricResults(buffer)).toThrow(/not been recalculated/)
  })

  it(
    'adds each scenario’s workbook to the permutations output',
    () => {
      const { scenarios, manifest } = generatePermutations({
        only: 'trading-rules',
        seed: SEED,
        workbookTemplate: template
      })
      for (const s of scenarios) {
        expect(s.workbook.path).toBe(`trading-rules/${s.id}.xlsx`)
        expect(s.workbook.buffer.length).toBeLessThan(MAX_WORKBOOK_BYTES)
        expect(Array.isArray(s.workbook.issues)).toBe(true)
      }
      expect(manifest.scenarios[0].files.workbook).toMatch(/\.xlsx$/)
    },
    GENERATE_TIMEOUT_MS
  )
})
