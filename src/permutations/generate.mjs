/**
 * Buffer-out permutations generator.
 *
 * Turns the scenario catalogue into an array of in-memory baseline /
 * post-intervention GeoPackage buffers, so a host without disk access (the
 * prototype's web form) can zip and stream them. The path-based harness runner
 * shares the same catalogue and seed derivation, so a given seed yields the
 * same files in either place.
 *
 * better-sqlite3 only writes to a real file descriptor, so each pair is
 * materialised in a temp dir, read back, and the dir removed — the same
 * temp-file dance the rest of the buffer API uses.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { generateOne } from '../synthetic/synthetic.mjs'
import { deriveBaselineFromSynthetic } from '../synthetic/synthetic-baseline.mjs'
import { captureMessages } from '../log.mjs'
import {
  readTemplateVocabulary,
  workbookFromGeoPackage
} from '../workbook-writer/index.mjs'
import { DEFAULT_SIZE, PURPOSES, SCENARIOS } from './catalogue.mjs'
import { derivePermutationSeed } from './seed.mjs'
import {
  generateBngServiceSynthetic,
  writeBngServiceSite
} from '../bng-service/generate.mjs'
import {
  FORMAT_BNG_SERVICE,
  FORMAT_LEGACY,
  STAGE_POST_INTERVENTION,
  VALID_FORMATS
} from '../bng-service/schema.mjs'

const TMP_PREFIX = 'bng-perms-'
// Geometry layout is irrelevant to these attribute-driven scenarios, so every
// fixture shares one centre (Maidenhead, BNG/EPSG:27700).
const DEFAULT_CENTRE = [530000, 180000]

// The files a scenario produces: a baseline / post-intervention pair in the
// legacy format, one GeoPackage holding both stages in the BNG Service format.
function scenarioFiles(scenario, format) {
  if (format === FORMAT_BNG_SERVICE) {
    return { geoPackage: `${scenario.purpose}/${scenario.id}.gpkg` }
  }
  return {
    baseline: `${scenario.purpose}/${scenario.id}-baseline.gpkg`,
    postIntervention: `${scenario.purpose}/${scenario.id}-post-intervention.gpkg`
  }
}

// Metadata carried through to the manifest, without the (large) buffers.
function manifestEntry(
  scenario,
  size,
  withWorkbook = false,
  format = FORMAT_LEGACY
) {
  const files = scenarioFiles(scenario, format)
  if (withWorkbook) {
    files.workbook = `${scenario.purpose}/${scenario.id}.xlsx`
  }
  return {
    id: scenario.id,
    purpose: scenario.purpose,
    title: scenario.title,
    description: scenario.description,
    subject: scenario.subject,
    expectGain: scenario.expectGain ?? null,
    expectMetricWarnings: scenario.expectMetricWarnings ?? [],
    expectTrading: scenario.expectTrading ?? {},
    expectUnitOrder: scenario.expectUnitOrder ?? null,
    expectUnitsEqual: scenario.expectUnitsEqual ?? null,
    expectUnitRatio: scenario.expectUnitRatio ?? [],
    expectTimeToTarget: scenario.expectTimeToTarget ?? [],
    expectRejectedInputs: scenario.expectRejectedInputs ?? [],
    size,
    files
  }
}

/**
 * The matching metric workbook, written from the post-intervention half so
 * the two cannot drift. Its formulas are the template's own and its cached
 * values are stripped: Excel recalculates it on open, and a headless run
 * needs `recalculateWorkbooks`.
 */
function scenarioWorkbook(piPath, entry, workbook) {
  const { buffer, issues, notes } = workbookFromGeoPackage({
    postInterventionPath: piPath,
    templateBuffer: workbook.templateBuffer,
    vocabulary: workbook.vocabulary
  })
  return { path: entry.files.workbook, buffer, issues, notes }
}

/** The generateOne plan a scenario describes, less its seed. */
export function scenarioPlan(scenario, size = scenario.size ?? DEFAULT_SIZE) {
  return {
    numParcels: size,
    numTrees: scenario.treeCount,
    emptyLayers: new Set(scenario.emptyLayers ?? []),
    attributeOverrides: scenario.overrides ?? {}
  }
}

/**
 * A scenario in the BNG Service format, drawn natively: the same plan and
 * seed as its legacy pair, built straight into one file holding both
 * stages, with no legacy file written. Its habitat draws are those the
 * template's Area Habitats layers offer, and it holds exactly what it pins:
 * no vertical habitats, comments or habitats that get worse are added. The
 * workbook is read from the file holding both stages, so it describes the
 * file a user would upload; a baseline-stage file is written from the same
 * site.
 */
function generateBngServiceScenario(
  scenario,
  dir,
  centre,
  seed,
  workbook,
  stage
) {
  const size = scenario.size ?? DEFAULT_SIZE
  const fullPath = path.join(dir, `${scenario.id}-both-stages.gpkg`)
  const outPath =
    stage === STAGE_POST_INTERVENTION
      ? fullPath
      : path.join(dir, `${scenario.id}.gpkg`)
  const plan = scenarioPlan(scenario, size)
  if (Number.isInteger(seed)) {
    plan.seed = derivePermutationSeed(seed, scenario.id)
  }
  captureMessages(() => {
    const site = generateBngServiceSynthetic(fullPath, centre, plan, {
      templateFeatures: false
    })
    if (outPath !== fullPath) {
      writeBngServiceSite(outPath, site, {
        stage,
        seeded: Number.isInteger(plan.seed)
      })
    }
  })
  const entry = manifestEntry(
    scenario,
    size,
    Boolean(workbook),
    FORMAT_BNG_SERVICE
  )
  const result = {
    ...entry,
    geoPackage: { path: entry.files.geoPackage, buffer: readFileSync(outPath) }
  }
  if (workbook) {
    result.workbook = scenarioWorkbook(fullPath, entry, workbook)
  }
  return result
}

function generateScenarioBuffers(scenario, dir, centre, seed, workbook) {
  const size = scenario.size ?? DEFAULT_SIZE
  const piPath = path.join(dir, `${scenario.id}-post-intervention.gpkg`)
  const basePath = path.join(dir, `${scenario.id}-baseline.gpkg`)
  const plan = scenarioPlan(scenario, size)
  if (Number.isInteger(seed)) {
    plan.seed = derivePermutationSeed(seed, scenario.id)
  }
  captureMessages(() => {
    generateOne(piPath, centre, plan)
    deriveBaselineFromSynthetic(piPath, basePath)
  })
  const entry = manifestEntry(scenario, size, Boolean(workbook))
  const result = {
    ...entry,
    baseline: { path: entry.files.baseline, buffer: readFileSync(basePath) },
    postIntervention: {
      path: entry.files.postIntervention,
      buffer: readFileSync(piPath)
    }
  }
  if (workbook) {
    result.workbook = scenarioWorkbook(piPath, entry, workbook)
  }
  return result
}

/**
 * Generate the permutations catalogue as in-memory buffers.
 *
 * @param {object} [options]
 * @param {number} [options.seed]   run seed → byte-reproducible output
 * @param {string} [options.only]   restrict to a single purpose
 * @param {[number, number]} [options.centre]  RLB centre (BNG easting,northing)
 * @param {Buffer} [options.workbookTemplate]  a Statutory Biodiversity Metric
 *   v4 workbook; when given, each scenario also carries the matching metric
 *   workbook as `workbook: { path, buffer, issues, notes }`
 * @param {boolean} [options.manifestOnly]  enumerate the selected catalogue as
 *   metadata only, skipping the (expensive) GeoPackage generation — for callers
 *   that want to preview which scenarios a run would produce.
 * @param {string} [options.format]  'legacy' (the default) or 'bng-service'
 * @param {string} [options.stage]  BNG Service format only: 'baseline' writes
 *   each scenario's baseline-stage file
 * @returns {{ scenarios: object[], manifest: object }}  each scenario carries
 *   `baseline` / `postIntervention` `{ path, buffer }` in the legacy format,
 *   or one `geoPackage: { path, buffer }` in the BNG Service format (metadata
 *   only when `manifestOnly`); `manifest` is the same metadata without
 *   buffers, ready to serialise into the download.
 */
export function generatePermutations({
  seed,
  only,
  centre,
  manifestOnly,
  workbookTemplate,
  format = FORMAT_LEGACY,
  stage = STAGE_POST_INTERVENTION
} = {}) {
  if (!VALID_FORMATS.has(format)) {
    throw new Error(
      `format must be one of: ${[...VALID_FORMATS].join(', ')} (got: ${format})`
    )
  }
  const selected = only
    ? SCENARIOS.filter((s) => s.purpose === only)
    : SCENARIOS
  const withWorkbook = Boolean(workbookTemplate)
  if (manifestOnly) {
    const scenarios = selected.map((s) =>
      manifestEntry(s, s.size ?? DEFAULT_SIZE, withWorkbook, format)
    )
    return { scenarios, manifest: { scenarios } }
  }
  const resolvedCentre = centre ?? DEFAULT_CENTRE
  const workbook = withWorkbook
    ? {
        templateBuffer: workbookTemplate,
        vocabulary: readTemplateVocabulary(workbookTemplate)
      }
    : null
  const dir = mkdtempSync(path.join(tmpdir(), TMP_PREFIX))
  try {
    const scenarios = selected.map((scenario) =>
      format === FORMAT_BNG_SERVICE
        ? generateBngServiceScenario(
            scenario,
            dir,
            resolvedCentre,
            seed,
            workbook,
            stage
          )
        : generateScenarioBuffers(scenario, dir, resolvedCentre, seed, workbook)
    )
    const manifest = {
      scenarios: scenarios.map((s) =>
        manifestEntry(s, s.size, withWorkbook, format)
      )
    }
    return { scenarios, manifest }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export { DEFAULT_SIZE, PURPOSES, SCENARIOS }
