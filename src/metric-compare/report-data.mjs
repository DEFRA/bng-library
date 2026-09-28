/**
 * What a comparison report says, independent of how it is rendered: the
 * counts, the breakdowns and the formatted differences, shared by the
 * Markdown and HTML reports so the two can never disagree.
 */

import { CAUSES, CAUSES_BY_ID } from './causes.mjs'
import { OUTCOME } from './compare.mjs'
import { CATEGORY, CATEGORY_ORDER, CATEGORY_TITLES } from './figures.mjs'
import { SERVICE_GAPS } from './service-gaps.mjs'

const PERCENT = 100
const RELATIVE_SIGNIFICANT_FIGURES = 4

export const OUTCOME_TITLES = Object.freeze({
  [OUTCOME.matched]: 'Matched',
  [OUTCOME.discrepancies]: 'Discrepancies',
  [OUTCOME.rejected]: 'Rejected by the service',
  [OUTCOME.rejectedAsExpected]: 'Rejected (invalid data)'
})

export const EXACTNESS_NOTE =
  'Figures are compared exactly, to the 15 significant figures both the engine and the recalculated workbook carry. Difference is the service less the metric; Relative is that as a share of the metric’s value.'

export const CAUSES_NOTE =
  'A feature’s units are its size times its multipliers, so where the service’s units are exactly the metric’s rescaled to the service’s size, or with a multiplier the service does not apply divided out, the cause is known. Totals, net gain and trading figures are sums of the feature units, so they inherit these differences.'

/** A difference with its sign, e.g. "+0.5". */
export function signed(value) {
  if (typeof value !== 'number') {
    return '—'
  }
  return value > 0 ? `+${value}` : String(value)
}

/** A relative difference as a percentage, e.g. "-5%". */
export function relative(value) {
  if (typeof value !== 'number') {
    return '—'
  }
  const percent = Number(
    (value * PERCENT).toPrecision(RELATIVE_SIGNIFICANT_FIGURES)
  )
  return `${percent > 0 ? '+' : ''}${percent}%`
}

export function causeTitles(causes = []) {
  return causes.map((id) => CAUSES_BY_ID[id]?.title ?? id)
}

export function isRejected(result) {
  return (
    result.outcome === OUTCOME.rejected ||
    result.outcome === OUTCOME.rejectedAsExpected
  )
}

function count(results, outcome) {
  return results.filter((r) => r.outcome === outcome).length
}

function total(results, field) {
  return results.reduce(
    (sum, r) => sum + (r[field]?.length ?? r[field] ?? 0),
    0
  )
}

function featureDiscrepancies(results) {
  return results.flatMap((r) =>
    (r.discrepancies ?? [])
      .filter((d) => d.category === CATEGORY.featureUnits)
      .map((d) => ({ ...d, id: r.id }))
  )
}

function byCategory(results) {
  const counts = new Map(CATEGORY_ORDER.map((c) => [c, 0]))
  for (const r of results) {
    for (const d of r.discrepancies ?? []) {
      counts.set(d.category, (counts.get(d.category) ?? 0) + 1)
    }
  }
  return [...counts].map(([category, n]) => ({
    category,
    title: CATEGORY_TITLES[category],
    discrepancies: n
  }))
}

function causeCombinations(features) {
  const combinations = new Map()
  for (const d of features) {
    const key = causeTitles(d.causes).join('; ')
    combinations.set(key, (combinations.get(key) ?? 0) + 1)
  }
  return [...combinations]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([causes, n]) => ({ causes: causes || null, discrepancies: n }))
}

function notImplemented(results, features) {
  const gaps = SERVICE_GAPS.map((gap) => {
    const hits = results.flatMap((r) =>
      (r.notImplemented ?? []).filter((n) => n.gap === gap.id).map(() => r.id)
    )
    return {
      id: gap.id,
      description: gap.description,
      figures: hits.length,
      scenarios: new Set(hits).size
    }
  })
  const causes = Object.values(CAUSES)
    .filter((c) => c.notImplemented)
    .map((cause) => {
      const explained = features.filter((d) => d.causes?.includes(cause.id))
      return {
        id: cause.id,
        description: `${cause.description} Reported as discrepancies, since the service does produce the figure.`,
        figures: explained.length,
        scenarios: new Set(explained.map((d) => d.id)).size
      }
    })
  return [...gaps, ...causes]
}

/**
 * @param {object[]} results compareScenario results
 */
export function summariseComparison(results) {
  const features = featureDiscrepancies(results)
  return {
    scenarios: {
      total: results.length,
      matched: count(results, OUTCOME.matched),
      discrepancies: count(results, OUTCOME.discrepancies),
      rejected: count(results, OUTCOME.rejected),
      rejectedAsExpected: count(results, OUTCOME.rejectedAsExpected)
    },
    figures: {
      compared: total(results, 'compared'),
      matched: total(results, 'matched'),
      discrepancies: total(results, 'discrepancies'),
      notImplemented: total(results, 'notImplemented'),
      unexplainedFeatures: features.filter((d) => !d.causes?.length).length
    },
    byCategory: byCategory(results),
    featureDiscrepancies: features.length,
    causeCombinations: causeCombinations(features),
    notImplemented: notImplemented(results, features)
  }
}
