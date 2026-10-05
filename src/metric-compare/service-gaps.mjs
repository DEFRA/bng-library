/**
 * What the metric computes that the service does not compute yet.
 *
 * A figure the workbook has and the service lacks is a discrepancy, unless a
 * gap here explains it — then it is reported as not implemented yet, with the
 * metric's value, rather than as a failure. A gap only ever excuses a missing
 * figure: once the service produces one, it is compared like any other, so
 * implementing a gap needs no change here for the comparison to pick it up.
 */

import { CATEGORY } from './figures.mjs'

const HIGHER_BANDS = new Set(['Very High', 'High'])

/**
 * @typedef {object} ServiceGap
 * @property {string} id
 * @property {string} description what the service does not do
 * @property {(figure: import('./figures.mjs').Figure) => boolean} covers
 */

/** @type {readonly ServiceGap[]} */
export const SERVICE_GAPS = Object.freeze([
  Object.freeze({
    id: 'hedgerow-trading-statuses',
    description:
      'The service computes the hedgerow trading figures but derives no hedgerow trading statuses.',
    covers: (figure) =>
      figure.module === 'hedgerow' && figure.category === CATEGORY.tradingStatus
  }),
  Object.freeze({
    id: 'higher-band-trading-statuses',
    description:
      'The service derives trading statuses for the Medium and Low bands only; the Very High and High band rules ("same habitat required") are not implemented.',
    covers: (figure) =>
      figure.category === CATEGORY.tradingStatus &&
      HIGHER_BANDS.has(figure.distinctiveness)
  }),
  Object.freeze({
    id: 'higher-band-trading-figures',
    description:
      'The service computes trading figures for the Medium and Low bands only; Very High and High habitats are left out of its trading rules.',
    covers: (figure) =>
      figure.category === CATEGORY.tradingFigures &&
      HIGHER_BANDS.has(figure.distinctiveness)
  })
])

/**
 * @param {import('./figures.mjs').Figure} figure a workbook figure the
 *   service does not have
 * @param {readonly ServiceGap[]} [gaps]
 * @returns {ServiceGap | undefined}
 */
export function gapCovering(figure, gaps = SERVICE_GAPS) {
  return gaps.find((gap) => gap.covers(figure))
}
