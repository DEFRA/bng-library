/**
 * What the statutory metric accepts for a feature, read from its own
 * reference tables, so a random draw only ever produces valid data.
 *
 * A table entry of "Not Possible" is exactly what the metric shows as an
 * error when a workbook asks for it: a condition a habitat cannot have, a
 * condition it cannot be created in, or an enhancement it cannot make. Each
 * function here returns the candidates to pick from; the generator does the
 * picking, so seeded draws stay reproducible. A feature with no candidates
 * must not take that retention: `canCreate` / `canEnhance` say which.
 *
 * Invalid data is only ever pinned deliberately, by an `invalid-` scenario.
 */

import {
  CONDITION_SCORES,
  HEDGEROW_CONDITION_SCORES,
  HEDGEROW_TIME_TO_TARGET_CREATION,
  HEDGEROW_TIME_TO_TARGET_ENHANCEMENT,
  TIME_TO_TARGET_CREATION,
  TIME_TO_TARGET_ENHANCEMENT,
  WATERCOURSE_CONDITION_SCORES,
  WATERCOURSE_ENCROACHMENT_MULTIPLIER,
  WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER,
  WATERCOURSE_TIME_TO_TARGET_CREATION,
  WATERCOURSE_TIME_TO_TARGET_ENHANCEMENT
} from '../metric/reference-constants.mjs'
import { CULVERT_TYPE } from '../data/watercourse-encroachment.mjs'

/** Feature kinds, each with its three tables. Trees use the area tables. */
export const AREA = 'area'
export const HEDGEROW = 'hedgerow'
export const WATERCOURSE = 'watercourse'

const TABLES = {
  [AREA]: {
    scores: CONDITION_SCORES,
    creation: TIME_TO_TARGET_CREATION,
    enhancement: TIME_TO_TARGET_ENHANCEMENT
  },
  [HEDGEROW]: {
    scores: HEDGEROW_CONDITION_SCORES,
    creation: HEDGEROW_TIME_TO_TARGET_CREATION,
    enhancement: HEDGEROW_TIME_TO_TARGET_ENHANCEMENT
  },
  [WATERCOURSE]: {
    scores: WATERCOURSE_CONDITION_SCORES,
    creation: WATERCOURSE_TIME_TO_TARGET_CREATION,
    enhancement: WATERCOURSE_TIME_TO_TARGET_ENHANCEMENT
  }
}

const isPossible = (value) =>
  value !== undefined &&
  value !== null &&
  String(value).toLowerCase() !== 'not possible'

function score(kind, type, condition) {
  const value = TABLES[kind].scores[type]?.[condition]
  return typeof value === 'number' ? value : null
}

// Where the metric's drop-down list is narrower than its score table. A
// non-native hedgerow is scored in all three conditions, but the baseline
// sheet only offers Poor, so any other value is rejected as input.
const BASELINE_LIST_LIMITS = {
  [HEDGEROW]: { 'Non-native and ornamental hedgerow': ['Poor'] }
}

/** The conditions a feature of this type can be recorded in. */
export function baselineConditions(kind, type) {
  const limit = BASELINE_LIST_LIMITS[kind]?.[type]
  return Object.entries(TABLES[kind].scores[type] ?? {})
    .filter(([, value]) => typeof value === 'number')
    .map(([condition]) => condition)
    .filter((condition) => !limit || limit.includes(condition))
}

/** The conditions a feature of this type can be created in. */
export function creationConditions(kind, type) {
  return Object.entries(TABLES[kind].creation[type] ?? {})
    .filter(([, years]) => isPossible(years))
    .map(([condition]) => condition)
    .filter((condition) => score(kind, type, condition) !== null)
}

/**
 * Every [from, to] condition pair an enhancement of this type can make
 * without changing type: `to` must score higher than `from` (the metric
 * rejects a reduction, and an "enhancement" that changes nothing) and be
 * reachable from it.
 */
export function enhancementPairs(kind, type) {
  // The watercourse enhancement sheet does not offer a culvert at all.
  if (kind === WATERCOURSE && type === CULVERT_TYPE) {
    return []
  }
  const table = TABLES[kind].enhancement[type] ?? {}
  return baselineConditions(kind, type).flatMap((from) =>
    Object.entries(table[from] ?? {})
      .filter(
        ([to, years]) =>
          isPossible(years) &&
          score(kind, type, to) !== null &&
          score(kind, type, to) > score(kind, type, from)
      )
      .map(([to]) => [from, to])
  )
}

export const canCreate = (kind, type) =>
  creationConditions(kind, type).length > 0

export const canEnhance = (kind, type) =>
  enhancementPairs(kind, type).length > 0

/**
 * The encroachment options no worse than the baseline's: an enhancement
 * that increases encroachment is one the metric flags. A higher multiplier
 * is less encroachment.
 *
 * @param {'water' | 'riparian'} side
 */
export function encroachmentNoWorseThan(side, options, baseline) {
  const table =
    side === 'water'
      ? WATERCOURSE_ENCROACHMENT_MULTIPLIER
      : WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER
  const floor = table[baseline]
  if (floor === undefined) {
    return options
  }
  return options.filter((option) => (table[option] ?? -Infinity) >= floor)
}
