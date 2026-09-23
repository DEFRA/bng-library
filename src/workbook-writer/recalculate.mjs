/**
 * Recalculate metric workbooks headlessly with LibreOffice.
 *
 * LibreOffice will not recalculate an .xlsx on load unless told to: its
 * OOXMLRecalcMode defaults to "never", so a plain --convert-to hands back the
 * values the file was saved with and looks exactly like success (BMD-1011).
 * The setting is seeded into a private user profile before the first launch.
 * The writer also strips every cached value, so a recalculation that did not
 * happen shows up as empty answers rather than stale ones.
 *
 * The recalculated values are exported as one CSV per sheet, which takes
 * half the time of saving an .xlsx. Each workbook's export is read as soon as
 * LibreOffice finishes and then removed, so only the compact results are
 * kept and the scratch space never holds more than a few workbooks' CSVs.
 * Workbooks are shared between several LibreOffice processes, each with its
 * own profile — one profile cannot be used by two processes at once.
 */

import { spawn, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { availableParallelism } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { readCsvWorkbook } from './csv-sheets.mjs'
import { RESULT_SHEETS, readMetricResults } from './read-results.mjs'

const RECALC_ALWAYS = 0
// Recalculating the metric takes a few seconds a workbook.
const TIMEOUT_PER_WORKBOOK_MS = 120_000
// Every sheet, unformatted, UTF-8, comma-separated, with "-1" asking for one
// file per sheet rather than the first sheet only.
const CSV_FILTER =
  'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1'
// The sheet whose presence shows LibreOffice exported a workbook at all.
const RESULTS_SHEET = RESULT_SHEETS[0]
const STAGED_NAME_WIDTH = 4

const REGISTRY = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>${RECALC_ALWAYS}</value></prop></item>
</oor:items>
`

export function defaultSofficeCommand() {
  return (
    process.env.SOFFICE_PATH ??
    (process.platform === 'win32' ? 'soffice.exe' : 'soffice')
  )
}

/** A LibreOffice user profile, in `dir`, that recalculates on load. */
export function createRecalcProfile(dir) {
  const user = path.join(dir, 'user')
  mkdirSync(user, { recursive: true })
  const registry = path.join(user, 'registrymodifications.xcu')
  if (!existsSync(registry)) {
    writeFileSync(registry, REGISTRY)
  }
  return dir
}

/** True when a LibreOffice binary can be run. */
export function isLibreOfficeAvailable(soffice = defaultSofficeCommand()) {
  const result = spawnSync(soffice, ['--version'], { encoding: 'utf8' })
  return result.status === 0
}

function runSoffice(command, profile, files, outDir) {
  const args = [
    `-env:UserInstallation=${pathToFileURL(profile).href}`,
    '--headless',
    '--norestore',
    '--convert-to',
    CSV_FILTER,
    '--outdir',
    outDir,
    ...files
  ]
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: TIMEOUT_PER_WORKBOOK_MS * files.length
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      reject(
        error.code === 'ENOENT'
          ? new Error(
              `LibreOffice not found (${command}). Install it (e.g. apt-get install libreoffice-calc) or set SOFFICE_PATH.`
            )
          : error
      )
    })
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`LibreOffice exited with status ${code}: ${stderr}`))
      }
    })
  })
}

/**
 * Put `file` at `target` without copying its bytes where the filesystem
 * allows: a hard link needs no privileges on any platform, but only works
 * within one filesystem, so a copy is the fallback.
 */
function stage(file, target) {
  try {
    linkSync(file, target)
  } catch {
    copyFileSync(file, target)
  }
}

/** Deal `items` round-robin into `count` lists. */
function deal(items, count) {
  const hands = Array.from({ length: count }, () => [])
  items.forEach((item, i) => hands[i % count].push(item))
  return hands.filter((hand) => hand.length > 0)
}

/** Recalculate one staged workbook, read it, and clear up after it. */
async function recalculateOne(job, { command, profile, exported, read }) {
  const exportDir = path.join(exported, job.name)
  mkdirSync(exportDir, { recursive: true })
  await runSoffice(command, profile, [job.stagedFile], exportDir)
  try {
    const workbook = readCsvWorkbook(exportDir, job.name, RESULT_SHEETS)
    if (!workbook.Sheets[RESULTS_SHEET]) {
      throw new Error(`LibreOffice did not export ${job.file}`)
    }
    return read(workbook)
  } finally {
    rmSync(exportDir, { recursive: true, force: true })
    rmSync(job.stagedFile, { force: true })
  }
}

/**
 * Recalculate workbooks and read their results.
 *
 * Each input is staged under a fixed-width name first, so the name
 * LibreOffice gives each CSV ("<workbook>-<sheet>.csv") is predictable
 * whatever the input was called.
 *
 * @param {string[]} files .xlsx paths
 * @param {object} options
 * @param {string} options.workDir scratch space for profiles and exports;
 *   the caller owns it and removes it. On the same filesystem as `files`,
 *   inputs are staged as hard links rather than copies
 * @param {number} [options.processes] LibreOffice processes to run at once
 *   (default: one per CPU)
 * @param {string} [options.soffice] LibreOffice binary
 * @param {(workbook: object) => any} [options.read] what to keep from each
 *   recalculated workbook (`{ Sheets }`, the result sheets only); defaults
 *   to readMetricResults
 * @param {(done: number, total: number) => void} [options.onProgress]
 * @returns {Promise<any[]>} `read`'s result per input, in order
 */
export async function recalculateWorkbooks(
  files,
  { workDir, processes, soffice, read = readMetricResults, onProgress } = {}
) {
  if (files.length === 0) {
    return []
  }
  const command = soffice ?? defaultSofficeCommand()
  const staged = path.join(workDir, 'staged')
  const exported = path.join(workDir, 'exported')
  mkdirSync(staged, { recursive: true })

  const jobs = files.map((file, i) => {
    const name = `wb${String(i + 1).padStart(STAGED_NAME_WIDTH, '0')}`
    const stagedFile = path.join(staged, `${name}.xlsx`)
    stage(file, stagedFile)
    return { file, name, stagedFile, index: i }
  })

  const results = new Array(jobs.length)
  const workers = processes ?? availableParallelism()
  let done = 0
  await Promise.all(
    deal(jobs, workers).map(async (hand, w) => {
      const profile = createRecalcProfile(path.join(workDir, `profile-${w}`))
      // One workbook per launch keeps progress visible; LibreOffice's
      // start-up is a small part of each workbook's time.
      for (const job of hand) {
        results[job.index] = await recalculateOne(job, {
          command,
          profile,
          exported,
          read
        })
        done += 1
        onProgress?.(done, jobs.length)
      }
    })
  )
  return results
}
