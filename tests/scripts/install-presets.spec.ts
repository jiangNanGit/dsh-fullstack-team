import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * FP-14 — the merge tool, exercised as a process on a scratch profile.
 *
 * These cases pin the promises the script makes: a backup exists, a second run
 * changes nothing, only the owned block is replaced (every other line stays
 * byte-identical), a failed verification rolls back, and `--dry-run` writes
 * nothing. `--source` is used so the cases do not need `lib/` — `pnpm check`
 * runs tests before the build step.
 */

const script = join(fileURLToPath(new URL('../../', import.meta.url)), 'scripts', 'install-presets.mjs')
const temporary: string[] = []

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** A scratch directory removed after the test. */
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-install-presets-'))
  temporary.push(root)
  return root
}

/** Run the merge script and capture both streams. */
function run(args: readonly string[]): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

/** A generated patch holding the given preset ids (plus the registry row). */
function generated(ids: readonly string[]): string {
  const blocks = ids.map(
    (id) =>
      `- insert:\n` +
      `    - id: preset-${id}\n` +
      `      name: '@deepseek-ai/dsh-agent-preset'\n` +
      `      config:\n` +
      `        id: ${id}\n` +
      `        name: ${id}\n`,
  )
  blocks.push(
    `- id: agent-preset-registry\n` +
      `  name: '@deepseek-ai/dsh-agent-preset-registry'\n` +
      `  config:\n` +
      `    default: pm\n`,
  )
  return blocks.join('')
}

/** Write a profile and a generation file, returning both paths. */
function fixture(options: { profile: string; ids: readonly string[] }): { profile: string; source: string } {
  const root = scratch()
  const profile = join(root, 'cordis.patch.yml')
  writeFileSync(profile, options.profile, 'utf8')
  const source = join(root, 'generated.yml')
  writeFileSync(source, generated(options.ids), 'utf8')
  return { profile, source }
}

/** Backup files next to a profile. */
function backupsOf(profile: string): string[] {
  return readdirSync(join(profile, '..')).filter((entry) => entry.startsWith(`${'cordis.patch.yml'}.bak-`))
}

/** Preset ids in a patch document. */
function presetIdsOf(text: string): string[] {
  return [...text.matchAll(/^\s+-\s+id:\s+(preset-[\w.-]+)\s*$/gmu)].map((match) => match[1] as string)
}

const BASE_PROFILE = [
  '# a profile comment',
  '- id: ui-chat',
  '  name: "@deepseek-ai/dsh-client-ui-chat"',
  '  config:',
  '    transcriptView: detailed',
  '',
  '- id: agent-default-model',
  '  name: "@deepseek-ai/dsh-agent-default-model"',
  '  config:',
  '    provider: ksyun',
  '',
].join('\n')

describe('install-presets', () => {
  it('appends the block, keeps every original line, and backs the profile up', () => {
    const { profile, source } = fixture({ profile: BASE_PROFILE, ids: ['pm', 'qa'] })

    const result = run(['--profile', profile, '--source', source])
    expect(result.status).toBe(0)

    const merged = readFileSync(profile, 'utf8')
    expect(merged.startsWith(BASE_PROFILE)).toBe(true)
    expect(merged).toContain('# ==== dsh-fullstack-team')
    expect(presetIdsOf(merged)).toEqual(['preset-pm', 'preset-qa'])
    expect(merged.match(/^- id: agent-preset-registry$/gmu)).toHaveLength(1)

    const backups = backupsOf(profile)
    expect(backups).toHaveLength(1)
    expect(backups[0]).toMatch(/\.bak-\d{8}-\d{6}/u)
    expect(readFileSync(join(profile, '..', backups[0] as string), 'utf8')).toBe(BASE_PROFILE)
  })

  it('is idempotent: a second run writes nothing and makes no new backup', () => {
    const { profile, source } = fixture({ profile: BASE_PROFILE, ids: ['pm', 'qa'] })
    expect(run(['--profile', profile, '--source', source]).status).toBe(0)
    const afterFirst = readFileSync(profile, 'utf8')
    const backupsAfterFirst = backupsOf(profile)

    const second = run(['--profile', profile, '--source', source])

    expect(second.status).toBe(0)
    expect(second.output).toContain('已是最新')
    expect(readFileSync(profile, 'utf8')).toBe(afterFirst)
    expect(backupsOf(profile)).toEqual(backupsAfterFirst)
  })

  it('replaces only its own block — the lines around it stay byte-identical', () => {
    const { profile, source } = fixture({ profile: BASE_PROFILE, ids: ['pm', 'qa'] })
    expect(run(['--profile', profile, '--source', source]).status).toBe(0)
    const before = readFileSync(profile, 'utf8')

    const replacement = join(profile, '..', 'generated-v2.yml')
    writeFileSync(replacement, generated(['pm', 'backend-java']), 'utf8')
    const result = run(['--profile', profile, '--source', replacement])
    expect(result.status).toBe(0)

    const after = readFileSync(profile, 'utf8')
    // The profile's own head is untouched...
    expect(after.startsWith(BASE_PROFILE)).toBe(true)
    // ...the old preset is gone, the new one is in...
    expect(presetIdsOf(after)).toEqual(['preset-pm', 'preset-backend-java'])
    expect(after).not.toContain('id: preset-qa')
    // ...and there is still exactly one marker and one registry row.
    expect(after.match(/^# ==== dsh-fullstack-team/gmu)).toHaveLength(1)
    expect(after.match(/^- id: agent-preset-registry$/gmu)).toHaveLength(1)
    expect(before).not.toBe(after)
  })

  it('rolls back and exits non-zero when verification fails', () => {
    // A profile with a duplicated entry id cannot pass the structural check.
    const broken = `${BASE_PROFILE}- id: ui-chat\n  name: "@deepseek-ai/dsh-client-ui-chat"\n`
    const { profile, source } = fixture({ profile: broken, ids: ['pm'] })

    const result = run(['--profile', profile, '--source', source])

    expect(result.status).toBe(1)
    expect(result.output).toContain('回滚')
    expect(result.output).toContain('ui-chat')
    expect(readFileSync(profile, 'utf8')).toBe(broken)
  })

  it('--dry-run prints the plan and touches nothing', () => {
    const { profile, source } = fixture({ profile: BASE_PROFILE, ids: ['pm'] })
    const before = readFileSync(profile, 'utf8')

    const result = run(['--profile', profile, '--source', source, '--dry-run'])

    expect(result.status).toBe(0)
    expect(result.output).toContain('dry-run')
    expect(result.output).toContain('预设')
    expect(result.output).toContain('备份')
    expect(readFileSync(profile, 'utf8')).toBe(before)
    expect(backupsOf(profile)).toHaveLength(0)
  })

  it('refuses two marker blocks instead of guessing which one to replace', () => {
    const twice = `${BASE_PROFILE}# ==== dsh-fullstack-team 角色预设（由 roles/*.role.yml 生成，勿手改）====\n- insert:\n    - id: preset-old\n      name: '@deepseek-ai/dsh-agent-preset'\n# ==== dsh-fullstack-team 角色预设（由 roles/*.role.yml 生成，勿手改）====\n- insert:\n    - id: preset-older\n      name: '@deepseek-ai/dsh-agent-preset'\n`
    const { profile, source } = fixture({ profile: twice, ids: ['pm'] })

    const result = run(['--profile', profile, '--source', source])

    expect(result.status).toBe(1)
    expect(result.output).toContain('处本插件标记')
    expect(readFileSync(profile, 'utf8')).toBe(twice)
  })

  it('rejects a generation file with duplicate preset ids before touching the profile', () => {
    const root = scratch()
    const profile = join(root, 'cordis.patch.yml')
    writeFileSync(profile, BASE_PROFILE, 'utf8')
    const source = join(root, 'duplicated.yml')
    writeFileSync(source, generated(['pm', 'pm']), 'utf8')

    const result = run(['--profile', profile, '--source', source])

    expect(result.status).toBe(1)
    expect(result.output).toContain('id 重复')
    expect(readFileSync(profile, 'utf8')).toBe(BASE_PROFILE)
    expect(backupsOf(profile)).toHaveLength(0)
  })

  it('creates a missing profile file and its directory', () => {
    const root = scratch()
    const profile = join(root, 'nested', 'profiles', 'web', 'cordis.patch.yml')
    const source = join(root, 'generated.yml')
    writeFileSync(source, generated(['pm']), 'utf8')

    const result = run(['--profile', profile, '--source', source])

    expect(result.status).toBe(0)
    expect(existsSync(profile)).toBe(true)
    expect(presetIdsOf(readFileSync(profile, 'utf8'))).toEqual(['preset-pm'])
    expect(backupsOf(profile)).toHaveLength(0)
  })

  it('rejects a bad argument instead of doing something surprising', () => {
    const result = run(['--nope'])
    expect(result.status).toBe(2)
    expect(result.output).toContain('未知参数')
  })
})
