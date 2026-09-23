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

const TMP_PREFIX = 'bng-perms-'
// Geometry layout is irrelevant to these attribute-driven scenarios, so every
// fixture shares one centre (Maidenhead, BNG/EPSG:27700).
const DEFAULT_CENTRE = [530000, 180000]

// Metadata carried through to the manifest, without the (large) buffers.
function manifestEntry(scenario, size, withWorkbook = false) {
  const files = {
    baseline: `${scenario.purpose}/${scenario.id}-baseline.gpkg`,
    postIntervention: `${scenario.purpose}/${scenario.id}-post-intervention.gpkg`
  }
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
    expectTradingBreaches: scenario.expectTradingBreaches ?? {},
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
    emptyLayers: new Set(scenario.emptyLayers ?? []),
    attributeOverrides: scenario.overrides ?? {}
  }
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
 * @returns {{ scenarios: object[], manifest: object }}  each scenario carries
 *   `baseline` / `postIntervention` `{ path, buffer }` (metadata only when
 *   `manifestOnly`); `manifest` is the same metadata without buffers, ready to
 *   serialise into the download.
 */
export function generatePermutations({
  seed,
  only,
  centre,
  manifestOnly,
  workbookTemplate
} = {}) {
  const selected = only
    ? SCENARIOS.filter((s) => s.purpose === only)
    : SCENARIOS
  const withWorkbook = Boolean(workbookTemplate)
  if (manifestOnly) {
    const scenarios = selected.map((s) =>
      manifestEntry(s, s.size ?? DEFAULT_SIZE, withWorkbook)
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
      generateScenarioBuffers(scenario, dir, resolvedCentre, seed, workbook)
    )
    const manifest = {
      scenarios: scenarios.map((s) => manifestEntry(s, s.size, withWorkbook))
    }
    return { scenarios, manifest }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export { DEFAULT_SIZE, PURPOSES, SCENARIOS }
