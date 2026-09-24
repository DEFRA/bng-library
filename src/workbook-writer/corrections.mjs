/**
 * Known bugs in the published metric, corrected in every workbook written.
 *
 * The corpus is there to check that the service reaches the metric's answers.
 * Where the service deliberately fixes a mistake in the metric, a workbook
 * that kept the mistake would report a discrepancy on every site it touches,
 * and a real one would be lost among them. So each known bug is corrected
 * here, in the formula that makes it, and nowhere else: every other formula
 * is still Defra's own.
 *
 * Each correction names the formula it replaces. A template whose formula is
 * not that one is refused rather than patched, so a Defra release that
 * changes or fixes the cell has to be looked at before the corpus uses it.
 */

/**
 * @typedef {object} MetricCorrection
 * @property {string} id
 * @property {string} sheet
 * @property {string} ref
 * @property {string} published the formula the published metric holds
 * @property {string} corrected the formula written in its place
 * @property {string} description
 */

/** @type {readonly MetricCorrection[]} */
export const METRIC_CORRECTIONS = Object.freeze([
  Object.freeze({
    id: 'area-medium-surplus-carried-down-whole',
    sheet: 'Trading Summary Area Habitats',
    ref: 'K91',
    // K90 is the higher-distinctiveness surplus less the Medium deficit, and
    // K88 the Medium surplus. The published sum nets the deficit off the
    // Medium surplus, although the trading rules do not let one Medium broad
    // habitat make good another: a Medium deficit can only be offset by
    // trading up. The corrected sum carries the Medium surplus down to the
    // Low band whole, plus whatever higher surplus is left once the deficit
    // has been offset — the same sum the hedgerow summary makes in its I31.
    published: 'K90+K88',
    corrected: 'IF(K90>0,K90,0)+K88',
    description:
      'The Medium surplus offered to the Low band (the cumulative surplus of units) is no longer reduced by the Medium deficit. The published metric reports a Low band breach on a site whose Medium surplus covers its Low losses whenever another Medium broad habitat is in deficit; the service does not.'
  })
])

/**
 * Apply each correction to the template.
 *
 * @param {import('./metric-template.mjs').MetricTemplate} template
 * @param {readonly MetricCorrection[]} [corrections]
 */
export function applyCorrections(template, corrections = METRIC_CORRECTIONS) {
  for (const { sheet, ref, published, corrected } of corrections) {
    try {
      template.sheet(sheet).replaceFormula(ref, published, corrected)
    } catch (error) {
      throw new Error(
        `Cannot correct ${sheet}!${ref}: ${error.message}. The template is not the metric release the correction was written for.`,
        { cause: error }
      )
    }
  }
}
