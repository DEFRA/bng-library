/**
 * The comparison as a short, self-contained HTML page, written to answer, in
 * order: does any Met / Not met answer differ from the metric; which values
 * differ for no known reason; what explains the rest; what the service does
 * not do yet. Every scenario's full list of differences is one click away,
 * and every difference, at full precision, is in the spreadsheet report.
 *
 * Values are shown to four decimal places with their unit; a difference is the
 * service's value less the metric's, in the same unit.
 */

import { CAUSES, CAUSES_BY_ID } from './causes.mjs'
import { OUTCOME } from './compare.mjs'
import { CATEGORY, UNIT } from './figures.mjs'
import { SERVICE_GAPS } from './service-gaps.mjs'

const DECIMAL_PLACES = 4
const SMALLEST_SHOWN = 10 ** -DECIMAL_PLACES
const MAX_DECIMAL_PLACES = 12
const NET_GAIN_TARGET = '10%'

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

function anchor(id) {
  return `scenario-${id.toLowerCase().replaceAll(/[^a-z0-9-]/g, '-')}`
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

function answerTitle(d) {
  if (d.category === CATEGORY.netGain) {
    return `${MODULE_TITLES[d.module]}: net gain (${NET_GAIN_TARGET} target)`
  }
  return `${MODULE_TITLES[d.module]}: ${d.label.replace(' band', '')} trading rule`
}

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

function scenarioLink(id) {
  return `<a href="#${anchor(id)}">${escape(id)}</a>`
}

function withScenario(results, pick) {
  return results.flatMap((r) =>
    (r.discrepancies ?? []).filter(pick).map((d) => ({ d, result: r }))
  )
}

function scenarioCount(found) {
  return new Set(found.map(({ result }) => result.id)).size
}

function headline(results, answers, unexplained, explained) {
  const refused = results.filter((r) => r.outcome === OUTCOME.rejected)
  const acceptedInvalid = results.filter(
    (r) => r.outcome === OUTCOME.acceptedInvalid
  )
  const unreadable = results.filter(
    (r) => r.outcome === OUTCOME.workbookUnreadable
  )
  const lines = [
    [
      answers.length ? 'bad' : 'good',
      answers.length
        ? `${plural(answers.length, 'Met / Not met answer')} ${answers.length === 1 ? 'differs' : 'differ'} from the metric, in ${plural(scenarioCount(answers), 'scenario')}.`
        : 'Every Met / Not met answer agrees with the metric.'
    ],
    [
      unexplained.length ? 'warn' : 'good',
      unexplained.length
        ? `${plural(unexplained.length, 'feature value')} ${unexplained.length === 1 ? 'differs' : 'differ'} for no known reason, in ${plural(scenarioCount(unexplained), 'scenario')}.`
        : 'No feature value differs for an unknown reason.'
    ],
    [
      'muted',
      `${plural(explained.length, 'other feature value')} ${explained.length === 1 ? 'differs' : 'differ'} for a known reason, explained below.`
    ]
  ]
  if (refused.length) {
    lines.unshift([
      'bad',
      `The service refused ${plural(refused.length, 'scenario')} whose data is valid.`
    ])
  }
  if (acceptedInvalid.length) {
    lines.unshift([
      'bad',
      `The service accepted ${plural(acceptedInvalid.length, 'scenario')} whose data is invalid.`
    ])
  }
  if (unreadable.length) {
    lines.push([
      'warn',
      `${plural(unreadable.length, 'workbook')} could not be read, so ${unreadable.length === 1 ? 'its scenario was' : 'their scenarios were'} not compared.`
    ])
  }
  return `<ul class="headline">${lines
    .map(([tone, text]) => `<li class="${tone}">${escape(text)}</li>`)
    .join('')}</ul>`
}

function answersSection(answers) {
  if (answers.length === 0) {
    return '<p>None: the service gives the same Met / Not met answers as the metric.</p>'
  }
  return table(
    ['Scenario', 'Answer', 'Metric', 'Service', 'Why'],
    answers.map(
      ({ d, result }) =>
        `<tr><td>${scenarioLink(result.id)}</td><td>${escape(answerTitle(d))}</td><td>${escape(d.expected)}</td><td>${escape(d.actual)}</td><td>${escape(decidedBy(d, result))}</td></tr>`
    )
  )
}

function unexplainedSection(unexplained) {
  if (unexplained.length === 0) {
    return '<p>None.</p>'
  }
  return table(
    ['Scenario', 'Value', 'Metric', 'Service', 'Difference'],
    unexplained.map(
      ({ d, result }) =>
        `<tr><td>${scenarioLink(result.id)}</td><td>${escape(figureTitle(d))}</td><td class="num">${escape(valueText(d.expected, d.unit))}</td><td class="num">${escape(valueText(d.actual, d.unit))}</td><td class="num">${escape(differenceText(d))}</td></tr>`
    )
  )
}

/** The largest difference a cause accounts for, in each unit. */
function largestByUnit(found) {
  const largest = new Map()
  for (const { d } of found) {
    const size = Math.abs(d.difference ?? 0)
    if (size > (largest.get(d.differenceUnit) ?? 0)) {
      largest.set(d.differenceUnit, size)
    }
  }
  return [...largest]
    .map(([unit, size]) => `${formatDifference(size).slice(1)} ${unit}`)
    .join(', ')
}

function causesSection(results) {
  const items = Object.values(CAUSES).map((cause) => {
    const found = withScenario(results, (d) => d.causes?.includes(cause.id))
    const alone = found.filter(({ d }) => d.causes.length === 1)
    const shared = found.length - alone.length
    const notImplemented = cause.notImplemented
      ? ' <span class="badge muted">not implemented yet</span>'
      : ''
    const both = shared ? ` (${shared} of them with the other cause too)` : ''
    const largest = alone.length
      ? ` Where it is the only cause, the largest difference is ${escape(largestByUnit(alone))}.`
      : ''
    return `<li><strong>${escape(cause.title)}</strong>${notImplemented} — ${plural(found.length, 'feature value')} in ${plural(scenarioCount(found), 'scenario')}${both}.${largest}<br><span class="muted-text">${escape(cause.description)}</span></li>`
  })
  return `<ul class="causes">${items.join('')}</ul>
<p class="muted-text">Unit totals, net change and trading figures are built from the feature values, so where those differ they carry the same causes; they are listed under each scenario below.</p>`
}

function notImplementedSection(results) {
  const items = SERVICE_GAPS.map((gap) => {
    const hits = results.flatMap((r) =>
      (r.notImplemented ?? []).filter((n) => n.gap === gap.id).map(() => r.id)
    )
    return hits.length
      ? `<li>${escape(gap.description)} <span class="muted-text">(${plural(hits.length, 'figure')} not compared, in ${plural(new Set(hits).size, 'scenario')})</span></li>`
      : ''
  }).filter(Boolean)
  return items.length
    ? `<ul>${items.join('')}</ul>`
    : '<p>Nothing: the service computes every figure the metric does.</p>'
}

function causeText(d) {
  if (d.causes?.length) {
    return d.causes.map((id) => CAUSES_BY_ID[id]?.title ?? id).join('; ')
  }
  if (isAnswer(d)) {
    return 'Answer differs'
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

function scenarioDifferences(result) {
  const rows = [...result.discrepancies]
    .sort((a, b) => rank(a) - rank(b))
    .map(
      (d) =>
        `<tr${rowClass(d)}><td>${escape(figureTitle(d))}</td><td class="num">${escape(valueText(d.expected, d.unit))}</td><td class="num">${escape(valueText(d.actual, d.unit))}</td><td class="num">${escape(differenceText(d))}</td><td>${escape(causeText(d))}</td></tr>`
    )
  return table(['Value', 'Metric', 'Service', 'Difference', 'Why'], rows)
}

function scenarioSummaryCounts(result) {
  const differences = result.discrepancies ?? []
  const answers = differences.filter(isAnswer).length
  const unexplained = differences.filter(isUnexplainedFeature).length
  return [
    answers ? plural(answers, 'answer differs', 'answers differ') : null,
    unexplained ? `${unexplained} with no known cause` : null,
    differences.length
      ? `${plural(differences.length, 'difference')} in all`
      : null
  ]
    .filter(Boolean)
    .join(' · ')
}

function scenarioBody(result) {
  if (
    result.outcome === OUTCOME.rejected ||
    result.outcome === OUTCOME.rejectedAsExpected
  ) {
    const errors = result.errors
      .map(
        (e) => `<li>${escape(e.message)} <code>${escape(e.code)}</code></li>`
      )
      .join('')
    return `<p>The service refused the ${escape(result.rejectedFile)} file:</p><ul>${errors}</ul>`
  }
  if (result.outcome === OUTCOME.workbookUnreadable) {
    return `<p>${escape(result.errors[0].message)}</p>`
  }
  const differences = result.discrepancies.length
    ? scenarioDifferences(result)
    : '<p>Every value matches the metric.</p>'
  return result.outcome === OUTCOME.acceptedInvalid
    ? `<p>The service accepted this scenario, which is built to hold invalid data, so it should have refused it.</p>${differences}`
    : differences
}

function scenariosSection(results) {
  return results
    .map((result) => {
      const counts = scenarioSummaryCounts(result)
      return `<details class="scenario" id="${anchor(result.id)}"><summary>${badge(statusOf(result))} <strong>${escape(result.id)}</strong>${counts ? ` <span class="muted-text">${escape(counts)}</span>` : ''}</summary>${scenarioBody(result)}</details>`
    })
    .join('')
}

const STYLE = `
:root{--bg:#fff;--fg:#1d2327;--muted:#5f6b73;--line:#d8dee2;--panel:#f5f7f8;--good:#1a7f37;--good-bg:#dff3e4;--bad:#b42318;--bad-bg:#fde7e4;--warn:#8a5a00;--warn-bg:#fdf1d6;--accent:#1d4ed8}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15181b;--fg:#e6e9eb;--muted:#9aa5ad;--line:#30363b;--panel:#1d2226;--good:#5cc47a;--good-bg:#173323;--bad:#ff8a7a;--bad-bg:#3a1c19;--warn:#f0b54a;--warn-bg:#3a2c10;--accent:#7aa2ff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 8px}
p,li{max-width:85ch}a{color:var(--accent)}code{font-size:12px;color:var(--muted)}
.context,.muted-text{color:var(--muted);font-size:13px}
.how{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 14px;font-size:14px}
ul.headline{list-style:none;padding:0;margin:16px 0}
ul.headline li{border-left:4px solid var(--line);padding:6px 12px;margin:6px 0;background:var(--panel);border-radius:0 6px 6px 0;font-size:16px}
ul.headline li.bad{border-color:var(--bad)}ul.headline li.warn{border-color:var(--warn)}ul.headline li.good{border-color:var(--good)}
ul.causes li{margin:8px 0}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:14px}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tr.row-bad td:first-child{border-left:3px solid var(--bad)}tr.row-warn td:first-child{border-left:3px solid var(--warn)}
.badge{display:inline-block;border-radius:999px;padding:1px 8px;font-size:12px;white-space:nowrap}
.badge.good{background:var(--good-bg);color:var(--good)}.badge.bad{background:var(--bad-bg);color:var(--bad)}
.badge.warn{background:var(--warn-bg);color:var(--warn)}.badge.muted{background:var(--panel);color:var(--muted);border:1px solid var(--line)}
details.scenario{border:1px solid var(--line);border-radius:8px;margin:6px 0;padding:0 12px}
details.scenario>summary{cursor:pointer;padding:8px 0}
@media (max-width:640px){main{padding:16px}th,td{padding:4px 6px}}
`

/**
 * @param {object[]} results compareScenario results
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {string[]} [options.context] plain-text lines under the title, such
 *   as where the scenarios came from and the commit compared
 * @returns {string} a complete HTML document
 */
export function renderComparisonHtml(results, options = {}) {
  const { title = 'Metric comparison', context = [] } = options
  const answers = withScenario(results, isAnswer)
  const unexplained = withScenario(results, isUnexplainedFeature)
  const explained = withScenario(
    results,
    (d) => d.category === CATEGORY.featureUnits && d.causes?.length > 0
  )
  const body = [
    `<h1>${escape(title)} — ${plural(results.length, 'scenario')}</h1>`,
    ...context.map((line) => `<p class="context">${escape(line)}</p>`),
    headline(results, answers, unexplained, explained),
    `<p class="how">Each value is compared exactly with the metric's. <strong>Metric</strong> is the value the Statutory Biodiversity Metric workbook calculates; <strong>Service</strong> is what the BNG service calculates from the same GeoPackages; <strong>Difference</strong> is the service's value less the metric's, in the same unit. Values are shown to ${DECIMAL_PLACES} decimal places; <code>report.xlsx</code> has every difference at full precision.</p>`,
    '<h2>1. Answers that differ</h2>',
    answersSection(answers),
    '<h2>2. Values that differ for no known reason</h2>',
    unexplainedSection(unexplained),
    '<h2>3. Known causes</h2>',
    causesSection(results),
    '<h2>4. Not implemented in the service yet</h2>',
    notImplementedSection(results),
    '<h2>5. Scenarios</h2>',
    '<p class="muted-text">Open a scenario for its full list of differences, most important first.</p>',
    scenariosSection(results)
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
