/**
 * The row overrides a native BNG Service site takes: the legacy generator's
 * keys (see `generateOne`), plus the template-only fields, checked so a
 * mistyped or meaningless key fails loudly instead of being ignored.
 *
 * - `habitatRef` names an area habitat's Habitat Ref (`parcelRef` too).
 * - Strategic significance is `Low` or `High`, or the legacy wording.
 * - An area habitat's `Lost` is a creation in a new broad type, written as
 *   Created; a hedgerow, watercourse or tree that is `Lost` is removed.
 * - A tree's `count` is ignored, with a warning: the template has no Count
 *   column, so each tree point is one tree. How the service should record
 *   several trees at one point is still being decided; until it is, this is
 *   what the format has always done with a count.
 * - `$comment` keys document a row and are ignored.
 */

import { warn } from '../../log.mjs'

const COMMON = [
  'retention',
  'baselineCondition',
  'proposedCondition',
  'baselineStrategicSignificance',
  'proposedStrategicSignificance',
  'advanceYears',
  'delayYears',
  'incomplete',
  'irreplaceable',
  'comment',
  'postInterventionComment'
]
const LINES = ['lengthRange', 'sameLineAs']
const KEYS = {
  habitats: new Set([
    ...COMMON,
    'habitatFullName',
    'proposedHabitatFullName',
    'parcelRef',
    'habitatRef'
  ]),
  hedgerows: new Set([...COMMON, ...LINES, 'hedgeType', 'proposedHedgeType']),
  rivers: new Set([
    ...COMMON,
    ...LINES,
    'riverType',
    'proposedRiverType',
    'baselineWaterEncroachment',
    'baselineRiparianEncroachment',
    'proposedWaterEncroachment',
    'proposedRiparianEncroachment'
  ]),
  trees: new Set([...COMMON, 'treeSize', 'treeType', 'ruralOrUrban', 'count']),
  verticalHabitats: new Set([
    'habitatFullName',
    'retention',
    'baselineCondition',
    'proposedCondition',
    'proposedHabitatFullName',
    'area',
    'comment',
    'postInterventionComment'
  ])
}
const DOC_KEY = '$comment'
const ONE_TREE = 1

function checkRow(layer, row, index) {
  for (const key of Object.keys(row)) {
    if (key !== DOC_KEY && !KEYS[layer].has(key)) {
      throw new Error(
        `${layer} row ${index}: unknown override "${key}" for the BNG Service format`
      )
    }
  }
  if (layer === 'trees' && row.count !== undefined && row.count !== ONE_TREE) {
    warn(
      `  trees row ${index}: count ${row.count} ignored: the BNG Service template has no Count column, so each tree point is one tree`
    )
  }
}

function normaliseRow(layer, row, index) {
  if (!row) {
    return row
  }
  checkRow(layer, row, index)
  if (layer === 'habitats' && row.habitatRef !== undefined) {
    if (row.parcelRef !== undefined && row.parcelRef !== row.habitatRef) {
      throw new Error(
        `habitats row ${index}: habitatRef "${row.habitatRef}" and parcelRef "${row.parcelRef}" differ`
      )
    }
    const { habitatRef, ...rest } = row
    return { ...rest, parcelRef: habitatRef }
  }
  return row
}

/**
 * The overrides with each row checked and `habitatRef` read as `parcelRef`.
 *
 * @param {Record<string, object[]>} overrides  per-layer rows
 * @returns {Record<string, object[]>}
 */
export function normaliseOverrides(overrides = {}) {
  const normalised = {}
  for (const [layer, rows] of Object.entries(overrides)) {
    if (!KEYS[layer]) {
      throw new Error(
        `unknown override layer "${layer}" for the BNG Service format`
      )
    }
    normalised[layer] = (rows ?? []).map((row, index) =>
      normaliseRow(layer, row, index)
    )
  }
  return normalised
}
