// Watercourse encroachment reference values shared by the synthetic and
// workbook generators.
//
// A culvert is an enclosed watercourse, so encroachment does not apply as a
// degree — both the watercourse and riparian encroachment columns take a single
// fixed category. The value MUST match the engine's multiplier-table key
// exactly: "N/A - Culvert" (spaces around the hyphen). The backend keys the
// watercourse-encroachment (0.68) and riparian-encroachment (1.0) multipliers on
// that literal and does NOT normalise "N/A Culvert" to it, so any other spelling
// misses the lookup and silently falls back to the default (1.0) multiplier.
//
// TODO(engine-move): when bng-metric-engine moves into this library (see
// docs/move-engine-into-bng-lib.md), assert these against the engine's
// watercourse-encroachment-multiplier tables directly instead of duplicating.
export const CULVERT_TYPE = 'Culvert'
export const CULVERT_ENCROACHMENT = 'N/A - Culvert'
