import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// The buffer API parses the workbook with xlsx first. A real metric workbook
// is over 3 MB, so the parse is replaced with the parsed fixture: what is
// under test is the route from a parsed workbook to the buffer it returns.
vi.mock('../src/workbook/metric-workbook.mjs', async (original) => ({
  ...(await original()),
  readMetricWorkbookFromBuffer: () =>
    JSON.parse(
      readFileSync(
        new URL('./fixtures/workbook-hedgerow-created.json', import.meta.url),
        'utf8'
      )
    )
}))

const {
  checkTemplateValues,
  generateFromWorkbookBuffer,
  readVersionRecords,
  setMode
} = await import('../index.mjs')

let dir

beforeAll(() => {
  setMode('silent')
  dir = mkdtempSync(path.join(tmpdir(), 'bng-service-workbook-'))
})

afterAll(() => {
  setMode('cli')
  rmSync(dir, { recursive: true, force: true })
})

describe('generateFromWorkbookBuffer in the BNG Service format', () => {
  it('returns one buffer holding both stages', () => {
    const result = generateFromWorkbookBuffer({
      workbookBuffer: Buffer.from('parsed by the mock'),
      workbookFilename: 'hedgerow-created.xlsx',
      format: 'bng-service'
    })
    expect(result.success).toBe(true)
    expect(result.baseline).toBeUndefined()
    expect(result.postIntervention).toBeUndefined()
    expect(result.filenameHint).toMatch(
      /^hedgerow-created-bng-service-\d{8}-\d{4}-\d{2}\.gpkg$/
    )
    const out = path.join(dir, 'both.gpkg')
    writeFileSync(out, result.buffer)
    expect(checkTemplateValues(out)).toEqual([])
    const db = new Database(out, { readonly: true })
    expect(readVersionRecords(db)).toEqual([
      { format: 'bng-service', version: '1.0' }
    ])
    expect(
      db
        .prepare('SELECT COUNT(*) AS n FROM "Area Habitats Post-Intervention"')
        .get().n
    ).toBeGreaterThan(0)
    db.close()
  })

  it("writes the baseline-stage file for mode 'baseline'", () => {
    const result = generateFromWorkbookBuffer({
      workbookBuffer: Buffer.from('parsed by the mock'),
      workbookFilename: 'hedgerow-created.xlsx',
      format: 'bng-service',
      mode: 'baseline',
      templateVersion: '1.1'
    })
    expect(result.filenameHint).toMatch(/-bng-service-baseline-/)
    const out = path.join(dir, 'baseline.gpkg')
    writeFileSync(out, result.buffer)
    const db = new Database(out, { readonly: true })
    expect(
      db
        .prepare('SELECT COUNT(*) AS n FROM "Area Habitats Post-Intervention"')
        .get().n
    ).toBe(0)
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM "Area Habitats Baseline"').get().n
    ).toBeGreaterThan(0)
    expect(readVersionRecords(db)).toEqual([
      { format: 'bng-service', version: '1.1' }
    ])
    db.close()
  })

  it('keeps the legacy pair the default', () => {
    const result = generateFromWorkbookBuffer({
      workbookBuffer: Buffer.from('parsed by the mock'),
      workbookFilename: 'hedgerow-created.xlsx'
    })
    expect(result.baseline.buffer.length).toBeGreaterThan(0)
    expect(result.postIntervention.buffer.length).toBeGreaterThan(0)
    expect(result.buffer).toBeUndefined()
  })

  describe('with a seed', () => {
    const generate = (options) =>
      generateFromWorkbookBuffer({
        workbookBuffer: Buffer.from('parsed by the mock'),
        workbookFilename: 'hedgerow-created.xlsx',
        ...options
      })

    it('gives the same BNG Service file to the byte for the same seed', () => {
      const first = generate({ format: 'bng-service', seed: 42 })
      const second = generate({ format: 'bng-service', seed: 42 })
      expect(first.buffer.equals(second.buffer)).toBe(true)
    })

    it('gives a different BNG Service file for a different seed', () => {
      const first = generate({ format: 'bng-service', seed: 42 })
      const second = generate({ format: 'bng-service', seed: 43 })
      expect(first.buffer.equals(second.buffer)).toBe(false)
    })

    it('draws afresh without one', () => {
      const first = generate({ format: 'bng-service' })
      const second = generate({ format: 'bng-service' })
      expect(first.buffer.equals(second.buffer)).toBe(false)
    })

    it('gives the same legacy pair to the byte for the same seed', () => {
      const first = generate({ seed: 42 })
      const second = generate({ seed: 42 })
      expect(first.baseline.buffer.equals(second.baseline.buffer)).toBe(true)
      expect(
        first.postIntervention.buffer.equals(second.postIntervention.buffer)
      ).toBe(true)
    })
  })
})
