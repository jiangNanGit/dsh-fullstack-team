# 002 · 验收报告（acceptance-report）

- 需求：`requirement.md`（2026-11-05 冻结，2 个功能点）
- 依据：`design.md`、`api-contract.md`、`test-cases.md`（24 条）、`test-report.md`
- 方式：本人复跑关键命令，不采信子 agent 的结论

## 1. 验收结论

**通过。** 2 个功能点全部有结论；P0 清零（0 个）；无未执行用例。

复跑记录：`pnpm check` 11 文件 264 例全绿；两个 `/tmp` 造仓实测（只有 `vite.config.js` 命中、只有 `package.json` 不命中）；度量用临时需求目录实测拒绝计数与 `reset` 保留。

## 2. 逐功能点结论

| FP | 结论 | 证据 |
|---|---|---|
| FP-01 | 通过 | test-report.md:170 |
| FP-02 | 通过 | test-report.md:187 |

## 3. 验收中发现并已处置的口径问题

| 问题 | 处置 | 证据 |
|---|---|---|
| `reset` 原本清零 metrics，会让「返工几次」永远归零 | 改为保留计数，重置只清阶段与预算 | test-report.md:176 |
| `codes` 原本把 warning 也计数，`UI_ACCEPTANCE_WAIVED` 成常数噪声 | 改为只统计非 warning，warning 仍出现在 findings | test-report.md:177 |

两条都是回退给实现方重做的，不是验收时放宽标准。

## 4. 保留意见

1. `codes` 不带阶段维度，跨阶段同名 code 会合并计数；定位仍需翻 `history`（`design.md` §6 已记，属下一步）。
2. `detect` 不支持通用 glob（星号只能出现在末尾），这是**有意为之**，理由写在 `design.md` §2.3；将来要扩再扩。
3. 本机 Node v22.17.0 低于 `engines` 要求，`pnpm` 每次给 engine 警告；CI 用 Node 24，不影响结论。

## 5. 产物清单

- 代码：`src/roles.ts`、`src/state.ts`、`src/tools.ts`
- 数据：`roles/frontend-vue.role.yml`
- 文档：`docs/003-tools.md`、`docs/dev/project-standard.md`、`skills/role-init/SKILL.md`
- 测试：`tests/roles.spec.ts`、`tests/state.spec.ts`、`tests/metrics.spec.ts`
- 流程：`requirement.md`、`design.md`、`api-contract.md`、`test-cases.md`、`test-report.md`、`review-notes.md`、`devflow.config.json`、本报告
