import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { advance, readState, reset, rework, STATE_FILE, withStateLock } from '../src/state'
import { flowTools } from '../src/tools'

const temporary: string[] = []

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** Materialise a requirement directory from `{ relativePath: content }`. */
function workspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'devflow-metrics-'))
  temporary.push(root)
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(root, relative)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, content, 'utf8')
  }
  return root
}

const REQUIREMENT = '# 需求\n\n## 功能点\n- FP-1 创建订单\n'

/** The zero-valued metrics a fresh flow carries. */
const ZERO_METRICS = {
  advanceBlocked: { clarify: 0, design: 0, build: 0, test: 0, accept: 0, ship: 0 },
  rework: {
    DESIGN_UNFEASIBLE: 0,
    CONTRACT_GAP: 0,
    CONTRACT_CONFLICT: 0,
    IMPL_MISMATCH: 0,
    TEST_FAIL: 0,
    ACCEPT_P0: 0,
  },
  codes: {},
}

/** Invoke a tool definition the way the runtime does. */
async function call(tool: unknown, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const definition = tool as { execute?: unknown }
  const execute = definition.execute as ((input: Record<string, unknown>, exec: unknown) => Promise<unknown>) | undefined
  if (typeof execute !== 'function') throw new Error('tool has no execute')
  return (await execute(args, {})) as Record<string, unknown>
}

describe('metrics', () => {
  it('starts as a complete zero-valued structure', () => {
    const { state } = readState(workspace())
    expect(state.metrics).toEqual(ZERO_METRICS)
  })

  it('counts one refused advance per stage and the codes of its findings', () => {
    const root = workspace()
    const blocked = advance(root)
    expect(blocked.pass).toBe(false)

    const { state } = readState(root)
    // The refusal is counted, but it is not progress: stage and history stay.
    expect(state.stage).toBe('clarify')
    expect(state.history).toEqual([])
    expect(state.metrics.advanceBlocked).toEqual({ ...ZERO_METRICS.advanceBlocked, clarify: 1 })
    expect(state.metrics.codes).toEqual({ FILE_MISSING: 1 })
  })

  it('counts the refusal in the stage that was actually blocked', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT })
    expect(advance(root).advanced).toBe(true)

    expect(advance(root).pass).toBe(false)
    const { state } = readState(root)
    expect(state.stage).toBe('design')
    expect(state.metrics.advanceBlocked).toEqual({ ...ZERO_METRICS.advanceBlocked, design: 1 })
    // `design.md` and `api-contract.md` are both missing: one refusal, two codes.
    expect(state.metrics.codes).toEqual({ FILE_MISSING: 2 })
  })

  it('leaves the counters alone when the gate passes', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT })
    expect(advance(root).advanced).toBe(true)
    const { state } = readState(root)
    expect(state.metrics).toEqual(ZERO_METRICS)
  })

  it('counts every rework per failure type, in the same write as the stage budget', () => {
    const root = workspace()
    rework(root, 'TEST_FAIL')
    rework(root, 'TEST_FAIL')

    const { state } = readState(root)
    expect(state.rework.TEST_FAIL).toBe(2)
    expect(state.metrics.rework).toEqual({ ...ZERO_METRICS.rework, TEST_FAIL: 2 })

    // Budget and statistics are persisted by one write: two reworks, two events.
    const persisted = JSON.parse(readFileSync(join(root, STATE_FILE), 'utf8'))
    expect(persisted.rework.TEST_FAIL).toBe(2)
    expect(persisted.metrics.rework.TEST_FAIL).toBe(2)
    expect(persisted.history).toHaveLength(2)
  })

  it('reads an old file without metrics, fills zeros, and keeps version 2', () => {
    const root = workspace({
      [STATE_FILE]: JSON.stringify({
        version: 2,
        stage: 'test',
        reworkStage: 'test',
        rework: { IMPL_MISMATCH: 1 },
        history: [],
      }),
    })

    const { state } = readState(root)
    expect(state.version).toBe(2)
    expect(state.metrics).toEqual(ZERO_METRICS)

    // The next write adds the field without migrating the schema version.
    rework(root, 'IMPL_MISMATCH')
    const persisted = JSON.parse(readFileSync(join(root, STATE_FILE), 'utf8'))
    expect(persisted.version).toBe(2)
    expect(persisted.metrics.rework.IMPL_MISMATCH).toBe(1)
  })

  it('loses no count when two advances fail under one lock hold', () => {
    const root = workspace()
    withStateLock(root, () => {
      advance(root)
      advance(root)
    })

    const { state } = readState(root)
    expect(state.metrics.advanceBlocked.clarify).toBe(2)
    expect(state.metrics.codes.FILE_MISSING).toBe(2)
  })

  it('keeps the metrics across a reset, which only clears the stage and the budgets', () => {
    const root = workspace()
    expect(advance(root).pass).toBe(false)
    rework(root, 'TEST_FAIL')
    reset(root)

    const { state } = readState(root)
    // The stage, the budgets, and the history start over; the refusals that
    // already happened do not. A reset is a repair, not a rewrite of history.
    expect(state.stage).toBe('clarify')
    expect(state.rework.TEST_FAIL).toBe(0)
    expect(state.history).toEqual([])
    expect(state.metrics).toEqual({
      ...ZERO_METRICS,
      advanceBlocked: { ...ZERO_METRICS.advanceBlocked, clarify: 1 },
      rework: { ...ZERO_METRICS.rework, TEST_FAIL: 1 },
      codes: { FILE_MISSING: 1 },
    })
  })

  it('starts the counters over when reset repairs a corrupt file', () => {
    const root = workspace({ [STATE_FILE]: '{broken' })
    expect(reset(root).stage).toBe('clarify')
    expect(readState(root).state.metrics).toEqual(ZERO_METRICS)
  })

  it('counts error-level codes only, so a constant waiver warning cannot drown the hit rate', () => {
    const root = workspace({
      'requirement.md': '# 需求\n\n## 功能点\n- FP-1 创建订单\n',
      'acceptance-report.md': '# 验收\n\n## FP-1 创建订单\npass — 证据：src/missing.ts:1\n\n## P0\nP0 遗留：0\n',
      'devflow.config.json': JSON.stringify({ ui: { applicable: false, reason: '纯后端项目，无界面变更' } }),
      [STATE_FILE]: JSON.stringify({
        version: 2,
        stage: 'accept',
        reworkStage: 'accept',
        rework: { DESIGN_UNFEASIBLE: 0, CONTRACT_GAP: 0, CONTRACT_CONFLICT: 0, IMPL_MISMATCH: 0, TEST_FAIL: 0, ACCEPT_P0: 0 },
        history: [],
      }),
    })

    const blocked = advance(root)
    expect(blocked.pass).toBe(false)
    // The waiver is still reported in the tool result — it is just not a metric.
    expect(blocked.findings.map((item) => item.code)).toContain('UI_ACCEPTANCE_WAIVED')

    const { state } = readState(root)
    expect(state.metrics.advanceBlocked.accept).toBe(1)
    expect(state.metrics.codes).toEqual({ EVIDENCE_MISSING: 1, FILE_MISSING: 1 })
    expect(state.metrics.codes).not.toHaveProperty('UI_ACCEPTANCE_WAIVED')
  })
})

describe('devflow_state · metrics', () => {
  it('returns the statistics and the counter stage without moving the flow', async () => {
    const root = workspace()
    const [, state] = flowTools()
    await call(state, { action: 'advance', root })
    await call(state, { action: 'rework', root, failure: 'TEST_FAIL' })

    const before = readFileSync(join(root, STATE_FILE), 'utf8')
    const read = await call(state, { action: 'metrics', root })

    expect(read['stage']).toBe('clarify')
    expect(read['reworkStage']).toBe('clarify')
    expect(read['metrics']).toEqual({
      advanceBlocked: { ...ZERO_METRICS.advanceBlocked, clarify: 1 },
      rework: { ...ZERO_METRICS.rework, TEST_FAIL: 1 },
      codes: { FILE_MISSING: 1 },
    })
    expect(String(read['message'])).toContain('advance blocked by stage: clarify=1')
    // Reading is pure: the state file is byte-identical afterwards.
    expect(readFileSync(join(root, STATE_FILE), 'utf8')).toBe(before)
  })

  it('reports zeros for a flow that never ran, without creating the file', async () => {
    const root = workspace()
    const [, state] = flowTools()
    const read = await call(state, { action: 'metrics', root })

    expect(read['metrics']).toEqual(ZERO_METRICS)
    expect(existsSync(join(root, STATE_FILE))).toBe(false)
  })
})
