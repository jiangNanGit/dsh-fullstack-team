#!/usr/bin/env node
/**
 * Build the role presets from the role manifests.
 *
 * A role is data, not code: `roles/*.role.yml` says which skills it sees and
 * which packs it depends on, and this script turns that into a preset patch
 * against the upstream standard preset. Run it after editing a manifest, after
 * upgrading DSH, or after provisioning a pack.
 *
 *   node scripts/roles.mjs            # report only
 *   node scripts/roles.mjs --write    # also write presets/roles.patch.yml
 *
 * @module dsh-fullstack-team/scripts/roles
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadRoles, planRoles, renderRolesPatch } from '../lib/roles.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const write = process.argv.includes('--write')

/** Expand a `~` path the same way the plugin does. */
function expand(dir) {
  if (dir === '~') return homedir()
  if (dir.startsWith('~/')) return join(homedir(), dir.slice(2))
  return resolve(dir)
}

const roles = loadRoles(join(root, 'roles'))
const plan = planRoles(roles, (dir) => existsSync(expand(dir)))
const template = readFileSync(join(root, 'templates', 'preset.template.yml'), 'utf8')
const patch = renderRolesPatch(template, plan)

const name = (id) => roles.find((role) => role.id === id)?.name ?? id
console.log(`roles: ${roles.length} total — ${plan.enabled.length} mountable, ${plan.blocked.length} blocked\n`)
for (const { role } of plan.enabled) {
  console.log(`  ✓ ${role.kind === 'core' ? 'core ' : 'stack'}  ${role.id.padEnd(16)} ${name(role.id)}`)
}
for (const { role, missing } of plan.blocked) {
  console.log(`  ✗ ${role.kind === 'core' ? 'core ' : 'stack'}  ${role.id.padEnd(16)} ${name(role.id)}`)
  for (const { pack } of missing) {
    console.log(`         pack "${pack.name}" missing at ${expand(pack.dir)}`)
    if (pack.hint !== undefined) console.log(`         → ${pack.hint}`)
  }
}

if (write) {
  const target = join(root, 'presets', 'roles.patch.yml')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, patch, 'utf8')
  console.log(`\nwrote ${target} (${patch.split('\n').length} lines)`)
} else {
  console.log('\n(report only; pass --write to emit presets/roles.patch.yml)')
}
