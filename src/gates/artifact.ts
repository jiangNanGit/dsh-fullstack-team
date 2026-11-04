/**
 * Artifact reading and the text invariants every gate shares.
 *
 * The rules here never mention a project: a placeholder is a placeholder, an
 * empty section is an empty section, and an id is only meaningful because the
 * artifacts cross-reference it. Project-specific structure arrives as
 * configuration, never as code.
 *
 * Two rules guard the input side: a gate root must be an absolute directory,
 * and an evidence reference must resolve inside that directory. A gate that
 * reads whatever a document points at is not a gate.
 *
 * @module dsh-fullstack-team/gates/artifact
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import type { ArtifactKey } from './stages'
import { finding, type Finding } from './types'

/** Markers that mean "somebody still has to decide this". */
const PLACEHOLDERS = [
  /\bTODO\b/u,
  /\bTBD\b/u,
  /\bFIXME\b/u,
  /待补/u,
  /待确认/u,
  /待定/u,
  /待填/u,
  /\?\?\?/u,
]

/** A heading and the body that follows it. */
export interface Section {
  /** Heading text without the leading `#`s. */
  title: string
  /** Heading level, 1 for a document title. */
  level: number
  /** 1-based line of the heading. */
  line: number
  /** Trimmed body text, excluding the heading. */
  body: string
}

/** One artifact read from disk. */
export interface Artifact {
  /** Path relative to the gate root, using `/`. */
  path: string
  /** Absolute path. */
  absolute: string
  /** Whole file. */
  text: string
  /** Lines, 1-based when indexed. */
  lines: string[]
  /** Headings with their bodies. */
  sections: Section[]
}

/** Last labels that mark a slash-less token as a hostname, not a cited file. */
const HOST_LABEL = /^(?:com|org|net|io|dev|app|ai|cn|uk|us|jp|de|co|me|info|tech|cloud|site|xyz|top|edu|gov)$/iu

/** One `path:line` evidence reference found in an artifact. */
export interface EvidenceRef {
  /** Path exactly as cited; may be relative or absolute. */
  path: string
  /** 1-based line number. */
  line: number
}

/** A bounded evidence window: a line and the line after it. */
export interface EvidenceWindow {
  /** 1-based line the window starts at. */
  line: number
  /** The line plus its successor, joined with `\n`. */
  text: string
}

/** Per-project gate configuration, read from `devflow.config.json`. */
export interface GateConfig {
  /** File name overrides, relative to the gate root. */
  files?: Partial<Record<ArtifactKey, string>>
  /** Section titles the requirement must contain. */
  requirementSections?: string[]
  /** Section titles the design must contain. */
  designSections?: string[]
  /** Section titles the test-case document must contain. */
  testCaseSections?: string[]
  /** Section titles the execution report must contain. */
  testReportSections?: string[]
  /** Section titles the acceptance report must contain. */
  acceptanceSections?: string[]
  /** Section titles the UI acceptance report must contain, when it applies. */
  uiAcceptanceSections?: string[]
  /** Minimum verdict tokens a review document must carry. */
  reviewMinVerdicts?: number
  /** Whether the acceptance stage needs a UI acceptance artifact. */
  ui?: {
    /** `false` means "no UI in this project"; the waiver must carry a reason. */
    applicable?: boolean
    /** Why the UI artifact is not applicable; required when `applicable` is false. */
    reason?: string
  }
}

/** Configuration file read from the gate root. */
export const CONFIG_FILE = 'devflow.config.json'

/** Keys whose values must be arrays of strings. */
const SECTION_KEYS = [
  'requirementSections',
  'designSections',
  'testCaseSections',
  'testReportSections',
  'acceptanceSections',
  'uiAcceptanceSections',
] as const

/** Whether `value` is a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Build the one error shape every invalid configuration raises. */
function configError(detail: string): Error {
  return new Error(`dsh-fullstack-team: ${CONFIG_FILE} ${detail}`)
}

/**
 * Load `devflow.config.json` from the gate root when present.
 *
 * Known keys are type-checked: a mistyped value is an input error, not a
 * silently ignored setting. Unknown keys stay ignored so a newer project
 * configuration does not break an older plugin.
 *
 * @param root - Absolute gate root.
 * @returns The declared configuration, or an empty one.
 * @throws When the file is not valid JSON, is not an object, or a known key has
 *   the wrong type.
 */
export function loadGateConfig(root: string): GateConfig {
  const path = join(root, CONFIG_FILE)
  if (!existsSync(path)) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw configError(`is not valid JSON (${path}): ${(error as Error).message}`)
  }
  if (!isPlainObject(parsed)) throw configError(`must contain a JSON object (${path})`)

  if (parsed['files'] !== undefined) {
    const files = parsed['files']
    if (!isPlainObject(files)) throw configError(`key "files" must be an object (${path})`)
    for (const [key, value] of Object.entries(files)) {
      if (typeof value !== 'string') throw configError(`key "files.${key}" must be a string (${path})`)
    }
  }
  for (const key of SECTION_KEYS) {
    const value = parsed[key]
    if (value === undefined) continue
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw configError(`key "${key}" must be an array of strings (${path})`)
    }
  }
  if (parsed['reviewMinVerdicts'] !== undefined && !Number.isInteger(parsed['reviewMinVerdicts'])) {
    throw configError(`key "reviewMinVerdicts" must be an integer (${path})`)
  }
  if (parsed['ui'] !== undefined) {
    const ui = parsed['ui']
    if (!isPlainObject(ui)) throw configError(`key "ui" must be an object (${path})`)
    if (ui['applicable'] !== undefined && typeof ui['applicable'] !== 'boolean') {
      throw configError(`key "ui.applicable" must be a boolean (${path})`)
    }
    if (ui['reason'] !== undefined && typeof ui['reason'] !== 'string') {
      throw configError(`key "ui.reason" must be a string (${path})`)
    }
  }

  return parsed as GateConfig
}

/**
 * Resolve a gate root to an absolute directory.
 *
 * The absolute check runs on the value as given: resolving first would make
 * every relative path absolute and turn the check into dead code.
 *
 * @param root - Absolute path of an existing directory.
 * @returns The absolute path.
 * @throws When the path is relative, does not exist, or is not a directory.
 */
export function resolveRoot(root: string): string {
  if (typeof root !== 'string' || !isAbsolute(root)) {
    throw new Error(`dsh-fullstack-team: gate root must be absolute: ${root}`)
  }
  const absolute = resolve(root)
  if (!existsSync(absolute)) throw new Error(`dsh-fullstack-team: gate root does not exist: ${absolute}`)
  if (!statSync(absolute).isDirectory()) throw new Error(`dsh-fullstack-team: gate root is not a directory: ${absolute}`)
  return absolute
}

/**
 * Whether `candidate` is `root` itself or lives underneath it.
 *
 * @param root - Absolute root.
 * @param candidate - Absolute path to test.
 */
function withinRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`)
}

/**
 * Read one artifact, or report why it is missing.
 *
 * @returns The artifact, or `undefined` with a finding appended.
 */
export function readArtifact(root: string, relative: string, findings: Finding[]): Artifact | undefined {
  const absolute = join(root, relative)
  if (!existsSync(absolute)) {
    findings.push(finding('FILE_MISSING', `${relative} does not exist`, { path: relative }))
    return undefined
  }
  if (!statSync(absolute).isFile()) {
    findings.push(finding('FILE_NOT_FILE', `${relative} is not a regular file`, { path: relative }))
    return undefined
  }

  const text = readFileSync(absolute, 'utf8')
  if (text.trim().length === 0) {
    findings.push(finding('FILE_EMPTY', `${relative} is empty`, { path: relative }))
    return undefined
  }

  return { path: relative, absolute, text, lines: text.split(/\r?\n/u), sections: splitSections(text) }
}

/**
 * Split Markdown into heading sections.
 *
 * Only `#`–`####` headings start a section; a document without headings yields
 * a single unnamed section so body-only artifacts still work.
 */
export function splitSections(text: string): Section[] {
  const lines = text.split(/\r?\n/u)
  const sections: Section[] = []
  let current: Section | undefined

  for (const [index, line] of lines.entries()) {
    const heading = /^(#{1,4})\s+(.*\S)\s*$/u.exec(line)
    if (heading?.[2] !== undefined) {
      if (current !== undefined) sections.push(current)
      current = { title: heading[2].trim(), level: heading[1]?.length ?? 1, line: index + 1, body: '' }
      continue
    }
    if (current !== undefined) current.body = current.body.length === 0 ? line.trim() : `${current.body}\n${line.trim()}`
  }
  if (current !== undefined) sections.push(current)
  return sections
}

/** Report `TODO`-class markers, which mean the artifact is still a draft. */
export function checkPlaceholders(artifact: Artifact): Finding[] {
  const findings: Finding[] = []
  for (const [index, line] of artifact.lines.entries()) {
    const marker = PLACEHOLDERS.find((pattern) => pattern.test(line))
    if (marker === undefined) continue
    findings.push(
      finding('PLACEHOLDER', `${artifact.path}:${index + 1} still carries a placeholder`, {
        path: artifact.path,
        line: index + 1,
      }),
    )
  }
  return findings
}

/**
 * Report headings whose body is empty, i.e. a declared section nobody filled.
 *
 * A level-1 heading is a document title, not a section, so an empty body under
 * it is expected rather than a defect. A heading whose only content is a
 * deeper heading is a container (`## 章` followed by `### 节`): it declares
 * structure, so an empty body is its normal shape. The deepest heading — the
 * one that would actually carry prose — is still reported when empty.
 */
export function checkEmptySections(artifact: Artifact): Finding[] {
  const findings: Finding[] = []
  for (const [index, section] of artifact.sections.entries()) {
    if (section.level <= 1 || section.body.trim().length > 0) continue
    const next = artifact.sections[index + 1]
    if (next !== undefined && next.level > section.level) continue
    findings.push(
      finding('EMPTY_SECTION', `${artifact.path}: section "${section.title}" has no body`, {
        path: artifact.path,
        line: section.line,
      }),
    )
  }
  return findings
}

/** Report missing configured sections, matched case-insensitively by substring. */
export function checkRequiredSections(artifact: Artifact, required: readonly string[]): Finding[] {
  const findings: Finding[] = []
  for (const title of required) {
    const needle = title.toLowerCase()
    const present = artifact.sections.some((section) => section.title.toLowerCase().includes(needle))
    if (!present) findings.push(finding('SECTION_MISSING', `${artifact.path} has no "${title}" section`, { path: artifact.path }))
  }
  return findings
}

/** Extract ids matching `pattern`, preserving first-seen order and dropping duplicates. */
export function extractIds(text: string, pattern: RegExp): string[] {
  const seen = new Set<string>()
  for (const match of text.matchAll(pattern)) {
    const id = match[0]
    if (id !== undefined) seen.add(id)
  }
  return [...seen]
}

/** The default functional-point id pattern: `FP-12`, `FP-3a`. */
export const FP_PATTERN = /\bFP-[0-9]+[a-z]?\b/gu

/** Report functional points that a later artifact does not mention. */
export function checkCoverage(source: Artifact, target: Artifact, sourceIds: readonly string[]): Finding[] {
  const findings: Finding[] = []
  const mentioned = new Set(extractIds(target.text, FP_PATTERN))
  for (const id of sourceIds) {
    if (mentioned.has(id)) continue
    findings.push(
      finding('FP_UNCOVERED', `${id} from ${source.path} never appears in ${target.path}`, { path: target.path }),
    )
  }
  return findings
}

/** Report ids in `target` that `source` never declared. */
export function checkOrphans(source: Artifact, target: Artifact, targetIds: readonly string[]): Finding[] {
  const declared = new Set(extractIds(source.text, FP_PATTERN))
  return targetIds
    .filter((id) => !declared.has(id))
    .map((id) => finding('FP_ORPHAN', `${id} in ${target.path} is not declared in ${source.path}`, { path: target.path }))
}

/** Verdict words, shared by counting and by per-line detection. */
const VERDICT = /\b(?:pass|fail|n\/a)\b|通过|不通过|不适用/iu

/**
 * Count verdict tokens.
 *
 * A verdict is any of the words a review list uses — `pass`/`fail`/`n/a` or the
 * Chinese equivalents — so the gate works on either language without imposing a
 * table format.
 */
export function countVerdicts(text: string): number {
  return text.match(new RegExp(VERDICT.source, 'giu'))?.length ?? 0
}

/** Whether one line (or window) carries a verdict token. */
export function hasVerdict(text: string): boolean {
  return VERDICT.test(text)
}

/**
 * The evidence window of line `index`: the line itself plus the next one.
 *
 * Two lines, not «the whole section»: a longer window would let one citation
 * vouch for every verdict around it, which is the same as no evidence at all.
 *
 * @param artifact - Artifact the line belongs to.
 * @param index - Zero-based line index.
 */
export function window(artifact: Artifact, index: number): EvidenceWindow {
  const line = artifact.lines[index] ?? ''
  const next = artifact.lines[index + 1]
  return { line: index + 1, text: next === undefined ? line : `${line}\n${next}` }
}

/** The evidence windows around every mention of `id`. */
export function fpWindows(artifact: Artifact, id: string): EvidenceWindow[] {
  const pattern = new RegExp(`(?<![\\w-])${id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![\\w-])`, 'u')
  const windows: EvidenceWindow[] = []
  for (const [index, line] of artifact.lines.entries()) {
    if (pattern.test(line)) windows.push(window(artifact, index))
  }
  return windows
}

/**
 * Extract `path:line` references from one window of text.
 *
 * A scheme URL or a bare `host:port` is a network address, not a citation, so
 * those are dropped here rather than reported as a missing file.
 */
export function evidenceRefs(text: string): EvidenceRef[] {
  const refs: EvidenceRef[] = []
  for (const match of text.matchAll(/(\/[\w./-]+\.[a-zA-Z]{1,5}|[\w.-]+(?:\/[\w.-]+)*\.[a-zA-Z]{1,5}):(\d+)/gu)) {
    const [, path, rawLine] = match
    if (path === undefined || rawLine === undefined) continue
    // `https://example.com:8080` yields a match starting at the double slash.
    if (path.startsWith('//')) continue
    // `example.com:8080` is a host with a port, not a file at the repository
    // root: a slash-less token whose last label is a top-level domain is a URL.
    const lastLabel = path.split('.').pop() ?? ''
    if (!path.includes('/') && HOST_LABEL.test(lastLabel)) continue
    refs.push({ path, line: Number(rawLine) })
  }
  return refs
}

/**
 * Verify `path:line` evidence references.
 *
 * A review that cites evidence must cite something real, and must cite it
 * inside the requirement directory: resolving outside the root is reported
 * without reading the file at all.
 */
export function checkEvidence(root: string, artifact: Artifact): Finding[] {
  const findings: Finding[] = []
  const absoluteRoot = resolve(root)
  for (const [index, line] of artifact.lines.entries()) {
    for (const ref of evidenceRefs(line)) {
      const cited = resolve(absoluteRoot, ref.path)
      if (!withinRoot(absoluteRoot, cited)) {
        findings.push(
          finding(
            'EVIDENCE_OUTSIDE_ROOT',
            `${artifact.path}:${index + 1} cites ${ref.path}:${ref.line}, which resolves outside the requirement directory`,
            { path: artifact.path, line: index + 1 },
          ),
        )
        continue
      }
      if (!existsSync(cited)) {
        findings.push(
          finding('EVIDENCE_MISSING', `${artifact.path}:${index + 1} cites missing file ${ref.path}`, {
            path: artifact.path,
            line: index + 1,
          }),
        )
        continue
      }
      if (!statSync(cited).isFile()) {
        findings.push(
          finding(
            'EVIDENCE_MISSING',
            `${artifact.path}:${index + 1} cites ${ref.path}, which is not a regular file（不是普通文件）`,
            { path: artifact.path, line: index + 1 },
          ),
        )
        continue
      }
      const total = readFileSync(cited, 'utf8').split(/\r?\n/u).length
      if (ref.line < 1 || ref.line > total) {
        findings.push(
          finding(
            'EVIDENCE_OUT_OF_RANGE',
            `${artifact.path}:${index + 1} cites ${ref.path}:${ref.line}, outside 1..${total}`,
            { path: artifact.path, line: index + 1 },
          ),
        )
      }
    }
  }
  return findings
}

/** Words that mean a P0 is still open. */
const P0_OPEN = /未关闭|未解决|未修复|待修复|待处理|未处理|遗留|剩余|尚有|仍有|open|unfixed|outstanding|remaining|blocking/iu

/** Words that mean a P0 was closed, fixed, or never existed. */
const P0_CLOSED = /已关闭|已解决|已修复|已清零|清零|关闭|解决|修复|无|没有|closed|resolved|fixed|none/iu

/** Any standalone `P0` token, case-insensitive. */
const P0 = /(?<![A-Za-z0-9])p0(?![0-9])/iu

/**
 * Whether a line reports a P0 that is still open.
 *
 * Four steps, in order: (1) no P0 word → not a P0 line; (2) a closing word and
 * no opening word → closed; (3) an opening word → open unless every number is
 * zero, and an opening word with no number is still open; (4) no state word but
 * a positive number right after `P0` → open.
 */
export function reportsOpenP0(line: string): boolean {
  if (!P0.test(line)) return false
  const open = P0_OPEN.test(line)
  const closed = P0_CLOSED.test(line)
  if (closed && !open) return false
  if (open) {
    const numbers = [...line.matchAll(/\d+/gu)].map((match) => Number(match[0]))
    return numbers.length === 0 || numbers.some((value) => value > 0)
  }
  const index = line.search(P0)
  if (index === -1) return false
  const tail = line.slice(index + 2, index + 14)
  return [...tail.matchAll(/\d+/gu)].some((match) => Number(match[0]) > 0)
}

/** Run the invariants every artifact must satisfy. */
export function checkArtifactBasics(artifact: Artifact, requiredSections: readonly string[] = []): Finding[] {
  return [
    ...checkPlaceholders(artifact),
    ...checkEmptySections(artifact),
    ...checkRequiredSections(artifact, requiredSections),
  ]
}
