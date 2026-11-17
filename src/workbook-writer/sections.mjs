/**
 * The references of a baseline watercourse split into sections for the
 * metric (bng-service-rows.mjs): one baseline row per Retained or Enhanced
 * part, as the metric asks of a watercourse partly retained and partly
 * enhanced (user guide, Watercourse enhancement). The service holds the
 * parent as one feature, so the comparison reads each section's reference
 * back as the parent's. Kept apart from the GeoPackage reader so that the
 * comparison can use it without the reader's dependencies.
 */

const SECTION_SUFFIX = / \(section \d+\)$/

/**
 * The reference of one section of a baseline watercourse split for the
 * metric: the parent's ref, numbered from 1.
 *
 * @param {string} reference
 * @param {number} number
 * @returns {string}
 */
export function sectionReference(reference, number) {
  return `${reference} (section ${number})`
}

/**
 * The baseline feature a workbook row's reference stands for: a section's
 * parent, or the reference itself.
 *
 * @param {string} reference
 * @returns {string}
 */
export function sectionParentReference(reference) {
  return String(reference).replace(SECTION_SUFFIX, '')
}
