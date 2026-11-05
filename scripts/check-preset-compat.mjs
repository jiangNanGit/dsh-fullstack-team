#!/usr/bin/env node
/**
 * Compare `templates/preset.template.yml` with the standard preset the installed
 * DSH host actually ships.
 *
 * The template is a manual freeze of upstream's `standard.patch.yml`. When the
 * host is upgraded, a plugin row can be renamed or a subpath module deleted and
 * the template silently keeps pointing at it — every generated preset then fails
 * to load and new sessions stop starting. This check turns that class of drift
 * into a build failure instead of a live incident.
 *
 *   node scripts/check-preset-compat.mjs          # human report; exit 1 on drift
 *   node scripts/check-preset-compat.mjs --json   # machine-readable report
 *   DSH_APP_ASAR=/path/to/app.asar node scripts/check-preset-compat.mjs
 *
 * The host ships its files inside an Electron asar archive. One entry is read
 * straight out of the archive (no temp files, nothing written):
 *
 *   dsh/node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml
 *
 * On a machine without the host (CI, Linux, Windows) the check prints `[SKIP]`
 * and exits 0 — a missing host is not a compatibility failure.
 *
 * Three drift classes are reported:
 *   1. a plugin row the template has and the standard does not (most dangerous:
 *      it is the exact shape of the incident — a removed module still listed);
 *   2. the same row id with a different `name` (a renamed or deleted subpath);
 *   3. a different set of config lines for the same row (e.g. a changed
 *      `disabled:` expression), ignoring lines carrying a `{{...}}` placeholder
 *      — those are this bundle's injection points and are expected to differ.
 *
 * Exit codes: 0 no drift (or skip); 1 drift or an unreadable template/standard
 * structure; 2 bad arguments.
 *
 * @module dsh-fullstack-team/scripts/check-preset-compat
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

/** Host archive on macOS. Override with `DSH_APP_ASAR`. */
export const DEFAULT_ASAR = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'

/** Entry inside the archive that holds the shipped standard preset. */
export const STANDARD_ENTRY = 'dsh/node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml'

/** The frozen copy this repository compares against. */
export const DEFAULT_TEMPLATE = join(root, 'templates', 'preset.template.yml')

/** A list item whose first key is `id`, at any indentation: a row. */
const ROW_START = /^(\s*)-\s+id:\s*(\S+)\s*$/u
/** The `name:` key of a row. */
const NAME_LINE = /^name:\s*(.+?)\s*$/u
/** A template injection point (`{{ROLE_PREFIX}}` and friends). */
const PLACEHOLDER = /\{\{[^}]*\}\}/u

/**
 * Strip the quotes around a scalar, if any.
 *
 * @param value - Raw scalar text.
 * @returns The scalar without its surrounding quotes.
 */
function unquote(value) {
  const text = value.trim()
  const quoted =
    (text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))
  return quoted ? text.slice(1, -1) : text
}

/** Number of lines in a document; a trailing newline does not add a line. */
function lineCount(text) {
  if (text === '') return 0
  const lines = text.split(/\r?\n/u)
  return text.endsWith('\n') || text.endsWith('\r') ? lines.length - 1 : lines.length
}

/**
 * Parse the plugin rows of a preset patch.
 *
 * A row starts at a `- id: <id>` line and runs until the next row at the same or
 * a shallower indentation. Its `name:` is the first own `name:` key; its config
 * lines are the row's other text lines, dedented, with blank lines, `#`
 * comments, and the spans of nested rows removed (nested rows are compared as
 * rows of their own). Rows directly under `insert:` are preset declarations, not
 * plugin rows: they carry `depth: 0` and `diffRows` ignores them, because the
 * template's preset id is a placeholder (`{{PRESET_ID}}`).
 *
 * @param text - Preset patch YAML.
 * @returns Rows in document order.
 */
export function parseRows(text) {
  const lines = String(text).split(/\r?\n/u)
  const starts = []
  lines.forEach((line, index) => {
    const match = ROW_START.exec(line)
    if (match !== null) starts.push({ index, indent: match[1].length, id: match[2] })
  })

  const spans = starts.map((start, at) => {
    let end = lines.length
    for (let next = at + 1; next < starts.length; next += 1) {
      if (starts[next].indent <= start.indent) {
        end = starts[next].index
        break
      }
    }
    return { ...start, end }
  })

  return spans.map((span, at) => {
    // Every row inside this span is at a deeper indentation (that is what ends
    // the span), so it is a child row and its lines must not leak into ours.
    const children = spans.slice(at + 1).filter((nested) => nested.index < span.end)
    const covered = (index) => children.some((nested) => index >= nested.index && index < nested.end)

    let name
    const configLines = []
    for (let index = span.index + 1; index < span.end; index += 1) {
      const raw = lines[index]
      if (raw.trim() === '') continue
      if (raw.trim().startsWith('#')) continue
      if (covered(index)) continue
      const dedented = raw.replace(/^\s+/u, '')
      const nameMatch = NAME_LINE.exec(dedented)
      if (name === undefined && nameMatch !== null) {
        name = unquote(nameMatch[1])
        continue
      }
      configLines.push(dedented)
    }

    const depth = spans.filter(
      (other) => other !== span && other.index < span.index && other.end > span.index && other.indent < span.indent,
    ).length

    return { id: span.id, name, configLines, indent: span.indent, depth, line: span.index + 1 }
  })
}

/** A compact copy of a row, safe to serialise and stable for tests. */
function snapshot(row) {
  return { id: row.id, name: row.name, configLines: [...row.configLines], line: row.line }
}

/**
 * Compare two parsed row lists.
 *
 * Only plugin rows (`depth > 0`) take part; preset declarations are ignored.
 * Config lines are compared as sets and lines with a `{{...}}` placeholder are
 * dropped from both sides before comparing.
 *
 * @param templateRows - Rows parsed from the template.
 * @param standardRows - Rows parsed from the host's standard preset.
 * @returns Drift entries; empty when the template matches.
 */
export function diffRows(templateRows, standardRows) {
  const plugins = (rows) => rows.filter((row) => row.depth > 0)
  const index = (rows) => {
    const byId = new Map()
    for (const row of plugins(rows)) if (!byId.has(row.id)) byId.set(row.id, row)
    return byId
  }
  const templateById = index(templateRows)
  const standardById = index(standardRows)

  const configSet = (row) => new Set(row.configLines.filter((line) => !PLACEHOLDER.test(line)))
  const configOnly = (left, right) => [...left].filter((line) => !right.has(line))

  const drifts = []
  for (const [id, template] of templateById) {
    const standard = standardById.get(id)
    if (standard === undefined) {
      drifts.push({
        id,
        kind: 'missing-row',
        reason: '模板里有、宿主 standard 没有（最危险：模板可能还在引用宿主已删除的模块）',
        template: snapshot(template),
        standard: null,
      })
      continue
    }

    if (template.name !== standard.name && !PLACEHOLDER.test(template.name ?? '') && !PLACEHOLDER.test(standard.name ?? '')) {
      drifts.push({
        id,
        kind: 'name-changed',
        reason: `同 id 但 name 不同（模板 ${template.name ?? '<无>'} / standard ${standard.name ?? '<无>'}）`,
        template: snapshot(template),
        standard: snapshot(standard),
      })
    }

    const templateConfig = configSet(template)
    const standardConfig = configSet(standard)
    const onlyInTemplate = configOnly(templateConfig, standardConfig)
    const onlyInStandard = configOnly(standardConfig, templateConfig)
    if (onlyInTemplate.length > 0 || onlyInStandard.length > 0) {
      drifts.push({
        id,
        kind: 'config-changed',
        reason: 'config 行不同（已忽略 {{...}} 注入行）',
        template: snapshot(template),
        standard: snapshot(standard),
        config: { onlyInTemplate, onlyInStandard },
      })
    }
  }
  return drifts
}

/**
 * Read one entry out of an Electron asar archive.
 *
 * Layout: a 16-byte prefix, a JSON header (its length is the uint32 at byte 12),
 * then the file data. `@electron/asar` starts the data section at `8 + sizeOfHeaderBuffer`
 * (the uint32 at byte 4); the JSON header itself ends 2 padding bytes earlier in
 * current builds, so this deliberately does not use `16 + headerSize`.
 *
 * @param asarPath - Path to the archive.
 * @param entryPath - Entry path inside the archive, without a leading slash.
 * @returns The entry's text.
 * @throws When the archive is unreadable, malformed, or lacks the entry.
 */
export function readAsarEntry(asarPath, entryPath) {
  const buffer = readFileSync(asarPath)
  if (buffer.length < 16) throw new Error(`${asarPath} 不是有效的 asar（文件过短）`)
  const headerSize = buffer.readUInt32LE(12)
  if (headerSize <= 0 || 16 + headerSize > buffer.length) {
    throw new Error(`${asarPath} 的 asar 头部长度非法（${headerSize}）`)
  }
  let header
  try {
    header = JSON.parse(buffer.subarray(16, 16 + headerSize).toString('utf8'))
  } catch (error) {
    throw new Error(`${asarPath} 的 asar 头部不是 JSON：${error.message}`)
  }

  let node = header
  for (const part of entryPath.split('/').filter(Boolean)) {
    if (node === null || typeof node !== 'object' || node.files === undefined) {
      throw new Error(`${asarPath} 里没有 ${entryPath}`)
    }
    if (!Object.prototype.hasOwnProperty.call(node.files, part)) {
      throw new Error(`${asarPath} 里没有 ${entryPath}`)
    }
    node = node.files[part]
  }
  const offset = Number(node.offset)
  const size = Number(node.size)
  if (!Number.isFinite(offset) || !Number.isFinite(size)) {
    throw new Error(`${asarPath} 里 ${entryPath} 不是普通文件`)
  }
  const start = 8 + buffer.readUInt32LE(4) + offset
  const end = start + size
  if (start < 0 || end > buffer.length) {
    throw new Error(`${asarPath} 里 ${entryPath} 的字节范围越界（${start}-${end}）`)
  }
  return buffer.subarray(start, end).toString('utf8')
}

/**
 * Run the whole comparison.
 *
 * A missing host, unreadable archive, or missing standard entry yields
 * `status: 'skip'` (never an error); a host whose standard parses into no plugin
 * rows yields `status: 'error'` because that means the parser no longer matches
 * the shipped shape.
 *
 * @param options - Optional overrides (used by tests and by callers that already
 *   know the paths).
 * @returns A report: `ok` / `drift` / `skip` / `error`, row counts, and drifts.
 * @throws When the template itself cannot be read.
 */
export function checkPresetCompat(options = {}) {
  const asarPath = options.asarPath ?? process.env.DSH_APP_ASAR ?? DEFAULT_ASAR
  const templatePath = options.templatePath ?? DEFAULT_TEMPLATE
  const templateText = readFileSync(templatePath, 'utf8')
  const templateRows = parseRows(templateText)
  const templatePlugins = templateRows.filter((row) => row.depth > 0).length

  let standardText
  try {
    standardText = readAsarEntry(asarPath, STANDARD_ENTRY)
  } catch (error) {
    return {
      status: 'skip',
      reason: error.message,
      asarPath,
      entry: STANDARD_ENTRY,
      templatePath,
      templateLines: lineCount(templateText),
      rows: { template: templatePlugins, standard: 0 },
      drifts: [],
    }
  }

  const standardRows = parseRows(standardText)
  const standardPlugins = standardRows.filter((row) => row.depth > 0).length
  const base = {
    asarPath,
    entry: STANDARD_ENTRY,
    templatePath,
    standardLines: lineCount(standardText),
    standardBytes: Buffer.byteLength(standardText),
    templateLines: lineCount(templateText),
    rows: { template: templatePlugins, standard: standardPlugins },
  }

  if (standardPlugins === 0) {
    return { status: 'error', reason: '解出的 standard.patch.yml 没有解析到任何插件 row（结构可能变了）', ...base }
  }
  if (templatePlugins === 0) {
    return { status: 'error', reason: '模板没有解析到任何插件 row（结构可能变了）', ...base }
  }

  const drifts = diffRows(templateRows, standardRows)
  return { status: drifts.length > 0 ? 'drift' : 'ok', ...base, drifts }
}

/** Render one side of a drift entry as indented lines. */
function sideLines(label, row) {
  const lines = [`  ${label}：`, `    row  ${row.id}（第 ${row.line} 行）`]
  lines.push(row.name === undefined ? '    name <无>' : `    name ${row.name}`)
  for (const line of row.configLines) lines.push(`    ${line}`)
  return lines
}

/**
 * Render drift entries for humans, one `[DRIFT] <id>: <reason>` header each.
 *
 * @param drifts - Entries from {@link diffRows}.
 * @returns Printable lines.
 */
export function formatDrifts(drifts) {
  const lines = []
  for (const drift of drifts) {
    lines.push(`[DRIFT] ${drift.id}: ${drift.reason}`)
    if (drift.standard === null) lines.push('  standard：<没有这个 row>')
    else lines.push(...sideLines('standard', drift.standard))
    if (drift.template === null) lines.push('  模板：<没有这个 row>')
    else lines.push(...sideLines('模板', drift.template))
    if (drift.kind === 'config-changed' && drift.config !== undefined) {
      lines.push('  仅 standard 有：')
      if (drift.config.onlyInStandard.length === 0) lines.push('    （无）')
      for (const line of drift.config.onlyInStandard) lines.push(`    ${line}`)
      lines.push('  仅模板有：')
      if (drift.config.onlyInTemplate.length === 0) lines.push('    （无）')
      for (const line of drift.config.onlyInTemplate) lines.push(`    ${line}`)
    }
  }
  return lines
}

/**
 * Render a whole report for humans.
 *
 * @param report - Result of {@link checkPresetCompat}.
 * @returns Printable lines.
 */
export function formatReport(report) {
  if (report.status === 'skip') {
    return [
      `[SKIP] 跳过预置兼容检查：${report.reason}`,
      `  宿主   ${report.asarPath}`,
      '  （没有宿主 / 非 macOS / CI 属正常情况，不视为失败）',
    ]
  }
  if (report.status === 'error') {
    return [
      `[ERROR] ${report.reason}`,
      `  宿主   ${report.asarPath}`,
      `  条目   ${report.entry}`,
      `  模板   ${report.templatePath}`,
    ]
  }

  const lines = [
    report.status === 'ok'
      ? `[OK] 模板与宿主 standard 一致：${report.rows.template} 个插件 row（standard ${report.standardLines} 行）`
      : `[DRIFT] 模板与宿主 standard 有 ${report.drifts.length} 处漂移（模板 ${report.rows.template} / standard ${report.rows.standard} 个插件 row）`,
    `  宿主   ${report.asarPath}`,
    `  条目   ${report.entry}（standard ${report.standardLines} 行 / ${report.standardBytes} 字节）`,
    `  模板   ${report.templatePath}（${report.templateLines} 行）`,
  ]
  if (report.status === 'drift') {
    lines.push('')
    lines.push(...formatDrifts(report.drifts))
    lines.push('')
    lines.push('宿主已升级时按上述报告校准 templates/preset.template.yml；不要手改 presets/roles.patch.yml，改完重跑 node scripts/roles.mjs --write。')
  }
  return lines
}

const USAGE = `用法：
  node scripts/check-preset-compat.mjs [--json]

  --json    输出机器可读的报告（含 drifts 结构）
  环境变量  DSH_APP_ASAR  覆盖宿主 app.asar 路径

退出码：0 无漂移（或跳过）；1 有漂移/结构异常；2 参数错误`

/** CLI entry point; only runs when this file is executed directly. */
function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE)
    process.exitCode = 0
    return
  }
  const json = argv.includes('--json')
  const unknown = argv.find((arg) => arg !== '--json')
  if (unknown !== undefined) {
    console.error(`错误：未知参数 ${unknown}\n`)
    console.error(USAGE)
    process.exitCode = 2
    return
  }

  let report
  try {
    report = checkPresetCompat()
  } catch (error) {
    if (json) console.log(JSON.stringify({ status: 'error', reason: error.message }, null, 2))
    else console.error(`[ERROR] ${error.message}`)
    process.exitCode = 1
    return
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    const write = report.status === 'error' ? console.error : console.log
    for (const line of formatReport(report)) write(line)
  }
  process.exitCode = report.status === 'ok' || report.status === 'skip' ? 0 : 1
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
