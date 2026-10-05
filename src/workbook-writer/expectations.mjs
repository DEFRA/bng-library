/**
 * Check a scenario's declared expectations against the metric's own verdict.
 *
 * A scenario can say what the metric should make of it — the 10% net gain met
 * or not, a trading rule breached, a particular warning raised on its subject
 * feature, its features' units falling in a particular order or matching, or
 * a feature's time to target condition. Checking those against the
 * recalculated workbook keeps the corpus honest: a scenario that no longer
 * demonstrates what it claims to fails here, before anyone compares a service
 * run against it.
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
 * The features' units at one stage must fall strictly, in the order listed.
 * Strictly, so a metric that prices them all the same fails.
 */
function unitOrderCheck({ stage, references }, results) {
  const units = references.map(
    (ref) =>
      results.features.find((f) => f.stage === stage && f.reference === ref)
        ?.units ?? 'missing'
  )
  const descending = units.every(
    (u, i) => typeof u === 'number' && (i === 0 || u < units[i - 1])
  )
  return {
    check: `${stage} units in order`,
    expected: references.join(' > '),
    actual: references.map((ref, i) => `${ref} ${units[i]}`).join(', '),
    passed: descending
  }
}

// Units and multipliers the metric computes the same way agree far closer.
const TOLERANCE = 1e-9

const isClose = (a, b) =>
  typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= TOLERANCE

function featureAt(results, stage, reference) {
  return results.features.find(
    (f) => f.stage === stage && f.reference === reference
  )
}

/**
 * The features' units at one stage must all be the same: features that
 * differ only in something the metric should ignore, such as a delay to a
 * "30+" time to target condition.
 */
function unitsEqualCheck({ stage, references }, results) {
  const units = references.map(
    (ref) => featureAt(results, stage, ref)?.units ?? 'missing'
  )
  return {
    check: `${stage} units equal`,
    expected: references.join(' = '),
    actual: references.map((ref, i) => `${ref} ${units[i]}`).join(', '),
    passed: units.every((u) => isClose(u, units[0]))
  }
}

const describeTime = (years, multiplier) => `${years} (×${multiplier})`

/**
 * A created or enhanced feature's final time to target condition, and the
 * multiplier the metric applies for it. "30+" is text in the metric, so a
 * workbook that reads it as 30 shows 30 here, and the multiplier for 30.
 */
function timeToTargetCheck(stage, reference, years, multiplier, results) {
  const feature = featureAt(results, stage, reference)
  const actual = feature
    ? describeTime(feature.timeToTarget, feature.timeToTargetMultiplier)
    : 'missing'
  return {
    check: `${stage} time to target on ${reference}`,
    expected: describeTime(years, multiplier),
    actual,
    passed:
      feature !== undefined &&
      String(feature.timeToTarget) === String(years) &&
      isClose(feature.timeToTargetMultiplier, multiplier)
  }
}

/** One check per feature an `expectTimeToTarget` entry lists. */
function timeToTargetChecks(entries, results) {
  return entries.flatMap(({ stage, references, years, multiplier }) =>
    references.map((ref) =>
      timeToTargetCheck(stage, ref, years, multiplier, results)
    )
  )
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
  if (scenario.expectUnitOrder) {
    checks.push(unitOrderCheck(scenario.expectUnitOrder, results))
  }
  if (scenario.expectUnitsEqual) {
    checks.push(unitsEqualCheck(scenario.expectUnitsEqual, results))
  }
  checks.push(...timeToTargetChecks(scenario.expectTimeToTarget ?? [], results))
  for (const target of scenario.expectRejectedInputs ?? []) {
    checks.push(rejectedInputCheck(target, scenario, issues))
  }
  if (!isInvalidScenario(scenario)) {
    checks.push(validDataCheck(results, issues))
  }
  return checks
}
