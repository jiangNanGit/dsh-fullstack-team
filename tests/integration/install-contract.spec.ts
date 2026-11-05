import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * FP-01 — the install contract, measured on the tarball instead of the checkout.
 *
 * `npm pack → 空目录安装 → apply()` was verified by hand once. That proves the
 * release has no missing files *on the machine it ran on*: a checkout carries
 * `node_modules`, a source tree, `~/.dsh/skill-packs`, and a `lib/` that a
 * developer happened to build. None of that is shipped, so a green run there
 * says nothing about what a user installs. The cases below start from the only
 * artifact that matters — the published tarball — and never reach the network:
 *
 * 1. `npm pack --ignore-scripts --pack-destination <tmp>` builds the archive
 *    (`--ignore-scripts` skips `prepack`, so nothing is installed and no script
 *    outside this repository runs);
 * 2. `tar -xzf` unpacks it into an empty directory;
 * 3. the unpacked package has no `node_modules` of its own, and Node's ESM
 *    resolver ignores `NODE_PATH`, so the peers are reached the way an installed
 *    package reaches a hoisted tree: a `node_modules` symlink at the package
 *    root, pointing at this checkout's install;
 * 4. `import()` of `lib/index.js`, `apply()` against stub registries, and the
 *    shipped `scripts/roles.mjs` as a child process — the three entry points a
 *    profile actually touches.
 *
 * `~/.dsh` is never written. The script case runs against a temporary `HOME` so
 * the result does not depend on which skill packs the host happens to have: a
 * CI machine with no `team-core` must see the same numbers as a developer's.
 */

const repository = fileURLToPath(new URL('../../', import.meta.url))

/** Files the installed form needs at runtime. A missing one is a broken release. */
const REQUIRED_FILES = [
  'lib/index.js',
  'skills/role-init/SKILL.md',
  'roles/pm.role.yml',
  'templates/preset.template.yml',
  'presets/roles.patch.yml',
  'cordis.patch.yml',
  'locale/en.json',
  'locale/zh.json',
  'icon.svg',
  'scripts/roles.mjs',
  'scripts/install-presets.mjs',
  'scripts/check-preset-compat.mjs',
]

/** Sources and tests are development-only: shipping them means the `files` list broke. */
const FORBIDDEN_PREFIXES = ['src/', 'tests/']

/** One entry of `npm pack --json`'s file table. */
interface PackedFile {
  path: string
  size: number
}

/** The subset of `npm pack --json` this test reads. */
interface PackReport {
  filename: string
  entryCount: number
  unpackedSize: number
  files: PackedFile[]
}

/** A skill as `list()` advertises it. */
interface StubCandidate {
  name: string
  resourceBase?: { kind?: string; path?: string }
}

/** The provider contract used by the host; only these two calls are exercised. */
interface StubProvider {
  list(): Promise<StubCandidate[]>
  get(candidate: StubCandidate, options: { signal: AbortSignal }): Promise<{ content: string }>
}

/** The registries `apply()` is handed. */
interface StubContext {
  skills: { registerProvider(factory: () => StubProvider): void }
  tools: { register(tool: { name: string }): void }
}

/** The published module surface this test relies on. */
interface PluginModule {
  apply(ctx: unknown, config?: unknown): void
}

/** A role manifest, as far as the fixture below needs to read it. */
interface RoleManifestYaml {
  include?: string[]
  packs?: { name?: string; dir?: string; include?: string[] }[]
}

const hostPack = join(homedir(), '.dsh', 'skill-packs', 'team-core')
const packInstalled = existsSync(hostPack)

/** The nine skills `team-core` publishes, as of the 001 pack. */
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

/** Scratch directories this file created; all of them are removed in `afterAll`. */
const scratch: string[] = []

let workDir = ''
let packageDir = ''
let report: PackReport
let files = new Set<string>()
let plugin: PluginModule
let provider: StubProvider
let tools: string[] = []

if (!packInstalled) {
  console.warn(
    `[install-contract.spec] ${hostPack} 不存在：跳过「内置 role-init + team-core 9 个技能」这一例；` +
      '其余用例只依赖打包产物，CI 无技能包时照常执行。',
  )
}

/**
 * Expand a `~` path against the fixture home.
 *
 * The role manifests spell pack locations as `~/.dsh/skill-packs/<name>`, so the
 * fixture must translate that prefix instead of assuming the real home. An
 * absolute path is returned untouched: provisioning it would mean writing
 * outside the fixture, which this file never does.
 */
function fixturePath(dir: string, home: string): string {
  if (dir === '~') return home
  if (dir.startsWith('~/')) return join(home, dir.slice(2))
  return dir
}

/**
 * A throwaway `HOME` holding the packs the shipped role manifests declare.
 *
 * `scripts/roles.mjs` reports how many roles can mount by probing the pack
 * directories, so its output is a function of host state. To make the numbers
 * mean the same thing on every machine, the fixture provisions only the
 * directories (each with one stub `SKILL.md`, which is all the offline include
 * precheck reads) — never a real pack, and never the real home.
 *
 * @returns Absolute path of the fixture home.
 */
function provisionedHome(): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-install-contract-home-')))
  scratch.push(home)

  const rolesDir = join(packageDir, 'roles')
  const manifests = readdirSync(rolesDir)
    .filter((name) => name.endsWith('.role.yml'))
    .map((name) => parse(readFileSync(join(rolesDir, name), 'utf8')) as RoleManifestYaml)

  // Every name some role includes must resolve, or the script reports an
  // include gap and exits non-zero — which would be a fixture bug, not a
  // property of the release.
  const everyIncluded = new Set<string>()
  for (const manifest of manifests) {
    for (const name of manifest.include ?? []) {
      if (name !== '*') everyIncluded.add(name)
    }
  }

  for (const manifest of manifests) {
    for (const pack of manifest.packs ?? []) {
      if (pack.dir === undefined) continue
      const dir = fixturePath(pack.dir, home)
      // A pack that narrows itself with an explicit include only exposes those
      // names; `*` (or no include) exposes everything the fixture holds.
      const listed = (pack.include ?? []).filter((name) => name !== '*')
      const names = listed.length > 0 ? listed : [...everyIncluded]
      for (const name of names) {
        mkdirSync(join(dir, name), { recursive: true })
        writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\n---\n\nfixture skill\n`, 'utf8')
      }
    }
  }
  return home
}

/** A throwaway `HOME` with no packs at all — the "nothing provisioned" host. */
function bareHome(): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-install-contract-bare-')))
  scratch.push(home)
  return home
}

/** Run the shipped role script from the unpacked package against one home. */
function runRoles(home: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [join(packageDir, 'scripts', 'roles.mjs')], {
    cwd: packageDir,
    encoding: 'utf8',
    // Both spellings: Node reads HOME on POSIX and USERPROFILE on Windows.
    env: { ...process.env, HOME: home, USERPROFILE: home },
  })
  return { status: result.status, stdout: String(result.stdout), stderr: String(result.stderr) }
}

/** Apply the published module to stub registries and collect what it registered. */
function register(config?: unknown): { provider: StubProvider; tools: string[] } {
  let captured: StubProvider | undefined
  const registered: string[] = []
  const ctx: StubContext = {
    skills: {
      registerProvider: (factory) => {
        captured = factory()
      },
    },
    tools: {
      register: (tool) => {
        registered.push(tool.name)
      },
    },
  }
  plugin.apply(ctx, config)
  if (captured === undefined) throw new Error('apply() registered no skill provider')
  return { provider: captured, tools: registered }
}

beforeAll(async () => {
  // `lib/` is gitignored and `pnpm check` runs the tests before its own build,
  // so a fresh clone has no artifact to publish. Build it here rather than
  // packing an empty `lib/`: the subject is the tarball, and tsdown is local
  // (no registry, no network). `prepack` would do this for a real publish, but
  // it is suppressed by `--ignore-scripts`.
  execFileSync('npm', ['run', 'build'], { cwd: repository, stdio: 'pipe' })

  workDir = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-install-contract-')))
  scratch.push(workDir)

  const packed = execFileSync(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', workDir],
    { cwd: repository, encoding: 'utf8' },
  )
  const parsed = (JSON.parse(packed) as PackReport[])[0]
  if (parsed === undefined) throw new Error('npm pack --json reported no tarball')
  report = parsed

  // BSD tar and GNU tar agree on this invocation, and it keeps the tarball as
  // the only input — no `npm install`, which would need the network.
  execFileSync('tar', ['-xzf', join(workDir, report.filename), '-C', workDir])
  packageDir = realpathSync(join(workDir, 'package'))

  // The peers (`@deepseek-ai/*`, `yaml`) are not bundled, and ESM ignores
  // `NODE_PATH`, so the unpacked package reaches this checkout's install the
  // way a hoisted tree would: a `node_modules` link at its root.
  symlinkSync(join(repository, 'node_modules'), join(packageDir, 'node_modules'), 'dir')

  const loaded: unknown = await import(pathToFileURL(join(packageDir, 'lib', 'index.js')).href)
  plugin = loaded as PluginModule

  const registered = register()
  provider = registered.provider
  tools = registered.tools
  files = new Set(report.files.map((file) => file.path))
}, 120_000)

afterAll(() => {
  // Nothing may outlive the run: the tarball, the unpacked tree, and every
  // fixture home are removed even when a case failed. `rmSync` unlinks the
  // `node_modules` symlink itself, never the checkout's install.
  for (const dir of scratch) {
    if (dir === '') continue
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('安装契约：npm pack 产物装到空目录即可运行', () => {
  it(
    '1. 打包：tgz 落在临时目录，文件数 ≥ 35，解包体积合理',
    () => {
      const tarball = join(workDir, report.filename)
      expect(report.filename).toMatch(/^dsh-fullstack-team-\d+\.\d+\.\d+\.tgz$/u)
      expect(existsSync(tarball)).toBe(true)
      // `--pack-destination` must be honoured: a tarball dropped into the
      // checkout would look identical to this test and pollute the release.
      expect(dirname(tarball)).toBe(workDir)

      expect(report.entryCount).toBeGreaterThanOrEqual(35)
      // Too small means the `files` table lost entries; too large means
      // `node_modules` or build leftovers were swept into the release.
      expect(report.unpackedSize).toBeGreaterThan(150_000)
      expect(report.unpackedSize).toBeLessThan(20_000_000)
    },
    60_000,
  )

  it(
    '2. 必需文件齐全，且不含 src/ 与 tests/',
    () => {
      const missing = REQUIRED_FILES.filter((path) => !files.has(path))
      expect(missing).toEqual([])

      const leaked = [...files].filter((path) =>
        FORBIDDEN_PREFIXES.some((prefix) => path.startsWith(prefix)),
      )
      expect(leaked).toEqual([])

      // The manifest and the unpacked tree must agree: a file the archive lists
      // but the extraction lacks is the same defect as a missing file.
      const absent = [...files].filter((path) => !existsSync(join(packageDir, path)))
      expect(absent).toEqual([])
    },
    60_000,
  )

  it(
    '3. 可加载：解包目录 import() 得到 apply，注册 2 个工具',
    () => {
      expect(typeof plugin.apply).toBe('function')
      expect(tools.sort()).toEqual(['devflow_gate', 'devflow_state'])
    },
    60_000,
  )

  it(
    '4. 技能可读：role-init 正文 > 3000 字符，resourceBase 指向解包目录',
    async () => {
      const candidates = await provider.list()
      expect(candidates.map((candidate) => candidate.name)).toContain('role-init')

      const entry = candidates.find((candidate) => candidate.name === 'role-init')
      if (entry === undefined) throw new Error('role-init is advertised but missing from list()')

      const loaded = await provider.get(entry, { signal: new AbortController().signal })
      expect(loaded.content.length).toBeGreaterThan(3000)

      // FP-01: the body was read from wherever `resourceBase` points. A path
      // that resolves inside the checkout would mean the installed package is
      // reading source the user never received.
      const base = entry.resourceBase?.path
      expect(typeof base).toBe('string')
      const resolved = realpathSync(String(base))
      expect(resolved.startsWith(packageDir + sep)).toBe(true)
      expect(resolved).toBe(join(packageDir, 'skills', 'role-init'))
    },
    60_000,
  )

  it(
    '5. 脚本可跑：解包目录执行 roles.mjs，8 total / 0 blocked',
    () => {
      const provisioned = runRoles(provisionedHome())
      expect(provisioned.status).toBe(0)
      expect(provisioned.stdout).toContain('roles: 8 total — 8 mountable, 0 blocked')

      // The pair proves the count is read, not printed: with no packs at all the
      // same script must report the roles as blocked and still exit 0.
      const bare = runRoles(bareHome())
      expect(bare.status).toBe(0)
      expect(bare.stdout).toContain('roles: 8 total')
      expect(bare.stdout).toMatch(/roles: 8 total — \d+ mountable, [1-9]\d* blocked/u)
    },
    60_000,
  )

  it.skipIf(!packInstalled)(
    '6. 包已安装时：内置 role-init + team-core 的 9 个技能 = 10 个',
    async () => {
      const withPack = register({ packs: [{ name: 'team-core', dir: hostPack }] })
      const names = (await withPack.provider.list()).map((candidate) => candidate.name).sort()

      // A duplicate name lets the host's merge-by-name drop one silently.
      expect(names).toEqual([...PACK_SKILLS, 'role-init'].sort())
      expect(new Set(names).size).toBe(names.length)
    },
    60_000,
  )
})
