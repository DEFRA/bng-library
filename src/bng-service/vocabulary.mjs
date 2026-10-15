/**
 * The BNG Service template's words for what the legacy Natural England
 * template, and the generators that write it, spell differently.
 *
 * The template stores the Metric's words alone, with no list numbers;
 * strategic significance as Low or High; a tree's setting as "Urban tree" or
 * "Rural tree"; and riparian encroachment with the template's own spacing.
 * Every value here is looked up in the template's lists, never restated.
 */

import { listIndex, listLookup, referenceList } from './reference.mjs'

export const LOW = 'Low'
export const HIGH = 'High'
export const NOT_APPLICABLE = 'N/A'
export const TO_BE_CREATED = 'To be created'
export const YES = 'Yes'
export const NO = 'No'

// The legacy wordings of strategic significance, as the plugin translates
// them (the template's plugin/README.md). "Location ecologically desirable
// but not in local strategy" has no place in the template: it applies only
// before a Local Nature Recovery Strategy is published.
const SIGNIFICANCE = new Map([
  ['Area/compensation not in local strategy/ no local strategy', LOW],
  ['Formally identified in local strategy', HIGH],
  ['Within area formally identified in local strategy', HIGH],
  [LOW, LOW],
  [HIGH, HIGH]
])

const LIST_NUMBER = /^\d+\.\s+/

/** A value without the legacy list number: "4. Fairly Poor" → "Fairly Poor". */
export function withoutListNumber(value) {
  return typeof value === 'string' ? value.replace(LIST_NUMBER, '') : value
}

/**
 * A strategic significance as the template stores it: Low or High, or null
 * for a wording the template has no place for.
 */
export function significance(value) {
  if (value === null || value === undefined) {
    return null
  }
  return SIGNIFICANCE.get(withoutListNumber(value)) ?? null
}

const TREE_SETTING = { Urban: 'Urban tree', Rural: 'Rural tree' }

/** A tree's setting: "Urban" → "Urban tree". */
export function treeSetting(value) {
  return TREE_SETTING[value] ?? value ?? null
}

/** The metric's area habitat name for a tree of this setting. */
export function treeHabitatName(setting) {
  return `Individual trees - ${setting}`
}

const squash = (value) => value.replaceAll(/\s+/g, '')

let riparianLabels = null

/**
 * A riparian encroachment as the template's list spells it for this river
 * type: "Minor/No Encroachment" → "Minor/ No Encroachment".
 */
export function riparianEncroachment(riverType, value) {
  if (value === null || value === undefined) {
    return null
  }
  riparianLabels ??= listIndex(
    'Watercourses/Riparian Encroachment.csv',
    'Value',
    'Label'
  )
  const labels = riparianLabels.get(riverType) ?? new Set()
  return [...labels].find((label) => squash(label) === squash(value)) ?? value
}

let lookups = null

function tables() {
  lookups ??= {
    areaPre: listLookup(
      'Habitats/Habitat Distinctiveness- pre.csv',
      'Habitat',
      'Baseline Distinctivness'
    ),
    areaPost: listLookup(
      'Habitats/Habitat Distinctiveness- post.csv',
      'Habitat',
      'Proposed Distinctivness'
    ),
    verticalPre: listLookup(
      'Vertical Area Habitats/Vertical Area Habitat Distinctiveness- pre.csv',
      'Habitat',
      'Baseline Distinctivness'
    ),
    verticalPost: listLookup(
      'Vertical Area Habitats/Vertical Area Habitat Distinctiveness- post.csv',
      'Habitat',
      'Proposed Distinctivness'
    ),
    hedgePre: listLookup(
      'Hedgerows/Hedgerow Distinctiveness- pre.csv',
      'Value',
      'Distinctiveness'
    ),
    hedgePost: listLookup(
      'Hedgerows/Hedgerow Distinctiveness - post.csv',
      'Value',
      'Distinctiveness'
    ),
    riverPre: listLookup(
      'Watercourses/Watercourse Distinctiveness- pre.csv',
      'Value',
      'Distinctiveness'
    ),
    riverPost: listLookup(
      'Watercourses/Watercourse Distinctiveness- post.csv',
      'Value',
      'Distinctiveness'
    ),
    irreplaceable: listIndex(
      'Habitats/Habitat Irreplaceable.csv',
      'UKHAB',
      'Irreplaceable'
    ),
    verticalHabitats: referenceList(
      'Vertical Area Habitats/Vertical Area Habitat Options- pre.csv'
    ),
    areaHabitatsPre: referenceList('Habitats/Habitat Options- pre.csv'),
    areaHabitatsPost: referenceList('Habitats/Habitat Options- post.csv')
  }
  return lookups
}

const DISTINCTIVENESS = {
  habitats: ['areaPre', 'areaPost'],
  verticalHabitats: ['verticalPre', 'verticalPost'],
  hedgerows: ['hedgePre', 'hedgePost'],
  rivers: ['riverPre', 'riverPost']
}

/** The distinctiveness the template fills in for a type, or null. */
export function distinctiveness(layerKey, type, proposed = false) {
  if (!type) {
    return null
  }
  const list = DISTINCTIVENESS[layerKey][proposed ? 1 : 0]
  return tables()[list].get(type) ?? null
}

/** The Irreplaceable Habitat answers the template allows for a habitat. */
export function irreplaceableAnswers(habitatType) {
  return tables().irreplaceable.get(habitatType) ?? new Set()
}

const fullName = (row) => `${row.ID} - ${row.UKHAB}`

/** The metric names ("Broad - Type") of the five vertical area habitats. */
export function verticalHabitatNames() {
  return tables().verticalHabitats.map(fullName)
}

let areaOffered = null

/**
 * Whether the Area Habitats layers offer a habitat, by its metric name. The
 * five vertical area habitats are mapped on their own layers only.
 */
export function areaLayerOffers(habitatFullName) {
  areaOffered ??= new Set([
    ...tables().areaHabitatsPre.map(fullName),
    ...tables().areaHabitatsPost.map(fullName)
  ])
  return areaOffered.has(habitatFullName)
}
