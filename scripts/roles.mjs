#!/usr/bin/env node
/**
 * Build the role presets from the role manifests.
 *
 * A role is data, not code: `roles/*.role.yml` says which skills it sees and
 * which packs it depends on, and this script turns that into a preset patch
 * against the upstream standard preset. Run it after editing a manifest, after
 * upgrading DSH, or after provisioning a pack.
 *
 *   node scripts/roles.mjs                  # report only
 *   node scripts/roles.mjs --write          # also write presets/roles.patch.yml
 *   node scripts/roles.mjs --out <path>     # write one file elsewhere (implies --write)
 *
 * `--out` exists for the installed form: the package directory is read-only there,
 * so the generated patch has to land somewhere else (a profile-side file). It
 * replaces the default target — `presets/roles.patch.yml` is not touched — and
 * creates a missing parent directory. Relative paths resolve against the cwd.
 *
 * In a source checkout run `pnpm build` first: this script imports
 * `../lib/roles.js`, so the precheck only sees the code that was last built.
 *
 * @module dsh-fullstack-team/scripts/roles
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkRoleIncludes, loadRoles, planRoles, renderRolesPatch, roleMatches, skillNames } from '../lib/roles.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const argv = process.argv.slice(2)

/** Read the value of `--flag value` or `--flag=value`; `undefined` when absent. */
function flagValue(flag) {
  const inline = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (inline !== undefined) return inline.slice(flag.length + 1)
  const index = argv.indexOf(flag)
  if (index === -1) return undefined
  const value = argv[index + 1]
  return value === undefined || value.startsWith('--') ? '' : value
}

const write = argv.includes('--write')
const out = flagValue('--out')
if (out === '') {
  console.error('用法：node scripts/roles.mjs [--write] [--out <path>]')
  process.exit(2)
}

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

// The executable form of role-init's rule: `detect` is a list of groups, each
// group a list of markers (a bare string is a one-marker group). A stack role
// matches when *some* group is fully present at the top of the working
// directory (AND inside a group, OR across groups); a core role always matches.
// `backend-java` relies on that OR: Maven and Gradle checkouts share one role.
const markers = new Set(readdirSync(process.cwd()))
const matched = roles.filter((role) => roleMatches(role, markers)).map((role) => role.id)
const matchCell = (id) => (matched.includes(id) ? '命中    ' : '未命中  ')

// Offline twin of the provider's startup check: every name a role includes must
// have a source. Blocked roles are skipped — a missing pack is reported as a
// role that cannot mount, not as a bad allowlist.
const available = new Set(skillNames(join(root, 'skills')))
for (const { role } of plan.enabled) {
  for (const pack of role.packs ?? []) {
    const dir = expand(pack.dir)
    if (!existsSync(dir)) continue
    const include = (pack.include ?? []).filter((name) => name !== '*')
    for (const name of skillNames(dir)) {
      if (include.length > 0 && !include.includes(name)) continue
      available.add(name)
    }
  }
}
const gaps = checkRoleIncludes(plan, available)

const template = readFileSync(join(root, 'templates', 'preset.template.yml'), 'utf8')
const patch = renderRolesPatch(template, plan)

const name = (id) => roles.find((role) => role.id === id)?.name ?? id
console.log(`roles: ${roles.length} total — ${plan.enabled.length} mountable, ${plan.blocked.length} blocked`)
console.log(`cwd: ${process.cwd()} (${markers.size} top-level entries)`)
console.log(`matched: ${matched.length > 0 ? matched.join(', ') : '(none)'}`)
console.log('')
for (const { role } of plan.enabled) {
  console.log(`  ✓ ${role.kind === 'core' ? 'core ' : 'stack'}  ${role.id.padEnd(16)} ${matchCell(role.id)}${name(role.id)}`)
}
for (const { role, missing } of plan.blocked) {
  console.log(`  ✗ ${role.kind === 'core' ? 'core ' : 'stack'}  ${role.id.padEnd(16)} ${matchCell(role.id)}${name(role.id)}`)
  for (const { pack } of missing) {
    console.log(`         pack "${pack.name}" missing at ${expand(pack.dir)}`)
    if (pack.hint !== undefined) console.log(`         → ${pack.hint}`)
  }
}

if (gaps.length > 0) {
  console.error('\ninclude 校验失败：下列技能名没有任何来源提供')
  for (const gap of gaps) console.error(`  ✗ ${gap.roleId}: ${gap.skills.join(', ')}`)
  console.error(`\n可用技能（${available.size}）：${[...available].sort().join(', ')}`)
  console.error('\n先修 roles/*.role.yml 的 include，或装好缺的 pack，再重跑；本次不生成 presets/roles.patch.yml。')
  process.exitCode = 1
}

// `--out` implies `--write` and *replaces* the default target: the installed
// package directory is read-only, so callers point this at a writable file.
const target = out === undefined ? join(root, 'presets', 'roles.patch.yml') : expand(out)
const shouldWrite = write || out !== undefined

if (shouldWrite && gaps.length === 0) {
  const parent = dirname(target)
  const parentExisted = existsSync(parent)
  mkdirSync(parent, { recursive: true })
  if (!parentExisted) console.log(`created directory ${parent}`)
  writeFileSync(target, patch, 'utf8')
  console.log(`\nwrote ${target} (${patch.split('\n').length} lines)`)
  if (out !== undefined) {
    console.log(`(${join('presets', 'roles.patch.yml')} 未改动；--out 只写指定路径)`)
  }
} else if (gaps.length === 0) {
  console.log('\n(report only; pass --write to emit presets/roles.patch.yml, or --out <path> for a specific file)')
}
