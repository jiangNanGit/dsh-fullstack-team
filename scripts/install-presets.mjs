#!/usr/bin/env node
/**
 * Merge the role presets into a profile: generate → back up → splice → re-read
 * and verify → roll back on failure.
 *
 * The merge is exported as {@link installPresets} so the single user entry point
 * (`scripts/install.mjs`) can reuse exactly this logic instead of shelling out to
 * this file twice. The command line below stays available for manual triage.
 *
 *   node scripts/install-presets.mjs                    # ~/.dsh/profiles/desktop/cordis.patch.yml
 *   node scripts/install-presets.mjs --profile web      # name → ~/.dsh/profiles/web/cordis.patch.yml
 *   node scripts/install-presets.mjs --profile /tmp/copy/cordis.patch.yml
 *   node scripts/install-presets.mjs --dry-run          # print the plan, write nothing
 *   node scripts/install-presets.mjs --source <file>    # merge an existing patch instead of generating
 *   node scripts/install-presets.mjs --force            # skip the template-vs-host compatibility gate
 *
 * Only the block this tool owns is replaced: the marker line
 * (`# ==== dsh-fullstack-team 角色预设 …`) through the trailing
 * `agent-preset-registry` entry, i.e. the `- insert:` preset entries whose ids
 * start with `preset-` plus the registry row. Every other line of the profile is
 * left byte-for-byte alone, and that is verified after the write.
 *
 * Safety:
 * - Before anything is generated or written, the template is compared with the
 *   standard preset the installed host ships (`check-preset-compat.mjs`). A host
 *   upgrade can delete a module a frozen template row still points at, and every
 *   generated preset then fails to load — so drift refuses the merge. `--force`
 *   skips that gate; run `node scripts/check-preset-compat.mjs` first to see why.
 * - `<file>.bak-YYYYMMDD-HHMMSS` is written before any change; a failure while
 *   verifying restores it (or removes the file we created) and exits non-zero.
 * - Re-running is idempotent: the same input produces the same bytes and no
 *   duplicate ids, so a second run reports "already up to date" and writes nothing.
 * - The profile is refused when the merged result would have duplicate entry ids
 *   or lose `agent-preset-registry`.
 *
 * Exit codes: 0 done (including "already up to date"); 1 generation/merge/verify/
 * compatibility failed (changes rolled back); 2 bad arguments.
 *
 * @module dsh-fullstack-team/scripts/install-presets
 */

import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPresetCompat, formatDrifts } from './check-preset-compat.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/** Package root (`scripts/..`). */
export const ROOT = resolve(here, '..')

/** First line of the block this tool owns. Kept stable so re-runs can find it. */
export const MARKER = '# ==== dsh-fullstack-team 角色预设（由 roles/*.role.yml 生成，勿手改）===='
export const REGISTRY_ID = 'agent-preset-registry'
const PRESET_ID = /^preset-[\w.-]+$/u

/** Default target: the desktop profile. */
export const DEFAULT_PROFILE = join(homedir(), '.dsh', 'profiles', 'desktop', 'cordis.patch.yml')

const USAGE = `用法：
  node scripts/install-presets.mjs [--profile <名字|路径>] [--dry-run] [--source <生成物>] [--force]

  --profile <名字>   装进 ~/.dsh/profiles/<名字>/cordis.patch.yml（默认 desktop）
  --profile <路径>   装进指定文件（相对路径按当前目录解析，支持 ~/）
  --dry-run          只打印将发生的变更，不写盘、不备份（仍会报告兼容状态）
  --source <文件>    直接合并该生成物（跳过现场生成；调试用）
  --force            跳过模板与宿主 standard 的兼容检查（确认无风险才用）

退出码：0 成功（含“已是最新”）；1 生成/合并/校验/兼容检查失败（已回滚）；2 参数错误`

/** Expand `~` and make a path absolute, the same way the plugin does. */
export function expandPath(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return resolve(path)
}

/**
 * Resolve the target profile file.
 *
 * @param value - A profile name, a path, or `undefined` for the default profile.
 * @returns Absolute path of the patch file.
 */
export function resolveProfile(value) {
  if (value === undefined) return DEFAULT_PROFILE
  if (value.includes('/') || value.startsWith('~') || /\.ya?ml$/iu.test(value)) return expandPath(value)
  return join(homedir(), '.dsh', 'profiles', value, 'cordis.patch.yml')
}

/** Preset entry ids (`preset-*`) in a patch document. */
function presetIds(lines) {
  const ids = []
  for (const line of lines) {
    const match = /^\s+-\s+id:\s+(preset-[\w.-]+)\s*$/u.exec(line)
    if (match !== null) ids.push(match[1])
  }
  return ids
}

/** Top-level entry ids in a patch document. */
function topLevelIds(lines) {
  const ids = []
  for (const line of lines) {
    const match = /^- id:\s*(\S+)\s*$/u.exec(line)
    if (match !== null) ids.push(match[1])
  }
  return ids
}

/** Whether a line starts a top-level entry that belongs to this tool. */
function isOurEntry(line) {
  if (/^- insert:\s*$/u.test(line)) return true
  const id = /^- id:\s*(\S+)\s*$/u.exec(line)?.[1]
  if (id === undefined) return false
  return id === REGISTRY_ID || PRESET_ID.test(id)
}

/**
 * End (exclusive) of the owned region that starts at `from`.
 *
 * Walks entries until a top-level line that is not ours. The registry row closes
 * the block, so whatever follows it belongs to the profile again.
 *
 * @param lines - Profile lines.
 * @param from - Index of the first line after the marker (or of the first entry).
 * @returns Exclusive end index; `from` when nothing is owned.
 */
function scanEnd(lines, from) {
  let end = from
  let index = from
  let sawRegistry = false
  while (index < lines.length) {
    const line = lines[index]
    // Blank lines are skipped without extending the region: they also occur
    // inside embedded block scalars (the plan-mode prompt), where a blank line
    // is content, not an entry boundary.
    if (line.trim() === '') {
      index += 1
      continue
    }
    if (/^\s/.test(line)) {
      end = index + 1 // child of the current entry, registry included
      index += 1
      continue
    }
    if (line.startsWith('#')) {
      if (sawRegistry) break
      end = index + 1
      index += 1
      continue
    }
    if (/^- /.test(line)) {
      if (sawRegistry) break // the registry row closes the block
      if (!isOurEntry(line)) break
      if (line.startsWith(`- id: ${REGISTRY_ID}`)) sawRegistry = true
      end = index + 1
      index += 1
      continue
    }
    break
  }
  return end
}

/**
 * Locate the region this tool owns.
 *
 * Prefers the marker line. A profile merged by hand (or by an older version) may
 * lack it, so a contiguous run of `preset-*` inserts (with the registry row) is
 * accepted too.
 *
 * @param lines - Profile lines.
 * @returns Region plus a count of duplicate markers, or `undefined` when the
 *   profile holds none of our entries.
 */
function locate(lines) {
  const markers = lines
    .map((line, index) => (/^#\s*={3,}/u.test(line) && line.includes('dsh-fullstack-team') ? index : -1))
    .filter((index) => index !== -1)
  if (markers.length > 0) {
    return { start: markers[0], end: scanEnd(lines, markers[0] + 1), markers: markers.length }
  }
  const start = lines.findIndex((line) => /^- insert:\s*$/u.test(line))
  if (start === -1) return undefined
  const end = scanEnd(lines, start)
  if (presetIds(lines.slice(start, end)).length === 0) return undefined
  return { start, end, markers: 0 }
}

/**
 * Drop our registry row when the profile already has one outside the owned block.
 *
 * A user may set `agent-preset-registry` themselves (to choose the default
 * preset). Two top-level rows with that id would be a duplicate entry, so the
 * profile's own row wins and ours is not inserted.
 *
 * @param block - Marker + generated lines.
 * @param lines - Profile lines.
 * @param region - Region being replaced, or `undefined` when appending.
 * @returns The block, without its registry row when one already exists outside.
 */
function withoutDuplicateRegistry(block, lines, region) {
  const outside = lines.some(
    (line, index) =>
      line.startsWith(`- id: ${REGISTRY_ID}`) && (region === undefined || index < region.start || index >= region.end),
  )
  if (!outside) return { block, dropped: false }
  const index = block.findIndex((line) => line.startsWith(`- id: ${REGISTRY_ID}`))
  if (index === -1) return { block, dropped: false }
  return { block: block.slice(0, index), dropped: true }
}

/**
 * Append the block to a profile that holds none of our entries.
 *
 * @param lines - Existing profile lines.
 * @param block - Marker + generated lines.
 * @returns New lines; a blank separator is added only when the file does not end
 *   with one, and the file always ends with a newline.
 */
function appendBlockLines(lines, block) {
  if (lines.length === 0) return [...block, '']
  const trailing = lines[lines.length - 1] === ''
  const body = trailing ? lines.slice(0, -1) : [...lines]
  if (body.length > 0 && body[body.length - 1].trim() !== '') body.push('')
  return [...body, ...block, '']
}

/**
 * Verify the written file.
 *
 * Checks that ids are unique, the registry row survived, every generated preset
 * is present, nothing stale is left, and both the lines before and after the
 * owned region are unchanged.
 *
 * @param written - File content as re-read from disk.
 * @param expectedBefore - Lines that must precede the region.
 * @param expectedAfter - Lines that must follow the region.
 * @param expectedIds - Preset ids the generation produced.
 * @param EOL - Line ending of the profile.
 * @returns Problems found; empty when the merge is sound.
 */
function verify(written, expectedBefore, expectedAfter, expectedIds, EOL) {
  const problems = []
  const lines = written.split(EOL)
  const ids = topLevelIds(lines)
  const duplicateTop = ids.filter((id, index) => ids.indexOf(id) !== index)
  if (duplicateTop.length > 0) problems.push(`顶层条目 id 重复：${[...new Set(duplicateTop)].join(', ')}`)
  if (!ids.includes(REGISTRY_ID)) problems.push(`顶层条目 ${REGISTRY_ID} 不见了`)

  const presets = presetIds(lines)
  const duplicatePresets = presets.filter((id, index) => presets.indexOf(id) !== index)
  if (duplicatePresets.length > 0) problems.push(`预设 id 重复：${[...new Set(duplicatePresets)].join(', ')}`)
  for (const id of expectedIds) {
    if (!presets.includes(id)) problems.push(`缺少预设条目 ${id}`)
  }
  const stale = presets.filter((id) => !expectedIds.includes(id))
  if (stale.length > 0) problems.push(`残留的旧预设条目：${stale.join(', ')}`)

  const region = locate(lines)
  if (region === undefined) problems.push('合并后找不到本插件的预设块')
  else {
    const head = lines.slice(0, region.start)
    const tail = lines.slice(region.end)
    const sameHead = head.length === expectedBefore.length && head.every((line, index) => line === expectedBefore[index])
    const sameTail = tail.length === expectedAfter.length && tail.every((line, index) => line === expectedAfter[index])
    if (!sameHead) problems.push('预设块之前的行被改动了')
    if (!sameTail) problems.push('预设块之后的行被改动了')
  }
  return problems
}

/** `<file>.bak-YYYYMMDD-HHMMSS`, with a counter when two runs share a second. */
function backupName(file) {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  let candidate = `${file}.bak-${stamp}`
  let counter = 1
  while (existsSync(candidate)) candidate = `${file}.bak-${stamp}-${counter++}`
  return candidate
}

/** Restore the pre-merge state after a failed write or verification. */
function rollback(file, backup, existedBefore) {
  if (backup !== undefined && existsSync(backup)) {
    copyFileSync(backup, file)
    return `已回滚 ${file}（来自 ${backup}）`
  }
  if (!existedBefore && existsSync(file)) {
    unlinkSync(file)
    return `已删除新建的 ${file}`
  }
  return '没有可回滚的内容'
}

/**
 * Refuse to merge when the frozen template no longer matches the host's shipped
 * standard preset, unless the caller (or `--force`) says otherwise.
 *
 * Precomputed reports are reused so the user entry point (`scripts/install.mjs`)
 * does not read the 200 MB host archive twice: it runs the check once, heals the
 * template if needed, and hands the fresh report to {@link installPresets}.
 *
 * @param options - Report, `force`, and the two output sinks.
 * @returns 0 when the merge may proceed, 1 when it must not.
 */
function compatGate({ report, force, out, err }) {
  if (force) {
    out('--force：跳过预置模板兼容检查')
    return 0
  }
  let resolved = report
  if (resolved === undefined) {
    try {
      resolved = checkPresetCompat()
    } catch (error) {
      err(`dsh-fullstack-team: 预置模板兼容检查失败：${error.message}`)
      return 1
    }
  }
  if (resolved.status === 'skip') {
    out(`兼容检查  [SKIP] ${resolved.reason}`)
    return 0
  }
  if (resolved.status === 'error') {
    err(`dsh-fullstack-team: 预置模板兼容检查无法完成：${resolved.reason}`)
    return 1
  }
  if (resolved.status === 'drift') {
    err('dsh-fullstack-team: templates/preset.template.yml 与当前宿主的 standard 预置不一致，拒绝合并 profile。')
    for (const line of formatDrifts(resolved.drifts)) err(line)
    err('\n宿主已升级，先跑 node scripts/check-preset-compat.mjs 按报告校准模板；确认无风险后可加 --force 跳过。')
    return 1
  }
  out(
    `兼容检查  [OK] 模板 ${resolved.rows.template} 个插件 row 与宿主 standard 一致（standard ${resolved.standardLines} 行）`,
  )
  return 0
}

/**
 * Merge one generated patch into one profile.
 *
 * Pure with respect to process state: every message is collected in `lines` and
 * the exit code is returned, so both the CLI and `scripts/install.mjs` can decide
 * what to print and how to continue. Side effects are only the backup, the
 * write, and the rollback — all confined to the target file.
 *
 * @param options - Target profile, patch text or source file, and flags.
 * @returns `code` (0/1), collected `lines`, and what changed.
 */
export function installPresets(options = {}) {
  const lines = []
  const out = (text) => lines.push({ stream: 'out', text })
  const err = (text) => lines.push({ stream: 'err', text })
  const target = options.profilePath ?? DEFAULT_PROFILE
  const dryRun = options.dryRun === true
  const force = options.force === true
  const done = (code, extra = {}) => ({ code, lines, profilePath: target, changed: false, presetIds: [], ...extra })

  const gate = compatGate({ report: options.presetCompat, force, out, err })
  if (gate !== 0) return done(gate)

  if (typeof options.patchText !== 'string') {
    err('dsh-fullstack-team: 内部错误：没有传入生成物')
    return done(1)
  }
  const generated = options.patchText

  const generatedLines = generated.trimEnd().split(/\r?\n/u)
  const expectedIds = presetIds(generatedLines)
  if (expectedIds.length === 0) {
    err('dsh-fullstack-team: 生成物里没有 preset-* 条目，拒绝合并')
    return done(1)
  }
  const duplicateGenerated = expectedIds.filter((id, index) => expectedIds.indexOf(id) !== index)
  if (duplicateGenerated.length > 0) {
    err(`dsh-fullstack-team: 生成物里 id 重复（${[...new Set(duplicateGenerated)].join(', ')}），拒绝合并`)
    return done(1)
  }

  const fullBlock = [MARKER, ...generatedLines]
  const existed = existsSync(target)
  const original = existed ? readFileSync(target, 'utf8') : ''
  const EOL = original.includes('\r\n') ? '\r\n' : '\n'
  const linesOfProfile = existed ? original.split(EOL) : []

  const region = existed ? locate(linesOfProfile) : undefined
  if (region !== undefined && region.markers > 1) {
    err(
      `dsh-fullstack-team: ${target} 里有 ${region.markers} 处本插件标记，无法判断该替换哪一块；` +
        '先手工删掉多余的那块再重跑，本次未改动文件',
    )
    return done(1)
  }

  const { block, dropped } = withoutDuplicateRegistry(fullBlock, linesOfProfile, region)
  if (dropped) out(`${target} 已有顶层 ${REGISTRY_ID}，保留原行，跳过重复插入`)

  const mergedLines =
    region === undefined
      ? appendBlockLines(linesOfProfile, block)
      : [...linesOfProfile.slice(0, region.start), ...block, ...linesOfProfile.slice(region.end)]
  const merged = mergedLines.join(EOL)

  // What the file should look like around our block after the splice. Deriving it
  // from the merged lines (instead of the old ones) keeps the check honest when a
  // separator had to be added at the end of a file without a trailing newline.
  const mergedRegion = locate(mergedLines)
  if (mergedRegion === undefined) {
    err('dsh-fullstack-team: 合并后找不到本插件的预设块（内部错误），未写入文件')
    return done(1)
  }
  const expectedBefore = mergedLines.slice(0, mergedRegion.start)
  const expectedAfter = mergedLines.slice(mergedRegion.end)

  const oldIds = existed ? presetIds(linesOfProfile) : []
  const added = expectedIds.filter((id) => !oldIds.includes(id))
  const removed = oldIds.filter((id) => !expectedIds.includes(id))

  if (dryRun) {
    out('dry-run：以下变更不会写入任何文件')
    out(`  profile   ${target}${existed ? '' : '（不存在，将新建）'}`)
    out(`  预设      ${expectedIds.length} 个：${expectedIds.join(', ')}`)
    if (region === undefined) {
      out(`  定位      没有本插件块 → 追加到文件末尾（${block.length} 行）`)
    } else {
      out(`  定位      第 ${region.start + 1}-${region.end} 行（${region.end - region.start} 行）→ 替换为 ${block.length} 行`)
    }
    if (added.length > 0) out(`  新增      ${added.join(', ')}`)
    if (removed.length > 0) out(`  移除      ${removed.join(', ')}`)
    if (existed) out(`  备份      ${backupName(target)}（合并前）`)
    out(`  区域外    ${expectedBefore.length + expectedAfter.length} 行保持原样`)
    out('  重启      合并后需重启 DSH 才会加载新预设')
    return done(0, { dryRun: true, presetIds: expectedIds, added, removed })
  }

  if (existed && merged === original) {
    out(`已是最新：${target} 与生成物一致（${expectedIds.length} 个预设），未写入、未备份`)
    return done(0, { presetIds: expectedIds, added: [], removed: [] })
  }

  const backup = existed ? backupName(target) : undefined
  try {
    mkdirSync(dirname(target), { recursive: true })
    if (backup !== undefined) copyFileSync(target, backup)
    writeFileSync(target, merged, 'utf8')
  } catch (error) {
    const note = rollback(target, backup, existed)
    err(`dsh-fullstack-team: 写入 ${target} 失败：${error.message}；${note}`)
    return done(1, { backup, rollbackNote: note })
  }

  const problems = verify(readFileSync(target, 'utf8'), expectedBefore, expectedAfter, expectedIds, EOL)
  if (problems.length > 0) {
    const note = rollback(target, backup, existed)
    err(`dsh-fullstack-team: 合并后校验失败，${note}`)
    for (const problem of problems) err(`  ✗ ${problem}`)
    err('提示：若问题来自 profile 原有内容（例如合并前就重复的条目 id），先修 profile 再重跑；本次已回滚。')
    return done(1, { backup, rollbackNote: note, problems })
  }

  out(`\n已合并 ${expectedIds.length} 个预设 → ${target}`)
  if (backup !== undefined) out(`备份：${backup}`)
  if (added.length > 0) out(`新增：${added.join(', ')}`)
  if (removed.length > 0) out(`移除：${removed.join(', ')}`)
  out(`区域外 ${expectedBefore.length + expectedAfter.length} 行未改动；结构校验通过（id 无重复、${REGISTRY_ID} 仍在）`)
  out('\n重启 DSH（退出并重开桌面端，或重启当前 GUI 进程）后，新预设才会出现在预设选择器里。')
  out('全局 cordis.patch.yml 只在启动时读取，热重载不会重新装载预设。')
  return done(0, { changed: true, presetIds: expectedIds, added, removed, backup })
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

/**
 * Produce the preset patch text for the command line: generate with the same
 * rules as `roles.mjs`, or reuse a file handed in with `--source`.
 *
 * @param sourceArg - `--source` value, or `undefined` to generate.
 * @returns The generated patch document.
 * @throws When generation fails, or the source file is missing.
 */
function generateFromCli(sourceArg) {
  if (sourceArg !== undefined) {
    const path = expandPath(sourceArg)
    if (!existsSync(path)) throw new Error(`--source 指向的文件不存在：${path}`)
    return readFileSync(path, 'utf8')
  }
  const lib = join(ROOT, 'lib', 'roles.js')
  if (!existsSync(lib)) {
    throw new Error(`缺少构建产物 ${lib}；先在包目录运行 pnpm build，或改用 --source <生成物>`)
  }
  const scratch = mkdtempSync(join(tmpdir(), 'dsh-presets-'))
  try {
    const out = join(scratch, 'roles.patch.yml')
    const result = spawnSync(process.execPath, [join(here, 'roles.mjs'), '--out', out], { stdio: 'inherit' })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) {
      throw new Error(`生成失败（scripts/roles.mjs 退出码 ${result.status}），profile 未改动`)
    }
    if (!existsSync(out)) throw new Error('生成器没有产出文件，profile 未改动')
    return readFileSync(out, 'utf8')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** CLI entry point; only runs when this file is executed directly. */
function main() {
  const argv = process.argv.slice(2)

  /** Print usage and exit. */
  const usage = (code, reason) => {
    if (reason !== undefined) console.error(`错误：${reason}\n`)
    ;(code === 0 ? console.log : console.error)(USAGE)
    process.exitCode = code
  }

  if (argv.includes('--help') || argv.includes('-h')) {
    usage(0)
    return
  }

  const profileArg = flagValue(argv, '--profile')
  const sourceArg = flagValue(argv, '--source')
  const dryRun = argv.includes('--dry-run')
  const force = argv.includes('--force')
  if (profileArg === '') {
    usage(2, '--profile 需要一个名字或路径')
    return
  }
  if (sourceArg === '') {
    usage(2, '--source 需要一个文件路径')
    return
  }

  /**
   * Reject stray arguments while letting a flag value look like anything.
   */
  const known = new Set(['--profile', '--source', '--dry-run', '--force', '--help', '-h'])
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--profile' || arg === '--source') {
      index += 1
      continue
    }
    if (arg.startsWith('--profile=') || arg.startsWith('--source=') || known.has(arg)) continue
    usage(2, `未知参数 ${arg}`)
    return
  }

  let patchText
  try {
    patchText = generateFromCli(sourceArg)
  } catch (error) {
    console.error(`dsh-fullstack-team: ${error.message}`)
    process.exitCode = 1
    return
  }

  const result = installPresets({ profilePath: resolveProfile(profileArg), patchText, dryRun, force })
  for (const line of result.lines) (line.stream === 'err' ? console.error : console.log)(line.text)
  process.exitCode = result.code
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
