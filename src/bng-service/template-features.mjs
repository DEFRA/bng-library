/**
 * What the BNG Service template records that the legacy template cannot:
 * comments on either stage, irreplaceable area habitats and trees, and
 * vertical area habitats. Applied to the two-stage site model before it is
 * written.
 *
 * Row overrides name these per feature, as the generator's other overrides
 * do: `irreplaceable` ("Yes" or "No") and `comment` on a habitat or tree row
 * pin the baseline feature from that legacy row, and `postInterventionComment`
 * its post-intervention feature. The `verticalHabitats` layer takes rows of
 * its own (see `addVerticalHabitats`).
 *
 * Every value is one the template's lists offer, and the Metric's rules hold:
 * an irreplaceable tree is never Enhanced, and an Enhanced tree or vertical
 * habitat moves to a better condition only.
 *
 * It also records habitats that get worse (see `addWorseHabitats`), which
 * the legacy generator writes only as a loss and a separate creation.
 */

import { pointInRing } from '../geometry.mjs'
import { envelopeFromCoords } from '../gpkg-io/index.mjs'
import { lengthMetres } from '../measure/index.mjs'
import {
  AREA,
  HEDGEROW,
  WATERCOURSE,
  baselineConditions,
  creationConditions,
  encroachmentWorseThan,
  enhancementPairs,
  worseCreationConditions
} from '../synthetic/valid-draws.mjs'
import { listIndex } from './reference.mjs'
import { COMMENT, HABITAT_REF } from './schema.mjs'
import {
  HIGH,
  LOW,
  NO,
  NOT_APPLICABLE,
  TO_BE_CREATED,
  YES,
  distinctiveness,
  irreplaceableAnswers,
  verticalHabitatNames
} from './vocabulary.mjs'

export const RETAINED = 'Retained'
const ENHANCED = 'Enhanced'
const CREATED = 'Created'
const LOST = 'Lost'
const IRREPLACEABLE = 'Irreplaceable Habitat'
export const RETENTION = 'Retention Category'
export const ZERO_YEARS = '0'

const BASELINE_COMMENT_SHARE = 0.3
const PI_COMMENT_SHARE = 0.2
const HIGH_SIGNIFICANCE_SHARE = 0.2
const TIMING_SHARE = 0.3
const MAX_TIMING_YEARS = 5
const VERTICAL_PER_PARCELS = 25
const MIN_VERTICAL_HABITATS = 2
const MIN_WALL_LENGTH_M = 8
const MAX_WALL_LENGTH_M = 30
const MIN_WALL_HEIGHT_M = 2.5
const MAX_WALL_HEIGHT_M = 8
const SQ_M_PER_HECTARE = 10_000
const AREA_DECIMALS = 6
const PLACEMENT_ATTEMPTS = 200
const FULL_TURN = 2 * Math.PI
// A vertical habitat's retention, by position, when a row does not pin it:
// a default site shows each change the template records.
const VERTICAL_RETENTION_CYCLE = [RETAINED, ENHANCED, CREATED, LOST]
const VERTICAL_REF_PREFIX = 'V'
const REF_PAD = 3

export const VETERAN_TREE_COMMENT = 'Veteran features: rot holes and deadwood'
export const ANCIENT_WOODLAND_COMMENT = 'Ancient woodland on the inventory'
export const ENHANCED_TREE_COMMENT =
  'Crown works and mulching to raise the condition'

const BASELINE_COMMENTS = {
  habitats: [
    'Surveyed in June',
    'Boundary follows the field edge',
    'Grazed by sheep'
  ],
  verticalHabitats: ['South-facing wall', 'Brick, in fair repair'],
  hedgerows: ['Gappy at the eastern end', 'Cut annually'],
  rivers: ['Seasonal flow', 'Banks poached by livestock'],
  trees: ['Ivy on the trunk', 'Crown lifted']
}
const PI_COMMENTS = {
  habitats: ['Managed under the landscape plan', 'Seeded with a local mix'],
  verticalHabitats: ['Irrigated planting'],
  hedgerows: ['Gaps planted up'],
  rivers: ['Bank reprofiled'],
  trees: ['Guarded and staked']
}

// ------------------------------------------------------------ row overrides

function assertIrreplaceableAllowed(layerKey, feature, value) {
  if (value !== YES && value !== NO) {
    throw new Error(
      `${layerKey} ${feature.values[HABITAT_REF]}: irreplaceable must be "Yes" or "No" (got ${value})`
    )
  }
  if (layerKey === 'habitats') {
    const type = feature.values['Baseline Habitat Type']
    if (!irreplaceableAnswers(type).has(value)) {
      throw new Error(
        `habitats ${feature.values[HABITAT_REF]}: the template does not allow Irreplaceable Habitat "${value}" for ${type}`
      )
    }
  }
}

function childrenOf(layer, parent) {
  return layer.postIntervention.filter((f) => f.parent === parent)
}

function assertTreeNotEnhanced(layer, feature) {
  if (
    childrenOf(layer, feature).some(
      (child) => child.values[RETENTION] === ENHANCED
    )
  ) {
    throw new Error(
      `trees ${feature.values[HABITAT_REF]}: an irreplaceable tree cannot be Enhanced; the Metric refuses it`
    )
  }
}

function applyBaselineOverride(layerKey, layer, feature, override) {
  if (override.irreplaceable !== undefined) {
    assertIrreplaceableAllowed(layerKey, feature, override.irreplaceable)
    if (layerKey === 'trees' && override.irreplaceable === YES) {
      assertTreeNotEnhanced(layer, feature)
    }
    feature.values[IRREPLACEABLE] = override.irreplaceable
  }
  if (override.comment !== undefined) {
    feature.values[COMMENT] = override.comment
  }
}

/**
 * Apply the template-only fields of the generator's row overrides: row `i`
 * of `overrides.habitats` / `overrides.trees` pins the features from legacy
 * row `i`.
 */
export function applyTemplateOverrides(site, overrides = {}) {
  for (const layerKey of ['habitats', 'hedgerows', 'rivers', 'trees']) {
    const rows = overrides[layerKey] ?? []
    const layer = site.layers[layerKey]
    for (const feature of layer.baseline) {
      const override = rows[feature.source.index]
      if (override) {
        applyBaselineOverride(layerKey, layer, feature, override)
      }
    }
    for (const feature of layer.postIntervention) {
      const comment = rows[feature.source.index]?.postInterventionComment
      if (comment !== undefined) {
        feature.values[COMMENT] = comment
      }
    }
  }
}

// ------------------------------------------------------------- comments

/**
 * Comments on a share of the features, as a surveyor leaves them: a veteran
 * tree says why it is irreplaceable, an Enhanced tree says how, and an
 * irreplaceable parcel names its inventory. Never replaces a pinned comment.
 */
export function addComments(site, chooser) {
  for (const [layerKey, layer] of Object.entries(site.layers)) {
    for (const feature of layer.baseline) {
      if (
        feature.values[COMMENT] !== null &&
        feature.values[COMMENT] !== undefined
      ) {
        continue
      }
      if (feature.values[IRREPLACEABLE] === YES) {
        feature.values[COMMENT] =
          layerKey === 'trees' ? VETERAN_TREE_COMMENT : ANCIENT_WOODLAND_COMMENT
      } else if (chooser.chance(BASELINE_COMMENT_SHARE)) {
        feature.values[COMMENT] = chooser.pick(BASELINE_COMMENTS[layerKey])
      }
    }
    for (const feature of layer.postIntervention) {
      if (
        feature.values[COMMENT] !== null &&
        feature.values[COMMENT] !== undefined
      ) {
        continue
      }
      if (layerKey === 'trees' && feature.values[RETENTION] === ENHANCED) {
        feature.values[COMMENT] = ENHANCED_TREE_COMMENT
      } else if (chooser.chance(PI_COMMENT_SHARE)) {
        feature.values[COMMENT] = chooser.pick(PI_COMMENTS[layerKey])
      }
    }
  }
}

// --------------------------------------------------- vertical area habitats

const VERTICAL_BROAD_TYPES = new Set(['Urban', 'Intertidal hard structures'])

let proposedBroadOptions = null

/** The broad types a vertical habitat of `broad` can become by `retention`. */
function proposedBroadTypes(broad, retention) {
  proposedBroadOptions ??= listIndex(
    'Habitats/Habitat Proposed Broad Options.csv',
    'ID',
    'New'
  )
  return [...(proposedBroadOptions.get(`${broad}${retention}`) ?? [])].filter(
    (b) => VERTICAL_BROAD_TYPES.has(b)
  )
}

const split = (fullName) => {
  const at = fullName.indexOf(' - ')
  return {
    broad: fullName.slice(0, at),
    type: fullName.slice(at + ' - '.length)
  }
}

function verticalRef(index) {
  return `${VERTICAL_REF_PREFIX}${String(index + 1).padStart(REF_PAD, '0')}`
}

/** A wall's base: a short straight line wholly inside the red line. */
function wallLine(ring, chooser, lengthM) {
  const [minX, maxX, minY, maxY] = envelopeFromCoords(ring)
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt += 1) {
    const start = [chooser.between(minX, maxX), chooser.between(minY, maxY)]
    const angle = chooser.next() * FULL_TURN
    const end = [
      start[0] + lengthM * Math.cos(angle),
      start[1] + lengthM * Math.sin(angle)
    ]
    const middle = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
    if ([start, middle, end].every((p) => pointInRing(p, ring))) {
      return [start, end]
    }
  }
  return null
}

const roundArea = (value) => Number(value.toFixed(AREA_DECIMALS))

function timingPair(retention, chooser) {
  if (retention === RETAINED || !chooser.chance(TIMING_SHARE)) {
    return [ZERO_YEARS, ZERO_YEARS]
  }
  // The other value is blank: the template greys it out while one is above 0.
  const years = String(1 + Math.floor(chooser.next() * MAX_TIMING_YEARS))
  return chooser.chance(1 / 2) ? [years, null] : [null, years]
}

function proposedSide(baselineName, retention, override, chooser) {
  if (retention === RETAINED) {
    return { name: baselineName, condition: null }
  }
  if (retention === ENHANCED) {
    const pairs = enhancementPairs(AREA, baselineName).filter(
      ([from, to]) =>
        (override.baselineCondition === undefined ||
          from === override.baselineCondition) &&
        (override.proposedCondition === undefined ||
          to === override.proposedCondition)
    )
    const [from, to] = chooser.pick(pairs)
    return { name: baselineName, baselineCondition: from, condition: to }
  }
  const { broad } = split(baselineName)
  const name =
    override.proposedHabitatFullName ??
    chooser.pick(
      verticalHabitatNames().filter(
        (n) =>
          n !== baselineName &&
          proposedBroadTypes(broad, CREATED).includes(split(n).broad)
      )
    )
  return {
    name,
    condition:
      override.proposedCondition ?? chooser.pick(creationConditions(AREA, name))
  }
}

function verticalBaseline(index, line, name, condition, areaHa, chooser) {
  const { broad, type } = split(name)
  const answers = irreplaceableAnswers(type)
  return {
    geometry: { type: 'LineString', coordinates: line },
    uuid: chooser.uuid(`verticalHabitats/${index}`),
    source: { index },
    values: {
      [HABITAT_REF]: verticalRef(index),
      'Baseline Broad Habitat Type': broad,
      'Baseline Habitat Type': type,
      'Baseline Distinctiveness': distinctiveness('verticalHabitats', type),
      'Baseline Condition': condition,
      'Baseline Strategic Significance': LOW,
      [IRREPLACEABLE]: answers.size === 1 ? [...answers][0] : NO,
      Area: areaHa,
      [COMMENT]: null
    }
  }
}

function verticalPostIntervention(parent, retention, proposed, chooser) {
  const { broad, type } = split(proposed.name)
  const [advance, delay] = timingPair(retention, chooser)
  return {
    geometry: parent.geometry,
    parent,
    source: { index: parent.source.index, retention },
    values: {
      [HABITAT_REF]: parent.values[HABITAT_REF],
      [RETENTION]: retention,
      'Proposed Broad Habitat Type': broad,
      'Proposed Habitat Type': type,
      'Proposed Distinctiveness': distinctiveness(
        'verticalHabitats',
        type,
        true
      ),
      'Proposed Condition':
        proposed.condition ?? parent.values['Baseline Condition'],
      'Proposed Strategic Significance':
        retention === RETAINED || !chooser.chance(HIGH_SIGNIFICANCE_SHARE)
          ? LOW
          : HIGH,
      'Habitat created in advance/years': advance,
      'Delay in starting habitat creation/years': delay,
      'Spatial risk category': NOT_APPLICABLE,
      Area: parent.values.Area,
      [COMMENT]: null
    }
  }
}

function assertVerticalName(name, where) {
  if (!verticalHabitatNames().includes(name)) {
    throw new Error(
      `${where}: "${name}" is not a vertical area habitat; the template offers ${verticalHabitatNames().join(', ')}`
    )
  }
}

function verticalFeature(ring, index, override, chooser) {
  const name = override.habitatFullName ?? chooser.pick(verticalHabitatNames())
  assertVerticalName(name, `verticalHabitats row ${index}`)
  const retention =
    override.retention ??
    VERTICAL_RETENTION_CYCLE[index % VERTICAL_RETENTION_CYCLE.length]
  const lengthM = chooser.between(MIN_WALL_LENGTH_M, MAX_WALL_LENGTH_M)
  const line = wallLine(ring, chooser, lengthM)
  if (!line) {
    return null
  }
  const heightM = chooser.between(MIN_WALL_HEIGHT_M, MAX_WALL_HEIGHT_M)
  const areaHa =
    override.area ?? roundArea((lengthM * heightM) / SQ_M_PER_HECTARE)
  const proposed = proposedSide(name, retention, override, chooser)
  if (proposed.name !== name) {
    assertVerticalName(proposed.name, `verticalHabitats row ${index}`)
  }
  const condition =
    proposed.baselineCondition ??
    override.baselineCondition ??
    chooser.pick(baselineConditions(AREA, name))
  const baseline = verticalBaseline(
    index,
    line,
    name,
    condition,
    areaHa,
    chooser
  )
  if (override.comment !== undefined) {
    baseline.values[COMMENT] = override.comment
  }
  const postIntervention =
    retention === LOST
      ? null
      : verticalPostIntervention(baseline, retention, proposed, chooser)
  if (postIntervention && override.postInterventionComment !== undefined) {
    postIntervention.values[COMMENT] = override.postInterventionComment
  }
  return { baseline, postIntervention }
}

/** How many vertical habitats a site of `numParcels` parcels draws. */
export function defaultVerticalCount(numParcels) {
  return MIN_VERTICAL_HABITATS + Math.floor(numParcels / VERTICAL_PER_PARCELS)
}

/**
 * Add vertical area habitats: walls and structures, each drawn as a line
 * along its base inside the red line, with its face area typed in hectares.
 * Row `i` of `rows` pins vertical habitat `i`: `habitatFullName` (one of the
 * five the template offers), `retention` (Retained, Enhanced, Created, or
 * Lost: absent from the post-intervention table), `baselineCondition`,
 * `proposedCondition`, `proposedHabitatFullName` (for Created), `area`
 * (hectares), `comment` and `postInterventionComment`. Unpinned values are
 * drawn as the Metric allows.
 *
 * @param {object} site
 * @param {{ count: number, rows?: object[] }} plan
 * @param {ReturnType<import('./random.mjs').createChooser>} chooser
 */
export function addVerticalHabitats(site, { count, rows = [] }, chooser) {
  const ring = site.redline.geometry.coordinates[0]
  const layer = site.layers.verticalHabitats
  const offset = layer.baseline.length
  const total = Math.max(count, rows.length)
  for (let i = 0; i < total; i += 1) {
    const feature = verticalFeature(ring, offset + i, rows[i] ?? {}, chooser)
    if (!feature) {
      continue
    }
    layer.baseline.push(feature.baseline)
    if (feature.postIntervention) {
      layer.postIntervention.push(feature.postIntervention)
    }
  }
}

// ------------------------------------------------- habitats that get worse

export const ADVANCE = 'Habitat created in advance/years'
const DELAY = 'Delay in starting habitat creation/years'
// The Metric User Guide, section 5, "Habitat retention": a habitat whose
// condition cannot be kept is recorded as lost, and created again in the
// same type in a lower condition, 30 plus years in advance. The template
// fills this in (bng-metric-template #7); a generated file does not pass
// through QGIS, so the generator writes it.
const DEGRADED_ADVANCE = '30+'
// The Metric User Guide, section 7, "Watercourse creation": "Creation in
// advance may be set to 10+ years if there are increases in encroachment
// with no other impacts."
const ENCROACHED_ADVANCE = '10'
const CULVERT = 'Culvert'
const MIN_HEDGE_LENGTH_M = 40
const MAX_HEDGE_LENGTH_M = 120
const MIN_RIVER_LENGTH_M = 60
const MAX_RIVER_LENGTH_M = 150
// Where a hedge that gets worse in part is split, as a share of its length.
const MIN_SPLIT_SHARE = 0.3
const MAX_SPLIT_SHARE = 0.7
const NUMBERED_REF = /^([A-Za-z]+)(\d+)$/
/**
 * What each habitat that gets worse is, held on the feature as `worse` and
 * never written, so the degrade flaws can find the row they break.
 */
export const WORSE = Object.freeze({
  parcel: 'parcel',
  vertical: 'vertical',
  hedge: 'hedge',
  partlyKeptHedge: 'partly-kept-hedge',
  partlyWorseHedge: 'partly-worse-hedge',
  encroachedWatercourse: 'encroached-watercourse',
  worseWatercourse: 'worse-watercourse'
})

export const WORSE_HABITAT_COMMENT =
  'Condition cannot be kept: recorded as lost and created again in a lower condition'
export const ENCROACHED_WATERCOURSE_COMMENT =
  'Encroachment increases, with no other impact'
export const WORSE_WATERCOURSE_COMMENT =
  'Condition gets worse: recorded as lost and created again in a lower condition'

/** The baseline conditions of a type from which it can get worse. */
function worseningFrom(kind, type) {
  return baselineConditions(kind, type).filter(
    (from) => worseCreationConditions(kind, type, from).length > 0
  )
}

/** A Created copy of `parent`, in its own type, worse, 30+ years in advance. */
function worseCopy(parent, proposed, chooser) {
  return {
    geometry: parent.geometry,
    parent,
    source: { index: parent.source.index, retention: CREATED },
    values: {
      [HABITAT_REF]: parent.values[HABITAT_REF],
      [RETENTION]: CREATED,
      ...proposed,
      'Proposed Strategic Significance': LOW,
      [ADVANCE]: DEGRADED_ADVANCE,
      [DELAY]: null,
      'Spatial risk category': NOT_APPLICABLE,
      [COMMENT]: WORSE_HABITAT_COMMENT
    }
  }
}

/**
 * The next ref in the style of a layer's refs: HG003 after HG002. Counts
 * both stages, as a created feature has a ref but no baseline row.
 */
function nextRef(layer, prefix) {
  let last = 0
  for (const feature of [...layer.baseline, ...layer.postIntervention]) {
    const match = NUMBERED_REF.exec(feature.values[HABITAT_REF] ?? '')
    if (match) {
      prefix = match[1]
      last = Math.max(last, Number(match[2]))
    }
  }
  return `${prefix}${String(last + 1).padStart(REF_PAD, '0')}`
}

/**
 * An area parcel: the last Retained parcel that can get worse, set to
 * Created in place, as the surveyor keeps the copied row. Area ground tiles
 * the site, so a parcel cannot be added. Only when another Retained parcel
 * stays, so the site still shows one.
 */
function worseParcel(site, chooser) {
  const retained = site.layers.habitats.postIntervention.filter(
    (f) =>
      f.parent &&
      f.values[RETENTION] === RETAINED &&
      f.parent.values[IRREPLACEABLE] !== YES
  )
  if (retained.length < 2) {
    return
  }
  const conditionsOf = (f) =>
    worseCreationConditions(
      AREA,
      `${f.parent.values['Baseline Broad Habitat Type']} - ${f.parent.values['Baseline Habitat Type']}`,
      f.parent.values['Baseline Condition']
    )
  const feature = retained.findLast((f) => conditionsOf(f).length > 0)
  if (!feature) {
    return
  }
  const base = feature.parent.values
  const type = base['Baseline Habitat Type']
  Object.assign(feature.values, {
    [RETENTION]: CREATED,
    'Proposed Broad Habitat Type': base['Baseline Broad Habitat Type'],
    'Proposed Habitat Type': type,
    'Proposed Distinctiveness': distinctiveness('habitats', type, true),
    'Proposed Condition': chooser.pick(conditionsOf(feature)),
    'Proposed Strategic Significance': LOW,
    [ADVANCE]: DEGRADED_ADVANCE,
    [DELAY]: null
  })
  feature.values[COMMENT] ??= WORSE_HABITAT_COMMENT
  feature.worse = WORSE.parcel
}

/**
 * The index after the highest a vertical habitat has. Not the row count, as
 * `addVerticalHabitats` skips a row it cannot place and leaves a gap.
 */
function nextVerticalIndex(layer) {
  return Math.max(-1, ...layer.baseline.map((f) => f.source.index)) + 1
}

/** A vertical area habitat drawn for the purpose, and its worse copy. */
function worseVertical(site, chooser) {
  const names = verticalHabitatNames().filter(
    (n) => worseningFrom(AREA, n).length > 0
  )
  const name = chooser.pick(names)
  const layer = site.layers.verticalHabitats
  const feature = verticalFeature(
    site.redline.geometry.coordinates[0],
    nextVerticalIndex(layer),
    {
      habitatFullName: name,
      retention: RETAINED,
      baselineCondition: chooser.pick(worseningFrom(AREA, name))
    },
    chooser
  )
  if (!feature) {
    return
  }
  const { baseline } = feature
  const type = baseline.values['Baseline Habitat Type']
  layer.baseline.push(baseline)
  const copy = worseCopy(
    baseline,
    {
      'Proposed Broad Habitat Type':
        baseline.values['Baseline Broad Habitat Type'],
      'Proposed Habitat Type': type,
      'Proposed Distinctiveness': distinctiveness(
        'verticalHabitats',
        type,
        true
      ),
      'Proposed Condition': chooser.pick(
        worseCreationConditions(
          AREA,
          name,
          baseline.values['Baseline Condition']
        )
      ),
      Area: baseline.values.Area
    },
    chooser
  )
  copy.worse = WORSE.vertical
  layer.postIntervention.push(copy)
}

/** A straight line inside the red line, `min` to `max` metres long. */
function drawnLine(site, chooser, min, max) {
  const line = wallLine(
    site.redline.geometry.coordinates[0],
    chooser,
    chooser.between(min, max)
  )
  return line ? { type: 'LineString', coordinates: line } : null
}

/** A line split at `share` of its length: [first part, second part]. */
export function splitLine(geometry, share) {
  const [start, end] = geometry.coordinates
  const at = [
    start[0] + (end[0] - start[0]) * share,
    start[1] + (end[1] - start[1]) * share
  ]
  return [
    { type: 'LineString', coordinates: [start, at] },
    { type: 'LineString', coordinates: [at, end] }
  ]
}

let hedgeTypes = null

function worseningHedgeTypes() {
  hedgeTypes ??= [
    ...listIndex(
      'Hedgerows/Hedgerow Condition.csv',
      'Habitat',
      'Condition'
    ).keys()
  ].filter((type) => worseningFrom(HEDGEROW, type).length > 0)
  return hedgeTypes
}

/** A baseline hedgerow drawn for the purpose, that can get worse. */
function drawnHedgerow(site, chooser, key) {
  const layer = site.layers.hedgerows
  const geometry = drawnLine(
    site,
    chooser,
    MIN_HEDGE_LENGTH_M,
    MAX_HEDGE_LENGTH_M
  )
  if (!geometry || worseningHedgeTypes().length === 0) {
    return null
  }
  const type = chooser.pick(worseningHedgeTypes())
  const baseline = {
    geometry,
    uuid: chooser.uuid(`hedgerows/${key}`),
    source: { index: layer.baseline.length },
    values: {
      [HABITAT_REF]: nextRef(layer, 'HG'),
      'Baseline Hedge Type': type,
      'Baseline Distinctiveness': distinctiveness('hedgerows', type),
      'Baseline Condition': chooser.pick(worseningFrom(HEDGEROW, type)),
      'Baseline Strategic Significance': LOW,
      Length: lengthMetres(geometry),
      [COMMENT]: null
    }
  }
  layer.baseline.push(baseline)
  return baseline
}

/** A Created part of `parent` in its own hedge type, worse, 30+ years in
 * advance. */
function worseHedgePart(parent, geometry, ref, chooser) {
  const type = parent.values['Baseline Hedge Type']
  const part = worseCopy(
    parent,
    {
      'Proposed Hedge Type': type,
      'Proposed Distinctiveness': distinctiveness('hedgerows', type, true),
      'Proposed Condition': chooser.pick(
        worseCreationConditions(
          HEDGEROW,
          type,
          parent.values['Baseline Condition']
        )
      ),
      Length: lengthMetres(geometry)
    },
    chooser
  )
  part.geometry = geometry
  part.values[HABITAT_REF] = ref
  return part
}

/** A hedgerow drawn for the purpose, which gets worse as a whole. */
function worseHedgerow(site, chooser) {
  const baseline = drawnHedgerow(site, chooser, 'worse')
  if (baseline) {
    const part = worseHedgePart(
      baseline,
      baseline.geometry,
      baseline.values[HABITAT_REF],
      chooser
    )
    part.worse = WORSE.hedge
    site.layers.hedgerows.postIntervention.push(part)
  }
}

/**
 * A Retained part of a split `parent`, in its baseline values: the part
 * that does not change. `proposed` holds the layer's own Proposed columns.
 */
export function retainedPart(parent, geometry, ref, proposed) {
  return {
    geometry,
    parent,
    source: { index: parent.source.index, retention: RETAINED },
    values: {
      [HABITAT_REF]: ref,
      [RETENTION]: RETAINED,
      ...proposed,
      'Proposed Strategic Significance': LOW,
      [ADVANCE]: ZERO_YEARS,
      [DELAY]: ZERO_YEARS,
      'Spatial risk category': NOT_APPLICABLE,
      Length: lengthMetres(geometry),
      [COMMENT]: null
    }
  }
}

/**
 * A hedgerow drawn for the purpose, of which part gets worse: the surveyor
 * splits the copied line, keeps one part Retained and sets the other to
 * Created in a worse condition. Both parts keep the parent, and take the
 * template's tidied refs, "HG006a" and "HG006b".
 */
function partlyWorseHedgerow(site, chooser) {
  const baseline = drawnHedgerow(site, chooser, 'partly-worse')
  if (!baseline) {
    return
  }
  const ref = baseline.values[HABITAT_REF]
  const [kept, worse] = splitLine(
    baseline.geometry,
    chooser.between(MIN_SPLIT_SHARE, MAX_SPLIT_SHARE)
  )
  const type = baseline.values['Baseline Hedge Type']
  const worsePart = worseHedgePart(baseline, worse, `${ref}b`, chooser)
  worsePart.worse = WORSE.partlyWorseHedge
  const keptPart = retainedPart(baseline, kept, `${ref}a`, {
    'Proposed Hedge Type': type,
    'Proposed Distinctiveness': distinctiveness('hedgerows', type, true),
    'Proposed Condition': baseline.values['Baseline Condition']
  })
  keptPart.worse = WORSE.partlyKeptHedge
  site.layers.hedgerows.postIntervention.push(keptPart, worsePart)
}

let encroachmentOptions = null

function encroachmentLists() {
  encroachmentOptions ??= {
    water: listIndex(
      'Watercourses/Watercourse Encroachment.csv',
      'Value',
      'Description'
    ),
    riparian: listIndex(
      'Watercourses/Riparian Encroachment.csv',
      'Value',
      'Label'
    )
  }
  return encroachmentOptions
}

/** The encroachment options of a type, and those that can get worse. */
export function encroachmentOf(type) {
  const lists = encroachmentLists()
  const water = [...(lists.water.get(type) ?? [])]
  const riparian = [...(lists.riparian.get(type) ?? [])]
  const worse = (side, baseline) =>
    encroachmentWorseThan(side, side === 'water' ? water : riparian, baseline)
  return {
    water,
    riparian,
    worseningWater: water.filter((b) => worse('water', b).length > 0),
    worseningRiparian: riparian.filter((b) => worse('riparian', b).length > 0),
    worse
  }
}

/** The conditions a watercourse can be recorded in, and created in. */
function keptConditions(type) {
  const creatable = new Set(creationConditions(WATERCOURSE, type))
  return baselineConditions(WATERCOURSE, type).filter((c) => creatable.has(c))
}

/** The watercourse types, not a culvert, that pass `test`. */
export function riverTypes(test) {
  return [...encroachmentLists().water.keys()].filter(
    (type) =>
      type !== CULVERT &&
      type !== TO_BE_CREATED &&
      type !== NOT_APPLICABLE &&
      test(type)
  )
}

/**
 * A baseline watercourse drawn for the purpose inside the red line, with
 * the baseline values given, added to the layer; null if none fits.
 */
export function drawnWatercourseBaseline(site, chooser, key, baselineValues) {
  const layer = site.layers.rivers
  const geometry = drawnLine(
    site,
    chooser,
    MIN_RIVER_LENGTH_M,
    MAX_RIVER_LENGTH_M
  )
  if (!geometry) {
    return null
  }
  const type = baselineValues['Baseline River Type']
  const baseline = {
    geometry,
    uuid: chooser.uuid(`rivers/${key}`),
    source: { index: layer.baseline.length },
    values: {
      [HABITAT_REF]: nextRef(layer, 'R'),
      ...baselineValues,
      'Baseline Distinctiveness': distinctiveness('rivers', type),
      'Baseline Strategic Significance': LOW,
      Length: lengthMetres(geometry),
      [COMMENT]: null
    }
  }
  layer.baseline.push(baseline)
  return baseline
}

/**
 * A watercourse drawn for the purpose, with the baseline values given, and
 * its Created copy in its own type with the proposed values given.
 */
function drawnWatercourse(site, chooser, key, baselineValues, proposed) {
  const baseline = drawnWatercourseBaseline(site, chooser, key, baselineValues)
  if (!baseline) {
    return null
  }
  const type = baselineValues['Baseline River Type']
  const copy = worseCopy(
    baseline,
    {
      'Proposed River Type': type,
      'Proposed Distinctiveness': distinctiveness('rivers', type, true),
      ...proposed,
      // The template offers only N/A for a Created watercourse.
      'Enhancement Type': NOT_APPLICABLE,
      Length: baseline.values.Length
    },
    chooser
  )
  site.layers.rivers.postIntervention.push(copy)
  return copy
}

/**
 * A watercourse whose encroachment gets worse on both sides, with no other
 * impact: Created in its own type and condition, 10 years in advance.
 */
function encroachedWatercourse(site, chooser) {
  const types = riverTypes((type) => {
    const options = encroachmentOf(type)
    return (
      keptConditions(type).length > 0 &&
      options.worseningWater.length > 0 &&
      options.worseningRiparian.length > 0
    )
  })
  if (types.length === 0) {
    return
  }
  const type = chooser.pick(types)
  const options = encroachmentOf(type)
  const water = chooser.pick(options.worseningWater)
  const riparian = chooser.pick(options.worseningRiparian)
  const condition = chooser.pick(keptConditions(type))
  const copy = drawnWatercourse(
    site,
    chooser,
    'encroached',
    {
      'Baseline River Type': type,
      'Baseline Condition': condition,
      'Baseline Encroachment into Watercourse': water,
      'Baseline Encroachment into riparian zone': riparian
    },
    {
      'Proposed Condition': condition,
      'Proposed Encroachment into Watercourse': chooser.pick(
        options.worse('water', water)
      ),
      'Proposed Encroachment into riparian zone': chooser.pick(
        options.worse('riparian', riparian)
      )
    }
  )
  if (copy) {
    copy.values[ADVANCE] = ENCROACHED_ADVANCE
    copy.values[COMMENT] = ENCROACHED_WATERCOURSE_COMMENT
    copy.worse = WORSE.encroachedWatercourse
  }
}

/**
 * A watercourse whose condition gets worse, with no change of encroachment:
 * Created in its own type, in a condition the Metric scores lower. The
 * Metric gives no years in advance for it (User Guide, section 7: record
 * the loss, and the post-intervention length in the creation tab), so the
 * surveyor's choice is left blank.
 */
function worseConditionWatercourse(site, chooser) {
  const types = riverTypes(
    (type) =>
      worseningFrom(WATERCOURSE, type).length > 0 &&
      encroachmentOf(type).water.length > 0 &&
      encroachmentOf(type).riparian.length > 0
  )
  if (types.length === 0) {
    return
  }
  const type = chooser.pick(types)
  const options = encroachmentOf(type)
  const condition = chooser.pick(worseningFrom(WATERCOURSE, type))
  const water = chooser.pick(options.water)
  const riparian = chooser.pick(options.riparian)
  const copy = drawnWatercourse(
    site,
    chooser,
    'worse',
    {
      'Baseline River Type': type,
      'Baseline Condition': condition,
      'Baseline Encroachment into Watercourse': water,
      'Baseline Encroachment into riparian zone': riparian
    },
    {
      'Proposed Condition': chooser.pick(
        worseCreationConditions(WATERCOURSE, type, condition)
      ),
      'Proposed Encroachment into Watercourse': water,
      'Proposed Encroachment into riparian zone': riparian
    }
  )
  if (copy) {
    copy.values[ADVANCE] = null
    copy.values[COMMENT] = WORSE_WATERCOURSE_COMMENT
    copy.worse = WORSE.worseWatercourse
  }
}

/**
 * Record habitats that get worse, as a surveyor does with the template: the
 * copied row is kept, so it keeps its parent, and set to Created in its own
 * type.
 *
 * - An area habitat, a vertical area habitat and a hedgerow take a
 *   condition the Metric scores lower and can create them in, 30+ years in
 *   advance (Metric User Guide, section 5). A second hedgerow gets worse in
 *   part only: it is split into a Retained part and a worse Created part.
 * - One watercourse keeps its condition, and its encroachment gets worse on
 *   both sides, 10 years in advance (Metric User Guide, section 7). Another
 *   keeps its encroachment, and its condition gets worse, with no years in
 *   advance. Neither is a culvert.
 *
 * The area habitat is the last Retained parcel that can get worse, clear of
 * the lineage flaws, which take the first, and only when another Retained
 * parcel stays. Area ground tiles the site, so it cannot be added. The
 * others are drawn for the purpose inside the red line, so the site keeps
 * every feature it had. An irreplaceable habitat is never chosen. A layer
 * in `emptyLayers`, which an empty-layer flaw leaves with no rows, is left
 * empty.
 *
 * @param {object} site
 * @param {ReturnType<import('./random.mjs').createChooser>} chooser
 * @param {Set<string>} [emptyLayers]
 */
export function addWorseHabitats(site, chooser, emptyLayers = new Set()) {
  const add = (layerKey, ...draws) => {
    if (!emptyLayers.has(layerKey)) {
      for (const draw of draws) {
        draw(site, chooser)
      }
    }
  }
  add('habitats', worseParcel)
  add('verticalHabitats', worseVertical)
  add('hedgerows', worseHedgerow, partlyWorseHedgerow)
  add('rivers', encroachedWatercourse, worseConditionWatercourse)
}
