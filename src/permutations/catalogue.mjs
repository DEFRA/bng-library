/**
 * The permutations catalogue: a declarative set of scenarios the runner turns
 * into paired baseline / post-intervention GeoPackages, organised by purpose.
 *
 * Each scenario is a plain recipe over the bng-library `attributeOverrides`
 * surface (see `generateOne`). A scenario names:
 *   id            kebab-case, unique; drives the output filenames
 *   purpose       the sub-folder it lands in (a testing theme)
 *   title         one-line human label
 *   description   what the fixture demonstrates
 *   size          habitat parcel count (also scales hedgerow/river/tree counts)
 *   overrides     bng-library attributeOverrides ({ habitats, hedgerows, rivers })
 *   subject       { layer, ref, note } — the feature a tester should open
 *   expectGain    'met' | 'unmet' — when set, the runner prices the habitats
 *                 through the engine and asserts the +10% threshold
 *   emptyLayers   optional layer keys ('habitats', 'hedgerows', 'rivers',
 *                 'trees') generated empty, so the random filler features
 *                 cannot add warnings or trading breaches of their own
 *
 * What the metric workbook should make of a scenario — checked
 * against the recalculated workbook by `checkScenarioExpectations`:
 *   expectMetricWarnings  text of warnings the metric raises on the subject
 *   expectTrading         { area | hedgerow | watercourse: { band: 'met' |
 *                         'breached' } } — each band's trading-rule verdict
 *   expectRejectedInputs  ['sheetKey.field', …] — subject inputs the
 *                         workbook's own drop-down lists do not offer
 *
 * The axes from BMD-934 map onto the purposes below: intervention categories
 * across the three habitat types, conditions, strategic significance, met/unmet
 * 10% net gain, low→medium distinctiveness trading, enhancement/creation
 * advance & delay years, and complete vs incomplete data.
 */

import {
  CONDITIONS,
  HEDGE_CONDITIONS,
  IN_SCOPE_HEDGE_TYPES,
  MIN_HEDGEROW_COUNT,
  MIN_RIVER_COUNT,
  STRATEGIC_SIGNIFICANCE
} from '../synthetic/synthetic-constants.mjs'
import { TRADING_MATRIX } from './trading-matrix.mjs'

// Habitats chosen for stable distinctiveness bands and a full 5-condition
// range, so a scenario can pin any condition without hitting a "Not Possible"
// (habitat, condition) pair. Both are Medium-or-lower distinctiveness: the
// service rejects High/V.High habitats at upload (baseline and
// post-intervention alike), so the catalogue must never pin one.
const HABITAT_LOW = 'Grassland - Modified grassland'
const HABITAT_MEDIUM = 'Grassland - Other neutral grassland'

// Strategic significance, worst → best multiplier. Index 2 is the "Low (1)"
// value the habitat-details pages display.
const SS_LOW = STRATEGIC_SIGNIFICANCE[2]
const SS_MEDIUM = STRATEGIC_SIGNIFICANCE[1]
const SS_HIGH = STRATEGIC_SIGNIFICANCE[0]

const RIVER_TYPE = 'Canals'
const HEDGE_TYPE = IN_SCOPE_HEDGE_TYPES[0]
const HEDGE_GOOD = HEDGE_CONDITIONS[0]
const HEDGE_MODERATE = HEDGE_CONDITIONS[1]

const NO_WATER_ENCROACHMENT = 'No Encroachment'
const NO_RIPARIAN_ENCROACHMENT = 'No Encroachment/No Encroachment'

const DEFAULT_SIZE = 6

// Isolate one layer: the others are generated empty.
const ONLY_AREAS = ['hedgerows', 'rivers', 'trees']
const AREAS_AND_HEDGEROWS = ['rivers', 'trees']
const AREAS_AND_RIVERS = ['hedgerows', 'trees']

const RIVER_DITCH = 'Ditches'
const RIVER_CULVERT = 'Culvert'
const HEDGE_NATIVE = 'Native hedgerow'
const HEDGE_POOR = HEDGE_CONDITIONS[2]

// A small fixture still draws this many linear features, so pinning them all
// leaves no random ones behind.
const MIN_HEDGEROWS = MIN_HEDGEROW_COUNT
const MIN_RIVERS = MIN_RIVER_COUNT

/** Repeat a per-row recipe `n` times to pin every row of a layer. */
function repeat(recipe, n) {
  return Array.from({ length: n }, () => ({ ...recipe }))
}

// ---------------------------------------------------------------------------
// Intervention categories across the three habitat types
// ---------------------------------------------------------------------------

const areaBase = {
  habitatFullName: HABITAT_MEDIUM,
  baselineCondition: 'Moderate',
  baselineStrategicSignificance: SS_LOW,
  proposedStrategicSignificance: SS_LOW
}

const interventionScenarios = [
  {
    id: 'intervention-area-retained',
    purpose: 'intervention',
    title: 'Area habitat — Retained',
    description:
      'Every area parcel is retained: proposed state mirrors the baseline.',
    overrides: {
      habitats: repeat({ ...areaBase, retention: 'Retained' }, DEFAULT_SIZE)
    },
    subject: {
      layer: 'Habitats',
      ref: 'H001',
      note: 'a retained area habitat'
    }
  },
  {
    id: 'intervention-area-enhanced',
    purpose: 'intervention',
    title: 'Area habitat — Enhanced',
    description:
      'Area parcels are enhanced from Moderate to Good condition (same habitat).',
    overrides: {
      habitats: repeat(
        {
          ...areaBase,
          retention: 'Enhanced',
          proposedHabitatFullName: HABITAT_MEDIUM,
          proposedCondition: 'Good'
        },
        DEFAULT_SIZE
      )
    },
    subject: {
      layer: 'Habitats',
      ref: 'H001',
      note: 'an enhanced area habitat'
    }
  },
  {
    id: 'intervention-area-created',
    purpose: 'intervention',
    title: 'Area habitat — Created',
    description:
      "Area parcels are created (written to the gpkg as the statutory 'Lost' retention).",
    overrides: {
      habitats: repeat(
        {
          ...areaBase,
          retention: 'Created',
          proposedHabitatFullName: HABITAT_MEDIUM,
          proposedCondition: 'Good'
        },
        DEFAULT_SIZE
      )
    },
    subject: { layer: 'Habitats', ref: 'H001', note: 'a created area habitat' }
  },
  {
    id: 'intervention-hedgerow-retained',
    purpose: 'intervention',
    title: 'Hedgerow — Retained',
    description:
      'The first hedgerow is retained; area parcels tile the redline.',
    overrides: {
      hedgerows: [
        {
          hedgeType: HEDGE_TYPE,
          retention: 'Retained',
          baselineCondition: HEDGE_GOOD,
          proposedCondition: HEDGE_GOOD,
          baselineStrategicSignificance: SS_LOW,
          proposedStrategicSignificance: SS_LOW
        }
      ]
    },
    subject: {
      layer: 'Hedgerows',
      ref: 'HG001',
      note: 'a retained hedgerow'
    }
  },
  {
    id: 'intervention-hedgerow-enhanced',
    purpose: 'intervention',
    title: 'Hedgerow — Enhanced',
    description:
      'The first hedgerow is enhanced from Moderate to Good condition.',
    overrides: {
      hedgerows: [
        {
          hedgeType: HEDGE_TYPE,
          retention: 'Enhanced',
          baselineCondition: HEDGE_MODERATE,
          proposedCondition: HEDGE_GOOD,
          baselineStrategicSignificance: SS_LOW,
          proposedStrategicSignificance: SS_LOW
        }
      ]
    },
    subject: {
      layer: 'Hedgerows',
      ref: 'HG001',
      note: 'an enhanced hedgerow'
    }
  },
  {
    id: 'intervention-hedgerow-created',
    purpose: 'intervention',
    title: 'Hedgerow — Created',
    description:
      'The first hedgerow is created; its baseline columns take the template placeholders.',
    overrides: {
      hedgerows: [
        {
          hedgeType: HEDGE_TYPE,
          retention: 'Created',
          proposedCondition: HEDGE_GOOD,
          proposedStrategicSignificance: SS_LOW,
          advanceYears: '2'
        }
      ]
    },
    subject: { layer: 'Hedgerows', ref: 'HG001', note: 'a created hedgerow' }
  },
  {
    id: 'intervention-watercourse-retained',
    purpose: 'intervention',
    title: 'Watercourse — Retained',
    description: 'The first watercourse is retained, with no encroachment.',
    overrides: {
      rivers: [
        {
          riverType: RIVER_TYPE,
          retention: 'Retained',
          baselineCondition: 'Fairly Good',
          proposedCondition: 'Fairly Good',
          baselineStrategicSignificance: SS_LOW,
          proposedStrategicSignificance: SS_LOW,
          baselineWaterEncroachment: NO_WATER_ENCROACHMENT,
          proposedWaterEncroachment: NO_WATER_ENCROACHMENT,
          baselineRiparianEncroachment: NO_RIPARIAN_ENCROACHMENT,
          proposedRiparianEncroachment: NO_RIPARIAN_ENCROACHMENT
        }
      ]
    },
    subject: {
      layer: 'Rivers',
      ref: 'R001',
      note: 'a retained watercourse'
    }
  },
  {
    id: 'intervention-watercourse-enhanced',
    purpose: 'intervention',
    title: 'Watercourse — Enhanced',
    description:
      'The first watercourse is enhanced from Moderate to Good condition.',
    overrides: {
      rivers: [
        {
          riverType: RIVER_TYPE,
          retention: 'Enhanced',
          baselineCondition: 'Moderate',
          proposedCondition: 'Good',
          baselineStrategicSignificance: SS_LOW,
          proposedStrategicSignificance: SS_LOW,
          baselineWaterEncroachment: NO_WATER_ENCROACHMENT,
          proposedWaterEncroachment: NO_WATER_ENCROACHMENT,
          baselineRiparianEncroachment: NO_RIPARIAN_ENCROACHMENT,
          proposedRiparianEncroachment: NO_RIPARIAN_ENCROACHMENT
        }
      ]
    },
    subject: {
      layer: 'Rivers',
      ref: 'R001',
      note: 'an enhanced watercourse'
    }
  },
  {
    id: 'intervention-watercourse-created',
    purpose: 'intervention',
    title: 'Watercourse — Created',
    description:
      'The first watercourse is created; its baseline columns take the template placeholders.',
    overrides: {
      rivers: [
        {
          riverType: RIVER_TYPE,
          retention: 'Created',
          proposedCondition: 'Good',
          proposedStrategicSignificance: SS_LOW,
          proposedWaterEncroachment: NO_WATER_ENCROACHMENT,
          proposedRiparianEncroachment: NO_RIPARIAN_ENCROACHMENT,
          delayYears: '2'
        }
      ]
    },
    subject: { layer: 'Rivers', ref: 'R001', note: 'a created watercourse' }
  }
]

// ---------------------------------------------------------------------------
// Invalid interventions — each one a rule the metric enforces, so the
// workbook raises its own warning on the subject
// ---------------------------------------------------------------------------

// A second, retained parcel keeps the baseline non-zero whatever happens to
// the subject.
const retainedControl = { ...areaBase, retention: 'Retained' }

function areaSubject(subject) {
  return [{ ...areaBase, ...subject }, retainedControl]
}

const enhancedDitch = {
  riverType: RIVER_DITCH,
  retention: 'Enhanced',
  baselineCondition: 'Moderate',
  proposedCondition: 'Good',
  baselineStrategicSignificance: SS_LOW,
  proposedStrategicSignificance: SS_LOW,
  baselineWaterEncroachment: NO_WATER_ENCROACHMENT,
  baselineRiparianEncroachment: NO_RIPARIAN_ENCROACHMENT
}

const invalidInterventionScenarios = [
  {
    id: 'invalid-area-condition-reduced',
    purpose: 'invalid-interventions',
    title: 'Area habitat — enhancement that lowers condition',
    description:
      'H001 is "enhanced" from Moderate to Poor condition, same habitat. The metric does not allow an enhancement to reduce condition.',
    size: 2,
    emptyLayers: ONLY_AREAS,
    overrides: {
      habitats: areaSubject({
        retention: 'Enhanced',
        proposedHabitatFullName: HABITAT_MEDIUM,
        proposedCondition: 'Poor'
      })
    },
    expectMetricWarnings: ['Can not reduce condition'],
    subject: {
      layer: 'Habitats',
      ref: 'H001',
      note: 'enhanced parcel whose condition drops'
    }
  },
  {
    id: 'invalid-area-no-enhancement',
    purpose: 'invalid-interventions',
    title: 'Area habitat — enhancement that changes nothing',
    description:
      'H001 is "enhanced" with the same habitat and the same Moderate condition — an enhancement that enhances nothing.',
    size: 2,
    emptyLayers: ONLY_AREAS,
    overrides: {
      habitats: areaSubject({
        retention: 'Enhanced',
        proposedHabitatFullName: HABITAT_MEDIUM,
        proposedCondition: 'Moderate'
      })
    },
    expectMetricWarnings: ['No enhancement'],
    subject: {
      layer: 'Habitats',
      ref: 'H001',
      note: 'enhanced parcel with no change'
    }
  },
  {
    id: 'invalid-area-trading-down',
    purpose: 'invalid-interventions',
    title: 'Area habitat — enhancement to a lower distinctiveness',
    description:
      'H001 is "enhanced" from a Medium-distinctiveness habitat to a Low one. An enhancement may not trade down.',
    size: 2,
    emptyLayers: ONLY_AREAS,
    overrides: {
      habitats: areaSubject({
        retention: 'Enhanced',
        proposedHabitatFullName: HABITAT_LOW,
        proposedCondition: 'Good'
      })
    },
    expectMetricWarnings: ['Trading Down'],
    subject: {
      layer: 'Habitats',
      ref: 'H001',
      note: 'Medium → Low distinctiveness enhancement'
    }
  },
  {
    id: 'invalid-area-advance-and-delay',
    purpose: 'invalid-interventions',
    title: 'Created habitat — both advance and delay years',
    description:
      'H001 is created 2 years in advance and also delayed by 3 years. The metric allows one or the other, never both.',
    size: 2,
    emptyLayers: ONLY_AREAS,
    overrides: {
      habitats: areaSubject({
        retention: 'Created',
        proposedHabitatFullName: HABITAT_MEDIUM,
        proposedCondition: 'Good',
        advanceYears: '2',
        delayYears: '3'
      })
    },
    expectMetricWarnings: ['both advance and delayed'],
    subject: {
      layer: 'Habitats',
      ref: 'H001',
      note: 'created parcel with advance and delay both set'
    }
  },
  {
    id: 'invalid-hedgerow-condition-reduced',
    purpose: 'invalid-interventions',
    title: 'Hedgerow — enhancement that lowers condition',
    description:
      'Every hedgerow is "enhanced" from Good to Poor condition. The metric does not allow an enhancement to reduce condition.',
    size: 1,
    emptyLayers: AREAS_AND_HEDGEROWS,
    overrides: {
      habitats: [retainedControl],
      hedgerows: repeat(
        {
          hedgeType: HEDGE_NATIVE,
          retention: 'Enhanced',
          baselineCondition: HEDGE_GOOD,
          proposedCondition: HEDGE_POOR,
          baselineStrategicSignificance: SS_LOW,
          proposedStrategicSignificance: SS_LOW
        },
        MIN_HEDGEROWS
      )
    },
    expectMetricWarnings: ['Can not reduce condition'],
    subject: {
      layer: 'Hedgerows',
      ref: 'HG001',
      note: 'enhanced hedgerow whose condition drops'
    }
  },
  {
    id: 'invalid-watercourse-culvert-enhanced',
    purpose: 'invalid-interventions',
    title: 'Watercourse — an enhanced culvert',
    description:
      'R001 is a culvert, "enhanced" in place. The metric has no enhancement for a culvert: its enhancement sheet does not offer the type at all.',
    size: 1,
    emptyLayers: AREAS_AND_RIVERS,
    overrides: {
      habitats: [retainedControl],
      rivers: [
        {
          riverType: RIVER_CULVERT,
          retention: 'Enhanced',
          baselineCondition: 'Poor',
          proposedCondition: 'Poor',
          baselineStrategicSignificance: SS_LOW,
          proposedStrategicSignificance: SS_LOW
        },
        {
          ...enhancedDitch,
          retention: 'Retained',
          proposedCondition: 'Moderate'
        }
      ]
    },
    expectRejectedInputs: ['watercourseEnhancement.habitatType'],
    subject: { layer: 'Rivers', ref: 'R001', note: 'an enhanced culvert' }
  },
  {
    id: 'invalid-watercourse-encroachment-worsened',
    purpose: 'invalid-interventions',
    title: 'Watercourse — enhancement that worsens encroachment',
    description:
      'Both ditches are "enhanced" to Good condition while their encroachment goes from none to Major on the channel and both banks, so the enhancement delivers fewer units than the baseline.',
    size: 1,
    emptyLayers: AREAS_AND_RIVERS,
    overrides: {
      habitats: [retainedControl],
      rivers: repeat(
        {
          ...enhancedDitch,
          proposedWaterEncroachment: 'Major',
          proposedRiparianEncroachment: 'Major/Major'
        },
        MIN_RIVERS
      )
    },
    expectMetricWarnings: ['units less than baseline'],
    subject: {
      layer: 'Rivers',
      ref: 'R001',
      note: 'enhanced ditch with worsened encroachment'
    }
  }
]

// ---------------------------------------------------------------------------
// Conditions — one parcel per condition band
// ---------------------------------------------------------------------------

const conditionScenarios = [
  {
    id: 'conditions-area-spread',
    purpose: 'conditions',
    title: 'Area habitats across every condition band',
    description:
      'Five retained parcels, each pinned to a different condition (Good → Poor), same habitat.',
    size: CONDITIONS.length,
    overrides: {
      habitats: CONDITIONS.map((condition) => ({
        habitatFullName: HABITAT_MEDIUM,
        retention: 'Retained',
        baselineCondition: condition,
        baselineStrategicSignificance: SS_LOW,
        proposedStrategicSignificance: SS_LOW
      }))
    },
    subject: {
      layer: 'Habitats',
      ref: 'H001',
      note: 'Good condition (H001) through Poor (H005)'
    }
  }
]

// ---------------------------------------------------------------------------
// Strategic significance — one parcel per multiplier band
// ---------------------------------------------------------------------------

const strategicSignificanceScenarios = [
  {
    id: 'strategic-significance-spread',
    purpose: 'strategic-significance',
    title: 'Area habitats across every strategic-significance band',
    description:
      'Three retained parcels pinned to Low (1), Medium and High strategic significance.',
    size: 3,
    overrides: {
      habitats: [SS_LOW, SS_MEDIUM, SS_HIGH].map((ss) => ({
        habitatFullName: HABITAT_MEDIUM,
        retention: 'Retained',
        baselineCondition: 'Moderate',
        baselineStrategicSignificance: ss,
        proposedStrategicSignificance: ss
      }))
    },
    subject: {
      layer: 'Habitats',
      ref: 'H001',
      note: 'H001 Low (1), H002 Medium, H003 High strategic significance'
    }
  }
]

// ---------------------------------------------------------------------------
// Met / unmet 10% net gain (engine-verified)
// ---------------------------------------------------------------------------

const netGainScenarios = [
  {
    id: 'net-gain-met',
    purpose: 'net-gain',
    title: 'Net gain met (≥ 10%)',
    description:
      'Every parcel enhanced from Low-distinctiveness/Poor to Medium-distinctiveness/Good — a large, unambiguous gain.',
    overrides: {
      habitats: repeat(
        {
          habitatFullName: HABITAT_LOW,
          proposedHabitatFullName: HABITAT_MEDIUM,
          retention: 'Enhanced',
          baselineCondition: 'Poor',
          proposedCondition: 'Good',
          baselineStrategicSignificance: SS_LOW,
          proposedStrategicSignificance: SS_LOW
        },
        DEFAULT_SIZE
      )
    },
    expectGain: 'met',
    subject: {
      layer: 'Habitats',
      ref: 'H001',
      note: 'enhanced parcels driving a net gain over 10%'
    }
  },
  {
    id: 'net-gain-unmet',
    purpose: 'net-gain',
    title: 'Net gain unmet (< 10%)',
    description:
      'Every parcel retained unchanged — zero net change, so the 10% gain is not met.',
    overrides: {
      habitats: repeat(
        {
          habitatFullName: HABITAT_MEDIUM,
          retention: 'Retained',
          baselineCondition: 'Moderate',
          baselineStrategicSignificance: SS_LOW,
          proposedStrategicSignificance: SS_LOW
        },
        DEFAULT_SIZE
      )
    },
    expectGain: 'unmet',
    subject: {
      layer: 'Habitats',
      ref: 'H001',
      note: 'retained parcels with no net gain'
    }
  }
]

// ---------------------------------------------------------------------------
// Trading rules — low → medium distinctiveness transfer
// ---------------------------------------------------------------------------

const tradingScenarios = [
  {
    id: 'trading-low-to-medium',
    purpose: 'trading-rules',
    title: 'Trading rules — Low → Medium distinctiveness',
    description:
      'Parcels enhanced from a Low-distinctiveness habitat to a Medium-distinctiveness one, exercising the low→medium trading rule.',
    overrides: {
      habitats: repeat(
        {
          habitatFullName: HABITAT_LOW,
          proposedHabitatFullName: HABITAT_MEDIUM,
          retention: 'Enhanced',
          baselineCondition: 'Moderate',
          proposedCondition: 'Good',
          baselineStrategicSignificance: SS_LOW,
          proposedStrategicSignificance: SS_LOW
        },
        DEFAULT_SIZE
      )
    },
    subject: {
      layer: 'Habitats',
      ref: 'H001',
      note: 'Low (baseline) → Medium (proposed) distinctiveness'
    }
  }
]

// ---------------------------------------------------------------------------
// Enhancement / creation advance & delay years
// ---------------------------------------------------------------------------

const advanceDelayScenarios = [
  {
    id: 'advance-delay-created-advance',
    purpose: 'advance-delay',
    title: 'Created habitat — advance years',
    description:
      'Created parcels with habitat creation started 5 years in advance (delay 0).',
    overrides: {
      habitats: repeat(
        {
          habitatFullName: HABITAT_MEDIUM,
          proposedHabitatFullName: HABITAT_MEDIUM,
          retention: 'Created',
          proposedCondition: 'Good',
          baselineStrategicSignificance: SS_LOW,
          proposedStrategicSignificance: SS_LOW,
          advanceYears: '5',
          delayYears: '0'
        },
        DEFAULT_SIZE
      )
    },
    subject: {
      layer: 'Habitats',
      ref: 'H001',
      note: 'created parcel with 5 advance years'
    }
  },
  {
    id: 'advance-delay-created-delay',
    purpose: 'advance-delay',
    title: 'Created habitat — delay years',
    description:
      'Created parcels with habitat creation delayed by 3 years (advance 0).',
    overrides: {
      habitats: repeat(
        {
          habitatFullName: HABITAT_MEDIUM,
          proposedHabitatFullName: HABITAT_MEDIUM,
          retention: 'Created',
          proposedCondition: 'Good',
          baselineStrategicSignificance: SS_LOW,
          proposedStrategicSignificance: SS_LOW,
          advanceYears: '0',
          delayYears: '3'
        },
        DEFAULT_SIZE
      )
    },
    subject: {
      layer: 'Habitats',
      ref: 'H001',
      note: 'created parcel with 3 delay years'
    }
  }
]

// ---------------------------------------------------------------------------
// Complete vs incomplete post-intervention data
// ---------------------------------------------------------------------------

const completenessScenarios = [
  {
    id: 'data-complete',
    purpose: 'data-completeness',
    title: 'Complete post-intervention data',
    description:
      'Every enhanced parcel has all proposed attributes populated — a clean, complete file.',
    overrides: {
      habitats: repeat(
        {
          habitatFullName: HABITAT_MEDIUM,
          proposedHabitatFullName: HABITAT_MEDIUM,
          retention: 'Enhanced',
          baselineCondition: 'Moderate',
          proposedCondition: 'Good',
          baselineStrategicSignificance: SS_LOW,
          proposedStrategicSignificance: SS_LOW
        },
        DEFAULT_SIZE
      )
    },
    subject: {
      layer: 'Habitats',
      ref: 'H001',
      note: 'a complete enhanced parcel'
    }
  },
  {
    id: 'data-incomplete-mix',
    purpose: 'data-completeness',
    title: 'Mixed complete and incomplete data',
    description:
      'The first three parcels are complete; the last three are incomplete (blank proposed condition and strategic significance).',
    overrides: {
      habitats: [
        ...repeat(
          {
            habitatFullName: HABITAT_MEDIUM,
            proposedHabitatFullName: HABITAT_MEDIUM,
            retention: 'Enhanced',
            baselineCondition: 'Moderate',
            proposedCondition: 'Good',
            baselineStrategicSignificance: SS_LOW,
            proposedStrategicSignificance: SS_LOW
          },
          3
        ),
        ...repeat(
          {
            habitatFullName: HABITAT_MEDIUM,
            retention: 'Enhanced',
            baselineCondition: 'Moderate',
            baselineStrategicSignificance: SS_LOW,
            incomplete: true
          },
          3
        )
      ]
    },
    subject: {
      layer: 'Habitats',
      ref: 'H004',
      note: 'H004–H006 have blank proposed data'
    }
  }
]

export const SCENARIOS = [
  ...interventionScenarios,
  ...invalidInterventionScenarios,
  ...conditionScenarios,
  ...strategicSignificanceScenarios,
  ...netGainScenarios,
  ...tradingScenarios,
  ...TRADING_MATRIX,
  ...advanceDelayScenarios,
  ...completenessScenarios
]

export const PURPOSES = [...new Set(SCENARIOS.map((s) => s.purpose))]

export { DEFAULT_SIZE }
