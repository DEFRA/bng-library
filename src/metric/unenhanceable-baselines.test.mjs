import { describe, expect, it, vi } from 'vitest'

import {
  ENHANCEMENT_KIND,
  ENHANCEMENT_NOT_CHECKED_REASON,
  checkEnhancement
} from './enhancement-rules.mjs'
import {
  CONDITION_SCORES,
  HEDGEROW_CONDITION_SCORES,
  WATERCOURSE_CONDITION_SCORES
} from './reference-constants.mjs'
import {
  MVS_ONLY_UNENHANCEABLE_BASELINES,
  UNENHANCEABLE_BASELINE,
  unenhanceableBaseline
} from './unenhanceable-baselines.mjs'

const {
  area: AREA,
  hedgerow: HEDGEROW,
  watercourse: WATERCOURSE
} = ENHANCEMENT_KIND

function baseline(habitat, condition) {
  return { habitat, condition }
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
      .map(([condition]) => baseline(habitat, condition))
  )
}

describe('unenhanceableBaseline', () => {
  describe('AC1: a Medium area habitat in Good condition', () => {
    it.each([
      'Grassland - Other neutral grassland',
      'Heathland and shrub - Hawthorn scrub',
      'Individual trees - Rural tree',
      'Intertidal sediment - Littoral sand',
      'Intertidal hard structures - Artificial hard structures with integrated greening of grey infrastructure (IGGI)',
      'Lakes - Ponds (non-priority habitat)',
      'Woodland and forest - Other woodland; broadleaved'
    ])('cannot enhance %s', (habitat) => {
      expect(unenhanceableBaseline(AREA, baseline(habitat, 'Good'))).toEqual({
        rule: UNENHANCEABLE_BASELINE.MEDIUM_AREA_GOOD,
        mvsOnly: true,
        distinctiveness: 'Medium'
      })
    })

    it.each(['Poor', 'Moderate', 'Fairly Good', 'Condition Assessment N/A'])(
      'can enhance one in %s condition',
      (condition) => {
        expect(
          unenhanceableBaseline(
            AREA,
            baseline('Grassland - Other neutral grassland', condition)
          )
        ).toBeNull()
      }
    )

    it.each([
      ['Low', 'Grassland - Modified grassland'],
      ['Very Low', 'Urban - Developed land; sealed surface'],
      ['High', 'Grassland - Lowland meadows']
    ])('can enhance a %s area habitat in Good condition', (_, habitat) => {
      expect(unenhanceableBaseline(AREA, baseline(habitat, 'Good'))).toBeNull()
    })
  })

  describe('AC2: a Medium hedgerow in Good condition', () => {
    it.each([
      'Ecologically valuable line of trees',
      'Ecologically valuable line of trees - associated with bank or ditch',
      'Native hedgerow - associated with bank or ditch',
      'Native hedgerow with trees',
      'Species-rich native hedgerow'
    ])('cannot enhance %s', (habitat) => {
      expect(
        unenhanceableBaseline(HEDGEROW, baseline(habitat, 'Good'))
      ).toEqual({
        rule: UNENHANCEABLE_BASELINE.MEDIUM_HEDGEROW_GOOD,
        mvsOnly: true,
        distinctiveness: 'Medium'
      })
    })

    it('can enhance one in Moderate condition', () => {
      expect(
        unenhanceableBaseline(
          HEDGEROW,
          baseline('Native hedgerow with trees', 'Moderate')
        )
      ).toBeNull()
    })

    it('can enhance a High hedgerow in Good condition', () => {
      expect(
        unenhanceableBaseline(
          HEDGEROW,
          baseline('Species-rich native hedgerow with trees', 'Good')
        )
      ).toBeNull()
    })
  })

  describe('AC3: a Medium watercourse in Good condition', () => {
    it.each(['Canals', 'Ditches'])('cannot enhance %s', (habitat) => {
      expect(
        unenhanceableBaseline(WATERCOURSE, baseline(habitat, 'Good'))
      ).toEqual({
        rule: UNENHANCEABLE_BASELINE.MEDIUM_WATERCOURSE_GOOD,
        mvsOnly: true,
        distinctiveness: 'Medium'
      })
    })

    it('can enhance one in Moderate condition', () => {
      expect(
        unenhanceableBaseline(WATERCOURSE, baseline('Ditches', 'Moderate'))
      ).toBeNull()
    })

    it('can enhance a culvert in Good condition', () => {
      expect(
        unenhanceableBaseline(WATERCOURSE, baseline('Culvert', 'Good'))
      ).toBeNull()
    })
  })

  describe('AC4: a Very Low hedgerow, in any condition', () => {
    it.each(['Poor', 'Good', 'Condition Assessment N/A', '', undefined])(
      'cannot enhance a Non-native and ornamental hedgerow in condition %j',
      (condition) => {
        expect(
          unenhanceableBaseline(
            HEDGEROW,
            baseline('Non-native and ornamental hedgerow', condition)
          )
        ).toEqual({
          rule: UNENHANCEABLE_BASELINE.VERY_LOW_HEDGEROW,
          mvsOnly: false,
          distinctiveness: 'V.Low'
        })
      }
    )
  })

  describe('AC5: a Low hedgerow in Good condition with no Medium target', () => {
    // The metric's G-6 data gives every Low hedgerow a Medium target, so no
    // real hedgerow breaks this rule; the data is replaced here to show it is
    // read from the data, not from a list.
    it.each(['Native hedgerow', 'Line of trees'])(
      'can enhance %s in Good condition, which can become a Medium hedgerow',
      (habitat) => {
        expect(
          unenhanceableBaseline(HEDGEROW, baseline(habitat, 'Good'))
        ).toBeNull()
      }
    )

    describe('when the data gives a Low hedgerow no Medium target', () => {
      const LINE_OF_TREES_BANK = 'Line of trees - associated with bank or ditch'

      async function withHighTargetsOnly() {
        vi.resetModules()
        vi.doMock('./reference-constants.mjs', async (importOriginal) => {
          const actual = await importOriginal()
          return {
            ...actual,
            HEDGEROW_TIME_TO_TARGET_DISTINCTIVENESS_ENHANCEMENT: {
              ...actual.HEDGEROW_TIME_TO_TARGET_DISTINCTIVENESS_ENHANCEMENT,
              [LINE_OF_TREES_BANK]: {
                'Native hedgerow with trees': 'Not Possible',
                'Native hedgerow with trees - associated with bank or ditch': 12,
                'Line of trees': 'Not Possible'
              }
            }
          }
        })
        const module = await import('./unenhanceable-baselines.mjs')
        vi.doUnmock('./reference-constants.mjs')
        return module
      }

      it('cannot enhance it in Good condition', async () => {
        const module = await withHighTargetsOnly()
        expect(
          module.unenhanceableBaseline(
            HEDGEROW,
            baseline(LINE_OF_TREES_BANK, 'Good')
          )
        ).toEqual({
          rule: module.UNENHANCEABLE_BASELINE
            .LOW_HEDGEROW_GOOD_NO_MEDIUM_TARGET,
          mvsOnly: true,
          distinctiveness: 'Low'
        })
      })

      it('can enhance it in Moderate condition', async () => {
        const module = await withHighTargetsOnly()
        expect(
          module.unenhanceableBaseline(
            HEDGEROW,
            baseline(LINE_OF_TREES_BANK, 'Moderate')
          )
        ).toBeNull()
      })
    })
  })

  describe('a baseline it cannot read', () => {
    it.each([
      ['an unknown kind', 'tree', baseline('Ditches', 'Good')],
      [
        'an unknown habitat',
        AREA,
        baseline('Grassland - Not a grassland', 'Good')
      ],
      [
        "another kind's habitat",
        HEDGEROW,
        baseline('Grassland - Other neutral grassland', 'Good')
      ],
      ['no habitat', AREA, baseline(undefined, 'Good')],
      ['no baseline', AREA, undefined],
      [
        'a condition with its list number',
        AREA,
        baseline('Grassland - Other neutral grassland', '3. Good')
      ]
    ])('is not unenhanceable for %s', (_, kind, side) => {
      expect(unenhanceableBaseline(kind, side)).toBeNull()
    })
  })

  it('marks every rule but the Very Low hedgerow as MVS only', () => {
    expect(
      Object.values(UNENHANCEABLE_BASELINE).filter(
        (rule) => !MVS_ONLY_UNENHANCEABLE_BASELINES.includes(rule)
      )
    ).toEqual([UNENHANCEABLE_BASELINE.VERY_LOW_HEDGEROW])
  })

  /**
   * The rules here hold only because of the enhancement rules' `allows`
   * clauses, which are a separate table. This keeps the two in step: a
   * baseline is unenhanceable exactly when `checkEnhancement` calls no
   * proposed habitat valid for it.
   */
  describe.each([
    { kind: AREA, sides: sidesOf(CONDITION_SCORES) },
    { kind: HEDGEROW, sides: sidesOf(HEDGEROW_CONDITION_SCORES) },
    { kind: WATERCOURSE, sides: sidesOf(WATERCOURSE_CONDITION_SCORES) }
  ])('against checkEnhancement for $kind', ({ kind, sides }) => {
    it('flags a baseline exactly when no enhancement of it is valid', () => {
      const mismatches = []
      let flagged = 0
      for (const side of sides) {
        const checks = sides.map((proposed) =>
          checkEnhancement(kind, side, proposed)
        )
        const noRule = checks.some(
          ({ reason }) => reason === ENHANCEMENT_NOT_CHECKED_REASON.noRule
        )
        const enhanceable = checks.some(({ valid }) => valid)
        const unenhanceable = unenhanceableBaseline(kind, side)
        if (unenhanceable) {
          flagged++
        }
        if (noRule ? unenhanceable : Boolean(unenhanceable) === enhanceable) {
          mismatches.push(
            `${side.habitat} (${side.condition}): ${unenhanceable?.rule ?? 'not flagged'}, ${
              noRule
                ? 'no enhancement rule'
                : `${enhanceable ? 'a' : 'no'} valid enhancement`
            }`
          )
        }
      }
      expect(flagged).toBeGreaterThan(0)
      expect(mismatches).toEqual([])
    })
  })
})
