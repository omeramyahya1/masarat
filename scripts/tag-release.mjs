/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS script, no type annotations */
// `npm run release`: tags the current commit as v<version> and pushes the tag. The push starts
// .github/workflows/release.yml, which builds the Linux and Windows files from exactly this commit
// into a draft release and publishes it once every file is attached.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

function fail(message) {
  console.error(`\nRelease stopped: ${message}\n`)
  process.exit(1)
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
  console.log(
    'To build it again, run the Release workflow by hand (Actions tab > Release > Run workflow).'
  )
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

// e.g. git@github.com:owner/repo.git or https://github.com/owner/repo.git
const repo = git('remote', 'get-url', 'origin').match(/github\.com[:/](.+?)(\.git)?$/)?.[1]
console.log(
  `\n${tag} pushed. The release is built and published by GitHub Actions:` +
    (repo ? `\n  https://github.com/${repo}/actions/workflows/release.yml` : '')
)
