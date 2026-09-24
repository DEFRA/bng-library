/**
 * Check a scenario's declared expectations against the metric's own verdict.
 *
 * A scenario can say what the metric should make of it — the 10% net gain met
 * or not, a trading rule breached, a particular warning raised on its subject
 * feature. Checking those against the recalculated workbook keeps the corpus
 * honest: a scenario that no longer demonstrates what it claims to fails
 * here, before anyone compares a service run against it.
 */

import {
  isDataError,
  isInvalidScenario
} from '../permutations/invalid-data.mjs'

// Data errors quoted in a failed valid-data check.
const ERRORS_QUOTED = 3

// A trading summary's verdict reads "Yes ✓" or "No ▲".
const NOT_SATISFIED = /^no\b/i

function gainVerdict(percent, target) {
  if (typeof percent !== 'number') {
    return String(percent)
  }
  return percent >= target ? 'met' : 'unmet'
}

function gainCheck(scenario, headline) {
  const actual = gainVerdict(headline.netPercentChange.area, headline.target)
  return {
    check: 'net gain',
    expected: scenario.expectGain,
    actual,
    passed: actual === scenario.expectGain
  }
}

/**
 * A warning is on the subject when a row carrying its reference shows it, or
 * when the sheet it sits on shows it in its summary block.
 */
function warningCheck(text, scenario, results) {
  const ref = scenario.subject?.ref
  const onSubject = results.rowWarnings
    .filter((w) => w.reference === ref && w.message.includes(text))
    .map((w) => `${w.sheet}!${w.cell}`)
  const onSheet = results.sheetWarnings
    .filter((w) => w.message.includes(text))
    .map((w) => `${w.sheet}!${w.cell}`)
  const found = [...onSubject, ...onSheet]
  return {
    check: `warning on ${ref ?? 'workbook'}`,
    expected: text,
    actual: found.length > 0 ? found.join(', ') : 'not raised',
    passed: found.length > 0
  }
}

const MET = 'met'
const BREACHED = 'breached'

function tradingCheck(kind, band, expected, results) {
  const verdict = results.trading[kind]?.find((t) => t.distinctiveness === band)
  const satisfied = verdict?.satisfied ?? null
  let actual = 'missing'
  if (satisfied !== null) {
    actual = NOT_SATISFIED.test(satisfied) ? BREACHED : MET
  }
  return {
    check: `${kind} trading rule, ${band}`,
    expected,
    actual,
    passed: actual === expected
  }
}

function rejectedInputCheck(target, scenario, issues) {
  const ref = scenario.subject?.ref
  const [sheet, field] = target.split('.')
  const found = issues.find(
    (i) => i.sheet === sheet && i.field === field && i.reference === ref
  )
  return {
    check: `input rejected on ${ref}`,
    expected: target,
    actual: found ? `${found.value} (${found.problem})` : 'accepted',
    passed: Boolean(found)
  }
}

/**
 * A scenario not named `invalid-` must be valid throughout: no metric error
 * on any row and no input the workbook rejects, filler features included.
 */
function validDataCheck(results, issues) {
  const errors = [
    ...results.rowWarnings
      .filter((w) => isDataError(w.message))
      .map((w) => `${w.reference}: ${w.message}`),
    ...issues.map((i) => `${i.reference}: ${i.sheet}.${i.field} "${i.value}"`)
  ]
  const more =
    errors.length > ERRORS_QUOTED
      ? `, and ${errors.length - ERRORS_QUOTED} more`
      : ''
  return {
    check: 'valid data (no metric errors or rejected inputs)',
    expected: 'none',
    actual: errors.length
      ? `${errors.slice(0, ERRORS_QUOTED).join('; ')}${more}`
      : 'none',
    passed: errors.length === 0
  }
}

/**
 * @param {object} scenario a catalogue entry
 * @param {object} results from readMetricResults
 * @param {object[]} [issues] from checkVocabulary
 * @returns {{ check: string, expected: string, actual: string,
 *   passed: boolean }[]} one per declared expectation, and for a scenario
 *   not named `invalid-` a check that its data is valid throughout
 */
export function checkScenarioExpectations(scenario, results, issues = []) {
  const checks = []
  if (scenario.expectGain) {
    checks.push(gainCheck(scenario, results.headline))
  }
  for (const text of scenario.expectMetricWarnings ?? []) {
    checks.push(warningCheck(text, scenario, results))
  }
  for (const [kind, bands] of Object.entries(scenario.expectTrading ?? {})) {
    for (const [band, expected] of Object.entries(bands)) {
      checks.push(tradingCheck(kind, band, expected, results))
    }
  }
  for (const target of scenario.expectRejectedInputs ?? []) {
    checks.push(rejectedInputCheck(target, scenario, issues))
  }
  if (!isInvalidScenario(scenario)) {
    checks.push(validDataCheck(results, issues))
  }
  return checks
}
