#!/usr/bin/env node
/**
 * Build `lib/` for installs that do not run `pnpm build` first.
 *
 * `npm install <git-url>` runs `prepare` after installing dependencies, so a
 * clone that has never been built still ends up with a usable `lib/`. The
 * build is deliberately silent: `prepare` also runs during `npm pack`, and any
 * output on stdout corrupts the `--json` report tooling parses.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const tsdown = ['node_modules', 'tsdown', 'dist', 'cli.mjs']
const candidates = [
  ['node_modules', '.bin', 'tsdown'],
  tsdown,
]

function run(command, args) {
  return spawnSync(command, args, { stdio: 'ignore' })
}

const local = candidates.map((parts) => parts.join('/')).find((path) => existsSync(path))
const result =
  local === undefined
    ? run('npx', ['--no-install', 'tsdown'])
    : local.endsWith('.mjs')
      ? run(process.execPath, [local])
      : run(local, [])

if (result.status !== 0) {
  console.error('dsh-fullstack-team: build failed during prepare — run `pnpm build` to see why')
  process.exit(1)
}
