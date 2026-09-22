/**
 * Read the recalculated workbooks back with the library's own reader and
 * report what changed — the proof that a generated scenario produces figures
 * the workbook worked out for itself.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { readMetricWorkbook } from '../../src/workbook/metric-workbook.mjs'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const here = path.dirname(new URL(import.meta.url).pathname)
const dir = path.join(here, 'out', 'recalculated')

const TRADING_SUMMARY = 'Trading Summary Area Habitats'
/** The metric's own cumulative surplus of units, and the two bands behind it. */
const CUMULATIVE_SURPLUS = 'K125'
const MEDIUM_SURPLUS = 'K88'

function summarise(file) {
  const wb = readMetricWorkbook(path.join(dir, file))
  const raw = XLSX.readFile(path.join(dir, file), { cellFormula: true })
  const at = (ref) => raw.Sheets[TRADING_SUMMARY]?.[ref]?.v ?? null
  return {
    habitats: wb.habitats.baseline.length,
    hedgerows: wb.hedgerows.baseline.length,
    watercourses: wb.watercourses.baseline.length,
    mediumSurplus: at(MEDIUM_SURPLUS),
    cumulativeSurplus: at(CUMULATIVE_SURPLUS)
  }
}

const rows = [
  '00-source.xlsx',
  '01-added-rows.xlsx',
  '02-bug-corrected.xlsx',
  '03-added-rows-retained.xlsx',
  '04-added-loss.xlsx'
].map((file) => ({ file, ...summarise(file) }))

console.table(rows)
