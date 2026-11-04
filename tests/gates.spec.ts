import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  endpoints,
  parseEndpoint,
  reportsOpenP0,
  runGate,
  runReview,
  unmatchedEndpoints,
} from '../src/gates/stages'

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

/** Copy a fixture without the named files. */
function without(files: Record<string, string>, ...keys: string[]): Record<string, string> {
  const copy = { ...files }
  for (const key of keys) delete copy[key]
  return copy
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

const TEST_REPORT = `# 执行报告

## 执行结果
12 passed, 0 failed。
`

const UI_ACCEPTANCE = `# 界面验收

## 页面走查
订单页正常。
`

const EVIDENCE_SOURCE = 'export const a = 1\n'

const ACCEPTANCE = `# 验收

## FP-1 创建订单
pass — 证据：src/a.ts:1

## FP-2 取消订单
pass — 证据：src/a.ts:1

## P0
P0 遗留：0
`

/** A review document with `count` verdicts, each carrying resolvable evidence. */
function reviewDoc(count: number, line?: (index: number) => string): string {
  const body = Array.from(
    { length: count },
    (_, index) => line?.(index) ?? `- 条目 ${index + 1}：pass — 证据：src/a.ts:1`,
  )
  return `# 审查\n\n${body.join('\n')}\n`
}

/** The complete set of artifacts the acceptance stage reads. */
function acceptFiles(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'requirement.md': REQUIREMENT,
    'acceptance-report.md': ACCEPTANCE,
    'ui-acceptance.md': UI_ACCEPTANCE,
    'review-notes.md': reviewDoc(30),
    'src/a.ts': EVIDENCE_SOURCE,
    ...overrides,
  }
}

function codes(result: { findings: { code: string }[] }): string[] {
  return result.findings.map((item) => item.code)
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

  it('ignores prose, placeholders, wildcards, and regex literals that start with a slash', () => {
    expect(endpoints('抛 `/must be absolute/`、`/does not exist/`、`/not a directory/`')).toEqual([])
    expect(endpoints('路径分隔符统一为 `/`，Windows 也归一')).toEqual([])
    expect(parseEndpoint('/must be absolute/')).toBeUndefined()
    expect(parseEndpoint('/does not exist/')).toBeUndefined()
    expect(parseEndpoint('/')).toBeUndefined()
  })

  it('ignores placeholders, wildcards, and regex anchors inside an otherwise path-like span', () => {
    expect(parseEndpoint('/orders/<id>')).toBeUndefined()
    expect(parseEndpoint('/api/*')).toBeUndefined()
    expect(parseEndpoint('/^\\/v1\\/orders$/')).toBeUndefined()
    expect(parseEndpoint('/v1/orders\\?x=1')).toBeUndefined()
  })

  it.each([
    ['table row', '| POST | /api/orders |\n', [{ path: '/api/orders', method: 'POST' }]],
    ['inline code', '调用 `GET /v1/orders?x=1`\n', [{ path: '/v1/orders', method: 'GET' }]],
    ['heading', '### DELETE /orders/\n', [{ path: '/orders', method: 'DELETE' }]],
  ] as const)('recognises and normalises an endpoint written as a %s', (_shape, text, expected) => {
    expect(endpoints(text)).toEqual(expected)
  })

  it('does not confuse two methods on the same path', () => {
    const designed = endpoints('`DELETE /api/orders`')
    const contracted = endpoints('### POST /api/orders')
    expect(unmatchedEndpoints(designed, contracted)).toEqual([{ path: '/api/orders', method: 'DELETE' }])
  })

  it('reads a table row with a method cell and a path cell', () => {
    expect(endpoints('| POST | /api/orders |\n')).toEqual([{ path: '/api/orders', method: 'POST' }])
  })

  it('reads a table row whose cells carry backticks or bold markers', () => {
    expect(endpoints('| **POST** | `/api/orders` |\n')).toEqual([{ path: '/api/orders', method: 'POST' }])
  })

  it('treats a query string as presentation, not identity', () => {
    expect(endpoints('`GET /api/orders?page=1`')).toEqual(endpoints('`GET /api/orders`'))
  })

  it('treats a trailing slash as equivalent', () => {
    expect(endpoints('`GET /api/orders/`')).toEqual(endpoints('`GET /api/orders`'))
  })

  it('normalises a lowercase method to uppercase', () => {
    expect(endpoints('| post | /api/orders |\n')).toEqual([{ path: '/api/orders', method: 'POST' }])
  })

  it('does not read a table header or separator row', () => {
    expect(endpoints('| 方法 | 路径 |\n|---|---|\n| POST | /api/orders |\n')).toEqual([
      { path: '/api/orders', method: 'POST' },
    ])
  })

  it('ignores table rows inside a fenced code block', () => {
    expect(endpoints('```\n| POST | /api/examples |\n```\n')).toEqual([])
    expect(endpoints('~~~\n| POST | /api/examples |\n~~~\n')).toEqual([])
  })

  it('matches a design and a contract that normalise to the same endpoint', () => {
    const root = workspace({
      'design.md': '# 设计\n\n## 接口\n调用 `GET /api/orders?page=1` 列表。\n',
      'api-contract.md': '# 契约\n\n### GET /api/orders\n\nbody: none\n',
    })
    expect(codes(runGate('design', root))).toEqual([])
  })
})

describe('parseEndpoint', () => {
  it('rejects a mention without a leading slash', () => {
    expect(parseEndpoint('npm run build')).toBeUndefined()
    expect(parseEndpoint('src/a.ts')).toBeUndefined()
  })

  it('rejects a bare slash and anything carrying whitespace or regex/glob metacharacters', () => {
    for (const raw of ['/', '/must be absolute/', '/does not exist/', '/orders/<id>', '/api/*', '/^\\/v1$/', '/a\\b']) {
      expect(parseEndpoint(raw), raw).toBeUndefined()
    }
  })

  it('still accepts real routes', () => {
    expect(parseEndpoint('/api/orders')).toEqual({ path: '/api/orders' })
    expect(parseEndpoint('/orders/:id')).toEqual({ path: '/orders/:id' })
    expect(parseEndpoint('GET /v1/x?y=1')).toEqual({ path: '/v1/x', method: 'GET' })
  })
})

describe('reportsOpenP0', () => {
  it.each([
    ['P0 遗留：0', false],
    ['P0 未关闭：2', true],
    ['P0 剩余 2 项', true],
    ['blocking P0: 1', true],
    ['P0 已关闭：3', false],
    ['P0：0', false],
    ['本轮无 P0', false],
    ['P0 2', true],
    ['P1 遗留 3 条', false],
    ['P0 已于 1.2 修复', false],
  ])('reads %s as open=%s', (line, expected) => {
    expect(reportsOpenP0(line)).toBe(expected)
  })
})

describe('container headings', () => {
  it('does not report a section whose only content is a deeper heading', () => {
    const root = workspace({
      'requirement.md': '# 需求\n\n## 功能点\n\n### FP-1 创建订单\n创建订单。\n',
    })
    const result = runGate('clarify', root)
    expect(codes(result)).not.toContain('EMPTY_SECTION')
    expect(result.pass).toBe(true)
  })

  it('still reports a truly empty subsection', () => {
    const root = workspace({
      'requirement.md': '# 需求\n\n## 功能点\n正文说明。\n\n### FP-1 创建订单\n',
    })
    expect(codes(runGate('clarify', root))).toContain('EMPTY_SECTION')
  })

  it('still reports an empty section followed by a shallower heading', () => {
    const root = workspace({ 'requirement.md': '# 需求\n\n## 背景\n\n## 功能点\n- FP-1 x\n' })
    expect(codes(runGate('clarify', root))).toContain('EMPTY_SECTION')
  })
})

describe('clarify gate', () => {
  it('fails when the requirement is absent', () => {
    const root = workspace({})
    const result = runGate('clarify', root)
    expect(result.pass).toBe(false)
    expect(codes(result)).toContain('FILE_MISSING')
  })

  it('fails when no functional point is declared', () => {
    const root = workspace({ 'requirement.md': '# 需求\n\n## 背景\n只有背景。\n' })
    const result = runGate('clarify', root)
    expect(result.pass).toBe(false)
    expect(codes(result)).toContain('FP_MISSING')
  })

  it('passes a frozen requirement', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT })
    expect(runGate('clarify', root)).toMatchObject({ pass: true, stage: 'clarify' })
  })

  it('fails a draft that still carries a placeholder', () => {
    const root = workspace({ 'requirement.md': `${REQUIREMENT}\n## 待定\nTODO 等业务确认\n` })
    const result = runGate('clarify', root)
    expect(result.pass).toBe(false)
    expect(codes(result)).toContain('PLACEHOLDER')
  })

  it('fails a declared section with no body', () => {
    const root = workspace({ 'requirement.md': `${REQUIREMENT}\n## 风控\n` })
    const result = runGate('clarify', root)
    expect(codes(result)).toContain('EMPTY_SECTION')
  })

  it('enforces the project section list from devflow.config.json', () => {
    const root = workspace({
      'requirement.md': REQUIREMENT,
      'devflow.config.json': JSON.stringify({ requirementSections: ['背景', '风控'] }),
    })
    const result = runGate('clarify', root)
    expect(result.pass).toBe(false)
    expect(codes(result)).toContain('SECTION_MISSING')
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
    expect(codes(result)).toContain('CONTRACT_MISSING')
  })

  it('fails an endpoint that exists in the contract but not in the design', () => {
    const root = workspace({
      'design.md': DESIGN,
      'api-contract.md': `${CONTRACT}\n### GET /api/orders/{id}\n`,
    })
    expect(codes(runGate('design', root))).toContain('CONTRACT_UNDESIGNED')
  })
})

describe('test gate', () => {
  const complete = {
    'requirement.md': REQUIREMENT,
    'test-cases.md': TEST_CASES,
    'test-report.md': TEST_REPORT,
  }

  it('reads three artifacts in a fixed order', () => {
    const root = workspace(complete)
    const result = runGate('test', root)
    expect(result.pass).toBe(true)
    expect(result.checked).toEqual(['requirement.md', 'test-cases.md', 'test-report.md'])
  })

  it('fails when the execution report is missing', () => {
    const root = workspace(without(complete, 'test-report.md'))
    const result = runGate('test', root)
    expect(result.pass).toBe(false)
    expect(result.findings.find((item) => item.code === 'FILE_MISSING')?.path).toBe('test-report.md')
  })

  it('fails an empty execution report', () => {
    const root = workspace({ ...complete, 'test-report.md': '   \n' })
    expect(codes(runGate('test', root))).toContain('FILE_EMPTY')
  })

  it('fails an execution report that only carries an empty heading', () => {
    const root = workspace({ ...complete, 'test-report.md': '# 执行报告\n\n## 执行结果\n' })
    expect(codes(runGate('test', root))).toContain('EMPTY_SECTION')
  })

  it('enforces configured report sections', () => {
    const root = workspace({
      ...complete,
      'devflow.config.json': JSON.stringify({ testReportSections: ['执行明细'] }),
    })
    expect(codes(runGate('test', root))).toContain('SECTION_MISSING')
  })

  it('honours a renamed report', () => {
    const root = workspace({
      ...without(complete, 'test-report.md'),
      'run-log.md': TEST_REPORT,
      'devflow.config.json': JSON.stringify({ files: { testreport: 'run-log.md' } }),
    })
    const result = runGate('test', root)
    expect(result.pass).toBe(true)
    expect(result.checked).toContain('run-log.md')
  })

  it('fails a functional point with no case', () => {
    const root = workspace({ ...complete, 'requirement.md': `${REQUIREMENT}- FP-3 退款\n` })
    const result = runGate('test', root)
    expect(result.pass).toBe(false)
    expect(result.findings.find((item) => item.code === 'FP_UNCOVERED')?.detail).toContain('FP-3')
  })

  it('fails a case for a functional point that was never declared', () => {
    const root = workspace({ ...complete, 'test-cases.md': `${TEST_CASES}\n## FP-9 幽灵\n多测了。\n` })
    expect(codes(runGate('test', root))).toContain('FP_ORPHAN')
  })
})

describe('accept gate', () => {
  it('passes a report where every functional point has a verdict and evidence', () => {
    const root = workspace(acceptFiles())
    const result = runGate('accept', root)
    expect(result.pass).toBe(true)
    expect(result.stage).toBe('accept')
  })

  it('fails a verdict with no evidence', () => {
    const root = workspace(
      acceptFiles({
        'acceptance-report.md': `# 验收\n\n## FP-1 创建订单\npass — 走查通过。\n\n## FP-2 取消订单\npass — 证据：src/a.ts:1\n`,
      }),
    )
    expect(codes(runGate('accept', root))).toContain('ACCEPT_EVIDENCE_MISSING')
  })

  it('fails a functional point that appears without any verdict', () => {
    const root = workspace(
      acceptFiles({
        'acceptance-report.md': `# 验收\n\n## FP-1 创建订单\n已在 src/a.ts:1 实现。\n\n## FP-2 取消订单\npass — 证据：src/a.ts:1\n`,
      }),
    )
    expect(codes(runGate('accept', root))).toContain('VERDICT_MISSING')
  })

  it('accepts a summary table row that carries verdict and evidence', () => {
    const root = workspace(
      acceptFiles({
        'acceptance-report.md': `# 验收\n\n| FP | 结论 | 证据 |\n|---|---|---|\n| FP-1 | pass | src/a.ts:1 |\n| FP-2 | pass | src/a.ts:1 |\n`,
      }),
    )
    expect(runGate('accept', root).pass).toBe(true)
  })

  it('accepts the first qualifying window when the id appears more than once', () => {
    const root = workspace(
      acceptFiles({
        'acceptance-report.md': `# 验收\n\n## 覆盖 FP-1\n正文说明。\n\n## FP-1 创建订单\npass — 证据：src/a.ts:1\n\n## FP-2 取消订单\npass — 证据：src/a.ts:1\n`,
      }),
    )
    expect(runGate('accept', root).pass).toBe(true)
  })

  it('reports a missing evidence file without also reporting missing accept evidence', () => {
    const root = workspace(
      acceptFiles({
        'acceptance-report.md': `# 验收\n\n## FP-1 创建订单\npass — 证据：src/missing.ts:1\n\n## FP-2 取消订单\npass — 证据：src/a.ts:1\n`,
      }),
    )
    const result = codes(runGate('accept', root))
    expect(result).toContain('EVIDENCE_MISSING')
    expect(result).not.toContain('ACCEPT_EVIDENCE_MISSING')
  })

  it('blocks a P0 that is still open', () => {
    const root = workspace(acceptFiles({ 'acceptance-report.md': `${ACCEPTANCE}- P0 未关闭：2\n` }))
    const result = runGate('accept', root)
    expect(result.pass).toBe(false)
    expect(codes(result)).toContain('P0_OPEN')
  })

  it('fails a functional point never mentioned in the report', () => {
    const root = workspace(acceptFiles({ 'requirement.md': `${REQUIREMENT}- FP-3 退款\n` }))
    expect(codes(runGate('accept', root))).toContain('FP_UNCOVERED')
  })

  it('fails when verdicts are fewer than the functional points', () => {
    const root = workspace(
      acceptFiles({
        'requirement.md': `${REQUIREMENT}- FP-3 退款\n`,
        'acceptance-report.md': '# 验收\n\n## FP-1\npass — 证据：src/a.ts:1\n\n## P0\nP0 遗留：0\n',
      }),
    )
    const result = codes(runGate('accept', root))
    expect(result).toContain('VERDICT_SHORTFALL')
    expect(result).toContain('FP_UNCOVERED')
  })
})

describe('accept gate · UI artifact', () => {
  it('fails when the UI acceptance artifact is missing', () => {
    const root = workspace(without(acceptFiles(), 'ui-acceptance.md'))
    const result = runGate('accept', root)
    expect(result.pass).toBe(false)
    expect(result.findings.find((item) => item.code === 'FILE_MISSING')?.path).toBe('ui-acceptance.md')
  })

  it('waives the artifact with a reason and says so on every run', () => {
    const root = workspace({
      ...without(acceptFiles(), 'ui-acceptance.md'),
      'devflow.config.json': JSON.stringify({ ui: { applicable: false, reason: '纯后端项目，无界面变更' } }),
    })
    const result = runGate('accept', root)
    expect(result.pass).toBe(true)
    expect(result.checked).not.toContain('ui-acceptance.md')
    const waived = result.findings.find((item) => item.code === 'UI_ACCEPTANCE_WAIVED')
    expect(waived?.severity).toBe('warning')
    expect(waived?.detail).toContain('纯后端项目，无界面变更')
    expect(waived?.path).toBe('devflow.config.json')
  })

  it('rejects a waiver without a reason', () => {
    const root = workspace({
      ...without(acceptFiles(), 'ui-acceptance.md'),
      'devflow.config.json': JSON.stringify({ ui: { applicable: false } }),
    })
    const result = runGate('accept', root)
    expect(result.pass).toBe(false)
    expect(codes(result)).toContain('UI_WAIVER_NO_REASON')
  })

  it('treats an explicit applicable:true like an absent key', () => {
    const root = workspace({
      ...acceptFiles(),
      'devflow.config.json': JSON.stringify({ ui: { applicable: true } }),
    })
    expect(runGate('accept', root).pass).toBe(true)
  })

  it('does not let a warning swallow another error', () => {
    const root = workspace({
      ...without(acceptFiles(), 'ui-acceptance.md'),
      'acceptance-report.md': `${ACCEPTANCE}- P0 未关闭：2\n`,
      'devflow.config.json': JSON.stringify({ ui: { applicable: false, reason: '纯后端' } }),
    })
    const result = runGate('accept', root)
    expect(result.pass).toBe(false)
    expect(codes(result)).toContain('UI_ACCEPTANCE_WAIVED')
    expect(codes(result)).toContain('P0_OPEN')
  })
})

describe('review gate', () => {
  it('fails thirty verdict lines that carry no evidence, one finding per line', () => {
    const root = workspace({
      'review-notes.md': reviewDoc(30, (index) => `- 条目 ${index + 1}：通过`),
      'src/a.ts': EVIDENCE_SOURCE,
    })
    const result = runReview(root)
    expect(result.pass).toBe(false)
    expect(codes(result).filter((code) => code === 'REVIEW_EVIDENCE_MISSING')).toHaveLength(30)
  })

  it('passes when the verdict and the evidence share a line', () => {
    const root = workspace({ 'review-notes.md': reviewDoc(30), 'src/a.ts': EVIDENCE_SOURCE })
    expect(runReview(root).pass).toBe(true)
  })

  it('passes when the evidence sits on the line after the verdict', () => {
    const rest = Array.from({ length: 29 }, (_, index) => `- 条目 ${index + 2}：pass — 证据：src/a.ts:1`)
    const root = workspace({
      'review-notes.md': `# 审查\n\n- 条目 1：pass\n  证据：src/a.ts:1\n${rest.join('\n')}\n`,
      'src/a.ts': EVIDENCE_SOURCE,
    })
    expect(runReview(root).pass).toBe(true)
  })

  it('reports only the missing file when a citation does not resolve', () => {
    const lines = Array.from(
      { length: 30 },
      (_, index) => `- 条目 ${index + 1}：pass — 证据：${index === 0 ? 'src/missing.ts:1' : 'src/a.ts:1'}`,
    )
    const root = workspace({ 'review-notes.md': `# 审查\n\n${lines.join('\n')}\n`, 'src/a.ts': EVIDENCE_SOURCE })
    const result = codes(runReview(root))
    expect(result).toContain('EVIDENCE_MISSING')
    expect(result).not.toContain('REVIEW_EVIDENCE_MISSING')
  })

  it('fails evidence that cites a line past the end of the file', () => {
    const lines = Array.from(
      { length: 30 },
      (_, index) => `- 条目 ${index + 1}：pass — 证据：${index === 0 ? 'src/a.ts:99' : 'src/a.ts:1'}`,
    )
    const root = workspace({ 'review-notes.md': `# 审查\n\n${lines.join('\n')}\n`, 'src/a.ts': EVIDENCE_SOURCE })
    expect(codes(runReview(root))).toContain('EVIDENCE_OUT_OF_RANGE')
  })

  it('fails a citation below line one', () => {
    const lines = Array.from(
      { length: 30 },
      (_, index) => `- 条目 ${index + 1}：pass — 证据：${index === 0 ? 'src/a.ts:0' : 'src/a.ts:1'}`,
    )
    const root = workspace({ 'review-notes.md': `# 审查\n\n${lines.join('\n')}\n`, 'src/a.ts': EVIDENCE_SOURCE })
    expect(codes(runReview(root))).toContain('EVIDENCE_OUT_OF_RANGE')
  })

  it('rejects an upward-traversing citation without reading outside the root', () => {
    const lines = Array.from(
      { length: 30 },
      (_, index) => `- 条目 ${index + 1}：pass — 证据：${index === 0 ? '../../x.ts:1' : 'src/a.ts:1'}`,
    )
    const root = workspace({ 'review-notes.md': `# 审查\n\n${lines.join('\n')}\n`, 'src/a.ts': EVIDENCE_SOURCE })
    const result = codes(runReview(root))
    expect(result).toContain('EVIDENCE_OUTSIDE_ROOT')
    expect(result).not.toContain('EVIDENCE_MISSING')
  })

  it('rejects an absolute citation outside the root', () => {
    const lines = Array.from(
      { length: 30 },
      (_, index) => `- 条目 ${index + 1}：pass — 证据：${index === 0 ? '/etc/hosts.ts:1' : 'src/a.ts:1'}`,
    )
    const root = workspace({ 'review-notes.md': `# 审查\n\n${lines.join('\n')}\n`, 'src/a.ts': EVIDENCE_SOURCE })
    expect(codes(runReview(root))).toContain('EVIDENCE_OUTSIDE_ROOT')
  })

  it('does not treat a URL or a host:port as evidence', () => {
    const doc = `${reviewDoc(30)}\n- 参考 https://example.com:8080/api/orders\n- 服务 example.com:8080 在运行\n- 旧服务 example.com:80 仍在运行\n`
    const root = workspace({ 'review-notes.md': doc, 'src/a.ts': EVIDENCE_SOURCE })
    const result = codes(runReview(root))
    expect(result.filter((code) => code.startsWith('EVIDENCE_'))).toEqual([])
    expect(result.filter((code) => code === 'REVIEW_EVIDENCE_MISSING')).toEqual([])
  })

  it('fails an evidence path that is a directory', () => {
    const lines = Array.from(
      { length: 30 },
      (_, index) => `- 条目 ${index + 1}：pass — 证据：${index === 0 ? 'bundle.md:1' : 'src/a.ts:1'}`,
    )
    const root = workspace({ 'review-notes.md': `# 审查\n\n${lines.join('\n')}\n`, 'src/a.ts': EVIDENCE_SOURCE })
    mkdirSync(join(root, 'bundle.md'))
    const finding = runReview(root).findings.find((item) => item.code === 'EVIDENCE_MISSING')
    expect(finding?.detail).toContain('不是普通文件')
  })

  it('counts every verdict word', () => {
    const words = ['通过', '不通过', '不适用', 'pass', 'fail', 'n/a']
    const doc = `# 审查\n\n${words.map((word, index) => `- 条目 ${index + 1}：${word} — 证据：src/a.ts:1`).join('\n')}\n`
    const root = workspace({
      'review-notes.md': doc,
      'src/a.ts': EVIDENCE_SOURCE,
      'devflow.config.json': JSON.stringify({ reviewMinVerdicts: 6 }),
    })
    expect(runReview(root).pass).toBe(true)
  })

  it('reports only the shortfall when 29 evidenced verdicts meet a floor of 30', () => {
    const root = workspace({ 'review-notes.md': reviewDoc(29), 'src/a.ts': EVIDENCE_SOURCE })
    const result = codes(runReview(root))
    expect(result).toContain('REVIEW_ITEM_NO_VERDICT')
    expect(result).not.toContain('REVIEW_EVIDENCE_MISSING')
  })

  it('honours the configured verdict floor', () => {
    const root = workspace({
      'review-notes.md': reviewDoc(10),
      'src/a.ts': EVIDENCE_SOURCE,
      'devflow.config.json': JSON.stringify({ reviewMinVerdicts: 8 }),
    })
    expect(runReview(root).pass).toBe(true)
  })
})

describe('accept composite gate', () => {
  it('fails when the review document is absent', () => {
    const root = workspace(without(acceptFiles(), 'review-notes.md'))
    const result = runGate('accept', root)
    expect(result.pass).toBe(false)
    expect(result.findings.find((item) => item.code === 'FILE_MISSING')?.path).toBe('review-notes.md')
  })

  it('fails when the review carries fewer than the floor', () => {
    const root = workspace(acceptFiles({ 'review-notes.md': reviewDoc(29) }))
    expect(codes(runGate('accept', root))).toContain('REVIEW_ITEM_NO_VERDICT')
  })

  it('keeps both families of findings when acceptance and review both fail', () => {
    const root = workspace(
      acceptFiles({
        'acceptance-report.md': `${ACCEPTANCE}- P0 未关闭：2\n`,
        'review-notes.md': reviewDoc(29),
      }),
    )
    const result = codes(runGate('accept', root))
    expect(result).toContain('P0_OPEN')
    expect(result).toContain('REVIEW_ITEM_NO_VERDICT')
  })

  it('returns the accept stage and the full read list in order', () => {
    const root = workspace(acceptFiles())
    const result = runGate('accept', root)
    expect(result.stage).toBe('accept')
    expect(result.checked).toEqual([
      'requirement.md',
      'acceptance-report.md',
      'ui-acceptance.md',
      'review-notes.md',
    ])
  })

  it('reports the review-origin findings exactly as the standalone review does', () => {
    const root = workspace(acceptFiles({ 'review-notes.md': reviewDoc(29) }))
    const merged = runGate('accept', root).findings.filter((item) => item.path === 'review-notes.md').map((item) => item.code)
    const standalone = runReview(root).findings.map((item) => item.code)
    expect([...merged].sort()).toEqual([...standalone].sort())
  })
})

describe('gate root', () => {
  it('rejects a relative root before resolving it', () => {
    expect(() => runGate('clarify', '.')).toThrow(/must be absolute/u)
    expect(() => runReview('.')).toThrow(/must be absolute/u)
  })

  it('rejects a root that does not exist', () => {
    expect(() => runGate('clarify', '/definitely/not/here')).toThrow(/does not exist/u)
  })

  it('rejects a file used as a root', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT })
    expect(() => runGate('clarify', join(root, 'requirement.md'))).toThrow(/not a directory/u)
  })

  it('rejects a config that is not a JSON object', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT, 'devflow.config.json': '[]' })
    expect(() => runGate('clarify', root)).toThrow(/JSON object/u)
  })

  it('rejects a config with a mistyped known key and names the key', () => {
    const root = workspace({
      'requirement.md': REQUIREMENT,
      'devflow.config.json': JSON.stringify({ reviewMinVerdicts: '30' }),
    })
    expect(() => runGate('clarify', root)).toThrow(/reviewMinVerdicts/u)
  })

  it('rejects a non-object ui key and names the key', () => {
    const root = workspace({ 'requirement.md': REQUIREMENT, 'devflow.config.json': JSON.stringify({ ui: [] }) })
    expect(() => runGate('clarify', root)).toThrow(/"ui"/u)
  })

  it('rejects a non-array section list', () => {
    const root = workspace({
      'requirement.md': REQUIREMENT,
      'devflow.config.json': JSON.stringify({ requirementSections: '背景' }),
    })
    expect(() => runGate('clarify', root)).toThrow(/requirementSections/u)
  })
})
