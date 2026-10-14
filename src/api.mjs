/**
 * Buffer-in / buffer-out public API. Wraps the path-based generators with a
 * temp-file dance so callers (e.g. the prototype's web form) can pass and
 * receive Buffers without touching the disk themselves.
 *
 * better-sqlite3 only writes to a real file descriptor, so we materialise
 * each gpkg in os.tmpdir(), read it back, and unlink. The path-based
 * pipeline is unchanged.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { generateOne } from './synthetic/synthetic.mjs'
import {
  ALL_FLAW_NAMES,
  CATEGORY_ATTRIBUTE,
  CATEGORY_EMPTY,
  CATEGORY_GEOMETRIC,
  FLAWS,
  resolveFlawSelection
} from './synthetic/flaws.mjs'
import { readMetricWorkbookFromBuffer } from './workbook/metric-workbook.mjs'
import {
  MODE_BASELINE,
  MODE_BOTH,
  MODE_POST_INTERVENTION,
  VALID_MODES,
  generateFromWorkbook
} from './orchestration.mjs'
import { captureMessages, error } from './log.mjs'
import {
  generateBngServiceFromWorkbook,
  generateBngServiceSynthetic
} from './bng-service/generate.mjs'
import {
  LEGACY_ONLY_FLAWS,
  listBngServiceFlaws,
  partitionFlaws
} from './bng-service/flaws.mjs'
import {
  FORMAT_BNG_SERVICE,
  FORMAT_LEGACY,
  STAGE_BASELINE,
  STAGE_POST_INTERVENTION,
  VALID_FORMATS
} from './bng-service/schema.mjs'

const TMP_PREFIX = 'bng-lib-'
const DEFAULT_CENTRE_E = 530000
const DEFAULT_CENTRE_N = 180000
const DEFAULT_SYNTHETIC_PARCELS = 50

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), TMP_PREFIX))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function defaultCentre(centre) {
  if (
    centre &&
    centre.length === 2 &&
    Number.isFinite(centre[0]) &&
    Number.isFinite(centre[1])
  ) {
    return centre
  }
  return [DEFAULT_CENTRE_E, DEFAULT_CENTRE_N]
}

function assertFormat(format) {
  if (!VALID_FORMATS.has(format)) {
    error(
      `format must be one of: ${[...VALID_FORMATS].join(', ')} (got: ${format})`
    )
  }
}

/**
 * Generate one synthetic GeoPackage. Returns the file as a Buffer plus a
 * filenameHint the caller can use as the download filename, and any
 * messages emitted along the way (banner, warnings).
 *
 * options:
 *   numParcels   number of habitat parcels (default 50)
 *   numTrees     explicit urban-tree count (honoured as-is, incl. 0);
 *                omitted → derived from numParcels
 *   centre       [easting, northing] in BNG (default Maidenhead)
 *   bad          shorthand for --bad (apply every composable geometric flaw)
 *   flaws        array of flaw names to apply (geometric | empty | attribute;
 *                and, in the BNG Service format, lineage | template-version)
 *   seed         32-bit integer: the same seed gives the same file
 *   format       'legacy' (the default): the Natural England template, one
 *                file per stage; 'bng-service': the BNG Service template,
 *                one file holding both stages
 *   stage        BNG Service format only. 'post-intervention' (the default)
 *                writes both stages; 'baseline' leaves the post-intervention
 *                tables empty
 *   templateVersion  BNG Service format only: the version the file's
 *                record names (default: the current template version)
 *   templateFeatures BNG Service format only: false leaves out what only the
 *                new template records (vertical area habitats, comments, an
 *                irreplaceable parcel and tree, an Enhanced tree)
 */
export function generateSyntheticGpkg(options = {}) {
  const {
    numParcels = DEFAULT_SYNTHETIC_PARCELS,
    numTrees,
    centre,
    bad = false,
    flaws = [],
    seed,
    format = FORMAT_LEGACY
  } = options

  assertFormat(format)
  const resolvedCentre = defaultCentre(centre)
  if (format === FORMAT_BNG_SERVICE) {
    return generateSyntheticBngServiceGpkg(options, resolvedCentre)
  }
  const selection = resolveFlawSelection({ bad, flaws, numParcels })

  return withTempDir((dir) => {
    const filenameHint = syntheticFilenameHint({ selection, bad })
    const outPath = path.join(dir, filenameHint)
    const { messages } = captureMessages(() => {
      generateOne(outPath, resolvedCentre, {
        numParcels,
        numTrees,
        ...selection,
        seed
      })
    })
    return {
      buffer: readFileSync(outPath),
      filenameHint,
      messages
    }
  })
}

function generateSyntheticBngServiceGpkg(options, centre) {
  const {
    numParcels = DEFAULT_SYNTHETIC_PARCELS,
    numTrees,
    bad = false,
    flaws = [],
    seed,
    stage = STAGE_POST_INTERVENTION,
    templateVersion,
    templateFeatures
  } = options
  const { result, messages } = captureMessages(() => {
    const { legacy, lineage, version } = partitionFlaws(flaws)
    const selection = resolveFlawSelection({ bad, flaws: legacy, numParcels })
    return {
      selection,
      lineage,
      version,
      filenameHint: bngServiceFilenameHint({
        selection,
        bad,
        extra: [...lineage, ...version],
        stage
      })
    }
  })
  return withTempDir((dir) => {
    const outPath = path.join(dir, result.filenameHint)
    const generated = captureMessages(() =>
      generateBngServiceSynthetic(
        outPath,
        centre,
        {
          numParcels,
          numTrees,
          ...result.selection,
          lineageFlawNames: result.lineage,
          versionFlawNames: result.version,
          seed
        },
        { stage, templateVersion, templateFeatures }
      )
    )
    return {
      buffer: readFileSync(outPath),
      filenameHint: result.filenameHint,
      messages: [...messages, ...generated.messages]
    }
  })
}

/**
 * Generate one or both gpkgs from an uploaded workbook buffer.
 *
 * options:
 *   workbookBuffer    Buffer of the uploaded xlsx/xlsm
 *   workbookFilename  used to derive the output filenames
 *   mode              'baseline' | 'post-intervention' | 'both' (default 'both')
 *   strict            propagate to buildBaselineRows / buildPostInterventionRows
 *   centre            [easting, northing] in BNG (default Maidenhead)
 *   format            'legacy' (the default) or 'bng-service'
 *   templateVersion   BNG Service format only: the version its record names
 *
 * Returns, in the legacy format:
 *   baseline           { buffer, filenameHint } | undefined
 *   postIntervention   { buffer, filenameHint } | undefined
 *   messages           captured banner + warnings
 *   success            false if the workbook produced no usable area
 *
 * In the BNG Service format the site is one file, so it returns
 * `{ success, messages, buffer, filenameHint }`. `mode: 'baseline'` writes
 * the baseline-stage file (post-intervention tables empty); 'both' and
 * 'post-intervention' write both stages, since a BNG Service file always
 * holds its baseline.
 */
export function generateFromWorkbookBuffer(options) {
  const {
    workbookBuffer,
    workbookFilename = 'workbook.xlsx',
    mode = MODE_BOTH,
    strict = false,
    centre,
    format = FORMAT_LEGACY,
    templateVersion
  } = options
  assertFormat(format)

  if (!VALID_MODES.has(mode)) {
    throw new Error(
      `mode must be one of: ${[...VALID_MODES].join(', ')} (got: ${mode})`
    )
  }

  const resolvedCentre = defaultCentre(centre)
  const workbook = readMetricWorkbookFromBuffer(
    workbookBuffer,
    workbookFilename
  )
  const names = workbookOutputNames(workbookFilename)

  if (format === FORMAT_BNG_SERVICE) {
    return bngServiceFromWorkbook({
      workbook,
      workbookFilename,
      stage: mode === MODE_BASELINE ? STAGE_BASELINE : STAGE_POST_INTERVENTION,
      strict,
      centre: resolvedCentre,
      templateVersion
    })
  }

  return withTempDir((dir) => {
    const outPaths = {
      baseline: path.join(dir, names.baseline),
      postIntervention: path.join(dir, names.postIntervention)
    }

    const { result, messages } = captureMessages(() =>
      generateFromWorkbook(outPaths, workbook, workbookFilename, {
        strict,
        centre: resolvedCentre,
        mode
      })
    )

    if (!result.success) {
      return { success: false, messages }
    }

    const out = { success: true, messages }
    if (mode !== MODE_POST_INTERVENTION) {
      out.baseline = {
        buffer: readFileSync(outPaths.baseline),
        filenameHint: names.baseline
      }
    }
    if (mode !== MODE_BASELINE) {
      out.postIntervention = {
        buffer: readFileSync(outPaths.postIntervention),
        filenameHint: names.postIntervention
      }
    }
    return out
  })
}

function bngServiceFromWorkbook({
  workbook,
  workbookFilename,
  stage,
  strict,
  centre,
  templateVersion
}) {
  const filenameHint = bngServiceWorkbookName(workbookFilename, stage)
  return withTempDir((dir) => {
    const outPath = path.join(dir, filenameHint)
    const { result, messages } = captureMessages(() =>
      generateBngServiceFromWorkbook(outPath, workbook, workbookFilename, {
        strict,
        centre,
        stage,
        templateVersion
      })
    )
    if (!result.success) {
      return { success: false, messages }
    }
    return {
      success: true,
      messages,
      buffer: readFileSync(outPath),
      filenameHint
    }
  })
}

function timestampSuffix(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}

function workbookOutputNames(source) {
  const base = workbookBaseName(source)
  const ts = timestampSuffix()
  return {
    baseline: `${base}-baseline-${ts}.gpkg`,
    postIntervention: `${base}-post-intervention-${ts}.gpkg`
  }
}

function workbookBaseName(source) {
  const cleaned = source.replace(/[?#].*$/, '')
  return (
    path.basename(cleaned).replace(/\.(xlsx|xlsm|xls)$/i, '') ||
    'bng-from-workbook'
  )
}

function stageSuffix(stage) {
  return stage === STAGE_BASELINE ? '-baseline' : ''
}

function bngServiceWorkbookName(source, stage) {
  return `${workbookBaseName(source)}-bng-service${stageSuffix(stage)}-${timestampSuffix()}.gpkg`
}

function sortFlawNames(names) {
  return [...names].sort((a, b) => a.localeCompare(b))
}

function syntheticFilenameHint({ selection, bad }) {
  const { geometricFlawNames, emptyFlawNames, attributeFlawNames } = selection
  let flawSuffix
  if (attributeFlawNames.length > 0) {
    flawSuffix = `-${sortFlawNames(attributeFlawNames).join('-')}`
  } else if (emptyFlawNames.length > 0) {
    flawSuffix = `-${sortFlawNames(emptyFlawNames).join('-')}`
  } else if (geometricFlawNames.length === 0) {
    flawSuffix = ''
  } else if (bad) {
    flawSuffix = '-bad'
  } else {
    flawSuffix = `-bad-${sortFlawNames(geometricFlawNames).join('-')}`
  }
  return `bng-test-data${flawSuffix}-${timestampSuffix()}.gpkg`
}

// As the legacy hint, with the BNG Service flaws and the stage named too.
function bngServiceFilenameHint({ selection, bad, extra, stage }) {
  const legacy = syntheticFilenameHint({ selection, bad })
  const flawSuffix = legacy
    .replace(/^bng-test-data/, '')
    .replace(/-\d{8}-\d{4}-\d{2}\.gpkg$/, '')
  const extraSuffix = extra.length ? `-${sortFlawNames(extra).join('-')}` : ''
  return `bng-service-test-data${flawSuffix}${extraSuffix}${stageSuffix(stage)}-${timestampSuffix()}.gpkg`
}

const CATEGORY_LABELS = {
  [CATEGORY_GEOMETRIC]: 'geometric',
  [CATEGORY_EMPTY]: 'empty-layer',
  [CATEGORY_ATTRIBUTE]: 'attribute-override'
}

/**
 * Returns the flaw registry in a form suitable for rendering a form:
 *   [{ name, description, errorCode, category, categoryLabel, standalone }]
 * Grouped logically by category but flat so the caller can group however it
 * likes.
 *
 * `{ format: 'bng-service' }` lists the flaws the BNG Service format takes:
 * the legacy flaws it can express, remapped to its tables, and its own
 * lineage and template-version flaws. With no format, the legacy flaws.
 */
export function listFlaws({ format = FORMAT_LEGACY } = {}) {
  assertFormat(format)
  const legacy = listLegacyFlaws()
  if (format !== FORMAT_BNG_SERVICE) {
    return legacy
  }
  return [
    ...legacy.filter((f) => !LEGACY_ONLY_FLAWS.has(f.name)),
    ...listBngServiceFlaws()
  ]
}

function listLegacyFlaws() {
  return ALL_FLAW_NAMES.map((name) => {
    const f = FLAWS[name]
    const category = f.category ?? CATEGORY_GEOMETRIC
    return {
      name,
      description: f.description,
      errorCode: f.errorCode,
      category,
      categoryLabel: CATEGORY_LABELS[category],
      standalone: Boolean(f.standalone)
    }
  })
}
