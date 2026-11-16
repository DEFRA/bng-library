/**
 * The Metric's middle strategic significance, "Location ecologically
 * desirable but not in local strategy" (Medium), has no place in the BNG
 * Service template. A source that holds it, such as a Metric workbook filled
 * in before a Local Nature Recovery Strategy was published, is written as
 * Low with a warning: left blank, the service would price it at zero.
 */
import { describe, expect, it } from 'vitest'

import { captureMessages } from '../src/log.mjs'
import { HABITAT_REF } from '../src/bng-service/schema.mjs'
import { layerFromSources } from '../src/bng-service/site-features.mjs'
import {
  MEDIUM_SIGNIFICANCE,
  proposedSignificanceOf
} from '../src/bng-service/vocabulary.mjs'

const SQUARE = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0]
    ]
  ]
}

function parcel(index, significance) {
  return {
    index,
    geometry: SQUARE,
    ref: `P${index}`,
    retention: 'Enhanced',
    comment: null,
    baseline: {
      broad: 'Grassland',
      type: 'Modified grassland',
      condition: 'Poor'
    },
    proposed: {
      broad: 'Grassland',
      type: 'Modified grassland',
      condition: 'Moderate',
      significance,
      advance: '0',
      delay: '0'
    }
  }
}

function proposedSignificances(sources) {
  const { result, messages } = captureMessages(() =>
    layerFromSources('habitats', sources, {
      uuidFor: (layerKey, index) => `${layerKey}-${index}`,
      choose: () => 0
    })
  )
  const byRef = {}
  for (const { values } of result.postIntervention) {
    byRef[values[HABITAT_REF]] = values['Proposed Strategic Significance']
  }
  return { byRef, messages }
}

describe('a proposed Medium strategic significance', () => {
  it('is written as Low, and the other wordings keep their own value', () => {
    const { byRef } = proposedSignificances([
      parcel(0, MEDIUM_SIGNIFICANCE),
      parcel(1, `2. ${MEDIUM_SIGNIFICANCE}`),
      parcel(2, 'Formally identified in local strategy'),
      parcel(3, 'Area/compensation not in local strategy/ no local strategy')
    ])
    expect(byRef).toEqual({ P0: 'Low', P1: 'Low', P2: 'High', P3: 'Low' })
  })

  it('warns once for each row it changes, naming the layer and the row', () => {
    const { messages } = proposedSignificances([
      parcel(0, MEDIUM_SIGNIFICANCE),
      parcel(1, 'Formally identified in local strategy')
    ])
    const warnings = messages.filter(
      (m) => m.level === 'warn' && m.message.includes(MEDIUM_SIGNIFICANCE)
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toMatch(/^\s*habitats P0: .*written as Low/)
  })
})

describe('proposedSignificanceOf', () => {
  it('substitutes Low for Medium, and keeps the other wordings', () => {
    expect(proposedSignificanceOf(`2. ${MEDIUM_SIGNIFICANCE}`)).toEqual({
      value: 'Low',
      substituted: true
    })
    expect(
      proposedSignificanceOf('Formally identified in local strategy')
    ).toEqual({ value: 'High', substituted: false })
    expect(proposedSignificanceOf(null)).toEqual({
      value: null,
      substituted: false
    })
  })
})
