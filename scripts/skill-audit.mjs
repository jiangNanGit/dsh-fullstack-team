#!/usr/bin/env node
/**
 * Fail when a skill carries project content.
 *
 * A skill is a capability: it may name the document it expects a project to
 * keep (`specs/INDEX.md`), but it must not carry that document's facts — a
 * table name, an endpoint, a host, a business scenario. Facts baked into a
 * capability follow it into every project that mounts it, and the one place
 * they are wrong becomes invisible.
 *
 * Two rule sets:
 *
 * - Generic (always on, no configuration): local absolute paths, passwords and
 *   phone numbers, API paths, hosts and connection strings. These are wrong in
 *   every project, so they live here.
 * - Project (optional, from `project-facts.json`): the company names, repository
 *   names, table prefixes and the like that are only true for one project. The
 *   shipped script carries none of them; it reads the project's own list, and
 *   without that file it simply runs the generic rules. That way the published
 *   package never names a customer, and a project can still be audited for its
 *   own vocabulary.
 *
 *   node scripts/skill-audit.mjs <dir> [<dir>...] [--facts <file>]
 *
 * `project-facts.json` lives at the workspace root. Every key is optional; a
 * value is a string or an array of strings; patterns are matched as literals
 * (not regular expressions):
 *
 *   {
 *     "companyNames":  ["某某公司", "某某品牌"],
 *     "repoNames":     ["your-backend-repo", "your-web-repo"],
 *     "tablePrefixes": ["your_prefix_"],
 *     "tableNames":    ["your_table"],
 *     "hosts":         ["10.0.0.8", "rds.example.internal"],
 *     "endpoints":     ["/api/<resource>/list"],
 *     "accounts":      ["your-account", "138********"],
 *     "extraRules":    [{ "label": "业务术语", "pattern": "<业务专有词>" }]
 *   }
 *
 * Lookup order: `--facts <file>` → `<cwd>/project-facts.json` → the repository's
 * own `project-facts.json`. Keys starting with `$` or `_` are treated as
 * comments; an unknown key or a wrong type is an error (exit 2) instead of a
 * silently skipped rule, because a typo would hide exactly what this checks.
 *
 * Exit codes: 0 clean; 1 findings; 2 bad usage or bad config.
 *
 * @module dsh-fullstack-team/scripts/skill-audit
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repository = resolve(here, '..')

/**
 * Rules that are true in every project.
 *
 * `[label, pattern]` pairs; a match is reported with the label.
 */
const GENERIC = [
  ['本机绝对路径', /(?<![\w.-])\/(?:Users|home)\/[a-z][\w.-]*\//iu],
  ['本机绝对路径', /[A-Za-z]:\\[A-Za-z][\w.\\-]*/u],
  ['口令或手机号', /\badmin\d+\b|\b1[3-9]\d{9}\b|password\s*[:=]\s*\S+/iu],
  ['接口路径', /\/api\/[\w/-]{4,}/iu],
  ['主机或连接串', /jdbc:|mysql:\/\/|redis:\/\/|\b\d{1,3}(?:\.\d{1,3}){3}\b|\brds\.[\w.-]+/iu],
]

/** Keys `project-facts.json` understands. */
const FACT_KEYS = new Set([
  'companyNames',
  'repoNames',
  'tablePrefixes',
  'tableNames',
  'hosts',
  'endpoints',
  'accounts',
  'extraRules',
])

const USAGE = `用法：node scripts/skill-audit.mjs <dir> [<dir>...] [--facts <file>]

  <dir>           要体检的技能目录（可多个）
  --facts <file>  指定项目事实清单；缺省时依次找
                  <cwd>/project-facts.json、本仓根/project-facts.json，
                  都没有就只跑通用规则`

/** Print usage and exit. */
function usage(code, reason) {
  if (reason !== undefined) console.error(`错误：${reason}\n`)
  ;(code === 0 ? console.log : console.error)(USAGE)
  process.exit(code)
}

const argv = process.argv.slice(2)
const roots = []
let factsArg

for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index]
  if (arg === '--facts') {
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('-')) usage(2, '--facts 需要一个文件路径')
    factsArg = value
    index += 1
    continue
  }
  if (arg.startsWith('--facts=')) {
    factsArg = arg.slice('--facts='.length)
    if (factsArg === '') usage(2, '--facts 需要一个文件路径')
    continue
  }
  if (arg === '--help' || arg === '-h') usage(0)
  if (arg.startsWith('-')) usage(2, `未知参数 ${arg}`)
  roots.push(arg)
}

if (roots.length === 0) usage(2, '至少给一个要扫描的目录')

/** Expand `~` and make a path absolute. */
function expandPath(path) {
  if (path === '~') return resolve(process.env.HOME ?? '.')
  if (path.startsWith('~/')) return join(process.env.HOME ?? '.', path.slice(2))
  return resolve(path)
}

/**
 * Find the project fact list.
 *
 * @returns Path to an existing file, or `undefined` when the project has none.
 */
function findFacts() {
  if (factsArg !== undefined) {
    const path = expandPath(factsArg)
    if (!existsSync(path)) usage(2, `--facts 指向的文件不存在：${path}`)
    return path
  }
  for (const candidate of [join(process.cwd(), 'project-facts.json'), join(repository, 'project-facts.json')]) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/** Escape a literal so it can be embedded in a regular expression. */
function escapeLiteral(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/** Read one key as a list of non-empty strings. */
function asList(value, key, path) {
  if (value === undefined) return []
  const list = Array.isArray(value) ? value : [value]
  const result = []
  for (const item of list) {
    if (typeof item !== 'string' || item.trim() === '') {
      usage(2, `${path}: "${key}" 的值必须是非空字符串或字符串数组`)
    }
    result.push(item.trim())
  }
  return result
}

/**
 * Compile the project's facts into rules.
 *
 * @param path - Absolute path of `project-facts.json`.
 * @returns `[label, pattern]` pairs.
 */
function loadFacts(path) {
  let raw
  try {
    raw = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/u, ''))
  } catch (error) {
    usage(2, `无法解析 ${path}：${error.message}`)
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) usage(2, `${path} 顶层必须是 JSON 对象`)

  for (const key of Object.keys(raw)) {
    if (key.startsWith('$') || key.startsWith('_') || FACT_KEYS.has(key)) continue
    usage(2, `${path}: 未知键 "${key}"；允许的键：${[...FACT_KEYS].join(', ')}`)
  }

  const rules = []

  /** Add literals as one alternation rule. */
  const addLiterals = (label, literals) => {
    const values = literals.map(escapeLiteral).filter((value) => value !== '')
    if (values.length > 0) rules.push([label, new RegExp(`(?:${values.join('|')})`, 'iu')])
  }

  addLiterals('公司/项目名', asList(raw.companyNames, 'companyNames', path))
  addLiterals('业务仓名', asList(raw.repoNames, 'repoNames', path))
  addLiterals('主机或连接串', asList(raw.hosts, 'hosts', path))
  addLiterals('接口路径', asList(raw.endpoints, 'endpoints', path))
  addLiterals('口令或账号', asList(raw.accounts, 'accounts', path))

  // A table prefix is a word start: `t_` must not fire inside `output_type`,
  // so the prefix is compiled here (already escaped) instead of via addLiterals.
  const tablePatterns = [
    ...asList(raw.tablePrefixes, 'tablePrefixes', path).map((prefix) => `(?<![A-Za-z0-9])${escapeLiteral(prefix)}`),
    ...asList(raw.tableNames, 'tableNames', path).map(escapeLiteral),
  ]
  if (tablePatterns.length > 0) rules.push(['业务表名', new RegExp(`(?:${tablePatterns.join('|')})`, 'iu')])

  const extra = raw.extraRules
  if (extra !== undefined) {
    if (!Array.isArray(extra)) usage(2, `${path}: "extraRules" 必须是数组`)
    for (const rule of extra) {
      if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
        usage(2, `${path}: "extraRules" 每项必须是 { label, pattern }`)
      }
      const label = rule.label
      const pattern = rule.pattern
      if (typeof label !== 'string' || label.trim() === '' || typeof pattern !== 'string' || pattern === '') {
        usage(2, `${path}: "extraRules" 每项需要非空 label 与 pattern`)
      }
      rules.push([label.trim(), new RegExp(escapeLiteral(pattern), 'iu')])
    }
  }

  return rules
}

const factsPath = findFacts()
const projectRules = factsPath === undefined ? [] : loadFacts(factsPath)
const rules = [...GENERIC, ...projectRules]

console.log(
  factsPath === undefined
    ? `规则：通用 ${GENERIC.length} 条（未找到 project-facts.json，只用通用规则）`
    : `规则：通用 ${GENERIC.length} 条 + 项目 ${projectRules.length} 条（${factsPath}）`,
)

/** Collect every text file under a directory. */
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* walk(path)
    else if (/\.(?:md|ya?ml|txt)$/u.test(entry)) yield path
  }
}

let findings = 0
for (const root of roots) {
  if (!existsSync(root)) usage(2, `要扫描的目录不存在：${root}`)
  for (const path of walk(root)) {
    const lines = readFileSync(path, 'utf8').split('\n')
    lines.forEach((line, index) => {
      // A link to someone else's documentation is not a project fact: strip
      // URLs before looking for hosts and endpoints, or every external
      // reference reads as a violation.
      const scanned = line.replace(/https?:\/\/\S+/gu, '<url>')
      for (const [label, pattern] of rules) {
        if (!pattern.test(scanned)) continue
        findings += 1
        console.log(`${path}:${index + 1}  [${label}]  ${line.trim().slice(0, 90)}`)
      }
    })
  }
}

if (findings === 0) console.log('技能体检通过：没有项目内容混进能力文件')
else console.log(`\n共 ${findings} 处需要分离：把事实移进项目仓的 specs/，技能里只留索引指针`)
process.exit(findings === 0 ? 0 : 1)
