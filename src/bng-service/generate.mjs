/**
 * Generate GeoPackages in the BNG Service template format.
 *
 * Every route reuses the legacy generator unchanged, so seeds, row
 * overrides, flaws, scenarios and workbook input all behave as they do for
 * the legacy format. The legacy output is an intermediate step: it is
 * written to a temporary file, read into the two-stage site model, given
 * what only the new template records, and written as one file holding both
 * stages, with the template version record.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { clearFixedTimestamp, setFixedTimestamp } from '../gpkg-io/index.mjs'
import {
  captureMessages,
  color,
  header,
  info,
  warn,
  withMode
} from '../log.mjs'
import {
  CREATED_TREE_INDEX,
  computeLayerCounts,
  generateOne
} from '../synthetic/synthetic.mjs'
import {
  generateFromWorkbook,
  MODE_BASELINE,
  MODE_BOTH
} from '../orchestration.mjs'
import {
  addComments,
  addVerticalHabitats,
  addWorseHabitats,
  applyTemplateOverrides,
  defaultVerticalCount
} from './template-features.mjs'
import { applyLineageFlaws, versionRecordsFor } from './flaws.mjs'
import { siteFromLegacyFile, siteFromLegacyPair } from './from-legacy.mjs'
import { createChooser } from './random.mjs'
import {
  CURRENT_TEMPLATE_VERSION,
  LAYERS,
  STAGE_BASELINE,
  STAGE_POST_INTERVENTION,
  VALID_STAGES
} from './schema.mjs'
import { writeSite } from './site.mjs'
import { checkTemplateValues } from './check-values.mjs'
import { YES, areaLayerOffers } from './vocabulary.mjs'

const TMP_PREFIX = 'bng-service-'
const VERSION_PATTERN = /^\d+\.\d+$/
// Fixed metadata timestamp for seeded generation, as the legacy generator uses.
const DETERMINISTIC_TIMESTAMP = '2020-01-01T00:00:00.000Z'
// A default site's irreplaceable parcel: a woodland the template lets the
// surveyor mark irreplaceable (ancient woodland), of Medium distinctiveness
// so the service accepts it, and Retained, as an irreplaceable habitat is.
export const IRREPLACEABLE_WOODLAND =
  'Woodland and forest - Other woodland; broadleaved'
const MIN_PARCELS_FOR_IRREPLACEABLE = 3
const MIN_TREES_FOR_TEMPLATE_TREES = 3

function assertOptions({ stage, templateVersion }) {
  if (!VALID_STAGES.has(stage)) {
    throw new Error(
      `stage must be one of: ${[...VALID_STAGES].join(', ')} (got: ${stage})`
    )
  }
  if (!VERSION_PATTERN.test(templateVersion)) {
    throw new Error(
      `templateVersion must be "<major>.<minor>", such as "1.0" (got: ${templateVersion})`
    )
  }
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), TMP_PREFIX))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function withSeededClock(seeded, fn) {
  if (seeded) {
    setFixedTimestamp(DETERMINISTIC_TIMESTAMP)
  }
  try {
    return fn()
  } finally {
    if (seeded) {
      clearFixedTimestamp()
    }
  }
}

function reportSite(site, outPath, stage) {
  info('  features (baseline / post-intervention):')
  for (const [key, layer] of Object.entries(site.layers)) {
    const post = stage === STAGE_BASELINE ? 0 : layer.postIntervention.length
    info(`    ${LAYERS[key]}: ${layer.baseline.length} / ${post}`)
  }
  // Every value should be one the template offers. A flaw that writes a
  // value it does not is reported here too, which says the flaw took.
  for (const { table, field, count, examples } of checkTemplateValues(
    outPath
  )) {
    warn(
      `  ${table} / ${field}: ${count} value(s) the template does not offer, e.g. ${examples.map((e) => JSON.stringify(e)).join(', ')}`
    )
  }
  info(color('green', `✔ Done. ${outPath}`))
}

/**
 * Write a site read from legacy output as one BNG Service template file.
 *
 * @param {{ legacyPath: string } | { baselinePath: string, postInterventionPath: string }} input
 * @param {string} outPath
 * @param {object} [options]
 * @param {number} [options.seed]  reproducible choices and timestamps
 * @param {string} [options.stage]  'baseline' leaves the post-intervention
 *   tables empty; 'post-intervention' (the default) writes both stages
 * @param {string} [options.templateVersion]  the version the record names;
 *   the current template version by default
 * @param {object} [options.overrides]  the generator's row overrides, for
 *   their template-only fields (`irreplaceable`, `comment`,
 *   `postInterventionComment`)
 * @param {boolean} [options.comments]  add surveyor comments
 * @param {{ count: number, rows?: object[] }} [options.verticalHabitats]
 * @param {boolean} [options.worseHabitats]  record a habitat that gets worse
 *   on each layer that can: Created in its own type, in a worse condition
 *   (or, for a watercourse, worse encroachment), with years in advance
 * @param {string[]} [options.lineageFlaws]
 * @param {string[]} [options.versionFlaws]
 * @returns {object} the site written
 */
export function writeBngServiceFromLegacy(input, outPath, options = {}) {
  const {
    seed,
    stage = STAGE_POST_INTERVENTION,
    templateVersion = CURRENT_TEMPLATE_VERSION,
    overrides,
    comments = false,
    verticalHabitats,
    worseHabitats = false,
    lineageFlaws = [],
    versionFlaws = []
  } = options
  assertOptions({ stage, templateVersion })
  const chooser = createChooser(seed)
  const readOptions = {
    uuidFor: (layerKey, index) => chooser.uuid(`${layerKey}/${index}`),
    choose: chooser.next
  }
  const site = input.legacyPath
    ? siteFromLegacyFile(input.legacyPath, readOptions)
    : siteFromLegacyPair(
        input.baselinePath,
        input.postInterventionPath,
        readOptions
      )
  applyTemplateOverrides(site, overrides)
  if (verticalHabitats) {
    addVerticalHabitats(site, verticalHabitats, chooser)
  }
  if (worseHabitats) {
    addWorseHabitats(site, chooser)
  }
  if (comments) {
    addComments(site, chooser)
  }
  applyLineageFlaws(site, lineageFlaws)
  withSeededClock(chooser.seeded, () =>
    writeSite(outPath, site, {
      stage,
      versionRecords: versionRecordsFor(versionFlaws, templateVersion)
    })
  )
  return site
}

// ------------------------------------------------------------- synthetic

function unpinned(rows, index) {
  return rows?.[index] === undefined
}

/**
 * Row overrides that make a default site show what only the new template
 * records: an irreplaceable woodland parcel, a veteran (irreplaceable) tree
 * and an Enhanced tree. Each goes on a row nothing else pins, at the end of
 * its layer, clear of the flaw overrides that pin the first rows and of the
 * tree the legacy generator always plants.
 */
function templateFeatureOverrides(counts, attributeOverrides) {
  const overrides = { ...attributeOverrides }
  const habitats = [...(attributeOverrides.habitats ?? [])]
  const lastParcel = counts.numHabitats - 1
  if (
    counts.numHabitats >= MIN_PARCELS_FOR_IRREPLACEABLE &&
    unpinned(habitats, lastParcel)
  ) {
    habitats[lastParcel] = {
      habitatFullName: IRREPLACEABLE_WOODLAND,
      retention: 'Retained',
      irreplaceable: YES
    }
    overrides.habitats = habitats
  }
  const trees = [...(attributeOverrides.trees ?? [])]
  const free = []
  for (let i = counts.numTrees - 1; i >= 0 && free.length < 2; i -= 1) {
    if (i !== CREATED_TREE_INDEX && unpinned(trees, i)) {
      free.push(i)
    }
  }
  if (counts.numTrees >= MIN_TREES_FOR_TEMPLATE_TREES && free.length === 2) {
    trees[free[0]] = { retention: 'Retained', irreplaceable: YES }
    trees[free[1]] = { retention: 'Enhanced' }
    overrides.trees = trees
  }
  return overrides
}

function logSyntheticBanner(outPath, centre, plan, stage, templateVersion) {
  header('Generating BNG Service template GeoPackage', 'cyan')
  info(
    `  ${plan.numParcels} habitat parcels; stage: ${stage}; template version ${templateVersion}`
  )
  if (plan.geometricFlawNames?.length) {
    info(`  geometric flaws: ${plan.geometricFlawNames.join(', ')}`)
  }
  for (const name of [
    ...(plan.lineageFlawNames ?? []),
    ...(plan.versionFlawNames ?? [])
  ]) {
    info(`  flaw: ${name}`)
  }
  info(`  centre: ${centre[0]},${centre[1]} (BNG)`)
  info(`  → ${outPath}`)
}

/**
 * Generate one synthetic site in the BNG Service template format: the same
 * plan `generateOne` takes, plus the new format's flaws and options.
 *
 * @param {string} outPath
 * @param {[number, number]} centre
 * @param {object} plan  as for `generateOne`, plus `lineageFlawNames` and
 *   `versionFlawNames`; `attributeOverrides` may also hold a
 *   `verticalHabitats` layer and the template-only row fields
 * @param {object} [options]
 * @param {string} [options.stage]
 * @param {string} [options.templateVersion]
 * @param {boolean} [options.templateFeatures]  true (the default) adds what
 *   only the new template records: vertical area habitats, comments, an
 *   irreplaceable parcel and tree, an Enhanced tree, and a habitat that gets
 *   worse on each layer that can. The scenario
 *   catalogue turns it off, so each scenario holds exactly what it pins.
 */
export function generateBngServiceSynthetic(
  outPath,
  centre,
  plan,
  options = {}
) {
  const {
    stage = STAGE_POST_INTERVENTION,
    templateVersion = CURRENT_TEMPLATE_VERSION,
    templateFeatures = true
  } = options
  assertOptions({ stage, templateVersion })
  const {
    attributeOverrides = {},
    emptyLayers = new Set(),
    geometricFlawNames = [],
    lineageFlawNames = [],
    versionFlawNames = []
  } = plan
  // A geometric flaw draws the minimal bad fixture, which holds nothing else.
  const enrich = templateFeatures && geometricFlawNames.length === 0
  const counts = computeLayerCounts(plan.numParcels, emptyLayers, plan.numTrees)
  const overrides = enrich
    ? templateFeatureOverrides(counts, attributeOverrides)
    : attributeOverrides
  logSyntheticBanner(outPath, centre, plan, stage, templateVersion)
  return withTempDir((dir) => {
    const legacyPath = path.join(dir, 'legacy.gpkg')
    withMode('silent', () =>
      generateOne(legacyPath, centre, {
        ...plan,
        attributeOverrides: overrides,
        habitatFilter: areaLayerOffers
      })
    )
    const verticalRows = attributeOverrides.verticalHabitats ?? []
    const site = writeBngServiceFromLegacy({ legacyPath }, outPath, {
      seed: plan.seed,
      stage,
      templateVersion,
      overrides,
      comments: enrich,
      worseHabitats: enrich,
      verticalHabitats:
        enrich && !emptyLayers.has('verticalHabitats')
          ? { count: defaultVerticalCount(plan.numParcels), rows: verticalRows }
          : { count: 0, rows: verticalRows },
      lineageFlaws: lineageFlawNames,
      versionFlaws: versionFlawNames
    })
    reportSite(site, outPath, stage)
    return site
  })
}

// --------------------------------------------------------------- workbook

// Re-emit the legacy route's messages, naming the file the caller gets in
// place of the temporary pair.
function reemit(messages, outPaths, outPath) {
  const emit = { header, info, warn }
  const temporary = [
    `${outPaths.baseline} + ${outPaths.postIntervention}`,
    outPaths.baseline,
    outPaths.postIntervention
  ]
  for (const { level, message } of messages) {
    emit[level](
      temporary.reduce((text, from) => text.replaceAll(from, outPath), message)
    )
  }
}

/**
 * Generate the site a metric workbook describes, in the BNG Service template
 * format: the legacy workbook route's baseline and post-intervention pair,
 * joined into one file. `stage: 'baseline'` writes the baseline-stage file.
 * `seed` makes it reproducible: the same workbook and seed give the same file
 * to the byte.
 *
 * @returns {{ success: boolean, plan: object }}
 */
export function generateBngServiceFromWorkbook(
  outPath,
  workbook,
  sourceLabel,
  {
    strict = false,
    centre,
    seed,
    stage = STAGE_POST_INTERVENTION,
    templateVersion = CURRENT_TEMPLATE_VERSION
  } = {}
) {
  assertOptions({ stage, templateVersion })
  return withTempDir((dir) => {
    const outPaths = {
      baseline: path.join(dir, 'baseline.gpkg'),
      postIntervention: path.join(dir, 'post-intervention.gpkg')
    }
    const mode = stage === STAGE_BASELINE ? MODE_BASELINE : MODE_BOTH
    const { result, messages } = captureMessages(() =>
      generateFromWorkbook(outPaths, workbook, sourceLabel, {
        strict,
        centre,
        mode,
        seed
      })
    )
    reemit(
      messages.filter((m) => !m.message.includes('✔ Done')),
      outPaths,
      outPath
    )
    if (!result.success) {
      return result
    }
    const site = writeBngServiceFromLegacy(
      {
        baselinePath: outPaths.baseline,
        postInterventionPath:
          stage === STAGE_BASELINE
            ? outPaths.baseline
            : outPaths.postIntervention
      },
      outPath,
      { seed, stage, templateVersion }
    )
    reportSite(site, outPath, stage)
    return result
  })
}
