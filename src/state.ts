/**
 * The durable flow state.
 *
 * The flow used to live in the main agent's head: which step it was on, how many
 * times this edge had been reworked, whether the budget had run out. All three
 * are facts, so they belong on disk where a restart, a compaction, or a fresh
 * session cannot lose them.
 *
 * `advance` re-runs the gate of the current stage before moving on, and refuses
 * to move while the current stage's rework budget is exhausted — a gate that
 * passes is not enough once the flow has spent its right to retry. That is the
 * whole point: a stage is left through a passing gate and an intact budget, no
 * matter what the model believes about its own work.
 *
 * A refusal is a fact worth counting, not just a message: `metrics` accumulates
 * refusals per stage, reworks per failure type, and the finding codes that
 * caused them, so the flow can answer "is this month better than the last one?"
 * without replaying the history by hand.
 *
 * @module dsh-fullstack-team/state
 */

import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveRoot } from './gates/artifact'
import { runGate, type GateConfig } from './gates/stages'
import { finding, isGatedStage, STAGES, type Finding, type Stage } from './gates/types'

/** State file, relative to the gate root. */
export const STATE_FILE = '.dsh/devflow/state.json'

/** Lock file, relative to the gate root. */
export const LOCK_FILE = '.dsh/devflow/state.lock'

/** Current schema version of the state file. */
const STATE_VERSION = 2

/** How many times a lock acquisition is retried, and how long each wait is. */
const LOCK_ATTEMPTS = 10
const LOCK_RETRY_MS = 50

/** A lock older than this is abandoned by a crashed writer, not held. */
const LOCK_STALE_MS = 10_000

/**
 * Failure types, as the design names them.
 *
 * The budget is how many reworks an edge tolerates before the flow must
 * escalate instead of retrying: one rework is normal, a second means the work
 * must be split smaller, and the third means a person has to look. The budget
 * is per stage: entering a new stage clears the counters, and the history keeps
 * the evidence of what the previous stage cost.
 */
export const FAILURE_BUDGETS = {
  DESIGN_UNFEASIBLE: 2,
  CONTRACT_GAP: 3,
  CONTRACT_CONFLICT: 1,
  IMPL_MISMATCH: 3,
  TEST_FAIL: 3,
  ACCEPT_P0: 3,
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

/**
 * Cumulative counters, so the flow can answer "is this month better than the
 * last one?" without replaying the history by hand.
 *
 * These are statistics, not budgets: a passing gate does not clear them, the
 * flow keeps them across stages, and a `reset` keeps them too — a rework that
 * already happened is a fact, and clearing it would make the next look at the
 * requirement claim it was never pushed back.
 */
export interface Metrics {
  /** How many times `advance` was refused, per stage the flow was in. */
  advanceBlocked: Record<string, number>
  /** How many reworks were recorded, per failure type. */
  rework: Record<string, number>
  /** Error-level finding codes seen in refused `advance` calls, with how often. */
  codes: Record<string, number>
}

/** The persisted state. */
export interface FlowState {
  version: number
  /** Current stage. */
  stage: Stage
  /** Stage the rework counters belong to; normally equal to `stage`. */
  reworkStage: Stage
  /** Rework counters per failure type, scoped to `reworkStage`. */
  rework: Record<FailureType, number>
  /**
   * Cumulative statistics. Required once read: a `version:2` file written
   * before this field existed is filled with zeros instead of being rejected.
   */
  metrics: Metrics
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

/** What `readState` returns. */
export interface StateReadResult {
  state: FlowState
  /** True only when the file did not exist and the initial state was assumed. */
  created: boolean
  /** Failure keys present in the file but unknown to this version (tolerated). */
  unknownFailures: string[]
}

/** One failure type whose budget is used up in the current stage. */
export interface ExhaustedBudget {
  type: FailureType
  count: number
  budget: number
}

/** The zero-valued statistics a flow that has never been refused carries. */
function freshMetrics(): Metrics {
  return {
    advanceBlocked: toCounterMap(undefined, STAGES),
    rework: toCounterMap(undefined, FAILURE_TYPES),
    codes: {},
  }
}

/** A fresh state at the first stage. */
function initialState(): FlowState {
  return {
    version: STATE_VERSION,
    stage: 'clarify',
    reworkStage: 'clarify',
    rework: Object.fromEntries(FAILURE_TYPES.map((type) => [type, 0])) as Record<FailureType, number>,
    metrics: freshMetrics(),
    history: [],
  }
}

/** Absolute state path. */
export function stateFile(root: string): string {
  return join(root, STATE_FILE)
}

/** Absolute lock path. */
function lockFile(root: string): string {
  return join(root, LOCK_FILE)
}

/** One actionable error for a state file that cannot be trusted. */
function stateError(path: string, detail: string): Error {
  return new Error(
    `dsh-fullstack-team: flow state ${path} ${detail}; fix it by editing the file, deleting it, or calling devflow_state with action "reset"`,
  )
}

/** Whether `value` is a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Coerce one persisted counter, defaulting to zero for missing or invalid values. */
function toCount(value: unknown): number {
  const count = Number(value ?? 0)
  return Number.isFinite(count) && count > 0 ? count : 0
}

/**
 * Read one counter map with a fixed key set, zero-filling every key.
 *
 * Older state files have no `metrics` at all, and an older version of this one
 * may have a shape this build does not know; either way the counters come back
 * as a complete zero-valued structure rather than `undefined`.
 */
function toCounterMap(value: unknown, keys: readonly string[]): Record<string, number> {
  const persisted = isPlainObject(value) ? value : {}
  return Object.fromEntries(keys.map((key) => [key, toCount(persisted[key])]))
}

/** Read one counter map with open-ended keys, keeping only positive counts. */
function toFreeCounterMap(value: unknown): Record<string, number> {
  const counters: Record<string, number> = {}
  if (!isPlainObject(value)) return counters
  for (const [key, raw] of Object.entries(value)) {
    const count = toCount(raw)
    if (count > 0) counters[key] = count
  }
  return counters
}

/** Add one to a counter, keeping the record's shape. */
function bump(counters: Record<string, number>, key: string): void {
  counters[key] = (counters[key] ?? 0) + 1
}

/**
 * Record one refused `advance`: the stage it was refused in, and the codes of
 * the errors it came back with.
 *
 * Warnings are excluded on purpose. `UI_ACCEPTANCE_WAIVED` is emitted on every
 * `accept` run of a waived project, so counting it would leave a constant in
 * `codes` that says nothing about how often the gate actually blocked anything.
 */
function recordRefusal(state: FlowState, findings: Finding[]): void {
  bump(state.metrics.advanceBlocked, state.stage)
  for (const item of findings) {
    if (item.severity === 'warning') continue
    bump(state.metrics.codes, item.code)
  }
}

/** Serialise a state object exactly as it goes to disk. */
function serialise(state: FlowState): string {
  return `${JSON.stringify(state, undefined, 2)}\n`
}

/**
 * Parse a state file, throwing instead of guessing.
 *
 * A corrupt file is a fact about the environment, not an invitation to start
 * over: silently returning to `clarify` would lose the record of a stage the
 * team already paid for. `version:1` files stay readable — their counters are
 * attributed to the current stage, which is exactly what they used to mean.
 */
function parseState(raw: string, path: string): { state: FlowState; unknownFailures: string[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw stateError(path, `is not valid JSON (${(error as Error).message})`)
  }
  if (!isPlainObject(parsed)) throw stateError(path, 'must contain a JSON object')

  const stage = parsed['stage']
  if (!STAGES.includes(stage as Stage)) {
    throw stateError(path, `has an unknown stage: ${JSON.stringify(stage)}`)
  }

  const persisted = isPlainObject(parsed['rework']) ? parsed['rework'] : {}
  const rework = Object.fromEntries(
    FAILURE_TYPES.map((type) => [type, toCount(persisted[type])]),
  ) as Record<FailureType, number>
  const unknownFailures = Object.keys(persisted).filter((key) => !(FAILURE_TYPES as string[]).includes(key))

  const reworkStage = parsed['reworkStage']
  const persistedMetrics = isPlainObject(parsed['metrics']) ? parsed['metrics'] : {}
  return {
    state: {
      version: STATE_VERSION,
      stage: stage as Stage,
      reworkStage: STAGES.includes(reworkStage as Stage) ? (reworkStage as Stage) : (stage as Stage),
      rework,
      metrics: {
        advanceBlocked: toCounterMap(persistedMetrics['advanceBlocked'], STAGES),
        rework: toCounterMap(persistedMetrics['rework'], FAILURE_TYPES),
        codes: toFreeCounterMap(persistedMetrics['codes']),
      },
      history: Array.isArray(parsed['history']) ? (parsed['history'] as StateEvent[]) : [],
    },
    unknownFailures,
  }
}

/**
 * Read the state, assuming the initial state only when the file is absent.
 *
 * @param root - Absolute gate root.
 * @returns The state, whether it was newly created, and any unknown failure keys.
 * @throws When the root is invalid or the state file exists but cannot be read
 *   or parsed.
 */
export function readState(root: string): StateReadResult {
  const absolute = resolveRoot(root)
  const path = stateFile(absolute)

  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { state: initialState(), created: true, unknownFailures: [] }
    }
    throw stateError(path, `cannot be read (${(error as Error).message})`)
  }

  return { ...parseState(raw, path), created: false }
}

/** Roots currently locked by this process; the lock is re-entrant locally. */
const heldLocks = new Set<string>()

/** Block the current thread for `ms` without busy-spinning. */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Whether an existing lock file is old enough to be considered abandoned. */
function isStaleLock(lock: string): boolean {
  try {
    return Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS
  } catch {
    return true
  }
}

/**
 * Run `work` while holding the state lock.
 *
 * The lock is an exclusively created file, so two processes cannot interleave
 * read-modify-write. Retries are bounded (10 × 50ms); when they run out the
 * caller gets an error, never a silent write. A stale lock left by a crashed
 * writer is cleared rather than blocking the flow forever. Re-entering from the
 * same process is allowed, so a helper such as `writeState` can lock too.
 *
 * @param root - Absolute gate root.
 * @param work - Critical section to run under the lock.
 * @returns Whatever `work` returns.
 * @throws When the root is invalid or another process holds the lock.
 */
export function withStateLock<T>(root: string, work: () => T): T {
  const absolute = resolveRoot(root)
  if (heldLocks.has(absolute)) return work()

  const lock = lockFile(absolute)
  mkdirSync(dirname(lock), { recursive: true })

  let handle: number | undefined
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      handle = openSync(lock, 'wx')
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new Error(`dsh-fullstack-team: cannot lock flow state ${lock}: ${(error as Error).message}`)
      }
      if (isStaleLock(lock)) {
        try {
          unlinkSync(lock)
        } catch {
          // Another process cleared it first; the retry will tell.
        }
        continue
      }
      if (attempt === LOCK_ATTEMPTS - 1) {
        throw new Error(
          `dsh-fullstack-team: flow state is locked by another process: ${lock}; the write was refused rather than interleaved`,
        )
      }
      sleep(LOCK_RETRY_MS)
    }
  }
  if (handle === undefined) {
    throw new Error(`dsh-fullstack-team: could not acquire the flow state lock: ${lock}`)
  }

  heldLocks.add(absolute)
  try {
    return work()
  } finally {
    heldLocks.delete(absolute)
    closeSync(handle)
    try {
      unlinkSync(lock)
    } catch {
      // The lock is advisory; a leftover stale file is cleared on the next run.
    }
  }
}

/** Monotonic suffix so two writes in one process never share a temporary file. */
let temporaryCounter = 0

/** Write the state atomically, under the state lock. */
export function writeState(root: string, state: FlowState): void {
  withStateLock(root, () => {
    const absolute = resolveRoot(root)
    const path = stateFile(absolute)
    mkdirSync(dirname(path), { recursive: true })
    temporaryCounter += 1
    const temporary = `${path}.${process.pid}.${temporaryCounter}.tmp`
    writeFileSync(temporary, serialise(state), 'utf8')
    renameSync(temporary, path)
  })
}

/** The next stage, or `undefined` at the end. */
function nextStage(stage: Stage): Stage | undefined {
  const index = STAGES.indexOf(stage)
  return index === -1 ? undefined : STAGES[index + 1]
}

/**
 * Failure types whose budget is used up in the current stage.
 *
 * Counters belonging to another stage are ignored: the budget is per stage, so
 * a stale `reworkStage` must not block the flow that has already moved on.
 */
export function exhaustedFailures(state: FlowState): ExhaustedBudget[] {
  if (state.reworkStage !== state.stage) return []
  return FAILURE_TYPES.filter((type) => state.rework[type] >= FAILURE_BUDGETS[type]).map((type) => ({
    type,
    count: state.rework[type],
    budget: FAILURE_BUDGETS[type],
  }))
}

/**
 * Advance one stage, but only through a passing gate and an intact budget.
 *
 * @param root - Absolute gate root.
 * @param note - Optional note recorded with the transition.
 * @param config - Gate configuration; loaded from the root when omitted.
 * @returns The outcome; on a failing gate or an exhausted budget the stage is
 *   unchanged, the refusal is counted in `metrics`, and nothing else moves.
 */
export function advance(root: string, note?: string, config?: GateConfig): StateOutcome {
  return withStateLock(root, () => {
    const { state } = readState(root)
    const stage = state.stage

    // The budget is checked first: once a stage has spent its retries, a gate
    // that happens to pass must not let the flow walk out of the escalation.
    const exhausted = exhaustedFailures(state)
    if (exhausted.length > 0) {
      const detail = exhausted.map((item) => `${item.type}=${item.count}/${item.budget}`).join(', ')
      const findings = exhausted.map((item) =>
        finding(
          'REWORK_BUDGET_EXHAUSTED',
          `${item.type} used ${item.count}/${item.budget} reworks in stage "${stage}"; advance is refused — escalate to the user or reset`,
          { path: STATE_FILE },
        ),
      )
      recordRefusal(state, findings)
      writeState(root, state)
      return {
        stage,
        advanced: false,
        pass: false,
        message: `rework budget exhausted (${detail}) in stage "${stage}": advance is refused even when the gate passes — escalate to the user（需上报）, or reset and redo the stage`,
        findings,
      }
    }

    if (isGatedStage(stage)) {
      const gate = runGate(stage, root, config)
      if (!gate.pass) {
        recordRefusal(state, gate.findings)
        writeState(root, state)
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
    state.reworkStage = target
    for (const type of FAILURE_TYPES) state.rework[type] = 0
    state.history.push({ at: new Date().toISOString(), action: 'advance', stage, to: target, ...(note === undefined ? {} : { note }) })
    writeState(root, state)
    return { stage: target, advanced: true, pass: true, message: `advanced ${stage} → ${target}`, findings: [] }
  })
}

/**
 * Record a rework against a typed failure and report the remaining budget.
 *
 * Counters are scoped to the stage: finding them attributed to another stage
 * (a hand-edited file, or a v1 file that just moved) clears them first. The
 * cumulative `metrics.rework` count is not scoped that way: it keeps counting
 * every rework, so the failure-type distribution survives stage changes.
 *
 * @param root - Absolute gate root.
 * @param failure - Failure type from the design's edge table.
 * @param note - Optional note recorded with the transition.
 * @returns The outcome, with `exhausted` set when the budget is used up.
 */
export function rework(root: string, failure: FailureType, note?: string): StateOutcome {
  return withStateLock(root, () => {
    const { state } = readState(root)
    if (state.reworkStage !== state.stage) {
      for (const type of FAILURE_TYPES) state.rework[type] = 0
      state.reworkStage = state.stage
    }

    const count = state.rework[failure] + 1
    const budget = FAILURE_BUDGETS[failure]
    const exhausted = count >= budget

    state.rework[failure] = count
    bump(state.metrics.rework, failure)
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
        ? `${failure} reworked ${count}×, budget ${budget} is exhausted — escalate to the user（需上报）`
        : `${failure} reworked ${count}×, ${budget - count} left before escalation`,
      findings: [],
      rework: { type: failure, count, budget, exhausted },
    }
  })
}

/**
 * Reset the state to the first stage.
 *
 * The old file is not read, so a corrupt state can always be repaired from
 * here. Resetting is not a way past a gate: it clears the stage, the rework
 * counters, and the history. The cumulative metrics are kept, because they
 * record refusals that already happened — wiping them on every unblocking
 * reset would make the flow unable to say it was ever pushed back. Only when
 * the old file cannot be read at all do the counters start over, since there is
 * nothing left to carry.
 *
 * @param root - Absolute gate root.
 * @returns The outcome.
 */
export function reset(root: string): StateOutcome {
  return withStateLock(root, () => {
    const state = initialState()
    try {
      state.metrics = readState(root).state.metrics
    } catch {
      // A corrupt state cannot be read; the fresh zero-valued metrics stand.
    }
    writeState(root, state)
    return { stage: state.stage, advanced: false, pass: true, message: 'flow reset to clarify', findings: [] }
  })
}
