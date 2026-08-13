import { describe, expect, it } from 'vitest'
import {
  ALL_HABITATS,
  IN_SCOPE_HEDGE_TYPES,
  IN_SCOPE_RIVER_TYPES,
  generatePermutations,
  PERMUTATION_PURPOSES,
  PERMUTATION_SCENARIOS,
  derivePermutationSeed
} from '../index.mjs'

describe('generatePermutations', () => {
  it('returns baseline + post-intervention buffers per scenario', () => {
    const { scenarios } = generatePermutations({ only: 'net-gain' })
    expect(scenarios.length).toBeGreaterThan(0)
    for (const s of scenarios) {
      expect(Buffer.isBuffer(s.baseline.buffer)).toBe(true)
      expect(Buffer.isBuffer(s.postIntervention.buffer)).toBe(true)
      expect(s.baseline.buffer.length).toBeGreaterThan(0)
      expect(s.postIntervention.path).toBe(
        `${s.purpose}/${s.id}-post-intervention.gpkg`
      )
    }
  })

  it('covers the whole catalogue by default', () => {
    // Selection coverage is independent of the (expensive) buffers, so enumerate
    // the catalogue as metadata only — the buffer shape is asserted separately.
    const { scenarios, manifest } = generatePermutations({ manifestOnly: true })
    expect(scenarios.length).toBe(PERMUTATION_SCENARIOS.length)
    expect(manifest.scenarios.length).toBe(PERMUTATION_SCENARIOS.length)
    // Manifest carries metadata, never the buffers.
    expect(manifest.scenarios[0].baseline).toBeUndefined()
    expect(new Set(scenarios.map((s) => s.purpose))).toEqual(
      new Set(PERMUTATION_PURPOSES)
    )
  })

  it('is byte-reproducible for the same seed', () => {
    const a = generatePermutations({ only: 'conditions', seed: 42 })
    const b = generatePermutations({ only: 'conditions', seed: 42 })
    expect(
      Buffer.compare(
        a.scenarios[0].postIntervention.buffer,
        b.scenarios[0].postIntervention.buffer
      )
    ).toBe(0)
  })

  it('differs for a different seed', () => {
    const a = generatePermutations({ only: 'conditions', seed: 42 })
    const b = generatePermutations({ only: 'conditions', seed: 43 })
    expect(
      Buffer.compare(
        a.scenarios[0].postIntervention.buffer,
        b.scenarios[0].postIntervention.buffer
      )
    ).not.toBe(0)
  })

  it('derives a stable per-scenario seed', () => {
    expect(derivePermutationSeed(1, 'net-gain-met')).toBe(
      derivePermutationSeed(1, 'net-gain-met')
    )
    expect(derivePermutationSeed(1, 'net-gain-met')).not.toBe(
      derivePermutationSeed(1, 'net-gain-unmet')
    )
  })
})

// The service rejects High / V.High distinctiveness habitats at upload, on
// both the baseline and post-intervention documents, deriving the band from
// the habitat/hedge/river type. A catalogue scenario that pins an
// out-of-scope type therefore generates a file that can never be uploaded.
describe('permutations catalogue scope', () => {
  const IN_SCOPE_BANDS = ['Medium', 'Low', 'V.Low']

  // Every (scenario, override field) pair pinning a value, flattened so the
  // assertions stay shallow and failures name the offending scenario.
  const pinned = (layer, keys) =>
    PERMUTATION_SCENARIOS.flatMap((scenario) =>
      (scenario.overrides?.[layer] ?? []).flatMap((row) =>
        keys
          .filter((key) => row[key] !== undefined)
          .map((key) => ({ id: scenario.id, value: row[key] }))
      )
    )

  it('only pins in-scope area habitats', () => {
    const bandOf = new Map(
      ALL_HABITATS.map((h) => [h.fullName, h.distinctiveness])
    )
    const pins = pinned('habitats', [
      'habitatFullName',
      'proposedHabitatFullName'
    ])
    expect(pins.length).toBeGreaterThan(0)
    for (const { id, value } of pins) {
      const band = bandOf.get(value)
      expect(band, `${id}: unknown habitat "${value}"`).toBeDefined()
      expect(
        IN_SCOPE_BANDS,
        `${id}: "${value}" is ${band} distinctiveness`
      ).toContain(band)
    }
  })

  it('only pins in-scope hedge types', () => {
    for (const { id, value } of pinned('hedgerows', [
      'hedgeType',
      'proposedHedgeType'
    ])) {
      expect(IN_SCOPE_HEDGE_TYPES, `${id}: "${value}"`).toContain(value)
    }
  })

  it('only pins in-scope river types', () => {
    for (const { id, value } of pinned('rivers', [
      'riverType',
      'proposedRiverType'
    ])) {
      expect(IN_SCOPE_RIVER_TYPES, `${id}: "${value}"`).toContain(value)
    }
  })
})
