/**
 * bng-library/metric-compare — compare the service's figures for a site with
 * the Statutory Biodiversity Metric's own (BMD-1036).
 *
 * The metric's answers come from a recalculated workbook (readMetricResults,
 * or a scenario corpus manifest); the service's from its project response
 * for the same GeoPackage pair. Both become flat lists of comparable figures —
 * unit calculations per feature, unit totals, net gain, trading rules figures
 * and trading rules statuses — compared exactly, figure by figure.
 *
 *   const { scenarios } = loadScenarioCorpus()
 *   for (const scenario of scenarios) {
 *     const imported = await importIntoTheService(scenario.files)
 *     const result = compareScenario({
 *       scenario,
 *       expected: figuresFromWorkbook(scenario.metric),
 *       service: imported.accepted
 *         ? { accepted: true, figures: figuresFromProject(imported.project) }
 *         : imported
 *     })
 *   }
 *   renderComparisonReport(results)
 */

export {
  CATEGORY,
  CATEGORY_ORDER,
  CATEGORY_TITLES,
  KEY_SEPARATOR,
  MET,
  NOT_APPLICABLE,
  NOT_MET
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
export { SCENARIO_CORPUS_DIR, loadScenarioCorpus } from './corpus.mjs'
