/**
 * Turn a post-intervention GeoPackage into metric workbook rows.
 *
 * This is the inverse of the workbook-driven generator in src/workbook/: one
 * scenario produces the GeoPackage pair, and this derives the matching
 * workbook from the post-intervention half, so the two can never drift.
 *
 * The mapping follows what the service does with the same file, not what the
 * GeoPackage template might allow:
 *
 * - Sizes are measured from the geometry with bng-library/measure, the same
 *   functions the backend prices with, and left unrounded, as the metric
 *   prices them. The "Area" / "Length" attributes are rounded and never
 *   read by the service.
 * - An area habitat's "Lost" is a creation: the baseline parcel is lost and
 *   its proposed habitat created in its place (A-1 loss plus an A-2 row).
 * - A lost hedgerow, watercourse or tree is simply lost: a baseline row with
 *   nothing retained or enhanced, and nothing post-intervention.
 * - A created linear feature or tree has no baseline row at all.
 * - "Location" is free text to the service, so every feature is on-site.
 *
 * Values are passed through as the GeoPackage holds them, bar the few known
 * spelling differences in WORKBOOK_SPELLINGS. Whether the workbook accepts
 * them is `checkVocabulary`'s job, not this module's — converting them any
 * more loosely would hide exactly the mismatches worth finding.
 */

import { INDIVIDUAL_TREE_AREA_HECTARES } from '../metric/index.mjs'
import { openGeoPackageReadonly, wkbToGeoJSON } from '../gpkg-io/index.mjs'
import { areaSquareMetres, lengthMetres } from '../measure/index.mjs'
import {
  isBngServiceGeoPackage,
  workbookRowsFromBngServiceDb
} from './bng-service-rows.mjs'
import {
  CREATED,
  ENHANCED,
  LOST,
  RETAINED,
  normaliseRetention,
  workbookSpelling,
  years
} from './workbook-values.mjs'

export { WORKBOOK_SPELLINGS } from './workbook-values.mjs'

const SQ_METRES_PER_HECTARE = 10_000
const METRES_PER_KM = 1000

const INDIVIDUAL_TREES = 'Individual trees'
const NOT_IRREPLACEABLE = 'No'
const DEFAULT_TREE_COUNT = 1

function geometryColumn(db, table) {
  return db
    .prepare(
      'SELECT column_name AS name FROM gpkg_geometry_columns WHERE table_name = ?'
    )
    .get(table)?.name
}

function readLayer(db, table) {
  const exists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table)
  if (!exists) {
    return []
  }
  const column = geometryColumn(db, table)
  return db
    .prepare(`SELECT * FROM "${table}" ORDER BY rowid`)
    .all()
    .map((row) => ({
      ...row,
      geometry: row[column] ? wkbToGeoJSON(row[column]) : null
    }))
}

function treeType(ruralOrUrban) {
  return ruralOrUrban ? `${ruralOrUrban} tree` : null
}

function treeAreaHectares(size, count) {
  const perTree = INDIVIDUAL_TREE_AREA_HECTARES[size]
  if (perTree === undefined) {
    return null
  }
  return perTree * (Number(count) || DEFAULT_TREE_COUNT)
}

/**
 * One layer's features as { baseline, creation } entries, where `baseline`
 * may carry the enhancement that follows it onto the enhancement sheet.
 * Keeping the enhancement on its baseline row is what guarantees the
 * enhancement sheet's rows line up with the baseline rows the template's
 * formulas pair them with.
 */
function placeFeature({ retention, baseline, proposed, notes, ref }) {
  switch (retention) {
    case RETAINED:
      return { baseline: { ...baseline, retained: baseline.size } }
    case ENHANCED:
      return {
        baseline: {
          ...baseline,
          enhanced: baseline.size,
          enhancement: proposed
        }
      }
    case LOST:
      return { baseline }
    case CREATED:
      return { creation: proposed }
    default:
      notes.push(`${ref}: unrecognised retention category — baseline only`)
      return { baseline }
  }
}

function habitatEntries(features, notes) {
  return features.map((f) => {
    const ref = f['Parcel Ref']
    const size = areaSquareMetres(f.geometry) / SQ_METRES_PER_HECTARE
    const baseline = {
      reference: ref,
      broadHabitat: f['Baseline Broad Habitat Type'],
      habitatType: f['Baseline Habitat Type'],
      irreplaceable: NOT_IRREPLACEABLE,
      size,
      condition: f['Baseline Condition'],
      strategicSignificance: f['Baseline Strategic Significance']
    }
    const proposed = {
      reference: ref,
      broadHabitat: f['Proposed Broad Habitat Type'],
      habitatType: f['Proposed Habitat Type'],
      size,
      condition: f['Proposed Condition'],
      strategicSignificance: f['Proposed Strategic Significance'],
      advanceYears: years(f['Habitat created in advance/years']),
      delayYears: years(f['Delay in starting habitat creation/years'])
    }
    const retention = normaliseRetention(f['Retention Category'])
    // An area habitat's Lost is a creation on the lost land (see header).
    if (retention === LOST) {
      return { baseline, creation: proposed }
    }
    return placeFeature({ retention, baseline, proposed, notes, ref })
  })
}

function treeEntries(features, notes) {
  return features.map((f) => {
    const ref = f['Tree Ref']
    const count = f.Count
    const baseline = {
      reference: ref,
      broadHabitat: INDIVIDUAL_TREES,
      habitatType: treeType(f['Baseline Rural or Urban Tree']),
      irreplaceable: NOT_IRREPLACEABLE,
      size: treeAreaHectares(f['Baseline Tree Size'], count),
      condition: f['Baseline Condition'],
      strategicSignificance: f['Baseline Strategic Significance']
    }
    const proposed = {
      reference: ref,
      broadHabitat: INDIVIDUAL_TREES,
      habitatType: treeType(f['Proposed Rural or Urban Tree']),
      size: treeAreaHectares(f['Proposed Tree Size'], count),
      condition: f['Proposed Condition'],
      strategicSignificance: f['Proposed Strategic Significance'],
      advanceYears: years(f['Habitat Created/Enhanced in advance/years']),
      delayYears: years(
        f['Delay in starting habitat creation/enhancement in years']
      )
    }
    return placeFeature({
      retention: normaliseRetention(f['Retention Category']),
      baseline,
      proposed,
      notes,
      ref
    })
  })
}

function linearEntries(features, notes, typeColumn, extra) {
  return features.map((f) => {
    const ref = f['Parcel Ref']
    const size = lengthMetres(f.geometry) / METRES_PER_KM
    const baseline = {
      reference: ref,
      habitatType: f[`Baseline ${typeColumn}`],
      size,
      condition: f['Baseline Condition'],
      strategicSignificance: f['Baseline Strategic Significance'],
      ...extra(f, 'Baseline')
    }
    const proposed = {
      reference: ref,
      habitatType: f[`Proposed ${typeColumn}`],
      size,
      condition: f['Proposed Condition'],
      strategicSignificance: f['Proposed Strategic Significance'],
      advanceYears: years(f['Habitat created in advance/years']),
      delayYears: years(f['Delay in starting habitat creation/years']),
      ...extra(f, 'Proposed')
    }
    return placeFeature({
      retention: normaliseRetention(f['Retention Category']),
      baseline,
      proposed,
      notes,
      ref
    })
  })
}

const noExtra = () => ({})

function encroachment(f, side) {
  return {
    watercourseEncroachment: f[`${side} Encroachment into Watercourse`],
    riparianEncroachment: workbookSpelling(
      'riparianEncroachment',
      f[`${side} Encroachment into riparian zone`]
    )
  }
}

/** Split placed entries into the three sheets of one habitat kind. */
function toSheets(entries) {
  const baseline = entries.filter((e) => e.baseline).map((e) => e.baseline)
  return {
    baseline: baseline.map(({ enhancement, ...row }) => row),
    creation: entries.filter((e) => e.creation).map((e) => e.creation),
    enhancement: baseline.filter((b) => b.enhancement).map((b) => b.enhancement)
  }
}

/**
 * Read a post-intervention GeoPackage into rows for each input sheet. A file
 * in the BNG Service template format, which holds both stages, is read by
 * `workbookRowsFromBngService`.
 *
 * @param {string} postInterventionPath
 * @returns {{ rows: Record<string, object[]>, notes: string[] }} rows keyed
 *   as METRIC_SHEETS is, each row keyed by that sheet's column names
 */
export function workbookRowsFromGeoPackage(postInterventionPath) {
  const db = openGeoPackageReadonly(postInterventionPath)
  const notes = []
  try {
    if (isBngServiceGeoPackage(db)) {
      return workbookRowsFromBngServiceDb(db)
    }
    const areas = toSheets([
      ...habitatEntries(readLayer(db, 'Habitats'), notes),
      ...treeEntries(readLayer(db, 'Urban Trees'), notes)
    ])
    const hedgerows = toSheets(
      linearEntries(readLayer(db, 'Hedgerows'), notes, 'Hedge Type', noExtra)
    )
    const watercourses = toSheets(
      linearEntries(readLayer(db, 'Rivers'), notes, 'River Type', encroachment)
    )
    return {
      rows: {
        habitatBaseline: areas.baseline,
        habitatCreation: areas.creation,
        habitatEnhancement: areas.enhancement,
        hedgerowBaseline: hedgerows.baseline,
        hedgerowCreation: hedgerows.creation,
        hedgerowEnhancement: hedgerows.enhancement,
        watercourseBaseline: watercourses.baseline,
        watercourseCreation: watercourses.creation,
        watercourseEnhancement: watercourses.enhancement
      },
      notes
    }
  } finally {
    db.close()
  }
}
