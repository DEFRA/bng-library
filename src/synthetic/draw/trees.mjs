/**
 * Draw a synthetic site's individual trees: points inside the red line, each
 * with its size, setting, type, retention, conditions and years.
 */

import { pick, pickInteriorPoint } from '../../geometry.mjs'
import { RETENTION_CREATED } from '../../retention.mjs'
import {
  BASELINE_STRATEGIC_SIGNIFICANCE,
  LOCATIONS,
  PROPOSED_STRATEGIC_SIGNIFICANCE,
  SPATIAL_RISK_HABITAT,
  TREE_TYPE_STREET
} from '../synthetic-constants.mjs'
import { AREA } from '../valid-draws.mjs'
import {
  drawConditions,
  overrideOr,
  resolveAdvanceDelay,
  resolveProposed,
  syntheticRef
} from './rules.mjs'

const MAX_TREE_ADVANCE_YEARS = 3
const MAX_TREE_DELAY_YEARS = 2
const TREE_COUNT_DEFAULT = 1

export const TREE_SIZES = ['Small', 'Medium', 'Large', 'Very large']
// The two individual-tree habitat types: each tree is Urban or Rural.
const TREE_RURAL_URBAN = ['Urban', 'Rural']
const TREE_TYPES = [
  TREE_TYPE_STREET,
  'Park/garden tree',
  'Woodland tree',
  'Hedgerow tree'
]

// An individual tree's retention values that carry a real baseline, so the
// seeded non-created trees draw from these only.
const TREE_RETENTION_WITH_BASELINE = ['Retained', 'Enhanced', 'Lost']

// One tree is deterministically seeded Created, so any fixture large enough to
// reach it exercises the newly planted branch without relying on the
// retention draw — the individual-tree mirror of the seeded Created river. It
// sits just past the size-band seeds (indices 0..TREE_SIZES.length-1), which
// keep a real baseline so every size band is still covered.
export const CREATED_TREE_INDEX = TREE_SIZES.length

function pickTreeRetention(index) {
  if (index === CREATED_TREE_INDEX) {
    return RETENTION_CREATED
  }
  return pick(TREE_RETENTION_WITH_BASELINE)
}

/**
 * One tree's values. Each draw is made in the same order whatever the
 * override, so a pinned value never changes what the rest of the site draws.
 */
function drawTree(point, i, override) {
  // Deterministically seed one tree of each size band before falling back to
  // random sizes, so a fixture covers all bands as long as it has at least
  // TREE_SIZES.length trees.
  const drawnSize = i < TREE_SIZES.length ? TREE_SIZES[i] : pick(TREE_SIZES)
  const size = overrideOr(override, 'treeSize', drawnSize)
  // Alternate urban/rural so both habitat types appear once there are at
  // least two trees.
  const ruralOrUrban = overrideOr(
    override,
    'ruralOrUrban',
    TREE_RURAL_URBAN[i % TREE_RURAL_URBAN.length]
  )
  const type = overrideOr(override, 'treeType', pick(TREE_TYPES))
  const retention = override?.retention ?? pickTreeRetention(i)
  const treeHabitat = `Individual trees - ${ruralOrUrban} tree`
  const conditions = drawConditions(
    AREA,
    treeHabitat,
    treeHabitat,
    retention,
    override
  )
  // Only a newly planted (Created) tree carries creation-in-advance / delay
  // years, and at most one of the pair.
  const [advanceYears, delayYears] = resolveAdvanceDelay(
    override,
    retention,
    MAX_TREE_ADVANCE_YEARS,
    MAX_TREE_DELAY_YEARS
  )
  const proposedSize = retention === 'Lost' ? pick(TREE_SIZES) : size
  const drawnSignificance = pick(PROPOSED_STRATEGIC_SIGNIFICANCE)
  const proposedType = retention === 'Lost' ? pick(TREE_TYPES) : type
  const location = pick(LOCATIONS)
  const spatialRisk = pick(SPATIAL_RISK_HABITAT)
  return {
    point,
    ref: syntheticRef('T', i),
    size,
    ruralOrUrban,
    type,
    retention,
    baselineCondition: overrideOr(
      override,
      'baselineCondition',
      conditions.baseline
    ),
    baselineSignificance: overrideOr(
      override,
      'baselineStrategicSignificance',
      BASELINE_STRATEGIC_SIGNIFICANCE
    ),
    proposedSize,
    proposedCondition: resolveProposed(
      override,
      'proposedCondition',
      conditions.proposed
    ),
    proposedSignificance: resolveProposed(
      override,
      'proposedStrategicSignificance',
      drawnSignificance
    ),
    proposedType,
    location,
    advanceYears,
    delayYears,
    spatialRisk,
    count: overrideOr(override, 'count', TREE_COUNT_DEFAULT)
  }
}

/**
 * `count` trees inside `boundaryRing`, fewer if no interior point can be
 * found. `perRowOverrides[i]`, if provided, pins values on tree i.
 */
export function drawTrees(boundaryRing, count, perRowOverrides) {
  const trees = []
  while (trees.length < count) {
    const point = pickInteriorPoint(boundaryRing)
    if (!point) {
      break
    }
    trees.push(drawTree(point, trees.length, perRowOverrides?.[trees.length]))
  }
  return trees
}
