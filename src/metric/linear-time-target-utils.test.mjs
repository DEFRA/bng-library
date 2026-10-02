import { describe, expect, it } from 'vitest'

import { referenceToTimeToTargetBucketKey } from './linear-time-target-utils.mjs'

const THIRTY_PLUS = '30+'

describe('referenceToTimeToTargetBucketKey', () => {
  it('keeps "30+" as ">30" with no advance or delay (BMD-1040)', () => {
    expect(referenceToTimeToTargetBucketKey(THIRTY_PLUS, 0, 0)).toBe('>30')
  })

  it('counts "30+" down from 30 when advanced', () => {
    expect(referenceToTimeToTargetBucketKey(THIRTY_PLUS, 1, 0)).toBe('29')
    expect(referenceToTimeToTargetBucketKey(THIRTY_PLUS, 30, 0)).toBe('0')
  })

  it('gives ">30" for "30+" when delayed', () => {
    expect(referenceToTimeToTargetBucketKey(THIRTY_PLUS, 0, 1)).toBe('>30')
  })

  it('applies advance and delay to numeric reference years', () => {
    expect(referenceToTimeToTargetBucketKey(10, 0, 0)).toBe('10')
    expect(referenceToTimeToTargetBucketKey(10, 3, 0)).toBe('7')
    expect(referenceToTimeToTargetBucketKey(10, 0, 1)).toBe('11')
    expect(referenceToTimeToTargetBucketKey(30, 0, 0)).toBe('30')
    expect(referenceToTimeToTargetBucketKey(30, 0, 1)).toBe('>30')
  })

  it('throws TypeError for an unexpected reference value', () => {
    expect(() => referenceToTimeToTargetBucketKey('unexpected', 0, 0)).toThrow(
      TypeError
    )
  })
})
