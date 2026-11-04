# 001 · 批二 门禁与状态机机制：技术设计

| 项 | 值 |
|---|---|
| 需求编号 | 001（`requirement.md` 已冻结） |
| 批次 | 批二 · 机制（FP-01~FP-10、FP-22、FP-26、FP-28） |
| 角色 | 全栈研发团队 · 后端设计 |
| 依据 | `requirement.md` §7 FP 清单、§6 风险/问题、`docs/dev/project-standard.md` §2 分层铁律 |
| 契约 | 与本文件同批产出的 `api-contract.md`（对外契约唯一权威） |
| 状态 | 设计定版，待开发按 §6 顺序实施 |

> 本文件回答「改哪个文件的哪个函数、对外契约怎么变、旧东西还能不能用、要断言什么」。
> 具体字段表、finding code 全表、预算表、配置键位表集中在 `api-contract.md`，本文只做引用与决策说明，不复写数值。

行号基线：撰写时工作树 = `HEAD 15ee366` 叠加批一未提交改动；`src/gates/**`、`src/state.ts` 当时未改动，
`src/index.ts`、`src/tools.ts` 处于批一编辑中。行号用于定位，**函数名为准**；批一合并后行号会整体位移。

## 0. 本批范围与判据

- **覆盖**：FP-01（pack 资源路径）、FP-02（白名单缺技能即失败）、FP-03（review 证据）、FP-04（accept 逐 FP 结论＋证据＋P0 识别）、FP-05（`test-report.md` 进门）、FP-06（`ui-acceptance.md` 进门＋显式豁免）、FP-07（review 并入 accept）、FP-08（端点识别）、FP-09（状态文件损坏不静默重置）、FP-10（预算按阶段重置＋耗尽拦 advance）、FP-22（内置技能=公共核心）、FP-26（文档与代码同口径、不可达失败类型处置）、FP-28（门禁输入安全）。
- **不覆盖**：FP-11~FP-21、FP-23~FP-25、FP-27（批一/批三），本设计只声明交界，不改其落点。
- **定版裁决**（来自需求档，本文不重开）：review 是 accept 的附加检查，不新增 stage；内置技能是全员公共核心，隔离语义靠文档而非预设隐藏；证据格式 `路径:行号`，每个 FP 至少 1 条。
- **观察**：撰写时 `pnpm test` 跑不出全绿，原因是批一正在改 `src/tools.ts`（编辑中间态），与本批设计无关；本设计不据此下任何结论。

## 1. 改动面总览

| 文件 | 函数 / 常量 | 涉及 FP |
|---|---|---|
| `src/index.ts` | `rebaseRoot`（新）、`apply` | FP-01、FP-02 |
| `src/catalog.ts` | `rebaseResourcePaths`（仅补注释，语义不变） | FP-01 |
| `src/roles.ts` | `checkRoleIncludes`（新） | FP-02 |
| `scripts/roles.mjs` | 主流程加预检与退出码 | FP-02 |
| `src/gates/artifact.ts` | `resolveRoot`、`loadGateConfig`、`checkEvidence`、`reportsOpenP0`、`evidenceRefs`（新）、`window`（新）、`hasVerdict`（新） | FP-03、FP-04、FP-08、FP-28 |
| `src/gates/stages.ts` | `DEFAULT_FILES`、`parseEndpoint`（新）、`endpoints`、`testGate`、`acceptGate`、`reviewGate`、`runGate` | FP-03~FP-08 |
| `src/gates/types.ts` | 无代码改动（finding code 是字符串字面量） | FP-03、FP-04、FP-10 |
| `src/state.ts` | `FAILURE_BUDGETS`、`FlowState`、`initialState`、`readState`、`writeState`、`withStateLock`（新）、`advance`、`rework` | FP-07（接线）、FP-09、FP-10、FP-26、FP-28 |
| `src/tools.ts` | `STAGE_DOC`、`FAILURE_DOC`、`root` 参数描述 | FP-05、FP-06、FP-07、FP-26、FP-28 |
| `cordis.patch.yml` | **不动**，守住唯一全局行 | FP-22 |
| `docs/001-design.md`、`docs/002-role-presets.md`、`docs/003-tools.md` | 口径回写 | FP-22、FP-26 |

分层铁律核对：`gates/` 仍只读 root 与配置，不引入项目事实；`tools.ts` 仍只 wire，判定全在 `state.ts`/`gates/`；`index.ts` 仍只装配（新增的两处判定都是「装配期自检」，不含业务规则）；`roles/` 仍是数据。

## 2. 先定的四条机制（后文直接引用）

这四条被多个 FP 共用，先定死，后面各 FP 只引用、不重述。

### 2.1 门组合与 pass 规则

- `pass` 恒等于「本次运行产出的 findings 里没有 `severity:'error'`」。`warning` 永不阻断。
- `runGate('accept')` 是**组合门**：先跑验收门，再跑评审检查，两份 findings 合并返回，`stage` 仍是 `accept`。
- `devflow_gate` 的 `stage` 枚举保持 5 个（`clarify`/`design`/`test`/`accept`/`review`）；`review` 仍可单跑（早期自检），但 `advance` 走的是 accept 组合门，因此「未跑 review 不得进 ship」由状态机保证，不靠模型自觉。
- `state.ts` 的 `advance` 不改调用方式，只依赖 `runGate` 的返回值——组合逻辑全部落在 `stages.ts`。

### 2.2 证据窗口（FP-03 / FP-04 共用一套语义）

一条结论的证据可以同行，也可以写在**紧随其后的那一行**（标题式与续行式两种排版的交集）。形式化为：

```
窗口(i) = [第 i 行] ∪ [第 i+1 行]（若存在）
```

- 判定「某行有结论」用 `hasVerdict`（与 `countVerdicts` 同一组结论词：pass/fail/n-a/通过/不通过/不适用）。
- 判定「窗口有证据」用 `evidenceRefs`（`路径:行号` 形态，见 api-contract §1.6）。
- 只做**两行窗口**，不做「整节都算」：否则一条证据可以借给同节任意结论，证据就失去意义。

### 2.3 配置与产物的边界

- 项目结构只从 `devflow.config.json` 来：文件改名、必需章节、评审条数下限、界面是否适用，全部是配置键。
- 「界面是否适用」只能由配置表达（`ui.applicable`），**不能**由报告自己写「不适用」——否则报告用一句话就能绕过 FP-06。
- 豁免是配置事实，但必须留下痕：`ui.applicable=false` 缺理由即报错；有理由则以 `warning` 形式出现在每次 accept 结果里。

### 2.4 状态机版本与重置语义

- `state.json` 升到 `version: 2`，唯一新增字段是 `reworkStage`（计数器归属阶段）。
- 预算口径从「整条需求」改为「当前阶段」：进入新阶段即清零，历史留在 `history` 里（每次 rework 事件都记了 `stage`，可从事件流重建任意阶段的消耗）。
- 不新增 stage：`STAGES` 六项不变，`state.json` 的 `stage` 取值集合不变（Q3 零迁移）。

## 3. 逐 FP 设计

每条给出四件事：改动点（文件 → 函数 → 行为）、数据/契约变化、兼容性、测试点（断言清单，不含测试代码）。
「证据」一行是现状取证，格式 `路径:行号`，每个 FP 至少一条。

### FP-01 · pack 技能资源路径按所属包目录重写

- **证据（现状）**：`src/index.ts:200` 把 `skillDir`（包内 `skills/`）传给了每一次 rebase，pack 技能也被重写成包内路径；`src/catalog.ts:175` 已经把每个候选的 `resourceBase.path` 设成它自己所在的目录。
- **改动点**：
  - `src/index.ts` 新增模块内函数 `rebaseRoot(candidate, fallback)`：当 `candidate.resourceBase.kind === 'directory'` 时取 `posix.dirname(candidate.resourceBase.path)`；结果为 `.`、空串或等于原值则回退 `fallback`。
  - `src/index.ts` `apply` 内 provider 的 `get`（现 `:199-201`）：第三个实参由 `skillDir` 改为 `rebaseRoot(candidate, skillDir)`。
  - `src/catalog.ts` `rebaseResourcePaths`（`:122`）逻辑一行不改，只补注释说明「root 由候选所属包推导，不再由调用方猜」。
- **契约变化**：`get` 返回的 `content` 中资源基址 = 候选所属包的技能目录（bundle 即 `<pkg>/skills`，pack 即 `<pack>`）；候选字段不变（不新增 `owner` 字段，避免触碰宿主的候选结构）。
- **兼容性**：内置技能行为不变（其 `resourceBase` 的父目录就是 `skillDir`，尾斜杠差异被 `replace(/[\\/]+$/u,'')` 吸收）；pack 技能从「指向不存在的包内路径」变为正确路径，属修复；preset、状态文件、既有产物均不受影响。回退路径保证 `resourceBase` 异常时退回今天的语义。
- **测试点**：
  1. pack 技能正文含 `.agent/skills/<name>/scripts/x` → `get` 后为 `<pack>/<name>/scripts/x`（断言绝对路径）。
  2. 内置技能同样引用 → 仍落到 `<pkg>/skills/<name>/...`。
  3. 三层布局 `<pack>/skills/<name>` → 父目录取 `<pack>/skills`。
  4. 其他前缀 `.dsh/skills/`、`.claude/skills/` 同样被重写。
  5. `get` 返回值仍不含 `rank`/`locator`（锁定既有形状）。
  6. 对已 rebase 文本再跑一次 `rebaseResourcePaths` 无二次变化（幂等）。

### FP-02 · 白名单缺技能＝启动失败并点名

- **证据（现状）**：`src/index.ts:191-193` 只在「一个技能都没有」时抛错，`include` 里拼错的名字被静默丢弃；`src/roles.ts:112-120` 的 `planRoles` 只校验 pack 目录存在，不校验技能名。
- **改动点**：
  - `src/index.ts` `apply`：在 pack 合并循环结束之后、`candidates.length === 0` 检查之前，计算 `advertised`（合并后的可见技能名集合）与 `missing = include 中不在 advertised 的名字`；非空即抛错，错误串包含 `dsh-fullstack-team:` 前缀、`providerName`、缺失名单、当前可见集合（排序后）。
  - `src/roles.ts` 新增导出 `checkRoleIncludes(roles, available)`：纯函数，返回 `{ roleId, skills }[]`，规则与运行期一致（`include` 每个名字必须在 `available` 集合内）；`available` = 内置技能名 ∪ 每个**存在**的 pack 目录下的技能名。
  - `scripts/roles.mjs`：`planRoles` 之后调用 `checkRoleIncludes`，非空时逐个角色打印缺失技能并 `process.exitCode = 1`，且**不写** `presets/roles.patch.yml`。
  - `src/roles.ts` 的 `loadRoles` 对 manifest 里出现 `exclude` 键视为错误（与 FP-22 的隔离语义配套：`exclude` 对内置技能无效，不允许在 manifest 里表达）。
- **契约变化**：新增一类装配期致命错误（错误文本即契约，见 api-contract §4.6）；`scripts/roles.mjs` 增加退出码 1 的失败路径；`src/roles.ts` 新增一个导出（additive）。
- **兼容性**：现有 8 个角色的 `include` 里，`dev-orchestrator` 等来自 `team-core` pack，而 pack 缺失时角色本就被 `planRoles` 判 blocked、不会挂载，因此不会误报；但「pack 存在而缺某个名字」的 preset 从静默少技能变为启动失败（C3 要的语义）。手写 preset 拼错名字会让会话起不来——错误串必须列全可见集合，让用户一眼能改。迁移动作：合并 profile 前先 `node scripts/roles.mjs`。
- **测试点**：
  1. `include:['no-such-skill']` → `apply` 抛错，文本含该名字与 `dsh-fullstack-team:`。
  2. `include:['role-init']` → 正常注册。
  3. `include:['flutter-test']` + pack 提供该技能 → 正常（校验在 pack 合并之后）。
  4. 同一名字同时出现在 `include` 与 `exclude` → 判为缺失并点名（可见集合里确实没有它）。
  5. `checkRoleIncludes`：全命中返回 `[]`；缺两个名字返回一条含两个名字的记录。
  6. `checkRoleIncludes` 的 `available` 来自 pack 目录时，缺 pack 目录的角色不计入缺失（由 blocked 表达）。
  7. manifest 含 `exclude` 键 → `loadRoles` 抛错并点名文件。

### FP-03 · review 门要求每条结论挂可解析证据

- **证据（现状）**：`src/gates/stages.ts:304-312` 只数结论条数并做全局证据解析，30 行「通过」零证据可以过门（`requirement.md` §10 已实测）。
- **改动点**：
  - `src/gates/artifact.ts` 新增 `evidenceRefs(text)`（复用 FP-28 收紧后的引用正则）、`window(artifact, index)`（第 i 行与 i+1 行）、`hasVerdict(text)`（抽取 `countVerdicts` 的正则为 `VERDICT` 常量，`countVerdicts` 改为使用它）。
  - `src/gates/stages.ts` `reviewGate`：保留条数下限与 `checkEvidence`，新增逐行扫描——凡 `hasVerdict(line)` 为真而行窗口内 `evidenceRefs` 为空，产出一条 `REVIEW_EVIDENCE_MISSING`（带 `line`）。
- **契约变化**：新 finding code `REVIEW_EVIDENCE_MISSING`（error）；review 的 pass 条件变为三条同时成立（条数达标、每条结论有证据、所有引用可解析）。`checked` 不变。
- **兼容性**：旧 `review-notes.md`（只写结论）从 pass 变 fail，这是需求要的行为（C4/FP-03），需在 `docs/003` 与 README 标注；无法用配置放宽（`reviewMinVerdicts: 0` 只放宽条数，不放宽证据），这是刻意的——放宽证据等于废掉这道门。
- **测试点**：
  1. 30 行「通过」无证据 → fail，`REVIEW_EVIDENCE_MISSING` 恰好 30 条。
  2. 同一行 `… pass — 证据：src/a.ts:1` 且文件存在 → pass。
  3. 结论行 + 下一行 `证据：src/a.ts:1` → pass（窗口语义）。
  4. 有引用但文件不存在 → 只出 `EVIDENCE_MISSING`，不出 `REVIEW_EVIDENCE_MISSING`（不双报同一行）。
  5. 引用行号越界 → `EVIDENCE_OUT_OF_RANGE`。
  6. `通过`、`不通过`、`不适用`、`pass`、`fail`、`n/a` 都算结论词。
  7. 29 条（各带证据）+ 下限 30 → 仍 fail，且只有 `REVIEW_ITEM_NO_VERDICT`。

### FP-04 · accept 门逐 FP 结论带证据；P0 识别覆盖常见写法

- **证据（现状）**：`src/gates/stages.ts:257-271` 只比总条数，`FP-1 通过` 无证据也能过（`requirement.md` §10 实测）；`src/gates/artifact.ts:168-174` 的 P0 判定只认 5 个英文/中文词。
- **改动点**：
  - `src/gates/artifact.ts` 重写 `reportsOpenP0(line)` 为四步算法（见 api-contract §1.6 表）：识别 P0 词（大小写不敏感）→ 关闭词优先 → 状态词与邻接数字 → 有状态词无数字视为未关。
  - `src/gates/artifact.ts` 新增 `fpWindows(artifact, id)`：返回该 id 每个出现位置的有界窗口（含行号），供逐 FP 判定。
  - `src/gates/stages.ts` `acceptGate`：coverage 之后新增逐 FP 循环——`verdictOk = 任一窗口有结论`、`evidenceOk = 任一窗口有证据`；两者皆否 → `VERDICT_MISSING`；有结论无证据 → `ACCEPT_EVIDENCE_MISSING`（两条都带首个命中行行号）。仅在 requirement 与 acceptance 都读到时执行。
  - `VERDICT_SHORTFALL` 保留（聚合视角），与逐 FP 两个码并存，三类问题指向不同修法。
- **契约变化**：新 code `VERDICT_MISSING`、`ACCEPT_EVIDENCE_MISSING`（error）；`P0_OPEN` 的识别面扩大（见 api-contract §1.6 的接受/拒绝样例表）。
- **兼容性**：只写「FP-1 通过」的旧报告现在 fail（需求要的）；P0 识别扩大意味着过去放行的写法（`P0 剩余 2 项`、`blocking P0: 1`）现在阻断——这是把「零 P0」的口径补全，不是改规则。`P0 已关闭：3`、`本轮无 P0`、`P1 遗留 3 条` 保持不阻断。既有以表格排版的报告（一行一 FP、含结论与证据）天然满足窗口语义，不用改写。
- **测试点**：
  1. `## FP-1 创建订单` + `pass — 证据：src/a.ts:1`（文件存在）→ pass。
  2. 同上但无证据 → `ACCEPT_EVIDENCE_MISSING`，`line` 指向 FP-1 行。
  3. FP-1 出现但无任何结论词 → `VERDICT_MISSING`。
  4. 汇总表格 `| FP-1 | pass | src/a.ts:1 |` → pass（同行窗口）。
  5. 证据文件不存在 → `EVIDENCE_MISSING`（沿用，不重复出 ACCEPT 码）。
  6. 先出现一次「覆盖 FP-1」的正文、后出现带证据的结论行 → pass（任一窗口满足即算）。
  7. P0 样例表逐行断言（10 行，见 api-contract）。
  8. 未覆盖 FP → 仍出 `FP_UNCOVERED`（回归）。

### FP-05 · `test-report.md` 纳入状态机

- **证据（现状）**：`src/gates/stages.ts:33-41` 的 `DEFAULT_FILES` 无执行报告键，test 门只读 `test-cases.md`（`:227-246`）。
- **改动点**：
  - `src/gates/stages.ts` `DEFAULT_FILES` 增 `testreport: 'test-report.md'`（`ArtifactKey` 自动扩展）。
  - `GateConfig` 增 `testReportSections?: string[]`。
  - `testGate` 增一次必读：`read(root, config, 'testreport', config.testReportSections ?? [], findings)`，并把 `report.path` 推入 `checked`（顺序固定为 requirement → test-cases → test-report）。
  - 刻意**不做**逐 FP 覆盖判定：FP-05 只要求「有执行报告且不是空壳」（非空、无占位、无空节、可选必需章节）；逐 FP 证据由 accept 门负责，两道门重复阻断会让同一条问题出现两次。
- **契约变化**：test 门读取清单 3 件；新配置键 `files.testreport` 与 `testReportSections`；无新 finding code（缺文件沿用 `FILE_MISSING`，`path` 为 `test-report.md`，足以定位）。
- **兼容性**：既有只有用例文档的项目在 test→accept 处断（需求要的，C7）。迁移：用 `files.testreport` 指到项目自有报告名，或用 `testReportSections` 声明必需章节而不是改代码。存量用例需要补 fixture（`gates.spec` 的 test 门用例、`state.spec` 的整链用例），这是预期改动，由 qa 落地。
- **测试点**：
  1. 缺 `test-report.md` → fail，`FILE_MISSING` 且 `path` 为该名。
  2. 空文件 → `FILE_EMPTY`；只有标题 → `EMPTY_SECTION`。
  3. 配置 `testReportSections:['执行']` 且缺该节 → `SECTION_MISSING`。
  4. 三件齐 → pass，`checked` 恰为三个文件名且顺序固定。
  5. `files.testreport` 改名后按新名读取，旧名存在也不影响。

### FP-06 · `ui-acceptance.md` 纳入验收（纯后端可显式豁免）

- **证据（现状）**：`src/gates/stages.ts:249-286` 的 accept 门完全不读界面验收产物。
- **改动点**：
  - `DEFAULT_FILES` 增 `uiacceptance: 'ui-acceptance.md'`。
  - `GateConfig` 增 `uiAcceptanceSections?: string[]` 与 `ui?: { applicable?: boolean; reason?: string }`。
  - `acceptGate`：`applicable = config.ui?.applicable ?? true`；为真则必读并推 `checked`；为假则**不读**，改为校验理由——理由为空 → `UI_WAIVER_NO_REASON`（error），否则 `UI_ACCEPTANCE_WAIVED`（warning，带理由原文，出现在每次 accept 结果里，让豁免可见）。
- **契约变化**：新 code 两个（一 error 一 warning），新配置键 `ui` 与 `uiAcceptanceSections`，新文件键 `files.uiacceptance`。
- **兼容性**：没有界面变更且未配豁免的后端项目会变红（需求要的，C7）。豁免的表达方式只有配置一条路径，写进 `docs/003` 与验收模板说明；报告里写「不适用」不算豁免。豁免不影响其它 finding，也不改变 `pass`（warning 不入 error 计数）。
- **测试点**：
  1. 无 `ui` 键 + 无文件 → fail，`FILE_MISSING` 且 `path=ui-acceptance.md`。
  2. `{"ui":{"applicable":false,"reason":"纯后端"}}` + 无文件 → pass，findings 含一条 `UI_ACCEPTANCE_WAIVED`（warning），`checked` 不含该文件名。
  3. `{"ui":{"applicable":false}}` → fail，`UI_WAIVER_NO_REASON`。
  4. `{"ui":{"applicable":true}}` + 文件存在有内容 → pass。
  5. 不写 `ui` 键与写 `{"applicable":true}` 等价。
  6. 豁免 + 其它门错误仍在 → 仍 fail（warning 不吞 error）。

### FP-07 · review 门接入状态机（accept 附加检查）

- **证据（现状）**：`src/gates/types.ts:20` 的 `GATED_STAGES` 只有四门，`src/gates/stages.ts:328-341` 的 `runGate` 无 review，review 仅经 `devflow_gate` 单跑（`src/tools.ts` 的 `stage==='review'` 分支）。
- **改动点**：
  - `src/gates/stages.ts` 新增模块内 `acceptStage(root, config)`：跑 `acceptGate` 与 `reviewGate`，合并 findings（验收在前、评审在后），`checked` 取并集且去重，返回 `{ stage:'accept', pass, findings, checked }`。
  - `runGate` 的 `accept` 分支改为调用 `acceptStage`；`reviewGate`、`acceptGate` 保持私有；`runReview` 保留并复用 `reviewGate`（同一份实现，不复制规则）。
  - `GATED_STAGES`、`STAGES` 均不变（Q3 裁决：零阶段迁移）。
- **契约变化**：`devflow_gate(stage=accept)` 的读取清单新增 `review-notes.md`，`checked` 顺序 = requirement → acceptance →（ui-acceptance，未豁免时）→ review-notes；accept 的 findings 可能带 review 门产生的 code，按 `path=review-notes.md` 可区分来源。`stage` 字段恒为 `accept`（不会返回 `review`）。
- **兼容性**：accept→ship 变严；`advance` 无需改动（它只调 `runGate`）。存量用例中「accept 通过」的 fixture 会因缺 review 文档变红，需补 30 条带证据的评审文档。`devflow_gate stage=review` 的返回形状不变（仍是 `{stage:'review',...}`），旧调用方不受影响。
- **测试点**：
  1. 验收齐 + 无 `review-notes.md` → fail，`FILE_MISSING(path=review-notes.md)`。
  2. 验收齐 + 评审 30 条带证据 → pass。
  3. 验收齐 + 评审 29 条 → `REVIEW_ITEM_NO_VERDICT`。
  4. 验收自身有开着的 P0 + 评审不合格 → 两类 code 同时出现（组合不吞）。
  5. 返回的 `stage` 恒为 `accept`。
  6. `checked` 内容与顺序断言（含 4 项；豁免时 3 项）。
  7. `devflow_gate stage=review` 与 accept 内评审部分的 code 集合一致。
  8. `advance` 在 accept 阶段被评审问题拦住，且阶段不变、历史不增。

### FP-08 · 端点识别支持表格、query、尾斜杠

- **证据（现状）**：`src/gates/stages.ts:117` 的 `ENDPOINT_SPAN` 只接受「可选方法 + 纯路径」，`endpoints`（`:127-144`）只扫内联代码与标题，`?`、尾斜杠、表格行一律识别不到。
- **改动点**：
  - `src/gates/stages.ts` 用 `parseEndpoint(raw)` 取代内联正则：先剥反引号与加粗标记，再按四步归一（去 query/片段 → 去尾斜杠（长度大于 1 时）→ 方法统一大写 → 要求路径以斜杠开头），返回 `{ path, method? }`。
  - `endpoints` 增第三路来源：逐行扫描 Markdown 表格行——按未转义的竖线切单元格，剥壳后若某单元格是纯方法词、另一单元格以斜杠开头，组装成一个端点；若单单元格自带方法与路径，直接交给 `parseEndpoint`。表格扫描**跳过围栏代码块**（成对的三个反引号或三个波浪号），避免文档里的示例表格污染契约比对。
  - `sameEndpoint` 不改：归一化后比 `path`，方法缺省视为通配。
  - 表头行（`| 方法 | 路径 |`）与分隔行（`|---|---|`）不产生端点，因为不满足「以斜杠开头」。
- **契约变化**：`Endpoint` 结构不变（`path` + 可选 `method`）；新增归一化语义（query 与片段被忽略、尾斜杠等价、方法大小写归一）；表格是第三个识别源。端点类 finding 仍只带文件路径、不带行号（保持 `Endpoint` 形状，避免破坏既有断言；行号留作后续增强）。
- **兼容性**：靠尾斜杠区分两个端点的文档会合并（罕见）；契约表格里的端点从「完全不被读」变为「参与比对」，可能新增 `CONTRACT_MISSING`——属修复，但需在 `docs/003` 标注行为变化；围栏内的示例表格仍不参与，避免本次设计文档自身被误读（本文件 §3 的表格即受此保护）。
- **测试点**：
  1. 表格行「方法单元格 + 斜杠开头路径单元格」→ 识别出带方法的端点。
  2. 单元格带反引号或加粗 → 同样识别。
  3. 同一端点写成「带查询串」与「不带查询串」两种形态时视为同一端点。
  4. 路径尾斜杠与不带尾斜杠等价。
  5. 表头与分隔行不产生端点。
  6. 小写方法 `post` 归一为 `POST`。
  7. 围栏代码块内的表格行不产生端点。
  8. 既有 4 条 `endpoints` 用例（内联代码、标题、非路径代码、双方法同路径）仍绿。
  9. 设计/契约两端各写一种归一形态（一端带 query、一端不带）→ 判定一致，不产生 `CONTRACT_*`。

### FP-09 · `state.json` 损坏不静默重置

- **证据（现状）**：`src/state.ts:133-140` 对除 ENOENT 以外的所有异常都返回 initialState（注释还写着「repair rather than trust」），坏文件被悄悄当成设备回澄清门。
- **改动点**：
  - `src/state.ts` 把解析逻辑抽成模块内 `parseState(raw, path)`；`readState` 只区分两种情况：ENOENT → `{ initialState, created:true }`；其余（读失败、JSON 非法、结构非法）→ 抛 `dsh-fullstack-team:` 前缀错误，错误文本含状态文件绝对路径与可执行修复建议（改用 `devflow_state` 的 `reset`，或直接删文件）。
  - `advance`/`rework`/`reset` 不捕获；`src/tools.ts` 的 execute 不捕获，错误串直达模型（工具层抛错，不是 finding）。
  - `state.ts` 的 `readState` 先做 root 校验（FP-28），再读文件。
- **契约变化**：状态文件损坏 = 工具调用错误；`created` 仅在 ENOENT 时为真；修复通道三条（手改、删除、reset）。
- **兼容性**：旧「静默回 clarify」废止，`state.spec` 的「survives a corrupt file by repairing it」用例断言反转。风险：坏文件会让 read/advance 全失败——这是要的效果，但错误串必须给出一行可照做的修复动作；`reset` 不读旧文件，因此损坏时仍可用。
- **测试点**：
  1. 非法 JSON → `readState` 抛错，文本含绝对路径与 `reset`。
  2. 空文件 → 抛错（不退回 clarify）。
  3. `{"stage":"bogus"}` → 抛错。
  4. `{"stage":"design"}`（缺 rework/history）→ 可读，缺失字段补零。
  5. 文件不存在 → `created:true`、`stage:'clarify'`。
  6. 坏文件时 `advance` 抛错，且文件字节未被改写。
  7. 坏文件时 `reset` 成功，写完得到合法 v2 文件。

### FP-10 · rework 预算按阶段重置；耗尽后 advance 被拒

- **证据（现状）**：`src/state.ts:34-42` 的预算是需求级常量，`:202-228` 的 `rework` 只累加，`:166-192` 的 `advance` 从不看预算。
- **改动点**：
  - `FlowState` 增 `reworkStage: Stage`；`initialState` 置 `clarify`；`STATE_VERSION` 升 2。
  - `readState` 迁移：`reworkStage = candidate.reworkStage ?? candidate.stage`（v1 文件里已有的计数视为属于当前阶段，不丢）。
  - 新增导出 `exhaustedFailures(state)`：返回当前计数已达预算的失败类型（`count >= budget`），供 `advance` 与 `tools.ts` 的 read 复用。
  - `advance`：读状态后**先**查预算——非空即返回 `{ advanced:false, pass:false, findings:[REWORK_BUDGET_EXHAUSTED], message }`（消息点名失败类型、给出「上报」与「reset 重走」两个选项），不跑门、不写文件；门通过并移动时，把 `rework` 全部归零、`reworkStage` 置为目标阶段。
  - `rework`：若 `reworkStage !== stage`（历史遗留或手改），先归零再计数；其余语义不变（超预算仍继续计数并报 `exhausted`，保留审计事实）。
- **契约变化**：`state.json` 新字段 `reworkStage`、版本 2；新 finding code `REWORK_BUDGET_EXHAUSTED`（error，`path` 为状态文件相对路径）；`devflow_state read` 的消息只报当前阶段已耗计数；耗尽态下 `read` 的消息明确指出「需上报」。
- **兼容性**：v1 文件可读、首次写入迁 v2；跨阶段不再累积（过去被整条需求预算卡死的需求会重新能走）；新增一条拒绝路径——`advance` 在预算耗尽时即使门通过也拒绝，唯一机械出口是 `reset`（会清空当前阶段计数并回 clarify，事件仍留在 history 里）。这一条对自动化调用方是行为变化，需在 `docs/003` 标注。
- **测试点**：
  1. 阶段内耗尽 `IMPL_MISMATCH`（3 次）后，即使门通过，`advance` 也拒绝且 stage 不变、文件未改。
  2. 拒绝时 findings 含 `REWORK_BUDGET_EXHAUSTED`，`detail` 含失败类型名与 `reset` 字样。
  3. `advance` 成功后所有计数归零、`reworkStage` 等于新阶段。
  4. 新阶段再 `rework` 同一类型 → `count` 从 1 开始。
  5. v1 文件（无 `reworkStage`、计数非零）→ 读数归到当前阶段；写回 `version:2` 且带 `reworkStage`。
  6. `CONTRACT_CONFLICT` 预算 1 → 首次 rework 即 `exhausted:true`，随后 `advance` 被拒。
  7. `reset` 后计数清零、`reworkStage:'clarify'`，`advance` 可继续。
  8. 耗尽态下 `read` 的 message 含「上报」。

### FP-22 · 内置技能隔离语义定死并落地（公共核心）

- **证据（现状）**：`cordis.patch.yml:9-11` 是唯一全局 insert 且不带 `include`；`src/index.ts:169-178` 的 `include`/`exclude` 只作用于本实例；`docs/002-role-presets.md:23` 把「预设只听得见列出的」写成通用结论，对内置技能不成立。
- **裁决**：内置技能 = 全员公共核心（全局行保留）；隔离语义写进文档，不靠预设隐藏。
- **改动点**：
  - `cordis.patch.yml` 一行不改，作为「公共核心」的唯一事实来源。
  - `docs/002-role-presets.md` 新增「内置技能＝全员公共核心」小节：说明宿主的技能合并按名字逐层覆盖（预设只能遮蔽同名技能，不能移除其它技能），因此 `include` 缩小的是**本实例视图**、`exclude` 对内置技能在会话层面无效；真正可按角色隔离的只有 pack 技能（pack 由某个预设实例独占声明）。
  - `src/roles.ts` 把 manifest 里的 `exclude` 键判为错误（FP-02 已列），从机制上禁止用预设表达「隐藏内置技能」。
  - 不新增代码开关：语义靠「全局行 + 文档 + manifest 校验」三件套固定。
- **契约变化**：无运行时契约变化；文档语义升级为契约的一部分（写进 api-contract §4.7），并成为「预设不得假装能隐藏内置技能」的判据。
- **兼容性**：对现状零影响（全局行保留）；对「以为 include 能隔离」的旧文档是纠偏，需要 `docs/002` 与 `README`（批三）同步口径。风险：若将来有人删掉全局行改为逐预设插入，本契约即失效——`docs/002` 需明确这是**已定版裁决**，改动需重新走需求。
- **测试点**：
  1. 解析 `cordis.patch.yml`：恰好 1 条 `insert`，条目 `id`/`name` 均为 `dsh-fullstack-team`，且无 `config.include`/`config.exclude`/`config.tools`。
  2. `docs/002-role-presets.md` 含「内置技能＝全员公共核心」小节标题，且含「exclude 对内置技能无效」的明确表述。
  3. `roles/*.role.yml` 全文不出现 `exclude:` 键（正则扫目录）。
  4. 既有 `packs.spec` 的 exclude 用例仍绿（本实例视图语义未被改动）。

### FP-26 · 文档口径对齐：六阶段 / 四门＋一检查 / 预算表可达性

- **证据（现状）**：`docs/001-design.md:33` 写「七步流程、五道门、115 条」；`:169` 与 `:221` 同口径；`:194` 的 `DEPLOY_FALSE_GREEN` 有预算无检测者；`src/state.ts:41` 挂着该失败类型但 `ship` 无门（`src/gates/types.ts:20`）。
- **裁决**：
  - 阶段口径 = **六阶段**（clarify → design → build → test → accept → ship）；设计文档原「第七步 收尾」并入 `ship` 阶段，不单列阶段。
  - 门口径 = **四道阶段门 + 一项附加检查**（review 在 accept 内执行；build/ship 不设门）。
  - 审查口径 = 完整清单 115 条由人/技能执行，机检下限 `reviewMinVerdicts` 默认 30 条（可配），两者关系写死。
  - 不可达失败类型 = **删除** `DEPLOY_FALSE_GREEN`：`ship` 无门，部署假绿由人在 ship 阶段发现后走 hotfix 旁路，并记入 `IMPL_MISMATCH` 或 `ACCEPT_P0` 预算。
- **改动点**：
  - `src/state.ts`：`FAILURE_BUDGETS` 删 `DEPLOY_FALSE_GREEN`（6 项），`FAILURE_TYPES` 自动跟随；模块注释同步「六类失败」。
  - `src/tools.ts`：`FAILURE_DOC` 删该行（批一刚加入，必须在同一提交里删，否则类型引用失效）；`STAGE_DOC` 按 FP-05/06/07 更新读取清单与阻断条件；`ACTION_DOC` 补「预算耗尽后 advance 会拒绝」；`root` 参数描述补「必须绝对路径」。
  - `docs/001-design.md`：`:33` 七步/五道门/115 → 六阶段/四门＋一检查/115 条完整清单＋30 条机检下限；`:169` 标题与 `:171-197` 状态图 → 六阶段、收尾并入 ship、部署假绿标「无预算，人上报」；`:200-212` 失败表加「代码失败类型」列（6 个类型 + 三类「门禁拒绝、无预算」）；`:221-232` 五道门表 → 四门＋附加检查，并把 review 行标注「在 accept 内执行」。
  - `docs/003-tools.md`：stage 表补 `test-report.md`、`ui-acceptance.md`、review-in-accept；codes 全表更新；配置键补 `testReportSections`、`uiAcceptanceSections`、`ui`；预算表删一行；补 `state.json` v2 与迁移说明、root 绝对路径与证据围栏说明。
- **契约变化**：`devflow_state` 的 `failure` 枚举 7 → 6（破坏性，见 api-contract §5）；文档口径变化对外可见。
- **兼容性**：仓库内无调用方使用该失败类型（已 grep）；preset 不引用 failure 值；外部调用方传该值会被参数校验拒绝并得到枚举列表。文档口径变化对用户可见，README 的对外承诺由批三回写（本批只改 docs/001 与 docs/003）。
- **测试点**：
  1. `FAILURE_TYPES` 恰好 6 项且不含被删类型。
  2. `devflow_state` 传被删类型 → 参数校验失败。
  3. `docs/001-design.md` 全文不含「五道门」「七步」字样，含「六阶段」「四道阶段门」。
  4. `docs/003-tools.md` 的 code 表的 code 集合与源码中所有 `finding('...')` 调用产出的 code 集合一致（qa 手工核对或脚本比对）。
  5. `docs/003` 预算表与 `FAILURE_BUDGETS` 数值逐行一致（解析表格断言）。
  6. `docs/003` 的 stage 表列出 test 门三件产物、accept 门含 review。

### FP-28 · 门禁输入安全

- **证据（现状）**：`src/gates/artifact.ts:63` 先 `resolve()` 再判 `isAbsolute`（恒真，死代码）；`:219` 用 `join(root, relative)` 不校验越界；`:229` 直接 `readFileSync` 不判普通文件；`src/state.ts:114` 不校验 root 是否存在；`:144-150` 的写状态是「读-改-写」无声无锁。
- **改动点**：
  - `src/gates/artifact.ts` `resolveRoot`：先判 `isAbsolute(root)`（不满足即抛，点名原文），再判存在、是目录。
  - `src/gates/artifact.ts` `loadGateConfig`：读入后校验已知键类型（`files` 为对象、四个 `*Sections` 为字符串数组、`reviewMinVerdicts` 为数字、`ui` 为对象），非法即抛并点名键；未知键继续忽略（前向兼容）。
  - `src/gates/artifact.ts` `checkEvidence`：引用正则加负向环视（避开协议前缀与主机端口形态）；用 `resolve(root, relative)` 判定解算结果必须落在 root 内（含 root 本身），越界出 `EVIDENCE_OUTSIDE_ROOT`；非普通文件按 `EVIDENCE_MISSING` 处理并在 detail 说明；行号小于 1 或大于总行数 → `EVIDENCE_OUT_OF_RANGE`。
  - `src/state.ts`：`readState`/`writeState` 先过 `resolveRoot`；`writeState` 临时文件名带进程号与自增序号（避免两个进程共用同一临时文件）；新增 `withStateLock(root, work)`——用独占创建锁文件（`.dsh/devflow/state.lock`）实现同步互斥，重试 10 次 × 50ms，超过 10 秒的陈旧锁自动清除，最终失败抛错而非静默写；`advance`/`rework`/`reset` 整体包进锁。
  - `src/tools.ts` `root` 参数描述补「必须是绝对路径；相对路径会被拒绝」。
- **契约变化**：新 finding code `EVIDENCE_OUTSIDE_ROOT`（error）；root 必须绝对路径（错误，不是 finding）；配置非法类型 → 抛错点名键；状态写入跨进程串行（最坏阻塞约 500ms 后报错）。
- **兼容性**：传相对 root 的调用方会断——本仓脚本与文档一直用绝对路径，工具描述本就写着 absolute；历史 review 产物里引用了 `../` 或绝对路径的证据从「可能读到」变为明确报错（越界本就不该读）。锁文件会短暂存在于 `.dsh/devflow/` 下，属运行时产物，建议加入 `.gitignore`（批三处理）。同步重试会短暂阻塞宿主事件循环，上限 500ms，可接受。
- **测试点**：
  1. `runGate('clarify','.')` → 抛 `/must be absolute/`。
  2. 不存在的绝对路径 → 抛 `/does not exist/`；文件当 root → 抛 `/not a directory/`。
  3. 评审证据引 `../../x.ts:1` → `EVIDENCE_OUTSIDE_ROOT`，且不读取 root 外文件。
  4. 证据引绝对路径 → 同上。
  5. 证据引协议前缀或主机端口形态 → 不产生任何 evidence finding。
  6. 证据指向目录 → `EVIDENCE_MISSING`，detail 含「不是普通文件」。
  7. 证据行号为 0 或超总行数 → `EVIDENCE_OUT_OF_RANGE`。
  8. `reviewMinVerdicts:"30"` 字符串 → 抛错并点名键；`ui:[]` → 抛错并点名键。
  9. 同进程并发 20 次 rework → 计数为 20，无丢失。
  10. 手工占住锁文件 → advance 在约 500ms 内抛错，状态文件未被改写。
  11. 把锁文件 mtime 改成 30 秒前 → 被清除，写入成功。

## 4. 契约变更汇总

> 字段级细节只在 `api-contract.md` 定义，本节只列「变了什么」，供清单式核对。

### 4.1 finding code 增量

| code | 产生门 | severity | 归属 FP |
|---|---|---|---|
| `REVIEW_EVIDENCE_MISSING` | review（含 accept 内组合） | error | FP-03 |
| `VERDICT_MISSING` | accept | error | FP-04 |
| `ACCEPT_EVIDENCE_MISSING` | accept | error | FP-04 |
| `EVIDENCE_OUTSIDE_ROOT` | review（含 accept 内组合） | error | FP-28 |
| `UI_ACCEPTANCE_WAIVED` | accept | warning | FP-06 |
| `UI_WAIVER_NO_REASON` | accept | error | FP-06 |
| `REWORK_BUDGET_EXHAUSTED` | `devflow_state` | error | FP-10 |

既有 17 个 code 保留，语义变化两处：`P0_OPEN`（识别面扩大，FP-04）、`EVIDENCE_MISSING`（非普通文件也归此码，FP-28）。

### 4.2 工具输出字段

- `devflow_gate` 出参不变（`stage`/`pass`/`findings`/`checked`）；`checked` 内容随产物清单扩展；accept 的 `checked` 会含 `review-notes.md`。
- `devflow_state` 出参不变；`findings` 新增来源（预算耗尽）；`message` 文案变化（阶段内计数、耗尽提示）。
- 入参：`stage` 枚举 5 个、`action` 4 个、`failure` 6 个（原 7）、`root` 必须绝对路径。

### 4.3 `devflow.config.json` 键

新增 `testReportSections`、`uiAcceptanceSections`、`ui`（含 `applicable`、`reason`）、`files.testreport`、`files.uiacceptance`；其余键默认值不变。非法类型从「静默忽略」改为「抛错点名键」。

### 4.4 `state.json` 字段

新增 `reworkStage`，`version` 1 → 2；`rework`/`history` 结构不变。迁移规则见 api-contract §2.5。

## 5. 兼容性与迁移

本批的兼容性判断按「状态文件 / 预设与角色 / 已有产物 / 装配形态」四层看，破坏性项都给了迁移动作。

### 5.1 状态文件

| 情形 | 行为 |
|---|---|
| 无 `state.json` | 新建（clarify），`created:true` |
| v1（有 `stage`、无 `reworkStage`） | 可读；既有计数归当前阶段；下次写入迁 v2 |
| v2 | 原样读写 |
| 损坏/非法结构 | 抛错并给出修复建议；不再静默重置 |

### 5.2 预设与角色

- `include` 现在会被校验：合并 profile 前先跑 `node scripts/roles.mjs`（它会先构建 `lib/`，见 §8 第 6 条）。
- pack 缺失仍是「角色不可挂载」（既有行为），不因 FP-02 变成启动崩溃。
- 内置技能是公共核心：不要在 preset 里用 `exclude` 表达隔离，照做也不生效（FP-22）。

### 5.3 已有产物

- test → accept 现在要求 `test-report.md`；accept 现在要求 `ui-acceptance.md`（或配置豁免）与 `review-notes.md`；review/accept 的结论要挂 `路径:行号`。
- 修复路径：改产物；纯后端项目加 `ui.applicable=false` 与理由；产物改名用 `files` 覆盖；章节口径用 `*Sections` 声明。
- 外部用户的历史需求目录会变红，这是设计意图（`requirement.md` §6 风险 8 已登记），需在 `docs/003` 与 README（批三）标注。

### 5.4 装配与发布形态

- 本批不新增导出、不改 `apply`/`inject`/`Config` 的形状（`Config` 只增 `packs[].hint`——批一已完成，本批不改 schema）。
- `lib/` 未入库、`prepack` 生成：`scripts/roles.mjs` 的预检依赖构建产物，命令顺序必须是 `pnpm build` 之后（见 §8 第 6 条）。

## 6. 实施顺序（同批内）

1. **先安全层**：FP-28 的 `resolveRoot`、`loadGateConfig` 校验、`checkEvidence` 围栏——后面所有门的断言都建立在「输入可信」上。
2. **再状态层**：FP-09 → FP-10（同文件、同一次迁移，避免两次改 schema）。
3. **再产物层**：FP-05、FP-06（`DEFAULT_FILES` 与 `GateConfig` 一起动）→ FP-03、FP-04（证据语义复用一个窗口实现）→ FP-07（组合门最后接）。
4. **再契约层**：FP-08（端点，唯一不依赖其他改动的纯函数）。
5. **再装配层**：FP-01、FP-02（provider 与角色预检，与门禁无耦合，可并行）。
6. **最后口径**：FP-22、FP-26（文档与枚举收尾，等代码定稿再写真值）。

并行建议：1 完成后再并行两组——(2,3,4) 门禁/状态机侧；(5) 装配侧。两组的文件集不相交（`gates/`+`state.ts` vs `index.ts`+`catalog.ts`+`roles.ts`+`scripts/`），唯一交汇点是 `src/tools.ts` 的文案，由收尾方统一改。

## 7. FP → 函数落点核对表

| FP | 落点（文件:函数） | 一句话 |
|---|---|---|
| FP-01 | `src/index.ts:rebaseRoot` / `src/index.ts:apply`（get 内） | 用候选自己的 `resourceBase` 父目录做 rebase 根 |
| FP-02 | `src/index.ts:apply` / `src/roles.ts:checkRoleIncludes` / `scripts/roles.mjs` 主流程 | 合并 pack 后校验 include，缺失即抛并点名 |
| FP-03 | `src/gates/stages.ts:reviewGate` / `src/gates/artifact.ts:evidenceRefs`·`window`·`hasVerdict` | 逐条结论要求窗口内有可解析证据 |
| FP-04 | `src/gates/stages.ts:acceptGate` / `src/gates/artifact.ts:reportsOpenP0`·`fpWindows` | 逐 FP 要结论＋证据；P0 识别补全 |
| FP-05 | `src/gates/stages.ts:DEFAULT_FILES`·`testGate` | test 门必读 `test-report.md` |
| FP-06 | `src/gates/stages.ts:DEFAULT_FILES`·`acceptGate` | accept 门读 `ui-acceptance.md`，配置可豁免 |
| FP-07 | `src/gates/stages.ts:acceptStage`·`runGate` | accept 组合门＝验收门＋评审检查 |
| FP-08 | `src/gates/stages.ts:parseEndpoint`·`endpoints` | 表格/query/尾斜杠归一后识别 |
| FP-09 | `src/state.ts:readState`·`parseState` | 只对 ENOENT 新建，其余抛错 |
| FP-10 | `src/state.ts:advance`·`rework`·`exhaustedFailures`·`initialState` | 计数归阶段、耗尽拦 advance |
| FP-22 | `cordis.patch.yml`（不动）·`docs/002-role-presets.md`·`src/roles.ts:loadRoles` | 全局行保留；manifest 禁 `exclude` |
| FP-26 | `src/state.ts:FAILURE_BUDGETS`·`src/tools.ts:FAILURE_DOC`·`docs/001`·`docs/003` | 六阶段/四门＋一检查/删除不可达类型 |
| FP-28 | `src/gates/artifact.ts:resolveRoot`·`loadGateConfig`·`checkEvidence`·`src/state.ts:withStateLock`·`writeState` | 绝对 root、证据围栏、配置校验、写入互斥 |

## 8. 识别到但需求档未写明的点（随交付上报）

1. **跨批耦合**：批一刚把 `DEPLOY_FALSE_GREEN` 写进 `src/tools.ts` 的 `FAILURE_DOC`（批一改动块内），FP-26 删类型必须同批删该行并同步 `ACTION_DOC`，否则 `tsc` 报「属性不存在」。需求档只写了「补门或删预算」，没写这个连带改动。
2. **pack 技能的身份标记**：`src/catalog.ts:172-176` 让 pack 技能带 `source:'bundled'` 与 bundled rank；与内置技能同权时，同名技能谁赢取决于合并顺序。FP-01/FP-22 未覆盖，建议后续单独立项。
3. **`get` 丢字段**：`src/index.ts:199-201` 返回时剥掉 `rank`/`locator`。契约文档没写这一点；若宿主依赖 `rank` 再合并，pack 技能的等级会丢。本设计按现状写进契约并标为已知限制。
4. **行号统计口径**：`src/gates/artifact.ts:229` 用 `split` 计数，文件末尾换行会多算一行，`路径:末行+1` 会被判有效。需求未提，本设计不改（改了会让既有用例结果变化），只记录。
5. **`ship` 阶段的空推进**：`src/state.ts:183-186` 在最后一阶段返回 `pass:true, advanced:false`；FP-10 之后同一 action 会多出一种组合（`pass:false, advanced:false` 且无门 findings）。调用方要靠 `code` 区分「已到终点」与「预算耗尽」。需求未定义这两态的表达方式。
6. **预检依赖构建**：`scripts/roles.mjs:24` 从 `../lib/roles.js` 导入，因此 FP-02 的角色预检必须在 `pnpm build` 之后才生效；「改完 manifest 立刻预检」这条操作路径需要文档写明前置。
7. **`exclude` 的双重效果**：`src/index.ts:170-178` 的 `exclude` 对内置技能仍作用于本实例，但全局行存在时会话可见集合里它们又回来了。两种「看得见/看不见」并存，用户极易误判；本设计只把语义写进文档（FP-22），不删该能力。
8. **三类 accept 问题并存**：`VERDICT_SHORTFALL`（聚合条数）、`VERDICT_MISSING`（逐 FP 无结论）、`ACCEPT_EVIDENCE_MISSING`（逐 FP 无证据）可能同时命中同一份报告。是否合并成一个 code 需求档未定；本设计保留三码，理由是三种修法不同（补条数 / 补结论 / 补证据）。
9. **豁免的表达位置**：`docs/001` §6 把「双闸验收」写成产物契约，而界面豁免落在配置里。两处表达可能冲突，需 `docs/003` 明确「豁免是配置事实，不是报告结论」。
10. **两个工具的 stage 枚举不同名同集**：`devflow_gate` 5 个值（含 review），`devflow_state` 6 个值（含 build/ship）。FP-27 的参数判据文案若从一处复制到另一处会写错；本设计在 api-contract 分别列出，口径见 api-contract §4.2 与 §1.1。
11. **容器型标题被误判为空节（会挡住本需求的 dogfood 验收）**：`src/gates/artifact.ts:140-149` 把「标题正文为空」直接判 `EMPTY_SECTION`，而冻结的 `requirement.md` 有 4 处「章级标题后直接跟小节标题」的写法（第 13、70、121、185 行），`assessment.md` 有 1 处（第 6 行）。实测：`devflow_gate` 的 clarify/test/accept 三门口对 001 需求目录全部因此变红。两条路——(a) 只改产物：给容器标题补一行正文（但 `requirement.md` 已冻结，动它要走变更）；(b) 改门：把「标题下一行是更深层标题」视为非空（改动小、对存量产物更宽容，但属 FP 清单外的新行为，需主 PM 裁决）。本设计**不**擅自落地其中任何一条，只登记。


## 9. 测试总览（交由 qa 落地）

- **新增用例面**：证据窗口（同行/续行/无证据/越界/越界路径）、P0 十个样例、端点三种形态与围栏跳过、`test-report`/`ui-acceptance` 的门与豁免、accept 组合门、状态 v1→v2 迁移与耗尽拒绝、坏状态抛错、root 绝对路径、配置类型校验、并发计数、锁超时。
- **需反转的既有断言**：`tests/state.spec.ts`「survives a corrupt file by repairing it」→ 改为断言抛错；`tests/gates.spec.ts` 的 test 门用例补 `test-report.md`；accept 用例补 `review-notes.md`（30 条带证据）与 `ui-acceptance.md`；`tests/state.spec.ts` 整链用例按新产物清单补齐。
- **回归不可动**：`tests/catalog.spec.ts`、`tests/roles.spec.ts` 的既有断言（除新增导出）、`tests/packs.spec.ts` 的 pack 隔离语义、`tests/tools.spec.ts` 的工具名与错误文本。
- **本轮不写测试代码**：以上是断言清单，落地由 qa 按 `test-cases.md` 执行。
