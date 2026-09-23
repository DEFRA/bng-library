/**
 * The Statutory Biodiversity Metric calculation tool as Defra publishes it,
 * so nobody has to find and supply a template by hand.
 *
 * The macro-free .xlsx from "Statutory biodiversity metric tools and guides"
 * on GOV.UK. It is pinned by URL and checksum: the writer's layout fingerprint
 * and every scenario's expected verdict were checked against this file, which
 * gives results identical to the filled-in example workbook the work began
 * with. A newer release gets a new entry here once it has been checked the
 * same way.
 *
 * Downloaded, never committed: whether the tool may be redistributed is not
 * yet confirmed.
 */

import { createHash } from 'node:crypto'

export const PUBLISHED_METRIC_TEMPLATE = Object.freeze({
  version: '1.0.4',
  fileName: 'The_Statutory_Metric_Macro_Disabled_1.0.4.xlsx',
  url: 'https://assets.publishing.service.gov.uk/media/6867e62810d550c668de3b4e/The_Statutory_Metric_Macro_Disabled_1.0.4.xlsx',
  sha256: 'ecf81786e8c6d540ae1469f8f159226ae9e437ca0cff04fdd13820b1a321d3e8',
  page: 'https://www.gov.uk/government/publications/statutory-biodiversity-metric-tools-and-guides'
})

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** True when `buffer` is byte-for-byte the pinned release. */
export function isPublishedTemplate(buffer) {
  return sha256(buffer) === PUBLISHED_METRIC_TEMPLATE.sha256
}

/**
 * Download the pinned release and check it is the file the corpus was
 * validated against.
 *
 * @returns {Promise<Buffer>}
 */
export async function downloadPublishedTemplate({
  fetch = globalThis.fetch
} = {}) {
  const { url, sha256: expected } = PUBLISHED_METRIC_TEMPLATE
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Could not download the metric template (${response.status} ${response.statusText}) from ${url}`
    )
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (sha256(buffer) !== expected) {
    throw new Error(
      `The metric template downloaded from ${url} is not the release the corpus was validated against (checksum mismatch)`
    )
  }
  return buffer
}
