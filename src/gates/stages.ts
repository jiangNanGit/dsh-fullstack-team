/**
 * The five stage gates.
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
 * @module dsh-devflow/gates/stages
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  checkArtifactBasics,
  checkCoverage,
  checkEvidence,
  checkOrphans,
  countVerdicts,
  extractIds,
  FP_PATTERN,
  readArtifact,
  resolveRoot,
  type Artifact,
} from './artifact'
import { finding, type Finding, type GateResult, type GatedStage } from './types'

/** Conventional artifact names; a project may rename them in the config. */
export const DEFAULT_FILES = {
  requirement: 'requirement.md',
  assessment: 'assessment.md',
  design: 'design.md',
  contract: 'api-contract.md',
  testcases: 'test-cases.md',
  review: 'review-notes.md',
  acceptance: 'acceptance-report.md',
} as const

/** One artifact name the gates read. */
export type ArtifactKey = keyof typeof DEFAULT_FILES

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
  /** Section titles the acceptance report must contain. */
  acceptanceSections?: string[]
  /** Minimum verdict tokens a review document must carry. */
  reviewMinVerdicts?: number
}

/** Configuration file read from the gate root. */
export const CONFIG_FILE = 'devflow.config.json'

/**
 * Load `devflow.config.json` from the gate root when present.
 *
 * @param root - Absolute gate root.
 * @returns The declared configuration, or an empty one.
 * @throws When the file exists but is not a JSON object.
 */
export function loadGateConfig(root: string): GateConfig {
  const path = join(root, CONFIG_FILE)
  if (!existsSync(path)) return {}
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`dsh-devflow: ${CONFIG_FILE} must contain a JSON object`)
  }
  return parsed as GateConfig
}

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

/** A method plus an absolute path, or just a path. */
const ENDPOINT_SPAN = /^(?:(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+)?(\/[\w\-./{}:]+)$/u

/**
 * Extract the endpoints a document mentions.
 *
 * Endpoints show up in two shapes in practice: inline code (`` `POST /x` ``) in a
 * design, and headings (`### POST /x`) in a contract. Both are read here, and
 * the method is kept when present so `DELETE /orders` is not mistaken for
 * `POST /orders`.
 */
export function endpoints(text: string): Endpoint[] {
  const found = new Map<string, Endpoint>()
  const add = (raw: string): void => {
    const match = ENDPOINT_SPAN.exec(raw.trim())
    const path = match?.[2]
    if (path === undefined) return
    const method = match?.[1]
    const key = `${method ?? ''} ${path}`
    if (found.has(key)) return
    found.set(key, method === undefined ? { path } : { path, method })
  }
  for (const match of text.matchAll(/`([^`\n]+)`/gu)) add(match[1] ?? '')
  for (const line of text.split(/\r?\n/u)) {
    const heading = /^#{1,6}\s+(.+?)\s*$/u.exec(line)
    if (heading?.[1] !== undefined) add(heading[1])
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

/**
 * Whether a line reports a P0 that is still open.
 *
 * A count of zero is closed, not open: `P0 遗留：0` must not block a release.
 */
export function reportsOpenP0(line: string): boolean {
  if (!/\bP0\b/u.test(line)) return false
  if (!/(open|unfixed|未修复|待修复|遗留)/iu.test(line)) return false
  const numbers = [...line.matchAll(/\d+/gu)].map((match) => Number(match[0]))
  if (numbers.length === 0) return true
  return numbers.some((value) => value > 0)
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

/** Gate 3 — test cases: every functional point is covered, and nothing extra. */
function testGate(root: string, config: GateConfig): GateResult {
  const findings: Finding[] = []
  const checked: string[] = []
  const requirement = read(root, config, 'requirement', [], findings)
  const testcases = read(root, config, 'testcases', config.testCaseSections ?? [], findings)
  if (requirement !== undefined) checked.push(requirement.path)
  if (testcases !== undefined) checked.push(testcases.path)

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

/** Gate 4 — acceptance: every functional point carries a verdict and no P0 is open. */
function acceptGate(root: string, config: GateConfig): GateResult {
  const findings: Finding[] = []
  const checked: string[] = []
  const requirement = read(root, config, 'requirement', [], findings)
  const acceptance = read(root, config, 'acceptance', config.acceptanceSections ?? [], findings)
  if (requirement !== undefined) checked.push(requirement.path)
  if (acceptance !== undefined) checked.push(acceptance.path)

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
  findings.push(...checkEvidence(root, review))

  return { stage: 'review', pass: !findings.some((item) => item.severity === 'error'), findings, checked }
}

/**
 * Run the gate for `stage`.
 *
 * `review` is a fifth check that shares the acceptance stage's blocking rule;
 * call it through {@link runReview} so the two do not collide.
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
      return acceptGate(absolute, resolved)
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
