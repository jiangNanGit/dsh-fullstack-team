import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverSkills, parseSkill } from '../src/catalog'
import { apply, type DevflowConfig, type DevflowContext, type SkillProviderLike } from '../src/index'

const shipped = fileURLToPath(new URL('../skills/', import.meta.url))

/** Skills this bundle is expected to ship; keep in sync with skills/. */
const EXPECTED = [
  'acceptance-guard',
  'dev-orchestrator',
  'error-triage',
  'impeccable',
  'ops-runbook',
  'requirement-clarify',
  'taste',
  'ui-theme-governance',
  'yunxiao-projex-ops',
]

const temporary: string[] = []

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** Create a throwaway skills directory from `{ name: frontmatter }` entries. */
function fixture(skills: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-devflow-'))
  temporary.push(root)
  for (const [directory, frontmatter] of Object.entries(skills)) {
    mkdirSync(join(root, directory), { recursive: true })
    writeFileSync(join(root, directory, 'SKILL.md'), `---\n${frontmatter}\n---\n\n# body\n`)
  }
  return root
}

describe('shipped skills', () => {
  it('advertises exactly the expected catalog', () => {
    const candidates = discoverSkills(shipped, { provider: 'dsh-devflow' })
    expect(candidates.map((candidate) => candidate.name)).toEqual(EXPECTED)
  })

  it('gives every skill a description and a readable base directory', () => {
    for (const candidate of discoverSkills(shipped, { provider: 'dsh-devflow' })) {
      expect(candidate.description.trim().length).toBeGreaterThan(0)
      expect(candidate.resourceBase).toEqual({ kind: 'directory', path: candidate.resourceBase.path })
      expect(candidate.locator.endsWith('SKILL.md')).toBe(true)
      expect(candidate.rank).toBe(600)
      expect(candidate.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    }
  })

  it('keeps extra frontmatter as metadata', () => {
    const impeccable = discoverSkills(shipped, { provider: 'dsh-devflow' }).find(
      (candidate) => candidate.name === 'impeccable',
    )
    expect(impeccable?.metadata?.['version']).toBeDefined()
  })
})

describe('filters', () => {
  const skills = () => fixture({
    alpha: 'name: alpha\ndescription: first',
    beta: 'name: beta\ndescription: second',
    gamma: 'name: gamma\ndescription: third',
  })

  it('returns every skill without filters', () => {
    expect(discoverSkills(skills(), { provider: 'p' }).map((candidate) => candidate.name)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ])
  })

  it('treats include as an allowlist', () => {
    expect(discoverSkills(skills(), { provider: 'p', include: ['beta'] }).map((candidate) => candidate.name)).toEqual([
      'beta',
    ])
  })

  it('applies exclude after include', () => {
    expect(
      discoverSkills(skills(), { provider: 'p', include: ['alpha', 'beta'], exclude: ['alpha'] }).map(
        (candidate) => candidate.name,
      ),
    ).toEqual(['beta'])
  })

  it('rejects duplicate names instead of shadowing one', () => {
    const duplicated = fixture({
      one: 'name: alpha\ndescription: first',
      two: 'name: alpha\ndescription: duplicate',
    })
    expect(() => discoverSkills(duplicated, { provider: 'p' })).toThrow(/duplicate skill name/u)
  })

  it('ignores directories without a SKILL.md', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-devflow-'))
    temporary.push(root)
    mkdirSync(join(root, 'notes'), { recursive: true })
    writeFileSync(join(root, 'notes', 'README.md'), 'not a skill\n')
    expect(discoverSkills(root, { provider: 'p' })).toEqual([])
  })
})

describe('parseSkill', () => {
  it('rejects a missing frontmatter block', () => {
    expect(() => parseSkill('# no frontmatter\n', 'x/SKILL.md')).toThrow(/no YAML frontmatter/u)
  })

  it('rejects a non-kebab-case name', () => {
    expect(() => parseSkill('---\nname: Not_Kebab\ndescription: d\n---\n', 'x/SKILL.md')).toThrow(/kebab-case/u)
  })

  it('rejects an empty description', () => {
    expect(() => parseSkill('---\nname: ok\ndescription: "  "\n---\n', 'x/SKILL.md')).toThrow(/description/u)
  })

  it('strips the frontmatter from the body', () => {
    const parsed = parseSkill('---\nname: ok\ndescription: d\n---\n\n# body\n', 'x/SKILL.md')
    expect(parsed.content).toBe('# body')
  })
})

describe('plugin', () => {
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
    if (captured === undefined) throw new Error('plugin registered no provider')
    return captured
  }

  it('registers a provider that lists and loads the shipped skills', async () => {
    const provider = register()
    expect(provider.name).toBe('dsh-devflow')

    const listed = await provider.list()
    expect(listed.map((candidate) => candidate.name)).toEqual(EXPECTED)

    const first = listed[0]!
    const loaded = await provider.get(first, { signal: new AbortController().signal })
    expect(loaded['name']).toBe(first.name)
    expect(String(loaded['content']).length).toBeGreaterThan(0)
    expect(loaded).not.toHaveProperty('rank')
  })

  it('honours include as a role allowlist', async () => {
    const provider = register({ include: ['dev-orchestrator', 'requirement-clarify'] })
    const listed = await provider.list()
    expect(listed.map((candidate) => candidate.name)).toEqual(['dev-orchestrator', 'requirement-clarify'])
  })
})
