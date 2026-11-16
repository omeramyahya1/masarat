/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS script, no type annotations */
// Runs before `npm run release:linux` publishes. It tags the current commit as v<version> and
// pushes the tag, so the GitHub release (and the Windows build in CI) use exactly this commit.
// Without a pushed tag, GitHub would create the tag on the tip of the default branch instead.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

function fail(message) {
  console.error(`\nRelease stopped: ${message}\n`)
  process.exit(1)
}

if (!process.env.GH_TOKEN) {
  fail(
    'GH_TOKEN is not set. Export a GitHub token with "repo" access first:\n  export GH_TOKEN=<token>'
  )
}

if (git('status', '--porcelain')) {
  fail('you have uncommitted changes. Commit them so the release matches what is in git.')
}

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const tag = `v${version}`
const head = git('rev-parse', 'HEAD')

// Lines of "<sha>\t<ref>", empty if the tag doesn't exist. Annotated tags (npm version creates
// them) also list "<ref>^{}" with the commit they point to, so prefer that line.
const remoteRefs = git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`)
  .split('\n')
  .filter(Boolean)
  .map((line) => line.split('\t'))
const remote = (remoteRefs.find(([, ref]) => ref.endsWith('^{}')) ?? remoteRefs[0])?.[0]
if (remote) {
  if (remote !== head) {
    fail(
      `${tag} already exists on GitHub for a different commit. Bump the version (npm version patch).`
    )
  }
  console.log(`${tag} is already on GitHub for this commit.`)
  process.exit(0)
}

let local = ''
try {
  local = git('rev-parse', `refs/tags/${tag}^{commit}`)
} catch {
  // No local tag yet
}
if (local && local !== head) {
  fail(`local tag ${tag} points to a different commit. Bump the version (npm version patch).`)
}
if (!local) git('tag', tag)

console.log(`Pushing ${tag} (${head.slice(0, 7)}) to GitHub...`)
execFileSync('git', ['push', 'origin', `refs/tags/${tag}`], { stdio: 'inherit' })
