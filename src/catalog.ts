/**
 * Skill catalog for the `dsh-fullstack-team` bundle.
 *
 * The bundle ships Agent Skills as plain `SKILL.md` directories under
 * `skills/`. This module discovers them, validates their YAML frontmatter, and
 * projects each one into a skill-provider candidate, so an installed bundle
 * needs no user-side configuration: the skills appear as soon as the plugin
 * loads.
 *
 * Discovery is strict on purpose. A malformed skill fails the plugin instead of
 * silently disappearing from the catalog, because a flow skill that cannot be
 * advertised is a defect the operator must see.
 *
 * @module dsh-fullstack-team/catalog
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { parse } from 'yaml'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'

/** Public skill-name grammar, shared with the harness. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** Leading YAML frontmatter block, as the harness writes it. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u

/** One parsed `SKILL.md`. */
export interface ParsedSkill {
  /** Kebab-case skill name from the frontmatter. */
  name: string
  /** Trigger text from the frontmatter. */
  description: string
  /** Frontmatter entries other than `name` and `description`. */
  metadata?: Record<string, unknown>
  /** Markdown body with the frontmatter removed. */
  content: string
}

/** A skill as advertised to the skill registry. */
export interface SkillCandidate {
  name: string
  description: string
  invocation: { modelInvocable: boolean; userInvocable: boolean }
  provider: string
  source: string
  rank: number
  resourceBase: { kind: 'directory'; path: string }
  locator: string
  metadata?: Record<string, unknown>
}

/** Options accepted by {@link discoverSkills}. */
export interface DiscoverOptions {
  /** Provider name recorded on every candidate. */
  provider: string
  /** Allowlist of skill names; empty means every shipped skill. */
  include?: readonly string[]
  /** Denylist of skill names, applied after `include`. */
  exclude?: readonly string[]
  /** Rank assigned to every candidate; defaults to the bundled rank. */
  rank?: number
}

/**
 * Parse one `SKILL.md`.
 *
 * @param raw - File contents.
 * @param path - Path used in error messages.
 * @returns The validated skill.
 * @throws When the frontmatter is missing, or `name`/`description` is absent or
 *   malformed.
 */
export function parseSkill(raw: string, path: string): ParsedSkill {
  const block = FRONTMATTER.exec(raw)
  if (block?.[1] === undefined) throw new Error(`dsh-fullstack-team: ${path} has no YAML frontmatter`)

  const parsed: unknown = parse(block[1])
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`dsh-fullstack-team: ${path} frontmatter is not a mapping`)
  }

  const fields = parsed as Record<string, unknown>
  const skillName = fields['name']
  const description = fields['description']
  if (typeof skillName !== 'string' || !SKILL_NAME.test(skillName)) {
    throw new Error(`dsh-fullstack-team: ${path} needs a kebab-case "name"`)
  }
  if (typeof description !== 'string' || description.trim().length === 0) {
    throw new Error(`dsh-fullstack-team: ${path} needs a non-empty "description"`)
  }

  const { name: _name, description: _description, ...rest } = fields
  const metadata = Object.keys(rest).length > 0 ? rest : undefined

  return {
    name: skillName,
    description,
    ...(metadata === undefined ? {} : { metadata }),
    content: raw.slice(block[0].length).trim(),
  }
}

/** Directory prefixes skills use when they cite their own bundled resources. */
const OWN_RESOURCE_PREFIXES = ['.agent/skills/', '.dsh/skills/', '.claude/skills/'] as const

/**
 * Rewrite a skill's references to its own bundled resources.
 *
 * A skill written for one product cites its scripts by that product's layout —
 * `.agent/skills/impeccable/scripts/impeccable`. Once the skill ships inside a
 * bundle, that path does not exist in the user's project, and the model would
 * try to run a file that is not there. The bundle knows where the file really
 * is, so it rebases the citation to the installed location at load time and the
 * source `SKILL.md` stays untouched.
 *
 * @param content - Markdown body of the skill.
 * @param skillName - Skill whose resources are being cited.
 * @param skillRoot - Directory holding every shipped skill.
 * @returns The body with citations pointed at the installed copy.
 */
export function rebaseResourcePaths(content: string, skillName: string, skillRoot: string): string {
  const target = `${skillRoot.replace(/[\\/]+$/u, '')}/${skillName}/`
  let result = content
  for (const prefix of OWN_RESOURCE_PREFIXES) {
    result = result.replaceAll(`${prefix}${skillName}/`, target)
  }
  return result
}

/**
 * Discover every skill directory under `skillDir`.
 *
 * A skill is a directory containing a readable `SKILL.md`; directories without
 * one are ignored so the bundle can carry notes next to the skills. Names must
 * be unique — a duplicate is an error, not a silent overwrite.
 *
 * @param skillDir - Absolute path of the shipped skills directory.
 * @param options - Provider name, filters, and rank.
 * @returns Candidates sorted by name.
 */
export function discoverSkills(skillDir: string, options: DiscoverOptions): SkillCandidate[] {
  const include = new Set(options.include ?? [])
  const exclude = new Set(options.exclude ?? [])
  const rank = options.rank ?? BUNDLED_SKILL_RANK
  const candidates: SkillCandidate[] = []
  const seen = new Set<string>()

  for (const entry of readdirSync(skillDir).sort()) {
    if (entry.startsWith('.')) continue
    const directory = join(skillDir, entry)
    if (!statSync(directory).isDirectory()) continue

    const locator = join(directory, 'SKILL.md')
    let raw: string
    try {
      raw = readFileSync(locator, 'utf8')
    } catch {
      continue
    }

    const skill = parseSkill(raw, locator)
    if (include.size > 0 && !include.has(skill.name)) continue
    if (exclude.has(skill.name)) continue
    if (seen.has(skill.name)) throw new Error(`dsh-fullstack-team: duplicate skill name "${skill.name}"`)
    seen.add(skill.name)

    candidates.push({
      name: skill.name,
      description: skill.description,
      invocation: { modelInvocable: true, userInvocable: true },
      provider: options.provider,
      source: 'bundled',
      rank,
      resourceBase: { kind: 'directory', path: directory.split(sep).join('/') },
      locator,
      ...(skill.metadata === undefined ? {} : { metadata: skill.metadata }),
    })
  }

  return candidates.sort((left, right) => left.name.localeCompare(right.name))
}
