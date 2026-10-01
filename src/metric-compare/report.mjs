/**
 * The comparison as a Markdown report: a summary, then every scenario's
 * discrepancies with how far the service is from the metric, then what the
 * service does not compute yet.
 */

import { CAUSES } from './causes.mjs'
import { OUTCOME } from './compare.mjs'
import { CATEGORY_ORDER, CATEGORY_TITLES } from './figures.mjs'
import {
  CAUSES_NOTE,
  COLUMN_GUIDE,
  EXACTNESS_NOTE,
  UNITS_GUIDE,
  OUTCOME_TITLES,
  causeTitles,
  isRejected,
  isImportFailure,
  isUnreadable,
  relative,
  signed,
  summariseComparison,
  withUnit
} from './report-data.mjs'

const OUTCOME_ICONS = {
  [OUTCOME.matched]: '✅',
  [OUTCOME.discrepancies]: '❌',
  [OUTCOME.rejected]: '❌',
  [OUTCOME.rejectedAsExpected]: '✅',
  [OUTCOME.acceptedInvalid]: '❌',
  [OUTCOME.workbookUnreadable]: '⚠️',
  [OUTCOME.importFailed]: '❌'
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

function anchor(id) {
  return id.toLowerCase().replaceAll(/[^a-z0-9-]/g, '')
}

function summary({ scenarios, figures }) {
  return [
    `**${scenarios.total} scenarios** — ${scenarios.matched} matched, ${scenarios.discrepancies} with discrepancies, ${scenarios.rejected} rejected by the service, ${scenarios.rejectedAsExpected} rejected as expected (invalid data)${scenarios.acceptedInvalid ? `, ${scenarios.acceptedInvalid} accepted though their data is invalid` : ''}${scenarios.workbookUnreadable ? `, ${scenarios.workbookUnreadable} whose workbook could not be read` : ''}${scenarios.importFailed ? `, ${scenarios.importFailed} the service failed to import` : ''}.`,
    '',
    `**${figures.compared} figures compared** — ${figures.matched} matched exactly, ${figures.discrepancies} differ; ${figures.notImplemented} not implemented in the service yet.`,
    '',
    EXACTNESS_NOTE
  ].join('\n')
}

function scenarioTable(results, details) {
  return table(
    [
      'Scenario',
      'Outcome',
      'Figures compared',
      'Figures matched',
      'Discrepancies',
      'Not implemented'
    ],
    results.map((r) => [
      details && r.outcome !== OUTCOME.matched
        ? `[${r.id}](#${anchor(r.id)})`
        : r.id,
      `${OUTCOME_ICONS[r.outcome]} ${OUTCOME_TITLES[r.outcome]}`,
      cell(r.compared),
      cell(r.matched),
      cell(r.discrepancies?.length),
      cell(r.notImplemented?.length)
    ])
  )
}

function differenceText(d) {
  const unit =
    d.difference !== null && d.differenceUnit && d.differenceUnit !== d.unit
      ? ` ${d.differenceUnit}`
      : ''
  return `${signed(d.difference)}${unit}`
}

function pricedOnText(d) {
  if (!d.sizeUnit) {
    return '—'
  }
  const multiplier =
    typeof d.strategicSignificanceMultiplier === 'number' &&
    d.strategicSignificanceMultiplier !== 1
      ? `; SS ×${d.strategicSignificanceMultiplier}`
      : ''
  return `${withUnit(d.metricSize, d.sizeUnit)} / ${withUnit(d.serviceSize, d.sizeUnit)}${multiplier}`
}

function discrepancyRows(discrepancies) {
  return discrepancies.map((d) => [
    cell(d.label),
    d.module,
    cell(d.expected),
    cell(d.actual),
    cell(d.unit),
    differenceText(d),
    relative(d.relativeDifference),
    cell(pricedOnText(d)),
    d.kind,
    causeTitles(d.causes).join('; ') || '—'
  ])
}

function guideSection() {
  return [
    'Every value names its unit. Counts elsewhere are numbers of figures or scenarios.',
    '',
    table(
      ['Unit', 'What it means'],
      UNITS_GUIDE.map(([unit, meaning]) => [`**${unit}**`, cell(meaning)])
    ),
    '',
    table(
      ['Column', 'What it means', 'Measured in'],
      COLUMN_GUIDE.map(([column, meaning, unit]) => [
        `**${column}**`,
        cell(meaning),
        cell(unit)
      ])
    ),
    '',
    'In the tables below, *Priced on* is a feature’s size on the metric side / the service side, and SS the strategic significance multiplier the metric applied (the service applies ×1).'
  ].join('\n')
}

function scenarioDetail(result) {
  const lines = [`### ${result.id}`, '']
  if (isUnreadable(result)) {
    lines.push(`Nothing was compared: ${cell(result.errors[0].message)}`, '')
    return lines.join('\n')
  }
  if (isImportFailure(result)) {
    lines.push(
      `The service threw an error importing this scenario, so nothing was compared: ${cell(result.errors[0].message)}`,
      ''
    )
    return lines.join('\n')
  }
  if (isRejected(result)) {
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
            'Unit',
            'Difference (service − metric)',
            'Relative (% of metric value)',
            'Priced on (metric / service)',
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

function causesSection(data) {
  return [
    `${CAUSES_NOTE} The ${data.featureDiscrepancies} per-feature discrepancies:`,
    '',
    table(
      ['Explained by', 'Discrepancies (count)'],
      data.causeCombinations.map((c) => [
        c.causes ?? '**Nothing known**',
        c.discrepancies
      ])
    ),
    '',
    ...Object.values(CAUSES).map((c) => `- **${c.title}** — ${c.description}`)
  ].join('\n')
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
 * @param {boolean} [options.details] include every scenario's discrepancies
 *   (default true); without them the report is a summary, short enough for a
 *   CI job summary
 * @param {object[]} [options.regressions] findRegressions' result, when the
 *   run was checked against recorded discrepancies
 * @returns {string}
 */
export function renderComparisonReport(results, options = {}) {
  const {
    title = 'Metric comparison',
    preamble = [],
    details = true,
    regressions
  } = options
  const data = summariseComparison(results)
  const detailed = results.filter((r) => r.outcome !== OUTCOME.matched)
  const sections = [
    `# ${title}`,
    ...preamble,
    summary(data),
    ...(regressions
      ? [
          '## Change from the recorded discrepancies',
          regressionSection(regressions)
        ]
      : []),
    '## Scenarios',
    scenarioTable(results, details),
    '## Discrepancies by what was compared',
    table(
      ['What', 'Discrepancies (count)'],
      data.byCategory.map((c) => [c.title, c.discrepancies])
    ),
    '## Known causes of the per-feature discrepancies',
    causesSection(data),
    '## Not implemented in the service yet',
    table(
      [
        'Gap',
        'What the service does not do yet',
        'Figures (count)',
        'Scenarios (count)'
      ],
      data.notImplemented.map((g) => [
        g.id,
        cell(g.description),
        g.figures,
        g.scenarios
      ])
    )
  ]
  if (details) {
    sections.push(
      '## How to read the discrepancies: units and columns',
      guideSection(),
      '## Discrepancies per scenario',
      detailed.length > 0
        ? detailed.map((r) => scenarioDetail(r)).join('\n')
        : 'None.'
    )
  }
  return `${sections.join('\n\n')}\n`
}
