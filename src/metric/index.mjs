export {
  CONDITION_SCORES,
  DIFFICULTY_MULTIPLIER,
  DISTINCTIVENESS_CATEGORIES,
  DISTINCTIVENESS_SCORES,
  HABITAT_DIFFICULTY,
  HEDGEROW_CONDITION_SCORES,
  HEDGEROW_DISTINCTIVENESS_CATEGORIES,
  HEDGEROW_DISTINCTIVENESS_SCORES,
  INDIVIDUAL_TREE_AREA_HECTARES,
  TIME_TO_TARGET_CREATION,
  TIME_TO_TARGET_ENHANCEMENT,
  TIME_TO_TARGET_MULTIPLIER,
  WATERCOURSE_CONDITION_SCORES,
  WATERCOURSE_DISTINCTIVENESS_CATEGORIES,
  WATERCOURSE_DISTINCTIVENESS_SCORES,
  WATERCOURSE_ENCROACHMENT_MULTIPLIER,
  WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER
} from './reference-constants.mjs'

export { BaselineLookupError } from './errors.mjs'
export { roundToSigFigs, MAX_SIG_FIGS } from './utils.mjs'
export { calculateAreaHabitatBaseline } from './baseline.mjs'
export { calculatePostInterventionNetUnitChanges } from './net-unit-change.mjs'
export { getIndividualTreeAreaHectares } from './tree.mjs'
export {
  calculateHedgerowBaseline,
  calculateWatercourseBaseline
} from './linear-baseline.mjs'
export {
  calculateRetainedAreaHabitatPostIntervention,
  calculateCreatedAreaHabitatPostIntervention,
  calculateEnhancedAreaHabitatPostIntervention
} from './post-intervention.mjs'
export {
  calculateRetainedHedgerowPostIntervention,
  calculateCreatedHedgerowPostIntervention,
  calculateEnhancedHedgerowPostIntervention
} from './hedgerow-post-intervention.mjs'
export {
  calculateRetainedWatercoursePostIntervention,
  calculateCreatedWatercoursePostIntervention,
  calculateEnhancedWatercoursePostIntervention
} from './watercourse-post-intervention.mjs'
export {
  isRecognisedEncroachmentValue,
  normaliseEncroachmentLabel
} from './linear-resolvers.mjs'
export { resolveDistinctiveness } from './multipliers.mjs'
export {
  calculateHabitatNetUnitChanges,
  calculateCumulativeAvailability,
  sumDeficit,
  sumNetChange,
  sumSurplus
} from './trading-rules.mjs'
export {
  broadHabitatOf,
  calculateAreaHabitatTradingRules,
  MERGED_INTERTIDAL_BROAD_HABITAT
} from './area-trading-rules.mjs'
export { MAX_YEARS, MAX_YEARS_PLUS, MIN_YEARS } from './validate.mjs'
