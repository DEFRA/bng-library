/**
 * Read the figures a recalculated metric workbook computes below its
 * headline: the units on every feature's row, and the trading summaries' net
 * unit changes and band totals.
 *
 * These are what a service run is compared against figure by figure (see
 * bng-library/metric-compare), so each is read from the cell the metric
 * computes it in and nothing is derived here.
 */

import { METRIC_SHEETS } from './template-layout.mjs'

const TRADING_AREA = 'Trading Summary Area Habitats'
const TRADING_HEDGEROW = 'Trading Summary Hedgerows'
const TRADING_WATERCOURSE = "Trading Summary WaterC's"

/**
 * Where each input sheet holds a feature's units, per stage of its life, with
 * the size those units were priced on (hectares, or kilometres for the
 * linear modules), and the strategic significance multiplier the row applies.
 * A created or enhanced stage also has its final time to target condition
 * (years, or "30+") and the multiplier the metric looks that up as.
 * `retained` is only read where the row retains something (its `retained`
 * input is filled), since the column holds 0 on every other row.
 */
const ROW_UNITS = {
  habitatBaseline: {
    module: 'area',
    strategicSignificance: 'O',
    stages: {
      baseline: { units: 'Q', size: 'H' },
      retained: { units: 'U', size: 'S' }
    }
  },
  habitatCreation: {
    module: 'area',
    strategicSignificance: 'N',
    stages: {
      created: { units: 'Y', size: 'G', years: 'S', timeMultiplier: 'T' }
    }
  },
  habitatEnhancement: {
    module: 'area',
    strategicSignificance: 'AC',
    stages: {
      enhanced: { units: 'AN', size: 'V', years: 'AH', timeMultiplier: 'AI' }
    }
  },
  hedgerowBaseline: {
    module: 'hedgerow',
    strategicSignificance: 'L',
    stages: {
      baseline: { units: 'N', size: 'E' },
      retained: { units: 'R', size: 'P' }
    }
  },
  hedgerowCreation: {
    module: 'hedgerow',
    strategicSignificance: 'L',
    stages: {
      created: { units: 'W', size: 'E', years: 'Q', timeMultiplier: 'R' }
    }
  },
  hedgerowEnhancement: {
    module: 'hedgerow',
    strategicSignificance: 'W',
    stages: {
      enhanced: { units: 'AH', size: 'P', years: 'AB', timeMultiplier: 'AC' }
    }
  },
  watercourseBaseline: {
    module: 'watercourse',
    strategicSignificance: 'L',
    stages: {
      baseline: { units: 'R', size: 'E' },
      retained: { units: 'W', size: 'U' }
    }
  },
  watercourseCreation: {
    module: 'watercourse',
    strategicSignificance: 'K',
    stages: {
      created: { units: 'Z', size: 'D', years: 'P', timeMultiplier: 'Q' }
    }
  },
  watercourseEnhancement: {
    module: 'watercourse',
    strategicSignificance: 'X',
    stages: {
      enhanced: { units: 'AM', size: 'Q', years: 'AC', timeMultiplier: 'AD' }
    }
  }
}

/**
 * Each trading summary lists its habitats in bands, each band headed
 * "<band> Distinctiveness" in column B, then a "Habitat group" header row,
 * then one row per habitat until column B is empty. The net change the
 * trading rules use is the project-wide column. The area summary also groups
 * its Medium habitats by broad habitat, with the broad habitat's cumulative
 * change on the group's first row.
 */
const SUMMARY_LAYOUT = {
  area: {
    sheet: TRADING_AREA,
    netUnitChange: 'F',
    broadHabitat: 'C',
    broadHabitatChange: 'G'
  },
  hedgerow: { sheet: TRADING_HEDGEROW, netUnitChange: 'E' },
  watercourse: { sheet: TRADING_WATERCOURSE, netUnitChange: 'E' }
}

/**
 * The band totals, by the cell the metric computes each in. Named for what
 * the metric labels them, so nobody mistakes one for a figure it is not.
 */
const BAND_TOTALS = {
  area: {
    veryHighSurplus: 'K12',
    highSurplus: 'K40',
    mediumSurplus: 'K88',
    mediumDeficit: 'K89',
    lowNetUnitChange: 'K124',
    lowCumulativeSurplus: 'K125'
  },
  hedgerow: {
    mediumNetUnitChange: 'I32',
    mediumCumulativeAvailability: 'I33',
    lowNetUnitChange: 'I43',
    lowCumulativeAvailability: 'I44',
    veryLowNetUnitChange: 'I53',
    veryLowCumulativeAvailability: 'I54'
  },
  watercourse: {
    mediumSurplus: 'I29',
    mediumDeficit: 'I30',
    lowNetUnitChange: 'I41',
    lowCumulativeAvailability: 'I42'
  }
}

const BAND_HEADING = /^(Very High|High|Medium|Low|Very Low) Distinctiveness$/
const HABITAT_GROUP_HEADER = 'Habitat group'
// The header follows its band heading directly, or after one blank row (the
// area summary's Low band).
const HEADER_SEARCH_ROWS = 2
// A band ends at the first empty row, well within this many rows.
const MAX_SUMMARY_ROWS = 400

/** Sheets these figures are read from, beyond the input sheets. */
export const FIGURE_SHEETS = [
  TRADING_AREA,
  TRADING_HEDGEROW,
  TRADING_WATERCOURSE
]

function value(sheet, ref) {
  const v = sheet?.[ref]?.v
  if (v === undefined || v === null) {
    return null
  }
  return typeof v === 'string' ? v.trim() || null : v
}

function isFilled(sheet, ref) {
  const v = value(sheet, ref)
  return v !== null && v !== 0
}

function rowFeatures(sheet, layout, unitColumns, row) {
  const reference = value(sheet, `${layout.columns.reference}${row}`)
  if (reference === null) {
    return []
  }
  const strategicSignificanceMultiplier = value(
    sheet,
    `${unitColumns.strategicSignificance}${row}`
  )
  return Object.entries(unitColumns.stages)
    .filter(
      ([stage]) =>
        stage !== 'retained' ||
        isFilled(sheet, `${layout.columns.retained}${row}`)
    )
    .map(([stage, columns]) => ({
      module: unitColumns.module,
      stage,
      reference: String(reference),
      units: value(sheet, `${columns.units}${row}`),
      size: value(sheet, `${columns.size}${row}`),
      strategicSignificanceMultiplier,
      timeToTarget: columns.years
        ? value(sheet, `${columns.years}${row}`)
        : null,
      timeToTargetMultiplier: columns.timeMultiplier
        ? value(sheet, `${columns.timeMultiplier}${row}`)
        : null,
      cell: `${columns.units}${row}`
    }))
}

/**
 * The units the metric gives every feature, one entry per feature per stage:
 * its baseline units, and whatever of it is retained, enhanced or created,
 * with the size and strategic significance multiplier they were priced on,
 * and, for what is created or enhanced, its final time to target condition
 * and that time's multiplier.
 *
 * @param {{ Sheets: object }} workbook
 * @returns {Array<{ module: string, stage: string, reference: string,
 *   units: number | string | null, size: number | null,
 *   strategicSignificanceMultiplier: number | null,
 *   timeToTarget: number | string | null,
 *   timeToTargetMultiplier: number | null, sheet: string, cell: string }>}
 */
export function readFeatureUnits(workbook) {
  const features = []
  for (const [key, unitColumns] of Object.entries(ROW_UNITS)) {
    const layout = METRIC_SHEETS[key]
    const sheet = workbook.Sheets[layout.sheet]
    for (let row = layout.firstRow; row <= layout.lastRow; row += 1) {
      for (const feature of rowFeatures(sheet, layout, unitColumns, row)) {
        features.push({ ...feature, sheet: key })
      }
    }
  }
  return features
}

function headerRowAfter(sheet, row) {
  for (let offset = 1; offset <= HEADER_SEARCH_ROWS; offset += 1) {
    if (value(sheet, `B${row + offset}`) === HABITAT_GROUP_HEADER) {
      return row + offset
    }
  }
  return null
}

function bandHeadings(sheet) {
  const headings = []
  for (let row = 1; row <= MAX_SUMMARY_ROWS; row += 1) {
    const match = BAND_HEADING.exec(value(sheet, `B${row}`) ?? '')
    const header = match ? headerRowAfter(sheet, row) : null
    if (header !== null) {
      headings.push({ band: match[1], firstRow: header + 1 })
    }
  }
  return headings
}

/**
 * One band's habitats, and broad habitats, with a non-zero net change. One
 * the site does not touch nets to zero and is left out, so the summary's
 * hundred-odd habitats do not bury the few the site has.
 */
function bandHabitats(sheet, layout, band, firstRow) {
  const habitats = []
  const broadHabitats = []
  let broadHabitat = null
  for (let row = firstRow; value(sheet, `B${row}`) !== null; row += 1) {
    const netUnitChange = value(sheet, `${layout.netUnitChange}${row}`)
    if (netUnitChange !== 0) {
      habitats.push({
        habitatType: value(sheet, `B${row}`),
        distinctiveness: band,
        netUnitChange
      })
    }
    if (layout.broadHabitatChange) {
      broadHabitat =
        value(sheet, `${layout.broadHabitat}${row}`) ?? broadHabitat
      const cumulative = value(sheet, `${layout.broadHabitatChange}${row}`)
      if (cumulative !== null && cumulative !== 0) {
        broadHabitats.push({ broadHabitat, netUnitChange: cumulative })
      }
    }
  }
  return { habitats, broadHabitats }
}

function readSummary(workbook, kind) {
  const layout = SUMMARY_LAYOUT[kind]
  const sheet = workbook.Sheets[layout.sheet]
  const habitats = []
  const broadHabitats = []
  for (const { band, firstRow } of bandHeadings(sheet)) {
    const found = bandHabitats(sheet, layout, band, firstRow)
    habitats.push(...found.habitats)
    if (band === 'Medium') {
      broadHabitats.push(...found.broadHabitats)
    }
  }
  const totals = Object.fromEntries(
    Object.entries(BAND_TOTALS[kind]).map(([name, ref]) => [
      name,
      value(sheet, ref)
    ])
  )
  return layout.broadHabitatChange
    ? { habitats, broadHabitats, totals }
    : { habitats, totals }
}

/**
 * The trading summaries' figures: each habitat's net unit change, the area
 * summary's Medium broad habitat totals, and each band's totals.
 *
 * @param {{ Sheets: object }} workbook
 */
export function readTradingFigures(workbook) {
  return Object.fromEntries(
    Object.keys(SUMMARY_LAYOUT).map((kind) => [
      kind,
      readSummary(workbook, kind)
    ])
  )
}
