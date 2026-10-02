/**
 * Compare the service's figures with the metric's, figure by figure.
 *
 * Two numbers match when they differ by no more than floating-point noise:
 * within TOLERANCE.relative of the metric's value, or within
 * TOLERANCE.absolute where that value is at or near zero. Both sides carry at
 * most 15 significant figures, but the engine and the workbook sum and
 * multiply in a different order, so a total can differ in its 14th figure;
 * that is arithmetic, not a disagreement. A match that is not exact is still
 * recorded, with its difference, so it stays visible. A verdict (Met / Not
 * met) must be equal. Any other difference is reported with how far the
 * service is from the metric, in units and relative to the metric's value.
 */

import { roundToSigFigs } from '../metric/utils.mjs'
import { isInvalidScenario } from '../permutations/invalid-data.mjs'
import { causesOfFeatureDifference } from './causes.mjs'
import { CATEGORY, SIZE_UNIT, unitsOf } from './figures.mjs'
import { gapCovering, SERVICE_GAPS } from './service-gaps.mjs'

export const OUTCOME = Object.freeze({
  /** The service accepted the pair and every figure matched. */
  matched: 'matched',
  /** The service accepted the pair and at least one figure differs. */
  discrepancies: 'discrepancies',
  /** The service refused a file of a scenario whose data is valid. */
  rejected: 'rejected',
  /** The service refused a file of a scenario built to hold invalid data. */
  rejectedAsExpected: 'rejected-as-expected',
  /**
   * The service accepted a scenario built to hold invalid data. Its figures
   * are still compared, but however they compare the scenario fails: the
   * service should have refused it.
   */
  acceptedInvalid: 'accepted-invalid',
  /** The metric workbook's answers could not be read, so nothing was compared. */
  workbookUnreadable: 'workbook-unreadable',
  /**
   * The service threw while importing the pair, so nothing was compared. A
   * crash is a finding in its own right, so the scenario is reported rather
   * than stopping the run.
   */
  importFailed: 'import-failed'
})

export const DIFFERENCE = Object.freeze({
  different: 'different',
  missingFromService: 'missing-from-service',
  missingFromWorkbook: 'missing-from-workbook'
})

/**
 * How close two numbers must be to match: close enough to absorb the
 * floating-point noise of the engine and the workbook adding up the same
 * figures in a different order (up to ~1e-13 relative on the corpus), and no
 * closer. The comparison exists to catch the service calculating differently,
 * however little that moves a figure — pricing a rounded size moves a
 * feature's units by ~1e-8 relative even on a very large parcel — so the
 * tolerance is not sized by what could change a project's outcome. The
 * absolute floor is for figures at zero, where no relative tolerance can pass
 * anything.
 */
export const TOLERANCE = Object.freeze({ relative: 1e-12, absolute: 1e-12 })

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalise(value) {
  return isNumber(value) ? roundToSigFigs(value) : (value ?? null)
}

function withinTolerance(expected, actual) {
  if (!isNumber(expected) || !isNumber(actual)) {
    return false
  }
  const difference = Math.abs(actual - expected)
  return (
    difference <= TOLERANCE.absolute ||
    difference <= TOLERANCE.relative * Math.abs(expected)
  )
}

function describe(figure) {
  const { key, category, module, label } = figure
  return { key, category, module, label, ...unitsOf(figure) }
}

/**
 * For a feature's units, what they were priced on: the size on each side
 * (hectares, or kilometres for the linear modules) and the strategic
 * significance multiplier the metric applied. The service applies none.
 */
function pricedOn(expectedFigure, actualFigure) {
  const figure = expectedFigure ?? actualFigure
  if (figure.category !== CATEGORY.featureUnits) {
    return {}
  }
  return {
    metricSize: expectedFigure?.size ?? null,
    serviceSize: actualFigure?.size ?? null,
    sizeUnit: SIZE_UNIT[figure.module],
    strategicSignificanceMultiplier:
      expectedFigure?.strategicSignificanceMultiplier ?? null
  }
}

/**
 * How far `actual` is from `expected`: the difference in the figure's own
 * terms (units, percentage points), and relative to the expected value.
 */
function distance(expected, actual) {
  if (!isNumber(expected) || !isNumber(actual)) {
    return { difference: null, relativeDifference: null }
  }
  const difference = roundToSigFigs(actual - expected)
  return {
    difference,
    relativeDifference:
      expected === 0 ? null : roundToSigFigs(difference / Math.abs(expected))
  }
}

function discrepancy(figures, expected, actual, kind) {
  const [expectedFigure, actualFigure] = figures
  const figure = expectedFigure ?? actualFigure
  return {
    ...describe(figure),
    kind,
    expected,
    actual,
    ...distance(expected, actual),
    ...pricedOn(expectedFigure, actualFigure),
    ...(figure.source ? { source: figure.source } : {})
  }
}

/**
 * One key's verdict: `match`, a `discrepancy`, or `notImplemented` when a
 * service gap explains the figure's absence.
 */
function compareKey(expectedFigure, actualFigure, gaps) {
  const figure = expectedFigure ?? actualFigure
  if (!actualFigure) {
    const gap = gapCovering(expectedFigure, gaps)
    if (gap) {
      return {
        notImplemented: {
          ...describe(figure),
          gap: gap.id,
          expected: normalise(expectedFigure.value)
        }
      }
    }
  }
  // A side without the figure means zero where the figure is one a side
  // leaves out at zero. Otherwise, where the other side has no value either
  // (the metric computed nothing on an invalid row, and neither did the
  // service), the two agree.
  const absent = figure.zeroWhenAbsent ? 0 : undefined
  const expected = expectedFigure ? normalise(expectedFigure.value) : absent
  const actual = actualFigure ? normalise(actualFigure.value) : absent
  if ((expected ?? null) === null && (actual ?? null) === null) {
    return { match: true }
  }
  if (expected === undefined) {
    return {
      discrepancy: discrepancy(
        [expectedFigure, actualFigure],
        null,
        actual,
        DIFFERENCE.missingFromWorkbook
      )
    }
  }
  if (actual === undefined) {
    return {
      discrepancy: discrepancy(
        [expectedFigure, actualFigure],
        expected,
        null,
        DIFFERENCE.missingFromService
      )
    }
  }
  if (expected === actual) {
    return { match: true }
  }
  if (withinTolerance(expected, actual)) {
    return {
      match: true,
      withinTolerance: discrepancy(
        [expectedFigure, actualFigure],
        expected,
        actual,
        DIFFERENCE.different
      )
    }
  }
  const causes = causesOfFeatureDifference(expectedFigure, actualFigure)
  return {
    discrepancy: {
      ...discrepancy(
        [expectedFigure, actualFigure],
        expected,
        actual,
        DIFFERENCE.different
      ),
      ...(causes.length > 0 ? { causes } : {})
    }
  }
}

/**
 * @param {import('./figures.mjs').Figure[]} expected the workbook's figures
 * @param {import('./figures.mjs').Figure[]} actual the service's figures
 * @param {{ gaps?: readonly import('./service-gaps.mjs').ServiceGap[] }} [options]
 * @returns {{ compared: number, matched: number, withinTolerance: object[],
 *   discrepancies: object[], notImplemented: object[] }} `withinTolerance`
 *   lists the matches that are not exact, each with its difference
 */
export function compareFigures(expected, actual, { gaps = SERVICE_GAPS } = {}) {
  const expectedByKey = new Map(expected.map((f) => [f.key, f]))
  const actualByKey = new Map(actual.map((f) => [f.key, f]))
  const keys = [...new Set([...expectedByKey.keys(), ...actualByKey.keys()])]

  const result = {
    compared: 0,
    matched: 0,
    withinTolerance: [],
    discrepancies: [],
    notImplemented: []
  }
  for (const key of keys) {
    const verdict = compareKey(
      expectedByKey.get(key),
      actualByKey.get(key),
      gaps
    )
    if (verdict.notImplemented) {
      result.notImplemented.push(verdict.notImplemented)
      continue
    }
    result.compared += 1
    if (verdict.match) {
      result.matched += 1
      if (verdict.withinTolerance) {
        result.withinTolerance.push(verdict.withinTolerance)
      }
    } else {
      result.discrepancies.push(verdict.discrepancy)
    }
  }
  return result
}

function acceptedOutcome(invalidData, comparison) {
  if (invalidData) {
    return OUTCOME.acceptedInvalid
  }
  return comparison.discrepancies.length === 0
    ? OUTCOME.matched
    : OUTCOME.discrepancies
}

/**
 * Compare one scenario: the metric's answers against the service's import of
 * the same GeoPackage pair.
 *
 * @param {object} options
 * @param {{ id: string }} options.scenario a catalogue or manifest entry
 * @param {import('./figures.mjs').Figure[]} options.expected
 * @param {{ accepted: true, figures: import('./figures.mjs').Figure[] } |
 *   { accepted: false, rejectedFile: string, errors: object[] }} [options.service]
 *   what the service made of the pair; absent when its import threw
 *   (`serviceError`)
 * @param {readonly import('./service-gaps.mjs').ServiceGap[]} [options.gaps]
 * @param {string} [options.workbookError] why the metric workbook's answers
 *   could not be read; the scenario is then reported, not compared
 * @param {string} [options.serviceError] why the service's import threw; the
 *   scenario is then reported as import-failed, not compared
 */
export function compareScenario({
  scenario,
  expected,
  service,
  gaps,
  workbookError,
  serviceError
}) {
  const base = {
    id: scenario.id,
    invalidData: scenario.invalidData ?? isInvalidScenario(scenario)
  }
  if (workbookError) {
    return {
      ...base,
      outcome: OUTCOME.workbookUnreadable,
      errors: [{ code: 'WORKBOOK_UNREADABLE', message: workbookError }]
    }
  }
  if (serviceError) {
    return {
      ...base,
      outcome: OUTCOME.importFailed,
      errors: [{ code: 'IMPORT_FAILED', message: serviceError }]
    }
  }
  if (!service.accepted) {
    return {
      ...base,
      outcome: base.invalidData ? OUTCOME.rejectedAsExpected : OUTCOME.rejected,
      rejectedFile: service.rejectedFile,
      errors: service.errors
    }
  }
  const comparison = compareFigures(expected, service.figures, { gaps })
  return {
    ...base,
    outcome: acceptedOutcome(base.invalidData, comparison),
    ...comparison
  }
}
