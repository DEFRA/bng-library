# Statutory metric reference data

Lookup tables used by `bng-library/metric` for unit calculations and habitat/condition validation. Every file is imported statically in `../reference-constants.mjs`, which is the single inventory of all reference data. The metric entry point holds the **full set** of tables needed for unit calculations.

## Source

**Statutory Biodiversity Metric** (Natural England / Defra).

These tables mirror the reference data embedded in the published Statutory Metric calculation tool (Excel / associated guidance), not project-specific GeoPackage attributes. Habitat type strings must match the tool’s **Habitat Type** labels (e.g. `Grassland - Modified grassland`).

| Field           | Value                                                                                                                                                                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metric version  | Statutory Biodiversity Metric 4.0                                                                                                                                                                                                                                                                                |
| Tool / workbook | [Biodiversity Metric 4.0 Calculation Tool (macro-disabled), XLSX, 5.5 MB](https://publications.naturalengland.org.uk/file/6196272290332672) — sheets `G-6 Hedgerow Data` and `G-7 WaterC' Data` for linear habitat temporal/difficulty tables; other tables from the same workbook and GIS import tool as before |
| Extracted on    | 2026-06-05                                                                                                                                                                                                                                                                                                       |
| Extracted by    | Equal Experts BNG Metric Team                                                                                                                                                                                                                                                                                    |

## Files

| JSON file                                                     | Constant                                                 | Purpose                                                                                                                                                                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `difficulty-multiplier.json`                                  | `DIFFICULTY_MULTIPLIER`                                  | Habitat difficulty band → multiplier                                                                                                                                                                          |
| `habitat-area-condition-scores.json`                          | `CONDITION_SCORES`                                       | Condition band → numeric score per habitat area type                                                                                                                                                          |
| `habitat-area-difficulty.json`                                | `HABITAT_DIFFICULTY`                                     | Habitat area type → creation/enhancement difficulty band                                                                                                                                                      |
| `habitat-area-distinctiveness-categories.json`                | `DISTINCTIVENESS_CATEGORIES`                             | Habitat area type → distinctiveness band                                                                                                                                                                      |
| `habitat-area-distinctiveness-scores.json`                    | `DISTINCTIVENESS_SCORES`                                 | Distinctiveness band → score and suggested action                                                                                                                                                             |
| `habitat-area-time-to-target-creation.json`                   | `TIME_TO_TARGET_CREATION`                                | Years to target condition, habitat area (creation)                                                                                                                                                            |
| `habitat-area-time-to-target-enhancement.json`                | `TIME_TO_TARGET_ENHANCEMENT`                             | Years to target condition, habitat area (enhancement)                                                                                                                                                         |
| `hedgerow-condition-scores.json`                              | `HEDGEROW_CONDITION_SCORES`                              | Condition band → numeric score per hedgerow type                                                                                                                                                              |
| `hedgerow-distinctiveness-categories.json`                    | `HEDGEROW_DISTINCTIVENESS_CATEGORIES`                    | Hedgerow type → distinctiveness band                                                                                                                                                                          |
| `hedgerow-distinctiveness-scores.json`                        | `HEDGEROW_DISTINCTIVENESS_SCORES`                        | Distinctiveness band → score (hedgerow)                                                                                                                                                                       |
| `hedgerow-difficulty.json`                                    | `HEDGEROW_DIFFICULTY`                                    | Hedgerow type → creation/enhancement difficulty band                                                                                                                                                          |
| `hedgerow-time-to-target-creation.json`                       | `HEDGEROW_TIME_TO_TARGET_CREATION`                       | Years to target condition, hedgerow (creation)                                                                                                                                                                |
| `hedgerow-time-to-target-distinctiveness-enhancement.json`    | `HEDGEROW_TIME_TO_TARGET_DISTINCTIVENESS_ENHANCEMENT`    | Baseline hedge type → proposed type, years when enhancement raises distinctiveness (`G-6` “Enhancement Through Distinctiveness”); workbook `Error` cells are stored as `Not Possible` so they fail the lookup |
| `hedgerow-time-to-target-enhancement.json`                    | `HEDGEROW_TIME_TO_TARGET_ENHANCEMENT`                    | Years to target condition, hedgerow (enhancement)                                                                                                                                                             |
| `time-to-target-multiplier.json`                              | `TIME_TO_TARGET_MULTIPLIER`                              | Time-to-target years → multiplier                                                                                                                                                                             |
| `watercourse-condition-scores.json`                           | `WATERCOURSE_CONDITION_SCORES`                           | Condition band → numeric score per watercourse type                                                                                                                                                           |
| `watercourse-difficulty.json`                                 | `WATERCOURSE_DIFFICULTY`                                 | Watercourse type → creation/enhancement difficulty band                                                                                                                                                       |
| `watercourse-time-to-target-creation.json`                    | `WATERCOURSE_TIME_TO_TARGET_CREATION`                    | Years to target condition, watercourse (creation)                                                                                                                                                             |
| `watercourse-time-to-target-distinctiveness-enhancement.json` | `WATERCOURSE_TIME_TO_TARGET_DISTINCTIVENESS_ENHANCEMENT` | Fixed years when enhancement raises distinctiveness (`G-7` “Enhancement through Distinctiveness”)                                                                                                             |
| `watercourse-time-to-target-enhancement.json`                 | `WATERCOURSE_TIME_TO_TARGET_ENHANCEMENT`                 | Years to target condition, watercourse (enhancement)                                                                                                                                                          |
| `watercourse-distinctiveness-categories.json`                 | `WATERCOURSE_DISTINCTIVENESS_CATEGORIES`                 | Watercourse type → distinctiveness band                                                                                                                                                                       |
| `watercourse-distinctiveness-scores.json`                     | `WATERCOURSE_DISTINCTIVENESS_SCORES`                     | Distinctiveness band → score (watercourse)                                                                                                                                                                    |
| `watercourse-encroachment-multiplier.json`                    | `WATERCOURSE_ENCROACHMENT_MULTIPLIER`                    | Watercourse encroachment band → multiplier                                                                                                                                                                    |
| `watercourse-riparian-encroachment-multiplier.json`           | `WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER`           | Riparian encroachment band → multiplier                                                                                                                                                                       |

## Updating

1. Obtain the latest published Statutory Metric reference tables from Natural England.
2. Update the relevant JSON file(s) in this directory (preserve key strings exactly — they are join keys for GeoPackage data).
3. Add a static import and export in `../reference-constants.mjs` if adding a new table, and add a row to the table above.
4. Update the **Metric version** / **Extracted on** rows in this README.
5. Run `npm test -- src/metric/` here, and any bng-metric-backend tests that depend on the calculations.

## Corrections

Transcription errors found after extraction, and the evidence for each.

### 2026-09-18 — two Intertidal hard structures distinctiveness bands

`habitat-area-distinctiveness-categories.json`:

| Habitat type                                                                                                     | Was    | Now    |
| ---------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| `Intertidal hard structures - Artificial hard structures with integrated greening of grey infrastructure (IGGI)` | V.Low  | Medium |
| `Intertidal hard structures - Artificial features of hard structures`                                            | Medium | Low    |

Raised by the area-habitat trading-rules band table, which disagreed with these two
rows.
Corroborated by `habitat-area-condition-scores.json`: every other V.Low habitat scores
only `N/A - Other`, because a V.Low habitat cannot be condition-assessed. IGGI was the
sole V.Low row carrying a full Good → Poor condition ladder, which is only meaningful for
a habitat that can be assessed — so the V.Low band, not the condition row, was the error.

Distinctiveness bands feed the distinctiveness **score** (Medium 4, Low 2, V.Low 0), so
this changes unit values for these two habitat types wherever they appear.

## Licence

Same as the parent package — see `package.json` at the bng-library root (`OGL-UK-3.0`). Statutory Metric data is published by Natural England under Open Government Licence terms.
