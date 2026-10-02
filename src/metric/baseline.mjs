import { validateSize } from './validate.mjs'
import {
  resolveDistinctiveness,
  getConditionMultiplier
} from './multipliers.mjs'
import { roundToSigFigs } from './utils.mjs'

/**
 * Baseline strategic significance is fixed at Low (×1). The metric itself multiplies
 * baseline units by it too; the fixed Low comes from Defra's LNRS guidance, not the
 * metric (see LOW_STRATEGIC_SIGNIFICANCE in strategic-significance.mjs).
 */
const BASELINE_STRATEGIC_SIGNIFICANCE_MULTIPLIER = 1

/**
 * Get area-habitat baseline biodiversity units for a given size, habitat type, and condition.
 * @param {number} size - The size of the habitat in hectares
 * @param {string} habitat - The habitat name (e.g., "Grassland - Modified grassland")
 * @param {string} condition - The condition name (e.g., "Moderate")
 * @returns {object} units, distinctiveness band label, distinctivenessScore, conditionScore, strategicSignificanceScore
 * @throws {Error} If habitat/condition not found or not a valid habitat/condition
 * @example
 * const baseline = calculateAreaHabitatBaseline(100, 'Grassland - Modified grassland', 'Moderate')
 * console.log(baseline)
 * // { units: 400, distinctiveness: 'Low', distinctivenessScore: 2, conditionScore: 2, strategicSignificanceScore: 1 }
 */
export function calculateAreaHabitatBaseline(size, habitat, condition) {
  validateSize(size)

  const { distinctiveness, distinctivenessScore } =
    resolveDistinctiveness(habitat)
  const conditionScore = getConditionMultiplier(habitat, condition)
  const strategicSignificanceScore = BASELINE_STRATEGIC_SIGNIFICANCE_MULTIPLIER

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
