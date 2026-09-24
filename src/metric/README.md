# Statutory metric engine

Biodiversity Net Gain reference lookup tables and the statutory metric
calculations built on them: baseline units, post-intervention units (retained /
created / enhanced) for area habitats, hedgerows and watercourses, trading-rules
unit aggregates, and the distinctiveness, condition, time-to-target and difficulty
multipliers they depend on.

Consumed as `bng-library/metric`:

```js
import { calculateAreaHabitatBaseline } from 'bng-library/metric'
```

## Provenance

This directory was the `bng-metric-engine` npm workspace inside
[`bng-metric-backend`](https://github.com/DEFRA/bng-metric-backend). It moved
here so the statutory rules have one home, shared by the backend and the digital
prototype rather than reimplemented in each — the prototype previously carried
its own copy of the multipliers in `app/lib/metric-calcs.js`, and this library
carried vendored copies of the reference tables in `src/data/`.

Nothing about the calculations changed in the move. Files were renamed `.js` →
`.mjs` to match the rest of the library and their relative import specifiers
updated to suit; the module contents are otherwise unchanged, and all 251 tests
moved with them.

## Layout

| Path                      | What it holds                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `index.mjs`               | The public surface. Nothing outside this directory imports any other file.                                  |
| `reference/`              | The statutory lookup tables as JSON — see `reference/README.md` for sourcing and provenance.                |
| `reference-constants.mjs` | The single inventory of reference data; every table is imported here.                                       |
| `scripts/`                | Small CLIs for calculating one feature by hand, useful when checking a figure against the published metric. |
| `*.test.mjs`              | Tests, colocated with the module under test.                                                                |

## Conventions

Tests live next to the module they cover rather than in the top-level `tests/`
directory, which is how they were written and keeps the engine reviewable as one
self-contained unit. `vitest.config.mjs` includes both locations.

The reference tables are the authority for habitat vocabulary. Habitat type
strings must match the published metric tool's **Habitat Type** labels (for
example `Grassland - Modified grassland`), so anything deriving a habitat's
distinctiveness or condition options should read these tables rather than keep
its own list.
