import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AREA,
  HEDGEROW,
  WATERCOURSE,
  baselineConditions,
  canCreate,
  canEnhance,
  creationConditions,
  encroachmentNoWorseThan,
  enhancementPairs
} from '../src/synthetic/valid-draws.mjs'
import {
  IN_SCOPE_HEDGE_TYPES,
  IN_SCOPE_RIVER_TYPES
} from '../src/synthetic/synthetic-constants.mjs'
import { readTemplateVocabulary } from '../src/workbook-writer/index.mjs'

const NEUTRAL = 'Grassland - Other neutral grassland'
const SEALED = 'Urban - Developed land; sealed surface'
const NON_NATIVE = 'Non-native and ornamental hedgerow'

describe('valid draws', () => {
  it('only offers conditions the metric scores', () => {
    expect(baselineConditions(AREA, SEALED)).toEqual(['N/A - Other'])
    expect(baselineConditions(WATERCOURSE, 'Culvert')).toEqual(['Poor'])
  })

  it("follows the metric's narrower list for a non-native hedgerow", () => {
    expect(baselineConditions(HEDGEROW, NON_NATIVE)).toEqual(['Poor'])
  })

  it('only creates in conditions the metric can create', () => {
    expect(creationConditions(AREA, SEALED)).toEqual(['N/A - Other'])
    expect(creationConditions(HEDGEROW, NON_NATIVE)).toEqual(['Poor'])
    expect(canCreate(AREA, NEUTRAL)).toBe(true)
  })

  it('only enhances upwards, to a condition the metric can reach', () => {
    const pairs = enhancementPairs(AREA, NEUTRAL)
    expect(pairs).toContainEqual(['Moderate', 'Good'])
    expect(pairs).not.toContainEqual(['Good', 'Moderate'])
    expect(pairs).not.toContainEqual(['Moderate', 'Moderate'])
  })

  it('never enhances a culvert or a non-native hedgerow', () => {
    expect(canEnhance(WATERCOURSE, 'Culvert')).toBe(false)
    expect(canEnhance(HEDGEROW, NON_NATIVE)).toBe(false)
    expect(canEnhance(WATERCOURSE, 'Ditches')).toBe(true)
  })

  it('never worsens encroachment', () => {
    expect(
      encroachmentNoWorseThan(
        'water',
        ['No Encroachment', 'Minor', 'Major'],
        'Minor'
      )
    ).toEqual(['No Encroachment', 'Minor'])
    expect(
      encroachmentNoWorseThan(
        'riparian',
        ['Major/Major', 'Minor/Minor', 'No Encroachment/No Encroachment'],
        'Minor/Minor'
      )
    ).toEqual(['Minor/Minor', 'No Encroachment/No Encroachment'])
  })
})

const TEMPLATE = process.env.METRIC_TEMPLATE
const hasTemplate = Boolean(TEMPLATE) && existsSync(TEMPLATE)

describe.skipIf(!hasTemplate)('valid draws — real metric template', () => {
  const vocabulary = hasTemplate
    ? readTemplateVocabulary(readFileSync(TEMPLATE))
    : null

  it.each(IN_SCOPE_HEDGE_TYPES)(
    'offers only conditions the workbook lists for %s',
    (type) => {
      expect(vocabulary.hedgeConditions[type]).toEqual(
        expect.arrayContaining(baselineConditions(HEDGEROW, type))
      )
    }
  )

  it.each(IN_SCOPE_RIVER_TYPES)(
    'offers only conditions the workbook lists for %s',
    (type) => {
      expect(vocabulary.watercourseConditions[type]).toEqual(
        expect.arrayContaining(baselineConditions(WATERCOURSE, type))
      )
    }
  )

  it('enhances only watercourse types the enhancement sheet offers', () => {
    const enhanceable = IN_SCOPE_RIVER_TYPES.filter((type) =>
      canEnhance(WATERCOURSE, type)
    )
    expect(vocabulary.enhanceableWatercourseTypes).toEqual(
      expect.arrayContaining(enhanceable)
    )
  })
})
