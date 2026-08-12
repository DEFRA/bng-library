/**
 * Fold a run seed together with a scenario id into a stable per-scenario seed,
 * so `seed = S` reproduces every fixture regardless of how many scenarios run
 * or in what order. Shared by the harness CLI and the buffer API so both emit
 * identical files for the same seed.
 */

// FNV-1a 32-bit constants.
const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

export function derivePermutationSeed(baseSeed, id) {
  let hash = FNV_OFFSET_BASIS ^ (baseSeed >>> 0)
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}
