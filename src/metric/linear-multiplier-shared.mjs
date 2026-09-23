import { BaselineLookupError } from './errors.mjs'
import {
  applyDelayAdvanceAndClamp,
  toTimeToTargetBucketKey
} from './linear-time-target-utils.mjs'
import { ENHANCEMENT } from './multipliers.mjs'
import {
  HEDGEROW_CONDITION_SCORES,
  HEDGEROW_DIFFICULTY,
  HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  HEDGEROW_TIME_TO_TARGET_CREATION,
  HEDGEROW_TIME_TO_TARGET_ENHANCEMENT,
  WATERCOURSE_CONDITION_SCORES,
  WATERCOURSE_DIFFICULTY,
  WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
  WATERCOURSE_TIME_TO_TARGET_CREATION,
  WATERCOURSE_TIME_TO_TARGET_ENHANCEMENT,
  DIFFICULTY_MULTIPLIER,
  TIME_TO_TARGET_MULTIPLIER
} from './reference-constants.mjs'
import { validateAdvanceAndDelayYears } from './validate.mjs'

export const NOT_POSSIBLE = 'Not Possible'
export const LOW_DIFFICULTY = 'Low'

// ---------------------------------------------------------------------------
// Per-type config objects — injected into generic functions
// ---------------------------------------------------------------------------

export const HEDGEROW_CONFIG = {
  label: 'hedgerow',
  distinctivenessCategories: HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  conditionScores: HEDGEROW_CONDITION_SCORES,
  difficulty: HEDGEROW_DIFFICULTY,
  timeToTargetCreation: HEDGEROW_TIME_TO_TARGET_CREATION,
  timeToTargetEnhancement: HEDGEROW_TIME_TO_TARGET_ENHANCEMENT
}

export const WATERCOURSE_CONFIG = {
  label: 'watercourse',
  distinctivenessCategories: WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
  conditionScores: WATERCOURSE_CONDITION_SCORES,
  difficulty: WATERCOURSE_DIFFICULTY,
  timeToTargetCreation: WATERCOURSE_TIME_TO_TARGET_CREATION,
  timeToTargetEnhancement: WATERCOURSE_TIME_TO_TARGET_ENHANCEMENT
}

// ---------------------------------------------------------------------------
// Shared validation helpers
// ---------------------------------------------------------------------------

/**
 * @param {string} linearType
 * @param {Record<string, string>} distinctivenessCategories
 * @param {string} label
 */
export function validateLinearType(
  linearType,
  distinctivenessCategories,
  label
) {
  if (linearType === null || linearType === undefined || linearType === '') {
    throw new BaselineLookupError(`${label} type must be a non-empty string`)
  }
  if (typeof linearType !== 'string') {
    throw new TypeError(
      `${label} type must be a string, got ${typeof linearType}`
    )
  }
  if (!Object.hasOwn(distinctivenessCategories, linearType)) {
    throw new BaselineLookupError(
      `${label} '${linearType}' is not a valid ${label} type`
    )
  }
}

/**
 * @param {string} linearType
 * @param {string} condition
 * @param {Record<string, Record<string, number | string>>} conditionScores
 * @param {string} label
 */
export function validateLinearCondition(
  linearType,
  condition,
  conditionScores,
  label
) {
  if (condition === null || condition === undefined || condition === '') {
    throw new BaselineLookupError(
      `${label} condition must be a non-empty string`
    )
  }
  if (typeof condition !== 'string') {
    throw new TypeError(
      `${label} condition must be a string, got ${typeof condition}`
    )
  }
  const row = conditionScores[linearType]
  if (!row || typeof row !== 'object') {
    throw new BaselineLookupError(
      `Condition scores not found for ${label} type: ${linearType}`
    )
  }
  if (!Object.hasOwn(row, condition)) {
    throw new BaselineLookupError(
      `Condition '${condition}' is not a valid condition for ${label}: ${linearType}`
    )
  }
}

// ---------------------------------------------------------------------------
// Shared difficulty helpers
// ---------------------------------------------------------------------------

/**
 * Difficulty band label from the type's difficulty reference data (e.g.
 * watercourse-difficulty.json / hedgerow-difficulty.json).
 *
 * @param {object} cfg
 * @param {string} linearType
 * @param {string} difficultyChangeType
 * @returns {string}
 */
export function lookupLinearDifficultyLabel(
  cfg,
  linearType,
  difficultyChangeType
) {
  const difficultyRow = cfg.difficulty[linearType]
  if (!difficultyRow || typeof difficultyRow !== 'object') {
    throw new Error(
      `No difficulty reference data for ${cfg.label}: ${linearType}`
    )
  }
  const difficultyDesc = difficultyRow[difficultyChangeType]
  if (!difficultyDesc) {
    throw new Error(
      `Difficulty not found for ${cfg.label}: ${linearType}, change type: ${difficultyChangeType}`
    )
  }
  return difficultyDesc
}

/**
 * Shared by the Creation and Enhancement difficulty-multiplier accessors so
 * the "label not found" error handling only exists in one place.
 *
 * @param {object} cfg
 * @param {string} linearType
 * @param {string} difficultyLabel
 * @returns {number}
 */
export function multiplierForDifficultyLabel(cfg, linearType, difficultyLabel) {
  const multiplier = DIFFICULTY_MULTIPLIER[difficultyLabel]
  if (multiplier == null || multiplier === NOT_POSSIBLE) {
    throw new Error(
      `Difficulty multiplier not found for ${cfg.label}: ${linearType}`
    )
  }
  return multiplier
}

/**
 * Time and difficulty once a distinctiveness-uplift standard year figure is
 * already known. The caller supplies that figure: a fixed cell for
 * watercourses, a type-by-type matrix cell for hedgerows. Advance and delay
 * adjust the time multiplier only. Difficulty is the proposed type's
 * Enhancement band, dropping to Low when advance covers the standard years.
 *
 * @param {object} cfg
 * @param {string} postType
 * @param {number} referenceYears
 * @param {number} advanceYears
 * @param {number} delayYears
 * @returns {{ timeMultiplier: number, difficultyMultiplier: number, standardTimeToTargetCondition: string, difficulty: string }}
 */
export function resolveLinearDistinctivenessEnhancementMetrics(
  cfg,
  postType,
  referenceYears,
  advanceYears,
  delayYears
) {
  const { validatedAdvanceYears, validatedDelayYears } =
    validateAdvanceAndDelayYears(advanceYears, delayYears)
  const computedYears = applyDelayAdvanceAndClamp(
    referenceYears,
    validatedAdvanceYears,
    validatedDelayYears
  )
  const timeToTargetKey = toTimeToTargetBucketKey(computedYears)
  const timeMultiplier = TIME_TO_TARGET_MULTIPLIER[timeToTargetKey]
  if (timeMultiplier === undefined || timeMultiplier === null) {
    throw new BaselineLookupError(
      `Time multiplier not found for ${cfg.label} distinctiveness enhancement (${timeToTargetKey} years)`
    )
  }
  if (timeMultiplier === NOT_POSSIBLE) {
    throw new BaselineLookupError(
      `Time multiplier for ${cfg.label} distinctiveness enhancement is not possible`
    )
  }

  const difficulty =
    validatedAdvanceYears >= referenceYears
      ? LOW_DIFFICULTY
      : lookupLinearDifficultyLabel(cfg, postType, ENHANCEMENT)
  return {
    timeMultiplier,
    difficultyMultiplier: multiplierForDifficultyLabel(
      cfg,
      postType,
      difficulty
    ),
    standardTimeToTargetCondition: toTimeToTargetBucketKey(referenceYears),
    difficulty
  }
}
