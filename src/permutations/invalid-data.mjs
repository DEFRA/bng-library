/**
 * Which scenarios hold invalid data, and what counts as invalid.
 *
 * A scenario that deliberately holds invalid data says so in its id, which
 * names its files: it starts `invalid-`. Every other scenario must be valid
 * throughout, filler features included, so a file whose name does not say
 * "invalid" never carries an error a tester might mistake for the service's.
 */

export const INVALID_PREFIX = 'invalid-'

export const isInvalidScenario = (scenario) =>
  scenario.id.startsWith(INVALID_PREFIX)

/**
 * Whether a metric row warning reports invalid data. The metric marks an
 * error with ▲ ("Error - Can not reduce condition ▲", "Not Possible ▲"), a
 * row that computes nothing with "Check Data", and a broken lookup with an
 * Excel error value. A ⚠ "Check details …" note is advice about valid data
 * (evidence that advance creation is in place, say), so it does not count.
 */
export function isDataError(message) {
  return (
    message.includes('▲') ||
    /^check data\b/i.test(message) ||
    /^#[A-Z/0!?]+/.test(message)
  )
}
