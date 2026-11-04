import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverSkills, parseSkill, rebaseResourcePaths } from '../src/catalog'
import { apply, type DevflowConfig, type DevflowContext, type SkillProviderLike } from '../src/index'

const shipped = fileURLToPath(new URL('../skills/', import.meta.url))

/** Skills this bundle is expected to ship; keep in sync with skills/. */
const EXPECTED = ['role-init']

const temporary: string[] = []

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** Create a throwaway skills directory from `{ name: frontmatter }` entries. */
function fixture(skills: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-fullstack-team-'))
  temporary.push(root)
  for (const [directory, frontmatter] of Object.entries(skills)) {
    mkdirSync(join(root, directory), { recursive: true })
    writeFileSync(join(root, directory, 'SKILL.md'), `---\n${frontmatter}\n---\n\n# body\n`)
  }
  return root
}

describe('shipped skills', () => {
  it('advertises exactly the expected catalog', () => {
    const candidates = discoverSkills(shipped, { provider: 'dsh-fullstack-team' })
    expect(candidates.map((candidate) => candidate.name)).toEqual(EXPECTED)
  })

  it('gives every skill a description and a readable base directory', () => {
    for (const candidate of discoverSkills(shipped, { provider: 'dsh-fullstack-team' })) {
      expect(candidate.description.trim().length).toBeGreaterThan(0)
      expect(candidate.resourceBase).toEqual({ kind: 'directory', path: candidate.resourceBase.path })
      expect(candidate.locator.endsWith('SKILL.md')).toBe(true)
      expect(candidate.rank).toBe(600)
      expect(candidate.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    }
  })

  it('keeps extra frontmatter as metadata', () => {
    const dir = fixture({ alpha: 'name: alpha\ndescription: first\nversion: 1.2.3' })
    const alpha = discoverSkills(dir, { provider: 'p' }).find((candidate) => candidate.name === 'alpha')
    expect(alpha?.metadata?.['version']).toBe('1.2.3')
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
    const root = mkdtempSync(join(tmpdir(), 'dsh-fullstack-team-'))
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
    expect(provider.name).toBe('dsh-fullstack-team')

    const listed = await provider.list()
    expect(listed.map((candidate) => candidate.name)).toEqual(EXPECTED)

    const first = listed[0]!
    const loaded = await provider.get(first, { signal: new AbortController().signal })
    expect(loaded['name']).toBe(first.name)
    expect(String(loaded['content']).length).toBeGreaterThan(0)
    expect(loaded).not.toHaveProperty('rank')
  })

  it('honours include as a role allowlist', async () => {
    const provider = register({ include: ['role-init'] })
    expect((await provider.list()).map((candidate) => candidate.name)).toEqual(['role-init'])
  })

  it('refuses an allowlist that names a skill the machine does not have', () => {
    expect(() => register({ include: ['dev-orchestrator'] })).toThrow(/no skills to advertise/u)
  })
})

describe('rebaseResourcePaths', () => {
  it('points a citation at the installed copy', () => {
    expect(rebaseResourcePaths('run `.agent/skills/impeccable/scripts/impeccable`', 'impeccable', '/opt/bundle/skills/')).toBe(
      'run `/opt/bundle/skills/impeccable/scripts/impeccable`',
    )
  })

  it('tolerates a root without a trailing separator', () => {
    expect(rebaseResourcePaths('.dsh/skills/x/a.js', 'x', '/opt/bundle/skills')).toBe('/opt/bundle/skills/x/a.js')
  })

  it('leaves another skill’s resources alone', () => {
    const text = '`.agent/skills/taste/assets/base.css`'
    expect(rebaseResourcePaths(text, 'impeccable', '/opt/bundle/skills/')).toBe(text)
  })

  it('leaves ordinary prose alone', () => {
    const text = 'See the scripts directory.'
    expect(rebaseResourcePaths(text, 'impeccable', '/opt/bundle/skills/')).toBe(text)
  })

  it('fixes citations in a skill’s real body', () => {
    const dir = fixture({ alpha: 'name: alpha\ndescription: first' })
    writeFileSync(
      join(dir, 'alpha', 'SKILL.md'),
      '---\nname: alpha\ndescription: first\n---\n\nrun `.agent/skills/alpha/scripts/go`\n',
      'utf8',
    )
    const body = parseSkill(readFileSync(join(dir, 'alpha', 'SKILL.md'), 'utf8'), join(dir, 'alpha', 'SKILL.md')).content
    expect(rebaseResourcePaths(body, 'alpha', dir)).toContain(join(dir, 'alpha', 'scripts', 'go'))
  })
})
