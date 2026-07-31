import { execSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'

// Wire up local dev tooling (husky hooks + bundled gitleaks) ONLY when a
// contributor runs `npm install` inside a real checkout of THIS repo. When the
// library is pulled in as a dependency npm still runs this postinstall, and its
// git-dependency `prepare` step runs with .git present — so an `existsSync('.git')`
// check alone is not enough to tell the two apart. INIT_CWD is the directory npm
// was originally invoked from: it matches the repo root for a contributor, but
// points at the consumer's project on a dependency install. That difference is
// what stops consumers from downloading gitleaks (or failing) on install.
const REPO_ROOT = path.resolve(import.meta.dirname, '..')

function isOwnDevCheckout() {
  const { CI, INIT_CWD } = process.env
  if (CI || !INIT_CWD || !existsSync(path.join(REPO_ROOT, '.git'))) {
    return false
  }
  try {
    return realpathSync(INIT_CWD) === realpathSync(REPO_ROOT)
  } catch {
    return false
  }
}

if (!isOwnDevCheckout()) {
  process.exit(0)
}

execSync('npm run setup:husky && npm run install:gitleaks', {
  stdio: 'inherit',
  cwd: REPO_ROOT
})
