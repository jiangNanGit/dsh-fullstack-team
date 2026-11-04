# 001 · 迭代执行计划

> 挂主 PM 任务账。每步开工前回看本步；完成即更新状态列。
> 依据：`requirement.md`（已冻结）+ `assessment.md`（三判定）。

## 〇 当前后台线

| 线 | 状态 | 说明 |
|---|---|---|
| 本需求（001） | 收口 | 批零 → 批一 → 批二 → 批三 → 用例 → 验收 → 提交；状态机已到 `ship` |
| 外部看板同步 | 不适用 | 本仓未接云效 |
| profile 合并 | 已完成 | 用 `scripts/install-presets.mjs` 合并 8 预设进 `~/.dsh/profiles/desktop/cordis.patch.yml`（1072 → 1219 行），备份 `…bak-20261104-181449`，块外 49 行逐行未变；重启宿主后生效 |

## 一 迭代主线

| 步 | 动作 | 角色 × skill | 产物 | 状态 |
|---|---|---|---|---|
| 0 | 需求澄清与冻结 | 主 PM × `requirement-clarify` | `requirement.md` v2 | ✅ 完成 |
| 0.5 | 需求评估 | 主 PM | `assessment.md` | ✅ 完成 |
| 1 | **批零·角色与自举** | 主 PM（spec 类文件亲写） | `roles/dsh-plugin-dev.role.yml`、`pm`/`mobile-flutter` 装备、`roles.mjs` 输出、`docs/dev/project-standard.md`、`docs/dev/project-manifest.md`、`presets/` | ✅ 完成（8 角色可装、1171 行 presets、108 用例全绿） |
| 2 | **批一·规范合规** | `dsh-plugin-dev` × `cordis-plugin-development` + `dev-orchestrator`；`qa` × `acceptance-guard` 复核 | 展示元数据（locale/icon/exports/files）、`Config.hint`、工具参数判据、`role-init` 命令可执行 | ✅ 完成（FP-20/21/27；`pnpm check` 绿 111 例；pack 34 项含 locale/icon/lib） |
| 3 | **批二·机制** | `dsh-plugin-dev` × `dev-orchestrator`（技能/provider 单）；`dsh-plugin-dev` × `dev-orchestrator`（门禁/状态机单）；`qa` × `acceptance-guard`（用例台账） | FP-01/02/22、FP-03~FP-10、FP-28、FP-29 | ✅ 完成（227 用例绿；dogfood clarify+design 双绿；端点假阳性已修） |
| 4 | **批三·分发与口径** | `dsh-plugin-dev` × `dev-orchestrator`；`ops` × `ops-runbook` | FP-16/17/19/23/24/25/26 | ✅ 完成（239 用例绿；CI 与合并脚本落地；profile 已合并 8 预设，待重启） |
| 5 | 用例与 E2E | `qa` × `acceptance-guard` | 覆盖 29 个 FP 的用例台账 + `test-report.md` | ✅ 完成（156 条用例覆盖 29/29；29 PASS；3 条子检查 SKIP 因需重启宿主） |
| 6 | 验收 | 主 PM（读报告裁决） | `acceptance-report.md`、`ui-acceptance.md`（本批无 UI 则豁免并写明） | ✅ 完成（accept 门 pass；UI 经 `devflow.config.json` 显式豁免；P0 清零） |
| 7 | 文档盘点与提交 | 主 PM | README/docs 回写、`review-notes.md`、git 提交 | ✅ 完成（32 条审查记录；四门全绿；已提交） |

### 批零任务分解（主 PM 亲写）

| 子项 | 落点 | 验收 |
|---|---|---|
| 新增插件开发角色 | `roles/dsh-plugin-dev.role.yml` | `node scripts/roles.mjs` 显示 8 角色可装，本仓命中 |
| 装备补齐 | `roles/pm.role.yml`（+`impeccable`/`taste`）、`roles/mobile-flutter.role.yml`（+`acceptance-guard`） | 生成物 include 可见 |
| 生成器输出可配置 | `src/roles.ts`、`scripts/roles.mjs` | `--out <path>` 可用（代码改动并入批二执行，本批先登记） |
| 本仓规范 | `docs/dev/project-standard.md` | 9 章节齐（无数据库=显式写不适用） |
| 本仓角色清单 | `docs/dev/project-manifest.md` | 声明角色集与门禁变体 |

## 二 主 PM 自裁项（授权内，已定版）

| # | 裁决 | 依据 |
|---|---|---|
| 1 | 一条需求、四批开发 | 用户「全部按推荐走」+ 粒度铁律 5 显式确认 |
| 2 | review 做 accept 附加检查 | 零状态迁移（Q3） |
| 3 | `detect` 语义 AND | role-init 速查表口径（Q4） |
| 4 | 内置技能=公共核心 | 最小改动，role-init 本就全员需要（Q9） |
| 5 | 安装以官方 `plugin_manager` 为主 | 官方规范 `host-plugin.md:66-70`（Q8） |
| 6 | `team-core` 本期不并入 | 分发形态未定，先写清获取方式（Q2） |
| 7 | 证据口径 `路径:行号` + 每 FP ≥1 | 现有 `checkEvidence` 可复用（Q7） |
| 8 | 冻结档过不了自己的门 → 改门不改档（FP-29） | 容器标题不是空节；001 保持原样 |
| 9 | `DEPLOY_FALSE_GREEN` 删预算不补门（7→6） | 不可达枚举不留给使用者；旧 state 未知值容忍 |

## 三 挂账排队（跨迭代）

| # | 事项 | 原因 |
|---|---|---|
| G1 | 生产令牌/只读账号/环境权限矩阵 | 依赖实体准备（只读库账号、授权目录） |
| G2 | 云效 Projex 状态同步 | 本仓未接云效 |
| G3 | `team-core` 并仓或发布 | 等分发形态与许可确认 |
| G4 | npm 发布与版本号规范 | 等批三 |
| G5 | ~~官方 `cordis-plugin-development` 挂载机制核实~~ | 已结：include 只服务本包 provider，无法引用宿主技能；FP-11 验收标准改为「文档声明依赖 + §8.1 清单兜底」 |

## 四 节奏原则

1. 澄清与冻结后全自驱，不逐步请示；仅业务方向、对外发布、不可逆破坏上报。
2. 批内并行：文件不相交、禁重启窗口、不碰对方正在写的文件。
3. 每批收口：`pnpm check` 绿 + 本批 FP 逐条对照 + 文档回写。
4. 批间不阻塞：批一可在批零合并前以任务书形式开跑（任务书自带规范摘录）。
