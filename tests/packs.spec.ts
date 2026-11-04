import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, expandDir, type DevflowConfig, type DevflowContext, type SkillProviderLike } from '../src/index'

const temporary: string[] = []

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** Write one skill directory and return its root. */
function pack(root: string, skills: Record<string, string>): string {
  for (const [name, description] of Object.entries(skills)) {
    const directory = join(root, name)
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\n---\n\nbody of ${name}\n`,
      'utf8',
    )
  }
  return root
}

/** Write one skill with an arbitrary body, optionally creating its scripts dir. */
function skillWithBody(root: string, name: string, body: string, ownScripts = false): string {
  const directory = join(root, name)
  mkdirSync(directory, { recursive: true })
  if (ownScripts) mkdirSync(join(directory, 'scripts'), { recursive: true })
  writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`, 'utf8')
  return root
}

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pack-'))
  temporary.push(root)
  return root
}

/** Apply the plugin and return the provider it registered. */
function register(config?: DevflowConfig): SkillProviderLike {
  let captured: SkillProviderLike | undefined
  const ctx: DevflowContext = {
    skills: {
      registerProvider: (factory) => {
        captured = factory()
      },
    },
    tools: { register: () => undefined },
  }
  apply(ctx, config)
  if (captured === undefined) throw new Error('no provider registered')
  return captured
}

describe('expandDir', () => {
  it('expands a bare home reference', () => {
    expect(expandDir('~')).toBe(homedir())
  })

  it('expands a home-relative path', () => {
    expect(expandDir('~/.dsh/skill-packs/flutter')).toBe(join(homedir(), '.dsh/skill-packs/flutter'))
  })

  it('leaves an absolute path alone', () => {
    expect(expandDir('/opt/packs/flutter')).toBe('/opt/packs/flutter')
  })
})

describe('skill packs', () => {
  it('advertises the pack next to the bundle’s own skills', async () => {
    const dir = pack(scratch(), { 'flutter-widget': '搭 Flutter 界面' })
    const provider = register({ packs: [{ name: 'flutter', dir }] })
    const names = (await provider.list()).map((candidate) => candidate.name)
    expect(names).toContain('flutter-widget')
    expect(names).toContain('role-init')
  })

  it('points the pack’s candidates at the pack directory', async () => {
    const dir = pack(scratch(), { 'flutter-widget': '搭 Flutter 界面' })
    const provider = register({ packs: [{ name: 'flutter', dir }] })
    const candidate = (await provider.list()).find((item) => item.name === 'flutter-widget')
    expect(candidate?.resourceBase).toEqual({ kind: 'directory', path: join(dir, 'flutter-widget') })
  })

  it('loads a pack skill’s content through the same provider', async () => {
    const dir = pack(scratch(), { 'flutter-widget': '搭 Flutter 界面' })
    const provider = register({ packs: [{ name: 'flutter', dir }] })
    const candidate = (await provider.list()).find((item) => item.name === 'flutter-widget')
    if (candidate === undefined) throw new Error('candidate missing')
    const skill = await provider.get(candidate, { signal: new AbortController().signal })
    expect(skill['content']).toContain('body of flutter-widget')
  })

  it('fails loudly when a declared pack is not installed', () => {
    expect(() => register({ packs: [{ name: 'flutter', dir: '/definitely/not/here' }] })).toThrow(
      /skill pack "flutter" is not installed/u,
    )
  })

  it('names the role’s escape hatch in the error', () => {
    expect(() => register({ packs: [{ name: 'flutter', dir: '/definitely/not/here' }] })).toThrow(/drop this role/u)
  })

  it('refuses a pack that collides with a shipped skill', () => {
    const dir = pack(scratch(), { 'role-init': '另一个流程入口' })
    expect(() => register({ packs: [{ name: 'flutter', dir }] })).toThrow(/collides/u)
  })

  it('refuses two packs that claim the same name', () => {
    const first = pack(scratch(), { 'flutter-widget': 'A' })
    const second = pack(scratch(), { 'flutter-widget': 'B' })
    expect(() =>
      register({
        packs: [
          { name: 'one', dir: first },
          { name: 'two', dir: second },
        ],
      }),
    ).toThrow(/collides/u)
  })

  it('scopes an allowlist to one pack', async () => {
    const dir = pack(scratch(), { 'flutter-widget': 'A', 'flutter-test': 'B' })
    const provider = register({ packs: [{ name: 'flutter', dir, include: ['flutter-test'] }] })
    const names = (await provider.list()).map((candidate) => candidate.name)
    expect(names).toContain('flutter-test')
    expect(names).not.toContain('flutter-widget')
    // The bundle's own allowlist is unaffected by the pack's.
    expect(names).toContain('role-init')
  })

  it('lets a role consist of nothing but its pack', async () => {
    const dir = pack(scratch(), { 'flutter-widget': 'A' })
    const provider = register({ include: ['flutter-widget'], packs: [{ name: 'flutter', dir }] })
    expect((await provider.list()).map((candidate) => candidate.name)).toEqual(['flutter-widget'])
  })

  it('lets a pack be the role’s whole kit when it declares *', async () => {
    const dir = pack(scratch(), { 'flutter-widget': 'A', 'flutter-test': 'B' })
    const provider = register({ include: ['role-init'], packs: [{ name: 'flutter', dir, include: ['*'] }] })
    const names = (await provider.list()).map((candidate) => candidate.name)
    expect(names).toEqual(['flutter-test', 'flutter-widget', 'role-init'])
  })

  it('keeps an allowlist from leaking the rest of the pack', async () => {
    const dir = pack(scratch(), { 'flutter-widget': 'A', 'flutter-test': 'B' })
    const provider = register({ include: ['role-init', 'flutter-test'], packs: [{ name: 'flutter', dir }] })
    const names = (await provider.list()).map((candidate) => candidate.name)
    expect(names).toEqual(['flutter-test', 'role-init'])
  })
})

describe('resource paths in pack skills', () => {
  const bundle = fileURLToPath(new URL('../skills/', import.meta.url)).replace(/\/+$/u, '')

  const load = async (provider: SkillProviderLike, name: string): Promise<string> => {
    const candidate = (await provider.list()).find((item) => item.name === name)
    if (candidate === undefined) throw new Error(`candidate ${name} missing`)
    const skill = await provider.get(candidate, { signal: new AbortController().signal })
    return String(skill['content'])
  }

  it('rebases a pack skill into its own pack, not into the bundle', async () => {
    const dir = skillWithBody(scratch(), 'alpha', 'run `.agent/skills/alpha/scripts/go`')
    const provider = register({ packs: [{ name: 'alpha-pack', dir }] })
    const content = await load(provider, 'alpha')
    expect(content).toContain(`${dir}/alpha/scripts/go`)
    expect(content).not.toContain(`${bundle}/alpha/`)
  })

  it('uses the pack’s skills directory for a three-level layout', async () => {
    const dir = join(scratch(), 'pack')
    mkdirSync(join(dir, 'skills'), { recursive: true })
    skillWithBody(join(dir, 'skills'), 'alpha', 'run `.agents/skills/alpha/scripts/go`')
    const provider = register({ packs: [{ name: 'alpha-pack', dir: join(dir, 'skills') }] })
    expect(await load(provider, 'alpha')).toContain(`${dir}/skills/alpha/scripts/go`)
  })

  it('rewrites a bare scripts citation when the pack skill owns one', async () => {
    const dir = skillWithBody(scratch(), 'alpha', 'run `scripts/go`', true)
    const provider = register({ packs: [{ name: 'alpha-pack', dir }] })
    expect(await load(provider, 'alpha')).toContain(`${dir}/alpha/scripts/go`)
  })

  it('leaves a bundle skill’s package-root scripts citation alone', async () => {
    const provider = register()
    const content = await load(provider, 'role-init')
    expect(content).toContain('node scripts/roles.mjs')
    expect(content).not.toContain(`${bundle}/role-init/scripts/roles.mjs`)
  })

  it('still strips rank and locator from a pack skill', async () => {
    const dir = pack(scratch(), { 'flutter-widget': 'A' })
    const provider = register({ packs: [{ name: 'flutter', dir }] })
    const candidate = (await provider.list()).find((item) => item.name === 'flutter-widget')
    if (candidate === undefined) throw new Error('candidate missing')
    const skill = await provider.get(candidate, { signal: new AbortController().signal })
    expect(skill).not.toHaveProperty('rank')
    expect(skill).not.toHaveProperty('locator')
  })
})

describe('include validation', () => {
  it('names every missing skill and lists what is visible', () => {
    expect(() => register({ include: ['role-init', 'does-not-exist'] })).toThrow(/does-not-exist/u)
    expect(() => register({ include: ['role-init', 'does-not-exist'] })).toThrow(/Visible skills: role-init/u)
  })

  it('names the provider so a multi-instance profile is diagnosable', () => {
    expect(() => register({ providerName: 'dsh-fullstack-team-backend', include: ['nope'] })).toThrow(
      /provider "dsh-fullstack-team-backend"/u,
    )
  })

  it('accepts a name that only a declared pack provides', async () => {
    const dir = pack(scratch(), { 'flutter-test': 'B' })
    const provider = register({ include: ['flutter-test'], packs: [{ name: 'flutter', dir }] })
    expect((await provider.list()).map((candidate) => candidate.name)).toEqual(['flutter-test'])
  })

  it('treats a name that is also excluded as missing', () => {
    expect(() => register({ include: ['role-init', 'acceptance-guard'], exclude: ['acceptance-guard'] })).toThrow(
      /"acceptance-guard"/u,
    )
  })

  it('lets an empty include mean “everything shipped”', async () => {
    const provider = register({ include: [] })
    expect((await provider.list()).map((candidate) => candidate.name)).toContain('role-init')
  })
})
