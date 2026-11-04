import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SkillCandidate } from '../../src/catalog'
import { apply, expandDir, type DevflowConfig, type DevflowContext, type SkillProviderLike } from '../../src/index'
import { checkRoleIncludes, loadRoles, planRoles, skillNames } from '../../src/roles'

/**
 * FP-19 — the real skill pack, not a fixture.
 *
 * Everything else in this suite builds a pack out of two-line files, so the
 * interesting properties only show up against `team-core`: nine skills with real
 * bodies, resource citations written for another installation, and role
 * manifests whose `include` lists name skills the pack must supply. Those are
 * exactly the three things FP-01/FP-02 claimed to fix, so they get an assertion
 * here rather than a manual check.
 *
 * When the pack is not installed the cases skip and say why. They never pass:
 * a green run with no pack would be a false green, which is the failure this
 * whole batch exists to remove.
 */

const repository = fileURLToPath(new URL('../../', import.meta.url))
const packDir = expandDir('~/.dsh/skill-packs/team-core')
const installed = existsSync(packDir)

/** The pack's published manifest, as of 001. */
const PACK_SKILLS = [
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

/** Prefixes a skill body may cite; after `get` none of them may survive. */
const FOREIGN_PREFIXES = ['.agent/skills/', '.agents/skills/', '.dsh/skills/', '.claude/skills/']

if (!installed) {
  console.warn(
    `[real-pack.spec] 跳过真包集成：未找到 ${packDir}。` +
      '装好 team-core 技能包后在本机重跑；CI 无真包时按设计跳过（不伪造通过）。',
  )
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

/** Load one candidate's body through the provider. */
async function bodyOf(provider: SkillProviderLike, name: string): Promise<string> {
  const candidates = await provider.list()
  const candidate = candidates.find((item: SkillCandidate) => item.name === name)
  if (candidate === undefined) throw new Error(`skill "${name}" is not advertised`)
  const loaded = await provider.get(candidate, { signal: new AbortController().signal })
  return String(loaded.content)
}

describe('真包集成：team-core', () => {
  it.skipIf(!installed)('发现的技能集合 = 内置 role-init + pack 的 9 个技能', async () => {
    const provider = register({ packs: [{ name: 'team-core', dir: packDir }] })
    const names = (await provider.list()).map((candidate) => candidate.name).sort()

    expect(names).toEqual([...PACK_SKILLS, 'role-init'].sort())
    // A duplicate name would let the host's merge-by-name pick one silently.
    expect(new Set(names).size).toBe(names.length)
  })

  it.skipIf(!installed)('impeccable 正文经 get() 后不含任何外部技能前缀（rebase 生效）', async () => {
    const provider = register({ packs: [{ name: 'team-core', dir: packDir }] })
    const content = await bodyOf(provider, 'impeccable')

    // Guard against a body that came back empty or truncated: the assertions
    // below would then pass for the wrong reason.
    expect(content.length).toBeGreaterThan(1000)
    for (const prefix of FOREIGN_PREFIXES) expect(content).not.toContain(prefix)
    // Positive control: citations were rewritten to the pack's own directory.
    expect(content).toContain(`${packDir}/impeccable/`)
  })

  it.skipIf(!installed)('roles/*.role.yml 的 include 全部能在「内置 ∪ pack」里找到', () => {
    const roles = loadRoles(join(repository, 'roles'))
    const plan = planRoles(roles, (dir) => existsSync(expandDir(dir)))

    // Same rule as scripts/roles.mjs: built-ins first, then every ready pack a
    // mountable role declares, narrowed by that pack's own include.
    const available = new Set(skillNames(join(repository, 'skills')))
    for (const { role } of plan.enabled) {
      for (const pack of role.packs ?? []) {
        const dir = expandDir(pack.dir)
        if (!existsSync(dir)) continue
        const include = (pack.include ?? []).filter((name) => name !== '*')
        for (const name of skillNames(dir)) {
          if (include.length > 0 && !include.includes(name)) continue
          available.add(name)
        }
      }
    }

    expect(checkRoleIncludes(plan, available)).toEqual([])
    // The pack must actually be one of the sources, or the check above would be
    // measuring a different set than the one the provider mounts.
    expect(available.has('impeccable')).toBe(true)
  })
})
