/**
 * Known causes of a feature's units differing from the metric's.
 *
 * A feature's units are its size times a product of multipliers, so a
 * difference that comes from pricing a different size, or from leaving a
 * multiplier out, can be recognised exactly: rescale the metric's units by
 * the service's size over the metric's, divide out a multiplier the service
 * does not apply, and see whether the service's figure is what is left.
 *
 * A cause only explains a discrepancy; it never excuses one. The discrepancy
 * is still reported and still counts, with the cause beside it, so the
 * difference that has no explanation stands out.
 */

import { CATEGORY } from './figures.mjs'

/**
 * @typedef {object} Cause
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {boolean} notImplemented the service does not do this yet
 */

export const CAUSES = Object.freeze({
  sizeRounding: Object.freeze({
    id: 'size-rounding',
    title: 'Priced on a different size',
    description:
      'The service priced the feature on a different size from the metric. Both should price the size measured from the geometry, unrounded; a service before BMD-1042 rounded each area to the whole square metre and each length to the whole metre first.',
    notImplemented: false
  }),
  strategicSignificance: Object.freeze({
    id: 'strategic-significance',
    title: 'Strategic significance not applied',
    description:
      'Strategic significance is not implemented in the engine: every feature is priced with a strategic significance multiplier of 1, where the metric applies 1.1 (location ecologically desirable) or 1.15 (formally identified in a local strategy).',
    notImplemented: true
  })
})

/** Causes by id, for the report. */
export const CAUSES_BY_ID = Object.freeze(
  Object.fromEntries(Object.values(CAUSES).map((c) => [c.id, c]))
)

// The rescaled figure is recomputed in floating point, so it can only be
// expected to agree to about this relative precision — far tighter than any
// real difference in pricing, and far looser than the arithmetic's noise.
const RELATIVE_TOLERANCE = 1e-9
const NO_MULTIPLIER = 1

function isPositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function agrees(a, b) {
  return (
    Math.abs(a - b) <= RELATIVE_TOLERANCE * Math.max(Math.abs(a), Math.abs(b))
  )
}

/**
 * The causes that account exactly for a feature's units differing.
 *
 * @param {import('./figures.mjs').Figure} expected the metric's figure, with
 *   the `size` and `strategicSignificanceMultiplier` it was priced on
 * @param {import('./figures.mjs').Figure} actual the service's figure, with
 *   the `size` it was priced on
 * @returns {string[]} cause ids; empty when nothing known accounts for it
 */
export function causesOfFeatureDifference(expected, actual) {
  if (
    expected?.category !== CATEGORY.featureUnits ||
    typeof expected.value !== 'number' ||
    typeof actual?.value !== 'number' ||
    !isPositive(expected.size) ||
    !isPositive(actual.size)
  ) {
    return []
  }
  const multiplier = isPositive(expected.strategicSignificanceMultiplier)
    ? expected.strategicSignificanceMultiplier
    : NO_MULTIPLIER
  const rescaled = (expected.value * (actual.size / expected.size)) / multiplier
  if (!agrees(rescaled, actual.value)) {
    return []
  }
  const causes = []
  if (!agrees(expected.size, actual.size)) {
    causes.push(CAUSES.sizeRounding.id)
  }
  if (multiplier !== NO_MULTIPLIER) {
    causes.push(CAUSES.strategicSignificance.id)
  }
  return causes
}
