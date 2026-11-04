/**
 * `Config` is the plugin's public settings contract: DSH walks it to show a
 * plugin's options. `packs[].hint` is read at runtime when a pack is missing, so
 * a schema that omits it hides a real setting — these tests keep the two views
 * (runtime use and declared schema) from drifting apart.
 */

import { describe, expect, it } from 'vitest'
import { Config } from '../src/index'

/** The schema node declared for one `packs[]` field, as a settings UI sees it. */
function packField(name: string): { type?: string; meta?: { required?: boolean } } | undefined {
  const packs = Config.dict?.['packs']
  if (packs === undefined) throw new Error('Config declares no `packs` field')
  const element = packs.inner
  if (element === undefined) throw new Error('`packs` declares no item schema')
  return element.dict?.[name]
}

describe('Config', () => {
  it('accepts a pack that carries a hint and keeps it on the resolved config', () => {
    const resolved = Config({
      packs: [{ name: 'team-core', dir: '~/.dsh/skill-packs/team-core', hint: 'pnpm dsh pack add team-core' }],
    })
    expect(resolved.packs?.[0]).toMatchObject({
      name: 'team-core',
      dir: '~/.dsh/skill-packs/team-core',
      hint: 'pnpm dsh pack add team-core',
    })
  })

  it('declares hint as an optional string, so the setting is visible in the schema', () => {
    const hint = packField('hint')
    expect(hint).toBeDefined()
    expect(hint?.type).toBe('string')
    // A pack that needs no advice must not be forced to invent one: the field has
    // no default and is not required.
    expect(hint?.meta?.required).not.toBe(true)
  })

  it('accepts a pack without a hint and leaves the key absent', () => {
    const resolved = Config({ packs: [{ name: 'team-core', dir: '~/.dsh/skill-packs/team-core' }] })
    expect(resolved.packs).toHaveLength(1)
    expect(resolved.packs?.[0]).not.toHaveProperty('hint')
  })
})
