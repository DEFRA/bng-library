import { BaselineLookupError } from './errors.mjs'
import { STRATEGIC_SIGNIFICANCE_MULTIPLIER } from './reference-constants.mjs'

/**
 * Baseline strategic significance is always Low (×1), and so is retained habitat, which
 * carries its baseline value. This is not the metric's own rule — the metric multiplies
 * both sides — but Defra's guidance that once a Local Nature Recovery Strategy is
 * published, baseline strategic significance "should always be scored as low" (User
 * Guide, July 2025, p. 29). BMD-315 AC9.
 */
export const LOW_STRATEGIC_SIGNIFICANCE = Object.freeze({
  strategicSignificanceCategory: 'Low',
  strategicSignificanceScore: 1
})

const CATEGORY_SUFFIX = ' strategic significance'

/**
 * Normalise a strategic significance label for lookup: case, runs of whitespace,
 * spacing around "/" (the metric's own "local strategy/ no local strategy" is
 * inconsistently spaced) and the workbook's " strategic significance" category suffix.
 *
 * @param {string} value
 * @returns {string}
 */
function normaliseStrategicSignificanceLabel(value) {
  const key = value
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/\s*\/\s*/g, '/')
  return key.endsWith(CATEGORY_SUFFIX)
    ? key.slice(0, -CATEGORY_SUFFIX.length)
    : key
}

/**
 * Every accepted label → its category and multiplier. The metric's drop-down
 * descriptions ("Formally identified in local strategy") are the canonical form; the
 * category names ("High", "High strategic significance") are accepted as well.
 */
const LOOKUP = new Map(
  Object.entries(STRATEGIC_SIGNIFICANCE_MULTIPLIER).flatMap(
    ([description, { Category, Multiplier }]) => {
      const resolved = Object.freeze({
        strategicSignificanceCategory: Category,
        strategicSignificanceScore: Multiplier
      })
      return [
        [normaliseStrategicSignificanceLabel(description), resolved],
        [normaliseStrategicSignificanceLabel(Category), resolved]
      ]
    }
  )
)

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isBlank(value) {
  return value == null || (typeof value === 'string' && value.trim() === '')
}

/**
 * Whether a proposed strategic significance value is absent or maps to a known
 * multiplier. Absent values are recognised (they resolve to Low).
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isRecognisedStrategicSignificance(value) {
  if (isBlank(value)) {
    return true
  }
  return (
    typeof value === 'string' &&
    LOOKUP.has(normaliseStrategicSignificanceLabel(value))
  )
}

/**
 * Resolve a feature's Proposed Strategic Significance to its category and multiplier
 * (G-3 Multipliers: High ×1.15, Medium ×1.10, Low ×1). An absent value resolves to Low,
 * which is what the service applied to every feature before strategic significance
 * was read.
 *
 * @param {string | null | undefined} value - e.g. "Formally identified in local strategy"
 * @returns {{ strategicSignificanceCategory: string, strategicSignificanceScore: number }}
 * @throws {BaselineLookupError} If a non-empty value is not a recognised label
 */
export function resolveStrategicSignificance(value) {
  if (isBlank(value)) {
    return LOW_STRATEGIC_SIGNIFICANCE
  }
  if (typeof value !== 'string') {
    throw new BaselineLookupError('Strategic significance must be a string')
  }
  const resolved = LOOKUP.get(normaliseStrategicSignificanceLabel(value))
  if (!resolved) {
    throw new BaselineLookupError(
      `Strategic significance multiplier not found for: ${value}`
    )
  }
  return resolved
}
