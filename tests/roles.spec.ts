import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyPluginOverrides,
  checkRoleIncludes,
  loadRoles,
  planRoles,
  renderPrefix,
  renderRoleEntry,
  renderRolesPatch,
  roleMatches,
  skillNames,
  type RoleManifest,
} from '../src/roles'

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
      'dsh-plugin-dev',
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

  it('rejects a manifest that tries to exclude built-in skills', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'bad.role.yml'), 'id: x\nname: X\ninclude: [role-init]\nexclude: [role-init]\n', 'utf8')
    expect(() => loadRoles(dir)).toThrow(/bad\.role\.yml/u)
    expect(() => loadRoles(dir)).toThrow(/exclude/u)
    expect(() => loadRoles(dir)).toThrow(/shared core/u)
  })

  it('ships no manifest that declares exclude', () => {
    for (const entry of loadRoles(join(repository, 'roles'))) {
      expect(Object.hasOwn(entry, 'exclude')).toBe(false)
    }
  })
})

describe('roleMatches', () => {
  const roles = loadRoles(join(repository, 'roles'))
  const find = (id: string): RoleManifest => {
    const found = roles.find((item) => item.id === id)
    if (found === undefined) throw new Error(`shipped roles have no "${id}"`)
    return found
  }

  it('selects dsh-plugin-dev for this repository', () => {
    const markers = new Set(['cordis.patch.yml', 'tsdown.config.ts', 'package.json'])
    expect(roleMatches(find('dsh-plugin-dev'), markers)).toBe(true)
    expect(roleMatches(find('frontend-vue'), markers)).toBe(false)
  })

  it('requires both dsh-plugin-dev markers: the pair is one group', () => {
    expect(roleMatches(find('dsh-plugin-dev'), new Set(['cordis.patch.yml']))).toBe(false)
    expect(roleMatches(find('dsh-plugin-dev'), new Set(['tsdown.config.ts']))).toBe(false)
    expect(roleMatches(find('dsh-plugin-dev'), new Set(['cordis.patch.yml', 'tsdown.config.ts']))).toBe(true)
  })

  it('selects backend-java on any one build file: OR between single-marker groups', () => {
    expect(roleMatches(find('backend-java'), new Set(['pom.xml']))).toBe(true)
    expect(roleMatches(find('backend-java'), new Set(['build.gradle']))).toBe(true)
    expect(roleMatches(find('backend-java'), new Set(['build.gradle.kts']))).toBe(true)
    expect(roleMatches(find('backend-java'), new Set())).toBe(false)
  })

  it('requires the vue markers together: package.json alone does not select frontend-vue', () => {
    const onlyPackage = new Set(['package.json'])
    expect(roleMatches(find('frontend-vue'), onlyPackage)).toBe(false)
    expect(roleMatches(find('frontend-vue'), new Set(['vite.config.ts']))).toBe(false)
    expect(roleMatches(find('frontend-vue'), new Set(['package.json', 'vite.config.ts']))).toBe(true)
  })

  it('matches any extension when the marker ends in .*', () => {
    // FP-01: the manifest says `vite.config.*`, so the extension is not fixed.
    expect(roleMatches(find('frontend-vue'), new Set(['package.json', 'vite.config.js']))).toBe(true)
    expect(roleMatches(find('frontend-vue'), new Set(['package.json', 'vite.config.mts']))).toBe(true)
    expect(roleMatches(find('frontend-vue'), new Set(['package.json', 'vite.config.ts']))).toBe(true)
    expect(roleMatches(find('frontend-vue'), new Set(['vite.config.js']))).toBe(false)
  })

  it('requires the wildcard stem to match in full, so a longer name cannot pose as it', () => {
    expect(roleMatches(find('frontend-vue'), new Set(['package.json', 'vitest.config.ts']))).toBe(false)
  })

  it('keeps ordinary dotted file names exact rather than treating them as wildcards', () => {
    const node = role({ detect: ['package.json'] })
    expect(roleMatches(node, new Set(['package.json']))).toBe(true)
    expect(roleMatches(node, new Set(['package.yaml']))).toBe(false)
    expect(roleMatches(node, new Set(['package.json.bak']))).toBe(false)
    const plugin = role({ detect: [['cordis.patch.yml', 'tsdown.config.ts']] })
    expect(roleMatches(plugin, new Set(['cordis.patch.yml', 'tsdown.config.ts']))).toBe(true)
    expect(roleMatches(plugin, new Set(['cordis.patch.yaml', 'tsdown.config.ts']))).toBe(false)
  })

  it('needs a non-empty extension after the wildcard dot', () => {
    const wildcard = role({ detect: ['vite.config.*'] })
    expect(roleMatches(wildcard, new Set(['vite.config']))).toBe(false)
    expect(roleMatches(wildcard, new Set(['vite.config.']))).toBe(false)
    expect(roleMatches(wildcard, new Set(['vite.config.js']))).toBe(true)
  })

  it('mounts core roles even when the repository has no markers', () => {
    for (const id of ['pm', 'backend-design', 'qa', 'ops']) {
      expect(roleMatches(find(id), new Set())).toBe(true)
    }
  })

  it('never mounts a stack role whose detect is empty', () => {
    expect(roleMatches(role({ detect: [] }), new Set(['package.json', 'vite.config.ts']))).toBe(false)
    expect(roleMatches(role(), new Set(['package.json']))).toBe(false)
  })

  it('reads a list as AND inside a group and OR between groups', () => {
    expect(roleMatches(role({ detect: [['a', 'b']] }), new Set(['a']))).toBe(false)
    expect(roleMatches(role({ detect: [['a', 'b']] }), new Set(['a', 'b']))).toBe(true)
    expect(roleMatches(role({ detect: [['a', 'b'], 'c'] }), new Set(['c']))).toBe(true)
    expect(roleMatches(role({ detect: [['a', 'b'], 'c'] }), new Set(['a', 'b']))).toBe(true)
  })

  it('ships the manifests with the corrected detect groups', () => {
    expect(find('backend-java').detect).toEqual(['pom.xml', 'build.gradle', 'build.gradle.kts'])
    expect(find('frontend-vue').detect).toEqual([['package.json', 'vite.config.*']])
    expect(find('dsh-plugin-dev').detect).toEqual([['cordis.patch.yml', 'tsdown.config.ts']])
    expect(find('mobile-flutter').detect).toEqual(['pubspec.yaml'])
  })

  it('compares marker names case-sensitively', () => {
    expect(roleMatches(find('mobile-flutter'), new Set(['pubspec.yaml']))).toBe(true)
    expect(roleMatches(find('mobile-flutter'), new Set(['Pubspec.yaml']))).toBe(false)
  })
})

describe('checkRoleIncludes', () => {
  it('returns nothing when every name resolves', () => {
    expect(checkRoleIncludes([role()], ['dev-orchestrator'])).toEqual([])
  })

  it('reports one entry per role, listing every missing name', () => {
    const gaps = checkRoleIncludes([role({ include: ['dev-orchestrator', 'one', 'two'] })], ['dev-orchestrator'])
    expect(gaps).toEqual([{ roleId: 'backend-java', skills: ['one', 'two'] }])
  })

  it('ignores roles blocked by a missing pack when given the plan', () => {
    const blocked = role({ packs: [{ name: 'flutter', dir: '/packs/flutter' }], include: ['flutter-widget'] })
    const plan = planRoles([blocked], () => false)
    expect(checkRoleIncludes(plan, [])).toEqual([])
  })

  it('accepts a name a present pack provides', () => {
    const mounted = role({ packs: [{ name: 'flutter', dir: '/packs/flutter' }], include: ['flutter-widget'] })
    const plan = planRoles([mounted], () => true)
    expect(checkRoleIncludes(plan, ['flutter-widget'])).toEqual([])
  })

  it('reports a name that only a missing pack could have provided', () => {
    const mounted = role({ packs: [{ name: 'team-core', dir: '/packs/team-core' }], include: ['role-init', 'gone'] })
    const plan = planRoles([mounted], () => true)
    expect(checkRoleIncludes(plan, ['role-init'])).toEqual([{ roleId: 'backend-java', skills: ['gone'] }])
  })
})

describe('skillNames', () => {
  it('reads the frontmatter name, falling back to the directory name', () => {
    const dir = scratch()
    mkdirSync(join(dir, 'one'), { recursive: true })
    writeFileSync(join(dir, 'one', 'SKILL.md'), '---\nname: alpha\ndescription: d\n---\n', 'utf8')
    mkdirSync(join(dir, 'two'), { recursive: true })
    writeFileSync(join(dir, 'two', 'SKILL.md'), '# no frontmatter\n', 'utf8')
    expect(skillNames(dir)).toEqual(['alpha', 'two'])
  })

  it('skips directories without a SKILL.md', () => {
    const dir = scratch()
    mkdirSync(join(dir, 'notes'), { recursive: true })
    writeFileSync(join(dir, 'notes', 'README.md'), 'notes\n', 'utf8')
    expect(skillNames(dir)).toEqual([])
  })

  it('treats a missing directory as an empty contribution', () => {
    expect(skillNames(join(scratch(), 'nope'))).toEqual([])
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

  it('makes the main agent the default for new sessions', () => {
    const patch = renderRolesPatch(template, planRoles([role({ id: 'pm', kind: 'core', delegates: true })], () => true))
    expect(patch).toContain('agent-preset-registry')
    expect(patch).toContain('default: pm')
  })

  it('leaves the default alone when the main agent is not mounted', () => {
    const patch = renderRolesPatch(template, planRoles([role({ id: 'qa', kind: 'core' })], () => true))
    expect(patch).not.toContain('default: pm')
  })

  it('refuses a template missing a token', () => {
    expect(() => renderRolesPatch('nothing here', { enabled: [], blocked: [] })).toThrow(/missing \{\{PRESET_ID\}\}/u)
  })
})

describe('applyPluginOverrides', () => {
  /** A preset block shaped like the generated ones: plugin rows at ten spaces. */
  const block = [
    '- insert:',
    '    - id: preset-pm',
    '      config:',
    '        plugins:',
    "          - id: tool-bash",
    "            name: '@deepseek-ai/dsh-tool-bash'",
    "            disabled: !!js process.platform === 'win32'",
    "          - id: tool-plugin-manager",
    "            name: '@deepseek-ai/dsh-plugin-manager/tools'",
    '            disabled: !!js "!ctx.get(\'profileContext\')"',
    "          - id: tool-plugin-market",
    "            name: '@deepseek-ai/dsh-plugin-market/tools'",
    '            disabled: true',
    '          - id: dsh-fullstack-team',
    '            name: dsh-fullstack-team',
  ].join('\n')

  /** Lines that differ between two texts, paired by position (same length assumed). */
  const changed = (before: string, after: string): string[] => {
    const left = before.split('\n')
    const right = after.split('\n')
    expect(right).toHaveLength(left.length)
    return right.filter((line, index) => line !== left[index])
  }

  it('flips only the named rows and leaves every other line byte-identical', () => {
    const patched = applyPluginOverrides(block, { 'tool-plugin-manager': 'enabled', 'tool-plugin-market': 'enabled' })
    expect(changed(block, patched)).toEqual(['            disabled: false', '            disabled: false'])
    expect(patched).toContain("disabled: !!js process.platform === 'win32'")
  })

  it('replaces an existing `disabled: true` with false', () => {
    const patched = applyPluginOverrides(block, { 'tool-plugin-market': 'enabled' })
    expect(patched).toContain("            name: '@deepseek-ai/dsh-plugin-market/tools'\n            disabled: false")
  })

  it('replaces a whole `!!js` expression, leaving no half-written line', () => {
    const patched = applyPluginOverrides(block, { 'tool-plugin-manager': 'enabled' })
    expect(patched).toContain("            name: '@deepseek-ai/dsh-plugin-manager/tools'\n            disabled: false")
    expect(patched).not.toContain('ctx.get')
  })

  it('can switch a row back off: `disabled` writes true', () => {
    const patched = applyPluginOverrides(block, { 'tool-plugin-manager': 'disabled' })
    expect(patched).toContain("            name: '@deepseek-ai/dsh-plugin-manager/tools'\n            disabled: true")
  })

  it('inserts a `disabled:` line at the row’s key indentation when the row has none', () => {
    const withoutDisabled = [
      '        plugins:',
      "          - id: tool-schedule",
      "            name: '@deepseek-ai/dsh-tool-schedule'",
      "          - id: tool-ask-user",
      "            name: '@deepseek-ai/dsh-tool-ask-user'",
    ].join('\n')
    const patched = applyPluginOverrides(withoutDisabled, { 'tool-schedule': 'enabled' })
    expect(patched.split('\n')).toEqual([
      '        plugins:',
      "          - id: tool-schedule",
      "            name: '@deepseek-ai/dsh-tool-schedule'",
      '            disabled: false',
      "          - id: tool-ask-user",
      "            name: '@deepseek-ai/dsh-tool-ask-user'",
    ])
  })

  it('inserts before the next row, not inside a nested group that follows', () => {
    const nested = [
      '        plugins:',
      '          - id: tool-a',
      "            name: '@a'",
      '          - id: group',
      '            group: true',
      '            config:',
      '              - id: inner',
      "                name: '@inner'",
      '          - id: tool-b',
      "            name: '@b'",
    ].join('\n')
    const patched = applyPluginOverrides(nested, { 'tool-a': 'disabled' })
    expect(patched.split('\n')).toEqual([
      '        plugins:',
      '          - id: tool-a',
      "            name: '@a'",
      '            disabled: true',
      '          - id: group',
      '            group: true',
      '            config:',
      '              - id: inner',
      "                name: '@inner'",
      '          - id: tool-b',
      "            name: '@b'",
    ])
  })

  it('appends the inserted line at the end of the block when the row is last', () => {
    const tail = ['          - id: tool-z', "            name: '@z'"].join('\n')
    expect(applyPluginOverrides(tail, { 'tool-z': 'enabled' })).toBe(
      ["          - id: tool-z", "            name: '@z'", '            disabled: false'].join('\n'),
    )
  })

  it('returns the block untouched when nothing is overridden', () => {
    expect(applyPluginOverrides(block, {})).toBe(block)
  })

  it('refuses an unknown row id instead of ignoring it', () => {
    expect(() => applyPluginOverrides(block, { 'tool-plugin-nope': 'enabled' })).toThrow(/not in this preset template/u)
  })

  it('refuses an unknown setting instead of guessing', () => {
    expect(() =>
      applyPluginOverrides(block, { 'tool-plugin-manager': 'on' as unknown as 'enabled' }),
    ).toThrow(/unknown setting/u)
  })
})

describe('role-level plugin switches', () => {
  const template = readFileSync(join(repository, 'templates', 'preset.template.yml'), 'utf8')

  /** Split a generated patch into its per-preset blocks, keyed by preset id. */
  const blocks = (patch: string): Map<string, string> => {
    const map = new Map<string, string>()
    for (const block of patch.split('- insert:').slice(1)) {
      const match = /^    - id: (preset-\S+)$/mu.exec(block)
      if (match !== null) map.set(match[1] ?? '', block)
    }
    return map
  }

  it('ships pm as the only role that opens the two plugin tools', () => {
    const roles = loadRoles(join(repository, 'roles'))
    const pm = roles.find((item) => item.id === 'pm')
    expect(pm?.plugins).toEqual({ 'tool-plugin-manager': 'enabled', 'tool-plugin-market': 'enabled' })
    expect(roles.filter((item) => item.plugins !== undefined).map((item) => item.id)).toEqual(['pm'])
  })

  it('turns both rows on inside preset-pm and leaves the other seven presets alone', () => {
    const roles = loadRoles(join(repository, 'roles'))
    const patch = renderRolesPatch(template, planRoles(roles, () => true))
    const presets = blocks(patch)
    expect(presets.size).toBe(8)

    const pm = presets.get('preset-pm') ?? ''
    expect(pm).toContain("            name: '@deepseek-ai/dsh-plugin-manager/tools'\n            disabled: false")
    expect(pm).toContain("            name: '@deepseek-ai/dsh-plugin-market/tools'\n            disabled: false")

    for (const [id, block] of presets) {
      if (id === 'preset-pm') continue
      expect(block).toContain(
        "            name: '@deepseek-ai/dsh-plugin-manager/tools'\n            disabled: !!js \"!ctx.get('profileContext')\"",
      )
      expect(block).toContain("            name: '@deepseek-ai/dsh-plugin-market/tools'\n            disabled: true")
    }
  })

  it('renders a role without plugins exactly as before the field existed', () => {
    const fixture = [
      '- insert:',
      '    - id: {{PRESET_ID}}',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: {{ROLE_ID}}',
      '        name: {{ROLE_NAME}}',
      '        description: {{ROLE_DESCRIPTION}}',
      '        plugins:',
      '          - id: persona',
      "            name: '@deepseek-ai/dsh-persona'",
      '            config:',
      '              prefix: {{ROLE_PREFIX}}',
      '          - id: tool-plugin-manager',
      "            name: '@deepseek-ai/dsh-plugin-manager/tools'",
      '            disabled: !!js "!ctx.get(\'profileContext\')"',
      '          - id: tool-plugin-market',
      "            name: '@deepseek-ai/dsh-plugin-market/tools'",
      '            disabled: true',
      '{{ROLE_ENTRY}}',
    ].join('\n')
    const fixed = role({ id: 'qa', name: '测试', description: '验证用固定角色', kind: 'core', include: ['dev-orchestrator'] })
    const expected = [
      '- insert:',
      '    - id: preset-qa',
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      '        id: qa',
      '        name: 测试',
      '        description: 验证用固定角色',
      '        plugins:',
      '          - id: persona',
      "            name: '@deepseek-ai/dsh-persona'",
      '            config:',
      '              prefix: "You are a coding agent powered by the {{model}} model."',
      '          - id: tool-plugin-manager',
      "            name: '@deepseek-ai/dsh-plugin-manager/tools'",
      '            disabled: !!js "!ctx.get(\'profileContext\')"',
      '          - id: tool-plugin-market',
      "            name: '@deepseek-ai/dsh-plugin-market/tools'",
      '            disabled: true',
      '          - id: dsh-fullstack-team',
      '            name: dsh-fullstack-team',
      '            config:',
      '              providerName: dsh-fullstack-team',
      '              include:',
      '                - dev-orchestrator',
      '              tools: true',
      '',
    ].join('\n')
    expect(renderRolesPatch(fixture, planRoles([fixed], () => true))).toBe(expected)
  })

  it('keeps the override inside the declaring role’s own preset', () => {
    const fixture = [
      '- insert:',
      '    - id: {{PRESET_ID}}',
      '      config:',
      '        id: {{ROLE_ID}}',
      '        name: {{ROLE_NAME}}',
      '        description: {{ROLE_DESCRIPTION}}',
      '        plugins:',
      '          - id: tool-plugin-market',
      "            name: '@deepseek-ai/dsh-plugin-market/tools'",
      '            disabled: true',
      '{{ROLE_ENTRY}}',
    ].join('\n')
    const pm = role({ id: 'pm', kind: 'core', delegates: true, plugins: { 'tool-plugin-market': 'enabled' } })
    const qa = role({ id: 'qa', kind: 'core', name: '测试', description: '验证' })
    const presets = blocks(renderRolesPatch(fixture, planRoles([pm, qa], () => true)))
    expect(presets.get('preset-pm')).toContain('disabled: false')
    expect(presets.get('preset-qa')).toContain('disabled: true')
  })

  it('fails at load time on a plugins value that is not enabled/disabled', () => {
    const dir = scratch()
    writeFileSync(
      join(dir, 'bad.role.yml'),
      'id: x\nname: X\ninclude: [role-init]\nplugins:\n  tool-plugin-manager: on\n',
      'utf8',
    )
    expect(() => loadRoles(dir)).toThrow(/plugins\.tool-plugin-manager/u)
    expect(() => loadRoles(dir)).toThrow(/only "enabled" and "disabled"/u)
  })

  it('fails at load time on a plugins field that is not a mapping', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'bad.role.yml'), 'id: x\nname: X\ninclude: [role-init]\nplugins: [tool-plugin-manager]\n', 'utf8')
    expect(() => loadRoles(dir)).toThrow(/not a mapping/u)
  })
})
