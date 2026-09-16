#!/usr/bin/env node

import { calculateCreatedWatercoursePostIntervention } from '../watercourse-post-intervention.mjs'
import {
  exitWithUsage,
  parseNonNegativeYears,
  parsePositiveNumber,
  resolveArgvMode,
  runCli
} from './post-intervention-cli-shared.mjs'
import { parseWatercourseCreatedPositionalArgs } from './post-intervention-watercourse-cli-shared.mjs'

const SCRIPT =
  'src/metric/scripts/calc-created-watercourse-post-intervention.mjs'
const USAGE = [
  'Usage:',
  `  node ${SCRIPT} <lengthKm> <watercourseType> <condition> <watercourseEncroachment> <riparianEncroachment> [advanceYears] [delayYears]`,
  '',
  'Example:',
  `  node ${SCRIPT} 1 "Priority habitat" Moderate Minor "Minor/No Encroachment" 0 0`,
  '',
  'Watercourse type may be quoted or unquoted (words between length and condition are joined):',
  `  node ${SCRIPT} 1 Priority habitat Moderate Minor "Minor/No Encroachment"`,
  '',
  'advanceYears and delayYears default to 0 when omitted:',
  `  node ${SCRIPT} 1 Priority habitat Moderate "No Encroachment" "No Encroachment/No Encroachment"`,
  '',
  'Run built-in example with no arguments:',
  `  node ${SCRIPT} --example`
]

const mode = resolveArgvMode(SCRIPT, USAGE)

if (mode === 'example') {
  runCli(() =>
    calculateCreatedWatercoursePostIntervention(
      1,
      'Priority habitat',
      'Moderate',
      'Minor',
      'Minor/No Encroachment'
    )
  )
} else {
  const parsed = parseWatercourseCreatedPositionalArgs(process.argv.slice(2))
  if (!parsed) {
    exitWithUsage(SCRIPT, USAGE)
  }
  const lengthKm = parsePositiveNumber('lengthKm', parsed.lengthRaw)
  const advanceYears = parseNonNegativeYears(
    'advanceYears',
    parsed.advanceYears
  )
  const delayYears = parseNonNegativeYears('delayYears', parsed.delayYears)
  runCli(() =>
    calculateCreatedWatercoursePostIntervention(
      lengthKm,
      parsed.watercourseType,
      parsed.condition,
      parsed.watercourseEncroachment,
      parsed.riparianEncroachment,
      advanceYears,
      delayYears
    )
  )
}
