# BMD-1011 — generating synthetic metric workbooks

Throwaway code proving that a test scenario can be written into a real Defra
Statutory Biodiversity Metric v4 workbook, recalculated without a human opening
Excel, and read back. See `docs/spikes/bmd-1011-synthetic-metric-workbooks.md`
for the findings and the recommendation.

## Running it

Needs LibreOffice (`apt-get install -y --no-install-recommends libreoffice-calc`)
and a filled-in metric v4 workbook. No workbook is committed here — point at
your own:

```sh
export METRIC_WORKBOOK="/path/to/Example - Area Habitats MVS.xlsx"
python3 run_experiments.py   # writes out/*.xlsx, inputs and formula patches
./recalc.sh                  # recalculates each one headlessly
node verify.mjs              # reads them back with the library's own reader
```

`out/` is gitignored: each workbook is ~3.2MB and reproducible from the scripts.

## What each file is for

| File | Purpose |
| --- | --- |
| `workbook_patch.py` | Edits cells inside the .xlsx zip, rewriting only the worksheet parts it touches |
| `run_experiments.py` | The five scenarios: added rows, a retained control, a loss, and the bug correction |
| `recalc.sh` | Headless recalculation, including the setting LibreOffice needs to recalculate at all |
| `verify.mjs` | Reads the results back through `src/workbook/metric-workbook.mjs` |

## Why Python

Only for zip and XML in the standard library. A production writer belongs
beside the reader in `src/workbook/`, which would need a small zip dependency
in Node — not a choice worth making before the approach was proven.
