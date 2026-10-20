/**
 * Build the two-stage site model that `site.mjs` writes, from features
 * described in the template's own terms. Both routes into the BNG Service
 * format use it: the native generator (`native/`), which draws features, and
 * the converter (`from-legacy.mjs`), which reads them from a legacy file.
 *
 * A feature source is
 *
 *   { index, geometry, ref, retention, comment, baseline, proposed }
 *
 * where `retention` is Retained, Enhanced, Created or Lost, and `baseline` /
 * `proposed` hold the layer's values (see each builder). The rules are the
 * template's (its plugin/README.md, "What the tools translate"):
 *
 * - An area habitat cannot be removed: a Lost area habitat is a creation in
 *   its place, and becomes Created with the parcel as its parent.
 * - A lost hedgerow, watercourse or tree is absent from the post-intervention
 *   table. Its absence is the record.
 * - A created hedgerow, watercourse or tree has no parent and no baseline row.
 * - Sizes are measured from the shape: areas in hectares, lengths in metres.
 * - Strategic significance is Low or High (Low at baseline and on a Retained
 *   row), spatial risk is N/A, and distinctiveness and a single allowed
 *   Irreplaceable Habitat answer come from the template's own lists.
 */

import { areaSquareMetres, lengthMetres } from '../measure/index.mjs'
import { polygonCentroid } from '../geometry.mjs'
import { warn } from '../log.mjs'
import { listIndex } from './reference.mjs'
import { COMMENT, HABITAT_REF } from './site.mjs'
import {
  LOW,
  NO,
  NOT_APPLICABLE,
  TO_BE_CREATED,
  distinctiveness,
  irreplaceableAnswers,
  riparianEncroachment,
  significance,
  treeSetting
} from './vocabulary.mjs'

const SQ_M_PER_HECTARE = 10_000
const RETAINED = 'Retained'
const ENHANCED = 'Enhanced'
const CREATED = 'Created'
const LOST = 'Lost'
const NEWLY_PLANTED = 'Newly Planted'
const EXISTING = 'Existing'
const ON_SITE_RISK = NOT_APPLICABLE
const STANDARD_ENHANCEMENT = 'Standard Enhancement'
const NATIVE = 'Native'
const NON_NATIVE = 'Non-native'
const NATIVE_SHARE = 0.8
const IGGI_HABITAT = {
  broad: 'Intertidal hard structures',
  type: 'Artificial hard structures with integrated greening of grey infrastructure (IGGI)'
}
const IGGI_CONDITION = 'Moderate'

const TIMING_COLUMNS = {
  default: [
    'Habitat created in advance/years',
    'Delay in starting habitat creation/years'
  ],
  trees: [
    'Habitat Created/Enhanced in advance/years',
    'Delay in starting habitat creation/enhancement in years'
  ]
}

export const text = (value) =>
  value === null || value === undefined ? null : String(value)

const hectares = (geometry) => areaSquareMetres(geometry) / SQ_M_PER_HECTARE

export function defaultIrreplaceable(habitatType) {
  const answers = irreplaceableAnswers(habitatType)
  return answers.size === 1 ? [...answers][0] : NO
}

// --------------------------------------------------------------- baseline

// baseline: { broad, type, condition }
function areaBaseline(source) {
  const { type } = source.baseline
  return {
    [HABITAT_REF]: source.ref,
    'Baseline Broad Habitat Type': source.baseline.broad,
    'Baseline Habitat Type': type,
    'Baseline Distinctiveness': distinctiveness('habitats', type),
    'Baseline Condition': source.baseline.condition,
    'Baseline Strategic Significance': LOW,
    'Irreplaceable Habitat': defaultIrreplaceable(type),
    Area: hectares(source.geometry),
    [COMMENT]: source.comment ?? null
  }
}

// baseline: { type, condition }
function hedgerowBaseline(source) {
  const { type } = source.baseline
  return {
    [HABITAT_REF]: source.ref,
    'Baseline Hedge Type': type,
    'Baseline Distinctiveness': distinctiveness('hedgerows', type),
    'Baseline Condition': source.baseline.condition,
    'Baseline Strategic Significance': LOW,
    Length: lengthMetres(source.geometry),
    [COMMENT]: source.comment ?? null
  }
}

// baseline: { type, condition, water, riparian }
function riverBaseline(source) {
  const { type } = source.baseline
  return {
    [HABITAT_REF]: source.ref,
    'Baseline River Type': type,
    'Baseline Distinctiveness': distinctiveness('rivers', type),
    'Baseline Condition': source.baseline.condition,
    'Baseline Strategic Significance': LOW,
    'Baseline Encroachment into Watercourse': source.baseline.water,
    'Baseline Encroachment into riparian zone': riparianEncroachment(
      type,
      source.baseline.riparian
    ),
    Length: lengthMetres(source.geometry),
    [COMMENT]: source.comment ?? null
  }
}

/**
 * A tree's Native or Non-native type. A source that does not say (a legacy
 * file holds a tree's setting, not its origin) draws one, 80% native.
 */
function treeType(value, choose) {
  if (value === NATIVE || value === NON_NATIVE) {
    return value
  }
  return choose() < NATIVE_SHARE ? NATIVE : NON_NATIVE
}

// baseline: { size, type, setting, condition }
function treeBaseline(source, choose) {
  return {
    [HABITAT_REF]: source.ref,
    'Baseline Tree Size': source.baseline.size,
    'Baseline Tree Type': treeType(source.baseline.type, choose),
    'Baseline Rural or Urban Tree': treeSetting(source.baseline.setting),
    'Baseline Condition': source.baseline.condition,
    'Baseline Strategic Significance': LOW,
    'Irreplaceable Habitat': NO,
    [COMMENT]: source.comment ?? null
  }
}

const BASELINE_VALUES = {
  habitats: areaBaseline,
  hedgerows: hedgerowBaseline,
  rivers: riverBaseline,
  trees: treeBaseline
}

// ------------------------------------------------------- post-intervention

/** Retention as the template stores it: an area habitat's "Lost" is Created. */
function templateRetention(layerKey, retention) {
  return layerKey === 'habitats' && retention === LOST ? CREATED : retention
}

function proposedSignificance(retention, value) {
  return retention === RETAINED ? LOW : significance(value)
}

const aboveZero = (value) => value !== null && value !== '0'

/**
 * The advance and delay years. The template allows both at 0, but greys out
 * one while the other is above 0, so that one is blank, not 0.
 */
export function timingValues(advance, delay) {
  const a = text(advance)
  const d = text(delay)
  return [
    aboveZero(d) && a === '0' ? null : a,
    aboveZero(a) && d === '0' ? null : d
  ]
}

function timing(layerKey, proposed) {
  const [advance, delay] = TIMING_COLUMNS[layerKey] ?? TIMING_COLUMNS.default
  const [a, d] = timingValues(proposed.advance, proposed.delay)
  return { [advance]: a, [delay]: d }
}

// proposed: { broad, type, condition, significance, advance, delay }
function areaProposed(source, retention) {
  const { proposed } = source
  return {
    'Retention Category': retention,
    'Proposed Broad Habitat Type': proposed.broad,
    'Proposed Habitat Type': proposed.type,
    'Proposed Distinctiveness': distinctiveness(
      'habitats',
      proposed.type,
      true
    ),
    'Proposed Condition': proposed.condition,
    'Proposed Strategic Significance': proposedSignificance(
      retention,
      proposed.significance
    ),
    ...timing('habitats', proposed),
    'Spatial risk category': ON_SITE_RISK,
    Area: hectares(source.geometry)
  }
}

// proposed: { type, condition, significance, advance, delay }
function hedgerowProposed(source, retention) {
  const { proposed } = source
  return {
    'Retention Category': retention,
    'Proposed Hedge Type': proposed.type,
    'Proposed Distinctiveness': distinctiveness(
      'hedgerows',
      proposed.type,
      true
    ),
    'Proposed Condition': proposed.condition,
    'Proposed Strategic Significance': proposedSignificance(
      retention,
      proposed.significance
    ),
    ...timing('hedgerows', proposed),
    'Spatial risk category': ON_SITE_RISK,
    Length: lengthMetres(source.geometry)
  }
}

// proposed: { type, condition, significance, water, riparian, advance, delay }
function riverProposed(source, retention) {
  const { proposed } = source
  return {
    'Retention Category': retention,
    'Proposed River Type': proposed.type,
    'Proposed Distinctiveness': distinctiveness('rivers', proposed.type, true),
    'Proposed Condition': proposed.condition,
    'Proposed Strategic Significance': proposedSignificance(
      retention,
      proposed.significance
    ),
    'Proposed Encroachment into Watercourse': proposed.water,
    'Proposed Encroachment into riparian zone': riparianEncroachment(
      proposed.type,
      proposed.riparian
    ),
    'Enhancement Type':
      retention === ENHANCED ? STANDARD_ENHANCEMENT : NOT_APPLICABLE,
    ...timing('rivers', proposed),
    'Spatial risk category': ON_SITE_RISK,
    Length: lengthMetres(source.geometry)
  }
}

// proposed: { size, setting, type, condition, significance, advance, delay }
function treeProposed(source, retention) {
  const { proposed } = source
  return {
    'Retention Category': retention,
    'Proposed Tree Size': proposed.size,
    'Proposed Rural or Urban Tree': treeSetting(proposed.setting),
    'Proposed Condition': proposed.condition,
    'Proposed Strategic Significance': proposedSignificance(
      retention,
      proposed.significance
    ),
    Category: retention === CREATED ? NEWLY_PLANTED : EXISTING,
    ...timing('trees', proposed),
    'Spatial risk category': ON_SITE_RISK
  }
}

const PROPOSED_VALUES = {
  habitats: areaProposed,
  hedgerows: hedgerowProposed,
  rivers: riverProposed,
  trees: treeProposed
}

/**
 * The baseline columns of a post-intervention row created from nothing,
 * which the template fills with "To be created" and "N/A", and leaves the
 * baseline significance blank.
 */
const PARENTLESS_BASELINE = {
  hedgerows: () => ({
    'Baseline Hedge Type': TO_BE_CREATED,
    'Baseline Distinctiveness': NOT_APPLICABLE,
    'Baseline Condition': NOT_APPLICABLE,
    'Baseline Strategic Significance': null,
    'Baseline Length': null
  }),
  rivers: () => ({
    'Baseline River Type': TO_BE_CREATED,
    'Baseline Distinctiveness': NOT_APPLICABLE,
    'Baseline Condition': NOT_APPLICABLE,
    'Baseline Strategic Significance': null,
    'Baseline Encroachment into Watercourse': NOT_APPLICABLE,
    'Baseline Encroachment into riparian zone': NOT_APPLICABLE,
    'Baseline Length': null
  }),
  trees: (source, choose) => ({
    'Baseline Tree Size': NOT_APPLICABLE,
    'Baseline Tree Type': NOT_APPLICABLE,
    'Baseline Rural or Urban Tree': NOT_APPLICABLE,
    'Baseline Condition': NOT_APPLICABLE,
    'Baseline Strategic Significance': null,
    'Irreplaceable Habitat': NO,
    'Proposed Tree Type': treeType(source.proposed.type, choose)
  })
}

let enhancedTreeConditions = null

/**
 * An Enhanced tree moves to a better condition only: the template offers
 * nothing else. A source can mark a tree Enhanced without one (the legacy
 * workbook route reads no enhancement for trees), so such a tree is written
 * as the Retained tree it is, with a warning.
 */
function keepTreeEnhancementBetter(values, parent) {
  if (values['Retention Category'] !== ENHANCED) {
    return
  }
  enhancedTreeConditions ??= listIndex(
    'Individual trees/Individual tree Condition - options.csv',
    'ID',
    'New'
  )
  const baseline = parent.values['Baseline Condition']
  const better =
    enhancedTreeConditions.get(`${baseline}${ENHANCED}`) ?? new Set()
  if (better.has(values['Proposed Condition'])) {
    return
  }
  warn(
    `  tree ${values[HABITAT_REF]}: Enhanced with no better condition (${baseline} → ${values['Proposed Condition']}); written as Retained`
  )
  values['Retention Category'] = RETAINED
  values['Proposed Condition'] = baseline
  values['Proposed Strategic Significance'] = LOW
}

/** The post-intervention feature for a source, linked to `parent` if any. */
export function postInterventionFeature(layerKey, source, parent, choose) {
  const retention = templateRetention(layerKey, source.retention)
  const values = {
    [HABITAT_REF]: source.ref,
    ...PROPOSED_VALUES[layerKey](source, retention),
    [COMMENT]: null
  }
  if (!parent) {
    Object.assign(values, PARENTLESS_BASELINE[layerKey]?.(source, choose) ?? {})
  } else if (layerKey === 'trees') {
    // A kept tree keeps its type: the Metric does not record a change.
    values['Proposed Tree Type'] = parent.values['Baseline Tree Type']
    keepTreeEnhancementBetter(values, parent)
  }
  return {
    geometry: source.geometry,
    values,
    parent,
    source: { index: source.index, retention }
  }
}

export function hasBaseline(layerKey, retention) {
  return layerKey === 'habitats' || retention !== CREATED
}

export function hasPostIntervention(layerKey, retention) {
  if (
    retention === RETAINED ||
    retention === ENHANCED ||
    retention === CREATED
  ) {
    return true
  }
  return layerKey === 'habitats' && retention === LOST
}

/** The baseline feature for a source, with its feature_uuid. */
export function baselineFeature(layerKey, source, options) {
  return {
    geometry: source.geometry,
    values: BASELINE_VALUES[layerKey](source, options.choose),
    uuid: options.uuidFor(layerKey, source.index),
    source: { index: source.index }
  }
}

/**
 * One layer from sources whose every feature carries both stages: each kept
 * feature is the parent of its own post-intervention feature.
 */
export function layerFromSources(layerKey, sources, options) {
  const layer = { baseline: [], postIntervention: [] }
  for (const source of sources) {
    const parent = hasBaseline(layerKey, source.retention)
      ? baselineFeature(layerKey, source, options)
      : null
    if (parent) {
      layer.baseline.push(parent)
    }
    if (hasPostIntervention(layerKey, source.retention)) {
      layer.postIntervention.push(
        postInterventionFeature(layerKey, source, parent, options.choose)
      )
    }
  }
  return layer
}

// ---------------------------------------------------------------- redline

/**
 * The red line feature: its shape, the site's name, and the survey details
 * every feature of a site shares.
 */
export function redlineFeature(geometry, siteName, survey = {}) {
  const [cx, cy] = polygonCentroid(geometry.coordinates[0])
  return {
    geometry,
    values: {
      'Site Name': siteName ?? survey['Site Name'] ?? null,
      Location: `Centred on easting ${Math.round(cx)}, northing ${Math.round(cy)}`,
      'Survey Date': survey['Survey Date'] ?? null,
      'Survey Details': survey['Survey Details'] ?? null,
      'Mapped by': survey['Mapped by'] ?? null,
      Company: survey.Company ?? null,
      'Base Map': survey['Base Map'] ?? null
    }
  }
}

// ---------------------------------------------- IGGI, as a vertical habitat

/**
 * An IGGI polygon as the template maps it: a vertical area habitat drawn as
 * a line along its base, so the polygon's edge becomes the line and its area
 * the area typed in. Retained, in a fixed condition.
 */
export function iggiVertical(polygon, ref, index, uuid) {
  const geometry = {
    type: 'LineString',
    coordinates: polygon.coordinates[0].slice(0, -1)
  }
  const area = hectares(polygon)
  const parent = {
    geometry,
    uuid,
    values: {
      [HABITAT_REF]: ref,
      'Baseline Broad Habitat Type': IGGI_HABITAT.broad,
      'Baseline Habitat Type': IGGI_HABITAT.type,
      'Baseline Distinctiveness': distinctiveness(
        'verticalHabitats',
        IGGI_HABITAT.type
      ),
      'Baseline Condition': IGGI_CONDITION,
      'Baseline Strategic Significance': LOW,
      'Irreplaceable Habitat': defaultIrreplaceable(IGGI_HABITAT.type),
      Area: area,
      [COMMENT]: null
    },
    source: { index }
  }
  const child = {
    geometry,
    parent,
    values: {
      [HABITAT_REF]: ref,
      'Retention Category': RETAINED,
      'Proposed Broad Habitat Type': IGGI_HABITAT.broad,
      'Proposed Habitat Type': IGGI_HABITAT.type,
      'Proposed Distinctiveness': distinctiveness(
        'verticalHabitats',
        IGGI_HABITAT.type,
        true
      ),
      'Proposed Condition': IGGI_CONDITION,
      'Proposed Strategic Significance': LOW,
      'Spatial risk category': ON_SITE_RISK,
      Area: area,
      [COMMENT]: null
    },
    source: { index, retention: RETAINED }
  }
  return { parent, child }
}
