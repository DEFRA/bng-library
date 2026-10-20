/**
 * The geometric-flaw fixture as a BNG Service site: the shapes
 * `buildBadState` draws, each feature Retained with the fixed values every
 * bad feature takes, and any IGGI polygon as the vertical area habitat the
 * template maps it as.
 */

import { BAD_VALUES, buildBadState } from '../../synthetic/synthetic-bad.mjs'
import {
  BAD_FIXTURE_SURVEY_DETAILS,
  BASE_MAP,
  MAPPED_BY,
  STRATEGIC_SIGNIFICANCE,
  SURVEY_COMPANY,
  SURVEY_DATE
} from '../../synthetic/synthetic-constants.mjs'
import { syntheticRef } from '../../synthetic/draw/rules.mjs'
import {
  iggiVertical,
  layerFromSources,
  redlineFeature
} from '../site-features.mjs'
import { significance } from '../vocabulary.mjs'

const RETAINED = 'Retained'
const ZERO_YEARS = '0'
const TREE_SETTING = 'Urban'
const LAYER_KEYS = ['habitats', 'hedgerows', 'rivers', 'trees']
const STATE_KEYS = {
  habitats: 'parcels',
  hedgerows: 'hedgerows',
  rivers: 'rivers',
  trees: 'trees'
}
const REF_PREFIXES = { habitats: 'H', hedgerows: 'HG', rivers: 'R', trees: 'T' }

const LOW = significance(STRATEGIC_SIGNIFICANCE[0])
const KEPT = { significance: LOW, advance: ZERO_YEARS, delay: ZERO_YEARS }

function habitatValues() {
  const { habitat } = BAD_VALUES
  const values = {
    broad: habitat.broad,
    type: habitat.type,
    condition: habitat.validConditions[0]
  }
  return { baseline: values, proposed: { ...values, ...KEPT } }
}

function riverValues() {
  const values = {
    type: BAD_VALUES.riverType,
    condition: BAD_VALUES.condition,
    water: BAD_VALUES.waterEncroachment,
    riparian: BAD_VALUES.riparianEncroachment
  }
  return { baseline: values, proposed: { ...values, ...KEPT } }
}

function treeValues() {
  const values = {
    size: BAD_VALUES.treeSize,
    type: BAD_VALUES.treeType,
    setting: TREE_SETTING,
    condition: BAD_VALUES.condition
  }
  return { baseline: values, proposed: { ...values, ...KEPT } }
}

const VALUES = {
  habitats: habitatValues,
  hedgerows: () => {
    const values = {
      type: BAD_VALUES.hedgeType,
      condition: BAD_VALUES.hedgeCondition
    }
    return { baseline: values, proposed: { ...values, ...KEPT } }
  },
  rivers: riverValues,
  trees: treeValues
}

const GEOMETRY = {
  habitats: (ring) => ({ type: 'Polygon', coordinates: [ring] }),
  hedgerows: (coords) => ({ type: 'LineString', coordinates: coords }),
  rivers: (coords) => ({ type: 'LineString', coordinates: coords }),
  trees: ([x, y]) => ({ type: 'Point', coordinates: [x, y] })
}

function badSources(layerKey, shapes) {
  return shapes.map((shape, index) => ({
    index,
    geometry: GEOMETRY[layerKey](shape),
    ref: syntheticRef(REF_PREFIXES[layerKey], index),
    retention: RETAINED,
    comment: null,
    ...VALUES[layerKey]()
  }))
}

function iggiLayer(iggis, options) {
  const layer = { baseline: [], postIntervention: [] }
  iggis.forEach((ring, index) => {
    const { parent, child } = iggiVertical(
      { type: 'Polygon', coordinates: [ring] },
      syntheticRef('I', index),
      index,
      options.uuidFor('verticalHabitats', index)
    )
    layer.baseline.push(parent)
    layer.postIntervention.push(child)
  })
  return layer
}

/**
 * @param {[number, number]} centre
 * @param {string[]} flawNames  geometric flaws
 * @param {{ uuidFor: Function, choose: Function }} options
 */
export function badSite(centre, flawNames, options) {
  const state = buildBadState(centre, flawNames)
  const layers = {}
  for (const layerKey of LAYER_KEYS) {
    layers[layerKey] = layerFromSources(
      layerKey,
      badSources(layerKey, state[STATE_KEYS[layerKey]]),
      options
    )
  }
  layers.verticalHabitats = iggiLayer(state.iggis, options)
  const hasFeature = LAYER_KEYS.some((key) => state[STATE_KEYS[key]].length)
  const survey = hasFeature
    ? {
        'Site Name': BAD_VALUES.siteName,
        'Survey Date': SURVEY_DATE,
        'Survey Details': BAD_FIXTURE_SURVEY_DETAILS,
        'Mapped by': MAPPED_BY,
        Company: SURVEY_COMPANY,
        'Base Map': BASE_MAP
      }
    : {}
  return {
    redline: redlineFeature(
      { type: 'Polygon', coordinates: [state.redline] },
      BAD_VALUES.siteName,
      survey
    ),
    layers
  }
}
