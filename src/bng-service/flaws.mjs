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
 */

import { error } from '../log.mjs'
import { geometryWkt, HABITAT_REF } from './site.mjs'
import { CURRENT_TEMPLATE_VERSION, versionRecordText } from './schema.mjs'

export const CATEGORY_LINEAGE = 'lineage'
export const CATEGORY_VERSION = 'version'

const CATEGORY_LABELS = {
  [CATEGORY_LINEAGE]: 'lineage',
  [CATEGORY_VERSION]: 'template-version'
}

const NO_BACKEND_CODE_YET =
  '(refused; the service does not check the version yet)'
const ACCEPTED_WITHOUT_SHAPE_CHECK =
  '(accepted; the service skips the shape check without parent_geom)'
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
 * At most one version flaw: each says what the whole record is.
 */
export function partitionFlaws(names = []) {
  const legacy = []
  const lineage = []
  const version = []
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
  return { legacy, lineage, version }
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
