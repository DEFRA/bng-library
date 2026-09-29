/**
 * bng-library/metric-compare — compare the service's figures for a site with
 * the Statutory Biodiversity Metric's own (BMD-1036).
 *
 * Feed it a folder of scenarios: each a baseline and post-intervention
 * GeoPackage beside the metric workbook for the same site. The metric's
 * answers are read from each workbook; the service's come from its project
 * response for the GeoPackage pair. Both become flat lists of comparable
 * figures — unit calculations per feature, unit totals, net gain, trading
 * rules figures and trading rules statuses — compared exactly.
 *
 *   const { scenarios } = findScenarios(folder)
 *   const answers = await readWorkbookAnswers(scenarios.map((s) => s.files.workbook))
 *   const results = []
 *   for (const [i, scenario] of scenarios.entries()) {
 *     const imported = await importIntoTheService(scenario.files)
 *     results.push(compareScenario({
 *       scenario,
 *       workbookError: answers[i].error,
 *       expected: answers[i].results && figuresFromWorkbook(answers[i].results),
 *       service: imported.accepted
 *         ? { accepted: true, figures: figuresFromProject(imported.project) }
 *         : imported
 *     }))
 *   }
 *   renderComparisonHtml(results)
 */

export {
  CATEGORY,
  CATEGORY_ORDER,
  CATEGORY_TITLES,
  KEY_SEPARATOR,
  MET,
  NOT_APPLICABLE,
  NOT_MET,
  SIZE_UNIT,
  UNIT,
  unitsOf
} from './figures.mjs'
export { figuresFromWorkbook } from './from-workbook.mjs'
export { figuresFromProject } from './from-project.mjs'
export { SERVICE_GAPS, gapCovering } from './service-gaps.mjs'
export { CAUSES, CAUSES_BY_ID, causesOfFeatureDifference } from './causes.mjs'
export {
  DIFFERENCE,
  OUTCOME,
  compareFigures,
  compareScenario
} from './compare.mjs'
export { findRegressions, knownDiscrepanciesFrom } from './regressions.mjs'
export { renderComparisonReport } from './report.mjs'
export { renderComparisonHtml } from './report-html.mjs'
export { renderComparisonXlsx } from './report-xlsx.mjs'
export {
  COLUMN_GUIDE,
  UNITS_GUIDE,
  summariseComparison
} from './report-data.mjs'
export { findScenarios, readWorkbookAnswers } from './corpus.mjs'
