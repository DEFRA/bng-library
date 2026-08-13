import { describe, expect, it } from 'vitest'
import {
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
    const { scenarios, manifest } = generatePermutations()
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
