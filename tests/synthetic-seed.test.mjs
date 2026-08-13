import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateOne, setMode } from '../index.mjs'

const CENTRE = [530000, 180000]
const NUM_PARCELS = 8

describe('generateOne — seeded reproducibility', () => {
  let outDir

  beforeAll(() => {
    setMode('silent')
    outDir = mkdtempSync(path.join(tmpdir(), 'bng-seed-'))
    // First generation cold-starts the better-sqlite3 native binding and the
    // generation pipeline (several seconds on a cold CI runner). Pay that once
    // here so each test measures only its own work, not one-time init.
    generateOne(path.join(outDir, 'warmup.gpkg'), CENTRE, { numParcels: 1 })
  })

  afterAll(() => {
    setMode('cli')
    rmSync(outDir, { recursive: true, force: true })
  })

  const hashOf = (name, plan) => {
    const file = path.join(outDir, name)
    generateOne(file, CENTRE, { numParcels: NUM_PARCELS, ...plan })
    return createHash('sha256').update(readFileSync(file)).digest('hex')
  }

  it('produces a byte-identical file for the same seed', () => {
    expect(hashOf('a.gpkg', { seed: 42 })).toBe(hashOf('b.gpkg', { seed: 42 }))
  })

  it('produces a different file for a different seed', () => {
    expect(hashOf('c.gpkg', { seed: 42 })).not.toBe(
      hashOf('d.gpkg', { seed: 43 })
    )
  })

  it('produces different files when no seed is given', () => {
    expect(hashOf('e.gpkg', {})).not.toBe(hashOf('f.gpkg', {}))
  })

  it('does not leak the seeded clock into later unseeded runs', () => {
    // A seeded run pins the metadata clock; make sure it is restored afterwards
    // so an unseeded run is still non-deterministic.
    hashOf('g.gpkg', { seed: 1 })
    expect(hashOf('h.gpkg', {})).not.toBe(hashOf('i.gpkg', {}))
  })
})
