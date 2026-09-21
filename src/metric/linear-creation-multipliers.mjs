import { BaselineLookupError } from './errors.mjs'
import { CREATION } from './multipliers.mjs'
import { TIME_TO_TARGET_MULTIPLIER } from './reference-constants.mjs'
import {
  applyDelayAdvanceAndClamp,
  normaliseReferenceYears,
  toTimeToTargetBucketKey
} from './linear-time-target-utils.mjs'
import {
  validateAdvanceAndDelayYears,
  validateHabitatChange
} from './validate.mjs'
import {
  LOW_DIFFICULTY,
  lookupLinearDifficultyLabel,
  multiplierForDifficultyLabel,
  NOT_POSSIBLE,
  validateLinearCondition,
  validateLinearType
} from './linear-multiplier-shared.mjs'

/**
 * @param {object} cfg
 * @param {string} linearType
 * @param {string} endCondition
 * @returns {number | string}
 */
function lookupLinearCreationTimeToTarget(cfg, linearType, endCondition) {
  const value = cfg.timeToTargetCreation[linearType]?.[endCondition]
  if (value === undefined || value === null) {
    throw new BaselineLookupError(
      `Time to target not found for ${cfg.label}: ${linearType}, endCondition: ${endCondition}`
    )
  }
  if (value === NOT_POSSIBLE) {
    throw new BaselineLookupError(
      `Time to target '${NOT_POSSIBLE}' for ${cfg.label}: ${linearType}, endCondition: ${endCondition}`
    )
  }
  return value
}

/**
 * @param {object} cfg
 * @param {string} linearType
 * @param {string} endCondition
 * @param {number} advanceYears
 * @param {number} delayYears
 * @returns {string}
 */
export function getLinearCreationTimeToTargetValue(
  cfg,
  linearType,
  endCondition,
  advanceYears,
  delayYears
) {
  validateLinearType(linearType, cfg.distinctivenessCategories, cfg.label)
  validateHabitatChange(CREATION)
  validateLinearCondition(
    linearType,
    endCondition,
    cfg.conditionScores,
    cfg.label
  )
  const { validatedAdvanceYears, validatedDelayYears } =
    validateAdvanceAndDelayYears(advanceYears, delayYears)

  const referenceYears = normaliseReferenceYears(
    lookupLinearCreationTimeToTarget(cfg, linearType, endCondition)
  )
  const computedYears = applyDelayAdvanceAndClamp(
    referenceYears,
    validatedAdvanceYears,
    validatedDelayYears
  )
  return toTimeToTargetBucketKey(computedYears)
}

/**
 * @param {object} cfg
 * @param {string} linearType
 * @param {string} condition
 * @param {number} advanceYears
 * @param {number} delayYears
 * @returns {number}
 */
export function getLinearCreationTimeMultiplier(
  cfg,
  linearType,
  condition,
  advanceYears,
  delayYears
) {
  const timeToTargetKey = getLinearCreationTimeToTargetValue(
    cfg,
    linearType,
    condition,
    advanceYears,
    delayYears
  )
  const timeMultiplier = TIME_TO_TARGET_MULTIPLIER[timeToTargetKey]
  if (timeMultiplier === undefined || timeMultiplier === null) {
    throw new Error(
      `Time multiplier not found for ${cfg.label}: ${linearType}, condition: ${condition}`
    )
  }
  if (timeMultiplier === NOT_POSSIBLE) {
    throw new Error(
      `Time multiplier for ${cfg.label} '${linearType}' is not possible`
    )
  }
  return timeMultiplier
}

/**
 * Standard (unadjusted) statutory time-to-target years for a created linear
 * feature reaching `condition` — i.e. the value before any advance/delay is
 * applied. This is the `L` column in the statutory workbook's creation tabs.
 *
 * @param {object} cfg
 * @param {string} linearType
 * @param {string} condition
 * @returns {number}
 */
function standardCreationTimeToTargetYears(cfg, linearType, condition) {
  return normaliseReferenceYears(
    lookupLinearCreationTimeToTarget(cfg, linearType, condition)
  )
}

/**
 * Resolve the difficulty band label used for a Creation-path linear feature.
 * Shared by the label and multiplier accessors so display and unit calculation
 * can never disagree.
 *
 * Statutory linear rule (workbook tabs C-2 watercourse and B-2 hedgerow):
 * created difficulty drops to the fixed "Low" band only when the habitat is
 * created far enough in advance to reach its target condition before the loss
 * occurs — i.e. when advance covers the full standard time to target
 * (`advance >= L`, "only applicable if all habitat created before losses").
 * Otherwise the habitat's Creation band applies. Unlike area habitats (tab
 * A-2), linear features have NO Creation->Enhancement reclassification for
 * advance that merely reaches Poor condition; the "time to reach poor" figure
 * is only an upper bound on the advance a user may enter, not a difficulty
 * trigger.
 *
 * @param {object} cfg
 * @param {string} linearType
 * @param {string} condition
 * @param {number} advanceYears
 * @param {number} delayYears
 * @returns {string}
 */
export function getLinearCreationDifficultyLabel(
  cfg,
  linearType,
  condition,
  advanceYears,
  delayYears
) {
  validateLinearType(linearType, cfg.distinctivenessCategories, cfg.label)
  validateHabitatChange(CREATION)
  validateLinearCondition(linearType, condition, cfg.conditionScores, cfg.label)
  const { validatedAdvanceYears } = validateAdvanceAndDelayYears(
    advanceYears,
    delayYears
  )

  if (
    validatedAdvanceYears >=
    standardCreationTimeToTargetYears(cfg, linearType, condition)
  ) {
    return LOW_DIFFICULTY
  }
  return lookupLinearDifficultyLabel(cfg, linearType, CREATION)
}

/**
 * @param {object} cfg
 * @param {string} linearType
 * @param {string} condition
 * @param {number} advanceYears
 * @param {number} delayYears
 * @returns {number}
 */
export function getLinearCreationDifficultyMultiplier(
  cfg,
  linearType,
  condition,
  advanceYears,
  delayYears
) {
  const difficultyLabel = getLinearCreationDifficultyLabel(
    cfg,
    linearType,
    condition,
    advanceYears,
    delayYears
  )
  return multiplierForDifficultyLabel(cfg, linearType, difficultyLabel)
}
