/**
 * Derive a baseline GeoPackage from a synthetic (post-intervention-shaped)
 * one.
 *
 * Synthetic mode emits a single file carrying both the baseline and the
 * proposed state on every row, so it models the end state but has no
 * pre-development half. A two-stage upload needs both, sharing one redline.
 *
 * Rather than generate a second file — which would randomise fresh geometry
 * and so share nothing with the first — this copies the file and clears the
 * proposed state. The redline, the parcel partition and every feature ref are
 * therefore identical by construction, which is exactly what the pair
 * contract requires.
 */

import { copyFileSync } from 'node:fs'
import { openGeoPackage } from '../bng-schema.mjs'

/**
 * Columns describing the proposed state, per layer. Cleared to NULL in the
 * baseline half; everything else (geometry, refs, baseline attributes, site
 * metadata, Location) carries over untouched. Matches the shape the workbook
 * baseline writers already produce.
 */
const PROPOSED_COLUMNS = Object.freeze({
  Habitats: [
    'Retention Category',
    'Proposed Broad Habitat Type',
    'Proposed Habitat Type',
    'Proposed Condition',
    'Proposed Strategic Significance',
    'Habitat created in advance/years',
    'Delay in starting habitat creation/years',
    'Spatial risk category',
    'Proposed Distinctiveness'
  ],
  Hedgerows: [
    'Retention Category',
    'Proposed Hedge Type',
    'Proposed Condition',
    'Proposed Strategic Significance',
    'Habitat created in advance/years',
    'Delay in starting habitat creation/years',
    'Spatial risk category',
    'Proposed Distinctiveness'
  ],
  Rivers: [
    'Retention Category',
    'Proposed River Type',
    'Proposed Condition',
    'Proposed Strategic Significance',
    'Habitat created in advance/years',
    'Delay in starting habitat creation/years',
    'Spatial risk category',
    'Proposed Encroachment into Watercourse',
    'Proposed Encroachment into riparian zone',
    'Enhancement Type',
    'Proposed Distinctiveness'
  ],
  'Urban Trees': [
    'Retention Category',
    'Category',
    'Proposed Tree Size',
    'Proposed Condition',
    'Proposed Strategic Significance',
    'Proposed Tree Type',
    'Habitat Created/Enhanced in advance/years',
    'Delay in starting habitat creation/enhancement in years',
    'Spatial risk category',
    'Proposed Rural or Urban Tree'
  ]
})

function tableExists(db, table) {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table)
  )
}

function existingColumns(db, table) {
  return new Set(
    db
      .prepare(`PRAGMA table_info("${table}")`)
      .all()
      .map((c) => c.name)
  )
}

/**
 * Copy `sourcePath` to `outPath` and clear the proposed state, yielding the
 * baseline half of the pair.
 *
 * @param {string} sourcePath post-intervention-shaped gpkg to derive from
 * @param {string} outPath where to write the baseline
 * @returns {{ table: string, cleared: number }[]} rows cleared per layer
 */
export function deriveBaselineFromSynthetic(sourcePath, outPath) {
  copyFileSync(sourcePath, outPath)
  const db = openGeoPackage(outPath)
  const summary = []
  try {
    for (const [table, columns] of Object.entries(PROPOSED_COLUMNS)) {
      if (!tableExists(db, table)) {
        continue
      }
      const present = existingColumns(db, table)
      const clearable = columns.filter((c) => present.has(c))
      if (clearable.length === 0) {
        continue
      }
      const assignments = clearable.map((c) => `"${c}" = NULL`).join(', ')
      const { changes } = db
        .prepare(`UPDATE "${table}" SET ${assignments}`)
        .run()
      summary.push({ table, cleared: changes })
    }
  } finally {
    db.close()
  }
  return summary
}
