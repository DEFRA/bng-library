/**
 * The flaws only a BNG Service template file can carry: in the lineage that
 * links a post-intervention feature to its baseline parent, and in the
 * record of the template version. Each is applied to an otherwise valid
 * file, so it trips one check and nothing else.
 *
 * The legacy flaws (see ../synthetic/flaws.mjs) apply to the new format as
 * well, remapped to its tables, bar `tree-count-not-whole`: the template has
 * no Count column, so the flaw cannot be expressed.
 *
 * The lineage flaws name the backend's lineage codes (the
 * spike/baseline-pi-lineage branch), bar `lineage-parent-geom-missing`: the
 * backend skips the shape check on a linked row with no parent_geom, as a
 * file made before the column, so it accepts that file without a warning.
 * The service does not check the version
 * record yet, so the version flaws name the outcome the template's design
 * asks for ("It refuses a file with no record, or with a version that it does
 * not support") rather than an error code that does not exist.
 *
 * The degrade flaws break one rule of a habitat that gets worse (see
 * addWorseHabitats in template-features.mjs), as the Metric User Guide records
 * it: section 5 for an area habitat or hedgerow (Created in its own type, in a
 * lower condition, 30 plus years in advance), section 7 for a watercourse.
 * Asking for one adds the habitats that get worse, if the site has none. The
 * service does not check these rules yet, so the flaws name that outcome.
 */

import { error } from '../log.mjs'
import { lengthMetres } from '../measure/index.mjs'
import { geometryWkt } from './site.mjs'
import {
  CURRENT_TEMPLATE_VERSION,
  HABITAT_REF,
  versionRecordText
} from './schema.mjs'
import {
  ADVANCE,
  WORSE,
  retainedPart,
  splitLine
} from './template-features.mjs'
import { distinctiveness, NOT_APPLICABLE } from './vocabulary.mjs'

export const CATEGORY_LINEAGE = 'lineage'
export const CATEGORY_VERSION = 'version'
export const CATEGORY_DEGRADE = 'degrade'

const CATEGORY_LABELS = {
  [CATEGORY_LINEAGE]: 'lineage',
  [CATEGORY_VERSION]: 'template-version',
  [CATEGORY_DEGRADE]: 'degraded-habitat'
}

const NO_BACKEND_CODE_YET =
  '(refused; the service does not check the version yet)'
const ACCEPTED_WITHOUT_SHAPE_CHECK =
  '(accepted; the service skips the shape check without parent_geom)'
const NOT_CHECKED_YET =
  '(accepted; the service does not check habitats that get worse yet)'
const WATERCOURSE_ADVANCE = '10'
const UNKNOWN_REF = 'NOT-IN-BASELINE'
const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000'
// The mismatched parent shape is the parent moved this far east: well over
// the millimetre the service compares to, and clearly not a rounding slip.
const SHIFT_M = 5

/** The legacy flaws the template cannot carry. */
export const LEGACY_ONLY_FLAWS = new Set(['tree-count-not-whole'])

const continuing = (feature) =>
  feature.parent &&
  ['Retained', 'Enhanced'].includes(feature.values['Retention Category'])

/** The first continuing area habitat: the feature a lineage flaw breaks. */
function lineageSubject(site) {
  const feature = site.layers.habitats.postIntervention.find(continuing)
  if (!feature) {
    throw new Error(
      'a lineage flaw needs a Retained or Enhanced area habitat; this site has none'
    )
  }
  return feature
}

/**
 * The habitat that gets worse that the degrade flaw `flaw` breaks: the first
 * of the kind its `worse` names, on that layer.
 */
function worseSubject(site, flaw) {
  const { layerKey, kind } = BNG_SERVICE_FLAWS[flaw].worse
  const feature = site.layers[layerKey].postIntervention.find(
    (f) => f.worse === kind
  )
  if (!feature) {
    throw new Error(
      `${flaw} needs a ${kind.replaceAll('-', ' ')} that gets worse; this site has none: the layer is empty, or no line fits inside the red line`
    )
  }
  return feature
}

/**
 * Split a Created watercourse's row in two: a Retained first part, in its
 * baseline values, and the Created rest. Both keep the parent.
 */
function splitWatercourse(site, feature) {
  const base = feature.parent.values
  const type = base['Baseline River Type']
  const ref = feature.values[HABITAT_REF]
  const [kept, rest] = splitLine(feature.geometry, 1 / 2)
  const retained = retainedPart(feature.parent, kept, `${ref}a`, {
    'Proposed River Type': type,
    'Proposed Distinctiveness': distinctiveness('rivers', type, true),
    'Proposed Condition': base['Baseline Condition'],
    'Proposed Encroachment into Watercourse':
      base['Baseline Encroachment into Watercourse'],
    'Proposed Encroachment into riparian zone':
      base['Baseline Encroachment into riparian zone'],
    'Enhancement Type': NOT_APPLICABLE
  })
  feature.geometry = rest
  feature.values[HABITAT_REF] = `${ref}b`
  feature.values.Length = lengthMetres(rest)
  const rows = site.layers.rivers.postIntervention
  rows.splice(rows.indexOf(feature), 0, retained)
}

function shifted(geometry) {
  const move = ([x, y]) => [x + SHIFT_M, y]
  if (geometry.type === 'Polygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((r) => r.map(move))
    }
  }
  if (geometry.type === 'LineString') {
    return { ...geometry, coordinates: geometry.coordinates.map(move) }
  }
  return { ...geometry, coordinates: move(geometry.coordinates) }
}

function nextMajorVersion(version) {
  return `${Number.parseInt(version, 10) + 1}.0`
}

/**
 * Registry of the BNG Service template flaws, in the shape of the legacy
 * FLAWS registry: `description`, `errorCode`, `category`, and either
 * `applyToSite(site)` (lineage) or `versionRecords(version)` (version).
 */
export const BNG_SERVICE_FLAWS = {
  'lineage-parent-missing': {
    description:
      'a Retained area habitat carries no Parent Ref, parent_uuid or parent_geom, so its parent must be inferred from its shape',
    errorCode: 'STAGED_PARENT_INFERRED',
    category: CATEGORY_LINEAGE,
    applyToSite(site) {
      lineageSubject(site).lineage = { ref: null, uuid: null, geom: null }
    }
  },
  'lineage-parent-unknown': {
    description:
      'a Retained area habitat names a parent, by Parent Ref and parent_uuid, that is not in the baseline',
    errorCode: 'STAGED_UNKNOWN_PARENT_REF',
    category: CATEGORY_LINEAGE,
    applyToSite(site) {
      const feature = lineageSubject(site)
      feature.lineage = {
        ref: UNKNOWN_REF,
        uuid: UNKNOWN_UUID,
        geom: geometryWkt(feature.parent.geometry)
      }
    }
  },
  'lineage-parent-wrong': {
    description:
      'a Retained area habitat names another baseline parcel as its parent, so it lies outside the parent it names',
    errorCode: 'STAGED_PI_OUTSIDE_PARENT',
    category: CATEGORY_LINEAGE,
    applyToSite(site) {
      const feature = lineageSubject(site)
      const other = site.layers.habitats.baseline.find(
        (b) => b !== feature.parent
      )
      if (!other) {
        throw new Error(
          'lineage-parent-wrong needs at least two baseline parcels'
        )
      }
      feature.lineage = {
        ref: other.values[HABITAT_REF],
        uuid: other.uuid,
        geom: geometryWkt(other.geometry)
      }
    }
  },
  'lineage-parent-geom-mismatch': {
    description: `a Retained area habitat's parent_geom is its parent's shape moved ${SHIFT_M} m, as if the baseline changed after the copy`,
    errorCode: 'STAGED_BASELINE_DRIFTED',
    category: CATEGORY_LINEAGE,
    applyToSite(site) {
      const feature = lineageSubject(site)
      feature.lineage = {
        ref: feature.parent.values[HABITAT_REF],
        uuid: feature.parent.uuid,
        geom: geometryWkt(shifted(feature.parent.geometry))
      }
    }
  },
  'lineage-parent-geom-missing': {
    description:
      "a Retained area habitat names its parent by Parent Ref and parent_uuid, but has no parent_geom, so the parent's shape cannot be compared",
    errorCode: ACCEPTED_WITHOUT_SHAPE_CHECK,
    category: CATEGORY_LINEAGE,
    applyToSite(site) {
      const feature = lineageSubject(site)
      feature.lineage = {
        ref: feature.parent.values[HABITAT_REF],
        uuid: feature.parent.uuid,
        geom: null
      }
    }
  },
  'degrade-advance-missing': {
    description:
      'a hedgerow that gets worse (Created in its own type, linked to its parent, in a lower condition) has no years created in advance, where the Metric asks for 30 plus',
    errorCode: NOT_CHECKED_YET,
    category: CATEGORY_DEGRADE,
    worse: { layerKey: 'hedgerows', kind: WORSE.hedge },
    applyToSite(site) {
      const feature = worseSubject(site, 'degrade-advance-missing')
      feature.values[ADVANCE] = null
    }
  },
  'degrade-not-worse': {
    description:
      'a same-type creation that is not worse: a hedgerow Created in its own type, linked to its parent, with 30+ years in advance, in its baseline condition (a 30+ on a row that does not get worse overstates its units)',
    errorCode: NOT_CHECKED_YET,
    category: CATEGORY_DEGRADE,
    worse: { layerKey: 'hedgerows', kind: WORSE.hedge },
    applyToSite(site) {
      const feature = worseSubject(site, 'degrade-not-worse')
      feature.values['Proposed Condition'] =
        feature.parent.values['Baseline Condition']
    }
  },
  'degrade-watercourse-advance-not-encroachment': {
    description:
      'a watercourse whose condition gets worse, with no change of encroachment, is created 10 years in advance, which the Metric allows only where encroachment increases with no other impact',
    errorCode: NOT_CHECKED_YET,
    category: CATEGORY_DEGRADE,
    worse: { layerKey: 'rivers', kind: WORSE.worseWatercourse },
    applyToSite(site) {
      const feature = worseSubject(
        site,
        'degrade-watercourse-advance-not-encroachment'
      )
      feature.values[ADVANCE] = WATERCOURSE_ADVANCE
    }
  },
  'degrade-watercourse-encroachment-no-advance': {
    description:
      'a watercourse whose only change is more encroachment has no years created in advance, though the Metric allows 10 or more for it',
    errorCode: NOT_CHECKED_YET,
    category: CATEGORY_DEGRADE,
    worse: { layerKey: 'rivers', kind: WORSE.encroachedWatercourse },
    applyToSite(site) {
      const feature = worseSubject(
        site,
        'degrade-watercourse-encroachment-no-advance'
      )
      feature.values[ADVANCE] = null
    }
  },
  'degrade-watercourse-retained-and-created': {
    description:
      'a baseline watercourse has both a Retained and a Created post-intervention part. The template records part of a stretch changing by splitting it at the baseline survey, as the service cannot measure part of a watercourse',
    errorCode: NOT_CHECKED_YET,
    category: CATEGORY_DEGRADE,
    worse: { layerKey: 'rivers', kind: WORSE.encroachedWatercourse },
    applyToSite(site) {
      splitWatercourse(
        site,
        worseSubject(site, 'degrade-watercourse-retained-and-created')
      )
    }
  },
  'version-record-missing': {
    description: 'the GeoPackage has no template version record',
    errorCode: NO_BACKEND_CODE_YET,
    category: CATEGORY_VERSION,
    versionRecords: () => []
  },
  'version-record-duplicated': {
    description: 'the GeoPackage has two template version records',
    errorCode: NO_BACKEND_CODE_YET,
    category: CATEGORY_VERSION,
    versionRecords: (version) => [
      versionRecordText(version),
      versionRecordText(version)
    ]
  },
  'version-unsupported': {
    description: `the template version record names a version the service does not support (the next major version after ${CURRENT_TEMPLATE_VERSION})`,
    errorCode: NO_BACKEND_CODE_YET,
    category: CATEGORY_VERSION,
    versionRecords: (version) => [versionRecordText(nextMajorVersion(version))]
  }
}

export const BNG_SERVICE_FLAW_NAMES = Object.keys(BNG_SERVICE_FLAWS)

/** The listFlaws() entries of the BNG Service template flaws. */
export function listBngServiceFlaws() {
  return BNG_SERVICE_FLAW_NAMES.map((name) => {
    const flaw = BNG_SERVICE_FLAWS[name]
    return {
      name,
      description: flaw.description,
      errorCode: flaw.errorCode,
      category: flaw.category,
      categoryLabel: CATEGORY_LABELS[flaw.category],
      standalone: false
    }
  })
}

/**
 * Split a flaw selection into the legacy flaws, for the legacy generator to
 * draw, and the BNG Service template flaws, applied to the converted site.
 * At most one version flaw: each says what the whole record is. At most one
 * lineage flaw and one degrade flaw: two of either would break the same row.
 */
export function partitionFlaws(names = []) {
  const legacy = []
  const lineage = []
  const version = []
  const degrade = []
  for (const name of names) {
    if (LEGACY_ONLY_FLAWS.has(name)) {
      error(
        `Flaw "${name}" cannot be written in the BNG Service template: it has no Count column, each tree point is one tree`
      )
    }
    const flaw = BNG_SERVICE_FLAWS[name]
    if (!flaw) {
      legacy.push(name)
    } else if (flaw.category === CATEGORY_LINEAGE) {
      lineage.push(name)
    } else if (flaw.category === CATEGORY_DEGRADE) {
      degrade.push(name)
    } else {
      version.push(name)
    }
  }
  if (version.length > 1) {
    error(`Only one template-version flaw at a time; got ${version.join(', ')}`)
  }
  if (lineage.length > 1) {
    error(
      `Only one lineage flaw at a time, as each restamps the same feature; got ${lineage.join(', ')}`
    )
  }
  if (degrade.length > 1) {
    error(
      `Only one degraded-habitat flaw at a time, as some break the same row; got ${degrade.join(', ')}`
    )
  }
  return { legacy, lineage, version, degrade }
}

/**
 * Refuse counts that draw none of the habitat that gets worse a degrade flaw
 * breaks, so the flaw is not left to fail later for a reason it cannot name.
 *
 * @param {string[]} names  the degrade flaws asked for
 * @param {Record<string, number>} counts  by kind, as resolveWorseCounts gives
 */
export function assertDegradeSubjectsDrawn(names, counts) {
  for (const name of names) {
    const { kind } = BNG_SERVICE_FLAWS[name].worse
    if (counts[kind] === 0) {
      throw new Error(
        `${name} breaks a habitat that gets worse of kind ${kind}, so worseHabitatCounts cannot set ${kind} to 0`
      )
    }
  }
}

/** Apply degrade flaws to the site, after its habitats that get worse. */
export function applyDegradeFlaws(site, names) {
  for (const name of names) {
    BNG_SERVICE_FLAWS[name].applyToSite(site)
  }
}

/** Apply lineage flaws to the site. */
export function applyLineageFlaws(site, names) {
  for (const name of names) {
    BNG_SERVICE_FLAWS[name].applyToSite(site)
  }
}

/** The version records to write: the template's one, or a version flaw's. */
export function versionRecordsFor(
  versionFlaws,
  version = CURRENT_TEMPLATE_VERSION
) {
  const [flaw] = versionFlaws
  return flaw
    ? BNG_SERVICE_FLAWS[flaw].versionRecords(version)
    : [versionRecordText(version)]
}
