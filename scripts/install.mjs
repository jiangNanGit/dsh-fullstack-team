#!/usr/bin/env node
/**
 * Install or upgrade the full-stack team presets with one command.
 *
 * This is the user entry point. It owns the whole journey so a user never has to
 * know which script to run, when to restart, or how to read a drift report:
 *
 *   1. probe      — where the host app is, which host version it is, which
 *                   profile is the target, which plugin version is installed;
 *   2. align      — compare `templates/preset.template.yml` with the standard
 *                   preset the host ships (`checkPresetCompat`). Drift is *not*
 *                   an immediate failure: the template is re-derived from the
 *                   shipped standard (`deriveTemplate`), re-verified, and only
 *                   written when the second check passes;
 *   3. generate   — `roles/*.role.yml` → preset patch, in process, with exactly
 *                   the rules `scripts/roles.mjs` uses (`lib/roles.js`);
 *   4. merge      — the same splice/backup/verify/rollback logic as
 *                   `scripts/install-presets.mjs`, called as a function;
 *   5. restart    — quit and relaunch the macOS app, because a profile patch is
 *                   only read at boot and "restart the host yourself" is exactly
 *                   the kind of step a user should not have to know about.
 *
 *   npx dsh-fullstack-team install        # or: node scripts/install.mjs
 *   node scripts/install.mjs --dry-run    # plan only, writes nothing
 *   node scripts/install.mjs --no-restart # install but leave the app alone
 *
 * Idempotence: when the template matches the host, the generated patch equals
 * what the profile already holds, and nothing is written, backed up or
 * restarted — the command prints `已是最新，无需操作`.
 *
 * A missing host is normal in CI and on non-macOS machines. It is tolerated (the
 * alignment step reports `[SKIP]`) only under `--dry-run`, `CI`, or
 * `DSH_ALLOW_MISSING_HOST=1`; without one of those it is a failure with the two
 * ways out named. That keeps a real macOS user's broken install from passing as
 * a success while keeping the test suite runnable anywhere.
 *
 * Exit codes: 0 success or already up to date; 1 failure (rolled back); 2 usage.
 *
 * @module dsh-fullstack-team/scripts/install
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  DEFAULT_ASAR,
  STANDARD_ENTRY,
  checkPresetCompat,
  formatDrifts,
  parseRows,
  readAsarEntry,
} from './check-preset-compat.mjs'
import { DEFAULT_PROFILE, ROOT, expandPath, installPresets, resolveProfile } from './install-presets.mjs'

/** Name and default location of the macOS app the host ships as. */
export const HOST_APP_NAME = 'DeepSeek Harness'
export const DEFAULT_APP_PATH = '/Applications/DeepSeek Harness.app'

/** Entry inside the host archive that carries the host version. */
export const HOST_VERSION_ENTRY = 'dsh/node_modules/@deepseek-ai/dsh-web-app/package.json'

/** The template this tool aligns with the host and writes back when it heals it. */
export const DEFAULT_TEMPLATE = join(ROOT, 'templates', 'preset.template.yml')

/** Tokens the generated presets depend on; a derived template must carry all of them. */
export const TOKENS = [
  '{{PRESET_ID}}',
  '{{ROLE_ID}}',
  '{{ROLE_NAME}}',
  '{{ROLE_DESCRIPTION}}',
  '{{ROLE_PREFIX}}',
  '{{ROLE_ENTRY}}',
]

const USAGE = `用法：
  npx dsh-fullstack-team install [选项]
  node scripts/install.mjs [选项]

  一条命令做完：对齐宿主版本 → 生成预设 → 校验 → 备份 → 合并 → 校验 → 重启宿主。

  --profile <名字|路径>  装进哪个 profile（默认 desktop：~/.dsh/profiles/desktop/cordis.patch.yml）
  --dry-run             只打印计划：不写盘、不备份、不重启（没有宿主的机器也能跑）
  --no-restart          装完不自动重启宿主（CI / 调试用）
  --source <文件>       跳过生成，直接合并已有生成物（排障用）
  --force               跳过模板与宿主 standard 的兼容检查（确认无风险才用）

  环境变量：DSH_APP_ASAR（宿主 app.asar）、DSH_APP_PATH（.app 目录）、
            DSH_PRESET_TEMPLATE（模板路径）、CI（允许无宿主）

退出码：0 成功或已是最新；1 失败（已回滚到备份）；2 用法错误`

/** Print `~` instead of the home directory, purely for readability. */
function tilde(path) {
  const home = homedir()
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

/**
 * Read the host version out of the asar's own package.json.
 *
 * @param asarPath - Path to the host archive.
 * @returns The version, or `undefined` when the entry or the field is missing.
 */
function readHostVersion(asarPath) {
  try {
    const parsed = JSON.parse(readAsarEntry(asarPath, HOST_VERSION_ENTRY))
    return typeof parsed.version === 'string' ? parsed.version : undefined
  } catch {
    return undefined
  }
}

/**
 * Describe the machine the command is running on — before changing anything.
 *
 * @param options - Path overrides (tests, env vars).
 * @returns Host app, host version, profile, and plugin version.
 */
export function probe(options = {}) {
  const env = options.env ?? process.env
  const asarPath = options.asarPath ?? env.DSH_APP_ASAR ?? DEFAULT_ASAR
  const appPath = options.appPath ?? env.DSH_APP_PATH ?? DEFAULT_APP_PATH
  const profilePath = options.profilePath ?? DEFAULT_PROFILE
  const repoRoot = options.repoRoot ?? ROOT
  const asarExists = existsSync(asarPath)
  let repoVersion
  try {
    repoVersion = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version
  } catch {
    repoVersion = undefined
  }
  return {
    asarPath,
    asarExists,
    appPath,
    appExists: existsSync(appPath),
    hostVersion: asarExists ? readHostVersion(asarPath) : undefined,
    profilePath,
    repoVersion,
  }
}

/** Index of the first line that is neither blank nor a comment. */
function firstContentLine(lines) {
  let index = 0
  while (index < lines.length && (lines[index].trim() === '' || lines[index].trimStart().startsWith('#'))) index += 1
  return index
}

/**
 * The leading comment block of a template, without trailing blank lines.
 *
 * The comments are the only part of a template that is this project's own words
 * rather than upstream's structure, so a derived template keeps them.
 *
 * @param text - Current template text.
 * @returns The comment lines (possibly empty).
 */
function leadingComments(text) {
  const lines = String(text).split(/\r?\n/u)
  const header = []
  for (const line of lines) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) header.push(line)
    else break
  }
  while (header.length > 0 && header[header.length - 1].trim() === '') header.pop()
  return header
}

/** Default header, used when the current template has no comment block to keep. */
const DEFAULT_HEADER = [
  '# Role preset example for dsh-fullstack-team: the standard preset with the flow plugin',
  '# hard-bound to one role. Copy this file, change `id`, `name`, and `include`.',
  '#',
]

/**
 * Exclusive end (0-based full-line index) of one row.
 *
 * `parseRows` exposes a row's start line but not its span, so the span is
 * recovered from the next row at the same or a shallower indentation — the same
 * rule `parseRows` itself uses. This keeps the derivation anchored on structure
 * instead of on a guess about line counts.
 *
 * @param rows - Rows in document order.
 * @param at - Index of the row in `rows`.
 * @param total - Number of lines in the document.
 * @returns Exclusive end line index.
 */
function rowEnd(rows, at, total) {
  for (let next = at + 1; next < rows.length; next += 1) {
    if (rows[next].indent <= rows[at].indent) return rows[next].line - 1
  }
  return total
}

/**
 * Re-derive `templates/preset.template.yml` from the standard preset the host
 * ships.
 *
 * A host upgrade can rename a module, drop a row, or change a config line; the
 * frozen template then points at something that no longer exists and every
 * generated preset fails to load. The template is mechanically the shipped
 * standard plus six injection points, so it can be rebuilt instead of being
 * hand-patched — provided the rebuild is anchored on parsed rows, never on
 * textual search-and-replace:
 *
 *   - the preset declaration (the `preset-*` row at depth 0) loses its concrete
 *     id (`{{PRESET_ID}}`) and gets `{{ROLE_ID}}`, `{{ROLE_NAME}}` and
 *     `{{ROLE_DESCRIPTION}}` in its config;
 *   - the `persona` row's single-line `prefix` becomes `{{ROLE_PREFIX}}`;
 *   - `{{ROLE_ENTRY}}` is appended after the last plugin row;
 *   - the leading comment block of the current template is kept.
 *
 * @param standardText - The host's `standard.patch.yml`, verbatim.
 * @param currentTemplateText - The template being replaced (its comments are kept).
 * @returns The derived template text.
 * @throws When the standard cannot be anchored safely (no declaration, no
 *   persona row, a multi-line prefix, a shape the derivation does not understand).
 */
export function deriveTemplate(standardText, currentTemplateText = '') {
  const standard = String(standardText)
  const standardLines = standard.split(/\r?\n/u)
  const rows = parseRows(standard)
  const declarationAt = rows.findIndex((row) => row.depth === 0 && /^preset-[\w.-]+$/u.test(row.id))
  if (declarationAt === -1) {
    throw new Error('宿主的 standard 里没有 preset-* 预置声明，无从派生')
  }
  const declaration = rows[declarationAt]

  // Work on the body only: upstream's own comments describe upstream, and this
  // project's header replaces them.
  const bodyStart = firstContentLine(standardLines)
  const body = standardLines.slice(bodyStart)
  const at = (oneBasedLine) => oneBasedLine - 1 - bodyStart
  const declarationIndex = at(declaration.line)
  const declarationEnd = rowEnd(rows, declarationAt, standardLines.length) - bodyStart

  const declarationMatch = /^(\s*)-\s+id:\s*(\S+)\s*$/u.exec(body[declarationIndex] ?? '')
  if (declarationMatch === null) {
    throw new Error('宿主 standard 的预置声明缩进无法识别，无从派生')
  }
  const declarationIndent = declarationMatch[1].length

  const replacements = new Map()
  const insertions = new Map()

  replacements.set(declarationIndex, `${' '.repeat(declarationIndent)}- id: {{PRESET_ID}}`)

  // The declaration's own config block: the first `config:` deeper than the row.
  let configIndex = -1
  let configIndent = 0
  for (let index = declarationIndex + 1; index < declarationEnd; index += 1) {
    const match = /^(\s*)config:\s*$/u.exec(body[index] ?? '')
    if (match !== null && match[1].length > declarationIndent) {
      configIndex = index
      configIndent = match[1].length
      break
    }
  }
  if (configIndex === -1) throw new Error('宿主 standard 的预置声明里没有 config 块，无从派生')

  const childIndent = ' '.repeat(configIndent + 2)
  let roleIdIndex = -1
  let hasName = false
  let hasDescription = false
  for (let index = configIndex + 1; index < declarationEnd; index += 1) {
    const line = body[index] ?? ''
    const indent = /^(\s*)/u.exec(line)?.[1].length ?? 0
    if (indent !== configIndent + 2) continue
    if (roleIdIndex === -1 && /^id:\s*\S+\s*$/u.test(line.trim())) roleIdIndex = index
    if (/^name:\s*/u.test(line.trim())) {
      replacements.set(index, `${childIndent}name: {{ROLE_NAME}}`)
      hasName = true
    }
    if (/^description:\s*/u.test(line.trim())) {
      replacements.set(index, `${childIndent}description: {{ROLE_DESCRIPTION}}`)
      hasDescription = true
    }
  }
  if (roleIdIndex === -1) throw new Error('宿主 standard 的预置 config 里没有 id 行，无从派生')
  replacements.set(roleIdIndex, `${childIndent}id: {{ROLE_ID}}`)
  const missing = []
  if (!hasName) missing.push(`${childIndent}name: {{ROLE_NAME}}`)
  if (!hasDescription) missing.push(`${childIndent}description: {{ROLE_DESCRIPTION}}`)
  if (missing.length > 0) insertions.set(roleIdIndex, missing)

  const personaAt = rows.findIndex((row) => row.id === 'persona' && row.depth > 0)
  if (personaAt === -1) {
    throw new Error('宿主 standard 里没有 persona row，无法注入 {{ROLE_PREFIX}}')
  }
  const persona = rows[personaAt]
  let prefixIndex = -1
  const personaStart = at(persona.line)
  const personaEnd = rowEnd(rows, personaAt, standardLines.length) - bodyStart
  for (let index = personaStart; index < personaEnd; index += 1) {
    const match = /^(\s*)prefix:(\s*)(.*)$/u.exec(body[index] ?? '')
    if (match === null) continue
    const value = match[3].trim()
    if (value === '' || value === '|' || value === '>' || value === '|-' || value === '>-') {
      throw new Error('persona.prefix 不是单行标量，无法安全注入 {{ROLE_PREFIX}}')
    }
    prefixIndex = index
    replacements.set(index, `${match[1]}prefix: {{ROLE_PREFIX}}`)
    break
  }
  if (prefixIndex === -1) throw new Error('persona row 里没有 prefix 行，无法注入 {{ROLE_PREFIX}}')

  const out = []
  for (let index = 0; index < body.length; index += 1) {
    out.push(replacements.get(index) ?? body[index])
    const extra = insertions.get(index)
    if (extra !== undefined) out.push(...extra)
  }
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
  out.push('{{ROLE_ENTRY}}')

  const header = leadingComments(currentTemplateText)
  const text = `${[...(header.length > 0 ? header : DEFAULT_HEADER), ...out].join('\n')}\n`

  for (const token of TOKENS) {
    if (!text.includes(token)) throw new Error(`派生结果缺少 ${token}，拒绝写回`)
  }
  const derivedRows = parseRows(text)
  if (!derivedRows.some((row) => row.depth === 0 && row.id === '{{PRESET_ID}}')) {
    throw new Error('派生结果里没有 {{PRESET_ID}} 预置声明，拒绝写回')
  }
  const ids = (list) => list.filter((row) => row.depth > 0).map((row) => row.id)
  const standardIds = ids(rows).join('\u0000')
  const derivedIds = ids(derivedRows).join('\u0000')
  if (standardIds !== derivedIds) throw new Error('派生结果的插件 row 与宿主 standard 不一致，拒绝写回')

  return { text, tokens: [...TOKENS] }
}

/** Block the process for `ms` without spinning (used between quit and relaunch). */
function defaultSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Quit and relaunch the host app so a freshly merged profile is read again.
 *
 * A profile patch is only read at boot, so an install that did not restart is an
 * install the user has to finish by hand. Every "cannot" is a skip with a reason,
 * never an error: the presets are installed either way.
 *
 * @param options - Platform, app path, and injectable process primitives.
 * @returns `{ restarted, reason }`; `reason` is `skipped-flag`, `not-macos`,
 *   `app-missing` or `failed` when `restarted` is false.
 */
export function restartHost(options = {}) {
  const platform = options.platform ?? process.platform
  const appPath = options.appPath ?? DEFAULT_APP_PATH
  const appName = options.appName ?? HOST_APP_NAME
  const exec = options.exec ?? spawnSync
  const sleep = options.sleep ?? defaultSleep

  if (options.skip === true) return { restarted: false, reason: 'skipped-flag' }
  if (platform !== 'darwin') return { restarted: false, reason: 'not-macos' }
  if (!existsSync(appPath)) return { restarted: false, reason: 'app-missing' }

  try {
    const quit = exec('osascript', ['-e', `quit app "${appName}"`], { stdio: 'ignore' })
    if (quit?.error !== undefined && quit?.error !== null) throw quit.error
    sleep(2000)
    const open = exec('open', ['-a', appName], { stdio: 'ignore' })
    if (open?.error !== undefined && open?.error !== null) throw open.error
  } catch (error) {
    return { restarted: false, reason: 'failed', error }
  }
  return { restarted: true }
}

/**
 * Generate the preset patch in process, with exactly `scripts/roles.mjs`'s rules.
 *
 * `lib/roles.js` is a build artifact, so it is imported lazily: this module must
 * stay importable in a checkout that has not been built yet (tests, `pnpm check`).
 *
 * @param options - Template path.
 * @returns The patch text plus notes about roles that could not mount.
 * @throws When the build artifact is missing, an include has no provider, or the
 *   template lacks a token.
 */
export async function generatePatch(options = {}) {
  const templatePath = options.templatePath ?? DEFAULT_TEMPLATE
  const libPath = join(ROOT, 'lib', 'roles.js')
  if (!existsSync(libPath)) {
    throw new Error(`缺少构建产物 ${libPath}；先在包目录运行 pnpm build，或用 --source 直接合并生成物`)
  }
  const lib = await import(pathToFileURL(libPath).href)
  const roles = lib.loadRoles(join(ROOT, 'roles'))
  const plan = lib.planRoles(roles, (dir) => existsSync(expandPath(dir)))

  // Same offline precheck as roles.mjs: every included name must have a source.
  const available = new Set(lib.skillNames(join(ROOT, 'skills')))
  for (const { role } of plan.enabled) {
    for (const pack of role.packs ?? []) {
      const dir = expandPath(pack.dir)
      if (!existsSync(dir)) continue
      const include = (pack.include ?? []).filter((name) => name !== '*')
      for (const name of lib.skillNames(dir)) {
        if (include.length > 0 && !include.includes(name)) continue
        available.add(name)
      }
    }
  }
  const gaps = lib.checkRoleIncludes(plan, available)
  if (gaps.length > 0) {
    throw new Error(`include 校验失败：${gaps.map((gap) => `${gap.roleId}: ${gap.skills.join(', ')}`).join('；')}`)
  }

  const template = readFileSync(templatePath, 'utf8')
  const patch = lib.renderRolesPatch(template, plan)

  const notes = []
  if (plan.blocked.length > 0) {
    notes.push(
      `提示：${plan.blocked.length} 个角色缺技能包，本次未安装（${plan.blocked
        .map((entry) => entry.role.id)
        .join(', ')}）`,
    )
    for (const { role, missing } of plan.blocked) {
      for (const { pack } of missing) notes.push(`  ${role.id} 需要 ${pack.name}：${expandPath(pack.dir)}`)
    }
  }
  return { patch, notes }
}

/** Whether the host is allowed to be absent for this run. */
function missingHostAllowed({ dryRun, env }) {
  if (dryRun) return true
  if (env.DSH_ALLOW_MISSING_HOST === '1' || env.DSH_ALLOW_MISSING_HOST === 'true') return true
  if (env.CI === undefined) return false
  return !['', '0', 'false'].includes(env.CI)
}

/** Read `--flag value` / `--flag=value`; `''` when the flag is present without a value. */
function flagValue(argv, flag) {
  const inline = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (inline !== undefined) return inline.slice(flag.length + 1)
  const index = argv.indexOf(flag)
  if (index === -1) return undefined
  const value = argv[index + 1]
  return value === undefined || value.startsWith('--') ? '' : value
}

/** Parse the command line into flags, or a usage error. */
function parseArguments(argv) {
  const flags = { dryRun: false, noRestart: false, force: false, help: false }
  let profile
  let source
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      flags.help = true
      continue
    }
    if (arg === '--dry-run') {
      flags.dryRun = true
      continue
    }
    if (arg === '--no-restart') {
      flags.noRestart = true
      continue
    }
    if (arg === '--force') {
      flags.force = true
      continue
    }
    if (arg === '--profile' || arg === '--source') {
      const value = flagValue(argv, arg)
      if (value === undefined || value === '') return { error: `${arg} 需要一个值` }
      if (arg === '--profile') profile = value
      else source = value
      index += 1
      continue
    }
    if (arg.startsWith('--profile=')) {
      const value = arg.slice('--profile='.length)
      if (value === '') return { error: '--profile 需要一个值' }
      profile = value
      continue
    }
    if (arg.startsWith('--source=')) {
      const value = arg.slice('--source='.length)
      if (value === '') return { error: '--source 需要一个值' }
      source = value
      continue
    }
    // `npx dsh-fullstack-team install` passes the subcommand through; keep it.
    if (arg === 'install' || arg === 'upgrade') continue
    return { error: `未知参数 ${arg}` }
  }
  return { flags, profile, source }
}

/**
 * Run the whole install, collecting every message instead of printing.
 *
 * The returned lines are printed by `main()` (or asserted by tests), so this
 * function can be reasoned about without a terminal.
 *
 * @param options - Command line, environment, and injectable primitives.
 * @returns `{ code, lines }`, plus what changed for callers that care.
 */
export async function install(options = {}) {
  const argv = options.argv ?? []
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const exec = options.exec ?? spawnSync
  const sleep = options.sleep ?? defaultSleep

  const lines = []
  const say = (text) => lines.push({ stream: 'out', text })
  const warn = (text) => lines.push({ stream: 'err', text })
  const finish = (code, extra = {}) => ({ code, lines, ...extra })

  const parsed = parseArguments(argv)
  if (parsed.error !== undefined) {
    warn(`错误：${parsed.error}`)
    say(USAGE)
    return finish(2)
  }
  const { flags, profile: profileArg, source: sourceArg } = parsed
  if (flags.help) {
    say(USAGE)
    return finish(0)
  }

  const templatePath = env.DSH_PRESET_TEMPLATE ?? DEFAULT_TEMPLATE
  const profilePath = resolveProfile(profileArg)
  const host = probe({ profilePath, env, appPath: env.DSH_APP_PATH, asarPath: env.DSH_APP_ASAR })

  say(
    `宿主    ${host.asarExists ? `${HOST_APP_NAME} ${host.hostVersion ?? '（版本未知）'}` : '未找到'} · ${tilde(host.asarPath)}`,
  )
  say(`profile ${tilde(host.profilePath)} · 插件 dsh-fullstack-team ${host.repoVersion ?? '（版本未知）'}`)

  // ---- 1-2. alignment ------------------------------------------------------
  let compat
  try {
    compat = checkPresetCompat({ asarPath: host.asarPath, templatePath })
  } catch (error) {
    warn(`失败：预置模板兼容检查跑不起来（${error.message}）`)
    warn('  → 没有改动任何文件。')
    return finish(1)
  }

  if (compat.status === 'skip') {
    if (!host.asarExists && !missingHostAllowed({ dryRun: flags.dryRun, env })) {
      warn(`失败：找不到 DeepSeek Harness 宿主（${host.asarPath}）`)
      warn('  → macOS：先装好桌面端；装在别处就设 DSH_APP_ASAR 指到 app.asar。')
      warn('  → CI / 非 macOS / 只想看计划：加 --dry-run，或设 CI=1。')
      return finish(1)
    }
    say(`对齐检查  [SKIP] ${compat.reason}`)
  } else if (compat.status === 'error') {
    warn(`失败：预置模板与宿主 standard 无法比对（${compat.reason}）`)
    warn('  → 没有改动任何文件；宿主结构可能变了，需要维护者更新 check-preset-compat.mjs。')
    return finish(1)
  }

  let healed
  if (compat.status === 'drift') {
    say(`对齐检查  [DRIFT] ${compat.drifts.length} 处漂移，尝试按宿主 standard 重新派生模板…`)
    try {
      if (!host.asarExists) throw new Error('宿主 app.asar 不可读')
      const standardText = readAsarEntry(host.asarPath, STANDARD_ENTRY)
      const currentTemplate = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : ''
      const derived = deriveTemplate(standardText, currentTemplate)

      // The derived text must pass the very same compatibility check before it is
      // allowed anywhere near the real template.
      const scratch = mkdtempSync(join(tmpdir(), 'dsh-template-heal-'))
      let verified
      try {
        const probePath = join(scratch, 'preset.template.yml')
        writeFileSync(probePath, derived.text, 'utf8')
        verified = checkPresetCompat({ asarPath: host.asarPath, templatePath: probePath })
      } finally {
        rmSync(scratch, { recursive: true, force: true })
      }
      if (verified.status === 'error') throw new Error(verified.reason)
      if (verified.status !== 'ok') {
        throw new Error(
          `派生后复查仍有 ${verified.drifts.length} 处漂移（${verified.drifts.map((drift) => drift.id).join(', ')}）`,
        )
      }

      if (flags.dryRun) {
        healed = { path: templatePath, applied: false }
        say('  → 已派生出新模板，dry-run 不写盘')
      } else {
        writeFileSync(templatePath, derived.text, 'utf8')
        if (readFileSync(templatePath, 'utf8') !== derived.text) throw new Error('写回模板后读回的内容不一致')
        healed = { path: templatePath, applied: true }
        say(`  → 模板已按宿主 ${host.hostVersion ?? ''} 自动对齐：${tilde(templatePath)}`)
      }
      compat = verified
    } catch (error) {
      const who = host.hostVersion === undefined ? '宿主' : `宿主 ${host.hostVersion}`
      warn(`失败：${who} 的预置模板与插件不兼容，且无法自动对齐（${error.message}）`)
      for (const line of formatDrifts(compat.drifts)) warn(line)
      if (flags.force) {
        warn('  → --force：按你的要求继续合并；模板没有对齐，生成的预设可能加载不了。')
      } else {
        warn('  → profile 未改动。把上面的 [DRIFT] 报告交给维护者，或运行 node scripts/check-preset-compat.mjs 看完整报告。')
        return finish(1)
      }
    }
  }

  // ---- 3. generate ---------------------------------------------------------
  let patchText
  try {
    if (sourceArg !== undefined) {
      const path = expandPath(sourceArg)
      if (!existsSync(path)) throw new Error(`--source 指向的文件不存在：${path}`)
      patchText = readFileSync(path, 'utf8')
    } else {
      const generated = await generatePatch({ templatePath })
      patchText = generated.patch
      for (const note of generated.notes) say(note)
    }
  } catch (error) {
    warn(`失败：生成预置失败（${error.message}）`)
    warn('  → profile 未改动。先 pnpm build 或修好 roles/*.role.yml，再重跑。')
    return finish(1)
  }

  // ---- 4. merge ------------------------------------------------------------
  const merge = installPresets({ profilePath, patchText, dryRun: flags.dryRun, force: flags.force, presetCompat: compat })
  if (merge.code !== 0) {
    for (const line of merge.lines) {
      if (line.stream === 'err') warn(line.text)
      else say(line.text)
    }
    if (merge.rollbackNote !== undefined) {
      warn(`失败：合并 profile 未通过校验，${merge.rollbackNote}`)
    } else {
      warn(`失败：合并 profile 失败（${tilde(profilePath)}），没有写入任何预设`)
    }
    warn('  → 按上面的提示修 profile 后重跑；本次没有留下半合并的文件。')
    return finish(1)
  }

  if (flags.dryRun) {
    for (const line of merge.lines) say(line.text)
    say('dry-run：以上是计划，未写盘、未备份、未重启。去掉 --dry-run 即执行。')
    return finish(0, { dryRun: true })
  }

  // ---- 5. restart ----------------------------------------------------------
  const count = merge.presetIds.length
  if (!merge.changed) {
    say(
      healed?.applied === true
        ? `模板已对齐到宿主 ${host.hostVersion ?? ''}；profile 已是最新，无需操作`
        : '已是最新，无需操作',
    )
    return finish(0, { changed: false })
  }

  const restart = restartHost({
    platform,
    appPath: host.appPath,
    appName: HOST_APP_NAME,
    exec,
    sleep,
    skip: flags.noRestart,
  })
  const what = `已装好：${count} 个预设`
  const version = host.hostVersion ?? '宿主版本未知'
  if (restart.restarted) say(`${what} → 宿主已重启（${version}）`)
  else if (restart.reason === 'skipped-flag') say(`${what} → 重启宿主后生效（--no-restart）`)
  else if (restart.reason === 'not-macos') say(`${what} → 重启宿主后生效（不是 macOS，未自动重启）`)
  else if (restart.reason === 'app-missing') say(`${what} → 重启宿主后生效（没找到桌面端，未自动重启）`)
  else say(`${what} → 但自动重启失败，请手动重启宿主`)

  return finish(0, { changed: true, presetIds: merge.presetIds, backup: merge.backup })
}

/** CLI entry point; only runs when this file is executed directly. */
async function main() {
  const result = await install({ argv: process.argv.slice(2), env: process.env })
  for (const line of result.lines) (line.stream === 'err' ? console.error : console.log)(line.text)
  process.exitCode = result.code
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
