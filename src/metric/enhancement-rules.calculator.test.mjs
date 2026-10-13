import { describe, expect, it } from 'vitest'

import { ENHANCEMENT_KIND, checkEnhancement } from './enhancement-rules.mjs'
import { calculateEnhancedHedgerowPostIntervention } from './hedgerow-post-intervention.mjs'
import { calculateEnhancedAreaHabitatPostIntervention } from './post-intervention.mjs'
import {
  CONDITION_SCORES,
  HEDGEROW_CONDITION_SCORES,
  WATERCOURSE_CONDITION_SCORES
} from './reference-constants.mjs'
import { calculateEnhancedWatercoursePostIntervention } from './watercourse-post-intervention.mjs'

/**
 * Every enhancement the rules call valid must be one the calculator can
 * price: the rules' time-to-target check reads the tables the calculator
 * reads, and this keeps the two in step.
 */

const SIZE = 1
const LENGTH_KM = 0.1
const NO_ENCROACHMENT = {
  watercourseEncroachment: 'No Encroachment',
  riparianEncroachment: 'No Encroachment/No Encroachment'
}

/**
 * @param {Record<string, Record<string, unknown>>} conditionScores
 * @returns {Array<{ habitat: string, condition: string }>} every habitat in
 *   every condition the metric scores it in
 */
function sidesOf(conditionScores) {
  return Object.entries(conditionScores).flatMap(([habitat, scores]) =>
    Object.entries(scores)
      .filter(([, score]) => typeof score === 'number')
      .map(([condition]) => ({ habitat, condition }))
  )
}

const CALCULATORS = [
  {
    kind: ENHANCEMENT_KIND.area,
    sides: sidesOf(CONDITION_SCORES),
    calculate: (baseline, proposed) =>
      calculateEnhancedAreaHabitatPostIntervention(
        SIZE,
        baseline.habitat,
        proposed.habitat,
        baseline.condition,
        proposed.condition,
        0,
        0
      )
  },
  {
    kind: ENHANCEMENT_KIND.hedgerow,
    sides: sidesOf(HEDGEROW_CONDITION_SCORES),
    calculate: (baseline, proposed) =>
      calculateEnhancedHedgerowPostIntervention(
        LENGTH_KM,
        LENGTH_KM,
        baseline.habitat,
        proposed.habitat,
        baseline.condition,
        proposed.condition
      )
  },
  {
    kind: ENHANCEMENT_KIND.watercourse,
    sides: sidesOf(WATERCOURSE_CONDITION_SCORES),
    calculate: (baseline, proposed) =>
      calculateEnhancedWatercoursePostIntervention(
        LENGTH_KM,
        LENGTH_KM,
        baseline.habitat,
        proposed.habitat,
        baseline.condition,
        proposed.condition,
        NO_ENCROACHMENT
      )
  }
]

/**
 * @returns {string | null} why the calculator could not price it, or null
 */
function calculationError(calculate, baseline, proposed) {
  try {
    calculate(baseline, proposed)
    return null
  } catch (error) {
    return error.message
  }
}

describe('checkEnhancement against the calculator', () => {
  it.each(CALCULATORS)(
    'the calculator prices every valid $kind enhancement',
    ({ kind, sides, calculate }) => {
      const unpriced = []
      let valid = 0
      for (const baseline of sides) {
        for (const proposed of sides) {
          if (checkEnhancement(kind, baseline, proposed).valid) {
            valid++
            const error = calculationError(calculate, baseline, proposed)
            if (error) {
              unpriced.push(
                `${baseline.habitat} (${baseline.condition}) → ${proposed.habitat} (${proposed.condition}): ${error}`
              )
            }
          }
        }
      }
      expect(valid).toBeGreaterThan(0)
      expect(unpriced).toEqual([])
    }
  )
})
