/**
 * Load a scenario corpus: each scenario's GeoPackage pair and the metric's
 * answers for it.
 *
 * A corpus is a `generate:scenarios` run — in bng-metric-harness, committed at
 * `example-files/permutations/` — whose `manifest.json` records every
 * recalculated workbook's answers. This library ships no corpus of its own:
 * the caller says where one is.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

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
 * @param {string} dir a `generate:scenarios` output folder
 * @returns {{ seed: number, template: string, corrections: object[],
 *   scenarios: CorpusScenario[] }}
 */
export function loadScenarioCorpus(dir) {
  if (!dir) {
    throw new Error(
      'loadScenarioCorpus needs a corpus folder: a generate:scenarios output, such as bng-metric-harness/example-files/permutations'
    )
  }
  const manifestPath = path.join(dir, MANIFEST)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (!manifest.recalculated) {
    throw new Error(
      `${manifestPath} has no metric results: generate the corpus with workbooks, recalculated`
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
