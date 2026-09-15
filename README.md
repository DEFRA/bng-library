# bng-library

Shared library for the Biodiversity Net Gain (BNG) projects. Provides:

- **Synthetic GeoPackage generation** — emit valid (or deliberately flawed) test gpkgs for development and CI.
- **Workbook-driven generation** — read a BNG metric workbook (`.xlsx`) and produce baseline + post-intervention gpkgs that match it.
- **Generic GeoPackage I/O** (`bng-library/gpkg-io`) — schema-agnostic helpers for reading and writing gpkg files.
- **Statutory metric engine** (`bng-library/metric`) — the BNG reference lookup tables and the unit calculations built on them.

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

## Entry points

| Specifier             | Purpose                                             |
| --------------------- | --------------------------------------------------- |
| `bng-library`         | Main API — synthesis, workbook reading, flaws, etc. |
| `bng-library/gpkg-io` | Schema-agnostic GeoPackage read/write helpers.      |
| `bng-library/metric`  | Statutory reference tables and unit calculations.   |

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
