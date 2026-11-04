import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { flowTools } from '../src/tools'
import { FAILURE_BUDGETS, FAILURE_TYPES, STATE_FILE } from '../src/state'

const temporary: string[] = []

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** Materialise a requirement directory from `{ relativePath: content }`. */
function workspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'devflow-tools-'))
  temporary.push(root)
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(root, relative)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, content, 'utf8')
  }
  return root
}

/** Invoke a tool definition the way the runtime does. */
async function call(tool: unknown, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const definition = tool as { execute?: unknown; name?: string; toolName?: string }
  const execute = definition.execute as ((input: Record<string, unknown>, exec: unknown) => Promise<unknown>) | undefined
  if (typeof execute !== 'function') throw new Error('tool has no execute')
  return (await execute(args, {})) as Record<string, unknown>
}

describe('flowTools', () => {
  it('builds the two flow tools', () => {
    const tools = flowTools()
    expect(tools).toHaveLength(2)
    const names = tools.map((tool) => {
      const definition = tool as { name?: string }
      return definition.name
    })
    expect(names).toEqual(['devflow_gate', 'devflow_state'])
  })

  it('reports a passing gate through the tool boundary', async () => {
    const root = workspace({ 'requirement.md': '# 需求\n\n## 功能点\n- FP-1 创建订单\n' })
    const [gate] = flowTools()
    const result = await call(gate, { stage: 'clarify', root })
    expect(result['stage']).toBe('clarify')
    expect(result['pass']).toBe(true)
    expect(result['findings']).toEqual([])
    expect(result['checked']).toEqual(['requirement.md'])
  })

  it('reports findings rather than throwing on a failing gate', async () => {
    const root = workspace({})
    const [gate] = flowTools()
    const result = await call(gate, { stage: 'clarify', root })
    expect(result['pass']).toBe(false)
    expect((result['findings'] as unknown[]).length).toBeGreaterThan(0)
  })

  it('wires the review check through the same tool', async () => {
    const root = workspace({ 'review-notes.md': '# 审查\n\n- 1 pass\n' })
    const [gate] = flowTools()
    const result = await call(gate, { stage: 'review', root })
    expect(result['pass']).toBe(false)
    expect((result['findings'] as { code: string }[]).map((item) => item.code)).toContain('REVIEW_ITEM_NO_VERDICT')
  })

  it('advances state through the tool boundary', async () => {
    const root = workspace({ 'requirement.md': '# 需求\n\n## 功能点\n- FP-1 创建订单\n' })
    const [, state] = flowTools()
    const advanced = await call(state, { action: 'advance', root })
    expect(advanced['stage']).toBe('design')
    expect(advanced['advanced']).toBe(true)

    const read = await call(state, { action: 'read', root })
    expect(read['message']).toContain('stage design')
  })

  it('persists rework and refuses to advance a failing stage', async () => {
    const root = workspace({})
    const [, state] = flowTools()

    const reworked = await call(state, { action: 'rework', root, failure: 'IMPL_MISMATCH' })
    expect(reworked['rework']).toMatchObject({ type: 'IMPL_MISMATCH', count: 1, budget: 3, exhausted: false })

    const blocked = await call(state, { action: 'advance', root })
    expect(blocked['advanced']).toBe(false)
    expect(blocked['pass']).toBe(false)

    // The state file proves the block was real, not just a message.
    const persisted = JSON.parse(readFileSync(join(root, STATE_FILE), 'utf8'))
    expect(persisted.stage).toBe('clarify')
    expect(persisted.rework.IMPL_MISMATCH).toBe(1)
  })

  it('rejects rework without a failure type', async () => {
    const root = workspace()
    const [, state] = flowTools()
    await expect(call(state, { action: 'rework', root })).rejects.toThrow(/needs a `failure`/u)
  })
})

describe('flowTools · safety and budgets', () => {
  it('declares exactly six failure types on the parameter enum', () => {
    const [, state] = flowTools()
    const parameters = (state as unknown as {
      parameters?: { properties?: { failure?: { enum?: string[] } } }
    }).parameters
    const declared = parameters?.properties?.failure?.enum
    expect(declared).toEqual([...FAILURE_TYPES])
    expect(declared).not.toContain('DEPLOY_FALSE_GREEN')
    expect(declared).toHaveLength(6)
  })

  it('refuses advance through the tool once the stage budget is exhausted', async () => {
    const root = workspace({ 'requirement.md': '# 需求\n\n## 功能点\n- FP-1 创建订单\n' })
    const [, state] = flowTools()
    for (let index = 0; index < 3; index += 1) {
      await call(state, { action: 'rework', root, failure: 'IMPL_MISMATCH' })
    }

    const blocked = await call(state, { action: 'advance', root })
    expect(blocked['pass']).toBe(false)
    expect(blocked['advanced']).toBe(false)
    expect((blocked['findings'] as { code: string }[]).map((item) => item.code)).toContain(
      'REWORK_BUDGET_EXHAUSTED',
    )

    const read = await call(state, { action: 'read', root })
    const message = String(read['message'])
    expect(message).toContain('exhausted')
    expect(message).toContain('上报')
  })

  it('reports a corrupt state instead of silently resetting', async () => {
    const root = workspace({ [STATE_FILE]: '{broken' })
    const [, state] = flowTools()
    await expect(call(state, { action: 'read', root })).rejects.toThrow(/not valid JSON/u)
  })

  it('rejects a relative root', async () => {
    const [, state] = flowTools()
    await expect(call(state, { action: 'read', root: '.' })).rejects.toThrow(/must be absolute/u)
  })

  it('surfaces a failure type this version no longer knows', async () => {
    const root = workspace({
      [STATE_FILE]: JSON.stringify({ version: 1, stage: 'test', rework: { DEPLOY_FALSE_GREEN: 2 }, history: [] }),
    })
    const [, state] = flowTools()
    const read = await call(state, { action: 'read', root })
    expect(String(read['message'])).toContain('DEPLOY_FALSE_GREEN')
    expect(String(read['message'])).toContain('ignored')
  })
})

describe('documented口径', () => {
  const codes = [
    'FILE_MISSING',
    'FILE_NOT_FILE',
    'FILE_EMPTY',
    'PLACEHOLDER',
    'EMPTY_SECTION',
    'SECTION_MISSING',
    'FP_MISSING',
    'FP_UNCOVERED',
    'FP_ORPHAN',
    'TEST_CASE_EMPTY',
    'CONTRACT_MISSING',
    'CONTRACT_UNDESIGNED',
    'VERDICT_SHORTFALL',
    'VERDICT_MISSING',
    'ACCEPT_EVIDENCE_MISSING',
    'P0_OPEN',
    'REVIEW_ITEM_NO_VERDICT',
    'REVIEW_EVIDENCE_MISSING',
    'EVIDENCE_MISSING',
    'EVIDENCE_OUT_OF_RANGE',
    'EVIDENCE_OUTSIDE_ROOT',
    'UI_ACCEPTANCE_WAIVED',
    'UI_WAIVER_NO_REASON',
    'REWORK_BUDGET_EXHAUSTED',
  ]

  it('docs/001 speaks of six stages, four gates plus one check, and the 30-item machine floor', () => {
    const doc = readFileSync(resolve('docs/001-design.md'), 'utf8')
    expect(doc).not.toContain('五道门')
    expect(doc).not.toContain('七步')
    expect(doc).toContain('六阶段')
    expect(doc).toContain('四道阶段门')
    expect(doc).toContain('115 条')
    expect(doc).toContain('30 条')
  })

  it('docs/003 lists every finding code and the six stage-scoped budgets', () => {
    const doc = readFileSync(resolve('docs/003-tools.md'), 'utf8')
    for (const code of codes) expect(doc).toContain(code)
    expect(doc).not.toContain('DEPLOY_FALSE_GREEN')

    const budgeted = new Map<string, number>()
    for (const match of doc.matchAll(/\| `([A-Z0-9_]+)` \| (\d+) \|/gu)) {
      const [, type, budget] = match
      if (type !== undefined && budget !== undefined) budgeted.set(type, Number(budget))
    }
    expect(Object.fromEntries(budgeted)).toEqual({ ...FAILURE_BUDGETS })
  })

  it('docs/003 documents the artifacts the test and accept gates read', () => {
    const doc = readFileSync(resolve('docs/003-tools.md'), 'utf8')
    for (const name of ['test-report.md', 'ui-acceptance.md', 'review-notes.md']) expect(doc).toContain(name)
  })
})
