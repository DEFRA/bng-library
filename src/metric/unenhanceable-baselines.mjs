import {
  DISTINCTIVENESS_CATEGORIES,
  HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  HEDGEROW_ENHANCEMENT_ALLOWED_MOVES,
  HEDGEROW_TIME_TO_TARGET_DISTINCTIVENESS_ENHANCEMENT,
  WATERCOURSE_DISTINCTIVENESS_CATEGORIES
} from './reference-constants.mjs'
import { ENHANCEMENT_KIND } from './enhancement-rules.mjs'

/**
 * Baselines the BNG service cannot enhance at all (BMD-1182). A file that
 * enhances one is refused outright, rather than having the enhancement nulled
 * as an invalid one (`checkEnhancement`).
 *
 * The rules are read from a baseline's distinctiveness and condition, and for
 * a Low hedgerow from the metric's hedgerow enhancement reference data, never
 * from a list of habitats. All but the Very Low hedgerow rule exist because
 * the service covers Medium distinctiveness and below: a Medium habitat in
 * Good condition can only be enhanced into a High or Very High habitat. They
 * are marked `mvsOnly`, and go once the service takes those habitats.
 */

const MEDIUM = 'Medium'
const LOW = 'Low'
const VERY_LOW = 'V.Low'
const GOOD = 'Good'
const NOT_POSSIBLE = 'Not Possible'

/** The rule that makes a baseline unenhanceable. */
export const UNENHANCEABLE_BASELINE = Object.freeze({
  /** Medium area habitat in Good condition (AC1) */
  MEDIUM_AREA_GOOD: 'medium-area-good',
  /** Medium hedgerow in Good condition (AC2) */
  MEDIUM_HEDGEROW_GOOD: 'medium-hedgerow-good',
  /** Medium watercourse in Good condition (AC3) */
  MEDIUM_WATERCOURSE_GOOD: 'medium-watercourse-good',
  /** Very Low hedgerow, in any condition (AC4) */
  VERY_LOW_HEDGEROW: 'very-low-hedgerow',
  /**
   * Low hedgerow in Good condition whose type the metric lets become no
   * Medium hedgerow (AC5)
   */
  LOW_HEDGEROW_GOOD_NO_MEDIUM_TARGET: 'low-hedgerow-good-no-medium-target'
})

/**
 * The rules removed once the service takes High and Very High habitats. The
 * Very Low hedgerow rule is the metric's own, so it stays.
 */
export const MVS_ONLY_UNENHANCEABLE_BASELINES = Object.freeze([
  UNENHANCEABLE_BASELINE.MEDIUM_AREA_GOOD,
  UNENHANCEABLE_BASELINE.MEDIUM_HEDGEROW_GOOD,
  UNENHANCEABLE_BASELINE.MEDIUM_WATERCOURSE_GOOD,
  UNENHANCEABLE_BASELINE.LOW_HEDGEROW_GOOD_NO_MEDIUM_TARGET
])

/**
 * @param {string} hedgerow a Low hedgerow type
 * @returns {boolean} whether the metric's hedgerow enhancement data (G-6)
 *   lets it become a Medium hedgerow: the move must be one its "Enhancement
 *   through Distinctiveness" table allows, and have a time to target
 */
function hasMediumHedgerowTarget(hedgerow) {
  const moves = HEDGEROW_ENHANCEMENT_ALLOWED_MOVES[hedgerow] ?? {}
  const years =
    HEDGEROW_TIME_TO_TARGET_DISTINCTIVENESS_ENHANCEMENT[hedgerow] ?? {}
  return Object.entries(moves).some(
    ([target, move]) =>
      HEDGEROW_DISTINCTIVENESS_CATEGORIES[target] === MEDIUM &&
      move !== NOT_POSSIBLE &&
      years[target] != null &&
      years[target] !== NOT_POSSIBLE
  )
}

/**
 * @typedef {object} UnenhanceableRule
 * @property {string} rule one of UNENHANCEABLE_BASELINE
 * @property {(baseline: { habitat: string, distinctiveness: string, condition: unknown }) => boolean} appliesTo
 */

/** @type {Record<string, { categories: Record<string, string>, rules: readonly UnenhanceableRule[] }>} */
const RULES_BY_KIND = Object.freeze({
  [ENHANCEMENT_KIND.area]: {
    categories: DISTINCTIVENESS_CATEGORIES,
    rules: Object.freeze([
      {
        rule: UNENHANCEABLE_BASELINE.MEDIUM_AREA_GOOD,
        appliesTo: ({ distinctiveness, condition }) =>
          distinctiveness === MEDIUM && condition === GOOD
      }
    ])
  },
  [ENHANCEMENT_KIND.hedgerow]: {
    categories: HEDGEROW_DISTINCTIVENESS_CATEGORIES,
    rules: Object.freeze([
      {
        rule: UNENHANCEABLE_BASELINE.MEDIUM_HEDGEROW_GOOD,
        appliesTo: ({ distinctiveness, condition }) =>
          distinctiveness === MEDIUM && condition === GOOD
      },
      {
        rule: UNENHANCEABLE_BASELINE.VERY_LOW_HEDGEROW,
        appliesTo: ({ distinctiveness }) => distinctiveness === VERY_LOW
      },
      {
        rule: UNENHANCEABLE_BASELINE.LOW_HEDGEROW_GOOD_NO_MEDIUM_TARGET,
        appliesTo: ({ habitat, distinctiveness, condition }) =>
          distinctiveness === LOW &&
          condition === GOOD &&
          !hasMediumHedgerowTarget(habitat)
      }
    ])
  },
  [ENHANCEMENT_KIND.watercourse]: {
    categories: WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
    rules: Object.freeze([
      {
        rule: UNENHANCEABLE_BASELINE.MEDIUM_WATERCOURSE_GOOD,
        appliesTo: ({ distinctiveness, condition }) =>
          distinctiveness === MEDIUM && condition === GOOD
      }
    ])
  }
})

/**
 * @typedef {object} UnenhanceableBaseline
 * @property {string} rule one of UNENHANCEABLE_BASELINE
 * @property {boolean} mvsOnly whether the rule goes once the service takes
 *   High and Very High habitats
 * @property {string} distinctiveness the baseline's
 */

/**
 * Whether a baseline habitat cannot be enhanced in the BNG service, whatever
 * it is enhanced into.
 *
 * Labels are matched exactly, as `checkEnhancement` takes them: the metric's
 * Habitat Type label and its condition label ("Good", not "3. Good").
 *
 * @param {string} kind one of ENHANCEMENT_KIND
 * @param {{ habitat?: unknown, condition?: unknown }} baseline
 * @returns {UnenhanceableBaseline | null} the rule it breaks, or null when it
 *   can be enhanced, or its kind or habitat is not one the metric knows
 */
export function unenhanceableBaseline(kind, baseline) {
  const kindRules = RULES_BY_KIND[kind]
  const habitat = baseline?.habitat
  if (
    !kindRules ||
    typeof habitat !== 'string' ||
    !Object.hasOwn(kindRules.categories, habitat)
  ) {
    return null
  }
  const distinctiveness = kindRules.categories[habitat]
  const match = kindRules.rules.find((rule) =>
    rule.appliesTo({ habitat, distinctiveness, condition: baseline.condition })
  )
  if (!match) {
    return null
  }
  return {
    rule: match.rule,
    mvsOnly: MVS_ONLY_UNENHANCEABLE_BASELINES.includes(match.rule),
    distinctiveness
  }
}
