import { BaselineLookupError } from './errors.mjs'
import {
  getHedgerowCreationDifficultyLabel,
  getHedgerowCreationDifficultyMultiplier,
  getHedgerowCreationTimeMultiplier,
  getHedgerowCreationTimeToTargetValue,
  getHedgerowEnhancementDifficultyLabel,
  getHedgerowEnhancementDifficultyMultiplier,
  getHedgerowEnhancementTimeMultiplier,
  getHedgerowEnhancementTimeToTargetValue
} from './linear-hedgerow-multipliers.mjs'
import {
  HEDGEROW_CONFIG,
  NOT_POSSIBLE,
  resolveLinearDistinctivenessEnhancementMetrics
} from './linear-multiplier-shared.mjs'
import { isDistinctivenessEnhancement } from './linear-resolvers.mjs'
import {
  HEDGEROW_CONDITION_SCORES,
  HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  HEDGEROW_DISTINCTIVENESS_SCORES,
  HEDGEROW_TIME_TO_TARGET_DISTINCTIVENESS_ENHANCEMENT
} from './reference-constants.mjs'
import {
  calculateCreatedLinearPostIntervention,
  calculateEnhancedLinearPostIntervention,
  calculateRetainedLinearPostIntervention
} from './linear-post-intervention.mjs'

const HEDGEROW_RESOLVER_LABEL = 'hedgerow'
const STATUTORY_ADVANCE_YEARS = 0
const STATUTORY_DELAY_YEARS = 0

/**
 * G-6 "Enhancement Through Distinctiveness" is a baseline-type by proposed-type
 * matrix. The proposed condition is not part of the lookup. Cells marked
 * Error in the workbook are stored as Not Possible and fail the lookup.
 * @param {string} baselineType
 * @param {string} postType
 * @returns {number}
 */
function lookupHedgerowDistinctivenessEnhancementYears(baselineType, postType) {
  const value =
    HEDGEROW_TIME_TO_TARGET_DISTINCTIVENESS_ENHANCEMENT[baselineType]?.[
      postType
    ]
  if (value === undefined || value === null) {
    throw new BaselineLookupError(
      `Time to target not found for hedgerow distinctiveness enhancement: ${baselineType} -> ${postType}`
    )
  }
  if (value === NOT_POSSIBLE) {
    throw new BaselineLookupError(
      `Time to target '${NOT_POSSIBLE}' for hedgerow distinctiveness enhancement: ${baselineType} -> ${postType}`
    )
  }
  return value
}

/**
 * Time and difficulty when the proposed distinctiveness score is higher than
 * the baseline. B-3 supplies the G-6 type-by-type cell as the standard
 * time-to-target. Advance, delay, and difficulty are applied by the shared
 * linear helper.
 * @param {{ baselineType: string, postType: string, advanceYears: number, delayYears: number }} ctx
 * @returns {{ timeMultiplier: number, difficultyMultiplier: number, standardTimeToTargetCondition: string, difficulty: string }}
 */
function resolveHedgerowDistinctivenessEnhancementMetrics({
  baselineType,
  postType,
  advanceYears,
  delayYears
}) {
  const referenceYears = lookupHedgerowDistinctivenessEnhancementYears(
    baselineType,
    postType
  )
  return resolveLinearDistinctivenessEnhancementMetrics(
    HEDGEROW_CONFIG,
    postType,
    referenceYears,
    advanceYears,
    delayYears
  )
}

function resolveCreationMetrics({
  postType,
  postCondition,
  advanceYears,
  delayYears
}) {
  return {
    timeMultiplier: getHedgerowCreationTimeMultiplier(
      postType,
      postCondition,
      advanceYears,
      delayYears
    ),
    difficultyMultiplier: getHedgerowCreationDifficultyMultiplier(
      postType,
      postCondition,
      advanceYears,
      delayYears
    ),
    standardTimeToTargetCondition: getHedgerowCreationTimeToTargetValue(
      postType,
      postCondition,
      STATUTORY_ADVANCE_YEARS,
      STATUTORY_DELAY_YEARS
    ),
    difficulty: getHedgerowCreationDifficultyLabel(
      postType,
      postCondition,
      advanceYears,
      delayYears
    )
  }
}

function resolveEnhancementMetrics({
  postType,
  timeStartCondition,
  postCondition,
  advanceYears,
  delayYears
}) {
  return {
    timeMultiplier: getHedgerowEnhancementTimeMultiplier(
      postType,
      timeStartCondition,
      postCondition,
      advanceYears,
      delayYears
    ),
    difficultyMultiplier: getHedgerowEnhancementDifficultyMultiplier(
      postType,
      timeStartCondition,
      postCondition,
      advanceYears,
      delayYears
    ),
    standardTimeToTargetCondition: getHedgerowEnhancementTimeToTargetValue(
      postType,
      timeStartCondition,
      postCondition,
      STATUTORY_ADVANCE_YEARS,
      STATUTORY_DELAY_YEARS
    ),
    difficulty: getHedgerowEnhancementDifficultyLabel(
      postType,
      timeStartCondition,
      postCondition,
      advanceYears,
      delayYears
    )
  }
}

/**
 * Resolve time and difficulty multipliers for an enhanced hedgerow.
 * @param {{ baselineDistinctivenessScore: number, postInterventionDistinctivenessScore: number, baselineType: string, postType: string, baselineCondition: string, postCondition: string, advanceYears: number, delayYears: number }} enhancementContext
 * @returns {{ timeMultiplier: number, difficultyMultiplier: number, standardTimeToTargetCondition: string, difficulty: string }}
 */
function resolveHedgerowEnhancementMultipliers({
  baselineDistinctivenessScore,
  postInterventionDistinctivenessScore,
  baselineType,
  postType,
  baselineCondition,
  postCondition,
  advanceYears,
  delayYears
}) {
  if (
    isDistinctivenessEnhancement(
      baselineDistinctivenessScore,
      postInterventionDistinctivenessScore
    )
  ) {
    return resolveHedgerowDistinctivenessEnhancementMetrics({
      baselineType,
      postType,
      advanceYears,
      delayYears
    })
  }

  return resolveEnhancementMetrics({
    postType,
    timeStartCondition: baselineCondition,
    postCondition,
    advanceYears,
    delayYears
  })
}
/** @type {import('./linear-post-intervention.mjs').LinearPostInterventionConfig} */
const HEDGEROW_PI_CONFIG = {
  label: 'Hedgerow',
  resolverLabel: HEDGEROW_RESOLVER_LABEL,
  distinctivenessCategories: HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  distinctivenessScores: HEDGEROW_DISTINCTIVENESS_SCORES,
  conditionScores: HEDGEROW_CONDITION_SCORES,
  getCreationTimeMultiplier: getHedgerowCreationTimeMultiplier,
  getCreationDifficultyMultiplier: getHedgerowCreationDifficultyMultiplier,
  resolveEnhancementMultipliers: resolveHedgerowEnhancementMultipliers
}

/**
 * Get hedgerow retained hedgerow units for a given length, hedge type,
 * and condition.
 *
 * @param {number} lengthKm - Length in kilometres
 * @param {string} hedgeType - Hedgerow type (e.g. "Species-rich native hedgerow")
 * @param {string} condition - Condition band (e.g. "Good", "Moderate")
 * @returns {{ units: number, distinctiveness: string, distinctivenessScore: number, conditionScore: number, strategicSignificanceScore: number }}
 * @throws {TypeError} If length is invalid
 * @throws {BaselineLookupError} If hedgeType or condition is not found in the reference tables
 * @example
 * const result = calculateHedgerowBaseline(0.5, 'Native hedgerow', 'Good')
 * // { units: 3, distinctiveness: 'Low', distinctivenessScore: 2, conditionScore: 3, strategicSignificanceScore: 1 }
 */
export function calculateRetainedHedgerowPostIntervention(
  lengthKm,
  hedgeType,
  condition
) {
  return calculateRetainedLinearPostIntervention(HEDGEROW_PI_CONFIG, {
    lengthKm,
    type: hedgeType,
    condition
  })
}

/**
 * Get hedgerow creation units for a given length, hedge type, condition,
 * and advance/delay years.
 *
 * @param {number} lengthKm - Length in kilometres
 * @param {string} hedgeType - Hedgerow type (e.g. "Native hedgerow")
 * @param {string} condition - Condition band (e.g. "Good", "Moderate")
 * @param {number} advanceYears - Years habitat is advanced beyond 30 years
 * @param {number} delayYears - Years delivery is delayed
 * @returns {{ units: number, distinctiveness: string, distinctivenessScore: number, conditionScore: number, strategicSignificanceScore: number, timeMultiplier: number, difficultyMultiplier: number }}
 * @throws {TypeError} If length is invalid
 * @throws {BaselineLookupError} If hedgeType or condition is not found in the reference tables
 */
export function calculateCreatedHedgerowPostIntervention(
  lengthKm,
  hedgeType,
  condition,
  advanceYears,
  delayYears
) {
  const result = calculateCreatedLinearPostIntervention(HEDGEROW_PI_CONFIG, {
    lengthKm,
    type: hedgeType,
    condition,
    advanceYears,
    delayYears
  })
  return {
    ...result,
    ...resolveCreationMetrics({
      postType: hedgeType,
      postCondition: condition,
      advanceYears,
      delayYears
    })
  }
}

/**
 * Get enhanced hedgerow post-intervention units for baseline and
 * post-intervention lengths, hedge types and conditions, and advance/delay years.
 *
 * @param {number} baselineLengthKm - Baseline length in kilometres
 * @param {number} postInterventionLengthKm - Post-intervention length in kilometres
 * @param {string} baselineHedgeType - Baseline hedge type
 * @param {string} postInterventionHedgeType - Post-intervention hedge type
 * @param {string} baselineCondition - Baseline condition band
 * @param {string} postInterventionCondition - Post-intervention condition band
 * @param {{ advanceYears?: number, delayYears?: number }} [options] - Advance and delay years
 * @returns {{ units: number, postInterventionDistinctiveness: string, postInterventionDistinctivenessScore: number, postInterventionConditionScore: number, strategicSignificanceScore: number, timeMultiplier: number, difficultyMultiplier: number }}
 * @throws {TypeError} If either length is invalid
 * @throws {BaselineLookupError} If hedgeType or condition is not found in the reference tables
 */
export function calculateEnhancedHedgerowPostIntervention(
  baselineLengthKm,
  postInterventionLengthKm,
  baselineHedgeType,
  postInterventionHedgeType,
  baselineCondition,
  postInterventionCondition,
  { advanceYears = 0, delayYears = 0 } = {}
) {
  return calculateEnhancedLinearPostIntervention(HEDGEROW_PI_CONFIG, {
    baselineLengthKm,
    postInterventionLengthKm,
    baselineType: baselineHedgeType,
    postType: postInterventionHedgeType,
    baselineCondition,
    postCondition: postInterventionCondition,
    advanceYears,
    delayYears
  })
}
