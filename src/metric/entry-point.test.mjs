// Guards the package contract rather than the modules behind it.
//
// Every other suite here imports the engine by relative path, so a mistake in
// the "exports" map of package.json would leave all of them green while every
// consumer — bng-metric-backend, the harness, the digital prototype — failed to
// resolve `bng-library/metric` at all. These tests go in through the package
// specifier, which Node resolves via that map (self-reference), so the subpath
// export is exercised the same way a consumer exercises it.

import { describe, expect, it } from 'vitest'

import * as relative from './index.mjs'

const subpath = await import('bng-library/metric')

/**
 * The complete public surface. Spelled out rather than derived from the module
 * so that adding or removing an export has to be a deliberate edit here too —
 * this list is what consumers are entitled to rely on.
 */
const PUBLIC_EXPORTS = [
  'BaselineLookupError',
  'CONDITION_SCORES',
  'DIFFICULTY_MULTIPLIER',
  'DISTINCTIVENESS_CATEGORIES',
  'DISTINCTIVENESS_SCORES',
  'HABITAT_DIFFICULTY',
  'HEDGEROW_CONDITION_SCORES',
  'HEDGEROW_DISTINCTIVENESS_CATEGORIES',
  'HEDGEROW_DISTINCTIVENESS_SCORES',
  'INDIVIDUAL_TREE_AREA_HECTARES',
  'MAX_SIG_FIGS',
  'MAX_YEARS',
  'MAX_YEARS_PLUS',
  'MERGED_INTERTIDAL_BROAD_HABITAT',
  'MIN_YEARS',
  'TIME_TO_TARGET_CREATION',
  'TIME_TO_TARGET_ENHANCEMENT',
  'TIME_TO_TARGET_MULTIPLIER',
  'TRADING_RULE_MET',
  'TRADING_RULE_NOT_MET',
  'WATERCOURSE_CONDITION_SCORES',
  'WATERCOURSE_DISTINCTIVENESS_CATEGORIES',
  'WATERCOURSE_DISTINCTIVENESS_SCORES',
  'WATERCOURSE_ENCROACHMENT_MULTIPLIER',
  'WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER',
  'broadHabitatOf',
  'calculateAreaHabitatBaseline',
  'calculateAreaHabitatTradingRules',
  'calculateBandTradingFigures',
  'calculateCreatedAreaHabitatPostIntervention',
  'calculateCreatedHedgerowPostIntervention',
  'calculateCreatedWatercoursePostIntervention',
  'calculateCumulativeAvailability',
  'calculateEnhancedAreaHabitatPostIntervention',
  'calculateEnhancedHedgerowPostIntervention',
  'calculateEnhancedWatercoursePostIntervention',
  'calculateHabitatNetUnitChanges',
  'calculateHedgerowBaseline',
  'calculateHedgerowTradingRules',
  'calculatePostInterventionNetUnitChanges',
  'calculateRetainedAreaHabitatPostIntervention',
  'calculateRetainedHedgerowPostIntervention',
  'calculateRetainedWatercoursePostIntervention',
  'calculateWatercourseBaseline',
  'calculateWatercourseTradingRules',
  'combineTradingRuleStatuses',
  'deriveAreaHabitatTradingRuleStatuses',
  'getIndividualTreeAreaHectares',
  'isRecognisedEncroachmentValue',
  'normaliseEncroachmentLabel',
  'resolveDistinctiveness',
  'resolveWatercourseDistinctiveness',
  'roundToSigFigs',
  'sumDeficit',
  'sumNetChange',
  'sumSurplus',
  'tradingRuleStatus'
]

describe("the 'bng-library/metric' subpath export", () => {
  it('resolves through the package exports map', () => {
    expect(subpath.calculateAreaHabitatBaseline).toBeTypeOf('function')
  })

  it('exposes exactly the documented public surface', () => {
    expect(Object.keys(subpath).sort()).toEqual(PUBLIC_EXPORTS)
  })

  it('is the same module the relative import gives, not a second copy', () => {
    for (const name of PUBLIC_EXPORTS) {
      expect(subpath[name]).toBe(relative[name])
    }
  })

  it('calculates through the subpath as a consumer would', () => {
    expect(
      subpath.calculateAreaHabitatBaseline(
        2.5,
        'Grassland - Modified grassland',
        'Poor'
      )
    ).toEqual({
      units: 5,
      distinctiveness: 'Low',
      distinctivenessScore: 2,
      conditionScore: 1,
      strategicSignificanceScore: 1
    })
  })
})

describe("the 'bng-library' root export", () => {
  it('does not also re-export the metric surface', async () => {
    // The maths is deliberately reachable only through the subpath, so a
    // consumer that wants it does not drag in the GeoPackage side with it.
    const root = await import('bng-library')
    expect(root.calculateAreaHabitatBaseline).toBeUndefined()
  })
})
