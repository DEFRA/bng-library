/**
 * Retention vocabulary translation.
 *
 * The row builders and synthetic generators use an internal four-value
 * vocabulary — Retained / Enhanced / Lost / Created — where "Created" tags
 * a created parcel or feature for accounting purposes.
 *
 * The NE QGIS template splits on layer type:
 *
 * - Area habitats have three values (Retained / Enhanced / Lost) and carry
 *   creation on a Lost row — `Habitat retention descriptor - post.csv` reads
 *   `Lost,To be created`.
 * - Hedgerows, watercourses and individual trees have a fourth value,
 *   "Created", offered when the baseline type is "To be created". See
 *   `Hedgerow Retention Options.csv`, `Watercourse Retention Options.csv`
 *   and `Individual tree Retention.csv`.
 *
 * So translating Created → Lost is right for areas and wrong for linears: it
 * makes a brand-new feature indistinguishable from a removal, and a removal
 * is something a consumer is entitled to drop. Area habitats translate;
 * linears write "Created" through and take the placeholders the template's
 * dependent lists resolve "To be created" to.
 */

export const RETENTION_CREATED = 'Created'
export const RETENTION_LOST = 'Lost'

/**
 * The baseline *type* of a created hedgerow or watercourse. This is a genuine,
 * selectable entry in the baseline type lists, not a blank.
 */
export const BASELINE_TO_BE_CREATED = 'To be created'

/**
 * What every other baseline attribute of a created linear feature takes. The
 * condition, strategic-significance, distinctiveness and encroachment lists
 * all resolve "To be created" to the literal "N/A".
 */
export const BASELINE_NOT_APPLICABLE = 'N/A'

/**
 * Individual trees key their baseline lists on the "Category" column rather
 * than on a baseline type: "Newly Planted" is what drives every baseline
 * attribute — size, condition, strategic significance, type, rural/urban — to
 * "N/A" (`Individual tree Size - pre.csv` and its siblings).
 */
export const TREE_CATEGORY_NEWLY_PLANTED = 'Newly Planted'
export const TREE_CATEGORY_EXISTING = 'Existing'

/**
 * Translate an area habitat's internal retention to the gpkg column value.
 * Call at every column-write site that emits an area habitat's retention.
 */
export function gpkgAreaRetention(internalRetention) {
  return internalRetention === RETENTION_CREATED
    ? RETENTION_LOST
    : internalRetention
}

/**
 * The "Baseline Hedge Type" / "Baseline River Type" column of a
 * post-intervention linear row. A created feature has no baseline, so it takes
 * the template's own placeholder type.
 */
export function baselineLinearType(internalRetention, type) {
  if (internalRetention === RETENTION_CREATED) {
    return BASELINE_TO_BE_CREATED
  }
  return type ?? null
}

/**
 * Any other baseline-side column of a post-intervention linear row —
 * condition, strategic significance, distinctiveness, encroachment, and every
 * baseline column of an individual tree.
 */
export function baselineLinearAttribute(internalRetention, value) {
  if (internalRetention === RETENTION_CREATED) {
    return BASELINE_NOT_APPLICABLE
  }
  return value ?? null
}

/**
 * The individual-tree "Category" column, which the template uses to say
 * whether the tree existed at baseline or is being planted.
 */
export function treeCategory(internalRetention) {
  return internalRetention === RETENTION_CREATED
    ? TREE_CATEGORY_NEWLY_PLANTED
    : TREE_CATEGORY_EXISTING
}
