# 001 · 需求方案评估（assessment）

> 与 `requirement.md`（澄清档）分工：澄清档回答「需求说了什么、系统现状是什么」，本文回答「能不能做、怎么做」。
> 依据：`requirement.md` v2（已冻结，2026-11-04）。

## 一、逐需求组判定

### A 组｜宿主插件规范合规（FP-20、FP-21、FP-23、FP-25、FP-27）

| 项 | 判定 |
|---|---|
| 是否明确 | **明确**。规范原文逐条可查：`host-plugin.md:29-56`（展示元数据/图标/exports/files）、`:57-64`（导出形态/Config）、`:66-70`（安装流程） |
| 是否可执行 | **可执行** |
| 执行方案 | ①`locale/en.json`、`locale/zh.json` 写 `meta.title`/`meta.description`；②`icon.svg`（自绘或自有授权，≤256 KiB，包内）；③`package.json` 的 `exports` 增 `./locale/*.json`、`./icon`，`files` 增 `locale/*.json`、`icon.svg`；④`packs[]` schema 增 `hint`；⑤工具参数描述下沉 `stage`/`action`/`failure` 判据；⑥`skill-audit.mjs` 的项目事实改为项目侧配置（或移出发布物）；⑦`role-init` 与 `docs/005` 的命令改为「包根 + 明确说明」或「报告给用户」 |
| 量级 | **小**（1 个新目录 + 1 个图标 + 3 个文件的小改） |

### B 组｜门禁与状态机机制（FP-01~FP-10、FP-22、FP-26、FP-28）

| 项 | 判定 |
|---|---|
| 是否明确 | **明确**。每条都有实测证据与落点（`requirement.md` §6） |
| 是否可执行 | **可执行**；其中 FP-22 需先定隔离语义（已定：公共核心） |
| 执行方案 | ①`provider.get` 按候选所属根（bundle 或 pack）rebase；②`apply` 对 include 未命中的名字抛错；③review/accept 增加「证据条数 ≥ 1 且每条 `路径:行号` 可解析」；④`DEFAULT_FILES` 增 `test-report`、`ui-acceptance` 并在 test/accept 门引用；⑤review 作为 accept 附加检查；⑥端点正则支持表格与 query；⑦`readState` 区分 ENOENT 与其它错误；⑧rework 计数器按阶段重置、耗尽拒绝 advance；⑨`resolveRoot` 先判绝对路径、证据路径限制在 root 内、`read` 校验 root 存在、写状态加锁 |
| 量级 | **中**（8 个源文件，行为面广，需回归 108 个存量用例 + 新增用例） |

### C 组｜角色与自举（FP-11~FP-15、FP-18）

| 项 | 判定 |
|---|---|
| 是否明确 | **明确**。角色清单、detect 语义、装备补齐已定版 |
| 是否可执行 | **可执行**；「官方 `cordis-plugin-development` 技能如何进角色装备」**条件性可执行**——挂载路径待核实（该技能在 `dsh-agent-preset/skills/`，本会话不可见） |
| 执行方案 | ①`roles/dsh-plugin-dev.role.yml`（`kind: stack`，`detect: [cordis.patch.yml, tsdown.config.ts]`，`include` 走流程技能）；②`pm` 补 `impeccable`/`taste`；③`mobile-flutter` 补 `acceptance-guard`；④`detect` 语义 AND 写进 `role-init` 并在 `roles.ts` 落成可执行判定；⑤`roles.mjs --write` 支持 `--out <path>` 写 profile patch；⑥本仓 `project-standard.md` + `project-manifest.md` |
| 量级 | **小**（manifest 级改动 + 两份项目文档） |

### D 组｜分发、文档与 CI（FP-16、FP-17、FP-19、FP-24）

| 项 | 判定 |
|---|---|
| 是否明确 | **明确** |
| 是否可执行 | **条件性可执行**：`team-core` 不并入本仓，则 CI 无法跑 skill-audit 对 pack 的体检、真包集成测试依赖本机 pack 目录；两项均需在 CI 里跳过并显式报告 |
| 执行方案 | ①README 修正技能数、包来源、断链，写清官方安装通道；②`docs/001` 标注已实现/未实现范围；③GitHub Actions 跑 `pnpm check` + `audit:skills`（仓库内 skills）+ 真包集成（缺包则 skip 并记报告）；④`roles.mjs --write` 输出路径可配置；⑤真包集成测试读 `~/.dsh/skill-packs/team-core`，缺失时 skip |
| 量级 | **小-中**（文档为主，CI 一份工作流） |

## 二、分组处置建议（排期视图）

| 批次 | 内容 | 角色 × skill | 前置 |
|---|---|---|---|
| **批零** | 角色与自举：FP-11/12/13/15（+37 行文档） | 主 PM（spec 类文件亲写） | 无 |
| **批一** | 规范合规：FP-20、FP-27、FP-21 | `dsh-plugin-dev` × `cordis-plugin-development` + `dev-orchestrator` | 批零（角色可装） |
| **批二** | 机制：FP-01~FP-10、FP-22、FP-26、FP-28 | `dsh-plugin-dev` 并行两单（技能/provider 侧；门禁/状态机侧）+ `qa` 补用例 | 批一 |
| **批三** | 分发与口径：FP-23/24/25/16/17/19 | `dsh-plugin-dev` + `ops`（CI/发布） | 批二 |

**验收面**（Q6 定版）：`pnpm check` 全绿 + 真包集成通过 + 本需求 dogfood 一遍（用 001 自己跑 devflow_gate/state）。

## 三、风险与解锁

1. **官方插件开发技能未挂进本会话**：先用任务书内置规范摘录执行批一；挂载方式作为 FP-11 的追加验收项，核实后回填。
2. **profile 副本漂移**：批零产生的 preset 变更需合并到 desktop profile 并重启才生效；合并脚本在批三交付，本批先手工合并 + 备份。
3. **门禁行为变更会让外部用户的旧产物变红**：本仓 0 个需求目录；变更写入 `docs/003` 并在 README 标注行为变化。
4. **真包集成依赖本机 pack**：CI 无 pack 时 skip 并报告，不伪造通过。
