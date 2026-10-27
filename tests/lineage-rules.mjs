/**
 * Queries for the lineage rules the backend enforces on a BNG Service file
 * (DEFRA/bng-metric-backend#541), shared by the suites that check the
 * library never writes a file those rules refuse.
 */
import Database from 'better-sqlite3'

/** The only watercourses the template may lose (guide: natural rivers cannot be permanently lost). */
export const REMOVABLE_RIVER_TYPES = new Set(['Canals', 'Ditches'])

function all(file, sql) {
  const db = new Database(file, { readonly: true })
  try {
    return db.prepare(sql).all()
  } finally {
    db.close()
  }
}

/** The Created area rows in their parent's own type, by Habitat Ref. */
export function ownTypeCreations(file) {
  return all(
    file,
    `SELECT p."Habitat Ref" AS ref, p."Comment" AS comment
       FROM "Area Habitats Post-Intervention" p
       JOIN "Area Habitats Baseline" b ON b.feature_uuid = p.parent_uuid
      WHERE p."Retention Category" = 'Created'
        AND p."Proposed Habitat Type" = b."Baseline Habitat Type"`
  )
}

/** The baseline watercourses no post-intervention row names, by type. */
export function lostRiverTypes(file) {
  return all(
    file,
    `SELECT b."Baseline River Type" AS type
       FROM "Watercourses Baseline" b
      WHERE NOT EXISTS (
        SELECT 1 FROM "Watercourses Post-Intervention" p
         WHERE p.parent_uuid = b.feature_uuid)`
  ).map((row) => row.type)
}
