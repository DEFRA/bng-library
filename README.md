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
including the known cumulative-surplus error (BMD-993), so the results are the
metric's, not ours. The workbook is edited in place inside its zip, which keeps
it at the template's ~3.2MB. Re-saving through a spreadsheet library would
take it to ~82MB. Every cached value is stripped, so a workbook that has not
been recalculated reads as empty, never as stale.

`issues` lists every input that the template's own drop-down lists do not
offer. The metric's lookups are wrapped in `IFERROR`, so such a row raises
nothing and generates no units. The lists are read from the template, never
from this library's reference data.

No template to hand? `downloadPublishedTemplate()` fetches the calculation
tool Defra publishes on GOV.UK (`PUBLISHED_METRIC_TEMPLATE`: release 1.0.4,
checksum-pinned), the release the scenarios were validated against.

Recalculation needs LibreOffice (`soffice`, or `SOFFICE_PATH`). Excel
recalculates a generated workbook on open. `generatePermutations({
workbookTemplate })` adds each scenario's workbook to the permutations
output. The harness's `npm run generate:scenarios` builds the whole corpus.

The tests against the real template run when `METRIC_TEMPLATE` points at a
metric v4 workbook, which is not committed here; otherwise they are skipped.

## Entry points

| Specifier                     | Purpose                                             |
| ----------------------------- | --------------------------------------------------- |
| `bng-library`                 | Main API — synthesis, workbook reading, flaws, etc. |
| `bng-library/gpkg-io`         | Schema-agnostic GeoPackage read/write helpers.      |
| `bng-library/metric`          | Statutory reference tables and unit calculations.   |
| `bng-library/workbook-writer` | Synthetic metric workbooks for QA (BMD-1011).       |

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
