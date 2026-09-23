/**
 * bng-library/workbook-writer — synthetic Statutory Biodiversity Metric
 * workbooks for QA (BMD-1011).
 *
 * One scenario, both artefacts: the GeoPackage pair is generated as before,
 * and the matching workbook is derived from its post-intervention half by
 * writing inputs into the Defra template. The metric's formulas are never
 * touched, so once recalculated the workbook's answers are the metric's own.
 *
 *   const vocabulary = readTemplateVocabulary(templateBuffer)
 *   const { buffer, issues } = workbookFromGeoPackage({
 *     postInterventionPath, templateBuffer, vocabulary
 *   })
 *   // write buffer to disk, then:
 *   const [results] = await recalculateWorkbooks([file], { workDir })
 *   // results.headline, results.trading, results.rowWarnings …
 */

import { workbookRowsFromGeoPackage } from './gpkg-rows.mjs'
import {
  checkVocabulary,
  readTemplateVocabulary
} from './template-vocabulary.mjs'
import { writeMetricWorkbook } from './write-workbook.mjs'

export { METRIC_SHEETS } from './template-layout.mjs'
export { WORKBOOK_SPELLINGS, workbookRowsFromGeoPackage } from './gpkg-rows.mjs'
export {
  checkVocabulary,
  readTemplateVocabulary
} from './template-vocabulary.mjs'
export { writeMetricWorkbook } from './write-workbook.mjs'
export {
  createRecalcProfile,
  defaultSofficeCommand,
  isLibreOfficeAvailable,
  recalculateWorkbooks
} from './recalculate.mjs'
export { readMetricResults } from './read-results.mjs'
export { parseCsv, readCsvWorkbook } from './csv-sheets.mjs'
export { checkScenarioExpectations } from './expectations.mjs'
export {
  PUBLISHED_METRIC_TEMPLATE,
  downloadPublishedTemplate,
  isPublishedTemplate
} from './published-template.mjs'

/**
 * Derive a metric workbook from a post-intervention GeoPackage.
 *
 * @param {object} options
 * @param {string} options.postInterventionPath
 * @param {Buffer} options.templateBuffer the Defra metric v4 workbook
 * @param {object} [options.vocabulary] from readTemplateVocabulary; pass one
 *   in when writing many workbooks from the same template
 * @returns {{ buffer: Buffer, rows: object, issues: object[], notes: string[] }}
 *   `issues` lists every input the template's drop-down lists would not
 *   accept; each such row computes nothing in the metric
 */
export function workbookFromGeoPackage({
  postInterventionPath,
  templateBuffer,
  vocabulary
}) {
  const { rows, notes } = workbookRowsFromGeoPackage(postInterventionPath)
  const issues = checkVocabulary(
    rows,
    vocabulary ?? readTemplateVocabulary(templateBuffer)
  )
  const buffer = writeMetricWorkbook({ templateBuffer, rows })
  return { buffer, rows, issues, notes }
}
