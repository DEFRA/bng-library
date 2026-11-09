/**
 * A tree's Native or Non-native type, from a legacy source (BMD-1175). A
 * source that names one keeps it. A source that does not, or that holds an
 * older word such as "Street tree", draws one: Native below 0.8. The draw is
 * made for every tree either way, so what a source says does not move what
 * the rest of the site draws.
 */
import { describe, expect, it } from 'vitest'

import { HABITAT_REF } from '../src/bng-service/schema.mjs'
import { layerFromSources } from '../src/bng-service/site-features.mjs'

const POINT = { type: 'Point', coordinates: [0, 0] }

/** A chooser that returns `draws` in turn and counts its calls. */
function scripted(draws) {
  const chooser = () => {
    if (chooser.calls >= draws.length) {
      throw new Error('more draws than the test scripted')
    }
    return draws[chooser.calls++]
  }
  chooser.calls = 0
  return chooser
}

function tree(index, retention, type) {
  const stage = {
    size: 'Small',
    type,
    setting: 'Urban',
    condition: 'Moderate',
    significance: 'Low'
  }
  return {
    index,
    geometry: POINT,
    ref: `T${index}`,
    retention,
    comment: null,
    baseline: retention === 'Created' ? {} : stage,
    proposed: stage
  }
}

/** Each tree's type, by ref: baseline's for a kept tree, else proposed's. */
function treeTypes(sources, draws) {
  const choose = scripted(draws)
  const layer = layerFromSources('trees', sources, {
    uuidFor: (layerKey, index) => `${layerKey}-${index}`,
    choose
  })
  const types = {}
  for (const { values } of layer.baseline) {
    types[values[HABITAT_REF]] = values['Baseline Tree Type']
  }
  for (const { values, parent } of layer.postIntervention) {
    if (!parent) {
      types[values[HABITAT_REF]] = values['Proposed Tree Type']
    }
  }
  return { types, layer, calls: choose.calls }
}

// One draw per tree, in source order.
const DRAWS = [0.1, 0.9, 0.79, 0.8, 0.95, 0.2, 0.5]

function mixedSources({ first, fourth }) {
  return [
    tree(0, 'Retained', first),
    tree(1, 'Retained', 'Street tree'),
    tree(2, 'Lost', null),
    tree(3, 'Retained', undefined),
    tree(4, 'Retained', fourth),
    tree(5, 'Created', 'Street tree'),
    tree(6, 'Created', undefined)
  ]
}

describe('a legacy tree’s type', () => {
  it('keeps an explicit type and draws the rest, Native below 0.8', () => {
    const { types, layer, calls } = treeTypes(
      mixedSources({ first: 'Non-native', fourth: 'Native' }),
      DRAWS
    )
    expect(types).toEqual({
      // explicit, though its draw (0.1) would be Native
      T0: 'Non-native',
      // "Street tree" is no template word: drawn 0.9
      T1: 'Non-native',
      // blank: drawn 0.79, just under the threshold
      T2: 'Native',
      // missing: drawn 0.8, on the threshold
      T3: 'Non-native',
      // explicit, though its draw (0.95) would be Non-native
      T4: 'Native',
      // a created tree's "Street tree": drawn 0.2
      T5: 'Native',
      // a created tree with no type: drawn 0.5
      T6: 'Native'
    })
    expect(calls).toBe(DRAWS.length)
    // A kept tree keeps its type after the intervention.
    for (const { values, parent } of layer.postIntervention) {
      if (parent) {
        expect(values['Proposed Tree Type']).toBe(
          parent.values['Baseline Tree Type']
        )
      }
    }
  })

  it('draws the same for the other trees whatever the explicit types say', () => {
    const explicit = treeTypes(
      mixedSources({ first: 'Non-native', fourth: 'Native' }),
      DRAWS
    )
    const swapped = treeTypes(
      mixedSources({ first: 'Native', fourth: 'Non-native' }),
      DRAWS
    )
    const fallback = treeTypes(
      mixedSources({ first: 'Street tree', fourth: null }),
      DRAWS
    )
    const others = ({ types }) => {
      const { T0, T4, ...rest } = types
      return rest
    }
    expect(others(swapped)).toEqual(others(explicit))
    expect(others(fallback)).toEqual(others(explicit))
    expect(swapped.types).toMatchObject({ T0: 'Native', T4: 'Non-native' })
    // With no explicit type, the two take their own draws: 0.1 and 0.95.
    expect(fallback.types).toMatchObject({ T0: 'Native', T4: 'Non-native' })
    expect(swapped.calls).toBe(DRAWS.length)
    expect(fallback.calls).toBe(DRAWS.length)
  })
})
