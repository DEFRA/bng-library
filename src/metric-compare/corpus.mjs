/**
 * Find the scenarios in a folder, and read each one's metric workbook.
 *
 * A scenario is three files side by side, named as `generate:scenarios`
 * names them — any folder of files named this way will do, hand-built test
 * spreadsheets included:
 *
 *   <name>-baseline.gpkg
 *   <name>-post-intervention.gpkg
 *   <name>.xlsx                     the metric workbook for the same site
 *
 * A workbook's answers are read from the values it was saved with — as Excel
 * saves them, or as `generate:scenarios` does after recalculating. One saved
 * without values (formulas only) is recalculated with LibreOffice first, when
 * LibreOffice is installed; otherwise it is reported as unreadable.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { INVALID_PREFIX } from '../permutations/invalid-data.mjs'
import { readMetricResults } from '../workbook-writer/read-results.mjs'
import {
  isLibreOfficeAvailable,
  recalculateWorkbooks
} from '../workbook-writer/recalculate.mjs'

const WORKBOOK = '.xlsx'
const BASELINE = '-baseline.gpkg'
const POST_INTERVENTION = '-post-intervention.gpkg'
const NOT_RECALCULATED = /not been recalculated/

/**
 * @typedef {object} CorpusScenario
 * @property {string} id the workbook's path within the folder, without its
 *   extension, e.g. "net-gain/met"
 * @property {string} name the file name the three files share, e.g. "met"
 * @property {string} purpose the sub-folder it is in ("" at the top level)
 * @property {boolean} invalidData its name says it holds invalid data
 * @property {{ baseline: string, postIntervention: string, workbook: string }} files
 */

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
    .filter((file) =>
      path
        .relative(dir, file)
        .split(path.sep)
        .every((part) => !part.startsWith('.'))
    )
}

/**
 * @param {string} dir a folder of scenarios, e.g. a `generate:scenarios` output
 * @returns {{ scenarios: CorpusScenario[], unmatched: string[] }} `unmatched`
 *   lists workbooks without both GeoPackages beside them
 */
export function findScenarios(dir) {
  if (!dir) {
    throw new Error(
      'findScenarios needs a folder of scenarios, such as bng-metric-harness/example-files/permutations'
    )
  }
  const files = new Set(listFiles(dir))
  const scenarios = []
  const unmatched = []
  for (const workbook of [...files]
    .filter((f) => f.endsWith(WORKBOOK))
    .sort()) {
    const stem = workbook.slice(0, -WORKBOOK.length)
    const baseline = `${stem}${BASELINE}`
    const postIntervention = `${stem}${POST_INTERVENTION}`
    if (!files.has(baseline) || !files.has(postIntervention)) {
      unmatched.push(path.relative(dir, workbook))
      continue
    }
    const id = path.relative(dir, stem).split(path.sep).join('/')
    const name = path.basename(stem)
    scenarios.push({
      id,
      name,
      purpose: path.dirname(id) === '.' ? '' : path.dirname(id),
      invalidData: name.startsWith(INVALID_PREFIX),
      files: { baseline, postIntervention, workbook }
    })
  }
  return { scenarios, unmatched }
}

function readSaved(file) {
  try {
    return { results: readMetricResults(readFileSync(file)) }
  } catch (error) {
    return NOT_RECALCULATED.test(error.message)
      ? { needsRecalculation: true }
      : { error: error.message }
  }
}

async function recalculateInto(answers, files, pending, options) {
  if (!isLibreOfficeAvailable(options.soffice)) {
    for (const i of pending) {
      answers[i] = {
        error:
          'The workbook was saved without its calculated values, and LibreOffice is not installed to recalculate it. Open and save it in Excel, or install LibreOffice.'
      }
    }
    return
  }
  const workDir = mkdtempSync(path.join(tmpdir(), 'metric-recalc-'))
  try {
    const results = await recalculateWorkbooks(
      pending.map((i) => files[i]),
      { workDir, soffice: options.soffice, processes: options.processes }
    )
    pending.forEach((i, n) => {
      answers[i] = { results: results[n], recalculated: true }
    })
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

/**
 * Read each workbook's answers: from its saved values, or by recalculating a
 * copy with LibreOffice where it has none. The workbooks are never changed.
 *
 * @param {string[]} files .xlsx paths
 * @param {{ soffice?: string, processes?: number }} [options]
 * @returns {Promise<Array<{ results?: object, recalculated?: boolean,
 *   error?: string }>>} one per file, in order
 */
export async function readWorkbookAnswers(files, options = {}) {
  const answers = files.map((file) => readSaved(file))
  const pending = answers
    .map((answer, i) => (answer.needsRecalculation ? i : -1))
    .filter((i) => i !== -1)
  if (pending.length > 0) {
    await recalculateInto(answers, files, pending, options)
  }
  return answers
}
