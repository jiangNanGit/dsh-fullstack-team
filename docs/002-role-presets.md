# Role presets — hard-binding skills to one role

A role is a preset whose `dsh-fullstack-team` entry carries an `include` allowlist. That is the whole mechanism: the preset's own skill registry only ever hears about the listed skills, so "did this agent load the right skill?" stops being a question — the others do not exist in its session.

## The shape

```yaml
- insert:
    - id: preset-devflow-backend
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: devflow-backend
        name: dsh-fullstack-team 后端开发
        plugins:
          # …the standard tool stack…
          - id: dsh-fullstack-team
            name: dsh-fullstack-team
            config:
              providerName: dsh-fullstack-team-backend
              include:
                - dev-orchestrator
                - requirement-clarify
                - acceptance-guard
                - ops-runbook
```

`examples/role-preset.patch.yml` is a complete, copyable preset. Change three things per role: `id`, `name`/`description`, and `include`.

## Why a preset, and not a profile

A preset is instantiated per session: its plugins — including the skill registry — live in that preset's scope. So two presets in one profile can advertise different skill sets without fighting. A profile-level `dsh-fullstack-team` entry is still useful as the default for sessions that pick `standard`.

## Suggested kits

| Role | `include` |
|---|---|
| 后端设计 | `dev-orchestrator`, `requirement-clarify` |
| 后端开发 | `dev-orchestrator`, `requirement-clarify`, `acceptance-guard`, `ops-runbook` |
| 前端开发 | `dev-orchestrator`, `impeccable`, `ui-theme-governance`, `acceptance-guard` |
| 移动端开发 | `dev-orchestrator`, `impeccable`, `ui-theme-governance` |
| 测试 | `dev-orchestrator`, `acceptance-guard` |
| 运维 | `ops-runbook`, `error-triage`, `yunxiao-projex-ops`, `acceptance-guard` |

Two rules of thumb:

- **Read-only diagnosis skills go everywhere** (`ops-runbook`, `error-triage`): the cost of an agent not knowing how to read a log is a wrong guess.
- **The entry skill goes everywhere** (`dev-orchestrator`): a role that cannot route input cannot ask for help.

## The cost you are accepting

A hard-bound role does not know what it does not have. Put one line in the preset prompt:

> 需要的能力不在你的装备清单内时，停下来上报，不要自行替代。

Without it, a role that is missing a capability tends to improvise, which is worse than a soft trigger that simply fails to fire.

## Do not ship six frozen presets

Every preset in this file is a full copy of the upstream `standard` preset. Six copies drift from upstream within a release or two. Keep **one** example, generate the rest by copying it locally, and re-derive it when the upstream preset changes.
