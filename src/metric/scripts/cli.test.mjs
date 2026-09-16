// Smoke tests for the calculator CLIs.
//
// These scripts had no tests when the engine moved into this library, and the
// move broke all nine of them: they import '../<module>.mjs', which was
// '../src/<module>.js' while scripts/ sat beside src/ rather than inside it.
// Nothing caught it, because nothing ran them. Spawning each one the way a
// developer does is what makes that class of breakage visible — a module the
// script cannot resolve fails here even though every unit test still passes.
//
// Deliberately thin on arithmetic: the statutory numbers are asserted by the
// suites next to the calculators. What matters here is that each script loads,
// parses arguments, and prints a result.

import { execFile } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

const SCRIPTS_DIR = import.meta.dirname
const CALCULATORS = readdirSync(SCRIPTS_DIR)
  .filter((f) => f.startsWith('calc-') && f.endsWith('.mjs'))
  .sort()

const EXEC_TIMEOUT_MS = 20_000

/**
 * @param {string} script file name within this directory
 * @param {string[]} argv
 */
function run(script, argv = []) {
  return execFileAsync('node', [path.join(SCRIPTS_DIR, script), ...argv], {
    timeout: EXEC_TIMEOUT_MS
  })
}

describe('post-intervention calculator CLIs', () => {
  it('finds the expected nine scripts', () => {
    expect(CALCULATORS).toHaveLength(9)
  })

  it.each(CALCULATORS)('%s runs its built-in example', async (script) => {
    const { stdout } = await run(script, ['--example'])
    const result = JSON.parse(stdout)

    expect(Number.isFinite(result.units)).toBe(true)
    expect(result.strategicSignificanceScore).toBeTypeOf('number')
    // Retained and created report `distinctiveness`; enhanced reports the
    // post-intervention side under its own key. Either counts as a band.
    const band =
      result.distinctiveness ?? result.postInterventionDistinctiveness
    expect(band).toBeTypeOf('string')
  })

  it.each(CALCULATORS)('%s reports usage on bad input', async (script) => {
    // A single unparseable argument: enough to be rejected by every script's
    // argument parser regardless of its signature.
    await expect(run(script, ['not-a-number'])).rejects.toMatchObject({
      code: expect.any(Number),
      stderr: expect.stringContaining('Usage:')
    })
  })
})
