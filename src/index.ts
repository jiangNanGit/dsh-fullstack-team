/**
 * `dsh-fullstack-team` bundle plugin.
 *
 * Contributes three things to a profile:
 *
 * 1. the flow's Agent Skills, read from `skills/` next to the built `lib/`, so
 *    installing the bundle needs no profile skill-directory configuration;
 * 2. two deterministic tools — `devflow_gate` and `devflow_state` — that turn
 *    "did this stage produce something the next stage can consume?" and "which
 *    stage am I on, and may I leave it?" from model recollection into file
 *    reads;
 * 3. nothing else. Role composition stays in a preset, which narrows this
 *    plugin with `include` when a role must only see part of the flow.
 *
 * @module dsh-fullstack-team
 */

import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { discoverSkills, parseSkill, rebaseResourcePaths, type SkillCandidate } from './catalog'
import { flowTools } from './tools'

/** Cordis plugin identity. */
export const name = 'devflow'

/** Registries this plugin contributes to. */
export const inject = ['skills', 'tools']

/** Validated plugin configuration. */
export const Config = z.object({
  providerName: z.string().min(1).default('dsh-fullstack-team'),
  include: z.array(z.string().min(1)).default([]),
  exclude: z.array(z.string().min(1)).default([]),
  /** Register `devflow_gate` and `devflow_state`. */
  tools: z.boolean().default(true),
  /** Skill packs this role depends on, provisioned separately. */
  packs: z.array(
    z.object({
      name: z.string().min(1),
      dir: z.string().min(1),
      include: z.array(z.string().min(1)),
      exclude: z.array(z.string().min(1)),
    }),
  ),
})

/** Configuration as resolved by Cordis. */
export interface DevflowConfig {
  providerName?: string
  include?: string[]
  exclude?: string[]
  tools?: boolean
  packs?: PackConfig[]
}

/**
 * A skill pack a role depends on.
 *
 * The pack is not shipped with the bundle: a role declares it, the user
 * provisions it, and a missing pack is a startup error rather than a role that
 * quietly runs without the capability it was hired for.
 */
export interface PackConfig {
  /** Pack name, used in diagnostics. */
  name: string
  /** Directory holding the pack's `SKILL.md` directories. `~` is expanded. */
  dir: string
  /** Optional allowlist scoped to this pack. */
  include?: string[]
  /** Optional denylist scoped to this pack. */
  exclude?: string[]
}

/** The slice of the skill registry this plugin uses. */
export interface SkillRegistryLike {
  registerProvider: (factory: () => SkillProviderLike) => unknown
}

/** The slice of the tool registry this plugin uses. */
export interface ToolRegistryLike {
  register: (definition: unknown) => unknown
}

/** The provider contract the skill registry consumes. */
export interface SkillProviderLike {
  name: string
  list: () => Promise<readonly SkillCandidate[]>
  get: (candidate: SkillCandidate, options: { signal: AbortSignal }) => Promise<Record<string, unknown>>
}

/** The slice of the Cordis context this plugin uses. */
export interface DevflowContext {
  skills: SkillRegistryLike
  tools: ToolRegistryLike
}

/**
 * Directory holding the shipped skills.
 *
 * Resolved from the built module so a linked or installed package both work:
 * `lib/index.js` → `../skills/`.
 */
function shippedSkillDir(): string {
  return fileURLToPath(new URL('../skills/', import.meta.url))
}

/**
 * Resolve a configured directory to an absolute path.
 *
 * @param dir - Absolute path, `~`-relative path, or path relative to the cwd.
 * @returns The absolute path.
 */
export function expandDir(dir: string): string {
  if (dir === '~') return homedir()
  if (dir.startsWith('~/')) return resolve(homedir(), dir.slice(2))
  return resolve(dir)
}

/**
 * Collect the skills a pack contributes.
 *
 * @param pack - Pack declaration from the preset.
 * @param provider - Provider name to advertise under.
 * @returns The pack's candidates.
 * @throws When the pack is not provisioned, or is not a directory.
 */
function packSkills(pack: PackConfig, provider: string): SkillCandidate[] {
  const directory = expandDir(pack.dir)
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error(
      `dsh-fullstack-team: skill pack "${pack.name}" is not installed — expected a directory at ${directory}. ` +
        'Install the pack, or drop this role.',
    )
  }
  return discoverSkills(directory, {
    provider,
    include: pack.include ?? [],
    exclude: pack.exclude ?? [],
  })
}

/**
 * Register the bundle's skills and tools.
 *
 * @param ctx - Context carrying the skill and tool registries.
 * @param config - Optional provider name, name filters, and tool switch.
 * @throws When the bundle ships no matching skill, which would mean a broken
 *   installation rather than an empty profile.
 */
export function apply(ctx: DevflowContext, config: DevflowConfig = {}): void {
  const providerName = config.providerName ?? 'dsh-fullstack-team'
  const skillDir = shippedSkillDir()

  const candidates = discoverSkills(skillDir, {
    provider: providerName,
    include: config.include ?? [],
    exclude: config.exclude ?? [],
  })

  // A role's packs are additive: the bundle's own skills stay available, and a
  // name collision is an error rather than a silent override, because two
  // different copies of one skill is exactly the ambiguity this flow removes.
  const claimed = new Set(candidates.map((candidate) => candidate.name))
  for (const pack of config.packs ?? []) {
    for (const candidate of packSkills(pack, providerName)) {
      if (claimed.has(candidate.name)) {
        throw new Error(
          `dsh-fullstack-team: skill "${candidate.name}" from pack "${pack.name}" collides with a skill already advertised`,
        )
      }
      claimed.add(candidate.name)
      candidates.push(candidate)
    }
  }

  if (candidates.length === 0) {
    throw new Error(`dsh-fullstack-team: no skills to advertise under ${skillDir}`)
  }
  candidates.sort((left, right) => left.name.localeCompare(right.name))

  const provider: SkillProviderLike = {
    name: providerName,
    list: () => Promise.resolve(candidates),
    async get(candidate, options) {
      const { rank: _rank, locator, ...summary } = candidate
      const skill = parseSkill(await readFile(locator, { encoding: 'utf8', signal: options.signal }), locator)
      return { ...summary, content: rebaseResourcePaths(skill.content, candidate.name, skillDir) }
    },
  }

  ctx.skills.registerProvider(() => provider)

  if (config.tools ?? true) {
    for (const tool of flowTools()) ctx.tools.register(tool)
  }
}
