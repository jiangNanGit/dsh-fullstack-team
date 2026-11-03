import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { flowTools } from '../src/tools'
import { STATE_FILE } from '../src/state'

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
