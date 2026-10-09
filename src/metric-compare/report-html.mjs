/**
 * The comparison as a self-contained HTML page: a few headline lines, then
 * one table with a row for every value that differs from the metric, across
 * every scenario. Scenarios come most serious first, and within a scenario
 * the most important differences first. A scenario with nothing to compare
 * (refused, failed to import, or its workbook unreadable) has one row saying
 * why. Every difference, at full precision, is in the spreadsheet report.
 *
 * Values are shown to four decimal places with their unit; a difference is the
 * service's value less the metric's, in the same unit.
 */

import { CAUSES_BY_ID } from './causes.mjs'
import { OUTCOME, TOLERANCE } from './compare.mjs'
import { CATEGORY, UNIT } from './figures.mjs'
import { SERVICE_GAPS } from './service-gaps.mjs'

const DECIMAL_PLACES = 4
const SMALLEST_SHOWN = 10 ** -DECIMAL_PLACES
const MAX_DECIMAL_PLACES = 12

const MODULE_TITLES = {
  area: 'Area habitats',
  hedgerow: 'Hedgerows',
  watercourse: 'Watercourses'
}

// The figure a Met / Not met answer is decided on, by the answer's key.
const DECIDED_BY = [
  [
    /^net-gain\|(\w+)\|verdict$/,
    (m) => `net-gain|${m}|percentage`,
    'Net change'
  ],
  [
    /^trading-status\|(\w+)\|Low$/,
    (m) => `trading-figures|${m}|low-cumulative`,
    'Low cumulative figure'
  ],
  [
    /^trading-status\|(\w+)\|Medium$/,
    (m) => `trading-figures|${m}|medium-deficit`,
    'Medium deficit'
  ]
]

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

function escape(value) {
  if (value === null || value === undefined) {
    return '—'
  }
  return String(value).replaceAll(/[&<>"']/g, (ch) => HTML_ESCAPES[ch])
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

/** A number to four decimal places. */
function formatNumber(value) {
  return value.toFixed(DECIMAL_PLACES)
}

/**
 * A difference with its sign. One too small to show at four decimal places
 * is shown to its first two significant digits instead, so it never reads as
 * zero: in fixed notation while that needs no more than twelve decimal
 * places, and in scientific notation below that.
 */
function formatDifference(value) {
  if (value === 0) {
    return '0'
  }
  const sign = value > 0 ? '+' : '−'
  const size = Math.abs(value)
  if (size >= SMALLEST_SHOWN) {
    return `${sign}${size.toFixed(DECIMAL_PLACES)}`
  }
  const places = Math.ceil(-Math.log10(size)) + 1
  return places <= MAX_DECIMAL_PLACES
    ? `${sign}${size.toFixed(places)}`
    : `${sign}${size.toExponential(1)}`
}

/** A value with its unit: "97.3095 habitat units", "9.0898%", "Met". */
function valueText(value, unit) {
  if (typeof value !== 'number') {
    return value ?? 'no value'
  }
  if (unit === UNIT.percent) {
    return `${formatNumber(value)}%`
  }
  return `${formatNumber(value)} ${unit}`
}

function differenceText(d) {
  if (typeof d.difference !== 'number') {
    if (d.kind === 'missing-from-service' || d.actual === null) {
      return 'only the metric has a value'
    }
    if (d.kind === 'missing-from-workbook' || d.expected === null) {
      return 'only the service has a value'
    }
    return '—'
  }
  return `${formatDifference(d.difference)} ${d.differenceUnit}`
}

function figureTitle(d) {
  return `${MODULE_TITLES[d.module]}: ${d.label}`
}

const isAnswer = (d) => d.unit === UNIT.verdict
const isUnexplainedFeature = (d) =>
  d.category === CATEGORY.featureUnits && !d.causes?.length

/** The figure an answer is decided on, where that figure differs too. */
function decidedBy(d, result) {
  for (const [pattern, keyFor, title] of DECIDED_BY) {
    const match = pattern.exec(d.key)
    const figure = match
      ? result.discrepancies.find((f) => f.key === keyFor(match[1]))
      : null
    if (figure) {
      return `${title}: ${valueText(figure.expected, figure.unit)} in the metric, ${valueText(figure.actual, figure.unit)} in the service`
    }
  }
  return 'The figure it is decided on matches'
}

/** Where a scenario stands, most serious first. */
function statusOf(result) {
  const differences = result.discrepancies ?? []
  switch (result.outcome) {
    case OUTCOME.importFailed:
      return { tone: 'bad', text: 'The service failed to import it' }
    case OUTCOME.rejected:
      return { tone: 'bad', text: 'Refused by the service' }
    case OUTCOME.workbookUnreadable:
      return { tone: 'warn', text: 'Workbook could not be read' }
    case OUTCOME.rejectedAsExpected:
      return { tone: 'good', text: 'Refused, as expected (invalid data)' }
    case OUTCOME.acceptedInvalid:
      return { tone: 'bad', text: 'Accepted, though its data is invalid' }
    default:
      break
  }
  if (differences.some(isAnswer)) {
    return { tone: 'bad', text: 'An answer differs' }
  }
  if (differences.some(isUnexplainedFeature)) {
    return { tone: 'warn', text: 'Differences with no known cause' }
  }
  return differences.length > 0
    ? { tone: 'muted', text: 'Known causes only' }
    : { tone: 'good', text: 'Matches the metric' }
}

function badge({ tone, text }) {
  return `<span class="badge ${tone}">${escape(text)}</span>`
}

function table(headers, rows) {
  return `<div class="scroll"><table><thead><tr>${headers
    .map((h) => `<th scope="col">${escape(h)}</th>`)
    .join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
}

function withScenario(results, pick) {
  return results.flatMap((r) =>
    (r.discrepancies ?? []).filter(pick).map((d) => ({ d, result: r }))
  )
}

function scenarioCount(found) {
  return new Set(found.map(({ result }) => result.id)).size
}

/** How many of the values a headline line counts it names. */
const NAMED_IN_HEADLINE = 5

/** The id of a difference's row in the table, for the headline to link to. */
function rowId(result, d) {
  return `row-${`${result.id}-${d.key}`.toLowerCase().replaceAll(/[^a-z0-9-]/g, '-')}`
}

/**
 * The values a headline line counts, the first few by scenario and name,
 * each linked to its row in the table.
 */
function namedValues(found) {
  const items = found
    .slice(0, NAMED_IN_HEADLINE)
    .map(
      ({ d, result }) =>
        `<li><a href="#${rowId(result, d)}">${escape(result.id)}: ${escape(figureTitle(d))}</a></li>`
    )
  const more = found.length - NAMED_IN_HEADLINE
  if (more > 0) {
    items.push(
      `<li>and ${plural(more, 'more value')}, marked in the table</li>`
    )
  }
  return `<ul>${items.join('')}</ul>`
}

/**
 * The figures the metric has and the service does not compute yet, so they
 * were not compared: a headline line with each gap and its count, or null
 * when every figure was compared.
 */
function notComparedLine(results) {
  const gaps = SERVICE_GAPS.map((gap) => ({
    gap,
    count: results.reduce(
      (n, r) =>
        n + (r.notImplemented ?? []).filter((f) => f.gap === gap.id).length,
      0
    )
  })).filter(({ count }) => count > 0)
  const total = gaps.reduce((n, { count }) => n + count, 0)
  if (total === 0) {
    return null
  }
  const items = gaps.map(
    ({ gap, count }) =>
      `<li>${escape(gap.description)} <span class="muted-text">(${plural(count, 'figure')})</span></li>`
  )
  return [
    'muted',
    `${plural(total, 'figure')} ${total === 1 ? 'was' : 'were'} not compared, because the service does not calculate ${total === 1 ? 'it' : 'them'} yet:`,
    `<ul>${items.join('')}</ul>`
  ]
}

function headline(results, answers, unexplained, explained) {
  const refused = results.filter((r) => r.outcome === OUTCOME.rejected)
  const acceptedInvalid = results.filter(
    (r) => r.outcome === OUTCOME.acceptedInvalid
  )
  const unreadable = results.filter(
    (r) => r.outcome === OUTCOME.workbookUnreadable
  )
  const failed = results.filter((r) => r.outcome === OUTCOME.importFailed)
  const lines = [
    [
      answers.length ? 'bad' : 'good',
      answers.length
        ? `${plural(answers.length, 'Met / Not met answer')} ${answers.length === 1 ? 'differs' : 'differ'} from the metric, in ${plural(scenarioCount(answers), 'scenario')}:`
        : 'Every Met / Not met answer agrees with the metric.',
      answers.length ? namedValues(answers) : ''
    ],
    [
      unexplained.length ? 'warn' : 'good',
      unexplained.length
        ? `${plural(unexplained.length, 'feature value')} ${unexplained.length === 1 ? 'differs' : 'differ'} for no known reason, in ${plural(scenarioCount(unexplained), 'scenario')}:`
        : 'No feature value differs for an unknown reason.',
      unexplained.length ? namedValues(unexplained) : ''
    ],
    [
      'muted',
      `${plural(explained.length, 'other feature value')} ${explained.length === 1 ? 'differs' : 'differ'} for a known reason, given in the table.`
    ]
  ]
  if (refused.length) {
    lines.unshift([
      'bad',
      `The service refused ${plural(refused.length, 'scenario')} whose data is valid.`
    ])
  }
  if (failed.length) {
    lines.unshift([
      'bad',
      `The service failed to import ${plural(failed.length, 'scenario')}, so ${failed.length === 1 ? 'it was' : 'they were'} not compared.`
    ])
  }
  if (acceptedInvalid.length) {
    lines.unshift([
      'bad',
      `The service accepted ${plural(acceptedInvalid.length, 'scenario')} whose data is invalid.`
    ])
  }
  const notCompared = notComparedLine(results)
  if (notCompared) {
    lines.push(notCompared)
  }
  if (unreadable.length) {
    lines.push([
      'warn',
      `${plural(unreadable.length, 'workbook')} could not be read, so ${unreadable.length === 1 ? 'its scenario was' : 'their scenarios were'} not compared.`
    ])
  }
  return `<ul class="headline">${lines
    .map(
      ([tone, text, list = '']) =>
        `<li class="${tone}">${escape(text)}${list}</li>`
    )
    .join('')}</ul>`
}

function causeText(d, result) {
  if (d.causes?.length) {
    return d.causes.map((id) => CAUSES_BY_ID[id]?.title ?? id).join('; ')
  }
  if (isAnswer(d)) {
    return `Answer differs. ${decidedBy(d, result)}`
  }
  return d.category === CATEGORY.featureUnits ? 'No known cause' : '—'
}

// A scenario's differences, most important first.
const ORDER = [
  isAnswer,
  isUnexplainedFeature,
  (d) => d.category === CATEGORY.featureUnits,
  () => true
]
const rank = (d) => ORDER.findIndex((test) => test(d))

function rowClass(d) {
  if (isAnswer(d)) {
    return ' class="row-bad"'
  }
  return isUnexplainedFeature(d) ? ' class="row-warn"' : ''
}

/** The file the service refused, as a reader would name it. */
const FILE_NAMES = {
  baseline: 'baseline',
  postIntervention: 'post-intervention'
}

/** Why a scenario has nothing to compare, or null when it has. */
function nothingCompared(result) {
  switch (result.outcome) {
    case OUTCOME.rejected:
    case OUTCOME.rejectedAsExpected:
      return `The service refused the ${FILE_NAMES[result.rejectedFile] ?? result.rejectedFile} file: ${result.errors
        .map((e) => e.message)
        .join('; ')}`
    case OUTCOME.workbookUnreadable:
      return result.errors[0].message
    case OUTCOME.importFailed:
      return `The service threw an error importing it, so nothing was compared: ${result.errors[0].message}`
    case OUTCOME.acceptedInvalid:
      return result.discrepancies.length === 0
        ? 'The service accepted this scenario, which is built to hold invalid data, so it should have refused it. Every value matches the metric.'
        : null
    default:
      return null
  }
}

// Scenarios, most serious first.
const TONE_ORDER = ['bad', 'warn', 'muted', 'good']

function scenarioRows(result, status) {
  const scenario = `<td>${escape(result.id)}</td><td>${badge(status)}</td>`
  const reason = nothingCompared(result)
  if (reason) {
    return [
      `<tr>${scenario}<td>—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td>${escape(reason)}</td></tr>`
    ]
  }
  return [...(result.discrepancies ?? [])]
    .sort((a, b) => rank(a) - rank(b))
    .map(
      (d) =>
        `<tr id="${rowId(result, d)}"${rowClass(d)}>${scenario}<td>${escape(figureTitle(d))}</td><td class="num">${escape(valueText(d.expected, d.unit))}</td><td class="num">${escape(valueText(d.actual, d.unit))}</td><td class="num">${escape(differenceText(d))}</td><td>${escape(causeText(d, result))}</td></tr>`
    )
}

/** Every difference, in one table, and how many scenarios match outright. */
function resultsTable(results) {
  const listed = results
    .map((result, order) => {
      const status = statusOf(result)
      return { status, order, rows: scenarioRows(result, status) }
    })
    .filter(({ rows }) => rows.length > 0)
    .sort(
      (a, b) =>
        TONE_ORDER.indexOf(a.status.tone) - TONE_ORDER.indexOf(b.status.tone) ||
        a.order - b.order
    )
  const matched = results.length - listed.length
  const rest = matched
    ? `<p class="muted-text">${listed.length ? plural(matched, 'other scenario') : `All ${plural(matched, 'scenario')}`} ${matched === 1 ? 'matches' : 'match'} the metric in every value compared.</p>`
    : ''
  if (listed.length === 0) {
    return rest
  }
  return `${table(
    ['Scenario', 'Status', 'Value', 'Metric', 'Service', 'Difference', 'Why'],
    listed.flatMap(({ rows }) => rows)
  )}${causeKey(results)}${rest}`
}

/**
 * What each cause in the Why column means, for the causes the table uses
 * only, marking those the service does not implement yet.
 */
function causeKey(results) {
  const used = new Set(
    results.flatMap((r) =>
      (r.discrepancies ?? []).flatMap((d) => d.causes ?? [])
    )
  )
  const items = [...used]
    .map((id) => CAUSES_BY_ID[id])
    .filter(Boolean)
    .map(
      (cause) =>
        `<li><strong>${escape(cause.title)}</strong>${cause.notImplemented ? ' <span class="badge muted">not implemented yet</span>' : ''}: ${escape(cause.description)}</li>`
    )
  return items.length
    ? `<div class="key"><p class="muted-text">What the causes in the Why column mean:</p><ul>${items.join('')}</ul></div>`
    : ''
}

/** The run's pass or fail, and why; nothing when the caller gives none. */
function verdictBox(verdict) {
  if (!verdict) {
    return ''
  }
  const tone = verdict.passed ? 'pass' : 'fail'
  const label = verdict.passed ? 'Passed' : 'Failed'
  const reasons = verdict.reasons?.length
    ? `<ul>${verdict.reasons.map((r) => `<li>${escape(r)}</li>`).join('')}</ul>`
    : ''
  return `<section class="verdict ${tone}" role="status"><p class="verdict-title"><span class="verdict-label">${label}</span> ${escape(verdict.summary)}</p>${reasons}</section>`
}

const STYLE = `
:root{--bg:#fff;--fg:#1d2327;--muted:#5f6b73;--line:#d8dee2;--panel:#f5f7f8;--good:#1a7f37;--good-bg:#dff3e4;--bad:#b42318;--bad-bg:#fde7e4;--warn:#8a5a00;--warn-bg:#fdf1d6;--accent:#1d4ed8}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15181b;--fg:#e6e9eb;--muted:#9aa5ad;--line:#30363b;--panel:#1d2226;--good:#5cc47a;--good-bg:#173323;--bad:#ff8a7a;--bad-bg:#3a1c19;--warn:#f0b54a;--warn-bg:#3a2c10;--accent:#7aa2ff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1400px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:24px;margin:0 0 4px}
p,li{max-width:85ch}a{color:var(--accent)}code{font-size:12px;color:var(--muted)}
.context,.muted-text{color:var(--muted);font-size:13px}
.how{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 14px 10px 32px;font-size:14px}
.how li{margin:2px 0}
.verdict{border:2px solid var(--line);border-radius:8px;padding:12px 16px;margin:16px 0}
.verdict.pass{border-color:var(--good);background:var(--good-bg)}.verdict.fail{border-color:var(--bad);background:var(--bad-bg)}
.verdict-title{margin:0;font-size:18px;font-weight:600}
.verdict-label{display:inline-block;border-radius:4px;padding:1px 10px;margin-right:6px;color:var(--bg);font-size:16px;letter-spacing:.04em;text-transform:uppercase}
.verdict.pass .verdict-label{background:var(--good)}.verdict.fail .verdict-label{background:var(--bad)}
.verdict ul{margin:8px 0 0;padding-left:20px}.verdict li{margin:2px 0}
ul.headline{list-style:none;padding:0;margin:16px 0}
ul.headline li{border-left:4px solid var(--line);padding:6px 12px;margin:6px 0;background:var(--panel);border-radius:0 6px 6px 0;font-size:16px}
ul.headline li.bad{border-color:var(--bad)}ul.headline li.warn{border-color:var(--warn)}ul.headline li.good{border-color:var(--good)}
.key ul{margin:4px 0;padding-left:20px;font-size:14px}.key li{margin:4px 0}
.scroll{overflow:auto;max-height:80vh;border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:14px}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600;position:sticky;top:0;background:var(--bg)}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
ul.headline ul{margin:4px 0 0;padding-left:20px;font-size:14px}
tr:target td{background:var(--warn-bg)}
tr.row-bad td:first-child{border-left:3px solid var(--bad)}tr.row-warn td:first-child{border-left:3px solid var(--warn)}
.badge{display:inline-block;border-radius:999px;padding:1px 8px;font-size:12px;white-space:nowrap}
.badge.good{background:var(--good-bg);color:var(--good)}.badge.bad{background:var(--bad-bg);color:var(--bad)}
.badge.warn{background:var(--warn-bg);color:var(--warn)}.badge.muted{background:var(--panel);color:var(--muted);border:1px solid var(--line)}
@media (max-width:640px){main{padding:16px}th,td{padding:4px 6px}}
`

/**
 * @param {object[]} results compareScenario results
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {string[]} [options.context] plain-text lines under the title, such
 *   as where the scenarios came from and the commit compared
 * @param {{ passed: boolean, summary: string, reasons?: string[] }}
 *   [options.verdict] whether the run passes or fails, and why, shown in a box
 *   at the top. The caller decides it: what fails a run (which differences
 *   have a known explanation) is the caller's rule, not the report's
 * @returns {string} a complete HTML document
 */
export function renderComparisonHtml(results, options = {}) {
  const { title = 'Metric comparison', context = [], verdict } = options
  const answers = withScenario(results, isAnswer)
  const unexplained = withScenario(results, isUnexplainedFeature)
  const explained = withScenario(
    results,
    (d) => d.category === CATEGORY.featureUnits && d.causes?.length > 0
  )
  const body = [
    `<h1>${escape(title)} — ${plural(results.length, 'scenario')}</h1>`,
    ...context.map((line) => `<p class="context">${escape(line)}</p>`),
    verdictBox(verdict),
    headline(results, answers, unexplained, explained),
    `<ul class="how">
<li><strong>Metric</strong> is the value calculated by the Statutory Biodiversity Metric workbook.</li>
<li><strong>Service</strong> is the value the BNG service calculates from the same GeoPackages.</li>
<li><strong>Difference</strong> is the service's value minus the metric's, in the same unit.</li>
<li>Two values match if they differ by less than ${TOLERANCE.relative} of the metric's value. That allows only for tiny rounding differences from adding numbers up in a different order, so any real difference is shown, however small.</li>
<li>Values are shown to ${DECIMAL_PLACES} decimal places. <code>report.xlsx</code> has every difference in full.</li>
</ul>`,
    resultsTable(results)
  ]
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body.join('\n')}
</main>
</body>
</html>
`
}
