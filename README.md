# bng-library

Shared library for the Biodiversity Net Gain (BNG) projects. Provides:

- **Synthetic GeoPackage generation** — emit valid (or deliberately flawed) test gpkgs for development and CI.
- **Workbook-driven generation** — read a BNG metric workbook (`.xlsx`) and produce baseline + post-intervention gpkgs that match it.
- **Generic GeoPackage I/O** (`bng-library/gpkg-io`) — schema-agnostic helpers for reading and writing gpkg files.
- **Statutory metric engine** (`bng-library/metric`) — the BNG reference lookup tables and the unit calculations built on them.
- **Synthetic metric workbooks** (`bng-library/workbook-writer`) — write a scenario's GeoPackage into a copy of the Defra metric workbook, so the metric's own formulas give the expected results for QA.

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

Only input cells are written. The formulas are left as Defra wrote them,
including the known cumulative-surplus error, so the results are the
metric's, not ours. The workbook is edited in place inside its zip, which keeps
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

Recalculation needs LibreOffice (`soffice`, or `SOFFICE_PATH`). Excel
recalculates a generated workbook on open. `generatePermutations({
workbookTemplate })` adds each scenario's workbook to the permutations
output. The harness's `npm run generate:scenarios` builds the whole corpus.

The tests against the real template run when `METRIC_TEMPLATE` points at a
metric v4 workbook, which is not committed here; otherwise they are skipped.

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

| Field                  | Required | Meaning                                                                                                                                                                                              |
| ---------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | yes      | Unique, kebab-case; names the output files                                                                                                                                                           |
| `purpose`              | yes      | Kebab-case testing theme; the output folder, and the `--only` filter                                                                                                                                 |
| `title`, `description` | yes      | What the scenario demonstrates, shown in the harness's `index.md`                                                                                                                                    |
| `subject`              | yes      | `{ layer, ref, note }`: the feature a tester should open, such as `H001`                                                                                                                             |
| `size`                 |          | Habitat parcel count; also scales the hedgerow, river and tree counts                                                                                                                                |
| `overrides`            |          | Features to pin, as `{ habitats, hedgerows, rivers }` lists of rows. The first row pins the first feature, and so on; anything a row leaves out, and every feature past the list, is drawn at random |
| `emptyLayers`          |          | Layers generated empty (`habitats`, `hedgerows`, `rivers`, `trees`), so random features cannot add warnings or trading breaches of their own                                                         |
| `expectGain`           |          | `met` or `unmet`: the area net gain against 10%, checked through the engine and, with workbooks, the metric                                                                                          |
| `expectTrading`        |          | `{ area \| hedgerow \| watercourse: { band: "met" \| "breached" } }`, checked against the metric's trading summaries                                                                                 |
| `expectMetricWarnings` |          | `invalid-` only. Text of warnings the metric must raise on the subject                                                                                                                               |
| `expectRejectedInputs` |          | `invalid-` only. `sheetKey.field` inputs the workbook's drop-down lists must not offer                                                                                                               |

Override rows take the fields of `generateOne`'s `attributeOverrides`:

| Layer       | Fields                                                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| all         | `retention`, `baselineCondition`, `proposedCondition`, `baselineStrategicSignificance`, `proposedStrategicSignificance`, `advanceYears`, `delayYears`, `incomplete` (true blanks the proposed-side condition, strategic significance and encroachment) |
| `habitats`  | `habitatFullName`, `proposedHabitatFullName`, `parcelRef`                                                                                                                                                                                              |
| `hedgerows` | `hedgeType`, `proposedHedgeType`, `lengthRange`                                                                                                                                                                                                        |
| `rivers`    | `riverType`, `proposedRiverType`, `baselineWaterEncroachment`, `proposedWaterEncroachment`, `baselineRiparianEncroachment`, `proposedRiparianEncroachment`, `lengthRange`                                                                              |

Values are the GeoPackage template's own spellings, such as
`"Grassland - Other neutral grassland"` or `"Moderate"`. `lengthRange` is
`[min, max]` metres; the line is redrawn until it fits.

Things worth knowing when writing a scenario:

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
| `bng-library/metric`          | Statutory reference tables and unit calculations.   |
| `bng-library/workbook-writer` | Synthetic metric workbooks for QA.                  |

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
