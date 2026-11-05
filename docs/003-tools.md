# Tools — `devflow_gate` and `devflow_state`

The flow's rules need an observation point. These two tools are it: one reads artifacts and reports findings, the other remembers where the work is and refuses to move past a failing gate or an exhausted budget.

Neither tool writes to the artifacts, and neither decides what to do about a failure. A gate says *what is wrong*; the main agent decides *who fixes it*.

The flow has **six stages** (`clarify → design → build → test → accept → ship`), **four stage gates** (`clarify`, `design`, `test`, `accept`) plus **one additional check** (`review`, executed inside `accept`). The 115-item review checklist is executed by people/skills; the machine checks the configured floor of 30 verdicts (`reviewMinVerdicts`).

## `devflow_gate`

`{ stage, root }` → `{ stage, pass, findings[], checked[] }`.

`root` is the requirement directory that holds the artifacts. It **must be absolute**: a relative path is an input error, not a finding. Names default to the conventional set and can be overridden per project.

| Stage | Reads (in `checked` order) | Blocks when |
|---|---|---|
| `clarify` | `requirement.md` (+ optional `assessment.md`) | a file is missing/empty, a `TODO`-class placeholder survives, a declared section has no body, no `FP-n` is declared |
| `design` | `design.md`, `api-contract.md` | either file fails the basics, or the two disagree on an endpoint (method-aware; query string, fragment, and trailing slash are normalised away) |
| `test` | `requirement.md`, `test-cases.md`, `test-report.md` | a declared `FP-n` has no case, a case names an undeclared `FP-n`, the case document names no `FP-n`, or the execution report is missing/empty/a draft |
| `accept` | `requirement.md`, `acceptance-report.md`, `ui-acceptance.md` (unless waived), `review-notes.md` | an `FP-n` has no verdict or no `path:line` evidence in the same two-line window, verdicts are fewer than functional points, a `P0` count is above zero, the UI artifact is missing and not properly waived, or the review check fails |
| `review` | `review-notes.md` | fewer than `reviewMinVerdicts` verdicts, a verdict line with no evidence in its own two-line window, or a cited `file:line` that does not resolve, is not a regular file, or resolves outside `root` |

Endpoint recognition has three sources: inline code spans, headings, and Markdown table rows (`| POST | /api/orders |`). Table rows inside fenced code blocks are ignored. A candidate is **not** an endpoint when its path contains whitespace, `<`, `>`, `*`, `^`, `$`, or `\`, or normalises to a bare `/`: prose like `/must be absolute/`, placeholders like `/orders/<id>`, globs like `/api/*`, regex literals, and the filesystem root are all rejected, while real routes (`/api/orders`, `/orders/:id`, `/v1/x?y=1`) are kept.

Evidence is `path:line`. The window is the line itself plus the next one; a citation must resolve to a regular file **inside** `root`. A reference that leaves `root` (an absolute path elsewhere, or `../../x`) is rejected without being read.

Finding codes (all `error` unless noted): `FILE_MISSING`, `FILE_NOT_FILE`, `FILE_EMPTY`, `PLACEHOLDER`, `EMPTY_SECTION`, `SECTION_MISSING`, `FP_MISSING`, `FP_UNCOVERED`, `FP_ORPHAN`, `TEST_CASE_EMPTY`, `CONTRACT_MISSING`, `CONTRACT_UNDESIGNED`, `VERDICT_SHORTFALL`, `VERDICT_MISSING`, `ACCEPT_EVIDENCE_MISSING`, `P0_OPEN`, `REVIEW_ITEM_NO_VERDICT`, `REVIEW_EVIDENCE_MISSING`, `EVIDENCE_MISSING`, `EVIDENCE_OUT_OF_RANGE`, `EVIDENCE_OUTSIDE_ROOT`, `UI_WAIVER_NO_REASON`, `REWORK_BUDGET_EXHAUSTED`, and the single `warning`-level `UI_ACCEPTANCE_WAIVED`.

## `devflow_state`

`{ action, root, failure?, note? }` → `{ stage, advanced, pass, message, findings[], rework?, metrics?, reworkStage? }`.

Stages: `clarify → design → build → test → accept → ship`. The file lives at `<root>/.dsh/devflow/state.json`, so a restart, a compaction, or a new session cannot lose it. `root` must be absolute.

- `read` — current stage and the rework counters spent **in this stage**. A corrupt state file is an error, not a silent reset; unknown failure keys from an older version are listed in the message and ignored.
- `metrics` — the cumulative statistics (`advanceBlocked`, `rework`, `codes`, described below) plus the current `stage` and the `reworkStage` the per-stage counters belong to. **Read-only**: it neither moves the flow nor writes the state file.
- `advance` — re-runs the current stage's gate and moves **only if it passes and the stage's budget is intact**; otherwise the stage is unchanged, findings come back, and the refusal is counted in `metrics` (stage + error-level finding codes).
- `rework` — records one rework against a typed failure and reports the remaining budget. Counters are per stage and reset when the flow enters a new stage.
- `reset` — back to `clarify`, clearing counters and history but **keeping the cumulative metrics**. It is the only mechanical exit from an exhausted stage, and it is not a way to change stage.

### Metrics

A refusal that only exists as a message cannot answer "is this month better than the last one?". Every refusal and every rework is therefore counted on disk, in the same write as the rest of the state:

| Counter | Key | Incremented when |
|---|---|---|
| `advanceBlocked` | stage name | `advance` is refused in that stage (failing gate or `REWORK_BUDGET_EXHAUSTED`) |
| `rework` | one of the six failure types | `rework` records that failure type |
| `codes` | error-level finding `code` | a refused `advance` returns that code as an `error` (a refusal returning three errors bumps three counters) |

`codes` ignores `warning` findings on purpose: `UI_ACCEPTANCE_WAIVED` is emitted on every `accept` run of a waived project, so counting it would leave a constant that says nothing about how often the gate actually blocked anything. A warning that accompanies a failing gate is reported in the tool result, just not counted.

The counters are cumulative across stages: a passing gate does not clear them, and neither does moving on. `reset` keeps them too — a rework already happened, and wiping the record would make the flow unable to say it was ever pushed back; only the rework budgets and the history start over. When the state file is corrupt, `reset` cannot read the old metrics and starts from zero. The maps are complete: `advanceBlocked` carries all six stage names and `rework` all six failure types, zero-filled, so a reader never has to distinguish "zero" from "missing"; `codes` starts empty and only grows.

Read them with `action: "metrics"`:

```json
{
  "stage": "test",
  "reworkStage": "test",
  "metrics": {
    "advanceBlocked": { "clarify": 0, "design": 1, "build": 0, "test": 2, "accept": 0, "ship": 0 },
    "rework": { "DESIGN_UNFEASIBLE": 0, "CONTRACT_GAP": 0, "CONTRACT_CONFLICT": 0, "IMPL_MISMATCH": 1, "TEST_FAIL": 1, "ACCEPT_P0": 0 },
    "codes": { "CONTRACT_UNDESIGNED": 1, "FP_UNCOVERED": 2, "REWORK_BUDGET_EXHAUSTED": 1 }
  }
}
```

### State schema (version 2)

```json
{
  "version": 2,
  "stage": "test",
  "reworkStage": "test",
  "rework": { "DESIGN_UNFEASIBLE": 0, "CONTRACT_GAP": 0, "CONTRACT_CONFLICT": 0, "IMPL_MISMATCH": 1, "TEST_FAIL": 0, "ACCEPT_P0": 0 },
  "metrics": {
    "advanceBlocked": { "clarify": 0, "design": 0, "build": 0, "test": 1, "accept": 0, "ship": 0 },
    "rework": { "DESIGN_UNFEASIBLE": 0, "CONTRACT_GAP": 0, "CONTRACT_CONFLICT": 0, "IMPL_MISMATCH": 1, "TEST_FAIL": 0, "ACCEPT_P0": 0 },
    "codes": { "FP_UNCOVERED": 1 }
  },
  "history": [{ "at": "2026-11-04T09:00:00.000Z", "action": "rework", "stage": "test", "failure": "IMPL_MISMATCH", "note": "用例 3 失败" }]
}
```

A `version:1` file (no `reworkStage`) stays readable: its counters are attributed to the current stage, and the first write upgrades the file to version 2. A version 2 file written before `metrics` existed stays readable too: `metrics` is filled with the zero-valued structure above, and the schema version stays 2 — the field is additive, not a migration. A file that is not valid JSON, not an object, or carries an unknown stage is an error whose message names the absolute path and says how to repair it (edit / delete / `reset`).

State writes are serialised through an exclusive lock file (`.dsh/devflow/state.lock`); a lock held by another writer makes the call fail after about half a second instead of interleaving, and a lock older than ten seconds is treated as abandoned.

### Failure budgets (per stage)

| Type | Budget | Meaning |
|---|---|---|
| `DESIGN_UNFEASIBLE` | 2 | a developer says the design cannot be built |
| `CONTRACT_GAP` | 3 | the contract is missing an endpoint or field |
| `CONTRACT_CONFLICT` | 1 | two sides read the contract differently |
| `IMPL_MISMATCH` | 3 | the implementation does not match the approved list |
| `TEST_FAIL` | 3 | end-to-end failure |
| `ACCEPT_P0` | 3 | a blocking acceptance finding |

Deployment false green has **no budget**: `ship` has no gate, so the incident is found by a person in that stage and recorded as `IMPL_MISMATCH` or `ACCEPT_P0`.

When a counter reaches its budget the tool says so explicitly; from then on `advance` is refused in that stage even if the gate passes (`REWORK_BUDGET_EXHAUSTED`). That is the mechanical form of "一次打回、二次拆小、三次上报".

## Project configuration

`devflow.config.json` in the requirement directory, all keys optional. A known key with the wrong type is an input error (the message names the key); unknown keys are ignored.

```json
{
  "files": { "requirement": "requirement.md", "testreport": "test-report.md", "uiacceptance": "ui-acceptance.md" },
  "requirementSections": ["背景", "功能点", "状态机"],
  "designSections": ["接口", "数据"],
  "testCaseSections": ["用例"],
  "testReportSections": ["执行结果"],
  "acceptanceSections": ["验收"],
  "uiAcceptanceSections": ["页面走查"],
  "reviewMinVerdicts": 30,
  "ui": { "applicable": false, "reason": "纯后端项目，无界面变更" }
}
```

Artifact keys: `requirement`, `assessment`, `design`, `contract`, `testcases`, `testreport`, `review`, `acceptance`, `uiacceptance`.

A pure-backend project waives the UI artifact with `ui.applicable=false` **and** a non-empty `ui.reason`: without the reason the gate fails with `UI_WAIVER_NO_REASON`; with it, every `accept` run returns a `UI_ACCEPTANCE_WAIVED` warning so the waiver stays visible. A report that merely says "不适用" is not a waiver.

Section lists are the only project-specific structure a gate knows. Nothing in the code mentions a stack, a table, or a page.
