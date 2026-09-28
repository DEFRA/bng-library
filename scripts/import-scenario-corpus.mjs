#!/usr/bin/env node
/**
 * Refresh the committed scenario corpus (src/metric-compare/corpus) from a
 * `generate:scenarios` run in bng-metric-harness:
 *
 *   npm run corpus:import -- ../bng-metric-harness/test-data/scenarios
 *
 * Copies each scenario's GeoPackage pair and writes a manifest trimmed to what
 * a comparison needs. The workbooks are not copied: their answers are in the
 * manifest, and at a few MB each they would dwarf the rest of the package.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { SCENARIO_CORPUS_DIR } from '../src/metric-compare/corpus.mjs'

const MANIFEST = 'manifest.json'
const JSON_INDENT = 2

function fail(message) {
  console.error(message)
  process.exit(1)
}

const source = process.argv[2]
if (!source) {
  fail('Usage: npm run corpus:import -- <generate:scenarios output folder>')
}
const manifestPath = path.resolve(source, MANIFEST)
if (!existsSync(manifestPath)) {
  fail(`No ${MANIFEST} in ${path.resolve(source)}`)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (!manifest.recalculated) {
  fail(
    `${manifestPath} has no metric results: run generate:scenarios with workbooks, recalculated`
  )
}
const missingFigures = manifest.scenarios.filter(
  (s) => !s.metric?.features || !s.metric?.tradingFigures
)
if (missingFigures.length > 0) {
  fail(
    `${missingFigures.length} scenarios have no per-feature or trading figures: regenerate with a bng-library that reads them`
  )
}

console.log(`Replacing ${SCENARIO_CORPUS_DIR}`)
rmSync(SCENARIO_CORPUS_DIR, { recursive: true, force: true })

const scenarios = manifest.scenarios.map((s) => {
  for (const file of [s.files.baseline, s.files.postIntervention]) {
    const target = path.join(SCENARIO_CORPUS_DIR, file)
    mkdirSync(path.dirname(target), { recursive: true })
    copyFileSync(path.resolve(source, file), target)
  }
  return {
    id: s.id,
    purpose: s.purpose,
    title: s.title,
    files: {
      baseline: s.files.baseline,
      postIntervention: s.files.postIntervention
    },
    metric: s.metric
  }
})

writeFileSync(
  path.join(SCENARIO_CORPUS_DIR, MANIFEST),
  `${JSON.stringify(
    {
      seed: manifest.seed,
      template: manifest.template,
      corrections: manifest.corrections,
      recalculated: manifest.recalculated,
      scenarios
    },
    null,
    JSON_INDENT
  )}\n`
)
console.log(`Imported ${scenarios.length} scenarios`)
