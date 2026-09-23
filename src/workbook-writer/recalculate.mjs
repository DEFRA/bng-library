/**
 * Recalculate metric workbooks headlessly with LibreOffice.
 *
 * LibreOffice will not recalculate an .xlsx on load unless told to: its
 * OOXMLRecalcMode defaults to "never", so a plain --convert-to hands back the
 * values the file was saved with and looks exactly like success (BMD-1011).
 * The setting is seeded into a private user profile before the first launch.
 * The writer also strips every cached value, so a recalculation that did not
 * happen shows up as empty answers rather than stale ones.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const RECALC_ALWAYS = 0
const PROFILE_PREFIX = 'bng-lo-profile-'
// Recalculating the metric takes around ten seconds a workbook.
const TIMEOUT_PER_WORKBOOK_MS = 120_000

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

/**
 * A LibreOffice user profile that recalculates on load. Reuse one across
 * calls to avoid LibreOffice's first-launch set-up each time.
 */
export function createRecalcProfile(dir) {
  const profile = dir ?? mkdtempSync(path.join(tmpdir(), PROFILE_PREFIX))
  const user = path.join(profile, 'user')
  mkdirSync(user, { recursive: true })
  const registry = path.join(user, 'registrymodifications.xcu')
  if (!existsSync(registry)) {
    writeFileSync(registry, REGISTRY)
  }
  return profile
}

/** True when a LibreOffice binary can be run. */
export function isLibreOfficeAvailable(soffice = defaultSofficeCommand()) {
  const result = spawnSync(soffice, ['--version'], { encoding: 'utf8' })
  return result.status === 0
}

/**
 * Recalculate workbooks in one LibreOffice run.
 *
 * @param {string[]} files .xlsx paths
 * @param {object} options
 * @param {string} options.outDir where the recalculated copies are written,
 *   under the same file names
 * @param {string} [options.profile] from createRecalcProfile
 * @param {string} [options.soffice] LibreOffice binary
 * @returns {string[]} the recalculated files' paths, in input order
 */
export function recalculateWorkbooks(files, { outDir, profile, soffice } = {}) {
  if (files.length === 0) {
    return []
  }
  const command = soffice ?? defaultSofficeCommand()
  const userInstallation = pathToFileURL(profile ?? createRecalcProfile()).href
  mkdirSync(outDir, { recursive: true })
  const result = spawnSync(
    command,
    [
      `-env:UserInstallation=${userInstallation}`,
      '--headless',
      '--norestore',
      '--convert-to',
      'xlsx',
      '--outdir',
      outDir,
      ...files
    ],
    { encoding: 'utf8', timeout: TIMEOUT_PER_WORKBOOK_MS * files.length }
  )
  if (result.error?.code === 'ENOENT') {
    throw new Error(
      `LibreOffice not found (${command}). Install it (e.g. apt-get install libreoffice-calc) or set SOFFICE_PATH.`
    )
  }
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      `LibreOffice exited with status ${result.status}: ${result.stderr}`
    )
  }
  const outputs = files.map((file) => path.join(outDir, path.basename(file)))
  const missing = outputs.filter((file) => !existsSync(file))
  if (missing.length > 0) {
    throw new Error(`LibreOffice did not write: ${missing.join(', ')}`)
  }
  return outputs
}
