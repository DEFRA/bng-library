/**
 * Generate GeoPackages in the BNG Service template format.
 *
 * A synthetic site is drawn natively (`native/`): the same drawing step as
 * the legacy format, from the same seed, built straight into the two-stage
 * site model, so seeds, row overrides and flaws behave as they do for the
 * legacy format and no legacy file is written. The site is then given what
 * only the new template records and written as one file holding both
 * stages, with the template version record.
 *
 * The scenario catalogue draws its sites the same way, and the workbook
 * route draws the site a workbook describes as the legacy workbook route
 * would, then pairs its stages as the template's tools do.
 * `writeBngServiceFromLegacy` converts legacy files that already exist; no
 * generator uses it.
 */

import { clearFixedTimestamp, setFixedTimestamp } from '../gpkg-io/index.mjs'
import { color, header, info, warn } from '../log.mjs'
import {
  CREATED_TREE_INDEX,
  computeLayerCounts
} from '../synthetic/synthetic.mjs'
import {
  drawWorkbookSite,
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
import {
  applyDegradeFlaws,
  applyLineageFlaws,
  versionRecordsFor
} from './flaws.mjs'
import { siteFromLegacyFile, siteFromLegacyPair } from './from-legacy.mjs'
import { normaliseOverrides } from './native/overrides.mjs'
import { drawSyntheticSite } from './native/synthetic-site.mjs'
import { siteFromWorkbookDraw } from './native/site-from-workbook.mjs'
import { moveVerticalHabitats } from './vertical-from-area.mjs'
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
import { YES } from './vocabulary.mjs'

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
 * Give a site what only the new template records, apply the format's own
 * flaws, and write it as one BNG Service template file. Options as for
 * `writeBngServiceFromLegacy`, all resolved.
 */
function finishSite(site, outPath, chooser, options) {
  const {
    stage,
    templateVersion,
    overrides,
    comments = false,
    verticalHabitats,
    worseHabitats = false,
    emptyLayers = new Set(),
    lineageFlaws = [],
    degradeFlaws = [],
    versionFlaws = []
  } = options
  applyTemplateOverrides(site, overrides)
  if (verticalHabitats) {
    addVerticalHabitats(site, verticalHabitats, chooser)
  }
  if (worseHabitats) {
    addWorseHabitats(site, chooser, emptyLayers)
  }
  applyDegradeFlaws(site, degradeFlaws)
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
}

/**
 * Write a site already built as a BNG Service file at another stage, with
 * the template version record: the baseline-stage file of a site whose full
 * file was written first.
 *
 * @param {string} outPath
 * @param {object} site  as `generateBngServiceSynthetic` returns it
 * @param {object} options
 * @param {string} options.stage
 * @param {boolean} [options.seeded]  fix the metadata timestamps
 * @param {string} [options.templateVersion]
 */
export function writeBngServiceSite(outPath, site, options) {
  const {
    stage,
    seeded = false,
    templateVersion = CURRENT_TEMPLATE_VERSION
  } = options
  assertOptions({ stage, templateVersion })
  withSeededClock(seeded, () =>
    writeSite(outPath, site, {
      stage,
      versionRecords: versionRecordsFor([], templateVersion)
    })
  )
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
 * @param {object} [options.overrides]  the generator's row overrides, checked
 *   as every route checks them (see `native/overrides.mjs`). The file's own
 *   values stand: only the template-only fields (`irreplaceable`, `comment`,
 *   `postInterventionComment`) are applied, so a key that shapes a drawn
 *   site, such as `habitatRef`, has nothing to act on
 * @param {boolean} [options.comments]  add surveyor comments
 * @param {{ count: number, rows?: object[] }} [options.verticalHabitats]
 * @param {boolean} [options.worseHabitats]  record habitats that get worse
 *   (see `addWorseHabitats`)
 * @param {Set<string>} [options.emptyLayers]  layers an empty-layer flaw
 *   leaves with no rows, which gain no habitat that gets worse
 * @param {string[]} [options.lineageFlaws]
 * @param {string[]} [options.degradeFlaws]  each breaks one habitat that
 *   gets worse, so the site needs `worseHabitats`
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
    emptyLayers = new Set(),
    lineageFlaws = [],
    degradeFlaws = [],
    versionFlaws = []
  } = options
  assertOptions({ stage, templateVersion })
  // Checked as every route checks them, so a mistyped key is refused here
  // too, though only the template-only fields act on a file read in.
  const checkedOverrides = overrides && normaliseOverrides(overrides)
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
  finishSite(site, outPath, chooser, {
    stage,
    templateVersion,
    overrides: checkedOverrides,
    comments,
    verticalHabitats,
    worseHabitats,
    emptyLayers,
    lineageFlaws,
    degradeFlaws,
    versionFlaws
  })
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
    ...(plan.degradeFlawNames ?? []),
    ...(plan.versionFlawNames ?? [])
  ]) {
    info(`  flaw: ${name}`)
  }
  info(`  centre: ${centre[0]},${centre[1]} (BNG)`)
  info(`  → ${outPath}`)
}

/**
 * Generate one synthetic site in the BNG Service template format, drawn
 * natively: the same plan `generateOne` takes, plus the new format's flaws
 * and options. No legacy file is written.
 *
 * @param {string} outPath
 * @param {[number, number]} centre
 * @param {object} plan  as for `generateOne`, plus `lineageFlawNames`,
 *   `degradeFlawNames` and `versionFlawNames`; `attributeOverrides` may also hold a
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
    degradeFlawNames = [],
    versionFlawNames = []
  } = plan
  // A geometric flaw draws the minimal bad fixture, which holds nothing else.
  const enrich = templateFeatures && geometricFlawNames.length === 0
  const counts = computeLayerCounts(plan.numParcels, emptyLayers, plan.numTrees)
  const overrides = normaliseOverrides(
    enrich
      ? templateFeatureOverrides(counts, attributeOverrides)
      : attributeOverrides
  )
  logSyntheticBanner(outPath, centre, plan, stage, templateVersion)
  const chooser = createChooser(plan.seed)
  const site = drawSyntheticSite(
    centre,
    { ...plan, attributeOverrides: overrides },
    chooser
  )
  const verticalRows = overrides.verticalHabitats ?? []
  finishSite(site, outPath, chooser, {
    stage,
    templateVersion,
    overrides,
    comments: enrich,
    // A degrade flaw breaks a habitat that gets worse, so it adds them.
    worseHabitats: enrich || degradeFlawNames.length > 0,
    emptyLayers,
    verticalHabitats:
      enrich && !emptyLayers.has('verticalHabitats')
        ? { count: defaultVerticalCount(plan.numParcels), rows: verticalRows }
        : { count: 0, rows: verticalRows },
    lineageFlaws: lineageFlawNames,
    degradeFlaws: degradeFlawNames,
    versionFlaws: versionFlawNames
  })
  reportSite(site, outPath, stage)
  return site
}

// --------------------------------------------------------------- workbook

/**
 * Generate the site a metric workbook describes, in the BNG Service template
 * format, drawn natively: the geometry the legacy workbook route draws, from
 * the same seed, with its two stages paired into one file and no legacy file
 * written. `stage: 'baseline'` writes the baseline-stage file.
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
  const drawn = drawWorkbookSite(workbook, sourceLabel, {
    strict,
    centre,
    mode: stage === STAGE_BASELINE ? MODE_BASELINE : MODE_BOTH,
    seed,
    outPath
  })
  if (!drawn.success) {
    return { success: false, plan: drawn.plan }
  }
  const chooser = createChooser(seed)
  const site = siteFromWorkbookDraw(drawn, {
    uuidFor: (layerKey, index) => chooser.uuid(`${layerKey}/${index}`),
    choose: chooser.next
  })
  moveVerticalHabitats(site, (i) => chooser.uuid(`verticalHabitats/moved/${i}`))
  finishSite(site, outPath, chooser, { stage, templateVersion })
  reportSite(site, outPath, stage)
  return { success: true, plan: drawn.plan }
}
