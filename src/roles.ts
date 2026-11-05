/**
 * The pluggable role layer.
 *
 * The flow fixes exactly one thing: a main agent that designs, dispatches,
 * adjudicates and accepts. Everything else is a role — a declared bundle of
 * skills plus whatever that role needs provisioned. A project brings its own
 * stack, so a stack role is chosen on site rather than baked into the bundle:
 * a Java repository gets the Java role, a Flutter repository gets the Flutter
 * role, and a role whose skill pack is missing is reported instead of mounted.
 *
 * @module dsh-fullstack-team/roles
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

/** A skill pack a role depends on. */
export interface RolePack {
  /** Pack name, used in diagnostics. */
  name: string
  /** Directory the pack is expected at. `~` is expanded by the caller. */
  dir: string
  /** What to do when the pack is absent. */
  hint?: string
  /** Narrow the pack; `*` means the pack is this role's whole kit. */
  include?: string[]
}

/** One role, as declared by a `*.role.yml` manifest. */
export interface RoleManifest {
  /** Stable role id, also the agent-preset id. */
  id: string
  /** Display name shown in the preset picker. */
  name: string
  /** One line describing what this role does. */
  description: string
  /** `core` roles exist in every project; `stack` roles depend on the project. */
  kind: 'core' | 'stack'
  /**
   * Repository markers that make this role worth mounting, as groups:
   * every marker inside one group must be present (AND), and any one group
   * being satisfied is enough (OR). A bare string is a one-element group, so
   * the flat list is still the "any of these" spelling. A marker ending in `.*`
   * is a suffix wildcard — it matches any file sharing that stem with a
   * non-empty extension (`vite.config.*` matches `vite.config.js`); every other
   * marker is an exact file name, dots included (`package.json`).
   */
  detect?: (string | string[])[]
  /** Skills from the bundle this role may see. */
  include: string[]
  /** Packs this role depends on. */
  packs?: RolePack[]
  /** Whether this role may dispatch other roles. */
  delegates?: boolean
  /** What this role takes in and hands back — the thin-agent contract. */
  contract?: { input: string; output: string }
}

/** A role whose packs are all present. */
export interface EnabledRole {
  role: RoleManifest
}

/** A role that cannot be mounted because a pack is missing. */
export interface BlockedRole {
  role: RoleManifest
  missing: { pack: RolePack }[]
}

/** The result of checking every declared role against the filesystem. */
export interface RolePlan {
  enabled: EnabledRole[]
  blocked: BlockedRole[]
}

/**
 * Read every `*.role.yml` under `dir`.
 *
 * @param dir - Directory holding the manifests.
 * @returns Roles sorted with core roles first, then by id.
 * @throws When a manifest is not an object or lacks a usable id.
 */
export function loadRoles(dir: string): RoleManifest[] {
  const roles: RoleManifest[] = []
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith('.role.yml')) continue
    const path = join(dir, entry)
    const raw = parse(readFileSync(path, 'utf8')) as unknown
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`dsh-fullstack-team: ${path} is not a role object`)
    }
    const role = raw as RoleManifest
    if (typeof role.id !== 'string' || role.id.length === 0) {
      throw new Error(`dsh-fullstack-team: ${path} has no id`)
    }
    if (!Array.isArray(role.include)) {
      throw new Error(`dsh-fullstack-team: role "${role.id}" has no include list`)
    }
    // Built-in skills are a shared core: the host merges catalogs by name, so a
    // preset can shadow a skill but never remove one. Allowing `exclude` here
    // would sell the operator a hiding that does not happen (docs/002).
    if (Object.hasOwn(raw, 'exclude')) {
      throw new Error(
        `dsh-fullstack-team: ${path} declares "exclude" — a role cannot hide built-in skills ` +
          '(they are the shared core; see docs/002-role-presets.md). Remove the key and narrow with "include" instead.',
      )
    }
    roles.push({
      ...role,
      kind: role.kind === 'stack' ? 'stack' : 'core',
      include: [...role.include],
      ...(role.packs === undefined ? {} : { packs: [...role.packs] }),
    })
  }
  return roles.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'core' ? -1 : 1
    return left.id.localeCompare(right.id)
  })
}

/**
 * Decide whether a role belongs to a repository.
 *
 * This is the executable form of the rule `role-init` documents. `detect` is a
 * list of groups, and the rule is **AND inside a group, OR between groups**: a
 * role matches when one of its groups is fully present. Two spellings share the
 * same reading — a bare string is a one-element group, so
 * `[pom.xml, build.gradle]` means "either build file", while
 * `[[package.json, vite.config.*]]` means "both, together".
 *
 * A marker written as `name.*` is a suffix wildcard: it stands for "that same
 * name with any non-empty extension", so `vite.config.*` matches
 * `vite.config.ts`, `vite.config.js` and `vite.config.mts` alike. Every other
 * marker is an exact file name — the dot in `package.json` is part of the name,
 * not a wildcard — and the wildcard prefix must match whole: `vite.config.*`
 * does not accept `vitest.config.ts`.
 *
 * The distinction matters in both directions. `package.json` alone is every
 * Node project, so Vue asks for the pair; three alternative Java build files are
 * three groups, so a repository holding any one of them is a Java repository.
 * A stack role that detects nothing is never chosen, and core roles exist
 * everywhere, so they always match.
 *
 * The comparison is case-sensitive and purely in-memory: scanning the
 * repository is the caller's job, which keeps this testable and keeps the rule
 * out of the filesystem layer.
 *
 * @param role - Role to test.
 * @param markers - Names of files and directories present at the repository root.
 * @returns `true` when the role should be mounted for that repository.
 */
export function roleMatches(role: RoleManifest, markers: ReadonlySet<string>): boolean {
  if (role.kind === 'core') return true
  const detect = role.detect ?? []
  if (detect.length === 0) return false
  return detect.some((group) =>
    (Array.isArray(group) ? group : [group]).every((marker) => markerMatches(marker, markers)),
  )
}

/** Suffix that turns a marker into a wildcard: `vite.config.*` means "vite.config.anything". */
const WILDCARD = '.*'

/**
 * Test one marker against the repository's top-level names.
 *
 * A marker ending in `.*` is a stem plus "any extension": it matches a name
 * that starts with the stem (the dot included) and carries at least one more
 * character — `vite.config.*` accepts `vite.config.js` and `vite.config.mts`,
 * but not `vite.config.` and not `vitest.config.ts`, whose stem differs. Every
 * other marker is compared exactly, so ordinary dotted file names such as
 * `package.json` and `cordis.patch.yml` stay exact matches rather than being
 * read as wildcards.
 *
 * @param marker - One `detect` entry.
 * @param markers - Names of files and directories present at the repository root.
 * @returns `true` when the marker is present.
 */
function markerMatches(marker: string, markers: ReadonlySet<string>): boolean {
  if (!marker.endsWith(WILDCARD)) return markers.has(marker)
  const stem = marker.slice(0, -1)
  for (const name of markers) {
    if (name.length > stem.length && name.startsWith(stem)) return true
  }
  return false
}

/**
 * Split roles into the ones that can be mounted and the ones that cannot.
 *
 * @param roles - Declared roles.
 * @param exists - Filesystem probe for a pack directory.
 * @returns The plan.
 */
export function planRoles(roles: readonly RoleManifest[], exists: (dir: string) => boolean): RolePlan {
  const plan: RolePlan = { enabled: [], blocked: [] }
  for (const role of roles) {
    const missing = (role.packs ?? []).filter((pack) => !exists(pack.dir)).map((pack) => ({ pack }))
    if (missing.length === 0) plan.enabled.push({ role })
    else plan.blocked.push({ role, missing })
  }
  return plan
}

/** A role whose `include` names a skill no source provides. */
export interface RoleIncludeGap {
  /** Role that would mount without the listed skills. */
  roleId: string
  /** Names nothing provides, sorted. */
  skills: string[]
}

/**
 * Check every role's `include` against the skill names actually available.
 *
 * This is the offline twin of the provider's startup check: the same rule, so a
 * manifest that passes here does not fail when a session mounts it. Roles that
 * are blocked by a missing pack are skipped — a missing pack is reported as
 * "role not mountable", not as a bad allowlist (pass the plan, not the roles,
 * to get that behaviour).
 *
 * @param input - Declared roles, or a plan so blocked roles are skipped.
 * @param available - Skill names any source provides (bundle + installed packs).
 * @returns One entry per role with missing names; empty when every name resolves.
 */
export function checkRoleIncludes(
  input: readonly RoleManifest[] | RolePlan,
  available: Iterable<string>,
): RoleIncludeGap[] {
  const roles = 'enabled' in input ? input.enabled.map(({ role }) => role) : input
  const known = new Set(available)
  const gaps: RoleIncludeGap[] = []
  for (const role of roles) {
    const missing = [...new Set(role.include.filter((name) => !known.has(name)))].sort()
    if (missing.length > 0) gaps.push({ roleId: role.id, skills: missing })
  }
  return gaps
}

/** Leading YAML frontmatter block, as the harness writes it. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u

/**
 * Names of the skills a directory holds.
 *
 * Used by the offline precheck to build the "available" set without depending
 * on the plugin runtime: a directory counts when it holds a readable
 * `SKILL.md`, and the frontmatter `name` wins over the directory name. A
 * missing directory is an empty contribution, not an error — packs are optional
 * and their absence is reported by {@link planRoles}.
 *
 * @param dir - Absolute path of a skills directory.
 * @returns Sorted skill names.
 */
export function skillNames(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return []
  const names: string[] = []
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith('.')) continue
    let raw: string
    try {
      raw = readFileSync(join(dir, entry, 'SKILL.md'), 'utf8')
    } catch {
      continue
    }
    const block = FRONTMATTER.exec(raw)
    const parsed = block?.[1] === undefined ? undefined : (parse(block[1]) as unknown)
    const declared =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)['name']
        : undefined
    names.push(typeof declared === 'string' && declared.length > 0 ? declared : entry)
  }
  return names.sort()
}

/**
 * Render a role's system prefix.
 *
 * The prefix carries only what the architecture says belongs to the agent —
 * who it is, what it accepts, what it returns. Procedure and standards live in
 * the skills, which is why this stays short.
 *
 * @param role - Role to render.
 * @returns A YAML-safe quoted scalar.
 */
export function renderPrefix(role: RoleManifest): string {
  const base = 'You are a coding agent powered by the {{model}} model.'
  if (role.contract === undefined) return JSON.stringify(base)
  const contract =
    `你是「${role.name}」。` +
    `输入契约：${role.contract.input}。` +
    `输出契约：${role.contract.output}。` +
    '需要的能力不在你的装备清单内时，停下来上报，不要自行替代。'
  return JSON.stringify(`${base} ${contract}`)
}

/** Indentation of an entry inside a preset's plugin list. */
const ENTRY_INDENT = ' '.repeat(10)

/**
 * Render the plugin entry that binds one role to the flow bundle.
 *
 * @param role - Role to bind.
 * @returns YAML lines.
 */
export function renderRoleEntry(role: RoleManifest): string {
  const lines = [
    `${ENTRY_INDENT}- id: dsh-fullstack-team`,
    `${ENTRY_INDENT}  name: dsh-fullstack-team`,
    `${ENTRY_INDENT}  config:`,
    `${ENTRY_INDENT}    providerName: dsh-fullstack-team`,
    `${ENTRY_INDENT}    include:`,
    ...role.include.map((skill) => `${ENTRY_INDENT}      - ${skill}`),
  ]
  if ((role.packs ?? []).length > 0) {
    lines.push(`${ENTRY_INDENT}    packs:`)
    for (const pack of role.packs ?? []) {
      lines.push(`${ENTRY_INDENT}      - name: ${pack.name}`)
      lines.push(`${ENTRY_INDENT}        dir: ${pack.dir}`)
      if (pack.hint !== undefined) lines.push(`${ENTRY_INDENT}        hint: ${JSON.stringify(pack.hint)}`)
      if ((pack.include ?? []).length > 0) {
        lines.push(`${ENTRY_INDENT}        include:`)
        for (const name of pack.include ?? []) lines.push(`${ENTRY_INDENT}          - '${name}'`)
      }
    }
  }
  lines.push(`${ENTRY_INDENT}    tools: true`)
  return lines.join('\n')
}

/**
 * Render the whole preset patch for a plan.
 *
 * The template is the upstream standard preset with four tokens for the role's
 * identity; everything else stays upstream's, so a role never drifts further
 * than the template does.
 *
 * @param template - Preset template containing `{{PRESET_ID}}`, `{{ROLE_ID}}`,
 *   `{{ROLE_NAME}}`, `{{ROLE_DESCRIPTION}}` and `{{ROLE_ENTRY}}`.
 * @param plan - Roles to mount.
 * @returns A YAML patch document.
 * @throws When the template is missing a token.
 */
export function renderRolesPatch(template: string, plan: RolePlan): string {
  for (const token of [
    '{{PRESET_ID}}',
    '{{ROLE_ID}}',
    '{{ROLE_NAME}}',
    '{{ROLE_DESCRIPTION}}',
    '{{ROLE_PREFIX}}',
    '{{ROLE_ENTRY}}',
  ]) {
    if (!template.includes(token)) throw new Error(`dsh-fullstack-team: preset template is missing ${token}`)
  }

  const dispatchable = plan.enabled
    .map(({ role }) => role)
    .filter((role) => role.id !== 'pm')
    .map((role) => role.id)

  const blocks: string[] = []
  plan.enabled.forEach(({ role }, index) => {
    let block = template
      .replaceAll('{{PRESET_ID}}', `preset-${role.id}`)
      .replaceAll('{{ROLE_ID}}', role.id)
      .replaceAll('{{ROLE_NAME}}', role.name)
      .replaceAll('{{ROLE_DESCRIPTION}}', role.description)
      .replaceAll('{{ROLE_PREFIX}}', renderPrefix(role))
      .replaceAll('{{ROLE_ENTRY}}', renderRoleEntry(role))
      .replace(/^        order: \d+$/mu, `        order: ${index + 1}`)

    if (role.delegates === true && dispatchable.length > 0) {
      const anchor = `${' '.repeat(18)}modelSelectionSettings: true`
      const allow = [
        `${' '.repeat(18)}allowedAgentPresets:`,
        ...dispatchable.map((id) => `${' '.repeat(20)}- ${id}`),
      ].join('\n')
      if (!block.includes(anchor)) throw new Error('dsh-fullstack-team: template has no tool-subagent block to extend')
      block = block.replace(anchor, `${anchor}\n${allow}`)
    }
    blocks.push(block.trimEnd())
  })
  // New sessions start as the main agent: the team is one thing the user talks
  // to, not a menu of seven. Dispatch still reaches every role preset by id.
  if (plan.enabled.some(({ role }) => role.id === 'pm')) {
    blocks.push(
      [
        '- id: agent-preset-registry',
        "  name: '@deepseek-ai/dsh-agent-preset-registry'",
        '  config:',
        '    default: pm',
      ].join('\n'),
    )
  }

  return `${blocks.join('\n')}\n`
}
