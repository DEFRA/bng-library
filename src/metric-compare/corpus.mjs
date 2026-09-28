/**
 * The scenario corpus the comparison runs over: each scenario's GeoPackage
 * pair and the metric's answers for it.
 *
 * The corpus is a `generate:scenarios` run (in bng-metric-harness), trimmed to
 * what a comparison needs: the GeoPackages and `manifest.json`. The workbooks
 * themselves are left out — their answers are already in the manifest, so
 * nothing downstream needs LibreOffice or the Defra template. Refresh it with
 * `npm run corpus:import -- <generate:scenarios output folder>`.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

/** Where the committed corpus lives. */
export const SCENARIO_CORPUS_DIR = path.join(import.meta.dirname, 'corpus')

const MANIFEST = 'manifest.json'

/**
 * @typedef {object} CorpusScenario
 * @property {string} id
 * @property {string} purpose
 * @property {string} title
 * @property {{ baseline: string, postIntervention: string }} files absolute paths
 * @property {object} metric the recalculated workbook's answers
 */

/**
 * @param {string} [dir] a corpus folder: the committed one by default, or any
 *   `generate:scenarios` output
 * @returns {{ seed: number, template: string, corrections: object[],
 *   scenarios: CorpusScenario[] }}
 */
export function loadScenarioCorpus(dir = SCENARIO_CORPUS_DIR) {
  const manifest = JSON.parse(readFileSync(path.join(dir, MANIFEST), 'utf8'))
  if (!manifest.recalculated) {
    throw new Error(
      `${path.join(dir, MANIFEST)} has no metric results: generate the corpus with workbooks, recalculated`
    )
  }
  const scenarios = manifest.scenarios.map((s) => ({
    id: s.id,
    purpose: s.purpose,
    title: s.title,
    files: {
      baseline: path.join(dir, s.files.baseline),
      postIntervention: path.join(dir, s.files.postIntervention)
    },
    metric: s.metric
  }))
  return {
    seed: manifest.seed,
    template: manifest.template,
    corrections: manifest.corrections,
    scenarios
  }
}
