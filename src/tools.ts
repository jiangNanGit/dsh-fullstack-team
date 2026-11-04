/**
 * The two tools the flow exposes to a session.
 *
 * `devflow_gate` answers "is this stage's artifact fit to be consumed by the
 * next one?" and `devflow_state` answers "where am I, and does the flow allow me
 * to move?". Both are deterministic: they read files and a state file, and they
 * return findings. Neither decides what to do about a failure.
 *
 * @module dsh-fullstack-team/tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { runGate, runReview } from './gates/stages'
import type { Finding, Severity } from './gates/types'
import {
  advance,
  exhaustedFailures,
  FAILURE_BUDGETS,
  FAILURE_TYPES,
  readState,
  reset,
  rework,
  type FailureType,
  type StateOutcome,
} from './state'

/** One finding as it reaches the model. */
interface WireFinding {
  code: string
  severity: Severity
  detail: string
  path?: string
  line?: number
}

/** One state outcome as it reaches the model. */
interface WireOutcome {
  stage: string
  advanced: boolean
  pass: boolean
  message: string
  findings: WireFinding[]
  rework?: { type: string; count: number; budget: number; exhausted: boolean }
}

/** The finding shape shared by both tools' output. */
const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', required: true, description: 'Stable machine code, e.g. FP_UNCOVERED.' },
    severity: { type: 'string', required: true, enum: ['error', 'warning'], description: 'Whether it blocks the stage.' },
    detail: { type: 'string', required: true, description: 'One actionable line.' },
    path: { type: 'string', description: 'Artifact the finding belongs to.' },
    line: { type: 'integer', description: '1-based line, when the finding is line-specific.' },
  },
} as const

/** Gate names accepted by `devflow_gate`. */
const GATE_NAMES = ['clarify', 'design', 'test', 'accept', 'review'] as const

/**
 * Per-value criteria for `devflow_gate`'s `stage` parameter.
 *
 * The rules live on the parameter, not in the tool description: a value the
 * model cannot judge is a value it will guess at.
 */
const STAGE_DOC = [
  'Which gate to run. Each value names what it reads and what fails it.',
  'clarify — reads `requirement.md` (and `assessment.md` when present); fails when an artifact is missing, is not a file, or is empty, when a `TODO`/`待补`-class placeholder survives, when a declared section has no body, or when no `FP-n` is declared.',
  'design — reads `design.md` and `api-contract.md`; fails when either artifact is missing, empty, or still drafts (placeholder or empty section), or when an endpoint appears in one and not the other (method-aware: `DELETE /orders` is not `POST /orders`).',
  'test — reads `requirement.md`, `test-cases.md`, and `test-report.md`; fails when a declared `FP-n` has no test case, when a case names an `FP-n` the requirement never declared, when the case document names no functional point at all, or when the execution report is missing, empty, still a draft, or lacks a configured required section.',
  'accept — a composite gate: the acceptance check plus the review check, both reported under `accept`. Reads `requirement.md`, `acceptance-report.md`, `ui-acceptance.md` (unless the project config waives it with a reason), and `review-notes.md`. Fails when a declared `FP-n` has no verdict or no `path:line` evidence in the same window, when the verdict count is below the number of functional points, when a `P0` count is still above zero, when the UI artifact is missing and not properly waived, and when the review check fails.',
  'review — reads `review-notes.md`; fails when the file is missing, when it carries fewer than `reviewMinVerdicts` (default 30) verdicts, when a verdict line has no `path:line` evidence in its own window, or when a cited `file:line` does not resolve inside `root` (a reference that leaves `root` is rejected without being read).',
].join('\n')

/** Per-value semantics for `devflow_state`'s `action` parameter. */
const ACTION_DOC = [
  'What to do with the state. Each value names what it changes and what it returns.',
  'read — reports the current stage and the rework counters already spent in this stage; never moves the flow. A corrupt state file is an error, not a silent reset.',
  'advance — re-runs the current stage’s gate and moves to the next stage only when it passes; on failure the stage is unchanged and the gate’s findings come back with `pass: false`. When this stage’s rework budget is exhausted, `advance` is refused even if the gate passes (`REWORK_BUDGET_EXHAUSTED`): report to the user, or `reset` and redo the stage.',
  'rework — records one rework against the `failure` type and reports `count`, `budget`, and `exhausted`; counters are per stage and are cleared when the flow enters a new stage. Once exhausted the flow must escalate to the user instead of retrying. Requires `failure`.',
  'reset — returns the flow to `clarify` and clears every rework counter plus the transition history; for a replaced requirement, not a way past a failing gate.',
].join('\n')

/** Per-value criteria for `devflow_state`'s `failure` parameter. */
const FAILURE_DOC = [
  'Failure type, required by `rework`. Each value names the edge that failed; the number is that type’s rework budget before the flow must escalate.',
  `DESIGN_UNFEASIBLE (${FAILURE_BUDGETS.DESIGN_UNFEASIBLE}) — a developer reports the frozen design cannot be implemented as written.`,
  `CONTRACT_GAP (${FAILURE_BUDGETS.CONTRACT_GAP}) — the frozen contract is missing an endpoint or a field the implementation needs.`,
  `CONTRACT_CONFLICT (${FAILURE_BUDGETS.CONTRACT_CONFLICT}) — the two sides read one contract differently: same endpoint, disagreeing request or response.`,
  `IMPL_MISMATCH (${FAILURE_BUDGETS.IMPL_MISMATCH}) — the code does not match the frozen list: an item missing, an item extra, or an item built to a different contract.`,
  `TEST_FAIL (${FAILURE_BUDGETS.TEST_FAIL}) — an end-to-end case (frontend → backend → database) fails against the frozen acceptance criteria.`,
  `ACCEPT_P0 (${FAILURE_BUDGETS.ACCEPT_P0}) — acceptance carries a blocking finding, i.e. a \`P0\` is still open.`,
].join('\n')

/** Project one finding for the tool payload. */
function wireFinding(item: Finding): WireFinding {
  return {
    code: item.code,
    severity: item.severity,
    detail: item.detail,
    ...(item.path === undefined ? {} : { path: item.path }),
    ...(item.line === undefined ? {} : { line: item.line }),
  }
}

/** Project a state outcome for the tool payload. */
function wireOutcome(outcome: StateOutcome): WireOutcome {
  return {
    stage: outcome.stage,
    advanced: outcome.advanced,
    pass: outcome.pass,
    message: outcome.message,
    findings: outcome.findings.map(wireFinding),
    ...(outcome.rework === undefined
      ? {}
      : {
          rework: {
            type: outcome.rework.type,
            count: outcome.rework.count,
            budget: outcome.rework.budget,
            exhausted: outcome.rework.exhausted,
          },
        }),
  }
}

/** Render a gate verdict as one text block. */
function renderGate(stage: string, pass: boolean, findings: WireFinding[]): string {
  const errors = findings.filter((item) => item.severity === 'error')
  const head = pass ? `gate "${stage}" passed` : `gate "${stage}" failed with ${errors.length} error(s)`
  if (findings.length === 0) return head
  const lines = findings.slice(0, 20).map((item) => `- [${item.code}] ${item.detail}`)
  const more = findings.length > 20 ? `\n…and ${findings.length - 20} more` : ''
  return `${head}\n${lines.join('\n')}${more}`
}

/**
 * Build the two tool definitions.
 *
 * @returns The definitions, ready for `ctx.tools.register`.
 */
export function flowTools() {
  const gate = defineTool({
    name: 'devflow_gate',
    description:
      'Judge whether one flow stage’s artifacts are fit to be consumed by the next stage, and report typed findings. Reads files under `root` only; never writes. Which artifacts a stage reads, and what fails it, is stated on the `stage` parameter.',
    parameters: {
      stage: {
        type: 'string',
        required: true,
        enum: [...GATE_NAMES],
        description: STAGE_DOC,
      },
      root: {
        type: 'string',
        required: true,
        description:
          'Absolute path of the requirement directory that holds the artifacts. It must be absolute: a relative path is rejected, and files outside it are never read.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stage: { type: 'string', required: true },
          pass: { type: 'boolean', required: true },
          findings: { type: 'array', required: true, items: FINDING_SCHEMA },
          checked: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args: unknown, value: { stage: string; pass: boolean; findings: WireFinding[] }) => [
        { type: 'text' as const, text: renderGate(value.stage, value.pass, value.findings) },
      ],
    },
    execute(args: { stage: (typeof GATE_NAMES)[number]; root: string }) {
      const result = args.stage === 'review' ? runReview(args.root) : runGate(args.stage, args.root)
      return Promise.resolve({
        stage: args.stage,
        pass: result.pass,
        findings: result.findings.map(wireFinding),
        checked: result.checked,
      })
    },
  })

  const state = defineTool({
    name: 'devflow_state',
    description:
      'Read or move the durable flow state for one requirement directory. The state lives at `<root>/.dsh/devflow/state.json`, so a restart or a new session cannot lose it; a move is only ever granted by a passing gate. Each action’s effect is stated on the `action` parameter.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['read', 'advance', 'rework', 'reset'],
        description: ACTION_DOC,
      },
      root: {
        type: 'string',
        required: true,
        description:
          'Absolute path of the requirement directory that holds the artifacts. It must be absolute: a relative path is rejected, and files outside it are never read.',
      },
      failure: {
        type: 'string',
        enum: [...FAILURE_TYPES],
        description: FAILURE_DOC,
      },
      note: {
        type: 'string',
        description: 'Optional note recorded with the transition.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stage: { type: 'string', required: true },
          advanced: { type: 'boolean', required: true },
          pass: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          findings: { type: 'array', required: true, items: FINDING_SCHEMA },
          rework: {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: { type: 'string', required: true },
              count: { type: 'integer', required: true },
              budget: { type: 'integer', required: true },
              exhausted: { type: 'boolean', required: true },
            },
          },
        },
      },
      render: (_args: unknown, value: WireOutcome) => [
        {
          type: 'text' as const,
          text: value.findings.length === 0 ? value.message : renderGate(value.stage, value.pass, value.findings),
        },
      ],
    },
    execute(args: {
      action: 'read' | 'advance' | 'rework' | 'reset'
      root: string
      failure?: FailureType
      note?: string
    }) {
      switch (args.action) {
        case 'read': {
          const { state: current, unknownFailures } = readState(args.root)
          const inStage = current.reworkStage === current.stage
          const spent = inStage
            ? FAILURE_TYPES.filter((type) => current.rework[type] > 0).map(
                (type) => `${type}=${current.rework[type]}/${FAILURE_BUDGETS[type]}`,
              )
            : []
          const exhausted = exhaustedFailures(current)
          const parts = [`stage ${current.stage}`]
          parts.push(spent.length === 0 ? 'no rework recorded in this stage' : spent.join(', '))
          if (exhausted.length > 0) {
            const detail = exhausted.map((item) => `${item.type}=${item.count}/${item.budget}`).join(', ')
            parts.push(`budget exhausted (${detail}) — escalate to the user（需上报）; advance is refused until reset`)
          }
          if (unknownFailures.length > 0) {
            parts.push(`unknown failure type(s) in state, ignored: ${unknownFailures.join(', ')}`)
          }
          return Promise.resolve({
            stage: current.stage,
            advanced: false,
            pass: true,
            message: parts.join('; '),
            findings: [],
          })
        }
        case 'advance':
          return Promise.resolve(wireOutcome(advance(args.root, args.note)))
        case 'rework':
          if (args.failure === undefined) throw new Error('devflow_state: `rework` needs a `failure`')
          return Promise.resolve(wireOutcome(rework(args.root, args.failure, args.note)))
        case 'reset':
          return Promise.resolve(wireOutcome(reset(args.root)))
      }
    },
  })

  return [gate, state] as const
}
