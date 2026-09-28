/**
 * The comparison as a self-contained HTML page: a summary, the breakdowns,
 * and every scenario's discrepancies with how far the service is from the
 * metric, filterable by what was compared, module, and whether a known cause
 * explains the difference. No external assets, so it opens straight from a
 * CI artifact.
 */

import { CAUSES } from './causes.mjs'
import { OUTCOME } from './compare.mjs'
import { CATEGORY_ORDER, CATEGORY_TITLES, MODULES } from './figures.mjs'
import {
  CAUSES_NOTE,
  COLUMN_GUIDE,
  EXACTNESS_NOTE,
  UNITS_GUIDE,
  OUTCOME_TITLES,
  causeTitles,
  isRejected,
  isUnreadable,
  relative,
  signed,
  summariseComparison,
  withUnit
} from './report-data.mjs'

// Relative differences at or above these are shaded as moderate / large.
const MODERATE_RELATIVE = 0.0001
const LARGE_RELATIVE = 0.01

const OUTCOME_TONES = {
  [OUTCOME.matched]: 'good',
  [OUTCOME.discrepancies]: 'bad',
  [OUTCOME.rejected]: 'bad',
  [OUTCOME.rejectedAsExpected]: 'good',
  [OUTCOME.workbookUnreadable]: 'warn'
}

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

function anchor(id) {
  return `scenario-${id.toLowerCase().replaceAll(/[^a-z0-9-]/g, '')}`
}

function magnitude(relativeDifference) {
  if (typeof relativeDifference !== 'number') {
    return 'none'
  }
  const size = Math.abs(relativeDifference)
  if (size >= LARGE_RELATIVE) {
    return 'large'
  }
  return size >= MODERATE_RELATIVE ? 'moderate' : 'small'
}

/** The column guide's explanation of a column, shown as its header's tooltip. */
function guideFor(label) {
  const entry = COLUMN_GUIDE.find(
    ([column]) => label === column || label.startsWith(`${column} `)
  )
  return entry ? `${entry[1]} Measured in: ${entry[2]}` : null
}

function table(headers, rows, className = '') {
  return `<table class="${className}"><thead><tr>${headers
    .map((h) => {
      const title = guideFor(h)
      return `<th scope="col"${title ? ` title="${escape(title)}"` : ''}>${escape(h)}</th>`
    })
    .join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
}

function guideSection() {
  const units = UNITS_GUIDE.map(
    ([unit, meaning]) =>
      `<tr><td><strong>${escape(unit)}</strong></td><td>${escape(meaning)}</td></tr>`
  )
  const columns = COLUMN_GUIDE.map(
    ([column, meaning, unit]) =>
      `<tr><td><strong>${escape(column)}</strong></td><td>${escape(meaning)}</td><td>${escape(unit)}</td></tr>`
  )
  return `<details class="guide" open><summary><strong>How to read this report: units and columns</strong></summary>
<p>Every value names its unit: the <em>Unit</em> column in the discrepancy tables, and the difference’s own unit where it is not the same. Counts elsewhere are numbers of figures or scenarios. Hover over a column heading for its explanation.</p>
<h3>Units</h3>${table(['Unit', 'What it means'], units)}
<h3>Columns</h3><div class="scroll">${table(['Column', 'What it means', 'Measured in'], columns)}</div>
</details>`
}

/** A feature's size on each side and the metric's strategic significance. */
function pricedOnLine(d) {
  if (!d.sizeUnit) {
    return ''
  }
  const multiplier =
    typeof d.strategicSignificanceMultiplier === 'number' &&
    d.strategicSignificanceMultiplier !== 1
      ? ` · strategic significance ×${d.strategicSignificanceMultiplier} (metric; the service applies ×1)`
      : ''
  return `<div class="source">Priced on ${escape(withUnit(d.metricSize, d.sizeUnit))} (metric), ${escape(withUnit(d.serviceSize, d.sizeUnit))} (service)${escape(multiplier)}</div>`
}

function differenceCell(d) {
  const unit =
    d.difference !== null && d.differenceUnit && d.differenceUnit !== d.unit
      ? ` <span class="unit">${escape(d.differenceUnit)}</span>`
      : ''
  return `<td class="num">${escape(signed(d.difference))}${unit}</td>`
}

function tile(label, value, tone = '') {
  return `<div class="tile ${tone}"><div class="tile-value">${escape(value)}</div><div class="tile-label">${escape(label)}</div></div>`
}

function tiles({ scenarios, figures }) {
  return `<div class="tiles">${[
    tile('Scenarios', scenarios.total),
    tile('Figures compared', figures.compared),
    tile('Matched exactly', figures.matched, 'good'),
    tile('Differ', figures.discrepancies, figures.discrepancies ? 'bad' : ''),
    tile(
      'Per-feature, no known cause',
      figures.unexplainedFeatures,
      figures.unexplainedFeatures ? 'bad' : ''
    ),
    tile('Not implemented yet', figures.notImplemented, 'muted')
  ].join('')}</div>`
}

function scenarioTable(results) {
  const rows = results.map((r) => {
    const name =
      r.outcome === OUTCOME.matched
        ? escape(r.id)
        : `<a href="#${anchor(r.id)}">${escape(r.id)}</a>`
    return `<tr><td>${name}</td><td><span class="badge ${OUTCOME_TONES[r.outcome]}">${escape(OUTCOME_TITLES[r.outcome])}</span></td><td class="num">${escape(r.compared)}</td><td class="num">${escape(r.matched)}</td><td class="num">${escape(r.discrepancies?.length)}</td><td class="num">${escape(r.notImplemented?.length)}</td></tr>`
  })
  return table(
    [
      'Scenario',
      'Outcome',
      'Figures compared',
      'Figures matched',
      'Discrepancies',
      'Not implemented'
    ],
    rows
  )
}

function causesSection(data) {
  const rows = data.causeCombinations.map(
    (c) =>
      `<tr><td>${c.causes ? escape(c.causes) : '<strong>Nothing known</strong>'}</td><td class="num">${c.discrepancies}</td></tr>`
  )
  const definitions = Object.values(CAUSES)
    .map((c) => `<dt>${escape(c.title)}</dt><dd>${escape(c.description)}</dd>`)
    .join('')
  return `<p>${escape(CAUSES_NOTE)}</p>${table(['Explained by', 'Per-feature discrepancies (count)'], rows)}<dl>${definitions}</dl>`
}

function notImplementedSection(data) {
  return table(
    [
      'Gap',
      'What the service does not do yet',
      'Figures (count)',
      'Scenarios (count)'
    ],
    data.notImplemented.map(
      (g) =>
        `<tr><td><code>${escape(g.id)}</code></td><td>${escape(g.description)}</td><td class="num">${g.figures}</td><td class="num">${g.scenarios}</td></tr>`
    )
  )
}

function discrepancyRow(d) {
  const causes = causeTitles(d.causes)
  const explained = causes.length > 0
  return `<tr data-category="${escape(d.category)}" data-module="${escape(d.module)}" data-explained="${explained}" data-text="${escape(`${d.label} ${d.key}`.toLowerCase())}"><td>${escape(d.label)}${d.source ? `<div class="source">Metric cell: ${escape(d.source)}</div>` : ''}${pricedOnLine(d)}</td><td>${escape(CATEGORY_TITLES[d.category])}</td><td>${escape(d.module)}</td><td class="num">${escape(d.expected)}</td><td class="num">${escape(d.actual)}</td><td class="unit-col">${escape(d.unit)}</td>${differenceCell(d)}<td class="num mag-${magnitude(d.relativeDifference)}">${escape(relative(d.relativeDifference))}</td><td>${explained ? causes.map((c) => `<span class="badge muted">${escape(c)}</span>`).join(' ') : `<span class="badge ${d.kind === 'different' ? 'bad' : 'warn'}">${escape(d.kind === 'different' ? 'Unexplained' : d.kind)}</span>`}</td></tr>`
}

function scenarioDetail(result) {
  const heading = `<summary><span class="badge ${OUTCOME_TONES[result.outcome]}">${escape(OUTCOME_TITLES[result.outcome])}</span> <strong>${escape(result.id)}</strong> <span class="count" data-total="${result.discrepancies?.length ?? 0}">${escape(result.discrepancies?.length ?? 0)} discrepancies</span></summary>`
  if (isUnreadable(result)) {
    return `<details class="scenario rejected" id="${anchor(result.id)}">${heading}<p>Nothing was compared: ${escape(result.errors[0].message)}</p></details>`
  }
  if (isRejected(result)) {
    const errors = result.errors
      .map(
        (e) => `<li><code>${escape(e.code)}</code> ${escape(e.message)}</li>`
      )
      .join('')
    return `<details class="scenario rejected" id="${anchor(result.id)}">${heading}<p>The service refused the ${escape(result.rejectedFile)} file:</p><ul>${errors}</ul></details>`
  }
  const ordered = [...result.discrepancies].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
  )
  return `<details class="scenario" id="${anchor(result.id)}">${heading}${table(
    [
      'Figure',
      'What',
      'Module',
      'Metric',
      'Service',
      'Unit',
      'Difference (service − metric)',
      'Relative (% of metric value)',
      'Explained by'
    ],
    ordered.map((d) => discrepancyRow(d)),
    'discrepancies'
  )}</details>`
}

function options(values) {
  return values
    .map(
      ([value, label]) =>
        `<option value="${escape(value)}">${escape(label)}</option>`
    )
    .join('')
}

function filters() {
  return `<div class="filters" role="search">
<label>Search <input type="search" id="f-text" placeholder="Figure, reference or habitat"></label>
<label>What <select id="f-category"><option value="">All</option>${options(CATEGORY_ORDER.map((c) => [c, CATEGORY_TITLES[c]]))}</select></label>
<label>Module <select id="f-module"><option value="">All</option>${options(MODULES.map((m) => [m, m]))}</select></label>
<label class="check"><input type="checkbox" id="f-unexplained"> Unexplained only</label>
<button type="button" id="f-expand">Expand all</button>
</div>`
}

const STYLE = `
:root{--bg:#fff;--fg:#1d2327;--muted:#5f6b73;--line:#d8dee2;--panel:#f5f7f8;--good:#1a7f37;--good-bg:#dff3e4;--bad:#b42318;--bad-bg:#fde7e4;--warn:#8a5a00;--warn-bg:#fdf1d6;--accent:#1d4ed8;--mod:#fbe7c0;--large:#f7c8c1}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15181b;--fg:#e6e9eb;--muted:#9aa5ad;--line:#30363b;--panel:#1d2226;--good:#5cc47a;--good-bg:#173323;--bad:#ff8a7a;--bad-bg:#3a1c19;--warn:#f0b54a;--warn-bg:#3a2c10;--accent:#7aa2ff;--mod:#4a3a14;--large:#5a221d}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1280px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 8px}
p,dd{max-width:80ch}.context{color:var(--muted);margin:0 0 16px}
a{color:var(--accent)}code{font-size:12px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:16px 0}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px}
.tile-value{font-size:24px;font-weight:600;font-variant-numeric:tabular-nums}.tile-label{color:var(--muted);font-size:12px}
.tile.good .tile-value{color:var(--good)}.tile.bad .tile-value{color:var(--bad)}.tile.muted .tile-value{color:var(--muted)}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;margin:8px 0}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600;position:sticky;top:0;background:var(--bg)}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.source{color:var(--muted);font-size:11px}
.unit,.unit-col{color:var(--muted);font-size:12px}.unit-col{white-space:nowrap}
details.guide{border:1px solid var(--line);border-radius:8px;padding:0 12px;margin:16px 0;background:var(--panel)}details.guide>summary{cursor:pointer;padding:10px 0}h3{font-size:15px;margin:16px 0 4px}
th[title]{cursor:help;text-decoration:underline dotted}
.mag-moderate{background:var(--mod)}.mag-large{background:var(--large)}
.badge{display:inline-block;border-radius:999px;padding:1px 8px;font-size:12px;white-space:nowrap}
.badge.good{background:var(--good-bg);color:var(--good)}.badge.bad{background:var(--bad-bg);color:var(--bad)}
.badge.warn{background:var(--warn-bg);color:var(--warn)}.badge.muted{background:var(--panel);color:var(--muted);border:1px solid var(--line)}
.filters{display:flex;flex-wrap:wrap;gap:12px;align-items:end;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px;position:sticky;top:0;z-index:1}
.filters label{display:flex;flex-direction:column;font-size:12px;color:var(--muted);gap:2px}
.filters label.check{flex-direction:row;align-items:center;gap:6px;color:var(--fg)}
.filters input[type=search],.filters select,.filters button{font:inherit;padding:4px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
details.scenario{border:1px solid var(--line);border-radius:8px;margin:8px 0;padding:0 12px}
details.scenario>summary{cursor:pointer;padding:10px 0}
details.scenario .count{color:var(--muted);font-size:12px}
details.scenario.empty{display:none}
dl dt{font-weight:600;margin-top:8px}dl dd{margin:0}
@media (max-width:640px){main{padding:16px}th,td{padding:4px 6px}}
`

const SCRIPT = `
(function(){
  var text=document.getElementById('f-text'),cat=document.getElementById('f-category'),mod=document.getElementById('f-module'),unexp=document.getElementById('f-unexplained'),expand=document.getElementById('f-expand');
  function apply(){
    var q=text.value.trim().toLowerCase(),c=cat.value,m=mod.value,u=unexp.checked,filtering=q||c||m||u;
    document.querySelectorAll('details.scenario').forEach(function(d){
      var rows=d.querySelectorAll('tr[data-category]'),shown=0;
      rows.forEach(function(r){
        var ok=(!c||r.dataset.category===c)&&(!m||r.dataset.module===m)&&(!u||r.dataset.explained==='false')&&(!q||r.dataset.text.indexOf(q)!==-1);
        r.hidden=!ok;if(ok){shown++}
      });
      var n=d.querySelector('.count');
      if(n){n.textContent=(filtering?shown+' of ':'')+n.dataset.total+' discrepancies'}
      d.classList.toggle('empty',filtering&&rows.length>0&&shown===0||filtering&&rows.length===0);
    });
  }
  [text,cat,mod,unexp].forEach(function(el){el.addEventListener('input',apply)});
  expand.addEventListener('click',function(){
    var all=document.querySelectorAll('details.scenario'),open=expand.textContent==='Expand all';
    all.forEach(function(d){d.open=open});expand.textContent=open?'Collapse all':'Expand all';
  });
})();
`

/**
 * @param {object[]} results compareScenario results
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {string[]} [options.context] plain-text lines under the title, such
 *   as the corpus and the commit compared
 * @returns {string} a complete HTML document
 */
export function renderComparisonHtml(results, options = {}) {
  const { title = 'Metric comparison', context = [] } = options
  const data = summariseComparison(results)
  const detailed = results.filter((r) => r.outcome !== OUTCOME.matched)
  const body = [
    `<h1>${escape(title)}</h1>`,
    ...context.map((line) => `<p class="context">${escape(line)}</p>`),
    tiles(data),
    `<p>${data.scenarios.total} scenarios: ${data.scenarios.matched} matched, ${data.scenarios.discrepancies} with discrepancies, ${data.scenarios.rejected} rejected by the service, ${data.scenarios.rejectedAsExpected} rejected as expected (invalid data)${data.scenarios.workbookUnreadable ? `, ${data.scenarios.workbookUnreadable} whose workbook could not be read` : ''}.</p>`,
    `<p>${escape(EXACTNESS_NOTE)}</p>`,
    guideSection(),
    '<h2>Scenarios</h2>',
    `<div class="scroll">${scenarioTable(results)}</div>`,
    '<h2>Discrepancies by what was compared</h2>',
    table(
      ['What', 'Discrepancies (count)'],
      data.byCategory.map(
        (c) =>
          `<tr><td>${escape(c.title)}</td><td class="num">${c.discrepancies}</td></tr>`
      )
    ),
    '<h2>Known causes of the per-feature discrepancies</h2>',
    causesSection(data),
    '<h2>Not implemented in the service yet</h2>',
    `<div class="scroll">${notImplementedSection(data)}</div>`,
    '<h2>Discrepancies per scenario</h2>',
    detailed.length > 0
      ? `${filters()}<div class="scroll">${detailed.map((r) => scenarioDetail(r)).join('')}</div>`
      : '<p>None.</p>'
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
<script>${SCRIPT}</script>
</body>
</html>
`
}
