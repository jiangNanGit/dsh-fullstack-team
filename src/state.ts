/**
 * The durable flow state.
 *
 * The flow used to live in the main agent's head: which step it was on, how many
 * times this edge had been reworked, whether the budget had run out. All three
 * are facts, so they belong on disk where a restart, a compaction, or a fresh
 * session cannot lose them.
 *
 * `advance` re-runs the gate of the current stage before moving on. That is the
 * whole point: a stage with a failing gate cannot be left, no matter what the
 * model believes about its own work.
 *
 * @module dsh-devflow/state
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runGate, type GateConfig } from './gates/stages'
import { isGatedStage, STAGES, type Finding, type Stage } from './gates/types'

/** State file, relative to the gate root. */
export const STATE_FILE = '.dsh/devflow/state.json'

/** Current schema version of the state file. */
const STATE_VERSION = 1

/**
 * Failure types, as the design names them.
 *
 * The budget is how many reworks an edge tolerates before the flow must
 * escalate instead of retrying: one rework is normal, a second means the work
 * must be split smaller, and the third means a person has to look.
 */
export const FAILURE_BUDGETS = {
  DESIGN_UNFEASIBLE: 2,
  CONTRACT_GAP: 3,
  CONTRACT_CONFLICT: 1,
  IMPL_MISMATCH: 3,
  TEST_FAIL: 3,
  ACCEPT_P0: 3,
  DEPLOY_FALSE_GREEN: 2,
} as const

/** One failure type. */
export type FailureType = keyof typeof FAILURE_BUDGETS

/** Every failure type, in declaration order. */
export const FAILURE_TYPES = Object.keys(FAILURE_BUDGETS) as FailureType[]

/** One recorded transition. */
export interface StateEvent {
  /** ISO timestamp. */
  at: string
  /** What happened. */
  action: 'advance' | 'rework' | 'reset'
  /** Stage the flow was in when it happened. */
  stage: Stage
  /** Stage it moved to, for `advance`. */
  to?: Stage
  /** Failure type, for `rework`. */
  failure?: FailureType
  /** Free-form note from the caller. */
  note?: string
}

/** The persisted state. */
export interface FlowState {
  version: number
  /** Current stage. */
  stage: Stage
  /** Rework counters per failure type. */
  rework: Record<FailureType, number>
  /** Transitions, oldest first. */
  history: StateEvent[]
}

/** Result of a state action. */
export interface StateOutcome {
  /** Stage after the action. */
  stage: Stage
  /** Whether the flow moved to a new stage. */
  advanced: boolean
  /** Whether the action itself succeeded. */
  pass: boolean
  /** One line for the model. */
  message: string
  /** Gate findings, when the action ran a gate. */
  findings: Finding[]
  /** Rework counter after a `rework`, or when the budget is relevant. */
  rework?: { type: FailureType; count: number; budget: number; exhausted: boolean }
}

/** A fresh state at the first stage. */
function initialState(): FlowState {
  return {
    version: STATE_VERSION,
    stage: 'clarify',
    rework: Object.fromEntries(FAILURE_TYPES.map((type) => [type, 0])) as Record<FailureType, number>,
    history: [],
  }
}

/** Absolute state path. */
export function stateFile(root: string): string {
  return join(root, STATE_FILE)
}

/**
 * Read the state, creating the first-stage default when absent.
 *
 * @param root - Absolute gate root.
 * @returns The state, and whether it was newly created.
 */
export function readState(root: string): { state: FlowState; created: boolean } {
  const path = stateFile(root)
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object')
    const candidate = parsed as Partial<FlowState>
    if (!STAGES.includes(candidate.stage as Stage)) throw new Error('invalid stage')
    const rework = Object.fromEntries(
      FAILURE_TYPES.map((type) => [type, Number(candidate.rework?.[type] ?? 0)]),
    ) as Record<FailureType, number>
    return {
      state: {
        version: STATE_VERSION,
        stage: candidate.stage as Stage,
        rework,
        history: Array.isArray(candidate.history) ? (candidate.history as StateEvent[]) : [],
      },
      created: false,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      // A corrupt file is repaired rather than trusted: silently starting over is
      // safer than machine-routing on garbage.
      return { state: initialState(), created: true }
    }
    return { state: initialState(), created: true }
  }
}

/** Write the state atomically. */
export function writeState(root: string, state: FlowState): void {
  const path = stateFile(root)
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify(state, undefined, 2)}\n`, 'utf8')
  renameSync(temporary, path)
}

/** The next stage, or `undefined` at the end. */
function nextStage(stage: Stage): Stage | undefined {
  const index = STAGES.indexOf(stage)
  return index === -1 ? undefined : STAGES[index + 1]
}

/**
 * Advance one stage, but only through a passing gate.
 *
 * @param root - Absolute gate root.
 * @param note - Optional note recorded with the transition.
 * @param config - Gate configuration; loaded from the root when omitted.
 * @returns The outcome; on a failing gate the stage is unchanged.
 */
export function advance(root: string, note?: string, config?: GateConfig): StateOutcome {
  const { state } = readState(root)
  const stage = state.stage

  if (isGatedStage(stage)) {
    const gate = runGate(stage, root, config)
    if (!gate.pass) {
      return {
        stage,
        advanced: false,
        pass: false,
        message: `gate "${stage}" fails with ${gate.findings.filter((item) => item.severity === 'error').length} error(s); stage unchanged`,
        findings: gate.findings,
      }
    }
  }

  const target = nextStage(stage)
  if (target === undefined) {
    return { stage, advanced: false, pass: true, message: 'flow is already at the last stage', findings: [] }
  }

  state.stage = target
  state.history.push({ at: new Date().toISOString(), action: 'advance', stage, to: target, ...(note === undefined ? {} : { note }) })
  writeState(root, state)
  return { stage: target, advanced: true, pass: true, message: `advanced ${stage} → ${target}`, findings: [] }
}

/**
 * Record a rework against a typed failure and report the remaining budget.
 *
 * @param root - Absolute gate root.
 * @param failure - Failure type from the design's edge table.
 * @param note - Optional note recorded with the transition.
 * @returns The outcome, with `exhausted` set when the budget is used up.
 */
export function rework(root: string, failure: FailureType, note?: string): StateOutcome {
  const { state } = readState(root)
  const count = state.rework[failure] + 1
  const budget = FAILURE_BUDGETS[failure]
  const exhausted = count >= budget

  state.rework[failure] = count
  state.history.push({
    at: new Date().toISOString(),
    action: 'rework',
    stage: state.stage,
    failure,
    ...(note === undefined ? {} : { note }),
  })
  writeState(root, state)

  return {
    stage: state.stage,
    advanced: false,
    pass: true,
    message: exhausted
      ? `${failure} reworked ${count}×, budget ${budget} is exhausted — escalate to the user`
      : `${failure} reworked ${count}×, ${budget - count} left before escalation`,
    findings: [],
    rework: { type: failure, count, budget, exhausted },
  }
}

/**
 * Reset the state to the first stage.
 *
 * @param root - Absolute gate root.
 * @returns The outcome.
 */
export function reset(root: string): StateOutcome {
  const state = initialState()
  writeState(root, state)
  return { stage: state.stage, advanced: false, pass: true, message: 'flow reset to clarify', findings: [] }
}
