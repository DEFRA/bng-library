# bng-library

Shared library for the Biodiversity Net Gain (BNG) projects. Provides:

- **Synthetic GeoPackage generation** — emit valid (or deliberately flawed) test gpkgs for development and CI.
- **Workbook-driven generation** — read a BNG metric workbook (`.xlsx`) and produce baseline + post-intervention gpkgs that match it.
- **Generic GeoPackage I/O** (`bng-library/gpkg-io`) — schema-agnostic helpers for reading and writing gpkg files.

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

See `index.mjs` for the full list of named exports.

## Development

```sh
npm install
npm test
```

This repo pins Node 24 via `.nvmrc` — run `nvm use` before installing so the `better-sqlite3` native binary is built against the right Node version.
