import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  advance,
  exhaustedFailures,
  FAILURE_TYPES,
  LOCK_FILE,
  readState,
  reset,
  rework,
  stateFile,
  STATE_FILE,
  writeState,
} from '../src/state'

const temporary: string[] = []

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** Materialise a requirement directory from `{ relativePath: content }`. */
function workspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'devflow-state-'))
  temporary.push(root)
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(root, relative)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, content, 'utf8')
  }
  return root
}

const REQUIREMENT = '# 需求\n\n## 功能点\n- FP-1 创建订单\n'
const DESIGN = '# 设计\n\n## 接口\n`POST /api/orders`\n'
const CONTRACT = '### POST /api/orders\nbody: { id }\n'

/** A review document with 30 verdicts, each with resolvable evidence. */
function reviewDoc(): string {
  return `# 审查\n\n${Array.from({ length: 30 }, (_, index) => `- 条目 ${index + 1}：pass — 证据：src/a.ts:1`).join('\n')}\n`
}

/** Every artifact the whole flow needs, so each gate can pass. */
function fullFlow(): Record<string, string> {
  return {
    'requirement.md': REQUIREMENT,
    'design.md': DESIGN,
    'api-contract.md': CONTRACT,
    'test-cases.md': '# 用例\n\n## FP-1 创建订单\n正常创建。\n',
    'test-report.md': '# 执行报告\n\n## 执行结果\n12 passed, 0 failed。\n',
    'acceptance-report.md': '# 验收\n\n## FP-1 创建订单\npass — 证据：src/a.ts:1\n\n## P0\nP0 遗留：0\n',
    'ui-acceptance.md': '# 界面验收\n\n## 页面\n订单页正常。\n',
    'review-notes.md': reviewDoc(),
    'src/a.ts': 'export const a = 1\n',
  }
}

describe('state file', () => {
  it('starts at the first stage without writing anything', () => {
    const root = workspace()
    const { state, created } = readState(root)
    expect(created).toBe(true)
    expect(state.stage).toBe('clarify')
    expect(state.reworkStage).toBe('clarify')
    expect(state.version).toBe(2)
    expect(state.rework.IMPL_MISMATCH).toBe(0)
    expect(existsSync(stateFile(root))).toBe(false)
  })

  it('lives under .dsh/devflow/', () => {
    expect(STATE_FILE).toBe('.dsh/devflow/state.json')
    expect(LOCK_FILE).toBe('.dsh/devflow/state.lock')
    expect(stateFile('/repo/docs/dev/007')).toBe('/repo/docs/dev/007/.dsh/devflow/state.json')
  })

  it('refuses a corrupt file instead of repairing it', () => {
    const root = workspace({ [STATE_FILE]: '{not json' })
    const before = readFileSync(join(root, STATE_FILE), 'utf8')
    expect(() => readState(root)).toThrow(/not valid JSON/u)
    try {
      readState(root)
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain(join(root, STATE_FILE))
      expect(message).toContain('reset')
    }
    // The file is reported, not rewritten.
    expect(readFileSync(join(root, STATE_FILE), 'utf8')).toBe(before)
  })

  it('refuses an empty file', () => {
    const root = workspace({ [STATE_FILE]: '' })
    expect(() => readState(root)).toThrow(/not valid JSON/u)
  })

  it('refuses an unknown stage', () => {
    const root = workspace({ [STATE_FILE]: JSON.stringify({ stage: 'bogus' }) })
    expect(() => readState(root)).toThrow(/unknown stage/u)
  })

  it('reads a minimal v1 file and fills the missing fields', () => {
    const root = workspace({ [STATE_FILE]: JSON.stringify({ stage: 'design' }) })
    const { state, created } = readState(root)
    expect(created).toBe(false)
    expect(state.stage).toBe('design')
    expect(state.reworkStage).toBe('design')
    expect(state.version).toBe(2)
    expect(state.history).toEqual([])
    expect(state.rework.CONTRACT_GAP).toBe(0)
  })

  it('round-trips a written state at version 2', () => {
    const root = workspace()
    const { state } = readState(root)
    state.stage = 'build'
    state.reworkStage = 'build'
    writeState(root, state)
    expect(readState(root).state.stage).toBe('build')
    const persisted = JSON.parse(readFileSync(join(root, STATE_FILE), 'utf8'))
    expect(persisted.version).toBe(2)
    expect(persisted.reworkStage).toBe('build')
  })

  it('tolerates a failure type this version no longer knows', () => {
    const root = workspace({
      [STATE_FILE]: JSON.stringify({
        version: 1,
        stage: 'test',
        rework: { IMPL_MISMATCH: 1, DEPLOY_FALSE_GREEN: 2 },
        history: [],
      }),
    })
    const { state, unknownFailures } = readState(root)
    expect(state.rework.IMPL_MISMATCH).toBe(1)
    expect(unknownFailures).toContain('DEPLOY_FALSE_GREEN')
  })

  it('rejects a relative root', () => {
    expect(() => readState('.')).toThrow(/must be absolute/u)
    expect(() => writeState('.', readState(workspace()).state)).toThrow(/must be absolute/u)
  })
})

describe('advance', () => {
  it('refuses to leave a stage whose gate fails', () => {
    const root = workspace()
    const outcome = advance(root)
    expect(outcome.advanced).toBe(false)
    expect(outcome.stage).toBe('clarify')
    expect(outcome.findings.length).toBeGreaterThan(0)
    // The refusal must not be persisted as progress.
    expect(readState(root).state.history).toEqual([])
  })

  it('moves on when the gate passes', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT })
    const outcome = advance(root)
    expect(outcome).toMatchObject({ advanced: true, pass: true, stage: 'design' })
    expect(readState(root).state.stage).toBe('design')
    expect(readState(root).state.history).toHaveLength(1)
  })

  it('gates the design stage as well', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT, 'design.md': DESIGN })
    expect(advance(root).stage).toBe('design')
    const blocked = advance(root)
    expect(blocked.advanced).toBe(false)
    expect(blocked.findings.map((item) => item.code)).toContain('FILE_MISSING')
  })

  it('walks the whole six-stage flow once every gate passes', () => {
    const root = workspace(fullFlow())
    expect(advance(root).stage).toBe('design')
    expect(advance(root).stage).toBe('build')
    // build carries no gate of its own.
    expect(advance(root).stage).toBe('test')
    expect(advance(root).stage).toBe('accept')
    expect(advance(root).stage).toBe('ship')
    expect(advance(root).advanced).toBe(false)
    expect(advance(root).pass).toBe(true)
  })

  it('clears the counters and re-points the counter stage on a move', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT })
    rework(root, 'TEST_FAIL')
    expect(readState(root).state.rework.TEST_FAIL).toBe(1)
    expect(advance(root).advanced).toBe(true)
    const { state } = readState(root)
    expect(state.rework.TEST_FAIL).toBe(0)
    expect(state.reworkStage).toBe('design')
  })

  it('a new stage counts a rework from one again', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT })
    advance(root)
    const outcome = rework(root, 'TEST_FAIL')
    expect(outcome.rework).toMatchObject({ count: 1, budget: 3, exhausted: false })
  })

  it('refuses to advance once the budget of this stage is exhausted, even with a passing gate', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT })
    rework(root, 'IMPL_MISMATCH')
    rework(root, 'IMPL_MISMATCH')
    const third = rework(root, 'IMPL_MISMATCH')
    expect(third.rework).toMatchObject({ count: 3, budget: 3, exhausted: true })
    expect(exhaustedFailures(readState(root).state)).toEqual([{ type: 'IMPL_MISMATCH', count: 3, budget: 3 }])

    const before = readFileSync(join(root, STATE_FILE), 'utf8')
    const outcome = advance(root)
    expect(outcome).toMatchObject({ advanced: false, pass: false, stage: 'clarify' })
    expect(outcome.findings.map((item) => item.code)).toContain('REWORK_BUDGET_EXHAUSTED')
    expect(outcome.findings[0]?.detail).toContain('IMPL_MISMATCH')
    expect(outcome.message).toContain('reset')
    expect(readFileSync(join(root, STATE_FILE), 'utf8')).toBe(before)
  })

  it('refuses to advance after a single CONTRACT_CONFLICT rework', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT })
    expect(rework(root, 'CONTRACT_CONFLICT').rework?.exhausted).toBe(true)
    const outcome = advance(root)
    expect(outcome.pass).toBe(false)
    expect(outcome.findings.map((item) => item.code)).toContain('REWORK_BUDGET_EXHAUSTED')
  })

  it('refreshes the budget after a reset', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT })
    rework(root, 'IMPL_MISMATCH')
    rework(root, 'IMPL_MISMATCH')
    rework(root, 'IMPL_MISMATCH')
    expect(advance(root).pass).toBe(false)
    reset(root)
    expect(advance(root).advanced).toBe(true)
  })

  it('throws on a corrupt state without touching the bytes', () => {
    const root = workspace({ [STATE_FILE]: '{broken' })
    const before = readFileSync(join(root, STATE_FILE), 'utf8')
    expect(() => advance(root)).toThrow(/not valid JSON/u)
    expect(readFileSync(join(root, STATE_FILE), 'utf8')).toBe(before)
  })
})

describe('rework', () => {
  it('counts a rework and reports the remaining budget', () => {
    const root = workspace()
    const outcome = rework(root, 'IMPL_MISMATCH')
    expect(outcome.rework).toEqual({ type: 'IMPL_MISMATCH', count: 1, budget: 3, exhausted: false })
    expect(readState(root).state.rework.IMPL_MISMATCH).toBe(1)
  })

  it('escalates once the budget is used up', () => {
    const root = workspace()
    // CONTRACT_CONFLICT tolerates one rework; the first one uses it up.
    const first = rework(root, 'CONTRACT_CONFLICT')
    expect(first.rework).toEqual({ type: 'CONTRACT_CONFLICT', count: 1, budget: 1, exhausted: true })
    expect(first.message).toMatch(/escalate/u)
    expect(rework(root, 'CONTRACT_CONFLICT').rework?.count).toBe(2)
  })

  it('keeps counters independent per failure type', () => {
    const root = workspace()
    rework(root, 'IMPL_MISMATCH')
    rework(root, 'TEST_FAIL')
    rework(root, 'TEST_FAIL')
    const { state } = readState(root)
    expect(state.rework.IMPL_MISMATCH).toBe(1)
    expect(state.rework.TEST_FAIL).toBe(2)
  })

  it('records both transitions in history', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT })
    advance(root)
    rework(root, 'DESIGN_UNFEASIBLE', '开发报接口不可实现')
    const { state } = readState(root)
    expect(state.history.map((event) => event.action)).toEqual(['advance', 'rework'])
    expect(state.history[1]?.note).toBe('开发报接口不可实现')
  })

  it('loses no count across twenty serial writes', () => {
    const root = workspace()
    for (let index = 0; index < 20; index += 1) rework(root, 'TEST_FAIL')
    expect(readState(root).state.rework.TEST_FAIL).toBe(20)
  })

  it('migrates a v1 file to version 2 on the first write', () => {
    const root = workspace({
      [STATE_FILE]: JSON.stringify({
        version: 1,
        stage: 'test',
        rework: { IMPL_MISMATCH: 2 },
        history: [],
      }),
    })
    const before = readState(root)
    expect(before.state.rework.IMPL_MISMATCH).toBe(2)
    expect(before.state.reworkStage).toBe('test')

    rework(root, 'IMPL_MISMATCH')
    const persisted = JSON.parse(readFileSync(join(root, STATE_FILE), 'utf8'))
    expect(persisted.version).toBe(2)
    expect(persisted.reworkStage).toBe('test')
    expect(persisted.rework.IMPL_MISMATCH).toBe(3)
  })

  it('declares exactly six failure types', () => {
    expect(FAILURE_TYPES).toHaveLength(6)
    expect(FAILURE_TYPES).not.toContain('DEPLOY_FALSE_GREEN')
  })
})

describe('reset', () => {
  it('returns to the first stage and clears counters', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT })
    advance(root)
    rework(root, 'IMPL_MISMATCH')
    reset(root)
    const { state } = readState(root)
    expect(state.stage).toBe('clarify')
    expect(state.reworkStage).toBe('clarify')
    expect(state.rework.IMPL_MISMATCH).toBe(0)
  })

  it('repairs a corrupt state file', () => {
    const root = workspace({ [STATE_FILE]: '{broken' })
    expect(reset(root).stage).toBe('clarify')
    const persisted = JSON.parse(readFileSync(join(root, STATE_FILE), 'utf8'))
    expect(persisted).toMatchObject({ version: 2, stage: 'clarify', reworkStage: 'clarify' })
  })

  it('clears the history too', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT })
    advance(root)
    reset(root)
    expect(readState(root).state.history).toEqual([])
  })
})

describe('state lock', () => {
  it('refuses to write while another writer holds the lock', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT })
    const lock = join(root, LOCK_FILE)
    mkdirSync(dirname(lock), { recursive: true })
    writeFileSync(lock, 'held', 'utf8')

    const started = Date.now()
    expect(() => advance(root)).toThrow(/locked by another process/u)
    expect(Date.now() - started).toBeGreaterThanOrEqual(300)
    // The refused write left no state behind.
    expect(existsSync(join(root, STATE_FILE))).toBe(false)
  })

  it('clears a stale lock left by a crashed writer', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT })
    const lock = join(root, LOCK_FILE)
    mkdirSync(dirname(lock), { recursive: true })
    writeFileSync(lock, 'held', 'utf8')
    const old = new Date(Date.now() - 30_000)
    utimesSync(lock, old, old)

    expect(advance(root).stage).toBe('design')
    expect(existsSync(lock)).toBe(false)
  })
})
