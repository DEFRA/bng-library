/**
 * The comparable figures: one flat list per side, every figure keyed the same
 * way whichever side it came from, so comparing the two is matching keys.
 *
 * A figure's key is its category, module and the path within them, e.g.
 * `feature-units|area|enhanced|H001` or `trading-status|watercourse|Medium`.
 */

/** Separator in a figure key. A habitat type can hold "/" and " - ". */
export const KEY_SEPARATOR = '|'

export const CATEGORY = Object.freeze({
  featureUnits: 'feature-units',
  totals: 'totals',
  netGain: 'net-gain',
  tradingFigures: 'trading-figures',
  tradingStatus: 'trading-status'
})

/** The order categories are reported in. */
export const CATEGORY_ORDER = Object.freeze([
  CATEGORY.featureUnits,
  CATEGORY.totals,
  CATEGORY.netGain,
  CATEGORY.tradingFigures,
  CATEGORY.tradingStatus
])

export const CATEGORY_TITLES = Object.freeze({
  [CATEGORY.featureUnits]: 'Unit calculations per feature',
  [CATEGORY.totals]: 'Unit totals',
  [CATEGORY.netGain]: 'Net gain',
  [CATEGORY.tradingFigures]: 'Trading rules figures',
  [CATEGORY.tradingStatus]: 'Trading rules statuses'
})

export const MODULES = Object.freeze(['area', 'hedgerow', 'watercourse'])

export const MET = 'Met'
export const NOT_MET = 'Not met'
export const NOT_APPLICABLE = 'N/A'

/**
 * @typedef {object} Figure
 * @property {string} key
 * @property {string} category one of CATEGORY
 * @property {string} module 'area', 'hedgerow' or 'watercourse'
 * @property {string} label what the figure is, for the report
 * @property {number | string | null} value
 * @property {boolean} [zeroWhenAbsent] a side that does not list the figure
 *   means zero by it: the trading summaries leave out whatever nets to zero
 * @property {string} [distinctiveness] a trading figure's band
 * @property {string} [source] where the figure was read from
 * @property {number | null} [size] a feature's size as priced: hectares, or
 *   kilometres for the linear modules
 * @property {number | null} [strategicSignificanceMultiplier] the multiplier
 *   the metric priced a feature with
 */

/**
 * @param {string[]} parts
 * @returns {string}
 */
export function figureKey(...parts) {
  return parts.join(KEY_SEPARATOR)
}

/**
 * Collects figures, keeping keys unique: a second figure with a key already
 * taken (two rows sharing a reference) gets a numbered key rather than
 * silently replacing the first.
 */
export class FigureList {
  constructor() {
    this.figures = []
    this.seen = new Map()
  }

  /** @param {Omit<Figure, 'key'> & { parts: string[] }} figure */
  add({ parts, ...figure }) {
    const base = figureKey(figure.category, figure.module, ...parts)
    const count = (this.seen.get(base) ?? 0) + 1
    this.seen.set(base, count)
    const key = count === 1 ? base : `${base}${KEY_SEPARATOR}#${count}`
    this.figures.push({ key, ...figure })
  }
}
