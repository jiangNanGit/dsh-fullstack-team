# 全栈研发团队 · dsh-fullstack-team

**许愿式研发：说出你想要的，剩下的交给团队。**
**Wish-driven development: state the wish; the team ships it.**

One [DSH](https://github.com/deepseek-ai/deepseek-harness) bundle that carries a whole delivery — requirement to launch — not just the coding part. Nine Agent Skills describe one contract-first flow (clarify → design → build → test → accept → ship), and two deterministic tools turn "did anyone actually read that artifact?" from a model's good intention into a file check.

You do not have to write code to use it: state what you want, and the flow splits the roles, walks the gates, and comes back with evidence. It stops and asks only when it is stuck, or when a decision belongs to you.

The skills are the ones already running in production on a real workspace for three months (one backend, five frontends, one desktop client). They ship unchanged: no project names, no table names, no stack assumptions. Project knowledge stays in each repository.

## What's inside

| Skill | Role in the flow |
|---|---|
| `role-init` | 角色初始化与创造：识别技术栈、装配角色；缺能力时按「预置→已有→安装→检索→创造」逐级处置 |

Capabilities themselves are **not** shipped in this package. A role declares the packs it needs:

```yaml
packs:
  - name: team-core
    dir: ~/.dsh/skill-packs/team-core
```

A pack is a directory of skills that only roles declaring it can see, and the role's `include` list narrows it further — the allowlist is enforced for packs too, so isolation is a mechanism rather than a convention. A missing pack fails the role loudly with the directory it expected, instead of starting a role that silently lost half its kit.

## Install

```bash
# from the registry, once published
dsh plugin --profile <profile> add dsh-fullstack-team

# from a checkout
dsh plugin --profile <profile> add link:/path/to/dsh-fullstack-team
```

The bundle layer inserts one plugin, `dsh-fullstack-team`, which advertises the shipped skills. The profile needs **no** skill-directory configuration: the plugin reads `skills/` next to its own `lib/`.

Restart the app (or the CLI profile) after installing; bundle layers load at profile boot.

## Configuration

```yaml
- id: dsh-fullstack-team
  name: dsh-fullstack-team
  config:
    providerName: dsh-fullstack-team   # default
    include: []                 # allowlist; empty means every shipped skill
    exclude: []                 # denylist, applied after include
```

`include` is how a role preset hard-binds a subset: a backend preset that should only see the flow entry and the review baseline inserts the same plugin with an allowlist rather than shipping a second copy of the skills. Per the design, a hard-bound role also needs one line in its preset prompt: *when a capability you need is not in your kit, stop and report — do not substitute your own.*

Every skill is advertised at the bundled rank (600), so a project-level or user-level skill with the same name still wins.

## Two tools

The bundle also registers the flow's observation point:

- **`devflow_gate`** — reads the artifacts of one stage and returns typed findings: missing files, surviving `TODO`s, empty sections, endpoints that the design and the contract disagree on, functional points with no test case, acceptance gaps, review evidence that does not resolve. It never writes and never decides.
- **`devflow_state`** — the durable state at `<requirement>/.dsh/devflow/state.json`: current stage, rework counters, history. `advance` re-runs the current stage's gate and refuses to move while it fails.

See [`docs/003-tools.md`](docs/003-tools.md) for the finding codes, failure budgets, and the `devflow.config.json` keys.

## Roles

A role is a preset whose `dsh-fullstack-team` entry carries an `include` allowlist, so the role only ever sees its own kit. [`examples/role-preset.patch.yml`](examples/role-preset.patch.yml) is a complete copyable preset; [`docs/002-role-presets.md`](docs/002-role-presets.md) has the suggested kits per role.

Roles are **data, not code**: `roles/*.role.yml` declares each role's skills, the repository markers that call for it, and the packs it depends on. `node scripts/roles.mjs --write` turns those manifests into `presets/roles.patch.yml` against the upstream standard preset, so an upstream upgrade is a regeneration rather than a merge.

A role can also **depend on a skill pack** that is provisioned separately — the Flutter engineer loads the Flutter pack, and nobody else does. A declared pack that is not installed is a startup error, not a role that quietly runs without the capability it was hired for. See [`examples/role-preset-flutter.patch.yml`](examples/role-preset-flutter.patch.yml) and [`docs/004-skill-packs.md`](docs/004-skill-packs.md).

## Design

- [`docs/001-design.md`](docs/001-design.md) — the mechanism design: two failure classes (compliance loss vs capability ceiling), the state machine with rework edges, the five gate contracts, role set, environment/permission matrix, and the production authorization token.
- [`docs/SKILL-SYSTEM.md`](docs/SKILL-SYSTEM.md) — the skill system form contract.
- [`docs/SKILL-INDEX.md`](docs/SKILL-INDEX.md) — the human-facing index.

Three principles the design rests on:

1. **Rules need an observation point.** A rule with no artifact and no gate is a wish. Every step produces a file, and a gate reads it.
2. **Models produce, code adjudicates.** Shape is JSON Schema, semantics are pure gate functions; judgement stays with the main agent.
3. **Static parts, dynamic assembly.** Role presets and skills are fixed parts; a project manifest decides which parts a request assembles.

## Development

```bash
pnpm install
pnpm check      # typecheck + tests + build
```

## License

MIT
