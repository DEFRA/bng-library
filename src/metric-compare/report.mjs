/**
 * The comparison as a Markdown report: a summary, then every scenario's
 * discrepancies with how far the service is from the metric, then what the
 * service does not compute yet.
 */

import { CAUSES, CAUSES_BY_ID } from './causes.mjs'
import { OUTCOME } from './compare.mjs'
import { CATEGORY, CATEGORY_ORDER, CATEGORY_TITLES } from './figures.mjs'
import { SERVICE_GAPS } from './service-gaps.mjs'

const PERCENT = 100
const RELATIVE_SIGNIFICANT_FIGURES = 4

const OUTCOME_LABELS = {
  [OUTCOME.matched]: '✅ Matched',
  [OUTCOME.discrepancies]: '❌ Discrepancies',
  [OUTCOME.rejected]: '❌ Rejected by the service',
  [OUTCOME.rejectedAsExpected]: '✅ Rejected (invalid data)'
}

const CHANGE_LABELS = {
  new: 'New discrepancy',
  changed: 'Discrepancy changed',
  resolved: 'Discrepancy resolved — update the record',
  outcome: 'Outcome changed',
  'new-scenario': 'Scenario not in the record',
  'scenario-removed': 'Scenario no longer in the corpus'
}

function cell(value) {
  if (value === null || value === undefined) {
    return '—'
  }
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function signed(value) {
  if (typeof value !== 'number') {
    return '—'
  }
  return value > 0 ? `+${value}` : String(value)
}

function relative(value) {
  if (typeof value !== 'number') {
    return '—'
  }
  const percent = Number(
    (value * PERCENT).toPrecision(RELATIVE_SIGNIFICANT_FIGURES)
  )
  return `${percent > 0 ? '+' : ''}${percent}%`
}

function row(cells) {
  return `| ${cells.join(' | ')} |`
}

function table(header, rows) {
  return [
    row(header),
    row(header.map(() => '---')),
    ...rows.map((r) => row(r))
  ].join('\n')
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

function summary(results) {
  const lines = [
    `**${results.length} scenarios** — ${count(results, OUTCOME.matched)} matched, ${count(results, OUTCOME.discrepancies)} with discrepancies, ${count(results, OUTCOME.rejected)} rejected by the service, ${count(results, OUTCOME.rejectedAsExpected)} rejected as expected (invalid data).`,
    '',
    `**${total(results, 'compared')} figures compared** — ${total(results, 'matched')} matched exactly, ${total(results, 'discrepancies')} differ; ${total(results, 'notImplemented')} not implemented in the service yet.`,
    '',
    'Figures are compared exactly, to the 15 significant figures both the engine and the recalculated workbook carry. *Difference* is the service less the metric; *Relative* is that as a share of the metric’s value.'
  ]
  return lines.join('\n')
}

function scenarioTable(results) {
  return table(
    [
      'Scenario',
      'Outcome',
      'Compared',
      'Matched',
      'Discrepancies',
      'Not implemented'
    ],
    results.map((r) => [
      `[${r.id}](#${anchor(r.id)})`,
      OUTCOME_LABELS[r.outcome],
      cell(r.compared),
      cell(r.matched),
      cell(r.discrepancies?.length),
      cell(r.notImplemented?.length)
    ])
  )
}

function byCategory(results) {
  const counts = new Map(CATEGORY_ORDER.map((c) => [c, 0]))
  for (const r of results) {
    for (const d of r.discrepancies ?? []) {
      counts.set(d.category, (counts.get(d.category) ?? 0) + 1)
    }
  }
  return table(
    ['What', 'Discrepancies'],
    [...counts].map(([category, n]) => [CATEGORY_TITLES[category], n])
  )
}

function anchor(id) {
  return id.toLowerCase().replaceAll(/[^a-z0-9-]/g, '')
}

function causeTitles(causes = []) {
  return causes.length > 0
    ? causes.map((id) => CAUSES_BY_ID[id]?.title ?? id).join('; ')
    : '—'
}

function discrepancyRows(discrepancies) {
  return discrepancies.map((d) => [
    cell(d.label),
    d.module,
    cell(d.expected),
    cell(d.actual),
    signed(d.difference),
    relative(d.relativeDifference),
    d.kind,
    causeTitles(d.causes)
  ])
}

function scenarioDetail(result) {
  const lines = [`### ${result.id}`, '']
  if (
    result.outcome === OUTCOME.rejected ||
    result.outcome === OUTCOME.rejectedAsExpected
  ) {
    lines.push(
      `The service refused the ${result.rejectedFile} file:`,
      '',
      ...result.errors.map((e) => `- \`${e.code}\` ${cell(e.message)}`),
      ''
    )
    return lines.join('\n')
  }
  for (const category of CATEGORY_ORDER) {
    const found = result.discrepancies.filter((d) => d.category === category)
    if (found.length > 0) {
      lines.push(
        `**${CATEGORY_TITLES[category]}**`,
        '',
        table(
          [
            'Figure',
            'Module',
            'Metric',
            'Service',
            'Difference',
            'Relative',
            'Kind',
            'Explained by'
          ],
          discrepancyRows(found)
        ),
        ''
      )
    }
  }
  return lines.join('\n')
}

function featureDiscrepancies(results) {
  return results.flatMap((r) =>
    (r.discrepancies ?? [])
      .filter((d) => d.category === CATEGORY.featureUnits)
      .map((d) => ({ ...d, id: r.id }))
  )
}

function causesSection(results) {
  const features = featureDiscrepancies(results)
  const combinations = new Map()
  for (const d of features) {
    const key = causeTitles(d.causes)
    combinations.set(key, (combinations.get(key) ?? 0) + 1)
  }
  const rows = [...combinations]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([causes, n]) => [causes === '—' ? '**Nothing known**' : causes, n])
  return [
    `A feature’s units are its size times its multipliers, so where the service’s units are exactly the metric’s rescaled to the service’s size, or with a multiplier the service does not apply divided out, the cause is known. The ${features.length} per-feature discrepancies:`,
    '',
    table(['Explained by', 'Discrepancies'], rows),
    '',
    ...Object.values(CAUSES).map((c) => `- **${c.title}** — ${c.description}`),
    '',
    'Totals, net gain and trading figures are sums of the feature units, so they inherit these differences.'
  ].join('\n')
}

function notImplementedSection(results) {
  const rows = SERVICE_GAPS.map((gap) => {
    const hits = results.flatMap((r) =>
      (r.notImplemented ?? []).filter((n) => n.gap === gap.id).map(() => r.id)
    )
    return [gap.id, cell(gap.description), hits.length, new Set(hits).size]
  })
  const features = featureDiscrepancies(results)
  for (const cause of Object.values(CAUSES).filter((c) => c.notImplemented)) {
    const explained = features.filter((d) => d.causes?.includes(cause.id))
    rows.push([
      cause.id,
      `${cell(cause.description)} Reported as discrepancies, since the service does produce the figure.`,
      explained.length,
      new Set(explained.map((d) => d.id)).size
    ])
  }
  return table(
    ['Gap', 'What the service does not do yet', 'Figures', 'Scenarios'],
    rows
  )
}

function regressionSection(regressions) {
  if (regressions.length === 0) {
    return 'No change from the recorded discrepancies.'
  }
  return table(
    ['Scenario', 'Figure', 'Change', 'Recorded', 'Now'],
    regressions.map((r) => [
      r.id,
      cell(r.key),
      CHANGE_LABELS[r.change] ?? r.change,
      cell(JSON.stringify(r.was ?? null)),
      cell(JSON.stringify(r.now ?? null))
    ])
  )
}

/**
 * @param {object[]} results compareScenario results
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {string[]} [options.preamble] Markdown paragraphs after the title
 * @param {object[]} [options.regressions] findRegressions' result, when the
 *   run was checked against recorded discrepancies
 * @returns {string}
 */
export function renderComparisonReport(results, options = {}) {
  const { title = 'Metric comparison', preamble = [], regressions } = options
  const detailed = results.filter((r) => r.outcome !== OUTCOME.matched)
  const sections = [
    `# ${title}`,
    ...preamble,
    summary(results),
    ...(regressions
      ? [
          '## Change from the recorded discrepancies',
          regressionSection(regressions)
        ]
      : []),
    '## Scenarios',
    scenarioTable(results),
    '## Discrepancies by what was compared',
    byCategory(results),
    '## Known causes of the per-feature discrepancies',
    causesSection(results),
    '## Not implemented in the service yet',
    notImplementedSection(results),
    '## Discrepancies per scenario',
    detailed.length > 0
      ? detailed.map((r) => scenarioDetail(r)).join('\n')
      : 'None.'
  ]
  return `${sections.join('\n\n')}\n`
}
