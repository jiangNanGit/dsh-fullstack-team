# dsh-devflow

Multi-agent development flow for [DSH](https://github.com/deepseek-ai/deepseek-harness), shipped as a bundle: nine Agent Skills that describe one contract-first development flow — clarify → design → build → accept → ship — plus the role and gating design that makes the flow enforceable instead of advisory.

The skills are the ones already running in production on a real workspace for three months (one backend, five frontends, one desktop client). This bundle packages them for DSH unchanged: no project names, no table names, no stack assumptions. Project knowledge stays in each repository.

## What's inside

| Skill | Role in the flow |
|---|---|
| `dev-orchestrator` | The entry router: decides which flow a request belongs to, splits work across agents, owns review and adjudication |
| `requirement-clarify` | Gate 1 — requirement freeze:原文转录, purpose feasibility, state machine, granularity split |
| `acceptance-guard` | Gate 5 — whole-flow acceptance: multi-role × real business loop, never single-point checks |
| `ops-runbook` | Deploy, logs, incident handling, production read-only investigation |
| `error-triage` | Error-table patrol and disposition methodology |
| `yunxiao-projex-ops` | Aliyun Yunxiao Projex work-item operations and status sync |
| `impeccable` | B-side UI capability gate: audit, critique, polish, design systems |
| `taste` | Art direction for outward-facing pages, anti-generic |
| `ui-theme-governance` | Theme/token governance: one source of truth for colour |

## Install

```bash
# from the registry, once published
dsh plugin --profile <profile> add dsh-devflow

# from a checkout
dsh plugin --profile <profile> add link:/path/to/dsh-devflow
```

The bundle layer inserts one plugin, `dsh-devflow`, which advertises the shipped skills. The profile needs **no** skill-directory configuration: the plugin reads `skills/` next to its own `lib/`.

Restart the app (or the CLI profile) after installing; bundle layers load at profile boot.

## Configuration

```yaml
- id: dsh-devflow
  name: dsh-devflow
  config:
    providerName: dsh-devflow   # default
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

A role is a preset whose `dsh-devflow` entry carries an `include` allowlist, so the role only ever sees its own kit. [`examples/role-preset.patch.yml`](examples/role-preset.patch.yml) is a complete copyable preset; [`docs/002-role-presets.md`](docs/002-role-presets.md) has the suggested kits per role.

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
