import { describe, expect, it } from 'vitest'

import {
  ENHANCEMENT_KIND,
  ENHANCEMENT_NOT_CHECKED_REASON,
  ENHANCEMENT_RULE,
  checkEnhancement,
  enhancementRulesFor
} from './enhancement-rules.mjs'

const CA_NA = 'Condition Assessment N/A'

const {
  area: AREA,
  hedgerow: HEDGEROW,
  watercourse: WATERCOURSE
} = ENHANCEMENT_KIND
const {
  unrecognisedKind: UNRECOGNISED_KIND,
  unrecognisedBaseline: UNRECOGNISED_BASELINE,
  unrecognisedProposed: UNRECOGNISED_PROPOSED,
  noRule: NO_RULE
} = ENHANCEMENT_NOT_CHECKED_REASON

function side(habitat, condition) {
  return { habitat, condition }
}

const area = side
const linear = side
const check = checkEnhancement

/**
 * @param {string} kind
 * @param {object} baseline
 * @param {string} rule
 * @param {Array<[string, object]>} valid
 * @param {Array<[string, object]>} invalid
 */
function describeRule(kind, baseline, rule, { valid, invalid }) {
  if (valid.length > 0) {
    it.each(valid)('allows %s', (_, proposed) => {
      expect(check(kind, baseline, proposed)).toMatchObject({
        rule,
        valid: true
      })
    })
  }
  it.each(invalid)('rejects %s', (_, proposed) => {
    expect(check(kind, baseline, proposed)).toMatchObject({
      rule,
      valid: false
    })
  })
}

describe('checkEnhancement', () => {
  describe('medium area with a condition', () => {
    describeRule(
      AREA,
      area('Grassland - Other neutral grassland', 'Moderate'),
      ENHANCEMENT_RULE.MEDIUM_AREA,
      {
        valid: [
          [
            'a medium habitat of the same broad habitat in better condition',
            area('Grassland - Other lowland acid grassland', 'Good')
          ],
          [
            'the same habitat in better condition',
            area('Grassland - Other neutral grassland', 'Fairly Good')
          ]
        ],
        invalid: [
          [
            'the same condition',
            area('Grassland - Other neutral grassland', 'Moderate')
          ],
          [
            'a worse condition',
            area('Grassland - Other neutral grassland', 'Poor')
          ],
          [
            'a different broad habitat',
            area('Heathland and shrub - Mixed scrub', 'Good')
          ],
          [
            'a low distinctiveness habitat',
            area('Grassland - Modified grassland', 'Good')
          ]
        ]
      }
    )
  })

  describe('medium area, Condition Assessment N/A', () => {
    describeRule(
      AREA,
      area('Heathland and shrub - Bramble scrub', CA_NA),
      ENHANCEMENT_RULE.MEDIUM_AREA_CONDITION_NA,
      {
        valid: [
          [
            'a medium habitat in Fairly Poor condition',
            area('Heathland and shrub - Mixed scrub', 'Fairly Poor')
          ],
          [
            'a medium habitat in Good condition',
            area('Heathland and shrub - Hazel scrub', 'Good')
          ]
        ],
        invalid: [
          [
            'a medium habitat in Poor condition',
            area('Heathland and shrub - Mixed scrub', 'Poor')
          ],
          [
            'a medium habitat whose time to target is Not Possible',
            area('Woodland and forest - Other woodland; mixed', 'Good')
          ],
          [
            'the same habitat, whose time to target is Not Possible',
            area('Heathland and shrub - Bramble scrub', 'Moderate')
          ],
          [
            'a medium habitat whose condition cannot be assessed',
            area('Cropland - Arable field margins tussocky', CA_NA)
          ],
          [
            'a low distinctiveness habitat',
            area('Grassland - Modified grassland', 'Good')
          ]
        ]
      }
    )
  })

  describe('medium intertidal area', () => {
    describeRule(
      AREA,
      area('Intertidal sediment - Littoral sand', 'Moderate'),
      ENHANCEMENT_RULE.MEDIUM_INTERTIDAL_AREA,
      {
        valid: [
          [
            'the other intertidal broad habitat in better condition',
            area(
              'Intertidal hard structures - Artificial hard structures with integrated greening of grey infrastructure (IGGI)',
              'Good'
            )
          ],
          [
            'the same broad habitat in better condition',
            area(
              'Intertidal sediment - Littoral coarse sediment',
              'Fairly Good'
            )
          ]
        ],
        invalid: [
          [
            'a medium habitat that is not intertidal',
            area('Grassland - Other neutral grassland', 'Good')
          ],
          [
            'the same condition',
            area('Intertidal sediment - Littoral coarse sediment', 'Moderate')
          ],
          [
            'a low distinctiveness intertidal habitat',
            area('Intertidal sediment - Artificial littoral sand', 'Good')
          ]
        ]
      }
    )
  })

  describe('low area with a condition', () => {
    describeRule(
      AREA,
      area('Grassland - Modified grassland', 'Moderate'),
      ENHANCEMENT_RULE.LOW_AREA,
      {
        valid: [
          [
            'the same habitat in better condition',
            area('Grassland - Modified grassland', 'Good')
          ],
          [
            'a low habitat of another broad habitat in better condition',
            area('Urban - Allotments', 'Fairly Good')
          ],
          [
            'a medium habitat in any condition',
            area('Grassland - Other neutral grassland', 'Poor')
          ],
          [
            'a medium habitat whose condition cannot be assessed',
            area('Cropland - Arable field margins tussocky', CA_NA)
          ]
        ],
        invalid: [
          [
            'the same condition',
            area('Grassland - Modified grassland', 'Moderate')
          ],
          [
            'a medium habitat whose time to target is Not Possible',
            area('Heathland and shrub - Bramble scrub', CA_NA)
          ],
          [
            'a low habitat in worse condition',
            area('Urban - Allotments', 'Poor')
          ],
          [
            'a very low distinctiveness habitat',
            area('Urban - Developed land; sealed surface', 'N/A - Other')
          ]
        ]
      }
    )
  })

  describe('low area, Condition Assessment N/A', () => {
    describeRule(
      AREA,
      area('Cropland - Cereal crops', CA_NA),
      ENHANCEMENT_RULE.LOW_AREA_CONDITION_NA,
      {
        valid: [
          [
            'a medium habitat in Fairly Poor condition',
            area('Grassland - Other neutral grassland', 'Fairly Poor')
          ],
          [
            'a medium habitat in Good condition',
            area('Grassland - Other neutral grassland', 'Good')
          ],
          [
            'a medium habitat in Poor condition',
            area('Grassland - Other neutral grassland', 'Poor')
          ],
          [
            'a medium habitat whose condition cannot be assessed, with a time to target',
            area('Cropland - Arable field margins tussocky', CA_NA)
          ]
        ],
        invalid: [
          [
            'a medium habitat whose time to target is Not Possible',
            area('Heathland and shrub - Bramble scrub', 'Moderate')
          ],
          [
            'a medium habitat whose condition cannot be assessed, without a time to target',
            area('Grassland - Other neutral grassland', CA_NA)
          ],
          [
            'a low habitat in better condition than Poor',
            area('Grassland - Modified grassland', 'Good')
          ],
          [
            'a low habitat whose condition cannot be assessed',
            area('Cropland - Winter stubble', CA_NA)
          ]
        ]
      }
    )
  })

  describe('very low area', () => {
    describeRule(
      AREA,
      area('Urban - Developed land; sealed surface', 'N/A - Other'),
      ENHANCEMENT_RULE.VERY_LOW_AREA,
      {
        valid: [
          [
            'a low habitat in Poor condition',
            area('Urban - Bare ground', 'Poor')
          ],
          [
            'a low habitat of another broad habitat',
            area('Grassland - Modified grassland', 'Good')
          ],
          [
            'a medium habitat in Poor condition',
            area('Grassland - Other neutral grassland', 'Poor')
          ]
        ],
        invalid: [
          [
            'the same habitat',
            area('Urban - Developed land; sealed surface', 'N/A - Other')
          ],
          [
            'another very low habitat',
            area('Urban - Unvegetated garden', 'N/A - Other')
          ],
          [
            'a low habitat whose condition cannot be assessed',
            area('Urban - Vegetated garden', CA_NA)
          ],
          [
            'a medium habitat whose condition cannot be assessed',
            area('Cropland - Arable field margins tussocky', CA_NA)
          ],
          [
            'a medium habitat whose time to target is Not Possible',
            area('Heathland and shrub - Bramble scrub', 'Moderate')
          ]
        ]
      }
    )
  })

  describe('medium hedgerow', () => {
    describeRule(
      HEDGEROW,
      linear('Native hedgerow with trees', 'Moderate'),
      ENHANCEMENT_RULE.MEDIUM_HEDGEROW,
      {
        valid: [
          [
            'a medium hedgerow in better condition',
            linear('Species-rich native hedgerow', 'Good')
          ]
        ],
        invalid: [
          [
            'the same condition',
            linear('Species-rich native hedgerow', 'Moderate')
          ],
          ['a low hedgerow', linear('Native hedgerow', 'Good')]
        ]
      }
    )
  })

  describe('low hedgerow', () => {
    describeRule(
      HEDGEROW,
      linear('Native hedgerow', 'Moderate'),
      ENHANCEMENT_RULE.LOW_HEDGEROW,
      {
        valid: [
          [
            'a low hedgerow in better condition',
            linear('Line of trees', 'Good')
          ],
          [
            'a medium hedgerow in the same condition',
            linear('Native hedgerow with trees', 'Moderate')
          ]
        ],
        invalid: [
          [
            'a low hedgerow in the same condition',
            linear('Native hedgerow', 'Moderate')
          ],
          [
            'a medium hedgerow in worse condition',
            linear('Native hedgerow with trees', 'Poor')
          ],
          [
            'a medium hedgerow whose time to target is Not Possible',
            linear('Ecologically valuable line of trees', 'Moderate')
          ],
          [
            'a very low hedgerow',
            linear('Non-native and ornamental hedgerow', 'Good')
          ]
        ]
      }
    )
  })

  describe('very low hedgerow', () => {
    describeRule(
      HEDGEROW,
      linear('Non-native and ornamental hedgerow', 'Moderate'),
      ENHANCEMENT_RULE.VERY_LOW_HEDGEROW,
      {
        valid: [],
        invalid: [
          [
            'a very low hedgerow in better condition',
            linear('Non-native and ornamental hedgerow', 'Good')
          ],
          [
            'a low hedgerow in the same condition',
            linear('Native hedgerow', 'Moderate')
          ],
          [
            'a medium hedgerow in better condition',
            linear('Species-rich native hedgerow', 'Good')
          ]
        ]
      }
    )
  })

  describe('medium watercourse', () => {
    describeRule(
      WATERCOURSE,
      linear('Ditches', 'Moderate'),
      ENHANCEMENT_RULE.MEDIUM_WATERCOURSE,
      {
        valid: [
          [
            'the same habitat in better condition',
            linear('Ditches', 'Fairly Good')
          ]
        ],
        invalid: [
          ['the same condition', linear('Ditches', 'Moderate')],
          ['another medium habitat', linear('Canals', 'Good')]
        ]
      }
    )
  })

  describe('low watercourse', () => {
    describeRule(
      WATERCOURSE,
      linear('Culvert', 'Poor'),
      ENHANCEMENT_RULE.LOW_WATERCOURSE,
      {
        valid: [
          ['a medium watercourse in Poor condition', linear('Ditches', 'Poor')],
          ['another medium watercourse', linear('Canals', 'Good')]
        ],
        invalid: [['a culvert', linear('Culvert', 'Poor')]]
      }
    )
  })

  describe('an enhancement with no time to target (AC11)', () => {
    // AC11: an enhancement the metric's time-to-target table has no entry
    // for is rejected, as one it gives as "Not Possible" is. A baseline
    // condition that cannot be assessed is compared as Poor, so each rule
    // allows these from Poor and from "N/A - Other" alike, but the table has
    // a time only from Poor. Valid data cannot reach this: the metric does
    // not score these habitats in "N/A - Other", so the service nulls that
    // condition before the rules run. allowedByRule and timeToTarget pin the
    // rejection on the missing entry, not on the rule.
    it.each([
      [
        AREA,
        ENHANCEMENT_RULE.MEDIUM_AREA,
        'Grassland - Other neutral grassland',
        area('Grassland - Other lowland acid grassland', 'Good')
      ],
      [
        HEDGEROW,
        ENHANCEMENT_RULE.LOW_HEDGEROW,
        'Native hedgerow',
        linear('Native hedgerow', 'Good')
      ],
      [
        WATERCOURSE,
        ENHANCEMENT_RULE.MEDIUM_WATERCOURSE,
        'Ditches',
        linear('Ditches', 'Good')
      ]
    ])(
      '%s: rejects what the %s rule allows, with no entry',
      (kind, rule, habitat, proposed) => {
        expect(check(kind, side(habitat, 'Poor'), proposed)).toMatchObject({
          rule,
          valid: true,
          allowedByRule: true,
          timeToTarget: expect.any(Number)
        })
        expect(
          check(kind, side(habitat, 'N/A - Other'), proposed)
        ).toMatchObject({
          rule,
          valid: false,
          allowedByRule: true,
          timeToTarget: null
        })
      }
    )

    it('rejects what a rule allows when the time to target is Not Possible', () => {
      expect(
        check(
          AREA,
          area('Heathland and shrub - Bramble scrub', CA_NA),
          area('Heathland and shrub - Bramble scrub', 'Moderate')
        )
      ).toMatchObject({
        rule: ENHANCEMENT_RULE.MEDIUM_AREA_CONDITION_NA,
        valid: false,
        allowedByRule: true,
        timeToTarget: 'Not Possible'
      })
    })
  })

  describe('reading the attributes', () => {
    it('matches labels exactly, as the reference tables key them', () => {
      expect(
        check(
          WATERCOURSE,
          linear('Ditches', 'Moderate'),
          linear('ditches', 'Good')
        )
      ).toEqual({ checked: false, reason: UNRECOGNISED_PROPOSED })
      expect(
        check(
          AREA,
          area('Modified grassland', 'Moderate'),
          area('Grassland - Modified grassland', 'Good')
        )
      ).toEqual({ checked: false, reason: UNRECOGNISED_BASELINE })
      expect(
        check(
          HEDGEROW,
          linear('Native hedgerow', '2. Moderate'),
          linear('Native hedgerow', 'Good')
        )
      ).toEqual({ checked: false, reason: UNRECOGNISED_BASELINE })
    })

    it('reports the distinctiveness of both sides', () => {
      expect(
        check(
          HEDGEROW,
          linear('Native hedgerow', 'Moderate'),
          linear('Species-rich native hedgerow', 'Poor')
        )
      ).toEqual({
        checked: true,
        rule: ENHANCEMENT_RULE.LOW_HEDGEROW,
        valid: false,
        allowedByRule: false,
        timeToTarget: 5,
        baselineDistinctiveness: 'Low',
        proposedDistinctiveness: 'Medium'
      })
    })
  })

  describe('when no rule can be checked', () => {
    it.each([
      [
        'a very high area baseline',
        NO_RULE,
        AREA,
        area('Grassland - Lowland meadows', 'Moderate'),
        area('Grassland - Lowland meadows', 'Good')
      ],
      [
        'a high watercourse baseline',
        NO_RULE,
        WATERCOURSE,
        linear('Other rivers and streams', 'Moderate'),
        linear('Other rivers and streams', 'Good')
      ],
      [
        'an unrecognised baseline habitat',
        UNRECOGNISED_BASELINE,
        AREA,
        area('Grassland - Not a habitat', 'Moderate'),
        area('Grassland - Modified grassland', 'Good')
      ],
      [
        'an unrecognised baseline condition',
        UNRECOGNISED_BASELINE,
        HEDGEROW,
        linear('Native hedgerow', 'Excellent'),
        linear('Native hedgerow', 'Good')
      ],
      [
        'a missing baseline side',
        UNRECOGNISED_BASELINE,
        HEDGEROW,
        undefined,
        linear('Native hedgerow', 'Good')
      ],
      [
        'an unrecognised proposed habitat',
        UNRECOGNISED_PROPOSED,
        HEDGEROW,
        linear('Native hedgerow', 'Moderate'),
        linear('Not a hedgerow', 'Good')
      ],
      [
        'an unrecognised proposed condition',
        UNRECOGNISED_PROPOSED,
        AREA,
        area('Grassland - Modified grassland', 'Moderate'),
        area('Grassland - Modified grassland', 'Excellent')
      ],
      [
        'a missing proposed side',
        UNRECOGNISED_PROPOSED,
        WATERCOURSE,
        linear('Culvert', 'Moderate'),
        undefined
      ],
      [
        'a kind with no rules',
        UNRECOGNISED_KIND,
        'tree',
        area('Individual trees - Urban tree', 'Moderate'),
        area('Individual trees - Urban tree', 'Poor')
      ]
    ])('reports %s', (_, reason, kind, baseline, proposed) => {
      expect(check(kind, baseline, proposed)).toEqual({
        checked: false,
        reason
      })
    })
  })
})

describe('enhancementRulesFor', () => {
  it('lists the rules each kind can break', () => {
    expect(enhancementRulesFor(HEDGEROW)).toEqual([
      ENHANCEMENT_RULE.MEDIUM_HEDGEROW,
      ENHANCEMENT_RULE.LOW_HEDGEROW,
      ENHANCEMENT_RULE.VERY_LOW_HEDGEROW
    ])
    expect(enhancementRulesFor(AREA)).toEqual([
      ENHANCEMENT_RULE.MEDIUM_INTERTIDAL_AREA,
      ENHANCEMENT_RULE.MEDIUM_AREA_CONDITION_NA,
      ENHANCEMENT_RULE.MEDIUM_AREA,
      ENHANCEMENT_RULE.LOW_AREA_CONDITION_NA,
      ENHANCEMENT_RULE.LOW_AREA,
      ENHANCEMENT_RULE.VERY_LOW_AREA
    ])
    expect(enhancementRulesFor('tree')).toEqual([])
  })
})
