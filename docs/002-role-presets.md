# Role presets — hard-binding skills to one role

## Roles are data

A role lives in `roles/<id>.role.yml`:

```yaml
id: mobile-flutter
kind: stack                     # core roles ship everywhere; stack roles follow the project
detect: [pubspec.yaml]          # markers that call for this role
include: [role-init, dev-orchestrator, impeccable, ui-theme-governance, acceptance-guard]
packs:
  - name: team-core
    dir: ~/.dsh/skill-packs/team-core
  - name: flutter
    dir: ~/.dsh/skill-packs/flutter
    include: ['*']              # this pack is the role's whole kit
    hint: 把官方 Flutter skill 包解到该目录
```

`node scripts/roles.mjs` reports which roles can mount and which are blocked by a missing pack; `--write` emits `presets/roles.patch.yml`, and `--out <path>` writes the same document elsewhere (the installed form needs this: the package directory is read-only, and the merged copy lives in the profile). The preset body comes from `templates/preset.template.yml` — one copy of the upstream standard preset, six tokens per role. Upgrading DSH means updating that one template, not eight presets.

`node scripts/install-presets.mjs` (also `pnpm presets:install`) runs the handoff: generate → back up the profile patch → splice only its own block → re-read and verify → print the restart hint. It is idempotent, restores the backup if verification fails, and accepts `--profile <name|path>` and `--dry-run`.

A blocked role is not mounted at all. That is the point: a Flutter engineer without the Flutter pack would guess, and a guess costs more than a missing menu entry.


A role is a preset whose `dsh-fullstack-team` entry carries an `include` allowlist. That is the whole mechanism for **pack** skills: the preset's own skill registry only ever hears about the listed ones, so "did this agent load the right skill?" stops being a question — the others do not exist in its session. The bundle's own skills are the exception: they are a shared core and stay visible in every session, listed or not (see below).

## 内置技能＝全员公共核心（已定版）

The bundle patch (`cordis.patch.yml`) keeps exactly **one** global `dsh-fullstack-team` entry, with no `include`, `exclude` or `tools`. That entry broadcasts the skills shipped in `skills/` to every session, and it is the single source of truth for "which skills does every role have".

The registry merges catalogs by skill name across the global layer and the viewing scope's chain: a nearer layer wins a **duplicate name** outright, and it cannot remove any other skill. Therefore:

- `include` 只缩**本实例视图**：它挡掉的是本实例对 pack 技能的收窄，由全局条目广播的内置技能照样出现在会话里；
- `exclude` 对内置技能在会话层面**无效**：全局层会把它们再带回来；
- 真正能按角色隔离的只有 **pack 技能**——pack 只被声明它的那个预设实例装载，其它会话根本看不到。

Consequence: `role-init` and everything else under `skills/` is visible to every role, including a preset whose `include` does not list them. Do not write a preset that pretends to hide a built-in skill, and do not add `exclude` to a role manifest — `loadRoles` rejects that key.

This is a ruling, not a suggestion: removing the global entry (or inserting one per preset) would change the requirement and must go through a new requirement round.

## The shape

```yaml
- insert:
    - id: preset-fullstack-team-backend
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: devflow-backend
        name: dsh-fullstack-team 后端开发
        plugins:
          # …the standard tool stack…
          - id: dsh-fullstack-team
            name: dsh-fullstack-team
            config:
              providerName: dsh-fullstack-team
              include:
                - dev-orchestrator
                - requirement-clarify
                - acceptance-guard
                - ops-runbook
              packs:
                - name: team-core
                  dir: ~/.dsh/skill-packs/team-core
```

`providerName` stays `dsh-fullstack-team` for **every** role — not `dsh-fullstack-team-<role>`. That is what the generator writes (`src/roles.ts`, `renderRoleEntry`), and the name identifies the provider, not the role: isolation comes from each preset's own scope (its `include` and `packs`), so a per-role provider name would be a second, competing convention. Keep hand-written presets on the same value.

Every name in `include` must have a source — a shipped skill or a declared, installed pack. A name nothing provides is a **startup error** that lists the missing names and the visible set, so do not hand-copy an `include` list without the `packs` that back it. Check first with `node scripts/roles.mjs` (in a source checkout, run `pnpm build` before it).

`examples/role-preset.patch.yml` is a complete, copyable preset. Change four things per role: `id`, `name`/`description`, `include`, and `packs` — the pack list must cover every non-shipped name you list.

## Why a preset, and not a profile

A preset is instantiated per session: its plugins — including the skill registry — live in that preset's scope. So two presets in one profile can advertise different skill sets without fighting. A profile-level `dsh-fullstack-team` entry is still useful as the default for sessions that pick `standard`.

## Suggested kits

| Role | `include` | `packs` |
|---|---|---|
| 主 PM | `dev-orchestrator`, `requirement-clarify`, `acceptance-guard`, `impeccable`, `taste`, `error-triage`, `ops-runbook`, `yunxiao-projex-ops`, `ui-theme-governance` | `team-core` |
| 后端设计 | `dev-orchestrator`, `requirement-clarify` | `team-core` |
| 后端开发 | `dev-orchestrator`, `requirement-clarify`, `acceptance-guard`, `ops-runbook` | `team-core` |
| 前端开发 | `dev-orchestrator`, `impeccable`, `ui-theme-governance`, `acceptance-guard` | `team-core` |
| 移动端开发 | `dev-orchestrator`, `impeccable`, `ui-theme-governance`, `acceptance-guard` | `team-core`, `flutter` (`include: ['*']`) |
| 插件开发 | `dev-orchestrator`, `requirement-clarify`, `acceptance-guard` | `team-core` |
| 测试 | `dev-orchestrator`, `acceptance-guard` | `team-core` |
| 运维 | `ops-runbook`, `error-triage`, `yunxiao-projex-ops`, `acceptance-guard` | `team-core` |

`role-init` is shipped with the bundle, so it is visible to every role whether or not a kit lists it; listing it in `include` is allowed and resolves against the bundle. The `team-core` column is mandatory for these kits because every non-`role-init` name in `include` comes from that pack.

Two different allowlists, two different rules:

- **Top-level `include` is literal.** `*` is not a wildcard there: the plugin will report it as a missing skill. There is no way to write "all pack skills" at the top level.
- **`*` means "the whole pack" only inside a pack's own `include:`.** `mobile-flutter` uses it for `flutter` (`include: ['*']`), declaring that the pack is that role's entire kit.

Two rules of thumb:

- **Read-only diagnosis skills go everywhere** (`ops-runbook`, `error-triage`): the cost of an agent not knowing how to read a log is a wrong guess.
- **The entry skill goes everywhere** (`dev-orchestrator`): a role that cannot route input cannot ask for help.

## The cost you are accepting

A hard-bound role does not know which pack skills it does not have. Put one line in the preset prompt:

> 需要的能力不在你的装备清单内时，停下来上报，不要自行替代。

Without it, a role that is missing a capability tends to improvise, which is worse than a soft trigger that simply fails to fire.

## Do not ship eight frozen presets

Every preset in this file is a full copy of the upstream `standard` preset. Eight copies drift from upstream within a release or two. Keep **one** example, generate the rest by copying it locally, and re-derive it when the upstream preset changes.
