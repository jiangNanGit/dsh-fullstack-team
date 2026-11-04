import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, type DevflowConfig, type DevflowContext, type SkillProviderLike } from '../src/index'

/**
 * FP-22 — the bundle's own skills are a shared core.
 *
 * The contract is three artifacts acting together: one global patch row with no
 * allowlist, documentation that says what that means, and a manifest loader
 * that refuses to pretend otherwise. The merge assertion below mirrors the
 * host's rule (global layer first, a nearer layer wins only a duplicate name),
 * because that is exactly why a preset's `include` cannot hide a built-in.
 */

const repository = fileURLToPath(new URL('../', import.meta.url))
const temporary: string[] = []

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-core-'))
  temporary.push(root)
  return root
}

/** Apply the plugin to a fake registry and return the provider it registered. */
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

/** A pack holding one skill, so a preset can exclude the bundle's own skills. */
function fixturePack(): string {
  const root = scratch()
  const directory = join(root, 'acceptance-guard')
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, 'SKILL.md'),
    '---\nname: acceptance-guard\ndescription: pack copy\n---\n\nbody\n',
    'utf8',
  )
  return root
}

describe('the bundle patch', () => {
  const patch = readFileSync(join(repository, 'cordis.patch.yml'), 'utf8')

  it('keeps exactly one global entry', () => {
    expect(patch.match(/^\s*- insert:/gmu)).toHaveLength(1)
    expect(patch.match(/id: dsh-fullstack-team/gmu)).toHaveLength(1)
    expect(patch).toContain('name: dsh-fullstack-team')
  })

  it('does not narrow the global entry', () => {
    expect(patch).not.toContain('include:')
    expect(patch).not.toContain('exclude:')
    expect(patch).not.toContain('tools:')
  })
})

describe('the documented ruling', () => {
  const doc = readFileSync(join(repository, 'docs', '002-role-presets.md'), 'utf8')

  it('states that built-in skills are the shared core', () => {
    expect(doc).toContain('内置技能＝全员公共核心')
  })

  it('states that include narrows one instance and exclude does not hide built-ins', () => {
    expect(doc).toContain('`include` 只缩')
    expect(doc).toMatch(/`exclude` 对内置技能[^。\n]*无效/u)
  })

  it('says only pack skills can be isolated', () => {
    expect(doc).toContain('pack')
    expect(doc).toMatch(/真正能按角色隔离的只有/u)
  })
})

describe('catalog layering', () => {
  it('keeps role-init visible even when a preset’s include omits it', async () => {
    // Layer 1: the global row from cordis.patch.yml — no allowlist, so it
    // broadcasts every shipped skill to every session.
    const global = register()
    // Layer 2: a role preset that narrows itself to a pack skill only.
    const preset = register({ include: ['acceptance-guard'], packs: [{ name: 'team-core', dir: fixturePack() }] })

    const globalNames = (await global.list()).map((candidate) => candidate.name)
    const presetNames = (await preset.list()).map((candidate) => candidate.name)
    expect(globalNames).toContain('role-init')
    expect(presetNames).not.toContain('role-init')

    // The host merges by name across the global layer and the scope chain: the
    // nearer layer wins a duplicate, and nothing removes what only the global
    // layer advertises.
    const merged = new Map<string, boolean>()
    for (const layer of [globalNames, presetNames]) for (const name of layer) merged.set(name, true)
    expect(merged.has('role-init')).toBe(true)
    expect(merged.has('acceptance-guard')).toBe(true)
  })

  it('lets no manifest declare exclude', () => {
    for (const entry of readdirSync(join(repository, 'roles'))) {
      if (!entry.endsWith('.role.yml')) continue
      expect(readFileSync(join(repository, 'roles', entry), 'utf8')).not.toContain('exclude:')
    }
  })
})
