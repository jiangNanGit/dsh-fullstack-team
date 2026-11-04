import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
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
