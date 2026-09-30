import { validateSize } from './validate.mjs'
import {
  resolveDistinctiveness,
  getConditionMultiplier,
  getTimeMultiplier,
  getTimeToTargetValue,
  getDifficultyMultiplier,
  getDifficultyLabel,
  CREATION,
  ENHANCEMENT
} from './multipliers.mjs'
import { CONDITION_SCORES } from './reference-constants.mjs'
import { roundToSigFigs } from './utils.mjs'
import {
  LOW_STRATEGIC_SIGNIFICANCE,
  resolveStrategicSignificance
} from './strategic-significance.mjs'

const STATUTORY_TIME_TO_TARGET_ADVANCE_YEARS = 0
const STATUTORY_TIME_TO_TARGET_DELAY_YEARS = 0

/**
 * Enhancement time/difficulty tables use the "Lower" start band when the
 * post-intervention habitat has higher distinctiveness than the baseline habitat
 * (distinctiveness enhancement within the same broad habitat group).
 * @param {number} baselineDistinctivenessScore
 * @param {number} postInterventionDistinctivenessScore
 * @param {string} baselineCondition
 * @returns {string}
 */
function resolveEnhancementTimeStartCondition(
  baselineDistinctivenessScore,
  postInterventionDistinctivenessScore,
  baselineCondition
) {
  if (postInterventionDistinctivenessScore > baselineDistinctivenessScore) {
    return 'Lower'
  }
  return baselineCondition
}

/**
 * Resolve a condition band to a numeric score. Enhancement start bands such as
 * "Lower" and "CA N/A" exist in time-to-target tables but not condition scores.
 * @param {string} habitat
 * @param {string} condition
 * @returns {number}
 */
function resolveEnhancementConditionScore(habitat, condition) {
  const scoresRow = CONDITION_SCORES[habitat]
  if (scoresRow && Object.hasOwn(scoresRow, condition)) {
    return getConditionMultiplier(habitat, condition)
  }
  if (condition === 'Lower') {
    return getConditionMultiplier(habitat, 'Poor')
  }
  if (condition === 'CA N/A') {
    return getConditionMultiplier(habitat, 'Condition Assessment N/A')
  }
  return getConditionMultiplier(habitat, condition)
}

/**
 * @param {string} postInterventionHabitatType
 * @param {string} timeStartCondition
 * @param {string} postInterventionCondition
 * @param {number} advanceYears
 * @param {number} delayYears
 */
function resolveEnhancedAreaDerivedMetrics(
  postInterventionHabitatType,
  timeStartCondition,
  postInterventionCondition,
  advanceYears,
  delayYears
) {
  return {
    timeMultiplier: getTimeMultiplier(
      postInterventionHabitatType,
      ENHANCEMENT,
      timeStartCondition,
      postInterventionCondition,
      advanceYears,
      delayYears
    ),
    difficultyMultiplier: getDifficultyMultiplier(
      postInterventionHabitatType,
      ENHANCEMENT,
      timeStartCondition,
      postInterventionCondition,
      advanceYears,
      delayYears
    ),
    standardTimeToTargetCondition: getTimeToTargetValue(
      postInterventionHabitatType,
      ENHANCEMENT,
      timeStartCondition,
      postInterventionCondition,
      STATUTORY_TIME_TO_TARGET_ADVANCE_YEARS,
      STATUTORY_TIME_TO_TARGET_DELAY_YEARS
    ),
    difficulty: getDifficultyLabel(
      postInterventionHabitatType,
      ENHANCEMENT,
      timeStartCondition,
      postInterventionCondition,
      advanceYears,
      delayYears
    )
  }
}

/**
 * @param {number} size
 * @param {object} scores
 * @param {object} metrics
 * @param {number} strategicSignificanceScore
 * @returns {number}
 */
function computeEnhancedAreaUnits(
  size,
  scores,
  metrics,
  strategicSignificanceScore
) {
  const postInterventionValue =
    size *
    scores.postInterventionDistinctivenessScore *
    scores.postInterventionConditionScore
  const baselineValue =
    size * scores.baselineDistinctivenessScore * scores.baselineConditionScore
  const riskMultiplier = metrics.timeMultiplier * metrics.difficultyMultiplier
  const calc =
    ((postInterventionValue - baselineValue) * riskMultiplier + baselineValue) *
    strategicSignificanceScore
  return roundToSigFigs(calc)
}

/**
 * Get area-habitat post-intervention retained biodiversity units for a given size, habitat type, and condition.
 * @param {number} size - The size of the habitat in hectares
 * @param {string} habitat - The habitat name (e.g., "Grassland - Modified grassland")
 * @param {string} condition - The condition name (e.g., "Moderate")
 * @returns {object} units, distinctiveness band label, distinctivenessScore, conditionScore, strategicSignificanceScore
 * @throws {Error} If habitat/condition not found or not a valid habitat/condition
 * @example
 * const postInterventionRetained = calculateRetainedAreaHabitatPostIntervention(100, 'Grassland - Modified grassland', 'Moderate')
 * console.log(postInterventionRetained)
 * // Retained habitat - habitat has been retained in the area post-intervention
 * // { units: 400, distinctiveness: 'Low', distinctivenessScore: 2, conditionScore: 2, strategicSignificanceScore: 1 }
 */
export function calculateRetainedAreaHabitatPostIntervention(
  size,
  habitat,
  condition
) {
  validateSize(size)

  const { distinctiveness, distinctivenessScore } =
    resolveDistinctiveness(habitat)
  const conditionScore = getConditionMultiplier(habitat, condition)
  // Retained habitat carries its baseline strategic significance, which is always Low
  const { strategicSignificanceScore } = LOW_STRATEGIC_SIGNIFICANCE

  const units = roundToSigFigs(
    size * distinctivenessScore * conditionScore * strategicSignificanceScore
  )

  return {
    units,
    distinctiveness,
    distinctivenessScore,
    conditionScore,
    strategicSignificanceScore
  }
}

/**
 * @param {string} habitat
 * @param {string} condition
 * @param {number} advanceYears
 * @param {number} delayYears
 */
function resolveCreatedAreaDerivedMetrics(
  habitat,
  condition,
  advanceYears,
  delayYears
) {
  return {
    timeMultiplier: getTimeMultiplier(
      habitat,
      CREATION,
      null,
      condition,
      advanceYears,
      delayYears
    ),
    difficultyMultiplier: getDifficultyMultiplier(
      habitat,
      CREATION,
      null,
      condition,
      advanceYears,
      delayYears
    ),
    standardTimeToTargetCondition: getTimeToTargetValue(
      habitat,
      CREATION,
      null,
      condition,
      STATUTORY_TIME_TO_TARGET_ADVANCE_YEARS,
      STATUTORY_TIME_TO_TARGET_DELAY_YEARS
    ),
    difficulty: getDifficultyLabel(
      habitat,
      CREATION,
      null,
      condition,
      advanceYears,
      delayYears
    )
  }
}

/**
 * Get area-habitat post-intervention created biodiversity units.
 * @param {number} size - The size of the habitat in hectares
 * @param {string} habitat - The habitat name (e.g., "Grassland - Modified grassland")
 * @param {string} condition - The target condition (e.g., "Moderate")
 * @param {number} advanceYears - Years the habitat is created in advance
 * @param {number} delayYears - Years the start of creation is delayed
 * @param {string | null} [strategicSignificance] - Proposed Strategic Significance (e.g. "Formally identified in local strategy"); absent resolves to Low
 * @returns {object} units, distinctiveness, scores, strategicSignificanceCategory, strategicSignificanceScore, time and difficulty metrics
 * @throws {BaselineLookupError} If habitat, condition or strategic significance is not recognised
 */
export function calculateCreatedAreaHabitatPostIntervention(
  size,
  habitat,
  condition,
  advanceYears,
  delayYears,
  strategicSignificance = null
) {
  validateSize(size)

  const { distinctiveness, distinctivenessScore } =
    resolveDistinctiveness(habitat)
  const conditionScore = getConditionMultiplier(habitat, condition)
  const { strategicSignificanceCategory, strategicSignificanceScore } =
    resolveStrategicSignificance(strategicSignificance)
  const metrics = resolveCreatedAreaDerivedMetrics(
    habitat,
    condition,
    advanceYears,
    delayYears
  )

  // Create habitat - habitat has been created in the area post-intervention (e.g. due to development)
  const units = roundToSigFigs(
    size *
      distinctivenessScore *
      conditionScore *
      strategicSignificanceScore *
      metrics.timeMultiplier *
      metrics.difficultyMultiplier
  )

  return {
    units,
    distinctiveness,
    distinctivenessScore,
    conditionScore,
    strategicSignificanceCategory,
    strategicSignificanceScore,
    ...metrics
  }
}

/**
 * Get area-habitat post-intervention enhanced biodiversity units. The proposed strategic
 * significance multiplies the whole enhanced value, as in the metric's A-3 sheet.
 * @param {number} size - The size of the habitat in hectares
 * @param {string} baselineHabitatType
 * @param {string} postInterventionHabitatType
 * @param {string} baselineCondition
 * @param {string} postInterventionCondition
 * @param {number} advanceYears
 * @param {number} delayYears
 * @param {string | null} [strategicSignificance] - Proposed Strategic Significance; absent resolves to Low
 * @returns {object} units, post-intervention distinctiveness and scores, strategicSignificanceCategory, strategicSignificanceScore, time and difficulty metrics
 * @throws {BaselineLookupError} If a habitat, condition or strategic significance is not recognised
 */
export function calculateEnhancedAreaHabitatPostIntervention(
  size,
  baselineHabitatType,
  postInterventionHabitatType,
  baselineCondition,
  postInterventionCondition,
  advanceYears,
  delayYears,
  strategicSignificance = null
) {
  validateSize(size)

  const { distinctivenessScore: baselineDistinctivenessScore } =
    resolveDistinctiveness(baselineHabitatType)
  const {
    distinctiveness: postInterventionDistinctiveness,
    distinctivenessScore: postInterventionDistinctivenessScore
  } = resolveDistinctiveness(postInterventionHabitatType)

  const baselineConditionScore = resolveEnhancementConditionScore(
    baselineHabitatType,
    baselineCondition
  )
  const postInterventionConditionScore = resolveEnhancementConditionScore(
    postInterventionHabitatType,
    postInterventionCondition
  )
  const { strategicSignificanceCategory, strategicSignificanceScore } =
    resolveStrategicSignificance(strategicSignificance)
  const timeStartCondition = resolveEnhancementTimeStartCondition(
    baselineDistinctivenessScore,
    postInterventionDistinctivenessScore,
    baselineCondition
  )
  const metrics = resolveEnhancedAreaDerivedMetrics(
    postInterventionHabitatType,
    timeStartCondition,
    postInterventionCondition,
    advanceYears,
    delayYears
  )
  const units = computeEnhancedAreaUnits(
    size,
    {
      baselineDistinctivenessScore,
      postInterventionDistinctivenessScore,
      baselineConditionScore,
      postInterventionConditionScore
    },
    metrics,
    strategicSignificanceScore
  )

  return {
    units,
    postInterventionDistinctiveness,
    postInterventionDistinctivenessScore,
    postInterventionConditionScore,
    strategicSignificanceCategory,
    strategicSignificanceScore,
    ...metrics
  }
}
