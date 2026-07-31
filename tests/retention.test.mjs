import { describe, expect, it } from 'vitest'
import {
  baselineLinearAttribute,
  baselineLinearType,
  gpkgAreaRetention,
  treeCategory
} from '../src/retention.mjs'

// The NE template splits the retention vocabulary by layer type: area habitats
// have three values and carry creation on a Lost row, while hedgerows,
// watercourses and individual trees have a fourth value, "Created", paired with
// placeholder baseline columns. See docs/ne-template-linear-retention.md in
// bng-metric-harness for the template evidence.
describe('gpkgAreaRetention', () => {
  it('carries an area habitat creation on a Lost row', () => {
    expect(gpkgAreaRetention('Created')).toBe('Lost')
  })

  it('passes the other three area values through unchanged', () => {
    expect(gpkgAreaRetention('Retained')).toBe('Retained')
    expect(gpkgAreaRetention('Enhanced')).toBe('Enhanced')
    expect(gpkgAreaRetention('Lost')).toBe('Lost')
  })
})

describe('baselineLinearType', () => {
  it('substitutes the template placeholder type for a created feature', () => {
    expect(baselineLinearType('Created', 'Native hedgerow')).toBe(
      'To be created'
    )
  })

  it('keeps the real baseline type for every other retention', () => {
    expect(baselineLinearType('Retained', 'Native hedgerow')).toBe(
      'Native hedgerow'
    )
    expect(baselineLinearType('Enhanced', 'Canals')).toBe('Canals')
    expect(baselineLinearType('Lost', 'Ditches')).toBe('Ditches')
  })

  it('normalises a missing baseline type to null', () => {
    expect(baselineLinearType('Retained', undefined)).toBeNull()
  })
})

describe('baselineLinearAttribute', () => {
  it('substitutes N/A for a created feature', () => {
    expect(baselineLinearAttribute('Created', 'Good')).toBe('N/A')
    expect(baselineLinearAttribute('Created', 'Medium')).toBe('N/A')
  })

  it('substitutes N/A even when the caller already resolved a default', () => {
    // Watercourse encroachment resolves to "No Encroachment" before this call;
    // a created watercourse has no baseline to encroach on.
    expect(baselineLinearAttribute('Created', 'No Encroachment')).toBe('N/A')
  })

  it('keeps the real value for every other retention', () => {
    expect(baselineLinearAttribute('Retained', 'Good')).toBe('Good')
    expect(baselineLinearAttribute('Enhanced', 'Poor')).toBe('Poor')
    expect(baselineLinearAttribute('Lost', 'Moderate')).toBe('Moderate')
  })

  it('normalises a missing value to null', () => {
    expect(baselineLinearAttribute('Retained', undefined)).toBeNull()
    expect(baselineLinearAttribute('Lost', null)).toBeNull()
  })
})

describe('treeCategory', () => {
  it('marks a created tree Newly Planted', () => {
    expect(treeCategory('Created')).toBe('Newly Planted')
  })

  it('marks every other tree Existing', () => {
    expect(treeCategory('Retained')).toBe('Existing')
    expect(treeCategory('Enhanced')).toBe('Existing')
    expect(treeCategory('Lost')).toBe('Existing')
  })
})
