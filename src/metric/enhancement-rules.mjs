import {
  DISTINCTIVENESS_CATEGORIES,
  DISTINCTIVENESS_SCORES,
  HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  HEDGEROW_DISTINCTIVENESS_SCORES,
  HEDGEROW_TIME_TO_TARGET_DISTINCTIVENESS_ENHANCEMENT,
  HEDGEROW_TIME_TO_TARGET_ENHANCEMENT,
  TIME_TO_TARGET_ENHANCEMENT,
  WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
  WATERCOURSE_DISTINCTIVENESS_SCORES,
  WATERCOURSE_TIME_TO_TARGET_DISTINCTIVENESS_ENHANCEMENT,
  WATERCOURSE_TIME_TO_TARGET_ENHANCEMENT
} from './reference-constants.mjs'
import { broadHabitatOf } from './area-trading-rules.mjs'

/**
 * The BNG service's enhancement rules: which proposed habitats an
 * enhanced habitat may become, given the baseline it enhances.
 *
 * These are the service's rules, not the metric's. The service covers Medium,
 * Low and Very Low distinctiveness habitats only, so Medium is the highest band
 * an enhancement can reach, and those are the only baselines with rules. A
 * Very Low hedgerow cannot be enhanced at all, and a culvert only by becoming a
 * Medium watercourse, as the metric's enhancement sheet allows.
 *
 * On top of its rule, every enhancement must have a time to target: one the
 * metric gives as "Not Possible" is not valid, whichever rule allows it. The
 * metric does not offer it, and the calculator cannot price it.
 */

const MEDIUM = 'Medium'
const LOW = 'Low'
const VERY_LOW = 'V.Low'

const CONDITION_ASSESSMENT_NA = 'Condition Assessment N/A'
const NA_OTHER = 'N/A - Other'

/**
 * The area enhancement time-to-target table's start bands that are not a
 * baseline condition: "Lower" for a proposed habitat of a higher
 * distinctiveness, and "CA N/A" for a baseline whose condition cannot be
 * assessed.
 */
const TIME_TO_TARGET_START = Object.freeze({
  lowerDistinctiveness: 'Lower',
  conditionAssessmentNa: 'CA N/A'
})
const NOT_POSSIBLE = 'Not Possible'

/** Condition bands in order, by the score the metric gives each. */
const CONDITION_RANK = Object.freeze({
  Poor: 1,
  'Fairly Poor': 1.5,
  Moderate: 2,
  'Fairly Good': 2.5,
  Good: 3
})

/**
 * A condition that cannot be assessed has no rank. It is a known value, so an
 * enhancement to it is checked (and fails "better than"), unlike a value
 * nothing recognises, which leaves the rule unchecked.
 */
const UNRANKED_CONDITIONS = Object.freeze([CONDITION_ASSESSMENT_NA, NA_OTHER])

/** The two intertidal broad habitats, which may enhance into each other. */
const INTERTIDAL_BROAD_HABITATS = Object.freeze([
  'Intertidal hard structures',
  'Intertidal sediment'
])

/** The habitat kinds the rules cover, as `checkEnhancement` takes them. */
export const ENHANCEMENT_KIND = Object.freeze({
  area: 'area',
  hedgerow: 'hedgerow',
  watercourse: 'watercourse'
})

/** The rule an enhancement is checked against, one per baseline it covers. */
export const ENHANCEMENT_RULE = Object.freeze({
  /** Medium area with a condition, not intertidal */
  MEDIUM_AREA: 'medium-area',
  /** Medium area, Condition Assessment N/A, not intertidal */
  MEDIUM_AREA_CONDITION_NA: 'medium-area-condition-assessment-na',
  /** Medium area, intertidal hard structures or sediment */
  MEDIUM_INTERTIDAL_AREA: 'medium-intertidal-area',
  /** Low area with a condition */
  LOW_AREA: 'low-area',
  /** Low area, Condition Assessment N/A */
  LOW_AREA_CONDITION_NA: 'low-area-condition-assessment-na',
  /** Very Low area */
  VERY_LOW_AREA: 'very-low-area',
  /** Medium hedgerow */
  MEDIUM_HEDGEROW: 'medium-hedgerow',
  /** Low hedgerow */
  LOW_HEDGEROW: 'low-hedgerow',
  /** Very Low hedgerow */
  VERY_LOW_HEDGEROW: 'very-low-hedgerow',
  /** Medium watercourse */
  MEDIUM_WATERCOURSE: 'medium-watercourse',
  /** Low watercourse: a culvert */
  LOW_WATERCOURSE: 'low-watercourse'
})

/**
 * @typedef {object} ResolvedSide
 * @property {string} habitat
 * @property {string} broadHabitat area habitats only
 * @property {string} distinctiveness
 * @property {string} condition
 * @property {number | null} rank null for a condition that cannot be assessed
 */

/**
 * @param {unknown} condition
 * @returns {{ condition: string, rank: number | null } | null} null when the
 *   condition is not one the rules know
 */
function resolveCondition(condition) {
  if (typeof condition !== 'string') {
    return null
  }
  if (Object.hasOwn(CONDITION_RANK, condition)) {
    return { condition, rank: CONDITION_RANK[condition] }
  }
  if (UNRANKED_CONDITIONS.includes(condition)) {
    return { condition, rank: null }
  }
  return null
}

/**
 * @param {Record<string, string>} categories habitat → distinctiveness band
 * @param {{ habitat?: unknown, condition?: unknown } | undefined} side
 * @returns {ResolvedSide | null}
 */
function resolveSide(categories, side) {
  const habitat = side?.habitat
  const condition = resolveCondition(side?.condition)
  if (
    typeof habitat !== 'string' ||
    !Object.hasOwn(categories, habitat) ||
    !condition
  ) {
    return null
  }
  return {
    habitat,
    broadHabitat: broadHabitatOf(habitat),
    distinctiveness: categories[habitat],
    ...condition
  }
}

/**
 * The rank a baseline condition is compared against. A baseline whose
 * condition cannot be assessed compares as Poor: the rules for those
 * baselines ask for a condition better than Poor.
 *
 * @param {ResolvedSide} baseline
 * @returns {number}
 */
function baselineRank(baseline) {
  return baseline.rank ?? CONDITION_RANK.Poor
}

/**
 * @param {ResolvedSide} proposed
 * @param {ResolvedSide} baseline
 * @returns {boolean}
 */
function isBetterCondition(proposed, baseline) {
  return proposed.rank !== null && proposed.rank > baselineRank(baseline)
}

/**
 * @param {ResolvedSide} proposed
 * @param {ResolvedSide} baseline
 * @returns {boolean}
 */
function isSameOrBetterCondition(proposed, baseline) {
  return proposed.rank !== null && proposed.rank >= baselineRank(baseline)
}

/**
 * @param {ResolvedSide} proposed
 * @returns {boolean} whether the condition is one of the ranked bands, Poor to
 *   Good
 */
function hasRankedCondition(proposed) {
  return proposed.rank !== null
}

/**
 * @param {ResolvedSide} proposed
 * @returns {boolean}
 */
function isBetterThanPoor(proposed) {
  return proposed.rank !== null && proposed.rank > CONDITION_RANK.Poor
}

/**
 * @param {Record<string, { Score: number }>} scores distinctiveness band →
 *   its score
 * @param {ResolvedSide} proposed
 * @param {ResolvedSide} baseline
 * @returns {boolean} whether the proposed habitat is of a higher
 *   distinctiveness, which the time-to-target tables treat apart
 */
function isDistinctivenessUplift(scores, proposed, baseline) {
  return (
    scores[proposed.distinctiveness].Score >
    scores[baseline.distinctiveness].Score
  )
}

/**
 * The metric's standard enhancement time to target for an area habitat, as
 * the calculator looks it up (post-intervention.mjs).
 *
 * @param {ResolvedSide} proposed
 * @param {ResolvedSide} baseline
 * @returns {unknown} years, "30+", "Not Possible", or undefined if none
 */
function areaTimeToTarget(proposed, baseline) {
  let startBand = baseline.condition
  if (isDistinctivenessUplift(DISTINCTIVENESS_SCORES, proposed, baseline)) {
    startBand = TIME_TO_TARGET_START.lowerDistinctiveness
  } else if (isConditionAssessmentNa(baseline)) {
    startBand = TIME_TO_TARGET_START.conditionAssessmentNa
  }
  return TIME_TO_TARGET_ENHANCEMENT[proposed.habitat]?.[startBand]?.[
    proposed.condition
  ]
}

/**
 * The metric's standard enhancement time to target for a hedgerow, as the
 * calculator looks it up (hedgerow-post-intervention.mjs): type to type for
 * a higher distinctiveness, else condition to condition.
 *
 * @param {ResolvedSide} proposed
 * @param {ResolvedSide} baseline
 * @returns {unknown}
 */
function hedgerowTimeToTarget(proposed, baseline) {
  if (
    isDistinctivenessUplift(HEDGEROW_DISTINCTIVENESS_SCORES, proposed, baseline)
  ) {
    return HEDGEROW_TIME_TO_TARGET_DISTINCTIVENESS_ENHANCEMENT[
      baseline.habitat
    ]?.[proposed.habitat]
  }
  return HEDGEROW_TIME_TO_TARGET_ENHANCEMENT[proposed.habitat]?.[
    baseline.condition
  ]?.[proposed.condition]
}

/**
 * The metric's standard enhancement time to target for a watercourse, as the
 * calculator looks it up (watercourse-post-intervention.mjs): one figure for
 * a higher distinctiveness, else condition to condition.
 *
 * @param {ResolvedSide} proposed
 * @param {ResolvedSide} baseline
 * @returns {unknown}
 */
function watercourseTimeToTarget(proposed, baseline) {
  if (
    isDistinctivenessUplift(
      WATERCOURSE_DISTINCTIVENESS_SCORES,
      proposed,
      baseline
    )
  ) {
    return WATERCOURSE_TIME_TO_TARGET_DISTINCTIVENESS_ENHANCEMENT
  }
  return WATERCOURSE_TIME_TO_TARGET_ENHANCEMENT[proposed.habitat]?.[
    baseline.condition
  ]?.[proposed.condition]
}

/**
 * @param {unknown} timeToTarget a time-to-target table entry, or null for none
 * @returns {boolean} whether the metric gives one: an entry it does not allow
 *   is "Not Possible", and one with no entry is not possible either
 */
function isPossible(timeToTarget) {
  return timeToTarget !== null && timeToTarget !== NOT_POSSIBLE
}

/**
 * @param {ResolvedSide} side
 * @returns {boolean}
 */
function isIntertidal(side) {
  return INTERTIDAL_BROAD_HABITATS.includes(side.broadHabitat)
}

/**
 * @param {ResolvedSide} side
 * @returns {boolean}
 */
function isConditionAssessmentNa(side) {
  return side.condition === CONDITION_ASSESSMENT_NA
}

/**
 * @typedef {object} EnhancementRule
 * @property {string} rule one of ENHANCEMENT_RULE
 * @property {(baseline: ResolvedSide) => boolean} appliesTo
 * @property {(proposed: ResolvedSide, baseline: ResolvedSide) => boolean} allows
 */

/**
 * Checked in order; the first rule that applies to the baseline decides. The
 * intertidal rule comes first because the other Medium area rules exclude the
 * intertidal broad habitats.
 *
 * @type {readonly EnhancementRule[]}
 */
const AREA_RULES = Object.freeze([
  {
    rule: ENHANCEMENT_RULE.MEDIUM_INTERTIDAL_AREA,
    appliesTo: (baseline) =>
      baseline.distinctiveness === MEDIUM && isIntertidal(baseline),
    allows: (proposed, baseline) =>
      proposed.distinctiveness === MEDIUM &&
      isIntertidal(proposed) &&
      isBetterCondition(proposed, baseline)
  },
  {
    rule: ENHANCEMENT_RULE.MEDIUM_AREA_CONDITION_NA,
    appliesTo: (baseline) =>
      baseline.distinctiveness === MEDIUM && isConditionAssessmentNa(baseline),
    allows: (proposed) =>
      proposed.distinctiveness === MEDIUM && isBetterThanPoor(proposed)
  },
  {
    rule: ENHANCEMENT_RULE.MEDIUM_AREA,
    appliesTo: (baseline) => baseline.distinctiveness === MEDIUM,
    allows: (proposed, baseline) =>
      proposed.distinctiveness === MEDIUM &&
      proposed.broadHabitat === baseline.broadHabitat &&
      isBetterCondition(proposed, baseline)
  },
  {
    rule: ENHANCEMENT_RULE.LOW_AREA_CONDITION_NA,
    appliesTo: (baseline) =>
      baseline.distinctiveness === LOW && isConditionAssessmentNa(baseline),
    // No Low area could be enhanced into another Low area from Condition
    // Assessment N/A anyway: the metric gives none a time to target.
    allows: (proposed) => proposed.distinctiveness === MEDIUM
  },
  {
    // A Medium proposed habitat is allowed in any condition here, Condition
    // Assessment N/A included, as long as it has a time to target.
    rule: ENHANCEMENT_RULE.LOW_AREA,
    appliesTo: (baseline) => baseline.distinctiveness === LOW,
    allows: (proposed, baseline) =>
      (proposed.distinctiveness === LOW &&
        isBetterCondition(proposed, baseline)) ||
      proposed.distinctiveness === MEDIUM
  },
  {
    // A Very Low area habitat's only condition is "N/A - Other", which cannot
    // improve, so it is enhanced only by becoming a Low or Medium habitat, in
    // a condition from Poor to Good.
    rule: ENHANCEMENT_RULE.VERY_LOW_AREA,
    appliesTo: (baseline) => baseline.distinctiveness === VERY_LOW,
    allows: (proposed) =>
      (proposed.distinctiveness === LOW ||
        proposed.distinctiveness === MEDIUM) &&
      hasRankedCondition(proposed)
  }
])

/** @type {readonly EnhancementRule[]} */
const HEDGEROW_RULES = Object.freeze([
  {
    rule: ENHANCEMENT_RULE.MEDIUM_HEDGEROW,
    appliesTo: (baseline) => baseline.distinctiveness === MEDIUM,
    allows: (proposed, baseline) =>
      proposed.distinctiveness === MEDIUM &&
      isBetterCondition(proposed, baseline)
  },
  {
    rule: ENHANCEMENT_RULE.LOW_HEDGEROW,
    appliesTo: (baseline) => baseline.distinctiveness === LOW,
    allows: (proposed, baseline) =>
      (proposed.distinctiveness === LOW &&
        isBetterCondition(proposed, baseline)) ||
      (proposed.distinctiveness === MEDIUM &&
        isSameOrBetterCondition(proposed, baseline))
  },
  {
    // The metric does not allow a Very Low hedgerow to be enhanced: it can
    // only be lost and another hedgerow created.
    rule: ENHANCEMENT_RULE.VERY_LOW_HEDGEROW,
    appliesTo: (baseline) => baseline.distinctiveness === VERY_LOW,
    allows: () => false
  }
])

/** @type {readonly EnhancementRule[]} */
const WATERCOURSE_RULES = Object.freeze([
  {
    rule: ENHANCEMENT_RULE.MEDIUM_WATERCOURSE,
    appliesTo: (baseline) => baseline.distinctiveness === MEDIUM,
    allows: (proposed, baseline) =>
      proposed.habitat === baseline.habitat &&
      isBetterCondition(proposed, baseline)
  },
  {
    // A Low watercourse is a culvert, which is enhanced only by becoming a
    // Medium watercourse: the metric has no enhancement of a culvert that
    // stays a culvert.
    rule: ENHANCEMENT_RULE.LOW_WATERCOURSE,
    appliesTo: (baseline) => baseline.distinctiveness === LOW,
    allows: (proposed) => proposed.distinctiveness === MEDIUM
  }
])

const RULES_BY_KIND = Object.freeze({
  [ENHANCEMENT_KIND.area]: {
    categories: DISTINCTIVENESS_CATEGORIES,
    rules: AREA_RULES,
    timeToTarget: areaTimeToTarget
  },
  [ENHANCEMENT_KIND.hedgerow]: {
    categories: HEDGEROW_DISTINCTIVENESS_CATEGORIES,
    rules: HEDGEROW_RULES,
    timeToTarget: hedgerowTimeToTarget
  },
  [ENHANCEMENT_KIND.watercourse]: {
    categories: WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
    rules: WATERCOURSE_RULES,
    timeToTarget: watercourseTimeToTarget
  }
})

/**
 * @param {string} kind one of ENHANCEMENT_KIND
 * @returns {string[]} the ENHANCEMENT_RULE values an enhancement of that kind
 *   can break, in the order they are checked
 */
export function enhancementRulesFor(kind) {
  return (RULES_BY_KIND[kind]?.rules ?? []).map(({ rule }) => rule)
}

/**
 * @typedef {object} EnhancementSide
 * @property {string} habitat the metric's Habitat Type label, e.g.
 *   "Grassland - Modified grassland", "Native hedgerow" or "Ditches"
 * @property {string} condition the metric's condition label, e.g. "Moderate"
 *   or "Condition Assessment N/A"
 */

/**
 * Why `checkEnhancement` could not check an enhancement. The `unrecognised*`
 * reasons mean bad input: a kind, habitat or condition that is not the
 * metric's label (an unnormalised value such as "2. Moderate" included).
 * `noRule` means the input is fine but the baseline is out of the rules'
 * scope: High or Very High.
 */
export const ENHANCEMENT_NOT_CHECKED_REASON = Object.freeze({
  unrecognisedKind: 'unrecognised-kind',
  unrecognisedBaseline: 'unrecognised-baseline',
  unrecognisedProposed: 'unrecognised-proposed',
  noRule: 'no-rule'
})

/**
 * @typedef {object} EnhancementChecked
 * @property {true} checked
 * @property {string} rule the ENHANCEMENT_RULE the baseline is checked against
 * @property {boolean} valid whether the proposed habitat satisfies it and has
 *   a time to target
 * @property {boolean} allowedByRule whether the proposed habitat satisfies the
 *   rule, whatever its time to target
 * @property {unknown} timeToTarget the metric's enhancement time-to-target
 *   entry: years, "30+", "Not Possible", or null when the table has none
 * @property {string} baselineDistinctiveness
 * @property {string} proposedDistinctiveness
 */

/**
 * @typedef {object} EnhancementNotChecked
 * @property {false} checked
 * @property {string} reason one of ENHANCEMENT_NOT_CHECKED_REASON
 */

/**
 * @param {string} reason
 * @returns {EnhancementNotChecked}
 */
function notChecked(reason) {
  return { checked: false, reason }
}

/**
 * Check an enhancement against the BNG service's rule for its baseline, and
 * that the metric gives it a time to target.
 *
 * Labels are matched exactly, as the reference tables key them, so a caller
 * reading user data normalises it first (trimming, case, a condition's list
 * index).
 *
 * @param {string} kind one of ENHANCEMENT_KIND
 * @param {EnhancementSide} baseline
 * @param {EnhancementSide} proposed
 * @returns {EnhancementChecked | EnhancementNotChecked} `checked: false`, with
 *   the reason, when no rule can be checked
 */
export function checkEnhancement(kind, baseline, proposed) {
  const kindRules = RULES_BY_KIND[kind]
  if (!kindRules) {
    return notChecked(ENHANCEMENT_NOT_CHECKED_REASON.unrecognisedKind)
  }
  const resolvedBaseline = resolveSide(kindRules.categories, baseline)
  if (!resolvedBaseline) {
    return notChecked(ENHANCEMENT_NOT_CHECKED_REASON.unrecognisedBaseline)
  }
  const resolvedProposed = resolveSide(kindRules.categories, proposed)
  if (!resolvedProposed) {
    return notChecked(ENHANCEMENT_NOT_CHECKED_REASON.unrecognisedProposed)
  }
  const match = kindRules.rules.find((rule) => rule.appliesTo(resolvedBaseline))
  if (!match) {
    return notChecked(ENHANCEMENT_NOT_CHECKED_REASON.noRule)
  }
  const allowedByRule = match.allows(resolvedProposed, resolvedBaseline)
  const timeToTarget =
    kindRules.timeToTarget(resolvedProposed, resolvedBaseline) ?? null
  return {
    checked: true,
    rule: match.rule,
    valid: allowedByRule && isPossible(timeToTarget),
    allowedByRule,
    timeToTarget,
    baselineDistinctiveness: resolvedBaseline.distinctiveness,
    proposedDistinctiveness: resolvedProposed.distinctiveness
  }
}
