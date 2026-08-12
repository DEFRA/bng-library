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
import { DEFAULT_SIZE, PURPOSES, SCENARIOS } from './catalogue.mjs'
import { derivePermutationSeed } from './seed.mjs'

const TMP_PREFIX = 'bng-perms-'
// Geometry layout is irrelevant to these attribute-driven scenarios, so every
// fixture shares one centre (Maidenhead, BNG/EPSG:27700).
const DEFAULT_CENTRE = [530000, 180000]

// Metadata carried through to the manifest, without the (large) buffers.
function manifestEntry(scenario, size) {
  return {
    id: scenario.id,
    purpose: scenario.purpose,
    title: scenario.title,
    description: scenario.description,
    subject: scenario.subject,
    expectGain: scenario.expectGain ?? null,
    size,
    files: {
      baseline: `${scenario.purpose}/${scenario.id}-baseline.gpkg`,
      postIntervention: `${scenario.purpose}/${scenario.id}-post-intervention.gpkg`
    }
  }
}

function generateScenarioBuffers(scenario, dir, centre, seed) {
  const size = scenario.size ?? DEFAULT_SIZE
  const piPath = path.join(dir, `${scenario.id}-post-intervention.gpkg`)
  const basePath = path.join(dir, `${scenario.id}-baseline.gpkg`)
  const plan = {
    numParcels: size,
    attributeOverrides: scenario.overrides ?? {}
  }
  if (Number.isInteger(seed)) {
    plan.seed = derivePermutationSeed(seed, scenario.id)
  }
  captureMessages(() => {
    generateOne(piPath, centre, plan)
    deriveBaselineFromSynthetic(piPath, basePath)
  })
  const entry = manifestEntry(scenario, size)
  return {
    ...entry,
    baseline: { path: entry.files.baseline, buffer: readFileSync(basePath) },
    postIntervention: {
      path: entry.files.postIntervention,
      buffer: readFileSync(piPath)
    }
  }
}

/**
 * Generate the permutations catalogue as in-memory buffers.
 *
 * @param {object} [options]
 * @param {number} [options.seed]   run seed → byte-reproducible output
 * @param {string} [options.only]   restrict to a single purpose
 * @param {[number, number]} [options.centre]  RLB centre (BNG easting,northing)
 * @returns {{ scenarios: object[], manifest: object }}  each scenario carries
 *   `baseline` / `postIntervention` `{ path, buffer }`; `manifest` is the same
 *   metadata without buffers, ready to serialise into the download.
 */
export function generatePermutations({ seed, only, centre } = {}) {
  const selected = only
    ? SCENARIOS.filter((s) => s.purpose === only)
    : SCENARIOS
  const resolvedCentre = centre ?? DEFAULT_CENTRE
  const dir = mkdtempSync(path.join(tmpdir(), TMP_PREFIX))
  try {
    const scenarios = selected.map((scenario) =>
      generateScenarioBuffers(scenario, dir, resolvedCentre, seed)
    )
    const manifest = {
      scenarios: scenarios.map((s) => manifestEntry(s, s.size))
    }
    return { scenarios, manifest }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export { DEFAULT_SIZE, PURPOSES, SCENARIOS }
