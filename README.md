# 全栈研发团队 · dsh-fullstack-team

**许愿式研发：说出你想要的，剩下的交给团队。**
**Wish-driven development: state the wish; the team ships it.**

One [DSH](https://github.com/deepseek-ai/deepseek-harness) bundle that carries a whole delivery — requirement to launch — not just the coding part. The flow has **six stages** (`clarify → design → build → test → accept → ship`; the closing work is folded into `ship`) and **four stage gates** (`clarify`, `design`, `test`, `accept`). **Review is an additional check inside `accept`**, not a seventh stage. Two deterministic tools turn "did anyone actually read that artifact?" from a model's good intention into a file check.

You do not have to write code to use it: state what you want, and the flow splits the roles, walks the gates, and comes back with evidence. It stops and asks only when it is stuck, or when a decision belongs to you.

The package ships **one** Agent Skill of its own — `role-init`, the entry every session gets — plus the flow's two tools. The nine capabilities the roles actually work with (`dev-orchestrator`, `requirement-clarify`, `acceptance-guard`, `ops-runbook`, `error-triage`, `impeccable`, `taste`, `ui-theme-governance`, `yunxiao-projex-ops`) are **not in this repository and do not ship with it**: they live in the separate `team-core` skill pack, provisioned at `~/.dsh/skill-packs/team-core`. See [Getting `team-core`](#getting-team-core) for how to obtain and verify it.

## What's inside

| Part | Where | What it gives you |
|---|---|---|
| `role-init` | `skills/role-init/` (shipped) | 角色初始化与创造：识别技术栈、装配角色；缺能力时按「预置→已有→安装→检索→创造」逐级处置 |
| `devflow_gate` | tool, shipped | reads one stage's artifacts, returns typed findings; never writes, never decides |
| `devflow_state` | tool, shipped | durable stage, typed rework budgets, `advance`/`rework`/`reset` |
| 8 role manifests | `roles/*.role.yml` → generated `presets/roles.patch.yml` | `pm`, `backend-design`, `backend-java`, `frontend-vue`, `mobile-flutter`, `dsh-plugin-dev`, `qa`, `ops` |
| `team-core` | external pack, `~/.dsh/skill-packs/team-core` | the nine capabilities named above, one directory per skill |

`role-init` is a **shared core**: one global bundle-patch entry broadcasts the shipped skills to every session, whether or not a preset lists them. Everything a role declares beyond that is a dependency — a skill pack — and packs are what the per-role allowlist can actually isolate. A pack is a directory of skills that only roles declaring it can see; a missing pack fails the role loudly with the directory it expected, instead of starting a role that silently lost half its kit.

```yaml
packs:
  - name: team-core
    dir: ~/.dsh/skill-packs/team-core
```

## Getting `team-core`

`team-core` is a directory of skills, one subdirectory per skill, each with a `SKILL.md`. It is distributed separately from this bundle — it is not vendored here and it is not published on npm as part of this package — because capability is reusable while project facts are not.

1. Copy the `team-core` directory from an existing DSH installation, or unpack the pack archive your team keeps, into `~/.dsh/skill-packs/team-core`.
2. Verify it before starting a role:

```bash
# nine skill directories, each with a SKILL.md
ls ~/.dsh/skill-packs/team-core

# from the package root: 8 total / 8 mountable / 0 blocked
node scripts/roles.mjs

# the pack contains no project facts or secrets
node scripts/skill-audit.mjs ~/.dsh/skill-packs/team-core
```

`node scripts/roles.mjs` imports `lib/roles.js`, so a source checkout must be built first (`pnpm install && pnpm build`); the published package already carries `lib/`. Run it from the package root — it resolves `roles/` relative to itself. A pack that is declared but absent makes the role preset refuse to start, naming the directory it expected; a name in `include` that no provider supplies is also a startup error, listing the visible skills.

## Install

Bundle layers load at profile boot, so installation goes through the host's **`plugin_manager`**, not through hand edits of a profile file:

- `install_bundle` with `target` set to the **absolute directory** of this package. It performs the package installation and the bundle selection itself — do not reproduce those steps with shell commands.
- `list_bundles` / `list_plugins` afterwards to confirm `dsh-fullstack-team` is registered and enabled, then restart the app (or the CLI profile) so the bundle patch is loaded.

The bundle inserts exactly one plugin, `dsh-fullstack-team`, which advertises the shipped skills. The profile needs **no** skill-directory configuration: the plugin reads `skills/` next to its own `lib/`.

### Development only: `dsh plugin add`

While iterating on this repository, point a throwaway profile at the checkout:

```bash
dsh plugin --profile <profile> add link:/absolute/path/to/dsh-fullstack-team
```

`link:` is a development shortcut, not a distribution channel: it bypasses the package installation that `install_bundle` verifies, and it only works on the machine that holds the checkout.

### Installing from git

A git-address install has two limits you have to handle yourself:

1. **No `lib/`.** `lib/` is git-ignored and `main`/`exports` point at `lib/index.js`, so a bare git tree has no entry point. Build first (`pnpm install && pnpm build`) and install the built directory, or install from a packed tarball (`npm pack`).
2. **Peer dependencies are not auto-installed.** Four peers are non-optional — `@deepseek-ai/cordis` 4.0.5, `@deepseek-ai/schemastery` 3.18.5, `@deepseek-ai/dsh-skill` and `@deepseek-ai/dsh-tools` (the host's `^0.2.1-rc.5` line). Profiles run pnpm with `autoInstallPeers: false`, so pnpm fetches none of them; they must already resolve inside the target profile. A mismatch surfaces as an unresolved peer at load time, not as an install-time error.

### What a release contains

The published package carries `lib/`, `scripts/`, `skills/`, `roles/`, `templates/`, `presets/`, `docs/`, `examples/`, `locale/`, `icon.svg` and `cordis.patch.yml`. It does **not** carry `src/` or `tests/`, so `pnpm test` and `pnpm check` only work in a source checkout. The package-root scripts do work from an installed copy: `node scripts/roles.mjs`, `node scripts/skill-audit.mjs` and `node scripts/install-presets.mjs`.

## Configuration

```yaml
- id: dsh-fullstack-team
  name: dsh-fullstack-team
  config:
    providerName: dsh-fullstack-team   # default; the generator writes this same value for every role
    include: []                 # allowlist; empty means every shipped skill plus every declared pack skill
    exclude: []                 # denylist, applied after include
    packs: []
```

`include` does two jobs: it visibly narrows **pack** skills to the listed names, and it is checked against everything the instance can advertise — a name no source provides fails the startup with the visible set, instead of mounting a role that is quietly missing a capability. It does **not** hide the bundle's own skills: those are the shared core broadcast by the global patch entry, and the registry merges by name, so a nearer scope can shadow a duplicate but cannot remove any other skill. Only pack skills are isolated per role.

The top-level `include` is a literal allowlist: `*` is **not** a wildcard there and is reported as a missing skill. `*` means "the whole pack" only inside a pack's own `include:` (as `mobile-flutter` does for the Flutter pack).

Every shipped skill is advertised at the bundled rank (600), so a project-level or user-level skill with the same name still wins.

## Two tools

The bundle also registers the flow's observation point:

- **`devflow_gate`** — reads the artifacts of one stage and returns typed findings: missing files, surviving `TODO`s, empty sections, endpoints that the design and the contract disagree on, functional points with no test case, acceptance gaps, review evidence that does not resolve. It never writes and never decides.
- **`devflow_state`** — the durable state at `<requirement>/.dsh/devflow/state.json`: current stage, rework counters, history. `advance` re-runs the current stage's gate and refuses to move while it fails or while the stage's budget is exhausted.

See [`docs/003-tools.md`](docs/003-tools.md) for the finding codes, failure budgets, and the `devflow.config.json` keys.

## Behaviour to expect

- **Six stages, four gates.**（六阶段、四道阶段门）`clarify → design → build → test → accept → ship`. `build` and `ship` carry state but have no gate; closing work belongs to `ship`.
- **Review is a check, not a gate.**（review 是 accept 内的附加检查）`review` is executed inside `accept`: the accept run is a composite of the acceptance gate and the review check. `devflow_gate` still accepts `stage: "review"` for a standalone early check, but `advance` out of `accept` runs the composite — skipping review is not a way to reach `ship`.
- **Six typed failure types**（6 个失败类型）, each with a budget counted **per stage**: `DESIGN_UNFEASIBLE`, `CONTRACT_GAP`, `CONTRACT_CONFLICT`, `IMPL_MISMATCH`, `TEST_FAIL`, `ACCEPT_P0`. Counters reset when the flow enters a new stage. When a counter reaches its budget, `advance` is refused in that stage even if the gate passes.
- **Evidence is `path:line`（`路径:行号`）.** A verdict must carry its evidence on the same line or the line immediately after, and the cited location must resolve to a regular file **inside** the requirement directory. `../../x:1` is rejected without being read.
- **Two artifacts became mandatory**: `test-report.md` gates entry to `accept`, and `ui-acceptance.md` is required unless the project waives the UI artifact in `devflow.config.json` with a reason.
- **The unreachable type is gone.** `DEPLOY_FALSE_GREEN` described a `ship` gate that never existed, so the type and its budget were removed. Old state files still load: an unknown failure key is reported in the message and ignored.

## Roles

A role is a preset whose `dsh-fullstack-team` entry carries an `include` allowlist and the `packs` that back it, so the role only ever sees its own kit of pack skills (plus the shared core). [`examples/role-preset.patch.yml`](examples/role-preset.patch.yml) is a complete copyable preset; [`docs/002-role-presets.md`](docs/002-role-presets.md) has the suggested kits per role.

Roles are **data, not code**: `roles/*.role.yml` declares each role's skills, the repository markers that call for it, and the packs it depends on. `node scripts/roles.mjs --write` turns those manifests into `presets/roles.patch.yml` against the upstream standard preset, so an upstream upgrade is a regeneration rather than a merge. In an installed package the package directory is read-only, so `node scripts/roles.mjs --out <path>` writes the generated patch wherever the profile lives.

`pnpm presets:install` runs the whole handoff: generate → back up the profile patch → splice only the block this tool owns → re-read and verify → print the restart hint. It is idempotent, refuses duplicate entry ids or a lost `agent-preset-registry`, restores the backup on failure, and takes `--profile <name|path>` / `--dry-run` (`node scripts/install-presets.mjs --dry-run` previews, writing nothing).

A role can also **depend on a skill pack** that is provisioned separately — the Flutter engineer loads the Flutter pack, and nobody else does. A declared pack that is not installed is a startup error, not a role that quietly runs without the capability it was hired for. See [`examples/role-preset-flutter.patch.yml`](examples/role-preset-flutter.patch.yml) and [`docs/004-skill-packs.md`](docs/004-skill-packs.md).

## Design

- [`docs/001-design.md`](docs/001-design.md) — the mechanism design: two failure classes (compliance loss vs capability ceiling), the state machine with rework edges, the four gate contracts plus the review check, the role set, and the environment/permission sections (marked *not implemented*; they depend on infrastructure that does not exist yet).
- [`docs/002-role-presets.md`](docs/002-role-presets.md) — how a role hard-binds skills, and why the bundle's own skills stay shared.
- [`docs/003-tools.md`](docs/003-tools.md) — `devflow_gate` / `devflow_state`: finding codes, stage contracts, budgets, configuration.
- [`docs/004-skill-packs.md`](docs/004-skill-packs.md) — a role's dependencies, and what a missing or colliding pack does.
- [`docs/005-skill-hygiene.md`](docs/005-skill-hygiene.md) — the audit that keeps project facts out of capability files.

Three principles the design rests on:

1. **Rules need an observation point.** A rule with no artifact and no gate is a wish. Every step produces a file, and a gate reads it.
2. **Models produce, code adjudicates.** Shape is JSON Schema, semantics are pure gate functions; judgement stays with the main agent.
3. **Static parts, dynamic assembly.** Role presets and skills are fixed parts; a project manifest decides which parts a request assembles.

## Development

```bash
pnpm install
pnpm check                      # typecheck + tests + skills audit + build (source checkout only)
pnpm audit:skills               # skills/ only; also runs inside pnpm check
pnpm presets:install            # generate + merge role presets into the profile
node scripts/install-presets.mjs --dry-run   # preview; --profile <name|path> targets another profile
node scripts/roles.mjs --write  # regenerate presets/roles.patch.yml after a role edit
```

## License

MIT
