# bng-library

Shared library for the Biodiversity Net Gain (BNG) projects. Provides:

- **Synthetic GeoPackage generation** — emit valid (or deliberately flawed) test gpkgs for development and CI.
- **Workbook-driven generation** — read a BNG metric workbook (`.xlsx`) and produce baseline + post-intervention gpkgs that match it.
- **Generic GeoPackage I/O** (`bng-library/gpkg-io`) — schema-agnostic helpers for reading and writing gpkg files.
- **Feature size** (`bng-library/measure`) — the area and length a feature is priced on, the one definition both the service and the metric workbooks use.
- **Statutory metric engine** (`bng-library/metric`) — the BNG reference lookup tables and the unit calculations built on them.
- **Synthetic metric workbooks** (`bng-library/workbook-writer`) — write a scenario's GeoPackage into a copy of the Defra metric workbook, so the metric's own formulas give the expected results for QA.
- **Metric comparison** (`bng-library/metric-compare`) — compare the service's figures for a site with the metric's own, figure by figure, over a scenario corpus (committed in the harness).

## Install

```sh
npm install github:DEFRA/bng-library
```

To pin a specific version, append `#<tag>` once releases are tagged:

```sh
npm install github:DEFRA/bng-library#v0.1.0
```

### Peer dependencies

Consumers must install these themselves so the host controls the native binding's Node ABI version:

```sh
npm install better-sqlite3 xlsx
```

## Usage

### Synthetic gpkg (buffer-out)

```js
import { generateSyntheticGpkg } from 'bng-library'

const { buffer, messages, flawReport } = await generateSyntheticGpkg({
  numParcels: 5,
  centre: [530000, 180000]
})
```

Every random attribute is one the statutory metric accepts, read from its own
reference tables: conditions each habitat can have, creation only in
conditions it can be created in, enhancements that improve on the baseline,
and encroachment that never worsens. Invalid data comes only from the flaw
fixtures or from values a caller pins.

### Workbook-driven (buffer-in/out)

```js
import { generateFromWorkbookBuffer } from 'bng-library'
import { readFileSync } from 'node:fs'

const workbookBuffer = readFileSync('./metric.xlsx')
const { baseline, postIntervention, messages } =
  await generateFromWorkbookBuffer({ workbookBuffer })
```

### Statutory metric

```js
import {
  calculateAreaHabitatBaseline,
  DISTINCTIVENESS_CATEGORIES
} from 'bng-library/metric'

// Habitat types are keyed as they appear in the published metric tool.
const { units } = calculateAreaHabitatBaseline(
  1.5,
  'Grassland - Modified grassland',
  'Poor'
)
```

The reference tables are the authority for habitat vocabulary — anything
deriving a habitat's distinctiveness or its valid condition options should read
them rather than keep its own list.

### Generic gpkg I/O

```js
import { openGeoPackageReadonly } from 'bng-library/gpkg-io'

const db = openGeoPackageReadonly('./some.gpkg')
```

### Synthetic metric workbooks

Derive the Defra metric workbook that describes a post-intervention GeoPackage,
recalculate it headlessly, and read back the metric's own answers:

```js
import {
  recalculateWorkbooks,
  workbookFromGeoPackage
} from 'bng-library/workbook-writer'

const templateBuffer = readFileSync('./metric-v4.xlsx')
const { buffer, issues } = workbookFromGeoPackage({
  postInterventionPath: './site-post-intervention.gpkg',
  templateBuffer
})
writeFileSync('./out/site.xlsx', buffer)

const [results] = await recalculateWorkbooks(['./out/site.xlsx'], {
  workDir: './out/.recalc'
})
// results.headline.netUnitChange.area, results.trading, results.rowWarnings …
```

Only input cells are written, and the formulas are left as Defra wrote them,
so the results are the metric's, not ours. The exception is the metric's known
bugs, which the service corrects and so must the corpus, or every site they
touch would show a discrepancy that is not one. `METRIC_CORRECTIONS` lists
each: the cell, the formula Defra published and the one written in its place.
There is one so far. The area-habitat "Cumulative surplus of units"
(Trading Summary Area Habitats `K91`) nets the Medium deficit off the Medium
surplus before offering it to the Low band, so the metric can report a Low
breach the service does not. A template whose formula is not the one a
correction names is refused, not patched. Pass `corrections: []` to
`workbookFromGeoPackage` or `writeMetricWorkbook` for the metric exactly as
published. The workbook is edited in place inside its zip, which keeps
it at the template's ~3.2MB. Re-saving through a spreadsheet library would
take it to ~82MB. Every cached value is stripped, so a workbook that has not
been recalculated reads as empty, never as stale.

`issues` lists every input that the template's own drop-down lists do not
offer. The metric's lookups are wrapped in `IFERROR`, so such a row raises
nothing and generates no units. The lists are read from the template, never
from this library's reference data.

`lintWorkbook(buffer)` checks a workbook for the structural faults Excel
"repairs" on opening, which LibreOffice and the spreadsheet libraries read
straight past: a cached value that does not fit its cell's type, a stale
`calcChain.xml` entry, a broken shared formula, rows or cells out of order,
and missing parts or content types. It returns one `{ rule, part, ref,
message }` per fault, so a clean workbook gives `[]`. Excel does not publish
its repair rules, so this catches the faults a writer that edits worksheet XML
can introduce, not every file Excel might refuse.

No template to hand? `downloadPublishedTemplate()` fetches the calculation
tool Defra publishes on GOV.UK (`PUBLISHED_METRIC_TEMPLATE`: release 1.0.4,
checksum-pinned), the release the scenarios were validated against.

`saveRecalculatedWorkbooks(files, { workDir })` recalculates and saves each
workbook over itself with its values in, so `readMetricResults(buffer)` — or a
person opening it — can read the answers later without recalculating. The save
is normalised (LibreOffice's made-up identifiers renumbered, its dangling
relationships removed), so the same workbook saved twice gives the same bytes
and Excel has nothing to repair.

Recalculation needs LibreOffice (`soffice`, or `SOFFICE_PATH`). Excel
recalculates a generated workbook on open. `generatePermutations({
workbookTemplate })` adds each scenario's workbook to the permutations
output. The harness's `npm run generate:scenarios` builds the whole corpus.

The tests against the real template run when `METRIC_TEMPLATE` points at a
metric v4 workbook, which is not committed here; otherwise they are skipped.

### Metric comparison

`bng-library/metric-compare` checks the service against the Statutory
Biodiversity Metric (BMD-1036). The metric's answers come from a recalculated
workbook; the service's from its project response (`GET /projects/{id}`) for
the same GeoPackage pair. Each becomes a flat list of figures keyed the same
way, and the two lists are compared. Two numbers match when they differ by
less than `TOLERANCE.relative` (1e-12) of the metric's value, or by less than
`TOLERANCE.absolute` (1e-12) where that value is zero. That clears the
floating-point noise of the engine and the workbook adding up the same figures
in a different order (up to ~1e-13 relative on the corpus) and nothing more:
the comparison is there to catch the service calculating differently, so even
a difference too small to change a project's outcome — such as pricing a
size rounded to the whole square metre — is a discrepancy. A match that
is not exact is listed in the result's `withinTolerance`, with its difference.
Met / Not met answers must be equal:

| What                          | Figures                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Unit calculations per feature | each feature's baseline, retained, enhanced and created units, by reference                                        |
| Unit totals                   | baseline, post-intervention and net change, per module                                                             |
| Net gain                      | net change (%) and the 10% verdict, per module the site has                                                        |
| Trading rules figures         | each habitat's net change, the Medium broad habitat totals, surplus, deficit, Low net change and cumulative figure |
| Trading rules statuses        | Met / Not met per distinctiveness band                                                                             |

```js
import {
  compareScenario,
  figuresFromProject,
  figuresFromWorkbook,
  findScenarios,
  readWorkbookAnswers,
  renderComparisonHtml,
  renderComparisonReport,
  renderComparisonXlsx
} from 'bng-library/metric-compare'

// Each scenario: <name>-baseline.gpkg, <name>-post-intervention.gpkg and
// <name>.xlsx, side by side
const { scenarios } = findScenarios(folder)
const answers = await readWorkbookAnswers(
  scenarios.map((s) => s.files.workbook)
)
const results = []
for (const [i, scenario] of scenarios.entries()) {
  const imported = await importIntoTheService(scenario.files)
  results.push(
    compareScenario({
      scenario,
      workbookError: answers[i].error,
      expected: answers[i].results && figuresFromWorkbook(answers[i].results),
      service: imported.accepted
        ? { accepted: true, figures: figuresFromProject(imported.project) }
        : imported
    })
  )
}
writeFileSync('report.html', renderComparisonHtml(results))
writeFileSync('report.xlsx', renderComparisonXlsx(results))
writeFileSync('report.md', renderComparisonReport(results))
```

Every discrepancy is reported with both values, the difference (service less
metric) and the difference relative to the metric's value. What the metric
computes and the service does not yet — hedgerow trading statuses, and the
Very High and High band trading rules — is listed in `SERVICE_GAPS` and reported as
_not implemented_ rather than as a failure; once the service produces such a
figure it is compared like any other. A per-feature difference that a known
cause accounts for exactly — the service pricing a different size from the
metric's (`size-differs`; it once rounded sizes to whole square metres or
metres first), or a strategic significance multiplier the service did not
apply (`strategic-significance`; it prices every baseline at Low, per the LNRS
guidance) — carries that cause, but still counts.

`renderComparisonHtml` gives a short, self-contained page (no external assets,
so it opens straight from a CI artifact). It leads with the Met / Not met answers
that differ, then the values no known cause explains, the known causes of the
rest, and what the service does not implement yet, then each scenario's full
list of differences. Values are shown to four decimal places with their unit,
and differences as numbers in the same unit; one too small for twelve decimal
places is shown in scientific notation, so it never reads as zero.
`renderComparisonXlsx` gives a spreadsheet: a summary sheet, then one row per
scenario, per discrepancy and per figure not implemented, each with a frozen,
filterable header and real numbers to sort by. It is written with the
library's own zip writer, so it needs no spreadsheet dependency.
`renderComparisonReport` gives the same as Markdown; with `details: false` it
is a summary short enough for a CI job summary.

A scenario built on invalid data (its id starts `invalid-`) should be refused
by the service. If the service accepts it instead, the outcome is
`accepted-invalid` however its figures compare, so it is never reported as
matched.

For now a comparison reports; it does not judge. When some differences
should fail a build, `knownDiscrepanciesFrom(results)` records a run's
discrepancies and `findRegressions(results, known)` lists every way a later
run differs: a new or changed discrepancy, one that has gone, or a change of
outcome.

**Input.** A folder of scenarios, each three files side by side:
`<name>-baseline.gpkg`, `<name>-post-intervention.gpkg`, and `<name>.xlsx`,
the metric workbook for the same site. `findScenarios(folder)` pairs them by
name, so any folder named this way will do, hand-built test spreadsheets
included. `readWorkbookAnswers` reads each workbook's answers from the values it
was saved with (as Excel saves them, and as `generate:scenarios` saves them
after recalculating), with the library's own reader, so no spreadsheet
dependency is needed. A workbook saved with formulas only is recalculated with
LibreOffice first, when it is installed; otherwise it is reported as unreadable
and nothing is compared for it. A hand-built workbook compares feature by
feature only where its rows' references match the GeoPackages' feature
references; totals, net gain and trading are compared regardless.

This library ships no scenarios. The committed ones are in the harness, at
`example-files/permutations/`. The service side runs in the backend:
`npm run compare:metric` there imports every scenario through its upload
pipeline and writes the reports.

### Scenario catalogue

The test scenarios are configuration, kept in one file:
[`src/permutations/scenarios.json`](src/permutations/scenarios.json). Each
scenario becomes a baseline / post-intervention GeoPackage pair, and in the
harness a metric workbook too. To add, change or remove a scenario, edit that
file; no code changes are needed. `generatePermutations` and the harness's
`npm run generate:scenarios` build whatever it holds.

The file is checked when it is loaded, and every problem is reported at once.
A misspelt field, an override the generator does not recognise, or an
expectation it cannot check stops the load rather than being silently
ignored.

**Only a scenario whose id starts `invalid-` holds invalid data**, and its
files are named for it. It must declare the errors it expects
(`expectMetricWarnings` or `expectRejectedInputs`); no other scenario may.
Everything a scenario does not pin is drawn at random from what the metric
accepts (see `src/synthetic/valid-draws.mjs`), so every other scenario is
valid throughout. `checkScenarioExpectations` adds a _valid data_ check to
each of them: no metric error on any row, and no rejected input. A `$comment` is allowed on any scenario or override row, for notes
the file would otherwise lose.

The file holds `defaultSize`, the habitat parcel count for a scenario with no
`size`, and `scenarios`, a list of:

| Field                  | Required | Meaning                                                                                                                                                                                                                                           |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | yes      | Unique, kebab-case; names the output files                                                                                                                                                                                                        |
| `purpose`              | yes      | Kebab-case testing theme; the output folder, and the `--only` filter                                                                                                                                                                              |
| `title`, `description` | yes      | What the scenario demonstrates, shown in the harness's `index.md`                                                                                                                                                                                 |
| `subject`              | yes      | `{ layer, ref, note }`: the feature a tester should open, such as `H001`                                                                                                                                                                          |
| `size`                 |          | Habitat parcel count; also scales the hedgerow, river and tree counts                                                                                                                                                                             |
| `treeCount`            |          | Individual tree count, in place of the one `size` derives                                                                                                                                                                                         |
| `overrides`            |          | Features to pin, as `{ habitats, hedgerows, rivers, trees }` lists of rows. The first row pins the first feature, and so on; anything a row leaves out, and every feature past the list, is drawn at random                                       |
| `emptyLayers`          |          | Layers generated empty (`habitats`, `hedgerows`, `rivers`, `trees`), so random features cannot add warnings or trading breaches of their own                                                                                                      |
| `expectGain`           |          | `met` or `unmet`: the area net gain against 10%, checked through the engine and, with workbooks, the metric                                                                                                                                       |
| `expectTrading`        |          | `{ area \| hedgerow \| watercourse: { band: "met" \| "breached" } }`, checked against the metric's trading summaries                                                                                                                              |
| `expectUnitOrder`      |          | `{ stage, references }`: features whose units at one stage (`baseline`, `retained`, `created` or `enhanced`) must fall strictly in the order listed, checked against the metric's rows                                                            |
| `expectUnitsEqual`     |          | `{ stage, references }`: features whose units at one stage must all be the same, checked against the metric's rows                                                                                                                                |
| `expectUnitRatio`      |          | A list of `{ stage, reference, control, factor }`: a feature whose units at one stage must be exactly `factor` times its control's, checked against the metric's rows                                                                             |
| `expectTimeToTarget`   |          | A list of `{ stage, references, years, multiplier }`: the final time to target condition (whole years from 0, or else `"30+"`) and its multiplier the metric must give each created or enhanced feature listed, checked against the metric's rows |
| `expectMetricWarnings` |          | `invalid-` only. Text of warnings the metric must raise on the subject                                                                                                                                                                            |
| `expectRejectedInputs` |          | `invalid-` only. `sheetKey.field` inputs the workbook's drop-down lists must not offer                                                                                                                                                            |

Override rows take the fields of `generateOne`'s `attributeOverrides`:

| Layer       | Fields                                                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| all         | `retention`, `baselineCondition`, `proposedCondition`, `baselineStrategicSignificance`, `proposedStrategicSignificance`, `advanceYears`, `delayYears`, `incomplete` (true blanks the proposed-side condition, strategic significance and encroachment) |
| `habitats`  | `habitatFullName`, `proposedHabitatFullName`, `parcelRef`                                                                                                                                                                                              |
| `hedgerows` | `hedgeType`, `proposedHedgeType`, `lengthRange`, `sameLineAs`                                                                                                                                                                                          |
| `rivers`    | `riverType`, `proposedRiverType`, `baselineWaterEncroachment`, `proposedWaterEncroachment`, `baselineRiparianEncroachment`, `proposedRiparianEncroachment`, `lengthRange`, `sameLineAs`                                                                |
| `trees`     | `treeSize`, `treeType`, `ruralOrUrban`, each pinning both sides of the tree (a created tree's baseline stays "N/A"); `count`, the number of trees the point stands for (the `Count` column; 1 unless pinned)                                           |

Values are the GeoPackage template's own spellings, such as
`"Grassland - Other neutral grassland"` or `"Moderate"`. `lengthRange` is
`[min, max]` metres; the line is redrawn until it fits.
`sameLineAs` is the ref of an earlier feature in the same layer (`"HG001"`):
the row takes that feature's line, so the two are the same length. It is how
a scenario records a feature lost and recreated in place. A row with it cannot
also pin `lengthRange`.

Things worth knowing when writing a scenario:

- **Strategic significance.** Follow Defra's LNRS guidance, as the service
  does: every baseline is Low
  (`"Area/compensation not in local strategy/ no local strategy"`), and a
  proposed feature is Low or High (`"Formally identified in local strategy"`),
  never Medium. The catalogue rejects any other value, and features drawn at
  random follow the same rule.
- **Distinctiveness.** Pin only Medium or lower habitats: the service rejects
  High and Very High at upload. The existing scenarios use
  `Grassland - Modified grassland` (Low) and
  `Grassland - Other neutral grassland` (Medium), which accept all five
  conditions, so any condition can be pinned.
- **Line lengths.** Random hedgerow and river lengths vary about 40-fold,
  enough to swamp a designed margin between a loss and its replacement. The
  trading-rule scenarios pin every linear feature to `[300, 400]`.
- **Isolation.** A scenario that tests one feature should list the other
  layers in `emptyLayers`, and pin every feature in its own layer, so nothing
  random can move its verdict. A small fixture still draws at least two
  hedgerows and two rivers, so pin at least that many.
- **Trading rules**, as the metric's trading summaries state them: area
  Medium needs the same broad habitat or higher distinctiveness, area Low the
  same distinctiveness or better; hedgerows the same distinctiveness or
  better; watercourse Medium the same habitat, watercourse Low better
  distinctiveness. Each is a test of units as well as habitat, and a deficit
  in a lower band may be met from a surplus in a higher one, never the other
  way round. A created habitat is discounted for the years it takes to reach
  condition, so one-for-one replacement usually falls short.
- **Not asserted:** a culvert replaced by another culvert. The watercourse
  Low rule reads "better distinctiveness habitat required", but the metric
  meets it whenever the new culvert brings enough units.

A few tests name scenarios by id (`invalid-area-condition-reduced`,
`trading-higher-deficit-not-covered-from-below` here; five more in the
harness), so renaming or removing one of those means updating the test.

## Entry points

| Specifier                     | Purpose                                             |
| ----------------------------- | --------------------------------------------------- |
| `bng-library`                 | Main API — synthesis, workbook reading, flaws, etc. |
| `bng-library/gpkg-io`         | Schema-agnostic GeoPackage read/write helpers.      |
| `bng-library/measure`         | The area and length a feature is priced on.         |
| `bng-library/metric`          | Statutory reference tables and unit calculations.   |
| `bng-library/workbook-writer` | Synthetic metric workbooks for QA.                  |
| `bng-library/metric-compare`  | Compare the service with the metric (BMD-1036).     |

See `index.mjs` for the full list of named exports, and `src/metric/README.md`
for the metric engine.

`bng-library/metric` is pure calculation over bundled JSON tables — it needs
neither of the peer dependencies below, so a consumer that only wants the maths
can import it without installing `better-sqlite3` or `xlsx`.

## Development

```sh
npm install
npm test
```

This repo pins Node 24 via `.nvmrc` — run `nvm use` before installing so the `better-sqlite3` native binary is built against the right Node version.

### Metric comparison in CI

The _Metric comparison_ workflow (`.github/workflows/metric-comparison.yml`)
runs on each pull request and each merge group. It calls
bng-metric-harness's comparison with the commit to test, which checks out
bng-metric-backend, swaps its bng-library for this commit, and compares the
service's figures with the Statutory Biodiversity Metric's for every scenario
in the harness's corpus. So a change here that would regress the service is
caught before it merges, not when the backend next repins. Any difference
nothing known explains fails the check
`Compare the service with the metric / Compare the service with the metric (library candidate)`;
whether that gates the merge is set by the ruleset on `main`.

A pull request is compared against the backend branch of the same name if there
is one, otherwise the backend's `main`. A merge group is always compared against
the backend's `main`, which is what the change meets once it merges. So a change
that needs a paired backend branch passes in the merge queue only once that
branch is merged: merge the backend change first, pinned to the pull request's
head commit. Once the pull request merges, repin the backend to the merge commit
on `main`; until then it depends on a commit that's only on the pull request.
See the harness's
[docs/compare-metric.md](https://github.com/DEFRA/bng-metric-harness/blob/main/docs/compare-metric.md).
