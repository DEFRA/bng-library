/**
 * A drawn synthetic site (`synthetic/draw/site.mjs`) as the BNG Service site
 * model: each drawn feature becomes a feature source for
 * `site-features.mjs`, which applies the template's rules.
 */

import { significance } from '../vocabulary.mjs'
import { layerFromSources, redlineFeature, text } from '../site-features.mjs'
import {
  BASE_MAP,
  MAPPED_BY,
  SITE_NAME,
  SURVEY_COMPANY,
  SURVEY_DATE
} from '../../synthetic/synthetic-constants.mjs'

/** What each layer's survey records, as the synthetic generators fill it. */
const SURVEY_DETAILS = {
  habitats: 'Phase 1 habitat survey',
  hedgerows: 'Hedgerow survey',
  rivers: 'River corridor survey',
  trees: 'Tree survey'
}
const LAYER_KEYS = ['habitats', 'hedgerows', 'rivers', 'trees']

const polygon = (ring) => ({ type: 'Polygon', coordinates: [ring] })
const line = (coords) => ({ type: 'LineString', coordinates: coords })
const point = ([x, y]) => ({ type: 'Point', coordinates: [x, y] })

function timing(feature) {
  return { advance: feature.advanceYears, delay: feature.delayYears }
}

function proposedSide(feature) {
  return {
    condition: feature.proposedCondition,
    significance: significance(feature.proposedSignificance),
    ...timing(feature)
  }
}

const SOURCES = {
  habitats: (parcel) => ({
    geometry: polygon(parcel.ring),
    baseline: {
      broad: parcel.baseline.broad,
      type: parcel.baseline.type,
      condition: parcel.baselineCondition
    },
    proposed: {
      broad: parcel.proposed.broad,
      type: parcel.proposed.type,
      ...proposedSide(parcel)
    }
  }),
  hedgerows: (hedge) => ({
    geometry: line(hedge.coords),
    baseline: { type: hedge.type, condition: hedge.baselineCondition },
    proposed: { type: hedge.proposedType, ...proposedSide(hedge) }
  }),
  rivers: (river) => ({
    geometry: line(river.coords),
    baseline: {
      type: river.type,
      condition: river.baselineCondition,
      water: river.baselineEncroachment.water,
      riparian: river.baselineEncroachment.riparian
    },
    proposed: {
      type: river.proposedType,
      water: river.proposedEncroachment.water,
      riparian: river.proposedEncroachment.riparian,
      ...proposedSide(river)
    }
  }),
  trees: (tree) => ({
    geometry: point(tree.point),
    baseline: {
      size: tree.size,
      type: tree.type,
      setting: tree.ruralOrUrban,
      condition: tree.baselineCondition
    },
    proposed: {
      size: tree.proposedSize,
      type: tree.proposedType,
      setting: tree.ruralOrUrban,
      ...proposedSide(tree)
    }
  })
}

/** A drawn feature as a feature source. */
function drawnSource(layerKey, feature, index) {
  return {
    index,
    ref: text(feature.ref),
    retention: feature.retention,
    comment: null,
    ...SOURCES[layerKey](feature)
  }
}

/** The survey details, from the first layer that has a feature. */
function survey(drawn) {
  const layerKey = LAYER_KEYS.find((key) => drawn[key]?.length > 0)
  if (!layerKey) {
    return {}
  }
  return {
    'Site Name': SITE_NAME,
    'Survey Date': SURVEY_DATE,
    'Survey Details': SURVEY_DETAILS[layerKey],
    'Mapped by': MAPPED_BY,
    Company: SURVEY_COMPANY,
    'Base Map': BASE_MAP
  }
}

/**
 * @param {object} drawn  `drawSite`'s result
 * @param {{ uuidFor: Function, choose: Function }} options
 */
export function siteFromDraw(drawn, options) {
  const layers = {}
  for (const layerKey of LAYER_KEYS) {
    const sources = (drawn[layerKey] ?? []).map((feature, index) =>
      drawnSource(layerKey, feature, index)
    )
    layers[layerKey] = layerFromSources(layerKey, sources, options)
  }
  layers.verticalHabitats = { baseline: [], postIntervention: [] }
  return {
    redline: redlineFeature(polygon(drawn.ring), SITE_NAME, survey(drawn)),
    layers
  }
}
