/**
 * Reproducible choices for the parts of a BNG Service site the legacy
 * generator does not draw: tree types, comments, vertical area habitats and
 * the hidden feature identities. Seeded, the same seed always gives the same
 * file; unseeded, every run differs. Kept apart from the geometry module's
 * random source so the legacy draws are untouched.
 */

import { createHash, randomUUID } from 'node:crypto'

const UINT32 = 2 ** 32
const MULBERRY_INCREMENT = 0x6d2b79f5
const SHIFT_A = 15
const SHIFT_B = 7
const SHIFT_C = 14
const MIX_ODD = 61
// Keeps this sequence apart from the geometry module's for the same seed.
const STREAM_SALT = 0x5eed_b5e5
const UUID_VERSION_5 = 0x50
const UUID_VARIANT = 0x80
const UUID_VERSION_BYTE = 6
const UUID_VARIANT_BYTE = 8
const LOW_NIBBLE = 0x0f
const LOW_SIX_BITS = 0x3f
const UUID_BYTES = 16
// RFC 4122's URL namespace, as the template's own generators use.
const URL_NAMESPACE = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex')
const UUID_GROUPS = [8, 4, 4, 4, 12]

function mulberry32(seed) {
  let state = seed | 0
  return () => {
    state = (state + MULBERRY_INCREMENT) | 0
    let t = Math.imul(state ^ (state >>> SHIFT_A), 1 | state)
    t = (t + Math.imul(t ^ (t >>> SHIFT_B), MIX_ODD | t)) ^ t
    return ((t ^ (t >>> SHIFT_C)) >>> 0) / UINT32
  }
}

/** A version 5 UUID of `name` in the URL namespace. */
export function uuidV5(name) {
  const bytes = createHash('sha1')
    .update(URL_NAMESPACE)
    .update(name)
    .digest()
    .subarray(0, UUID_BYTES)
  bytes[UUID_VERSION_BYTE] =
    (bytes[UUID_VERSION_BYTE] & LOW_NIBBLE) | UUID_VERSION_5
  bytes[UUID_VARIANT_BYTE] =
    (bytes[UUID_VARIANT_BYTE] & LOW_SIX_BITS) | UUID_VARIANT
  const hex = bytes.toString('hex')
  let at = 0
  return UUID_GROUPS.map((length) => {
    const group = hex.slice(at, at + length)
    at += length
    return group
  }).join('-')
}

/**
 * A chooser: `next()` in [0, 1), `pick(list)`, `chance(p)`, `between(a, b)`,
 * and `uuid(name)`, a feature identity. Seeded when `seed` is an integer.
 */
export function createChooser(seed) {
  const seeded = Number.isInteger(seed)
  const next = seeded ? mulberry32(seed ^ STREAM_SALT) : Math.random
  return {
    seeded,
    next,
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    between: (min, max) => min + next() * (max - min),
    uuid: (name) =>
      seeded ? uuidV5(`bng-library/${seed}/${name}`) : randomUUID()
  }
}
