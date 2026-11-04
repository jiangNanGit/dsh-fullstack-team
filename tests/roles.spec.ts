import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { loadRoles, planRoles, renderPrefix, renderRoleEntry, renderRolesPatch, type RoleManifest } from '../src/roles'

const repository = fileURLToPath(new URL('../', import.meta.url))
const temporary: string[] = []

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-roles-'))
  temporary.push(root)
  return root
}

const role = (over: Partial<RoleManifest> = {}): RoleManifest => ({
  id: 'backend-java',
  name: '后端开发（Java）',
  description: '按冻结契约实现后端',
  kind: 'stack',
  include: ['dev-orchestrator'],
  ...over,
})

describe('loadRoles', () => {
  it('reads the shipped manifests, core roles first', () => {
    const roles = loadRoles(join(repository, 'roles'))
    expect(roles.map((item) => item.id)).toEqual([
      'backend-design',
      'ops',
      'pm',
      'qa',
      'backend-java',
      'frontend-vue',
      'mobile-flutter',
    ])
    expect(roles.filter((item) => item.kind === 'core')).toHaveLength(4)
  })

  it('keeps a stack role’s detector markers', () => {
    const flutter = loadRoles(join(repository, 'roles')).find((item) => item.id === 'mobile-flutter')
    expect(flutter?.detect).toEqual(['pubspec.yaml'])
    expect(flutter?.packs?.map((pack) => pack.name)).toEqual(['team-core', 'flutter'])
  })

  it('marks only the main agent as a dispatcher', () => {
    const roles = loadRoles(join(repository, 'roles'))
    expect(roles.filter((item) => item.delegates === true).map((item) => item.id)).toEqual(['pm'])
  })

  it('rejects a manifest that is not an object', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'bad.role.yml'), '- just\n- a list\n', 'utf8')
    expect(() => loadRoles(dir)).toThrow(/not a role object/u)
  })

  it('rejects a manifest without an id', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'bad.role.yml'), 'name: 无名\ninclude: []\n', 'utf8')
    expect(() => loadRoles(dir)).toThrow(/has no id/u)
  })

  it('rejects a manifest without an include list', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'bad.role.yml'), 'id: x\nname: X\n', 'utf8')
    expect(() => loadRoles(dir)).toThrow(/no include list/u)
  })
})

describe('planRoles', () => {
  it('mounts a role whose packs are present', () => {
    const plan = planRoles([role()], () => true)
    expect(plan.enabled).toHaveLength(1)
    expect(plan.blocked).toHaveLength(0)
  })

  it('blocks a role whose pack is missing and says why', () => {
    const withPack = role({ packs: [{ name: 'flutter', dir: '/packs/flutter', hint: '解压到该目录' }] })
    const plan = planRoles([withPack], () => false)
    expect(plan.enabled).toHaveLength(0)
    expect(plan.blocked[0]?.missing[0]?.pack.hint).toBe('解压到该目录')
  })

  it('mounts a core role that declares no packs even on an empty machine', () => {
    const plan = planRoles([role({ id: 'pm', kind: 'core', packs: undefined })], () => false)
    expect(plan.enabled[0]?.role.id).toBe('pm')
  })
})

describe('renderRoleEntry', () => {
  it('lists the allowlisted skills', () => {
    const entry = renderRoleEntry(role({ include: ['dev-orchestrator', 'acceptance-guard'] }))
    expect(entry).toContain('- dev-orchestrator')
    expect(entry).toContain('- acceptance-guard')
    expect(entry).toContain('tools: true')
  })

  it('declares packs with their directory', () => {
    const entry = renderRoleEntry(role({ packs: [{ name: 'flutter', dir: '~/.dsh/skill-packs/flutter' }] }))
    expect(entry).toContain('packs:')
    expect(entry).toContain('- name: flutter')
    expect(entry).toContain('dir: ~/.dsh/skill-packs/flutter')
  })
})

describe('renderPrefix', () => {
  it('keeps the model placeholder for the loader', () => {
    expect(renderPrefix(role())).toContain('{{model}}')
  })

  it('carries the role’s input and output contract', () => {
    const prefix = renderPrefix(role({ contract: { input: '冻结档', output: 'design.md' } }))
    expect(prefix).toContain('输入契约：冻结档')
    expect(prefix).toContain('输出契约：design.md')
  })

  it('tells the role to stop rather than substitute', () => {
    const prefix = renderPrefix(role({ contract: { input: 'A', output: 'B' } }))
    expect(prefix).toContain('停下来上报')
  })

  it('stays a valid YAML scalar', () => {
    const prefix = renderPrefix(role({ contract: { input: 'a: b', output: 'c"d' } }))
    expect(() => JSON.parse(prefix)).not.toThrow()
  })
})

describe('renderRolesPatch', () => {
  const template = readFileSync(join(repository, 'templates', 'preset.template.yml'), 'utf8')

  it('emits one insert entry per mountable role', () => {
    const patch = renderRolesPatch(template, planRoles([role({ id: 'qa', kind: 'core' })], () => true))
    expect(patch.split('- insert:')).toHaveLength(2)
    expect(patch).toContain('id: preset-qa')
  })

  it('leaves the persona placeholder for the loader', () => {
    const patch = renderRolesPatch(template, planRoles([role()], () => true))
    expect(patch).toContain('{{model}}')
  })

  it('gives the dispatcher the list of roles it may spawn', () => {
    const patch = renderRolesPatch(
      template,
      planRoles([role({ id: 'pm', kind: 'core', delegates: true }), role({ id: 'qa', kind: 'core' })], () => true),
    )
    expect(patch).toContain('allowedAgentPresets:')
    expect(patch).toContain('- qa')
    expect(patch).not.toContain('- pm\n')
  })

  it('does not hand the allowlist to a non-dispatcher', () => {
    const patch = renderRolesPatch(template, planRoles([role({ id: 'qa', kind: 'core' })], () => true))
    expect(patch).not.toContain('allowedAgentPresets')
  })

  it('numbers the presets in order', () => {
    const patch = renderRolesPatch(
      template,
      planRoles([role({ id: 'a', kind: 'core' }), role({ id: 'b', kind: 'core' })], () => true),
    )
    expect(patch).toContain('order: 1')
    expect(patch).toContain('order: 2')
  })

  it('refuses a template missing a token', () => {
    expect(() => renderRolesPatch('nothing here', { enabled: [], blocked: [] })).toThrow(/missing \{\{PRESET_ID\}\}/u)
  })
})
