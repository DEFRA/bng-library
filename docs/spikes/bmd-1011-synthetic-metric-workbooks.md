# BMD-1011 — generating synthetic metric spreadsheets for QA

**Status:** spike complete, approach recommended
**Code:** `spikes/bmd-1011-metric-workbooks/` (throwaway, reproducible)

## The question behind the story

We want a comprehensive corpus of metric spreadsheets to check the service
against. The trap is subtle: if we generate the spreadsheets by writing _our_
computed numbers into them, then comparing the service to that corpus proves
only that our service agrees with itself.

So the approach has to be: **write only the input cells into a real Defra
template, leave the metric's own formulas intact, and let the workbook work out
its own answers.** Everything below follows from that.

## Recommendation

Viable, and cheaper than expected. Build it as:

1. Extend the existing scenario catalogue (`src/permutations/catalogue.mjs`)
   with the new axes — invalid interventions, each warning, trading-rule
   breaches.
2. Add a workbook **writer** beside the existing reader in `src/workbook/`, so
   one scenario produces both the GeoPackage and the matching spreadsheet.
3. Bug corrections as a short, declarative list of formula patches.
4. Harness runner plus LibreOffice in the CI image; prototype page after.

The single most important design point: **one scenario, both artefacts**. Feed
the GeoPackage through the service, read the workbook's own totals, compare. If
the two come from separate catalogues they will drift, and the time goes on
debugging fixtures rather than the service.

## What was proven

Four things could have sunk this. None did.

### 1. The workbook can be edited without breaking it

The obvious approach fails on size. Loading the workbook with SheetJS and
saving it again preserves all 43 sheets, all 134,730 formulas and all 103
defined names — but takes the file from **3.6MB to 82MB**, because it
re-serialises the styles. At a few hundred scenarios that is not a corpus
anyone can keep in a repository.

An `.xlsx` is a zip of XML parts. Rewriting only the worksheet parts that
change, and copying every other entry byte-for-byte, holds the file at
**3.2MB** with styles, validation, charts and the other sheets untouched.

Two things that helped: the workbook carries **no macros** and **no sheet
protection**, so nothing blocks writing into it.

### 2. Features can be added, not just edited

The template lays its rows out in advance — the Ref is filled in, the input
cells are styled but empty, and the computed columns already carry their
formulas. So adding a parcel is **filling a row the template already laid out**,
not inserting one, which is far easier and leaves the formula ranges alone.

Proven for all three feature types, including a watercourse written into a
sheet that held none:

| Workbook      | Habitats | Hedgerows | Watercourses |
| ------------- | -------- | --------- | ------------ |
| source        | 12       | 5         | 0            |
| after writing | **13**   | **6**     | **1**        |

### 3. It can be recalculated without Excel

LibreOffice recalculates faithfully — the published cumulative surplus of
`23.101216358632172` comes back as `23.1012163586322`, matching to thirteen
significant figures, with all 134,730 formulas preserved.

**It will not do it by default.** LibreOffice's `OOXMLRecalcMode` is "never" for
xlsx, so a plain `--convert-to` silently hands back the values the file was
saved with. This is the dangerous failure mode, because it looks exactly like
success and yields stale answers. The setting has to be forced in the user
profile.

### 4. The known bug is a single cell

The metric's cumulative surplus is built like this:

```
K89  = SUMIF(G89:G115,"<0")     → −9.4210   the Medium deficit
K90  = K40 + K12 + K89          ← the bug
K91  = K90 + K88
K125 = IF(K91>0, K124+K91, K124) → 23.1012
```

`K90` folds the Medium deficit into the running total before it is carried down
to the Low band. The trading rules do not permit that: a surplus in one broad
habitat cannot make good a deficit in another, so the deficit has to be settled
separately and those surplus units were never spoken for.

Dropping `K89` and recalculating gives **32.522236064296**. Our own engine
gives **32.52223606429601**.

That is worth more than the spike itself. Until now we had argued only that our
figure differs from the metric by the size of the deficit. This shows the
metric's own formulas, corrected, agreeing with us to fourteen significant
figures.

### The proof, end to end

Five workbooks, each generated, recalculated and read back through the
library's own reader:

| Scenario                    | Habitats | Hedgerows | Watercourses | Medium surplus | Cumulative surplus |
| --------------------------- | -------- | --------- | ------------ | -------------- | ------------------ |
| source                      | 12       | 5         | 0            | 122.5222       | 23.1012            |
| rows added, parcel lost     | 13       | 6         | 1            | 106.5222       | 7.1012             |
| bug corrected               | 12       | 5         | 0            | 122.5222       | **32.5222**        |
| rows added, parcel retained | 13       | 6         | 1            | 122.5222       | 23.1012            |
| loss only                   | 13       | 5         | 0            | 106.5222       | 7.1012             |

The added parcel is 2ha of Medium grassland in moderate condition — 16 units.
Lost, it takes exactly 16 off both the Medium surplus and the cumulative
surplus. Retained, it moves neither, which is correct: retention is a net
change of nil.

## The one trap to design around

Input values must match the workbook's own lists **character for character**.
Writing `Area/compensation not in local strategy/No local strategy` instead of
`.../ no local strategy` fails a lookup inside the metric's formulas. Those
formulas are wrapped in `IFERROR`, so the row does not raise anything — it
reports `Check Data ▲` and generates **no units**, silently.

A generator therefore has to source these values from the workbook's own
reference sheets, not from our reference data, or validate against them before
writing. Left unchecked this would produce a corpus of scenarios that quietly
compute nothing, and the comparison would pass because both sides are empty.

The flip side is useful: the workbook's own validation warnings fire on
generated data, which is most of what the story asks for when it asks to
trigger the different warnings.

## Costs and constraints

- **LibreOffice in CI** — about 400MB, and the recalculation setting has to be
  seeded into its profile. Not a per-PR job: each recalculation took tens of
  seconds, so a few hundred scenarios is nightly work.
- **Corpus storage** — roughly 3.2MB per workbook. A few hundred is about a
  gigabyte, which is a question about where they live rather than whether the
  approach works. Generating them in CI from the committed scenarios avoids it
  entirely.
- **Template provenance** — the Defra template would need to be committed or
  fetched. Likely fine under the Open Government Licence, but worth confirming.
- **A zip dependency** — the spike used Python for zip and XML from the standard
  library. A writer living beside the reader needs a small zip library in Node.

## Open questions for the team

1. Where does the corpus live, and is it versioned?
2. Who owns the bug corrections — this QA tooling, or do they feed back to
   whoever maintains the metric?
3. The prototype page needs no LibreOffice (Excel recalculates on open for a
   human tester). Is an on-demand single-scenario download useful enough to
   build alongside the CI corpus?
