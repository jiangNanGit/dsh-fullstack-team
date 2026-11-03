/**
 * Artifact reading and the text invariants every gate shares.
 *
 * The rules here never mention a project: a placeholder is a placeholder, an
 * empty section is an empty section, and an id is only meaningful because the
 * artifacts cross-reference it. Project-specific structure arrives as
 * configuration, never as code.
 *
 * @module dsh-devflow/gates/artifact
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
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

/**
 * Resolve a gate root to an absolute directory.
 *
 * @param root - Absolute path or a path relative to the process cwd.
 * @returns The absolute path.
 * @throws When the path is not an existing directory.
 */
export function resolveRoot(root: string): string {
  const absolute = resolve(root)
  if (!isAbsolute(absolute)) throw new Error(`dsh-devflow: gate root must be absolute: ${root}`)
  if (!existsSync(absolute)) throw new Error(`dsh-devflow: gate root does not exist: ${absolute}`)
  if (!statSync(absolute).isDirectory()) throw new Error(`dsh-devflow: gate root is not a directory: ${absolute}`)
  return absolute
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
 * it is expected rather than a defect.
 */
export function checkEmptySections(artifact: Artifact): Finding[] {
  return artifact.sections
    .filter((section) => section.level > 1 && section.body.trim().length === 0)
    .map((section) =>
      finding('EMPTY_SECTION', `${artifact.path}: section "${section.title}" has no body`, {
        path: artifact.path,
        line: section.line,
      }),
    )
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

/**
 * Count verdict tokens.
 *
 * A verdict is any of the words a review list uses — `pass`/`fail`/`n/a` or the
 * Chinese equivalents — so the gate works on either language without imposing a
 * table format.
 */
export function countVerdicts(text: string): number {
  return text.match(/\b(?:pass|fail|n\/a)\b|通过|不通过|不适用/giu)?.length ?? 0
}

/**
 * Verify `path:line` evidence references.
 *
 * A review that cites evidence must cite something real; a line beyond the end
 * of the file is as wrong as a missing file.
 */
export function checkEvidence(root: string, artifact: Artifact): Finding[] {
  const findings: Finding[] = []
  for (const [index, line] of artifact.lines.entries()) {
    for (const match of line.matchAll(/([\w./-]+\.[a-zA-Z]{1,5}):(\d+)/gu)) {
      const [, relative, rawLine] = match
      if (relative === undefined || rawLine === undefined) continue
      const absolute = join(root, relative)
      if (!existsSync(absolute)) {
        findings.push(
          finding('EVIDENCE_MISSING', `${artifact.path}:${index + 1} cites missing file ${relative}`, {
            path: artifact.path,
            line: index + 1,
          }),
        )
        continue
      }
      const total = readFileSync(absolute, 'utf8').split(/\r?\n/u).length
      if (Number(rawLine) > total) {
        findings.push(
          finding('EVIDENCE_OUT_OF_RANGE', `${artifact.path}:${index + 1} cites ${relative}:${rawLine}, past line ${total}`, {
            path: artifact.path,
            line: index + 1,
          }),
        )
      }
    }
  }
  return findings
}

/** Run the invariants every artifact must satisfy. */
export function checkArtifactBasics(artifact: Artifact, requiredSections: readonly string[] = []): Finding[] {
  return [
    ...checkPlaceholders(artifact),
    ...checkEmptySections(artifact),
    ...checkRequiredSections(artifact, requiredSections),
  ]
}
