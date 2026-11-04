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

/** Scaffold a new role manifest. */
function scaffold(id, displayName) {
  const path = join(root, 'roles', `${id}.role.yml`)
  if (existsSync(path)) throw new Error(`role "${id}" already exists at ${path}`)
  const manifest = `id: ${id}
name: ${displayName}
description: 一句话说明这个角色做什么、交出什么。
kind: stack
detect:
  - 换成该项目根目录的标记文件
include:
  - dev-orchestrator
  - acceptance-guard
contract:
  input: design.md + api-contract.md + 任务书
  output: 可交付的产物与自测结果
`
  writeFileSync(path, manifest, 'utf8')
  console.log(`created ${path}`)
  console.log('\n下一步：')
  console.log('  1. 填 detect / include / contract')
  console.log('  2. node scripts/roles.mjs --write')
  console.log('  3. 合入 profile 的 cordis.patch.yml 并重启')
}

if (process.argv[2] === 'new') {
  const id = process.argv[3]
  if (id === undefined) {
    console.error('用法：node scripts/roles.mjs new <id> [--name 显示名]')
    process.exit(1)
  }
  const nameIndex = process.argv.indexOf('--name')
  scaffold(id, nameIndex === -1 ? id : (process.argv[nameIndex + 1] ?? id))
  process.exit(0)
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
