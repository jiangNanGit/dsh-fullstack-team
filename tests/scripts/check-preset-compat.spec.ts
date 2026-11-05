import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * The preset compatibility checker, exercised at both ends: the pure parse/diff
 * functions pin the three drift classes, and the process cases pin the asar read
 * plus the exit codes the build relies on.
 *
 * `scripts/check-preset-compat.mjs` is plain ESM with no declaration file, so the
 * subset used here is declared locally and the import carries a suppression.
 */

interface Row {
  id: string
  name?: string
  configLines: string[]
  indent: number
  depth: number
  line: number
}

interface Drift {
  id: string
  kind: 'missing-row' | 'name-changed' | 'config-changed'
  reason: string
  template: Row | null
  standard: Row | null
  config?: { onlyInTemplate: string[]; onlyInStandard: string[] }
}

interface Report {
  status: 'ok' | 'drift' | 'skip' | 'error'
  reason?: string
  standardLines?: number
  rows: { template: number; standard: number }
  drifts: Drift[]
}

interface Checker {
  parseRows(text: string): Row[]
  diffRows(templateRows: Row[], standardRows: Row[]): Drift[]
  checkPresetCompat(options?: { asarPath?: string; templatePath?: string }): Report
}

// @ts-expect-error -- plain ESM script; the shape used by the cases is declared above
import * as checker from '../../scripts/check-preset-compat.mjs'

const { parseRows, diffRows, checkPresetCompat } = checker as unknown as Checker

const here = fileURLToPath(new URL('../../', import.meta.url))
const script = join(here, 'scripts', 'check-preset-compat.mjs')
const installScript = join(here, 'scripts', 'install-presets.mjs')
const templatePath = join(here, 'templates', 'preset.template.yml')
const STANDARD_ENTRY = 'dsh/node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml'

const temporary: string[] = []

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** A scratch directory removed after the test. */
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-preset-compat-'))
  temporary.push(root)
  return root
}

/** The preset declaration that wraps a plugin list, at the indent the real files use. */
const HEADER = [
  '- insert:',
  '    - id: preset-test',
  "      name: '@deepseek-ai/dsh-agent-preset'",
  '      config:',
  '        id: test',
  '        order: 1',
  '        plugins:',
].join('\n')

/** One plugin row, at the indent the real files use. */
function pluginRow(id: string, name: string, config: readonly string[] = []): string {
  const lines = [`          - id: ${id}`, `            name: '${name}'`]
  if (config.length > 0) {
    lines.push('            config:')
    for (const line of config) lines.push(`              ${line}`)
  }
  return lines.join('\n')
}

/** A preset document made of plugin rows. */
function preset(...rows: string[]): string {
  return `${HEADER}\n${rows.join('\n')}\n`
}

/**
 * A minimal but valid asar archive holding one file.
 *
 * Layout (what `readAsarEntry` and `@electron/asar` read): uint32 4, uint32 size
 * of the header buffer, uint32 header size + 2, uint32 JSON header length, the
 * JSON header, then the payload. The data section starts at `8 + headerBufferSize`.
 */
function buildAsar(entryPath: string, text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const tree: { files: Record<string, unknown> } = { files: {} }
  let node = tree.files
  const parts = entryPath.split('/').filter(Boolean)
  for (const part of parts.slice(0, -1)) {
    const child: { files: Record<string, unknown> } = { files: {} }
    node[part] = child
    node = child.files
  }
  node[parts[parts.length - 1] as string] = { size: payload.length, offset: '0' }

  const json = Buffer.from(JSON.stringify(tree), 'utf8')
  const buffer = Buffer.alloc(16 + json.length + payload.length)
  buffer.writeUInt32LE(4, 0)
  buffer.writeUInt32LE(8 + json.length, 4)
  buffer.writeUInt32LE(json.length + 2, 8)
  buffer.writeUInt32LE(json.length, 12)
  json.copy(buffer, 16)
  payload.copy(buffer, 16 + json.length)
  return buffer
}

/** Write an asar built from `text` and return its path. */
function asarWith(text: string): string {
  const path = join(scratch(), 'app.asar')
  writeFileSync(path, buildAsar(STANDARD_ENTRY, text))
  return path
}

/** Run a script as a process. */
function runScript(
  file: string,
  args: readonly string[],
  env: Record<string, string> = {},
): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [file, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

/** Run the checker as a process. */
function run(args: readonly string[], env: Record<string, string> = {}): { status: number | null; output: string } {
  return runScript(script, args, env)
}

describe('parseRows', () => {
  it('separates preset declarations from plugin rows and dedents config lines', () => {
    const rows = parseRows(
      preset(pluginRow('tool-fs', '@deepseek-ai/dsh-tool-fs', ['# a comment', 'applyPatch: false'])),
    )

    const root = rows.find((row) => row.id === 'preset-test')
    expect(root?.depth).toBe(0)

    const fs = rows.find((row) => row.id === 'tool-fs')
    expect(fs?.depth).toBe(1)
    expect(fs?.name).toBe('@deepseek-ai/dsh-tool-fs')
    // `name:` is the row's identity, `#` comments and blanks are not config, and
    // nested rows keep their own lines.
    expect(fs?.configLines).toEqual(['config:', 'applyPatch: false'])
  })

  it('keeps nested group rows apart from their parent', () => {
    const group = [
      '          - id: delegation',
      "            name: cordis:group",
      '            group: true',
      '            config:',
      '              - id: tool-subagent-control',
      "                name: '@deepseek-ai/dsh-tool-subagent-control'",
    ].join('\n')

    const rows = parseRows(preset(group))
    const parent = rows.find((row) => row.id === 'delegation')
    const child = rows.find((row) => row.id === 'tool-subagent-control')

    expect(parent?.depth).toBe(1)
    expect(parent?.configLines).toEqual(['group: true', 'config:'])
    expect(child?.depth).toBe(2)
    expect(child?.configLines).toEqual([])
  })
})

describe('diffRows', () => {
  it('reports a template row the host no longer ships as the most dangerous kind', () => {
    const standard = parseRows(preset(pluginRow('persona', '@deepseek-ai/dsh-persona')))
    const template = parseRows(
      preset(
        pluginRow('persona', '@deepseek-ai/dsh-persona'),
        pluginRow('tool-subagent-list-agents', '@deepseek-ai/dsh-tool-subagent-control/list-agents'),
      ),
    )

    const drifts = diffRows(template, standard)
    expect(drifts).toHaveLength(1)
    const drift = drifts[0]!
    expect(drift.kind).toBe('missing-row')
    expect(drift.id).toBe('tool-subagent-list-agents')
    expect(drift.standard).toBeNull()
    expect(drift.template?.name).toBe('@deepseek-ai/dsh-tool-subagent-control/list-agents')
    expect(drift.reason).toContain('最危险')
  })

  it('reports the same row id with a different name', () => {
    const standard = parseRows(preset(pluginRow('tool-subagent-control', '@deepseek-ai/dsh-tool-subagent-control')))
    const template = parseRows(
      preset(pluginRow('tool-subagent-control', '@deepseek-ai/dsh-tool-subagent-control/list-agents')),
    )

    const drifts = diffRows(template, standard)
    expect(drifts).toHaveLength(1)
    const drift = drifts[0]!
    expect(drift.kind).toBe('name-changed')
    expect(drift.reason).toContain('@deepseek-ai/dsh-tool-subagent-control/list-agents')
    expect(drift.reason).toContain('@deepseek-ai/dsh-tool-subagent-control')
  })

  it('reports differing config lines but ignores template placeholders', () => {
    const standard = parseRows(
      preset(
        pluginRow('persona', '@deepseek-ai/dsh-persona', ['prefix: You are powered by the {{model}} model.']),
        pluginRow('tool-fs', '@deepseek-ai/dsh-tool-fs', ['applyPatch: false']),
      ),
    )
    const template = parseRows(
      preset(
        pluginRow('persona', '@deepseek-ai/dsh-persona', ['prefix: {{ROLE_PREFIX}}']),
        pluginRow('tool-fs', '@deepseek-ai/dsh-tool-fs'),
      ),
    )

    const drifts = diffRows(template, standard)
    expect(drifts).toHaveLength(1)
    const drift = drifts[0]!
    expect(drift.kind).toBe('config-changed')
    expect(drift.id).toBe('tool-fs')
    expect(drift.config?.onlyInStandard).toEqual(['config:', 'applyPatch: false'])
    expect(drift.config?.onlyInTemplate).toEqual([])
  })

  it('returns no drift when both sides agree', () => {
    const text = preset(
      pluginRow('persona', '@deepseek-ai/dsh-persona', ['prefix: {{ROLE_PREFIX}}']),
      pluginRow('tool-fs', '@deepseek-ai/dsh-tool-fs', ['applyPatch: false']),
      pluginRow('tool-plugin-manager', '@deepseek-ai/dsh-plugin-manager/tools', [
        'disabled: !!js "!ctx.get(\'profileContext\')"',
      ]),
    )

    expect(diffRows(parseRows(text), parseRows(text))).toEqual([])
  })
})

describe('checkPresetCompat', () => {
  it('reads the shipped standard out of the archive and reports drift against a template file', () => {
    const root = scratch()
    const template = join(root, 'preset.template.yml')
    writeFileSync(
      template,
      preset(
        pluginRow('persona', '@deepseek-ai/dsh-persona'),
        pluginRow('tool-subagent-control', '@deepseek-ai/dsh-tool-subagent-control'),
      ),
      'utf8',
    )
    const asarPath = asarWith(preset(pluginRow('persona', '@deepseek-ai/dsh-persona')))

    const report = checkPresetCompat({ asarPath, templatePath: template })

    expect(report.status).toBe('drift')
    expect(report.rows).toEqual({ template: 2, standard: 1 })
    expect(report.drifts.map((drift) => drift.id)).toEqual(['tool-subagent-control'])
  })

  it('skips a missing host instead of failing', () => {
    const root = scratch()
    const template = join(root, 'preset.template.yml')
    writeFileSync(template, preset(pluginRow('persona', '@deepseek-ai/dsh-persona')), 'utf8')

    const report = checkPresetCompat({ asarPath: join(root, 'missing.asar'), templatePath: template })

    expect(report.status).toBe('skip')
    expect(report.rows).toEqual({ template: 1, standard: 0 })
    expect(report.drifts).toEqual([])
  })
})

describe('command line', () => {
  it('exits 0 and prints [SKIP] when the host archive is absent', () => {
    const result = run(['--json'], { DSH_APP_ASAR: join(scratch(), 'missing.asar') })

    expect(result.status).toBe(0)
    const report = JSON.parse(result.output) as Report
    expect(report.status).toBe('skip')
  })

  it('exits 0 and reports [OK] when the archive matches the template', () => {
    const result = run([], { DSH_APP_ASAR: asarWith(readFileSync(templatePath, 'utf8')) })

    expect(result.status).toBe(0)
    expect(result.output).toContain('[OK]')
    expect(result.output).toContain('31 个插件 row')
  })

  it('exits 1 and names every drift when the archive has a renamed module', () => {
    const shifted = readFileSync(templatePath, 'utf8').replace(
      "'@deepseek-ai/dsh-tool-fs'",
      "'@deepseek-ai/dsh-tool-fs/renamed'",
    )
    const result = run([], { DSH_APP_ASAR: asarWith(shifted) })

    expect(result.status).toBe(1)
    expect(result.output).toContain('[DRIFT] tool-fs')
    expect(result.output).toContain('name 不同')
  })

  it('rejects an unknown flag with exit code 2', () => {
    expect(run(['--nope']).status).toBe(2)
  })
})

describe('install-presets gate', () => {
  const PROFILE = "- id: ui-chat\n  name: '@deepseek-ai/dsh-client-ui-chat'\n"
  const GENERATED = [
    '- insert:',
    '    - id: preset-pm',
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    '        id: pm',
    '- id: agent-preset-registry',
    "  name: '@deepseek-ai/dsh-agent-preset-registry'",
    '  config:',
    '    default: pm',
    '',
  ].join('\n')

  /** A profile + generated patch, plus the drifted host archive. */
  function fixture(): { root: string; profile: string; source: string; drifted: string } {
    const root = scratch()
    const profile = join(root, 'cordis.patch.yml')
    writeFileSync(profile, PROFILE, 'utf8')
    const source = join(root, 'generated.yml')
    writeFileSync(source, GENERATED, 'utf8')
    const drifted = readFileSync(templatePath, 'utf8').replace(
      "'@deepseek-ai/dsh-tool-fs'",
      "'@deepseek-ai/dsh-tool-fs/renamed'",
    )
    return { root, profile, source, drifted }
  }

  it('refuses to merge a profile when the host standard drifts', () => {
    const { root, profile, source, drifted } = fixture()

    const result = runScript(installScript, ['--profile', profile, '--source', source], {
      DSH_APP_ASAR: asarWith(drifted),
    })

    expect(result.status).toBe(1)
    expect(result.output).toContain('拒绝合并')
    expect(result.output).toContain('宿主已升级，先跑 node scripts/check-preset-compat.mjs')
    expect(readFileSync(profile, 'utf8')).toBe(PROFILE)
    expect(readdirSync(root).filter((entry) => entry.includes('.bak-'))).toEqual([])
  })

  it('--force skips the gate and merges', () => {
    const { profile, source, drifted } = fixture()

    const result = runScript(installScript, ['--profile', profile, '--source', source, '--force'], {
      DSH_APP_ASAR: asarWith(drifted),
    })

    expect(result.status).toBe(0)
    expect(result.output).toContain('--force：跳过预置模板兼容检查')
    expect(readFileSync(profile, 'utf8')).toContain('# ==== dsh-fullstack-team')
  })

  it('--dry-run reports the compatibility status and still writes nothing', () => {
    const { root, profile, source } = fixture()

    const result = runScript(installScript, ['--profile', profile, '--source', source, '--dry-run'], {
      DSH_APP_ASAR: asarWith(readFileSync(templatePath, 'utf8')),
    })

    expect(result.status).toBe(0)
    expect(result.output).toContain('兼容检查  [OK]')
    expect(result.output).toContain('dry-run')
    expect(readFileSync(profile, 'utf8')).toBe(PROFILE)
    expect(readdirSync(root).filter((entry) => entry.includes('.bak-'))).toEqual([])
  })
})
