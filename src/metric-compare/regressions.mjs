/**
 * Regression tracking: the discrepancies a run is known to have, recorded so
 * that CI fails on a change rather than on every difference already known.
 *
 * Any difference beyond the tolerance counts, so a service that does not yet agree with the
 * metric everywhere would fail every run until all of it was fixed. Instead
 * the current discrepancies are recorded as known, each with both values, and
 * a run fails when a scenario's outcome or discrepancies differ from what is
 * recorded: a new discrepancy, a figure that moved, or a discrepancy that has
 * gone (fixed, so the record needs updating).
 */

/**
 * The record of a run's discrepancies, for committing beside the tests.
 *
 * @param {object[]} results compareScenario results
 * @returns {Record<string, { outcome: string, discrepancies?: Record<string,
 *   { expected: unknown, actual: unknown }> }>}
 */
export function knownDiscrepanciesFrom(results) {
  const known = {}
  for (const result of [...results].sort((a, b) => a.id.localeCompare(b.id))) {
    const entry = { outcome: result.outcome }
    if (result.discrepancies?.length) {
      entry.discrepancies = Object.fromEntries(
        [...result.discrepancies]
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((d) => [d.key, { expected: d.expected, actual: d.actual }])
      )
    }
    known[result.id] = entry
  }
  return known
}

function sameValues(a, b) {
  return a.expected === b.expected && a.actual === b.actual
}

function discrepancyChanges(id, recorded = {}, current = {}) {
  const changes = []
  for (const [key, now] of Object.entries(current)) {
    const was = recorded[key]
    if (!was) {
      changes.push({ id, key, change: 'new', now })
    } else if (!sameValues(was, now)) {
      changes.push({ id, key, change: 'changed', was, now })
    }
  }
  for (const [key, was] of Object.entries(recorded)) {
    if (!current[key]) {
      changes.push({ id, key, change: 'resolved', was })
    }
  }
  return changes
}

/**
 * Every way a run differs from the recorded discrepancies.
 *
 * @param {object[]} results compareScenario results
 * @param {ReturnType<typeof knownDiscrepanciesFrom>} known
 * @returns {Array<{ id: string, key?: string, change: string, was?: unknown,
 *   now?: unknown }>} empty when the run is exactly as recorded
 */
export function findRegressions(results, known) {
  const current = knownDiscrepanciesFrom(results)
  const changes = []
  for (const [id, now] of Object.entries(current)) {
    const was = known[id]
    if (!was) {
      changes.push({ id, change: 'new-scenario', now: now.outcome })
      continue
    }
    if (was.outcome !== now.outcome) {
      changes.push({
        id,
        change: 'outcome',
        was: was.outcome,
        now: now.outcome
      })
    }
    changes.push(
      ...discrepancyChanges(id, was.discrepancies, now.discrepancies)
    )
  }
  for (const id of Object.keys(known)) {
    if (!current[id]) {
      changes.push({ id, change: 'scenario-removed' })
    }
  }
  return changes
}
