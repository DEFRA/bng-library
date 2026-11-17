/**
 * Download the pinned Statutory Biodiversity Metric calculation tool to the
 * given path, for the tests that write and recalculate a real workbook
 * (METRIC_TEMPLATE). The download is checked against the pinned checksum, so
 * a pin that no longer matches what GOV.UK serves fails here. A copy already
 * at the path is kept when it is the pinned release.
 *
 *   node scripts/download-metric-template.mjs <file.xlsx>
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  PUBLISHED_METRIC_TEMPLATE,
  downloadPublishedTemplate,
  isPublishedTemplate
} from '../src/workbook-writer/published-template.mjs'

const target = process.argv[2]
if (!target) {
  console.error('Usage: node scripts/download-metric-template.mjs <file.xlsx>')
  process.exit(1)
}

const { version, url } = PUBLISHED_METRIC_TEMPLATE
if (existsSync(target) && isPublishedTemplate(readFileSync(target))) {
  console.log(`Statutory Metric ${version} already at ${target}`)
} else {
  console.log(`Downloading the Statutory Metric ${version} from ${url}`)
  try {
    writeFileSync(target, await downloadPublishedTemplate())
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
  console.log(`Saved to ${target}, checksum matches the pin`)
}
