/**
 * A settable clock for GeoPackage metadata timestamps —
 * `gpkg_contents.last_change` and `layer_styles.update_time`.
 *
 * By default it returns wall-clock time (equivalent to the SQL
 * `strftime('%Y-%m-%dT%H:%M:%fZ','now')` DEFAULTs these columns used to rely
 * on). `setFixedTimestamp()` pins it to a constant so a seeded generation run
 * produces byte-identical files — otherwise the timestamps alone would make
 * every file differ. Mirrors the seedable RNG seam in geometry.mjs.
 */

let fixed = null

/** Current metadata timestamp: the pinned value if set, else wall-clock now. */
export function currentTimestamp() {
  return fixed ?? new Date().toISOString()
}

/** Pin the clock to `iso` (an ISO-8601 string) for reproducible output. */
export function setFixedTimestamp(iso) {
  fixed = iso
}

/** Restore wall-clock timestamps. */
export function clearFixedTimestamp() {
  fixed = null
}
