/**
 * `dsh-devflow` bundle plugin.
 *
 * Registers the bundle's shipped Agent Skills with the harness skill registry.
 * The skills are read from `skills/` next to the built `lib/`, so the bundle is
 * self-contained: installing it and inserting this plugin is enough, and no
 * `customSkillDirs` entry is needed in the profile.
 *
 * Every skill is advertised as model-invocable and user-invocable at the
 * bundled rank, which keeps the usual precedence — a project or user skill with
 * the same name still wins.
 *
 * `include` exists for role presets: a preset that should only see part of the
 * flow inserts this plugin with an allowlist instead of shipping its own copy.
 *
 * @module dsh-devflow
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { discoverSkills, parseSkill, type SkillCandidate, type SkillCandidate as Candidate } from './catalog'

/** Cordis plugin identity. */
export const name = 'devflow'

/** Registry this plugin contributes to. */
export const inject = ['skills']

/** Validated plugin configuration. */
export const Config = z.object({
  providerName: z.string().min(1).default('dsh-devflow'),
  include: z.array(z.string().min(1)).default([]),
  exclude: z.array(z.string().min(1)).default([]),
})

/** Configuration as resolved by Cordis. */
export interface DevflowConfig {
  providerName?: string
  include?: string[]
  exclude?: string[]
}

/** The slice of the skill registry this plugin uses. */
export interface SkillRegistryLike {
  registerProvider: (factory: () => SkillProviderLike) => unknown
}

/** The provider contract the registry consumes. */
export interface SkillProviderLike {
  name: string
  list: () => Promise<readonly SkillCandidate[]>
  get: (candidate: SkillCandidate, options: { signal: AbortSignal }) => Promise<Record<string, unknown>>
}

/** The slice of the Cordis context this plugin uses. */
export interface DevflowContext {
  skills: SkillRegistryLike
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
 * Register the bundle's skills.
 *
 * @param ctx - Context carrying the skill registry.
 * @param config - Optional provider name and name filters.
 * @throws When the bundle ships no matching skill, which would mean a broken
 *   installation rather than an empty profile.
 */
export function apply(ctx: DevflowContext, config: DevflowConfig = {}): void {
  const providerName = config.providerName ?? 'dsh-devflow'
  const skillDir = shippedSkillDir()

  const candidates = discoverSkills(skillDir, {
    provider: providerName,
    include: config.include ?? [],
    exclude: config.exclude ?? [],
  })
  if (candidates.length === 0) {
    throw new Error(`dsh-devflow: no skills to advertise under ${skillDir}`)
  }

  const provider: SkillProviderLike = {
    name: providerName,
    list: () => Promise.resolve(candidates),
    async get(candidate: Candidate, options) {
      const { rank: _rank, locator, ...summary } = candidate
      const skill = parseSkill(await readFile(locator, { encoding: 'utf8', signal: options.signal }), locator)
      return { ...summary, content: skill.content }
    },
  }

  ctx.skills.registerProvider(() => provider)
}
