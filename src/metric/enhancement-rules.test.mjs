import { describe, expect, it } from 'vitest'

import {
  ENHANCEMENT_KIND,
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
  it.each(valid)('allows %s', (_, proposed) => {
    expect(check(kind, baseline, proposed)).toMatchObject({
      rule,
      valid: true
    })
  })
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
            'a medium habitat of another broad habitat',
            area('Woodland and forest - Other woodland; mixed', 'Good')
          ]
        ],
        invalid: [
          [
            'a medium habitat in Poor condition',
            area('Heathland and shrub - Mixed scrub', 'Poor')
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
            area('Heathland and shrub - Bramble scrub', CA_NA)
          ]
        ],
        invalid: [
          [
            'the same condition',
            area('Grassland - Modified grassland', 'Moderate')
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
            'a low habitat in Fairly Poor condition',
            area('Grassland - Modified grassland', 'Fairly Poor')
          ],
          [
            'a medium habitat in Good condition',
            area('Grassland - Other neutral grassland', 'Good')
          ]
        ],
        invalid: [
          [
            'a low habitat in Poor condition',
            area('Grassland - Modified grassland', 'Poor')
          ],
          [
            'a low habitat whose condition cannot be assessed',
            area('Cropland - Winter stubble', CA_NA)
          ],
          [
            'a medium habitat whose condition cannot be assessed',
            area('Cropland - Arable field margins tussocky', CA_NA)
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
        valid: [
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
        ],
        invalid: [
          [
            'a very low hedgerow in the same condition',
            linear('Non-native and ornamental hedgerow', 'Moderate')
          ],
          [
            'a low hedgerow in worse condition',
            linear('Native hedgerow', 'Poor')
          ],
          [
            'a medium hedgerow in worse condition',
            linear('Species-rich native hedgerow', 'Poor')
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
      linear('Culvert', 'Moderate'),
      ENHANCEMENT_RULE.LOW_WATERCOURSE,
      {
        valid: [
          ['a culvert in the same condition', linear('Culvert', 'Moderate')],
          ['a culvert in better condition', linear('Culvert', 'Good')],
          ['a medium watercourse in any condition', linear('Ditches', 'Poor')]
        ],
        invalid: [['a culvert in worse condition', linear('Culvert', 'Poor')]]
      }
    )
  })

  describe('reading the attributes', () => {
    it('matches labels exactly, as the reference tables key them', () => {
      expect(
        check(
          WATERCOURSE,
          linear('Ditches', 'Moderate'),
          linear('ditches', 'Good')
        )
      ).toBeNull()
      expect(
        check(
          AREA,
          area('Modified grassland', 'Moderate'),
          area('Grassland - Modified grassland', 'Good')
        )
      ).toBeNull()
      expect(
        check(
          HEDGEROW,
          linear('Native hedgerow', '2. Moderate'),
          linear('Native hedgerow', 'Good')
        )
      ).toBeNull()
    })

    it('reports the distinctiveness of both sides', () => {
      expect(
        check(
          HEDGEROW,
          linear('Native hedgerow', 'Moderate'),
          linear('Species-rich native hedgerow', 'Poor')
        )
      ).toEqual({
        rule: ENHANCEMENT_RULE.LOW_HEDGEROW,
        valid: false,
        baselineDistinctiveness: 'Low',
        proposedDistinctiveness: 'Medium'
      })
    })
  })

  describe('when no rule can be checked', () => {
    it.each([
      [
        'a very low area baseline',
        AREA,
        area('Urban - Developed land; sealed surface', 'N/A - Other'),
        area('Grassland - Modified grassland', 'Good')
      ],
      [
        'a high watercourse baseline',
        WATERCOURSE,
        linear('Other rivers and streams', 'Moderate'),
        linear('Other rivers and streams', 'Good')
      ],
      [
        'an unrecognised baseline habitat',
        AREA,
        area('Grassland - Not a habitat', 'Moderate'),
        area('Grassland - Modified grassland', 'Good')
      ],
      [
        'an unrecognised proposed habitat',
        HEDGEROW,
        linear('Native hedgerow', 'Moderate'),
        linear('Not a hedgerow', 'Good')
      ],
      [
        'an unrecognised condition',
        AREA,
        area('Grassland - Modified grassland', 'Moderate'),
        area('Grassland - Modified grassland', 'Excellent')
      ],
      [
        'a missing proposed side',
        WATERCOURSE,
        linear('Culvert', 'Moderate'),
        undefined
      ],
      [
        'a kind with no rules',
        'tree',
        area('Individual trees - Urban tree', 'Moderate'),
        area('Individual trees - Urban tree', 'Poor')
      ]
    ])('returns null for %s', (_, kind, baseline, proposed) => {
      expect(check(kind, baseline, proposed)).toBeNull()
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
    expect(enhancementRulesFor('tree')).toEqual([])
  })
})
