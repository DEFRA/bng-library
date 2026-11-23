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
 * 1.1.1 was the release GOV.UK served when it was pinned (2026-11-17), and it
 * replaced 1.0.4. 1.1.0 gave each entry tab 350 rows and 1.1.1 fixed an
 * off-site summary formula. The data sheets are unchanged from 1.0.4, and the
 * harness's two scenario corpora, rebuilt on 1.1.1, gave the same results as
 * their committed 1.0.4 workbooks (checked 2026-11-17); the harness
 * regenerates them when it repins this release.
 */

import { createHash } from 'node:crypto'

export const PUBLISHED_METRIC_TEMPLATE = Object.freeze({
  version: '1.1.1',
  fileName: 'The_Statutory_Metric_Macro_Disabled_1.1.1.xlsx',
  url: 'https://assets.publishing.service.gov.uk/media/6af2e02a8b63641b15a5c8bb/The_Statutory_Metric_Macro_Disabled_1.1.1.xlsx',
  sha256: '2ee1413bf5fb81537867d01de96c94e37be8f00d6d95da47f56656fedd1415a2',
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
