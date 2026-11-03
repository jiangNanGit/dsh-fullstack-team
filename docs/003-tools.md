# Tools — `devflow_gate` and `devflow_state`

The flow's rules need an observation point. These two tools are it: one reads artifacts and reports findings, the other remembers where the work is and refuses to move past a failing gate.

Neither tool writes to the artifacts, and neither decides what to do about a failure. A gate says *what is wrong*; the main agent decides *who fixes it*.

## `devflow_gate`

`{ stage, root }` → `{ stage, pass, findings[], checked[] }`.

`root` is the requirement directory that holds the artifacts. Names default to the conventional set and can be overridden per project.

| Stage | Reads | Blocks when |
|---|---|---|
| `clarify` | `requirement.md` (+ optional `assessment.md`) | a file is missing/empty, a `TODO`-class placeholder survives, a declared section has no body, no `FP-n` is declared |
| `design` | `design.md`, `api-contract.md` | either file fails the basics, or the two disagree on an endpoint (method-aware) |
| `test` | `requirement.md`, `test-cases.md` | a declared `FP-n` has no case, or a case names an undeclared `FP-n` |
| `accept` | `requirement.md`, `acceptance-report.md` | a declared `FP-n` has no verdict line, verdicts are fewer than functional points, or a `P0` count is above zero |
| `review` | `review-notes.md` | fewer than `reviewMinVerdicts` verdicts, or a cited `file:line` does not resolve |

Finding codes: `FILE_MISSING`, `FILE_NOT_FILE`, `FILE_EMPTY`, `PLACEHOLDER`, `EMPTY_SECTION`, `SECTION_MISSING`, `FP_MISSING`, `FP_UNCOVERED`, `FP_ORPHAN`, `TEST_CASE_EMPTY`, `CONTRACT_MISSING`, `CONTRACT_UNDESIGNED`, `VERDICT_SHORTFALL`, `P0_OPEN`, `REVIEW_ITEM_NO_VERDICT`, `EVIDENCE_MISSING`, `EVIDENCE_OUT_OF_RANGE`.

## `devflow_state`

`{ action, root, failure?, note? }` → `{ stage, advanced, pass, message, findings[], rework? }`.

Stages: `clarify → design → build → test → accept → ship`. The file lives at `<root>/.dsh/devflow/state.json`, so a restart, a compaction, or a new session cannot lose it.

- `read` — current stage and rework counters.
- `advance` — re-runs the current stage's gate and moves **only if it passes**; on failure the stage is unchanged and the findings come back.
- `rework` — records one rework against a typed failure and reports the remaining budget.
- `reset` — back to `clarify`.

### Failure budgets

| Type | Budget | Meaning |
|---|---|---|
| `DESIGN_UNFEASIBLE` | 2 | a developer says the design cannot be built |
| `CONTRACT_GAP` | 3 | the contract is missing an endpoint or field |
| `CONTRACT_CONFLICT` | 1 | two sides read the contract differently |
| `IMPL_MISMATCH` | 3 | the implementation does not match the approved list |
| `TEST_FAIL` | 3 | end-to-end failure |
| `ACCEPT_P0` | 3 | a blocking acceptance finding |
| `DEPLOY_FALSE_GREEN` | 2 | a release that claimed success and was not |

When a counter reaches its budget the tool says so explicitly; the flow must escalate to a person instead of retrying. That is the mechanical form of "一次打回、二次拆小、三次上报".

## Project configuration

`devflow.config.json` in the requirement directory, all keys optional:

```json
{
  "files": { "requirement": "requirement.md" },
  "requirementSections": ["背景", "功能点", "状态机"],
  "designSections": ["接口", "数据"],
  "testCaseSections": ["用例"],
  "acceptanceSections": ["验收"],
  "reviewMinVerdicts": 30
}
```

Section lists are the only project-specific structure a gate knows. Nothing in the code mentions a stack, a table, or a page.
