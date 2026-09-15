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
// The literal is kept spelled out rather than derived, because a generator that
// silently followed a renamed engine key would keep producing files while
// meaning something different. Instead it is asserted against both multiplier
// tables at load, so a drift fails loudly and immediately.
import {
  WATERCOURSE_ENCROACHMENT_MULTIPLIER,
  WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER
} from '../metric/index.mjs'

export const CULVERT_TYPE = 'Culvert'
export const CULVERT_ENCROACHMENT = 'N/A - Culvert'

for (const [label, table] of [
  ['watercourse encroachment', WATERCOURSE_ENCROACHMENT_MULTIPLIER],
  ['riparian encroachment', WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER]
]) {
  if (!(CULVERT_ENCROACHMENT in table)) {
    throw new Error(
      `bng-library: CULVERT_ENCROACHMENT "${CULVERT_ENCROACHMENT}" is not a key of the engine's ${label} multiplier table. ` +
        'The generators would emit watercourse rows that silently miss the multiplier lookup.'
    )
  }
}
