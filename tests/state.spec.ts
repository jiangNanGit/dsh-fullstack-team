import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { advance, readState, reset, rework, stateFile, STATE_FILE, writeState } from '../src/state'

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

describe('state file', () => {
  it('starts at the first stage without writing anything', () => {
    const root = workspace()
    const { state, created } = readState(root)
    expect(created).toBe(true)
    expect(state.stage).toBe('clarify')
    expect(state.rework.IMPL_MISMATCH).toBe(0)
  })

  it('lives under .dsh/devflow/', () => {
    expect(STATE_FILE).toBe('.dsh/devflow/state.json')
    expect(stateFile('/repo/docs/dev/007')).toBe('/repo/docs/dev/007/.dsh/devflow/state.json')
  })

  it('survives a corrupt file by repairing it', () => {
    const root = workspace({ [STATE_FILE]: '{not json' })
    const { state } = readState(root)
    expect(state.stage).toBe('clarify')
    expect(state.history).toEqual([])
  })

  it('round-trips a written state', () => {
    const root = workspace()
    const { state } = readState(root)
    state.stage = 'build'
    writeState(root, state)
    expect(readState(root).state.stage).toBe('build')
    expect(JSON.parse(readFileSync(join(root, STATE_FILE), 'utf8')).version).toBe(1)
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

  it('walks the whole flow once every gate passes', () => {
    const root = workspace({
      'requirement.md': REQUIREMENT,
      'design.md': DESIGN,
      'api-contract.md': CONTRACT,
      'test-cases.md': '# 用例\n\n## FP-1\n正常创建。\n',
      'acceptance-report.md': '# 验收\n\n## FP-1\npass\n',
    })
    expect(advance(root).stage).toBe('design')
    expect(advance(root).stage).toBe('build')
    // build carries no gate of its own.
    expect(advance(root).stage).toBe('test')
    expect(advance(root).stage).toBe('accept')
    expect(advance(root).stage).toBe('ship')
    expect(advance(root).advanced).toBe(false)
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
})

describe('reset', () => {
  it('returns to the first stage and clears counters', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT })
    advance(root)
    rework(root, 'IMPL_MISMATCH')
    reset(root)
    const { state } = readState(root)
    expect(state.stage).toBe('clarify')
    expect(state.rework.IMPL_MISMATCH).toBe(0)
  })
})
