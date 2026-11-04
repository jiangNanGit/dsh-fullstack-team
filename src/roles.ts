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

import { readFileSync, readdirSync } from 'node:fs'
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
  /** Repository markers that make this role worth mounting. */
  detect?: string[]
  /** Skills from the bundle this role may see. */
  include: string[]
  /** Packs this role depends on. */
  packs?: RolePack[]
  /** Whether this role may dispatch other roles. */
  delegates?: boolean
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
  for (const token of ['{{PRESET_ID}}', '{{ROLE_ID}}', '{{ROLE_NAME}}', '{{ROLE_DESCRIPTION}}', '{{ROLE_ENTRY}}']) {
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
  return `${blocks.join('\n')}\n`
}
