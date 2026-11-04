# 001 · 全栈团队插件加固与自举

| 项 | 值 |
|---|---|
| 需求编号 | 001 |
| 需求目录 | `docs/dev/001-flow-hardening/` |
| 来源 | 用户口述 + 外部插件规范审查（2026-11-04） |
| 状态 | **已冻结（2026-11-04，Q1-Q9 全部按推荐值定版）** |
| 变更 | v1：首轮问题并入；v2：并入 DSH 宿主插件规范审查结论 |

---

## 0. 原文逐字转录

### 0.1 需求口述

> **2026-11-04 15:52**
> 「你看一下全栈团队这个项目要在这里开发，你看一下都有什么问题」

> **2026-11-04 16:25**
> 「你有没有看你的设定，给项目分配角色？你用的就是这套插件」

> **2026-11-04（落盘指令）**
> 「加上之前的问题，先将需求落盘」

### 0.2 外部审查结论（摘录，结论段逐字）

> **2026-11-04 16:40**
> 「看完了。结论先说：作为一个 Host-only bundle，它的骨架和 API 用法是对的，能装、能跑、类型和测试都过；但有 1 处硬性的规范缺项（展示元数据），2 处"按规范会解析不到"的实操问题，以及若干与自身设计文档对不上的地方。」

全文六节条目索引（按原文编号引用）：

| 节 | 内容 | 条数 |
|---|---|---|
| 一 | 不符合规范（展示元数据；技能命令解析不到） | 2 |
| 二 | 架构缝隙（全局层不可被预设排除） | 1 |
| 三 | 与自身设计文档对不上（步数/条数/不可达失败/门缩水/预算语义） | 5 |
| 四 | 实现细节（readState、resolveRoot、证据越界、read 不校验 root） | 4 |
| 五 | 文档与打包（README、断链、providerName、Config.hint、lib 被忽略、--write 落点、审计硬编码、peer 安装） | 10 |
| 六 | 工具描述（参数规则未下沉） | 1 |

该审查引用的规范原文，已由主 PM 从 DSH 安装包内
`dsh-agent-preset/skills/cordis-plugin-development/references/host-plugin.md` 提取复核（见 §2.4）。

### 0.3 标准指令

> **2026-11-04**
> 「按道理来说，你这个插件开发；就应该和这个模式能力一致」

**落定**：本仓的插件开发以 DSH 官方 `cordis-plugin-development` 能力为准（宿主插件规范、安装流程、交付前展示清单），
不以"内部测试全绿"替代规范符合性。

---

## 1. 逐句解构表

| # | 原文 | 动作 | 落点 | 预期效果 | 角色 |
|---|---|---|---|---|---|
| 1 | 这个项目要在这里开发 | 在当前工作区开发本仓 | `default-workspace/dsh-fullstack-team` | 本仓能在此产出可运行、可验证的插件 | 主 PM |
| 2 | 看一下都有什么问题 | 现状审查（代码/文档/角色/运行时/规范） | 问题清单 | 差距与优先级明确 | 主 PM |
| 3 | 你有没有看你的设定 | 自查 preset、装备、工具来源 | 本会话 = pm 预设 | 承认并用自身流程办事 | 主 PM |
| 4 | 给项目分配角色 | role-init 侦查 → 定角色 → 校验装备 | 本仓角色装配结论 | 本仓有明确可装的角色集合 | 主 PM |
| 5 | 你用的就是这套插件 | 自指：流程工具来自本仓 | devflow_gate / devflow_state | 用插件开发插件本身（dogfood） | 主 PM |
| 6 | 加上之前的问题 | 把首轮问题清单并入需求范围 | 本文件 FP 清单 | 修复项可逐条验收 | 主 PM |
| 7 | 先将需求落盘 | 产出需求冻结档 | 本文件 | 需求先于设计与开发固定 | 主 PM |
| 8 | 插件开发应与该模式能力一致 | 以官方插件开发规范为验收维度 | §2.4 清单、FP-20~FP-28 | 规范符合性可被判 | 主 PM |

---

## 2. 系统边界推演

### 2.1 流程阶段 × 本次改动

| 当前阶段 | 本次改动 | 关联对象 | 改动后该阶段还能否推进 | 目的达成 |
|---|---|---|---|---|
| clarify | 无 | `requirement.md` | 能 | 是 |
| design | 端点识别增强 | `design.md`、`api-contract.md` | 能 | 部分：减少假绿与误报 |
| build | 不设门，本次不新增 | — | 能 | 是 |
| test | 新增 `test-report.md` 强制 | `test-cases.md` | **不能直接进 accept** | 是 |
| accept | 新增 `ui-acceptance.md` ＋证据要求 | `acceptance-report.md` | 只写结论的报告会失败 | 是 |
| review | 接入状态机（形态见 Q3） | `review-notes.md` | 未跑 review 不得进 ship | 是 |

### 2.2 状态文件兼容

- `FlowState.stage` 取值不变时，已有 `.dsh/devflow/state.json` 可直接读。
- 若把 `review` 设为新阶段，旧状态文件仍可读，但旧项目会"少走一步"；**推荐做 accept 阶段的附加检查**。
- 本仓当前 0 个需求目录（本文件是第一个），迁移成本为 0。

### 2.3 角色装配（role-init 判据）

| 标记文件 | 命中角色 | 本仓实况 |
|---|---|---|
| `pom.xml` / `build.gradle(.kts)` | backend-java | 无 |
| `package.json` + `vite.config.*` | frontend-vue | `package.json` 有，`vite.config` 无 |
| `pubspec.yaml` | mobile-flutter | 无 |

结论：**stack 角色命中 0 个**；core 恒装（pm / backend-design / qa / ops）。必须补一个本仓可装的 stack 角色。

### 2.4 宿主插件规范符合性（`cordis-plugin-development/references/host-plugin.md`）

| 规范条目 | 本仓实况 | 结论 |
|---|---|---|
| 导出形态 `apply` + `inject` + `Config`，不混用 default class | `src/index.ts` 三者齐备 | 合规 |
| `dsh.bundle.patch` + `manifestVersion` | `package.json` 有 | 合规 |
| `locale/en.json`、`locale/zh.json` 的 `meta.title` / `meta.description` | 无 `locale/` | **缺项**（FP-20） |
| 图标：svg/png/jpeg/webp，≤256 KiB，包内 | 无 `icon` | **缺项**（FP-20） |
| `exports` 含 `./locale/*.json`、`./icon` | 只有 `.` 与 `./package.json` | **缺项**（FP-20） |
| `files` 保留全部运行时文件，发布前核对实际包内容 | `lib/` 在 `.gitignore`，靠 `prepack` 生成 | 风险（FP-23） |
| 安装走 `plugin_manager` `install_bundle`，不手写 profile | README 写 `dsh plugin add` | 待核实（Q8） |
| `Config.listConfigs` 可查插件 schema | `packs[].hint` 运行期在用但未声明 | 缺项（FP-27） |
| 技能相对路径按 `<skill-base-dir>` 解析 | `role-init` 用包根相对路径 | **解析不到**（FP-21） |
| 注册资源用 `ctx.effect` 并返回 cleanup | 未返回（registry 内部 `layers.effect` 托管） | 低风险，保持 |

**隔离语义补充（由外部审查指出，已复核源码）**：
`@deepseek-ai/dsh-skill` 的 `collectFresh` 按「全局层 → scope 链」逐层 `merged.set(candidate.name)` 合并，
即**预设只能遮蔽同名技能，不能排除其它技能**。因此 bundle patch 里的全局行会把内置技能广播给所有会话。
pack 技能走的是同一个 provider，不存在这个问题。→ FP-22。

---

## 3. 要素澄清表

### 3.1 已定

| 要素 | 定论 | 依据 |
|---|---|---|
| 需求目录 | `docs/dev/001-flow-hardening/`，本仓首次建立 `docs/dev/` | dev-orchestrator 第 3 层文档体系 |
| 修改范围 | 只改本仓：`src/`、`roles/`、`skills/`、`docs/`、`scripts/`、`tests/`、`presets/` | 原文「这个项目要在这里开发」 |
| 对外接口 | `devflow_gate` / `devflow_state` 名称与参数不变 | 已有 preset 引用 |
| 开发标准 | 以 DSH 官方 `cordis-plugin-development` 与 `host-plugin.md` 为准 | 原文「和这个模式能力一致」 |
| 测试口径 | 本仓是 TS 仓库，vitest 单测为主体 | 技术栈 |
| 验收口径 | `pnpm check` + 真包集成 + 按官方清单核对展示元数据 + dogfood 一遍 | 规范 + 本仓特性 |
| 留痕 | 修复条目回写 README/docs；门禁行为变更进 docs/003 | 文档唯一权威 |

### 3.2 待问

| # | 问题 | 定版（2026-11-04「全部按推荐走」） |
|---|---|---|
| Q1 | 一条需求还是拆三条 | 不拆；一条需求，开发分四批（批零/一/二/三） |
| Q2 | `team-core` 是否并入本仓 | 本期不并入；README 写清获取方式与校验命令 |
| Q3 | review 门形态 | accept 阶段附加检查，不新增阶段（`state.json` 零迁移） |
| Q4 | `detect` 语义 | AND（全部标记命中才装）；逐个校正 stack 角色标记 |
| Q5 | 是否允许改 desktop profile 并重启 | 允许；改前备份，合并后提示重启 |
| Q6 | 验收面 | `pnpm check` + 真包集成 + 本需求 dogfood 一遍 |
| Q7 | 证据格式 | `路径:行号`；每个 FP 至少 1 条证据 |
| Q8 | 安装通道 | 官方 `plugin_manager` `install_bundle` 为主；CLI `plugin add` 降级为开发期 link 手段 |
| Q9 | 内置技能隔离语义 | 内置技能=全员公共核心，写死进 `docs/002`；不再用预设隐藏 |

---

## 4. 与既有冻结口径冲突清单

| # | 既有口径 | 实况 | 处置 |
|---|---|---|---|
| C1 | README:6「Nine Agent Skills…ship unchanged」 | `skills/` 只有 `role-init` | 改文档（FP-16） |
| C2 | README:77-78 链 `docs/SKILL-SYSTEM.md`、`docs/SKILL-INDEX.md` | 两文件不存在 | 补或删（FP-16） |
| C3 | docs/004「缺包/缺能力拒绝启动」 | 白名单缺技能静默丢弃（实测） | 改实现（FP-02） |
| C4 | docs/001 §6「五道门」 | 只有四道，review 不入状态机 | 改实现（FP-07） |
| C5 | docs/001:345「草案，未落地任何改动」 | 已实现大半，4.1-4.3 零实现 | 改文档（FP-16） |
| C6 | role-init「detect 是唯一事实来源」 | 代码只解析不消费 | 改实现或改口径（FP-12） |
| C7 | 流程产物含 `test-report.md`、`ui-acceptance.md` | 门禁 `DEFAULT_FILES` 无此二者 | 改实现（FP-05/06） |
| C8 | 官方规范要求展示元数据与图标 | 无 `locale/`、无 `icon`、`exports` 未导出 | 改实现（FP-20） |
| C9 | 官方安装流程用 `plugin_manager` | README 用 `dsh plugin add` | 待 Q8 定（FP-23） |
| C10 | 设计文档「七步」 | `STAGES` 六个，无收尾阶段 | 改文档或补阶段（FP-26） |
| C11 | 设计文档「115 条审查」 | `reviewMinVerdicts` 默认 30 | 改口径（FP-26） |
| C12 | docs/002 与 examples 的 `providerName: dsh-fullstack-team-<role>` | 生成器写死 `dsh-fullstack-team` | 统一（FP-24） |
| C13 | 失败表给 `DEPLOY_FALSE_GREEN` 预算 2 | 无任何路径产生该失败类型（ship 无门） | 补门或删预算（FP-26） |

---

## 5. 用户拍板记录

| 日期 | 原话 | 性质 |
|---|---|---|
| 2026-11-04 | 「这个项目要在这里开发」 | 范围：本仓、本工作区 |
| 2026-11-04 | 「你用的就是这套插件」 | 自举：用自身流程开发自身 |
| 2026-11-04 | 「加上之前的问题，先将需求落盘」 | 范围：并入首轮问题；时序：需求先落盘 |
| 2026-11-04 | 「按道理来说，你这个插件开发；就应该和这个模式能力一致」 | 标准：采用官方插件开发规范作为验收维度 |
| 2026-11-04 | 「你按角色、skill安排迭代吧，全部按推荐走；你是主智能体，做好安排」 | **Q1-Q9 全部按推荐值定版**；迭代由主 PM 按角色×skill 编排 |
| 2026-11-04 | 设计单上报「冻结档过不了自己的门」 | **改门不改档**（新增 FP-29）：容器标题不是空节；冻结档保持原样 |
| 2026-11-04 | 设计单上报 `DEPLOY_FALSE_GREEN` 不可达 | **删预算不补门**：failure 枚举 7→6，同提交删 `FAILURE_DOC` 对应行；旧 state 里的该值按未知值容忍，不崩 |

Q1-Q9 的关键裁决**尚无用户原话**，冻结门第 3 条未满足。

---

## 6. 风险点 / 问题点 / 待澄清点

### 6.1 风险点

1. 改 `provider.get` 的 rebase 根目录影响全部 pack 技能（team-core 9 + flutter 25），呈现同时变化（`src/index.ts:200`）。
2. 改 `GATED_STAGES` 或 `advance` 语义影响已有状态文件（`src/state.ts:166`、`src/gates/types.ts:20`）。
3. 改角色装备会重生成 1023 行 `presets/roles.patch.yml`；desktop profile 里的 1072 行副本需重新合并，否则会话看到旧装备。
4. 本会话技能集合启动时装配，加 `impeccable`/`taste` 必须重启 GUI 才生效。
5. desktop profile 存的是生成后的全文副本，`roles.mjs --write` 不同步到那里（FP-24 要解决）。
6. README 的对外承诺（npm 发布、九技能、仓库 URL）已写出去，改口径要同步。
7. `skill-audit.mjs` 扫的是仓库外 `~/.dsh/skill-packs/`，CI 跑不到（FP-17 依赖 Q2）。
8. 改门禁会让历史产物"变红"（本仓 0 个，外部用户未知）。
9. **全局层广播**：内置技能对所有会话可见，预设只能遮蔽同名；改隔离策略会改变所有 preset 的可见集合（`@deepseek-ai/dsh-skill/lib/index.js` `collectFresh`）。
10. **发布形态未验证**：只在 `link:` 下跑过；4 个 peer 非 optional，本 profile `autoInstallPeers: false`，registry 安装可能装不起来。
11. **安装包内 `pnpm test` 不可用**：`files` 不含 `tests/`、`src/`，技能若让模型"跑测试复验"必然失败。
12. **文档里的路由字面量会被当契约**：设计/契约文档中任何斜杠开头的真实路由都会被端点集合比对，两侧不同步即假红；已写入 `project-standard.md` §8.2 第 13 条。
13. **官方插件开发能力不在本会话技能目录**：`dsh-agent-preset/skills/cordis-plugin-development` 存在，但本 pm 会话看不到，开发角色需显式装配。

### 6.2 问题点

1. 「给项目分配角色」在本仓分配结果为空：三个 stack 角色 detect 全不命中；`frontend-vue` 若按 OR 语义会被 `package.json` 误命中（`roles/frontend-vue.role.yml:5-7`）。
2. 「你用的就是这套插件」与 pm 装备不符：pm 要裁决「功能闸 + 界面质量闸」，但 include 里没有 `impeccable`/`taste`（`roles/pm.role.yml:8-16`、`acceptance-guard/SKILL.md:19`）。
3. README 说九技能，仓库只有一个（`README.md:6`）。
4. docs 说缺能力拒绝启动，实测静默丢弃（`src/index.ts:166-190`）。
5. docs 说五道门，代码四道（`src/gates/types.ts:20`）。
6. role-init 说 detect 是唯一事实来源，代码只解析不消费（`src/roles.ts:41`）。
7. 本仓没有 `docs/dev/`，本轮首次建立。
8. 官方规范要求展示元数据，本包无 `locale/`、`icon`，`exports` 未导出（`package.json:29-45`）。
9. 内置技能经全局层广播，与 docs/002「预设只听得见列出的」不符（对 pack 成立，对内置技能不成立）。
10. `node scripts/roles.mjs` 按 `resourceBase` 解析到 `skills/role-init/scripts/`，不存在（`skills/role-init/SKILL.md:32-33`）。
11. 生成器 `providerName` 写死 `dsh-fullstack-team`，docs/002 与 examples 写 `-<role>`，两套口径（`src/roles.ts:157`）。
12. `lib/` 在 `.gitignore` 而 `main` 指向它：git 地址安装缺入口（`package.json:28`、`.gitignore:2`）。

### 6.3 待澄清点

1. Q1 需求粒度。
2. Q2 `team-core` 并入或外置。
3. Q3 review 门形态。
4. Q4 `detect` 语义。
5. Q5 是否改 profile 并重启。
6. Q6 验收面。
7. Q7 证据格式。
8. Q8 安装通道：官方 `plugin_manager` 为主，还是保留 CLI `plugin add`。
9. Q9 内置技能隔离语义：定为公共核心，还是 bundle patch 不插全局行。

---

## 7. 功能点清单（随本档冻结）

| FP | 功能点 | 落点 | 验收标准 | 原话依据 |
|---|---|---|---|---|
| FP-01 | pack 技能资源路径按**所属包目录**重写 | `src/index.ts` provider.get | `.agent/skills/<name>/…` 落到 `<pack>/<name>/…`；impeccable 70 处引用可解析 | 加上之前的问题 |
| FP-02 | 白名单缺技能=启动失败并点名；`roles.mjs` 预检同规则 | `src/index.ts`、`src/roles.ts` | `include` 含不存在技能 → 抛错并指出名字 | 同上 |
| FP-03 | review 门要求每条结论挂可解析证据 | `src/gates/artifact.ts`、`stages.ts` | 30 行"通过"零证据 → 不通过 | 同上 |
| FP-04 | accept 门逐 FP 结论带证据；P0 识别覆盖常见写法 | 同上 | 无证据的「FP-xx 通过」不通过；「P0 未关闭：2」阻断 | 同上 |
| FP-05 | `test-report.md` 纳入状态机 | `stages.ts`、`state.ts` | 无执行报告不能从 test 进 accept | 同上 |
| FP-06 | `ui-acceptance.md` 纳入验收（纯后端可显式豁免） | `stages.ts` | 有界面变更而缺报告 → 阻断 | 同上 |
| FP-07 | review 门接入状态机 | `state.ts` / `types.ts` | 未跑 review 不得进 ship（形态见 Q3） | 同上 |
| FP-08 | 端点识别支持表格、query、尾斜杠 | `stages.ts` `ENDPOINT_SPAN` | 表格 `\| POST \| /api/x \|` 能识别 | 同上 |
| FP-09 | `state.json` 损坏不静默重置 | `state.ts` `readState` | 损坏时明确报错，不悄悄回 clarify | 同上 |
| FP-10 | rework 预算按阶段重置；耗尽阻断 advance | `state.ts` | 跨阶段重新计数；耗尽后 advance 被拒 | 同上 |
| FP-11 | 新增 `dsh-plugin-dev`（TS/DSH 插件）stack 角色 | `roles/`、`presets/` | 8 角色可装；本仓命中；角色 manifest 与文档声明「依赖宿主提供的官方插件开发能力，本包 include 无法引用；环境不提供时按 `project-standard` §8.1 清单执行」 | 给项目分配角色 |
| FP-12 | `detect` 语义定死并可执行：**组内 AND、组间 OR**（字符串=单元素组） | `role-init`、`src/roles.ts` | 文档与代码同一语义；本仓不被判成 frontend-vue；只含 `pom.xml` 的仓能命中 `backend-java`（纯 AND 会让它永不命中，已修正 Q4 的过度简化） | 你用的就是这套插件 |
| FP-13 | 角色装备补齐（pm 加 impeccable/taste；mobile 加 acceptance-guard） | `roles/*.role.yml` | 双闸所需件在主 PM 装备内 | 双闸并行（既有 skill 口径） |
| FP-14 | 预设安装脚本：生成→装 profile | `scripts/`、`docs/` | 一条命令完成生成+合并+提示重启；重复执行不产生重复 id | 要在这里开发 |
| FP-15 | 本仓 `project-standard.md` + `project-manifest.md` | `docs/dev/` | 两文件存在并声明本仓角色集 | 同上 |
| FP-16 | README/docs 与实现对齐（技能数、包来源、断链、001 状态） | `README.md`、`docs/` | 无断链；技能数与实况一致 | 看一下都有什么问题 |
| FP-17 | CI：`pnpm check` + skill-audit + 真包集成 | `.github/workflows` | push/PR 自动跑，失败即红 | 同上 |
| FP-18 | `role-init` 命令可移植 | `skills/role-init/SKILL.md` | 用户项目内执行能定位包内脚本，或明确说明在包目录执行 | 同上 |
| FP-19 | 真包集成测试（team-core + 7 角色） | `tests/` | 断言每角色可见技能集合符合 manifest；FP-01/02 有回归 | 同上 |
| FP-20 | 展示元数据：`locale/en.json`、`locale/zh.json`（`meta.title`/`meta.description`）、`icon.svg`，`exports` 加 `./locale/*.json` 与 `./icon`，`files` 补齐 | `locale/`、`icon.svg`、`package.json` | 插件页/详情显示本包标题、描述、图标；`exports` 与 `files` 按规范；发布前核对包内容 | 和这个模式能力一致 |
| FP-21 | 技能内命令可执行：`role-init` 的 `scripts/roles.mjs`、`docs/005` 的 `skill-audit`、`pnpm test` 按安装形态修正 | `skills/role-init/SKILL.md`、`docs/005` | 技能给出的每条命令在安装形态下可执行，或改为"报告给用户" | 同上 |
| FP-22 | 内置技能隔离语义定死并落地 | `cordis.patch.yml`、`docs/002` | 二选一写死：公共核心（文档声明）/ 不插全局行（预设各插）；加一条集成断言 | 同上 |
| FP-23 | 分发与安装形态：git 安装缺 `lib/`、peer 依赖在 `autoInstallPeers:false` 下的落地、README 安装说明 | `package.json`、`README.md` | 发布包可安装可加载；渲染资源按官方流程（`install_bundle`）验证 | 同上 |
| FP-24 | 生成器输出：`providerName` 统一、`--write` 不写只读包路径 | `src/roles.ts`、`scripts/roles.mjs` | 生成物与 docs/examples 同口径；写入目标可配置（stdout/profile） | 同上 |
| FP-25 | `skill-audit.mjs` 去硬编码（公司名/仓名/表前缀改为项目侧配置或移出发布物） | `scripts/skill-audit.mjs` | 发布脚本不含任何具体项目事实；体检仍可跑 | 同上 |
| FP-26 | 文档口径对齐：七步/六阶段、115/30、五道门实现边界、`DEPLOY_FALSE_GREEN` 可达性 | `docs/001`、`docs/003`、`src/state.ts` | 文档与代码同一口径；不可达失败类型补门或删除 | 同上 |
| FP-27 | `Config` 补 `packs[].hint`；工具描述把 `stage`/`action`/`failure` 判据下沉到参数 | `src/index.ts`、`src/tools.ts` | `Config.listConfigs` 能看到 `hint`；参数描述自带判据 | 同上 |
| FP-28 | 门禁输入安全：root 必须绝对路径、证据路径不得越出 root、`read` 校验 root、状态写入串行化 | `src/gates/artifact.ts`、`state.ts` | 相对 root 报错；`../../x:1` 不被读取；并发写不丢计数 | 同上 |
| FP-29 | 容器标题不算空节：`## 节` 后紧跟 `### 子节` 时，父节不判 `EMPTY_SECTION`；正文真空的子节照判 | `src/gates/artifact.ts` `checkEmptySections` | 001 自身 `requirement.md`、`assessment.md` 在 clarify/test/accept 三门不再因容器标题报红；真空节用例仍拦 | 门禁误报（001 自检） |

---

## 8. 本期范围与不做清单

**做**：FP-01 ~ FP-29。

**不做（本期不做，写进交付汇报）**：

1. `docs/001` 4.1-4.3 的生产令牌、只读账号、环境权限矩阵——依赖实体准备。
2. 云效 Projex 状态同步——本仓未接云效。
3. 新增 Java/Vue/Flutter 之外的业务端角色——只补插件开发角色。
4. npm 市场发布与版本号规范——等 Q2/Q8 定分发形态。

**假设清单**：

1. 需求目录落 `docs/dev/001-flow-hardening/`。
2. `devflow_gate` / `devflow_state` 对外参数不破坏。
3. 允许在 desktop profile 应用角色变更并重启（Q5 未拍板前不执行）。
4. 本仓测试以 vitest 单测为主体，不受「后端不写单测」约束。

---

## 9. 冻结门状态

| 条件 | 状态 |
|---|---|
| 待问要素清零 | ✓ Q1-Q9 全部定版（2026-11-04，用户「全部按推荐走」） |
| 冲突清单清零 | ✓ C1-C13 均有处置归属，随批次关闭 |
| 用户对关键裁决点头 | ✓ 原话已入档（§5） |

**结论：已冻结。** 进入设计/开发 = 见 `assessment.md` 与 `execution-plan.md`。

---

## 10. 复核记录（本档依据的事实）

| 事实 | 取证方式 |
|---|---|
| 插件规范原文（展示元数据/图标/exports/files/安装流程） | 从 `app.asar` 提取 `cordis-plugin-development/references/host-plugin.md` 与 `SKILL.md` 阅读 |
| 全局层与 scope 链按技能名合并 | 读 `@deepseek-ai/dsh-skill/lib/index.js` `collectFresh` |
| 技能资源按 base dir 解析 | 读同文件 `renderResourceHint` |
| 类型/测试/构建 | `pnpm typecheck` 0 error；`vitest` 108 passed；`tsdown` 构建成功 |
| 白名单缺技能静默丢弃 | 直接调用 `apply()` 探测 |
| review/accept 门可被空话通过 | 直接调用 `devflow_gate` 探测（30 行"通过"、无证据"FP-xx 通过"均 passed） |
| 角色生成物与 `roles/*.yml` 一致 | 重新渲染比对，逐字节相同 |
| profile 副本与仓库生成物差异 | 仅头部注释与 registry 收尾两处 |
| 发布包实际携带的文件 | 读 `package.json` `files`：含 `lib`、`scripts`、`skills`、`roles`、`presets`、`docs`、`locale/*.json`、`icon.svg`；**不含 `tests/`、`src/`**。故包根命令（`scripts/roles.mjs`、`scripts/skill-audit.mjs`）在安装形态可用，`pnpm test` 不可用（FP-21 实测纠正） |
