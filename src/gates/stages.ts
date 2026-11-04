/**
 * The stage gates.
 *
 * Each gate is a pure read: it reports whether the artifacts of one stage are
 * fit to be consumed by the next one. What to do about a failure — rework,
 * re-plan, escalate — is the main agent's call, so a gate result is evidence,
 * not a decision.
 *
 * Project structure is configuration (`devflow.config.json` in the gate root),
 * never code: the same gate runs on any repository, and the artifact section
 * lists live with the project they describe.
 *
 * @module dsh-fullstack-team/gates/stages
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  checkArtifactBasics,
  checkCoverage,
  checkEvidence,
  checkOrphans,
  countVerdicts,
  evidenceRefs,
  extractIds,
  fpWindows,
  hasVerdict,
  FP_PATTERN,
  loadGateConfig,
  readArtifact,
  reportsOpenP0,
  resolveRoot,
  window,
  CONFIG_FILE,
  type Artifact,
  type GateConfig,
} from './artifact'
import { finding, type Finding, type GateResult, type GatedStage } from './types'

export { CONFIG_FILE, loadGateConfig, reportsOpenP0 }
export type { GateConfig }

/** Conventional artifact names; a project may rename them in the config. */
export const DEFAULT_FILES = {
  requirement: 'requirement.md',
  assessment: 'assessment.md',
  design: 'design.md',
  contract: 'api-contract.md',
  testcases: 'test-cases.md',
  testreport: 'test-report.md',
  review: 'review-notes.md',
  acceptance: 'acceptance-report.md',
  uiacceptance: 'ui-acceptance.md',
} as const

/** One artifact name the gates read. */
export type ArtifactKey = keyof typeof DEFAULT_FILES

/** Resolve one artifact name, honouring the project override. */
function fileName(config: GateConfig, key: ArtifactKey): string {
  return config.files?.[key] ?? DEFAULT_FILES[key]
}

/**
 * Read an artifact and merge its basic findings into `findings`.
 *
 * An optional artifact that is simply absent is not a finding; when it exists it
 * must satisfy the same invariants as a required one.
 */
function read(
  root: string,
  config: GateConfig,
  key: ArtifactKey,
  sections: readonly string[],
  findings: Finding[],
  optional = false,
): Artifact | undefined {
  if (optional && !existsSync(join(root, fileName(config, key)))) return undefined
  const artifact = readArtifact(root, fileName(config, key), findings)
  if (artifact === undefined) return undefined
  findings.push(...checkArtifactBasics(artifact, sections))
  return artifact
}

/** One endpoint mentioned by a design or a contract. */
export interface Endpoint {
  /** Path, e.g. `/api/orders`. */
  path: string
  /** HTTP method, when the document states one. */
  method?: string
}

/** Methods a table cell may name on its own. */
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

/**
 * Characters that disqualify a candidate outright.
 *
 * Prose (`/must be absolute/`), placeholders (`/orders/<id>`), wildcards
 * (`/api/*`), and regex literals (`/^\/v1$/`) all start with a slash and end in
 * something that no real route contains. A real route is a slash-led run of
 * path characters: whitespace, angle brackets, the glob star, the regex
 * anchors, and the escape backslash are never part of one.
 */
const NOT_A_PATH = /[\s<>*^$\\]/u

/** Strip the Markdown shells a document puts around an endpoint. */
function unwrap(raw: string): string {
  return raw.replace(/\*\*/gu, '').replace(/`/gu, '').trim()
}

/**
 * Parse one endpoint mention.
 *
 * The path is normalised before comparison: the query string, the fragment, and
 * a trailing slash are presentation, not identity. A mention without a leading
 * slash is not an endpoint at all — a command, a field name, or a file path is
 * not a route.
 *
 * @param raw - One candidate, already isolated (inline code span, heading, cell).
 * @returns The endpoint, or `undefined` when the text is not one.
 */
export function parseEndpoint(raw: string): Endpoint | undefined {
  const text = unwrap(raw)
  if (text.length === 0) return undefined

  let method: string | undefined
  let rest = text
  const withMethod = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)$/iu.exec(text)
  if (withMethod?.[1] !== undefined && withMethod[2] !== undefined) {
    method = withMethod[1].toUpperCase()
    rest = withMethod[2]
  }

  let path = rest.split('?')[0]?.split('#')[0] ?? ''
  if (path.length > 1) path = path.replace(/\/+$/u, '')
  // Re-check after normalisation: `?q=/x` must not turn a word into a route.
  if (!path.startsWith('/') || path === '/') return undefined
  // A bare `/` is the filesystem root or a prose flourish, not a route; the
  // same goes for prose and regex literals, which contain whitespace.
  if (NOT_A_PATH.test(path)) return undefined
  return method === undefined ? { path } : { path, method }
}

/** Split a Markdown table row into trimmed cells, honouring `\|`. */
function tableCells(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return []
  const parts = trimmed.split(/(?<!\\)\|/u)
  // A leading and a trailing pipe produce empty strings at both ends.
  if (parts[0]?.trim() === '') parts.shift()
  if (parts[parts.length - 1]?.trim() === '') parts.pop()
  return parts.map((cell) => unwrap(cell))
}

/**
 * Extract the endpoints a document mentions.
 *
 * Three sources, because those are the three shapes that occur in practice:
 * inline code (`` `POST /x` ``) in a design, headings (`### POST /x`) in a
 * contract, and Markdown table rows (`| POST | /x |`). Fenced code blocks are
 * skipped for the table source only: an example table is documentation of a
 * document, not the contract itself.
 */
export function endpoints(text: string): Endpoint[] {
  const found = new Map<string, Endpoint>()
  const add = (candidate: Endpoint | undefined): void => {
    if (candidate === undefined) return
    const key = `${candidate.method ?? ''} ${candidate.path}`
    if (found.has(key)) return
    found.set(key, candidate)
  }

  let fenced = false
  for (const line of text.split(/\r?\n/u)) {
    if (/^\s*(?:```|~~~)/u.test(line)) {
      fenced = !fenced
      continue
    }

    const cells = tableCells(line)
    if (cells.length > 0 && !fenced) {
      // Pair a method cell with the path cell next to it first, so the path
      // cell does not also register as a method-less endpoint.
      const consumed = new Set<number>()
      for (const [index, cell] of cells.entries()) {
        const upper = cell.toUpperCase()
        if (!(METHODS as readonly string[]).includes(upper)) continue
        const pathCell = cells[index + 1]
        if (pathCell === undefined) continue
        const parsed = parseEndpoint(pathCell)
        if (parsed === undefined || parsed.method !== undefined) continue
        add({ path: parsed.path, method: upper })
        consumed.add(index)
        consumed.add(index + 1)
      }
      for (const [index, cell] of cells.entries()) {
        if (consumed.has(index)) continue
        add(parseEndpoint(cell))
      }
      continue
    }

    // Inline code and headings are scanned inside fenced blocks too: only the
    // table source is skipped there, because an example table is documentation.
    for (const match of line.matchAll(/`([^`\n]+)`/gu)) add(parseEndpoint(match[1] ?? ''))
    const heading = /^#{1,6}\s+(.+?)\s*$/u.exec(line)
    if (heading?.[1] !== undefined) add(parseEndpoint(heading[1]))
  }

  return [...found.values()]
}

/** Whether two endpoint mentions can be the same endpoint. */
function sameEndpoint(left: Endpoint, right: Endpoint): boolean {
  if (left.path !== right.path) return false
  if (left.method === undefined || right.method === undefined) return true
  return left.method === right.method
}

/** Endpoints in `source` that `target` never mentions. */
export function unmatchedEndpoints(source: readonly Endpoint[], target: readonly Endpoint[]): Endpoint[] {
  return source.filter((endpoint) => !target.some((other) => sameEndpoint(endpoint, other)))
}

/** Render an endpoint for a finding message. */
function endpointLabel(endpoint: Endpoint): string {
  return endpoint.method === undefined ? endpoint.path : `${endpoint.method} ${endpoint.path}`
}

/** Gate 1 — requirement freeze: the brief exists and still has open questions. */
function clarifyGate(root: string, config: GateConfig): GateResult {
  const findings: Finding[] = []
  const checked: string[] = []
  const requirement = read(root, config, 'requirement', config.requirementSections ?? [], findings)
  if (requirement !== undefined) {
    checked.push(requirement.path)
    if (extractIds(requirement.text, FP_PATTERN).length === 0) {
      findings.push(
        finding('FP_MISSING', `${requirement.path} declares no functional point (FP-n)`, { path: requirement.path }),
      )
    }
  }
  // The assessment is optional; when present it must be finished too.
  const assessment = read(root, config, 'assessment', [], findings, true)
  if (assessment !== undefined) checked.push(assessment.path)
  return { stage: 'clarify', pass: !findings.some((item) => item.severity === 'error'), findings, checked }
}

/** Gate 2 — design review: the design and the contract agree on endpoints. */
function designGate(root: string, config: GateConfig): GateResult {
  const findings: Finding[] = []
  const checked: string[] = []
  const design = read(root, config, 'design', config.designSections ?? [], findings)
  const contract = read(root, config, 'contract', [], findings)
  if (design !== undefined) checked.push(design.path)
  if (contract !== undefined) checked.push(contract.path)

  if (design !== undefined && contract !== undefined) {
    const designed = endpoints(design.text)
    const contracted = endpoints(contract.text)
    for (const missing of unmatchedEndpoints(designed, contracted)) {
      findings.push(
        finding('CONTRACT_MISSING', `${endpointLabel(missing)} is designed but absent from ${contract.path}`, {
          path: contract.path,
        }),
      )
    }
    for (const extra of unmatchedEndpoints(contracted, designed)) {
      findings.push(
        finding('CONTRACT_UNDESIGNED', `${endpointLabel(extra)} is in ${contract.path} but absent from ${design.path}`, {
          path: design.path,
        }),
      )
    }
  }

  return { stage: 'design', pass: !findings.some((item) => item.severity === 'error'), findings, checked }
}

/**
 * Gate 3 — test cases and the execution report: every functional point is
 * covered by a case, and the run was actually reported.
 *
 * The report is only checked for existence and substance; per-functional-point
 * evidence belongs to the acceptance gate, and checking it twice would block
 * the same defect twice.
 */
function testGate(root: string, config: GateConfig): GateResult {
  const findings: Finding[] = []
  const checked: string[] = []
  const requirement = read(root, config, 'requirement', [], findings)
  const testcases = read(root, config, 'testcases', config.testCaseSections ?? [], findings)
  const report = read(root, config, 'testreport', config.testReportSections ?? [], findings)
  if (requirement !== undefined) checked.push(requirement.path)
  if (testcases !== undefined) checked.push(testcases.path)
  if (report !== undefined) checked.push(report.path)

  if (requirement !== undefined && testcases !== undefined) {
    const declared = extractIds(requirement.text, FP_PATTERN)
    const covered = extractIds(testcases.text, FP_PATTERN)
    findings.push(...checkCoverage(requirement, testcases, declared))
    findings.push(...checkOrphans(requirement, testcases, covered))
    if (covered.length === 0) {
      findings.push(finding('TEST_CASE_EMPTY', `${testcases.path} names no functional point`, { path: testcases.path }))
    }
  }

  return { stage: 'test', pass: !findings.some((item) => item.severity === 'error'), findings, checked }
}

/** Gate 4 — acceptance: every functional point carries a verdict with evidence, no P0 is open. */
function acceptGate(root: string, config: GateConfig): GateResult {
  const findings: Finding[] = []
  const checked: string[] = []
  const requirement = read(root, config, 'requirement', [], findings)
  const acceptance = read(root, config, 'acceptance', config.acceptanceSections ?? [], findings)
  if (requirement !== undefined) checked.push(requirement.path)
  if (acceptance !== undefined) checked.push(acceptance.path)

  // Whether the UI artifact applies is a configuration fact. A report that says
  // «不适用» cannot waive itself; only the project configuration can, and it
  // must say why, or the waiver is just a way to skip the artifact.
  if (config.ui?.applicable ?? true) {
    const ui = read(root, config, 'uiacceptance', config.uiAcceptanceSections ?? [], findings)
    if (ui !== undefined) {
      checked.push(ui.path)
      findings.push(...checkEvidence(root, ui))
    }
  } else {
    const reason = config.ui?.reason?.trim() ?? ''
    if (reason.length === 0) {
      findings.push(
        finding(
          'UI_WAIVER_NO_REASON',
          `${CONFIG_FILE} sets ui.applicable=false without a ui.reason; a waiver must say why no UI artifact exists`,
          { path: CONFIG_FILE },
        ),
      )
    } else {
      findings.push(
        finding(
          'UI_ACCEPTANCE_WAIVED',
          `ui-acceptance.md is waived by ${CONFIG_FILE}: ${reason}`,
          { severity: 'warning', path: CONFIG_FILE },
        ),
      )
    }
  }

  if (acceptance !== undefined) findings.push(...checkEvidence(root, acceptance))

  if (requirement !== undefined && acceptance !== undefined) {
    const declared = extractIds(requirement.text, FP_PATTERN)
    findings.push(...checkCoverage(requirement, acceptance, declared))

    const verdicts = countVerdicts(acceptance.text)
    if (verdicts < declared.length) {
      findings.push(
        finding(
          'VERDICT_SHORTFALL',
          `${acceptance.path} has ${verdicts} verdicts for ${declared.length} functional points`,
          { path: acceptance.path },
        ),
      )
    }

    for (const id of declared) {
      const windows = fpWindows(acceptance, id)
      if (windows.length === 0) continue
      const first = windows[0]
      if (first === undefined) continue
      const verdictWindow = windows.find((item) => hasVerdict(item.text))
      if (verdictWindow === undefined) {
        findings.push(
          finding('VERDICT_MISSING', `${acceptance.path}: no verdict for ${id}`, {
            path: acceptance.path,
            line: first.line,
          }),
        )
        continue
      }
      // Evidence and verdict must share a window: a citation next to another
      // item cannot vouch for this one.
      const satisfied = windows.some((item) => hasVerdict(item.text) && evidenceRefs(item.text).length > 0)
      if (!satisfied) {
        findings.push(
          finding('ACCEPT_EVIDENCE_MISSING', `${acceptance.path}: no path:line evidence for ${id}`, {
            path: acceptance.path,
            line: first.line,
          }),
        )
      }
    }
  }

  if (acceptance !== undefined) {
    for (const [index, line] of acceptance.lines.entries()) {
      if (!reportsOpenP0(line)) continue
      findings.push(
        finding('P0_OPEN', `${acceptance.path}:${index + 1} leaves a P0 open`, {
          path: acceptance.path,
          line: index + 1,
        }),
      )
    }
  }

  return { stage: 'accept', pass: !findings.some((item) => item.severity === 'error'), findings, checked }
}

/** The verdict of the review check, which is not one of the stage gates. */
export interface ReviewResult extends Omit<GateResult, 'stage'> {
  stage: 'review'
}

/** Gate 5 — review: the checklist was actually executed, with real evidence. */
function reviewGate(root: string, config: GateConfig): ReviewResult {
  const findings: Finding[] = []
  const checked: string[] = []
  const minimum = config.reviewMinVerdicts ?? 30
  const review = read(root, config, 'review', [], findings)
  if (review === undefined) {
    return { stage: 'review', pass: false, findings, checked }
  }
  checked.push(review.path)

  const verdicts = countVerdicts(review.text)
  if (verdicts < minimum) {
    findings.push(
      finding('REVIEW_ITEM_NO_VERDICT', `${review.path} has ${verdicts} verdicts, fewer than the required ${minimum}`, {
        path: review.path,
      }),
    )
  }
  // Every line that states a verdict must carry evidence in its own window: a
  // checklist of thirty «通过» lines is not a review.
  for (const [index, line] of review.lines.entries()) {
    if (!hasVerdict(line)) continue
    if (evidenceRefs(window(review, index).text).length > 0) continue
    findings.push(
      finding('REVIEW_EVIDENCE_MISSING', `${review.path}:${index + 1} states a verdict without evidence`, {
        path: review.path,
        line: index + 1,
      }),
    )
  }
  findings.push(...checkEvidence(root, review))

  return { stage: 'review', pass: !findings.some((item) => item.severity === 'error'), findings, checked }
}

/**
 * The acceptance stage as a composite gate: the acceptance check plus the
 * review check, with the acceptance findings first.
 *
 * The stage name stays `accept`: review has no place in the state machine, so
 * it cannot be skipped by not running a separate stage.
 */
function acceptStage(root: string, config: GateConfig): GateResult {
  const acceptance = acceptGate(root, config)
  const review = reviewGate(root, config)
  const findings = [...acceptance.findings, ...review.findings]
  const checked = [...new Set([...acceptance.checked, ...review.checked])]
  return { stage: 'accept', pass: !findings.some((item) => item.severity === 'error'), findings, checked }
}

/**
 * Run the gate for `stage`.
 *
 * `review` is a fifth check that shares the acceptance stage's blocking rule;
 * call it through {@link runReview} when it runs on its own.
 *
 * @param stage - Stage to judge.
 * @param root - Absolute gate root.
 * @param config - Project configuration; loaded from the root when omitted.
 * @returns The gate verdict.
 */
export function runGate(stage: GatedStage, root: string, config?: GateConfig): GateResult {
  const absolute = resolveRoot(root)
  const resolved = config ?? loadGateConfig(absolute)
  switch (stage) {
    case 'clarify':
      return clarifyGate(absolute, resolved)
    case 'design':
      return designGate(absolute, resolved)
    case 'test':
      return testGate(absolute, resolved)
    case 'accept':
      return acceptStage(absolute, resolved)
  }
}

/**
 * Run the review gate — the checklist execution check.
 *
 * @param root - Absolute gate root.
 * @param config - Project configuration; loaded from the root when omitted.
 * @returns The gate verdict, tagged with the `review` stage name.
 */
export function runReview(root: string, config?: GateConfig): ReviewResult {
  const absolute = resolveRoot(root)
  return reviewGate(absolute, config ?? loadGateConfig(absolute))
}
