/**
 * A drawn workbook site (`drawBaselineGeometry` and
 * `drawPostInterventionGeometry` in `orchestration.mjs`) as the BNG Service
 * site model. Each feature becomes a feature source with the values the
 * workbook gives it, and the stages are paired as the template's tools pair
 * them (`pair.mjs`): no legacy file is written.
 */

import { gpkgAreaRetention } from '../../retention.mjs'
import {
  CULVERT_ENCROACHMENT,
  CULVERT_TYPE
} from '../../data/watercourse-encroachment.mjs'
import {
  BASE_MAP,
  RURAL_OR_URBAN_TREE_URBAN,
  SITE_NAME,
  SURVEY_DATE,
  WORKBOOK_IMPORT_LABEL,
  WORKBOOK_SURVEY_DETAILS
} from '../../workbook/workbook-layers-shared.mjs'
import { pairedLayer } from '../pair.mjs'
import { redlineFeature, text } from '../site-features.mjs'
import { withoutListNumber } from '../vocabulary.mjs'

const RIVER_ENCROACHMENT_NONE = 'No Encroachment'
const RIVER_ENCROACHMENT_RIPARIAN_NONE = 'No Encroachment/No Encroachment'
const LAYER_LABELS = {
  habitats: 'Area Habitats',
  hedgerows: 'Hedgerows',
  rivers: 'Watercourses',
  trees: 'Individual Trees'
}

const polygon = (ring) => ({ type: 'Polygon', coordinates: [ring] })
const line = (coords) => ({ type: 'LineString', coordinates: coords })
const point = ([x, y]) => ({ type: 'Point', coordinates: [x, y] })
const years = (value) => String(value ?? 0)

/** Sources for the features that were placed, indexed in placing order. */
function placed(items, toSource) {
  const sources = []
  for (const item of items) {
    const source = toSource(item)
    if (source) {
      sources.push({ index: sources.length, comment: null, ...source })
    }
  }
  return sources
}

function proposedSide(proposed) {
  return {
    condition: withoutListNumber(proposed.condition),
    significance: proposed.strategicSig,
    advance: years(proposed.advanceYears),
    delay: years(proposed.delayYears)
  }
}

// ------------------------------------------------------------- baseline

function habitatBaselines(rows, cells) {
  return placed(
    rows.map((row, i) => [row, cells[i]]),
    ([row, cell]) =>
      cell && {
        geometry: polygon(cell),
        ref: text(row.ref),
        retention: null,
        baseline: {
          broad: row.broad,
          type: withoutListNumber(row.type),
          condition: withoutListNumber(row.condition)
        }
      }
  )
}

// A culvert's encroachment is the culvert category when the workbook
// leaves it blank.
function baselineEncroachment(row) {
  const culvert = row.type === CULVERT_TYPE ? CULVERT_ENCROACHMENT : null
  return {
    water: row.waterEncroachment ?? culvert,
    riparian: row.riparianEncroachment ?? culvert
  }
}

function lineBaselines(rows, coordsList, withEncroachment) {
  return placed(
    rows.map((row, i) => [row, coordsList[i]]),
    ([row, coords]) =>
      coords && {
        geometry: line(coords),
        ref: text(row.ref),
        retention: null,
        baseline: {
          type: row.type,
          condition: withoutListNumber(row.condition),
          ...(withEncroachment ? baselineEncroachment(row) : {})
        }
      }
  )
}

function treeBaselines(rows, instances) {
  return placed(
    instances,
    (instance) =>
      instance.point && {
        geometry: point(instance.point),
        ref: text(instance.subRef),
        retention: null,
        baseline: {
          size: instance.band,
          type: rows[instance.rowIndex].type,
          setting: RURAL_OR_URBAN_TREE_URBAN,
          condition: withoutListNumber(rows[instance.rowIndex].condition)
        }
      }
  )
}

// ---------------------------------------------------- post-intervention

function habitatPosts(rows, cells) {
  return placed(
    rows.map((row, i) => [row, cells[i]]),
    ([row, cell]) =>
      cell && {
        geometry: polygon(cell),
        ref: text(row.ref),
        retention: gpkgAreaRetention(row.retention),
        proposed: {
          broad: row.proposed.broad,
          type: withoutListNumber(row.proposed.type),
          ...proposedSide(row.proposed)
        }
      }
  )
}

// A culvert's proposed encroachment is the culvert category; otherwise the
// workbook's, or none.
function proposedEncroachment(proposed) {
  if (proposed.type === CULVERT_TYPE) {
    return { water: CULVERT_ENCROACHMENT, riparian: CULVERT_ENCROACHMENT }
  }
  return {
    water: proposed.waterEncroachment ?? RIVER_ENCROACHMENT_NONE,
    riparian: proposed.riparianEncroachment ?? RIVER_ENCROACHMENT_RIPARIAN_NONE
  }
}

function linePosts(rows, coordsList, withEncroachment) {
  return placed(
    rows.map((row, i) => [row, coordsList[i]]),
    ([row, coords]) =>
      coords && {
        geometry: line(coords),
        ref: text(row.ref),
        retention: row.retention,
        proposed: {
          type: row.proposed.type,
          ...proposedSide(row.proposed),
          ...(withEncroachment ? proposedEncroachment(row.proposed) : {})
        }
      }
  )
}

function treePosts(rows, instances) {
  return placed(instances, (instance) => {
    const row = rows[instance.rowIndex]
    return (
      instance.point && {
        geometry: point(instance.point),
        ref: text(instance.subRef),
        retention: row.retention,
        proposed: {
          size: instance.proposedBand,
          type: row.proposed.type,
          setting: RURAL_OR_URBAN_TREE_URBAN,
          ...proposedSide(row.proposed)
        }
      }
    )
  })
}

// ------------------------------------------------------------------ site

const SURVEY = {
  'Site Name': SITE_NAME,
  'Survey Date': SURVEY_DATE,
  'Survey Details': WORKBOOK_SURVEY_DETAILS,
  'Mapped by': WORKBOOK_IMPORT_LABEL,
  Company: WORKBOOK_IMPORT_LABEL,
  'Base Map': BASE_MAP
}

/**
 * @param {object} drawn  `{ baselineRows, postRows, baseline, post }`, the
 *   rows and geometry the workbook route draws; `postRows` and `post` are
 *   null for a baseline-stage site
 * @param {{ uuidFor: Function, choose: Function }} options
 */
export function siteFromWorkbookDraw(drawn, options) {
  const { baselineRows, postRows, baseline, post } = drawn
  const baselines = {
    habitats: habitatBaselines(baselineRows.habitats, baseline.habitatCells),
    hedgerows: lineBaselines(
      baselineRows.hedgerows,
      baseline.hedgeCoords,
      false
    ),
    rivers: lineBaselines(baselineRows.rivers, baseline.riverCoords, true),
    trees: treeBaselines(baselineRows.trees, baseline.treeInstances)
  }
  const posts = post
    ? {
        habitats: habitatPosts(post.habitatRows, post.habitatCells),
        hedgerows: linePosts(postRows.hedgerows, post.hedgeCoords, false),
        rivers: linePosts(postRows.rivers, post.riverCoords, true),
        trees: treePosts(postRows.trees, post.treeInstances)
      }
    : {}
  const layers = {}
  for (const [layerKey, label] of Object.entries(LAYER_LABELS)) {
    layers[layerKey] = pairedLayer(
      layerKey,
      baselines[layerKey],
      posts[layerKey] ?? [],
      options,
      label
    )
  }
  layers.verticalHabitats = { baseline: [], postIntervention: [] }
  const anyBaseline = Object.values(baselines).some((s) => s.length > 0)
  return {
    redline: redlineFeature(
      polygon(baseline.ring),
      SITE_NAME,
      anyBaseline ? SURVEY : {}
    ),
    layers
  }
}
