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
 */

export const METRIC_SHEETS = {
  habitatBaseline: {
    sheet: 'A-1 On-Site Habitat Baseline',
    titleCell: 'D3',
    firstRow: 11,
    lastRow: 258,
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
    lastRow: 256,
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
    lastRow: 257,
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
    lastRow: 257,
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
    lastRow: 259,
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
    lastRow: 257,
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
    lastRow: 257,
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
    lastRow: 259,
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
    lastRow: 257,
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

/** Each baseline sheet and the enhancement sheet that follows its rows. */
export const ENHANCEMENT_OF = {
  habitatEnhancement: 'habitatBaseline',
  hedgerowEnhancement: 'hedgerowBaseline',
  watercourseEnhancement: 'watercourseBaseline'
}

export function capacity(key) {
  const { firstRow, lastRow } = METRIC_SHEETS[key]
  return lastRow - firstRow + 1
}
