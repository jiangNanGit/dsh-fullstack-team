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

import { readFile } from 'node:fs/promises'
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
})

/** Configuration as resolved by Cordis. */
export interface DevflowConfig {
  providerName?: string
  include?: string[]
  exclude?: string[]
  tools?: boolean
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
  if (candidates.length === 0) {
    throw new Error(`dsh-fullstack-team: no skills to advertise under ${skillDir}`)
  }

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
