#!/usr/bin/env node
/**
 * Commit whatever's currently changed, push it, bump the version, build the
 * Windows installer, and publish it as a new GitHub release - the same
 * sequence used by hand for every release so far in this project.
 *
 * Usage:
 *   node scripts/release.mjs [patch|minor|major] ["commit message"]
 *
 * Defaults: bump type "patch", commit message "Release update".
 *
 * Requires: git remote already set up, `gh` CLI authenticated
 * (`gh auth status`), and to be run from the repo root.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const BUMP_TYPES = ['patch', 'minor', 'major']

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`)
  execSync(cmd, { stdio: 'inherit', ...opts })
}

function capture(cmd) {
  return execSync(cmd, { encoding: 'utf-8' }).trim()
}

function fail(message) {
  console.error(`\nRelease aborted: ${message}`)
  process.exit(1)
}

const bumpType = process.argv[2] ?? 'patch'
const commitMessage = process.argv[3] ?? 'Release update'

if (!BUMP_TYPES.includes(bumpType)) {
  fail(`unknown bump type "${bumpType}" - use one of: ${BUMP_TYPES.join(', ')}`)
}

// --- 0. Sanity checks -------------------------------------------------
try {
  capture('gh auth status')
} catch {
  fail('gh CLI is not authenticated - run `gh auth login` first')
}

const status = capture('git status --porcelain')
if (!status) {
  console.log('Working tree is clean - nothing to commit or release. Exiting.')
  process.exit(0)
}

console.log('Changes to be committed:\n')
console.log(capture('git status --short'))

// --- 1. Commit + push --------------------------------------------------
run('git add -A')
run(`npm version ${bumpType} --no-git-tag-version`)

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
const tag = `v${pkg.version}`

run('git add package.json package-lock.json')
run(`git commit -m ${JSON.stringify(commitMessage)}`)
run('git push')

// --- 2. Clear anything that could lock the build output ----------------
// A leftover test instance of the packaged app (launched by hand, or by a
// previous run of this script's build step) holds files in dist/ open on
// Windows and makes electron-builder fail with "Access is denied" -
// harmless to always attempt this even if nothing is running.
if (process.platform === 'win32') {
  try {
    execSync(
      'powershell -NoProfile -Command "Get-Process -Name electron,\'Secure Electron Monitor\' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"',
      { stdio: 'ignore' }
    )
  } catch {
    // No matching process - fine.
  }
}

// --- 3. Build + publish --------------------------------------------------
let ghToken
try {
  ghToken = capture('gh auth token')
} catch {
  fail('could not read a token from `gh auth token`')
}

try {
  run('npm run release', { env: { ...process.env, GH_TOKEN: ghToken } })
} catch {
  fail(
    `the build failed - check the output above for the real error ` +
      `(common one: a leftover "Secure Electron Monitor.exe" process locking dist/, ` +
      `already handled above, but re-run after closing it manually if this persists)`
  )
}

// --- 4. Publish the draft release ----------------------------------------
try {
  capture(`gh release view ${tag}`)
} catch {
  fail(`electron-builder reported success but no "${tag}" release exists on GitHub - check the build output above`)
}

run(`gh release edit ${tag} --draft=false`)

console.log(`\nReleased ${tag}:`)
run(`gh release view ${tag}`)
