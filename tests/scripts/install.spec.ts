import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * FP: one-command install (`scripts/install.mjs`).
 *
 * The command is the only thing a user is expected to type, so these cases pin
 * the four things it promises beyond "it merged a file":
 *
 *   1. it is idempotent — a second run writes nothing, backs nothing up, and
 *      restarts nothing;
 *   2. drift is healed from the shipped standard when possible, and **refused**
 *      with a human sentence plus an untouched profile when it is not;
 *   3. the restart is automatic on macOS but never surprises `--no-restart`,
 *      `--dry-run`, or a machine without the app (that last one is every CI run);
 *   4. a failed merge leaves the profile byte-identical to what it was before.
 *
 * Every process case runs against a fixture asar built from a synthetic standard
 * preset, so no case depends on the host being installed, and none touches
 * `~/.dsh` or the repository's own `templates/preset.template.yml`.
 */

interface Line {
  stream: 'out' | 'err'
  text: string
}

interface InstallResult {
  code: number
  lines: Line[]
  changed?: boolean
}

interface RestartResult {
  restarted: boolean
  reason?: string
}

interface ExecCall {
  command: string
  args: readonly string[]
}

interface Installer {
  deriveTemplate(standardText: string, currentTemplateText?: string): { text: string; tokens: string[] }
  restartHost(options?: {
    platform?: string
    appPath?: string
    appName?: string
    exec?: (command: string, args: readonly string[], options?: unknown) => { error?: unknown }
    sleep?: (ms: number) => void
    skip?: boolean
  }): RestartResult
  probe(options?: {
    asarPath?: string
    appPath?: string
    profilePath?: string
    env?: Record<string, string | undefined>
  }): {
    asarPath: string
    asarExists: boolean
    appPath: string
    hostVersion?: string
    profilePath: string
    repoVersion?: string
  }
  install(options?: {
    argv?: string[]
    env?: Record<string, string | undefined>
    platform?: string
    exec?: (command: string, args: readonly string[], options?: unknown) => { error?: unknown }
    sleep?: (ms: number) => void
  }): Promise<InstallResult>
}

// @ts-expect-error -- plain ESM script; the shape used by the cases is declared above
import * as installer from '../../scripts/install.mjs'

const { deriveTemplate, restartHost, probe } = installer as unknown as Installer

const here = fileURLToPath(new URL('../../', import.meta.url))
const script = join(here, 'scripts', 'install.mjs')
const STANDARD_ENTRY = 'dsh/node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml'

const temporary: string[] = []

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** A scratch directory removed after the test. */
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-install-'))
  temporary.push(root)
  return root
}

/**
 * A synthetic host standard preset.
 *
 * Same shape as the real `standard.patch.yml` — a preset declaration wrapping a
 * plugin list — but small enough to reason about. Dropping `persona` and renaming
 * `tool-fs` are the two ways the drift fixtures are made.
 */
function standardText(options: { persona?: boolean; toolFsName?: string } = {}): string {
  const lines = [
    '# Agent preset standard: shipped by the host.',
    '# Two comment lines so the header handling is exercised.',
    '- insert:',
    '    - id: preset-standard',
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    '        id: standard',
    '        order: 1',
    '        plugins:',
  ]
  if (options.persona !== false) {
    lines.push(
      '          - id: persona',
      "            name: '@deepseek-ai/dsh-persona'",
      '            config:',
      '              prefix: You are a coding agent powered by the {{model}} model.',
    )
  }
  lines.push(
    '          - id: tool-fs',
    `            name: '${options.toolFsName ?? '@deepseek-ai/dsh-tool-fs'}'`,
    '            config:',
    '              applyPatch: false',
  )
  return `${lines.join('\n')}\n`
}

/** A minimal but valid asar archive holding one file (same layout as the host's). */
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

/** A generated patch holding the given preset ids (plus the registry row). */
function generated(ids: readonly string[]): string {
  const blocks = ids.map(
    (id) =>
      '- insert:\n' +
      `    - id: preset-${id}\n` +
      "      name: '@deepseek-ai/dsh-agent-preset'\n" +
      '      config:\n' +
      `        id: ${id}\n` +
      `        name: ${id}\n`,
  )
  blocks.push(
    '- id: agent-preset-registry\n' +
      "  name: '@deepseek-ai/dsh-agent-preset-registry'\n" +
      '  config:\n' +
      '    default: pm\n',
  )
  return blocks.join('')
}

/** A template file aligned with `standard`, at a scratch path. */
function templateFor(standard: string): string {
  const path = join(scratch(), 'preset.template.yml')
  writeFileSync(path, deriveTemplate(standard, '').text, 'utf8')
  return path
}

/** A scratch profile path that does not exist yet. */
function scratchProfile(): string {
  return join(scratch(), 'cordis.patch.yml')
}

/** Backups next to a profile. */
function backupsOf(profile: string): string[] {
  const dir = join(profile, '..')
  return existsSync(dir) ? readdirSync(dir).filter((entry) => entry.includes('.bak-')) : []
}

/**
 * Run the command as a process.
 *
 * `DSH_APP_PATH` points at a non-existent app by default so a case can never
 * quit the real desktop app even when it asks for a restart; the restart cases
 * override it with a fake app directory plus a PATH shim.
 */
function run(args: readonly string[], env: Record<string, string> = {}): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DSH_APP_PATH: join(scratch(), 'missing.app'), ...env },
  })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

/** PATH shim directory whose `osascript` and `open` record their invocation. */
function shimDirectory(sentinel: string): string {
  const dir = scratch()
  for (const name of ['osascript', 'open']) {
    const file = join(dir, name)
    writeFileSync(file, `#!/bin/sh\necho "${name} $@" >> "${sentinel}"\n`, 'utf8')
    chmodSync(file, 0o755)
  }
  return dir
}

describe('deriveTemplate', () => {
  it('rebuilds a template from the shipped standard with all six injection tokens', () => {
    const standard = standardText()
    const previous = ['# keep this header', '#', ''].join('\n')

    const { text, tokens } = deriveTemplate(standard, previous)

    expect(tokens).toHaveLength(6)
    for (const token of tokens) expect(text).toContain(token)

    // The role identity is anchored in the preset declaration, and the prefix in
    // the persona row — the two places `src/roles.ts` substitutes.
    expect(text).toContain('    - id: {{PRESET_ID}}')
    expect(text).toContain('        id: {{ROLE_ID}}')
    expect(text).toContain('        name: {{ROLE_NAME}}')
    expect(text).toContain('        description: {{ROLE_DESCRIPTION}}')
    expect(text).toContain('prefix: {{ROLE_PREFIX}}')
    expect(text.trimEnd().endsWith('{{ROLE_ENTRY}}')).toBe(true)

    // This project's comment header survives; upstream's does not.
    expect(text.startsWith('# keep this header\n#\n')).toBe(true)
    expect(text).not.toContain('shipped by the host')

    // Same rows as the host standard, in the same order — the declaration id
    // becomes the injected placeholder, everything else is upstream's.
    const ids = (value: string): string[] =>
      [...value.matchAll(/^\s+-\s+id:\s+(\S+)\s*$/gmu)].map((match) => match[1] as string)
    const expected = ids(standard)
    expected[0] = '{{PRESET_ID}}'
    expect(ids(text)).toEqual(expected)
  })

  it('is a fixed point: deriving from an already-derived template changes nothing', () => {
    const standard = standardText()
    const first = deriveTemplate(standard, '').text
    const second = deriveTemplate(standard, first).text
    expect(second).toBe(first)
  })

  it('refuses to guess when the host dropped the persona row', () => {
    const standard = standardText({ persona: false })
    expect(() => deriveTemplate(standard, '')).toThrow(/persona/u)
  })

  it('refuses a standard with no preset declaration', () => {
    const standard = '- insert:\n    - id: something-else\n      name: x\n'
    expect(() => deriveTemplate(standard, '')).toThrow(/preset-/u)
  })
})

describe('restartHost', () => {
  it('quits and relaunches on macOS, then waits for the app to go down', () => {
    const appPath = join(scratch(), 'DeepSeek Harness.app')
    mkdirSync(appPath, { recursive: true })
    const calls: ExecCall[] = []
    const slept: number[] = []

    const result = restartHost({
      platform: 'darwin',
      appPath,
      exec: (command, args) => {
        calls.push({ command, args })
        return {}
      },
      sleep: (ms) => slept.push(ms),
    })

    expect(result.restarted).toBe(true)
    expect(calls).toEqual([
      { command: 'osascript', args: ['-e', 'quit app "DeepSeek Harness"'] },
      { command: 'open', args: ['-a', 'DeepSeek Harness'] },
    ])
    expect(slept).toEqual([2000])
  })

  it('never spawns anything when the caller passed --no-restart', () => {
    const appPath = join(scratch(), 'DeepSeek Harness.app')
    mkdirSync(appPath, { recursive: true })
    let calls = 0

    const result = restartHost({
      platform: 'darwin',
      appPath,
      skip: true,
      exec: () => {
        calls += 1
        return {}
      },
      sleep: () => {},
    })

    expect(result).toEqual({ restarted: false, reason: 'skipped-flag' })
    expect(calls).toBe(0)
  })

  it('skips with a reason off macOS or when the app is not installed', () => {
    expect(restartHost({ platform: 'linux', exec: () => ({}) })).toEqual({
      restarted: false,
      reason: 'not-macos',
    })
    const missing = restartHost({
      platform: 'darwin',
      appPath: join(scratch(), 'missing.app'),
      exec: () => ({}),
    })
    expect(missing.reason).toBe('app-missing')
  })

  it('reports a failed relaunch instead of pretending it restarted', () => {
    const appPath = join(scratch(), 'DeepSeek Harness.app')
    mkdirSync(appPath, { recursive: true })

    const result = restartHost({
      platform: 'darwin',
      appPath,
      exec: () => ({ error: new Error('osascript is gone') }),
      sleep: () => {},
    })

    expect(result.restarted).toBe(false)
    expect(result.reason).toBe('failed')
  })
})

describe('probe', () => {
  it('reads the host version out of the archive and names the target profile', () => {
    const root = scratch()
    const asar = join(root, 'app.asar')
    writeFileSync(asar, buildAsar('dsh/node_modules/@deepseek-ai/dsh-web-app/package.json', '{"version":"9.9.9"}'))
    const profile = join(root, 'cordis.patch.yml')

    const result = probe({ asarPath: asar, appPath: join(root, 'nope.app'), profilePath: profile, env: {} })

    expect(result.asarExists).toBe(true)
    expect(result.hostVersion).toBe('9.9.9')
    expect(result.profilePath).toBe(profile)
    expect(result.repoVersion).toMatch(/^\d+\.\d+\.\d+/u)
  })
})

describe('command line', () => {
  it('is idempotent: a second run says 已是最新 and writes, backs up and restarts nothing', () => {
    const standard = standardText()
    const profile = scratchProfile()
    mkdirSync(join(profile, '..'), { recursive: true })
    writeFileSync(profile, "- id: ui-chat\n  name: '@deepseek-ai/dsh-client-ui-chat'\n", 'utf8')
    const source = join(scratch(), 'generated.yml')
    writeFileSync(source, generated(['pm', 'qa']), 'utf8')
    // A restart is *possible* here (app path exists, PATH shim would record it),
    // so the second run proves it chooses not to — not merely that it cannot.
    const sentinel = join(scratch(), 'calls.txt')
    const fakeApp = join(scratch(), 'DeepSeek Harness.app')
    mkdirSync(fakeApp, { recursive: true })
    const env = {
      DSH_APP_ASAR: asarWith(standard),
      DSH_PRESET_TEMPLATE: templateFor(standard),
      DSH_APP_PATH: fakeApp,
      PATH: `${shimDirectory(sentinel)}:${process.env.PATH ?? ''}`,
    }

    const first = run(['--profile', profile, '--source', source, '--no-restart'], env)
    expect(first.status).toBe(0)
    expect(first.output).toContain('已装好：2 个预设')
    const afterFirst = readFileSync(profile, 'utf8')
    const backupsAfterFirst = backupsOf(profile)
    expect(backupsAfterFirst).toHaveLength(1)

    const second = run(['--profile', profile, '--source', source], env)

    expect(second.status).toBe(0)
    expect(second.output).toContain('已是最新，无需操作')
    expect(second.output).not.toContain('宿主已重启')
    expect(readFileSync(profile, 'utf8')).toBe(afterFirst)
    expect(backupsOf(profile)).toEqual(backupsAfterFirst)
    expect(existsSync(sentinel)).toBe(false)
  })

  it('heals template drift from the shipped standard and installs', () => {
    const previous = deriveTemplate(standardText(), '').text
    const stale = join(scratch(), 'preset.template.yml')
    writeFileSync(stale, previous, 'utf8')
    // The host renamed a plugin row: the frozen template still names the old one.
    const drifted = standardText({ toolFsName: '@deepseek-ai/dsh-tool-fs-v2' })
    const asar = asarWith(drifted)
    const profile = scratchProfile()
    const source = join(scratch(), 'generated.yml')
    writeFileSync(source, generated(['pm']), 'utf8')

    const result = run(['--profile', profile, '--source', source, '--no-restart'], {
      DSH_APP_ASAR: asar,
      DSH_PRESET_TEMPLATE: stale,
    })

    expect(result.status).toBe(0)
    expect(result.output).toContain('[DRIFT]')
    expect(result.output).toContain('模板已按宿主')
    expect(result.output).toContain('已装好：1 个预设')
    // The healed template is exactly what deriving from the new standard gives.
    expect(readFileSync(stale, 'utf8')).toBe(deriveTemplate(drifted, previous).text)
    expect(readFileSync(stale, 'utf8')).toContain('@deepseek-ai/dsh-tool-fs-v2')
  })

  it('fails in plain words when drift cannot be healed, leaving profile and template untouched', () => {
    // The host dropped the persona row: there is nowhere safe to inject the prefix.
    const drifted = standardText({ persona: false })
    const previous = deriveTemplate(standardText(), '').text
    const template = join(scratch(), 'preset.template.yml')
    writeFileSync(template, previous, 'utf8')
    const profile = scratchProfile()
    mkdirSync(join(profile, '..'), { recursive: true })
    const before = "- id: ui-chat\n  name: '@deepseek-ai/dsh-client-ui-chat'\n"
    writeFileSync(profile, before, 'utf8')
    const source = join(scratch(), 'generated.yml')
    writeFileSync(source, generated(['pm']), 'utf8')

    const result = run(['--profile', profile, '--source', source, '--no-restart'], {
      DSH_APP_ASAR: asarWith(drifted),
      DSH_PRESET_TEMPLATE: template,
    })

    expect(result.status).toBe(1)
    expect(result.output).toContain('不兼容')
    expect(result.output).toContain('无法自动对齐')
    expect(result.output).toContain('profile 未改动')
    expect(readFileSync(profile, 'utf8')).toBe(before)
    expect(readFileSync(template, 'utf8')).toBe(previous)
    expect(backupsOf(profile)).toHaveLength(0)
  })

  it('--force merges anyway when drift cannot be healed (operator override)', () => {
    const drifted = standardText({ persona: false })
    const template = join(scratch(), 'preset.template.yml')
    writeFileSync(template, deriveTemplate(standardText(), '').text, 'utf8')
    const profile = scratchProfile()
    const source = join(scratch(), 'generated.yml')
    writeFileSync(source, generated(['pm']), 'utf8')

    const result = run(['--profile', profile, '--source', source, '--no-restart', '--force'], {
      DSH_APP_ASAR: asarWith(drifted),
      DSH_PRESET_TEMPLATE: template,
    })

    expect(result.status).toBe(0)
    expect(result.output).toContain('--force')
    expect(result.output).toContain('已装好：1 个预设')
    expect(readFileSync(profile, 'utf8')).toContain('# ==== dsh-fullstack-team')
  })

  it('--no-restart installs but never calls osascript', () => {
    const standard = standardText()
    const profile = scratchProfile()
    const source = join(scratch(), 'generated.yml')
    writeFileSync(source, generated(['pm']), 'utf8')
    const sentinel = join(scratch(), 'calls.txt')
    const fakeApp = join(scratch(), 'DeepSeek Harness.app')
    mkdirSync(fakeApp, { recursive: true })

    const result = run(['--profile', profile, '--source', source, '--no-restart'], {
      DSH_APP_ASAR: asarWith(standard),
      DSH_PRESET_TEMPLATE: templateFor(standard),
      DSH_APP_PATH: fakeApp,
      PATH: `${shimDirectory(sentinel)}:${process.env.PATH ?? ''}`,
    })

    expect(result.status).toBe(0)
    expect(result.output).toContain('--no-restart')
    expect(existsSync(sentinel)).toBe(false)
    expect(existsSync(profile)).toBe(true)
  })

  it.skipIf(process.platform === 'win32')(
    'restarts the host after a merge on macOS, and says so instead of guessing elsewhere',
    () => {
      const standard = standardText()
      const profile = scratchProfile()
      const source = join(scratch(), 'generated.yml')
      writeFileSync(source, generated(['pm']), 'utf8')
      const sentinel = join(scratch(), 'calls.txt')
      const fakeApp = join(scratch(), 'DeepSeek Harness.app')
      mkdirSync(fakeApp, { recursive: true })

      const result = run(['--profile', profile, '--source', source], {
        DSH_APP_ASAR: asarWith(standard),
        DSH_PRESET_TEMPLATE: templateFor(standard),
        DSH_APP_PATH: fakeApp,
        PATH: `${shimDirectory(sentinel)}:${process.env.PATH ?? ''}`,
      })

      expect(result.status).toBe(0)
      if (process.platform === 'darwin') {
        expect(result.output).toContain('宿主已重启')
        const calls = readFileSync(sentinel, 'utf8')
        expect(calls).toContain('osascript -e quit app "DeepSeek Harness"')
        expect(calls).toContain('open -a DeepSeek Harness')
      } else {
        // No macOS app exists on this machine: skip and say why, never fail.
        expect(result.output).toContain('不是 macOS')
        expect(existsSync(sentinel)).toBe(false)
      }
    },
    20_000,
  )

  it('--dry-run prints the plan and touches nothing', () => {
    const standard = standardText()
    const profile = scratchProfile()
    mkdirSync(join(profile, '..'), { recursive: true })
    const before = "- id: ui-chat\n  name: '@deepseek-ai/dsh-client-ui-chat'\n"
    writeFileSync(profile, before, 'utf8')
    const source = join(scratch(), 'generated.yml')
    writeFileSync(source, generated(['pm', 'qa']), 'utf8')

    const result = run(['--profile', profile, '--source', source, '--dry-run'], {
      DSH_APP_ASAR: asarWith(standard),
      DSH_PRESET_TEMPLATE: templateFor(standard),
    })

    expect(result.status).toBe(0)
    expect(result.output).toContain('dry-run')
    expect(result.output).toContain('预设')
    expect(result.output).toContain('备份')
    expect(readFileSync(profile, 'utf8')).toBe(before)
    expect(backupsOf(profile)).toHaveLength(0)
  })

  it('rolls back a failed merge so the profile is byte-identical to before', () => {
    const standard = standardText()
    const profile = scratchProfile()
    mkdirSync(join(profile, '..'), { recursive: true })
    // A profile that already duplicates an entry id cannot pass the verify step.
    const broken =
      "- id: ui-chat\n  name: '@deepseek-ai/dsh-client-ui-chat'\n" +
      "- id: ui-chat\n  name: '@deepseek-ai/dsh-client-ui-chat'\n"
    writeFileSync(profile, broken, 'utf8')
    const source = join(scratch(), 'generated.yml')
    writeFileSync(source, generated(['pm']), 'utf8')

    const result = run(['--profile', profile, '--source', source, '--no-restart'], {
      DSH_APP_ASAR: asarWith(standard),
      DSH_PRESET_TEMPLATE: templateFor(standard),
    })

    expect(result.status).toBe(1)
    expect(result.output).toContain('回滚')
    expect(readFileSync(profile, 'utf8')).toBe(broken)
  })

  it('fails on a missing host outside CI and points at the two ways out', () => {
    const profile = scratchProfile()
    const source = join(scratch(), 'generated.yml')
    writeFileSync(source, generated(['pm']), 'utf8')

    const result = run(['--profile', profile, '--source', source, '--no-restart'], {
      DSH_APP_ASAR: join(scratch(), 'nope.asar'),
      DSH_PRESET_TEMPLATE: templateFor(standardText()),
      CI: '',
    })

    expect(result.status).toBe(1)
    expect(result.output).toContain('找不到 DeepSeek Harness 宿主')
    expect(result.output).toContain('--dry-run')
    expect(existsSync(profile)).toBe(false)
  })

  it('skips the host probe under CI and still installs', () => {
    const profile = scratchProfile()
    const source = join(scratch(), 'generated.yml')
    writeFileSync(source, generated(['pm']), 'utf8')

    const result = run(['--profile', profile, '--source', source, '--no-restart'], {
      DSH_APP_ASAR: join(scratch(), 'nope.asar'),
      DSH_PRESET_TEMPLATE: templateFor(standardText()),
      CI: '1',
    })

    expect(result.status).toBe(0)
    expect(result.output).toContain('[SKIP]')
    expect(result.output).toContain('已装好：1 个预设')
  })

  it('skips the host probe under --dry-run and exits 0', () => {
    const profile = scratchProfile()
    const source = join(scratch(), 'generated.yml')
    writeFileSync(source, generated(['pm']), 'utf8')

    const result = run(['--profile', profile, '--source', source, '--dry-run'], {
      DSH_APP_ASAR: join(scratch(), 'nope.asar'),
      DSH_PRESET_TEMPLATE: templateFor(standardText()),
    })

    expect(result.status).toBe(0)
    expect(result.output).toContain('[SKIP]')
    expect(result.output).toContain('dry-run')
    expect(existsSync(profile)).toBe(false)
  })

  it('accepts the `install` subcommand npx passes through', () => {
    const standard = standardText()
    const profile = scratchProfile()
    const source = join(scratch(), 'generated.yml')
    writeFileSync(source, generated(['pm']), 'utf8')

    const result = run(['install', '--profile', profile, '--source', source, '--no-restart'], {
      DSH_APP_ASAR: asarWith(standard),
      DSH_PRESET_TEMPLATE: templateFor(standard),
    })

    expect(result.status).toBe(0)
    expect(result.output).toContain('已装好：1 个预设')
  })

  it('rejects bad arguments with exit code 2', () => {
    const unknown = run(['--nope'])
    expect(unknown.status).toBe(2)
    expect(unknown.output).toContain('未知参数')

    const missingValue = run(['--profile'])
    expect(missingValue.status).toBe(2)
    expect(missingValue.output).toContain('--profile 需要一个值')
  })
})
