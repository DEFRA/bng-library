/**
 * Where the inputs live in a Statutory Biodiversity Metric v4 workbook.
 *
 * The template lays every data row out in advance: the reference is filled
 * in, the input cells are styled but empty, and the computed columns already
 * carry their formulas. Writing a feature is filling a row, never inserting
 * one, so no formula range moves.
 *
 * Only the columns named here are ever written or cleared. Each sheet also
 * names a few header cells as a fingerprint: `verifyLayout` checks them before
 * anything is written, so a template whose columns have moved fails loudly
 * instead of taking inputs in the wrong cells.
 *
 * `titleCell` is the sheet's own name, worked out with CELL("filename"),
 * which LibreOffice cannot always evaluate: it is not a metric output.
 *
 * A column listed in a sheet's `overridesFormula` holds a default formula
 * the user is meant to replace; it is overwritten there, and only there.
 *
 * The enhancement sheets (A-3, B-3, C-3) derive their baseline half from the
 * baseline sheet: row k is the k-th baseline row, in line order, that has an
 * enhanced area or length. Only their proposed half is input.
 *
 * `lastRow` is the last data row in the pinned release (1.1.1), where every
 * sheet has 350. Releases before 1.1.0 have fewer: `inputLastRows` tells them
 * apart from the workbook itself, so a 1.0.4 workbook is still written and
 * read up to its own last row, and never into its totals row.
 */

export const METRIC_SHEETS = {
  habitatBaseline: {
    sheet: 'A-1 On-Site Habitat Baseline',
    titleCell: 'D3',
    firstRow: 11,
    lastRow: 360,
    fingerprint: {
      E10: 'Broad Habitat',
      H10: 'Area (hectares)',
      K10: 'Condition',
      S10: 'Area retained',
      T10: 'Area enhanced'
    },
    columns: {
      broadHabitat: 'E',
      habitatType: 'F',
      irreplaceable: 'G',
      size: 'H',
      condition: 'K',
      strategicSignificance: 'M',
      retained: 'S',
      enhanced: 'T',
      bespokeCompensation: 'Y',
      userComments: 'Z',
      planningComments: 'AA',
      reference: 'AB'
    }
  },
  habitatCreation: {
    sheet: 'A-2 On-Site Habitat Creation',
    titleCell: 'D3',
    firstRow: 11,
    lastRow: 360,
    fingerprint: {
      D9: 'Broad Habitat',
      G9: 'Area (hectares)',
      P10: 'Habitat created in advance (years)',
      Q10: 'Delay in starting habitat creation (years)'
    },
    columns: {
      broadHabitat: 'D',
      habitatType: 'E',
      size: 'G',
      condition: 'J',
      strategicSignificance: 'L',
      advanceYears: 'P',
      delayYears: 'Q',
      userComments: 'Z',
      planningComments: 'AA',
      reference: 'AB'
    }
  },
  habitatEnhancement: {
    sheet: 'A-3 On-Site Habitat Enhancement',
    titleCell: 'E3',
    firstRow: 12,
    lastRow: 361,
    fingerprint: {
      E11: 'Baseline ref',
      Q11: 'Proposed Broad Habitat',
      R11: 'Proposed habitat'
    },
    // The blank template starts the proposed broad habitat as a formula
    // copying the baseline's, for the user to overwrite from the drop-down.
    overridesFormula: ['broadHabitat'],
    columns: {
      broadHabitat: 'Q',
      habitatType: 'R',
      condition: 'Y',
      strategicSignificance: 'AA',
      advanceYears: 'AE',
      delayYears: 'AF',
      userComments: 'AO',
      planningComments: 'AP',
      reference: 'AQ'
    }
  },
  hedgerowBaseline: {
    sheet: 'B-1 On-Site Hedge Baseline',
    titleCell: 'B3',
    firstRow: 10,
    lastRow: 359,
    fingerprint: {
      D9: 'Habitat type',
      E9: 'Length (km)',
      P9: 'Length retained',
      Q9: 'Length enhanced'
    },
    columns: {
      featureNumber: 'C',
      habitatType: 'D',
      size: 'E',
      condition: 'H',
      strategicSignificance: 'J',
      retained: 'P',
      enhanced: 'Q',
      userComments: 'V',
      planningComments: 'W',
      reference: 'X'
    }
  },
  hedgerowCreation: {
    sheet: 'B-2 On-Site Hedge Creation',
    titleCell: 'B3',
    firstRow: 12,
    lastRow: 361,
    fingerprint: {
      D11: 'Habitat type',
      E11: 'Length (km)',
      N11: 'Habitat created in advance (years)'
    },
    columns: {
      featureNumber: 'C',
      habitatType: 'D',
      size: 'E',
      condition: 'H',
      strategicSignificance: 'J',
      advanceYears: 'N',
      delayYears: 'O',
      userComments: 'X',
      planningComments: 'Y',
      reference: 'Z'
    }
  },
  hedgerowEnhancement: {
    sheet: 'B-3 On-Site Hedge Enhancement',
    titleCell: 'B3',
    firstRow: 12,
    lastRow: 361,
    fingerprint: {
      B11: 'Baseline ref',
      Y11: 'Habitat enhanced in advance (years)'
    },
    columns: {
      habitatType: 'M',
      condition: 'S',
      strategicSignificance: 'U',
      advanceYears: 'Y',
      delayYears: 'Z',
      userComments: 'AI',
      planningComments: 'AJ',
      reference: 'AK'
    }
  },
  watercourseBaseline: {
    sheet: "C-1 On-Site WaterC' Baseline",
    titleCell: 'B3',
    firstRow: 10,
    lastRow: 359,
    fingerprint: {
      D9: 'Watercourse type',
      E9: 'Length (km)',
      M8: 'Watercourse encroachment',
      O8: 'Riparian encroachment',
      U9: 'Length retained',
      V9: 'Length enhanced'
    },
    columns: {
      habitatType: 'D',
      size: 'E',
      condition: 'H',
      strategicSignificance: 'J',
      watercourseEncroachment: 'M',
      riparianEncroachment: 'O',
      retained: 'U',
      enhanced: 'V',
      bespokeCompensation: 'AA',
      userComments: 'AB',
      planningComments: 'AC',
      reference: 'AD'
    }
  },
  watercourseCreation: {
    sheet: "C-2 On-Site WaterC' Creation",
    titleCell: 'B3',
    firstRow: 12,
    lastRow: 361,
    fingerprint: {
      C11: 'Watercourse type',
      D11: 'Length (km)',
      V10: 'Watercourse encroachment',
      X10: 'Riparian encroachment'
    },
    columns: {
      habitatType: 'C',
      size: 'D',
      condition: 'G',
      strategicSignificance: 'I',
      advanceYears: 'M',
      delayYears: 'N',
      watercourseEncroachment: 'V',
      riparianEncroachment: 'X',
      userComments: 'AA',
      planningComments: 'AB',
      reference: 'AC'
    }
  },
  watercourseEnhancement: {
    sheet: "C-3 On-Site WaterC' Enhancement",
    titleCell: 'B3',
    firstRow: 12,
    lastRow: 361,
    fingerprint: {
      B11: 'Baseline ref',
      AI10: 'Watercourse encroachment',
      AK10: 'Riparian encroachment'
    },
    columns: {
      habitatType: 'N',
      condition: 'T',
      strategicSignificance: 'V',
      advanceYears: 'Z',
      delayYears: 'AA',
      watercourseEncroachment: 'AI',
      riparianEncroachment: 'AK',
      userComments: 'AN',
      planningComments: 'AO',
      reference: 'AP'
    }
  }
}

/**
 * The project details on the Start sheet, each a free-text cell beside its
 * label. The labels are its fingerprint, checked before a detail is written.
 * Target % net gain (F22) is not among them: it holds the metric's default,
 * for the user alone to change.
 */
export const PROJECT_DETAILS = Object.freeze({
  sheet: 'Start',
  fingerprint: Object.freeze({
    D11: 'Planning authority:',
    D12: 'Project name:',
    D13: 'Applicant:',
    D14: 'Application type:',
    D15: 'Planning application reference:',
    D16: 'Completed by:',
    D17: 'Date of metric completion:'
  }),
  cells: Object.freeze({
    planningAuthority: 'F11',
    projectName: 'F12',
    applicant: 'F13',
    applicationType: 'F14',
    planningApplicationReference: 'F15',
    completedBy: 'F16',
    completionDate: 'F17'
  })
})

/** Each baseline sheet and the enhancement sheet that follows its rows. */
export const ENHANCEMENT_OF = {
  habitatEnhancement: 'habitatBaseline',
  hedgerowEnhancement: 'hedgerowBaseline',
  watercourseEnhancement: 'watercourseBaseline'
}

/** The last data row of each sheet in the pinned release. */
export const PINNED_LAST_ROWS = Object.freeze(
  Object.fromEntries(
    Object.entries(METRIC_SHEETS).map(([key, { lastRow }]) => [key, lastRow])
  )
)

/**
 * The last data row of each sheet, by release, newest first. Each release
 * lays out a fixed number of rows; 1.1.0 raised every sheet to 350.
 */
export const RELEASE_LAST_ROWS = Object.freeze({
  '1.1.1': PINNED_LAST_ROWS,
  '1.0.4': Object.freeze({
    habitatBaseline: 258,
    habitatCreation: 256,
    habitatEnhancement: 257,
    hedgerowBaseline: 257,
    hedgerowCreation: 259,
    hedgerowEnhancement: 257,
    watercourseBaseline: 257,
    watercourseCreation: 259,
    watercourseEnhancement: 257
  })
})

// The habitat baseline sheet numbers its data rows, 1 upwards, in this
// column, and the totals row follows the last: so the number on a release's
// last row, and none after it, says which release a workbook is.
const ROW_NUMBER_COLUMN = 'D'

function isRelease(cellValue, lastRows) {
  const { sheet, firstRow } = METRIC_SHEETS.habitatBaseline
  const last = lastRows.habitatBaseline
  const numberAt = (row) =>
    Number(cellValue(sheet, `${ROW_NUMBER_COLUMN}${row}`))
  return (
    numberAt(last) === last - firstRow + 1 &&
    numberAt(last + 1) !== last - firstRow + 2
  )
}

/**
 * The last data row of each sheet for the release a workbook is laid out as,
 * or null when it is laid out as none of them.
 *
 * @param {(sheet: string, ref: string) => unknown} cellValue reads one cell
 * @returns {{ release: string, lastRows: Record<string, number> } | null}
 */
export function inputLastRows(cellValue) {
  for (const [release, lastRows] of Object.entries(RELEASE_LAST_ROWS)) {
    if (isRelease(cellValue, lastRows)) {
      return { release, lastRows }
    }
  }
  return null
}

/**
 * The last data row of each sheet in a recalculated workbook's values: its
 * release's, or the pinned release's when its rows carry no numbers to read
 * (a workbook holding only some of its sheets, say).
 *
 * @param {{ Sheets: object }} workbook
 * @returns {Record<string, number>}
 */
export function workbookLastRows(workbook) {
  const found = inputLastRows((sheet, ref) => workbook.Sheets[sheet]?.[ref]?.v)
  return found?.lastRows ?? PINNED_LAST_ROWS
}

/** How many data rows a sheet holds, in the pinned release by default. */
export function capacity(key, lastRows = PINNED_LAST_ROWS) {
  return lastRows[key] - METRIC_SHEETS[key].firstRow + 1
}
