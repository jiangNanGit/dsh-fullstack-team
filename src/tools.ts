/**
 * The two tools the flow exposes to a session.
 *
 * `devflow_gate` answers "is this stage's artifact fit to be consumed by the
 * next one?" and `devflow_state` answers "where am I, and does the flow allow me
 * to move?". Both are deterministic: they read files and a state file, and they
 * return findings. Neither decides what to do about a failure.
 *
 * @module dsh-devflow/tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { runGate, runReview } from './gates/stages'
import type { Finding, Severity } from './gates/types'
import {
  advance,
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
      'Judge whether one flow stage’s artifacts are fit to be consumed by the next stage, and report typed findings. Reads files under `root` only; never writes. `clarify` checks the requirement freeze (functional points declared, no placeholders, no empty sections). `design` checks the design and its API contract agree on every endpoint. `test` checks test cases cover every declared functional point and add none. `accept` checks the acceptance report verdicts every functional point and leaves no P0 open. `review` checks the review checklist was executed: enough verdicts, and every cited file:line exists.',
    parameters: {
      stage: {
        type: 'string',
        required: true,
        enum: [...GATE_NAMES],
        description: 'Stage to judge.',
      },
      root: {
        type: 'string',
        required: true,
        description: 'Absolute path of the requirement directory that holds the artifacts.',
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
      'Read or move the durable flow state for one requirement directory. `read` reports the current stage and rework counters. `advance` re-runs the current stage’s gate and only moves when it passes — a failing gate leaves the stage unchanged and returns its findings. `rework` records one rework against a typed failure and reports the remaining budget; when the budget is exhausted the flow must escalate to the user instead of retrying. `reset` returns the flow to the first stage.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['read', 'advance', 'rework', 'reset'],
        description: 'What to do with the state.',
      },
      root: {
        type: 'string',
        required: true,
        description: 'Absolute path of the requirement directory that holds the artifacts.',
      },
      failure: {
        type: 'string',
        enum: [...FAILURE_TYPES],
        description: 'Failure type, required for `rework`.',
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
          const { state: current } = readState(args.root)
          const spent = FAILURE_TYPES.filter((type) => current.rework[type] > 0).map(
            (type) => `${type}=${current.rework[type]}/${FAILURE_BUDGETS[type]}`,
          )
          return Promise.resolve({
            stage: current.stage,
            advanced: false,
            pass: true,
            message:
              spent.length === 0
                ? `stage ${current.stage}; no rework recorded`
                : `stage ${current.stage}; ${spent.join(', ')}`,
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
