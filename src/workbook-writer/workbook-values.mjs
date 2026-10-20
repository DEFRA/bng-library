/**
 * Values both GeoPackage readers write into the metric workbook in its own
 * words: the spellings the workbook differs on, the retention categories as
 * the service reads them, and years in advance or delay.
 */

export const RETAINED = 'Retained'
export const ENHANCED = 'Enhanced'
export const LOST = 'Lost'
export const CREATED = 'Created'

/**
 * List entries the GeoPackage template and the metric workbook spell
 * differently for the same category. The workbook puts a space after the
 * slash in most riparian encroachment pairs; written without it, the metric's
 * lookup fails and the row silently generates nothing. Only spellings listed
 * here are translated — anything else reaches the vocabulary check as it is.
 */
export const WORKBOOK_SPELLINGS = Object.freeze({
  riparianEncroachment: Object.freeze({
    'Moderate/Moderate': 'Moderate/ Moderate',
    'Moderate/Minor': 'Moderate/ Minor',
    'Moderate/No Encroachment': 'Moderate/ No Encroachment',
    'Minor/Minor': 'Minor/ Minor',
    'Minor/No Encroachment': 'Minor/ No Encroachment',
    'No Encroachment/No Encroachment': 'No Encroachment/ No Encroachment'
  })
})

export function workbookSpelling(field, value) {
  return WORKBOOK_SPELLINGS[field]?.[value] ?? value
}

// Retention values sometimes arrive numbered ("3. Lost"), as the NE template's
// list entries once were; the service strips the prefix, and so does this.
const NUMBERED_PREFIX = /^\d+\.\s*/

/** A retention category, unnumbered and in its own case; null if unknown. */
export function normaliseRetention(value) {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim().replace(NUMBERED_PREFIX, '')
  const known = [RETAINED, ENHANCED, LOST, CREATED]
  return known.find((k) => k.toLowerCase() === trimmed.toLowerCase()) ?? null
}

/** Years as the workbook's list holds them: a number where there is one. */
export function years(value) {
  if (value === null || value === undefined || value === '') {
    return 0
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : value
}
