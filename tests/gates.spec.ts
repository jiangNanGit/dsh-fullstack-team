import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { endpoints, reportsOpenP0, runGate, runReview, unmatchedEndpoints } from '../src/gates/stages'

const temporary: string[] = []

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** Materialise a requirement directory from `{ relativePath: content }`. */
function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'devflow-gate-'))
  temporary.push(root)
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(root, relative)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, content, 'utf8')
  }
  return root
}

const REQUIREMENT = `# 需求

## 背景
商户需要自助下单。

## 功能点
- FP-1 创建订单
- FP-2 取消订单
`

const DESIGN = `# 设计

## 接口
调用 \`POST /api/orders\` 创建，\`POST /api/orders/cancel\` 取消。

## 数据
订单表新增 status 字段。
`

const CONTRACT = `# 契约

### POST /api/orders
body: { merchantId, items }

### POST /api/orders/cancel
body: { orderId }
`

const TEST_CASES = `# 用例

## FP-1 创建订单
正常创建 / 库存不足。

## FP-2 取消订单
正常取消 / 重复取消。
`

const ACCEPTANCE = `# 验收

## FP-1 创建订单
pass — 走查通过。

## FP-2 取消订单
pass — 走查通过。

## P0
P0 遗留：0
`

/** A review document with `count` verdicts. */
function reviewDoc(count: number): string {
  return `# 审查\n\n${Array.from({ length: count }, (_, index) => `- 条目 ${index + 1}：pass`).join('\n')}\n`
}

describe('endpoints', () => {
  it('reads endpoints out of inline code, keeping the method', () => {
    expect(endpoints('调用 `POST /api/orders` 与 `GET /api/orders/{id}`')).toEqual([
      { path: '/api/orders', method: 'POST' },
      { path: '/api/orders/{id}', method: 'GET' },
    ])
  })

  it('reads endpoints out of headings', () => {
    expect(endpoints('### POST /api/orders\nbody\n')).toEqual([{ path: '/api/orders', method: 'POST' }])
  })

  it('ignores code spans that are not paths', () => {
    expect(endpoints('`npm run build` 和 `status`')).toEqual([])
  })

  it('does not confuse two methods on the same path', () => {
    const designed = endpoints('`DELETE /api/orders`')
    const contracted = endpoints('### POST /api/orders')
    expect(unmatchedEndpoints(designed, contracted)).toEqual([{ path: '/api/orders', method: 'DELETE' }])
  })
})

describe('reportsOpenP0', () => {
  it('treats a zero count as closed', () => {
    expect(reportsOpenP0('P0 遗留：0')).toBe(false)
  })

  it('treats a positive count as open', () => {
    expect(reportsOpenP0('P0 遗留：2 未修复')).toBe(true)
  })

  it('ignores lines that are not about P0', () => {
    expect(reportsOpenP0('P1 遗留 3 条')).toBe(false)
  })
})

describe('clarify gate', () => {
  it('fails when the requirement is absent', () => {
    const root = workspace({})
    const result = runGate('clarify', root)
    expect(result.pass).toBe(false)
    expect(result.findings.map((item) => item.code)).toContain('FILE_MISSING')
  })

  it('fails when no functional point is declared', () => {
    const root = workspace({ 'requirement.md': '# 需求\n\n## 背景\n只有背景。\n' })
    const result = runGate('clarify', root)
    expect(result.pass).toBe(false)
    expect(result.findings.map((item) => item.code)).toContain('FP_MISSING')
  })

  it('passes a frozen requirement', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT })
    expect(runGate('clarify', root)).toMatchObject({ pass: true, stage: 'clarify' })
  })

  it('fails a draft that still carries a placeholder', () => {
    const root = workspace({ 'requirement.md': `${REQUIREMENT}\n## 待定\nTODO 等业务确认\n` })
    const result = runGate('clarify', root)
    expect(result.pass).toBe(false)
    expect(result.findings.map((item) => item.code)).toContain('PLACEHOLDER')
  })

  it('fails a declared section with no body', () => {
    const root = workspace({ 'requirement.md': `${REQUIREMENT}\n## 风控\n` })
    const result = runGate('clarify', root)
    expect(result.findings.map((item) => item.code)).toContain('EMPTY_SECTION')
  })

  it('enforces the project section list from devflow.config.json', () => {
    const root = workspace({
      'requirement.md': REQUIREMENT,
      'devflow.config.json': JSON.stringify({ requirementSections: ['背景', '风控'] }),
    })
    const result = runGate('clarify', root)
    expect(result.pass).toBe(false)
    expect(result.findings.map((item) => item.code)).toContain('SECTION_MISSING')
    expect(result.findings.find((item) => item.code === 'SECTION_MISSING')?.detail).toContain('风控')
  })
})

describe('design gate', () => {
  it('passes when design and contract agree', () => {
    const root = workspace({ 'design.md': DESIGN, 'api-contract.md': CONTRACT })
    expect(runGate('design', root).pass).toBe(true)
  })

  it('fails an endpoint that exists in the design but not in the contract', () => {
    const root = workspace({
      'design.md': `${DESIGN}\n还需要 \`DELETE /api/orders\`。\n`,
      'api-contract.md': CONTRACT,
    })
    const result = runGate('design', root)
    expect(result.pass).toBe(false)
    expect(result.findings.map((item) => item.code)).toContain('CONTRACT_MISSING')
  })

  it('fails an endpoint that exists in the contract but not in the design', () => {
    const root = workspace({
      'design.md': DESIGN,
      'api-contract.md': `${CONTRACT}\n### GET /api/orders/{id}\n`,
    })
    const result = runGate('design', root)
    expect(result.findings.map((item) => item.code)).toContain('CONTRACT_UNDESIGNED')
  })
})

describe('test gate', () => {
  it('passes when every functional point is covered', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT, 'test-cases.md': TEST_CASES })
    expect(runGate('test', root).pass).toBe(true)
  })

  it('fails a functional point with no case', () => {
    const root = workspace({
      'requirement.md': `${REQUIREMENT}- FP-3 退款\n`,
      'test-cases.md': TEST_CASES,
    })
    const result = runGate('test', root)
    expect(result.pass).toBe(false)
    expect(result.findings.find((item) => item.code === 'FP_UNCOVERED')?.detail).toContain('FP-3')
  })

  it('fails a case for a functional point that was never declared', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT, 'test-cases.md': `${TEST_CASES}\n## FP-9 幽灵\n多测了。\n` })
    const result = runGate('test', root)
    expect(result.findings.map((item) => item.code)).toContain('FP_ORPHAN')
  })
})

describe('accept gate', () => {
  it('passes a report that verdicts every functional point', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT, 'acceptance-report.md': ACCEPTANCE })
    expect(runGate('accept', root).pass).toBe(true)
  })

  it('fails when a functional point never appears in the report', () => {
    const root = workspace({
      'requirement.md': `${REQUIREMENT}- FP-3 退款\n`,
      'acceptance-report.md': ACCEPTANCE,
    })
    expect(runGate('accept', root).findings.map((item) => item.code)).toContain('FP_UNCOVERED')
  })

  it('fails when verdicts are fewer than the functional points', () => {
    const root = workspace({
      'requirement.md': `${REQUIREMENT}- FP-3 退款\n`,
      'acceptance-report.md': '# 验收\n\n## FP-1\npass\n\n## P0\nP0 遗留：0\n',
    })
    const codes = runGate('accept', root).findings.map((item) => item.code)
    expect(codes).toContain('VERDICT_SHORTFALL')
    expect(codes).toContain('FP_UNCOVERED')
  })

  it('fails an open P0', () => {
    const root = workspace({
      'requirement.md': REQUIREMENT,
      'acceptance-report.md': `${ACCEPTANCE}\n## P0\n- P0 遗留：2 未修复\n`,
    })
    const result = runGate('accept', root)
    expect(result.pass).toBe(false)
    expect(result.findings.map((item) => item.code)).toContain('P0_OPEN')
  })
})

describe('review gate', () => {
  it('fails a review that was not actually executed', () => {
    const root = workspace({ 'review-notes.md': reviewDoc(3) })
    const result = runReview(root)
    expect(result.pass).toBe(false)
    expect(result.findings.map((item) => item.code)).toContain('REVIEW_ITEM_NO_VERDICT')
  })

  it('passes a review with enough verdicts', () => {
    const root = workspace({ 'review-notes.md': reviewDoc(30) })
    expect(runReview(root).pass).toBe(true)
  })

  it('honours the configured verdict floor', () => {
    const root = workspace({
      'review-notes.md': reviewDoc(10),
      'devflow.config.json': JSON.stringify({ reviewMinVerdicts: 8 }),
    })
    expect(runReview(root).pass).toBe(true)
  })

  it('fails evidence that cites a file which does not exist', () => {
    const root = workspace({ 'review-notes.md': `${reviewDoc(30)}- 证据：src/missing.ts:12 pass\n` })
    const result = runReview(root)
    expect(result.findings.map((item) => item.code)).toContain('EVIDENCE_MISSING')
  })

  it('fails evidence that cites a line past the end of the file', () => {
    const root = workspace({
      'review-notes.md': `${reviewDoc(30)}- 证据：src/a.ts:99 pass\n`,
      'src/a.ts': 'export const a = 1\n',
    })
    const result = runReview(root)
    expect(result.findings.map((item) => item.code)).toContain('EVIDENCE_OUT_OF_RANGE')
  })

  it('passes evidence that resolves', () => {
    const root = workspace({
      'review-notes.md': `${reviewDoc(30)}- 证据：src/a.ts:1 pass\n`,
      'src/a.ts': 'export const a = 1\n',
    })
    expect(runReview(root).pass).toBe(true)
  })
})

describe('gate root', () => {
  it('rejects a root that does not exist', () => {
    expect(() => runGate('clarify', '/definitely/not/here')).toThrow(/does not exist/u)
  })

  it('rejects a config that is not a JSON object', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT, 'devflow.config.json': '[]' })
    expect(() => runGate('clarify', root)).toThrow(/JSON object/u)
  })
})
