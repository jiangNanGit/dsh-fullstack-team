# 对外契约 · dsh-fullstack-team（001 批二定版）

| 项 | 值 |
|---|---|
| 适用包 | `dsh-fullstack-team`（DSH bundle，Host-only） |
| 版本 | `0.1.0` + 001 批二改动 |
| 定版依据 | `docs/dev/001-flow-hardening/requirement.md`（冻结）、`design.md`（同批设计） |
| 状态 | 契约冻结；改契约 = 重走需求，不在实现里顺手改 |

> 本文件是本插件的**对外契约唯一权威**。代码与本文不一致时，先判哪边对，再改另一边；不允许「两边都算」。
> 契约有五块：两个工具的入参/出参、`devflow.config.json`、`state.json`、技能 provider。**没有 HTTP 端点、没有 UI、没有后台任务**——所以本文件不描述任何路由。

## 0. 契约面与稳定性

| 契约面 | 载体 | 变更影响 |
|---|---|---|
| 工具 | `devflow_gate`、`devflow_state` 的参数与返回结构 | 模型行为、preset 可用性 |
| 项目配置 | `<root>/devflow.config.json` | 用户项目，逐目录生效 |
| 流程状态 | `<root>/.dsh/devflow/state.json` | 用户项目，跨会话持久 |
| 技能 provider | 候选结构、`get` 返回、资源路径语义 | 模型看到的技能文本 |
| 装配期错误 | 启动错误文本与退出码 | 会话能否起来 |

术语：`root` = 一条需求目录（绝对路径）；`门` = 只读 root 的纯判定；`finding` = 一条带 code 的判定结果；`窗口` = 某行与其后一行（证据语义用，见 1.6）。

## 1. `devflow_gate`

判定一个阶段的产物是否够格被下一阶段消费。只读 `root` 下的文件，从不写盘；`root` 之外的文件一律不读。

### 1.1 入参

| 参数 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `stage` | 枚举 | 是 | `clarify` \| `design` \| `test` \| `accept` \| `review`，共 5 值 |
| `root` | string | 是 | 需求目录的**绝对路径**；相对路径被拒绝 |

`stage` 没有 `build` 与 `ship`：这两个阶段不设门，传其它值即参数校验失败（枚举之外一律拒绝）。
`review` 不是独立阶段（`state.json` 里没有它的位置），它是 accept 阶段的附加检查；单跑 `review` 是早期自检入口。

### 1.2 出参

| 字段 | 类型 | 语义 |
|---|---|---|
| `stage` | string | 恒等于入参 `stage`（accept 组合门也返回 `accept`，不返回 `review`） |
| `pass` | boolean | 本次 findings 中无 `severity:'error'` 即为真 |
| `findings` | array | 每条含 `code`、`severity`、`detail`，可选 `path`、`line` |
| `checked` | array | 本次真正读到并参与判定的产物文件名（相对 root），顺序固定 |

`checked` 的语义是「读过」，不是「通过」：读到但内容不合格的产物照样出现在 `checked` 里。
缺失的产物不进 `checked`（它产出 `FILE_MISSING` 后即返回）。

### 1.3 stage 枚举与读取产物

| stage | 必需产物 | 可选产物 | 阻断条件（error 级） |
|---|---|---|---|
| `clarify` | `requirement.md` | `assessment.md` | 缺失/非普通文件/空；占位标记；声明章节无正文；未声明任何 `FP-n` |
| `design` | `design.md`、`api-contract.md` | — | 任一产物基础不变量不过；两端点集合不一致（方法敏感） |
| `test` | `requirement.md`、`test-cases.md`、`test-report.md` | — | 用例未覆盖某 FP；用例里有未声明的 FP；用例未点名任何 FP；执行报告缺失/为空/带占位/缺必需章节 |
| `accept` | `requirement.md`、`acceptance-report.md`、`review-notes.md`；`ui-acceptance.md`（未豁免时） | — | 未覆盖某 FP；某 FP 无结论；某 FP 结论无证据；结论条数少于 FP 数；P0 计数大于 0；评审文档不合格（见 review 行）；界面产物的豁免无理由 |
| `review` | `review-notes.md` | — | 结论条数少于 `reviewMinVerdicts`；某条结论所在窗口无证据；引用的文件/行号不可解析、越出 root 或不是普通文件 |

补充规则：

- 章节名称清单来自配置（`*Sections`），默认空 = 不检查章节。
- `requirement.md` 在 `test` 与 `accept` 中只读不检查章节（章节口径只属于 `clarify`）。
- `test-report.md` 只做「有报告且不是空壳」，不逐 FP 比对——逐 FP 由 `accept` 负责，避免同一问题被两道门重复阻断。
- `ui-acceptance.md` 的适用性只由配置决定；报告自己写「不适用」不构成豁免。

### 1.4 finding code 全表

| code | 产生门 | severity | 触发条件 | 携带 |
|---|---|---|---|---|
| `FILE_MISSING` | 全部门 | error | 产物不存在（`path` 指出名字） | path |
| `FILE_NOT_FILE` | 全部门 | error | 该路径存在但不是普通文件 | path |
| `FILE_EMPTY` | 全部门 | error | 文件去空白后为空 | path |
| `PLACEHOLDER` | 全部门 | error | 行内出现未决标记（源文件 `PLACEHOLDERS` 常量收录的词） | path、line |
| `EMPTY_SECTION` | 全部门 | error | 二级及更深的标题没有正文 | path、line |
| `SECTION_MISSING` | 全部门 | error | 配置要求的章节标题不存在（大小写不敏感的子串匹配） | path |
| `FP_MISSING` | clarify | error | 需求文档未声明任何 `FP-n` | path |
| `FP_UNCOVERED` | test、accept | error | 需求的某个 FP 未在目标文档出现 | path |
| `FP_ORPHAN` | test | error | 用例里出现需求未声明的 FP | path |
| `TEST_CASE_EMPTY` | test | error | 用例文档未点名任何 FP | path |
| `CONTRACT_MISSING` | design | error | 设计里出现、契约里没有的端点 | path |
| `CONTRACT_UNDESIGNED` | design | error | 契约里出现、设计里没有的端点 | path |
| `VERDICT_SHORTFALL` | accept | error | 结论总数少于 FP 总数（聚合视图） | path |
| `VERDICT_MISSING` | accept | error | 某个已声明 FP 的所有窗口里都没有结论词 | path、line |
| `ACCEPT_EVIDENCE_MISSING` | accept | error | 某个 FP 有结论，但没有任何窗口带证据引用 | path、line |
| `P0_OPEN` | accept | error | 某行按 1.6.3 判为「仍有未关闭 P0」 | path、line |
| `REVIEW_ITEM_NO_VERDICT` | review、accept | error | 结论条数少于 `reviewMinVerdicts` | path |
| `REVIEW_EVIDENCE_MISSING` | review、accept | error | 某条结论所在窗口内没有任何证据引用 | path、line |
| `EVIDENCE_MISSING` | review、accept | error | 证据引用的文件不存在，或不是普通文件 | path、line（指向引用所在行） |
| `EVIDENCE_OUT_OF_RANGE` | review、accept | error | 引用行号小于 1 或大于文件总行数 | path、line（指向引用所在行） |
| `EVIDENCE_OUTSIDE_ROOT` | review、accept | error | 引用解算后落在 root 之外（含绝对路径引用与上跳穿越） | path、line（指向引用所在行） |
| `UI_ACCEPTANCE_WAIVED` | accept | **warning** | 界面产物被显式豁免，理由已给出（回填理由原文） | path（指向配置文件） |
| `UI_WAIVER_NO_REASON` | accept | error | 界面产物被豁免但没有理由 | path（指向配置文件） |
| `REWORK_BUDGET_EXHAUSTED` | `devflow_state` | error | 当前阶段的某个失败类型预算已耗尽，`advance` 被拒 | path（指向状态文件） |

### 1.5 severity 与 pass 规则

- **只有 `UI_ACCEPTANCE_WAIVED` 是 warning**，其余全部 error。新增 warning 必须在本表登记，不允许代码里临时造。
- `pass = 没有任何 error finding`。warning 不进计数、不阻断、不影响 `checked`。
- 门本身不抛「不通过」：不通过就是 `pass:false` + findings。**只有输入非法才抛错**：
  - `root` 不是绝对路径 / 不存在 / 不是目录；
  - `devflow.config.json` 不是 JSON 对象，或已知键类型非法（见 3.2）。
  抛错文本统一 `dsh-fullstack-team:` 前缀，并点名具体路径或键。
- findings 顺序对契约无约束（调用方不得依赖顺序），但同一次运行必须是确定性的（同一输入两次运行结果相同）。

### 1.6 判定细则（三条最容易被问的规则）

**1.6.1 端点识别（design 门）**

识别三个来源：内联代码（单反引号包裹的整串）、标题行（`#` 到 `######` 标题的正文）、Markdown 表格行。

- 表格行：按未转义的竖线切单元格并剥外壳（反引号、加粗标记、空白）；方法单元格为纯方法词、另一单元格为斜杠开头的路径时，组装成一个端点；单单元格同时含方法与路径时直接解析。
- 表头与分隔行不产生端点（不满足「斜杠开头」）。
- 表格扫描跳过围栏代码块（成对三个反引号或三个波浪号）；内联代码与标题扫描不跳过。
- 归一化四步：截掉问号及其后的查询串、截掉井号及其后的片段、去掉尾部斜杠、方法统一大写。
- 路径必须斜杠开头，否则不是端点（普通词、命令、字段名都不算）。
- **不算端点的文本**：路径中出现空白、`<`、`>`、`*`、`^`、`$` 或 `\`，以及归一后为裸 `/`（去尾斜杠不再为长度 1 保留）。这条把散文（`/must be absolute/`）、占位符（`/orders/<id>`）、通配（`/api/*`）、正则字面量（`/^\/v1$/`）与文件系统根 `/` 一律排除；由正常路径段组成的真实路由（含路径参数、查询串、尾斜杠的写法）不受影响。本条只描述判据，不在契约里列举真实路由样例。
- 比较语义：路径相等即同一端点；任一侧没有方法时视为通配；两侧都有方法时必须相同。
- 设计端只做「集合差」：设计有契约无 → `CONTRACT_MISSING`；契约有设计无 → `CONTRACT_UNDESIGNED`。

**1.6.2 证据与窗口（review 门、accept 门）**

- 证据形态：`路径:行号`，路径按 `/` 分隔、可含目录，行号为正整数（例：`src/a.ts:12`）。
- 窗口：某行与其后紧邻的一行。结论可以同行挂证据，也可以写在下一行。
- review 门：**每一行带结论词的行**都必须在自己的窗口里有至少一条证据引用；证据是否可解析另由 `EVIDENCE_*` 判定（有引用但文件不在 → 只出 `EVIDENCE_MISSING`，不再出 `REVIEW_EVIDENCE_MISSING`）。
- accept 门：对每个已声明 FP，检查它所有出现位置的窗口；任一窗口同时有结论词与证据引用即视为满足。全部窗口都没有结论词 → `VERDICT_MISSING`；有结论但都没有证据 → `ACCEPT_EVIDENCE_MISSING`。
- 引用解析：解算后必须仍在 root 内（root 自身算在内）；解算越界 → `EVIDENCE_OUTSIDE_ROOT`，且**不读取**该路径。文件存在但不是普通文件 → `EVIDENCE_MISSING`。行号从 1 起算，超过文件总行数（按换行切分计数）→ `EVIDENCE_OUT_OF_RANGE`。
- 协议前缀与主机端口形态（带协议、带端口的网址式引用）不当作证据引用，不产生 finding。

**1.6.3 P0 识别（accept 门）**

按行判定，四步：① 不含 P0 词（大小写不敏感的独立词）→ 不是 P0 报告；② 有关闭词且无开启词 → 已关闭；③ 有开启词 → 看数字，数字全为 0 或没有状态词之外的数字 → 已关闭，任一数字大于 0 → 未关闭；④ 无开启词但 P0 之后 12 个字符内出现大于 0 的数字 → 未关闭。

| 该行文本 | 判定 |
|---|---|
| `P0 遗留：0` | 已关闭 |
| `P0 未关闭：2` | 未关闭 |
| `P0 剩余 2 项` | 未关闭 |
| `blocking P0: 1` | 未关闭 |
| `P0 已关闭：3` | 已关闭 |
| `P0：0` | 已关闭 |
| `本轮无 P0` | 已关闭 |
| `P0 2` | 未关闭 |
| `P1 遗留 3 条` | 不适用（不是 P0 行） |
| `P0 已于 1.2 修复` | 已关闭 |

开启词与关闭词是有限集合（中英文各若干），以源码常量为准；集合扩充不算契约破坏，**缩减或语义反转算**。

## 2. `devflow_state`

读写一条需求的持久流程状态，并在推进前重跑当前阶段的门。状态落在需求目录内，因此重启、压缩、换会话都不会丢。

### 2.1 入参

| 参数 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `action` | 枚举 | 是 | `read` \| `advance` \| `rework` \| `reset` |
| `root` | string | 是 | 需求目录的绝对路径；相对路径被拒绝 |
| `failure` | 枚举 | `rework` 必填 | 6 个失败类型，见 2.4 |
| `note` | string | 否 | 记入历史事件的自由文本 |

### 2.2 出参

| 字段 | 类型 | 语义 |
|---|---|---|
| `stage` | 枚举 | 动作完成后的阶段（`clarify`/`design`/`build`/`test`/`accept`/`ship`） |
| `advanced` | boolean | 是否真的换了阶段；只有 `advance` 成功时为真 |
| `pass` | boolean | 该动作是否被允许/成功；`advance` 被门或预算拒绝时为假 |
| `message` | string | 一行给人看的话；耗尽、拒绝、终点都在这里说清 |
| `findings` | array | 结构同 1.2；`advance` 被拒时带门的 findings 或预算耗尽码 |
| `rework` | 对象 | 可选；`{type,count,budget,exhausted}`，`rework` 动作必带 |

`advanced:false` + `pass:true` = 已到最后一个阶段（无门可走，也不算失败）。
`advanced:false` + `pass:false` = 被拒（门不过，或预算耗尽）；靠 findings 里的 code 区分这两种拒绝。

### 2.3 action 语义

| action | 读 | 写 | 拒绝/失败 | 副作用 |
|---|---|---|---|---|
| `read` | 状态文件（不存在则视为初始态，不写盘） | 无 | 状态文件损坏 → 抛错 | 无 |
| `advance` | 状态 + 当前阶段的产物 | 成功时写新阶段、清零计数、追加 advance 事件 | 门不过 → `pass:false` + 门 findings；预算耗尽 → `pass:false` + `REWORK_BUDGET_EXHAUSTED`；已在终点 → `pass:true` + `advanced:false` | 只有成功才落盘 |
| `rework` | 状态 | 计数 +1、追加 rework 事件 | 缺 `failure` → 抛错；跨阶段计数不一致时先归零 | 计数可超预算（保留事实），`exhausted` 置真 |
| `reset` | 无（不读旧文件，因此坏文件也能救） | 覆盖为初始态 | 无 | 清空计数与历史，回到 `clarify` |

### 2.4 rework 预算表与耗尽行为

预算按**阶段**重置：进入新阶段时全部归零，历史留在 `history` 里（每条 rework 事件都带当时阶段）。

| 失败类型 | 预算 | 检测者（只给事实） | 回边去向（主 PM 裁决） |
|---|---|---|---|
| `DESIGN_UNFEASIBLE` | 2 | 开发：报不可实现的位置与理由 | 回设计改方案，或打回开发 |
| `CONTRACT_GAP` | 3 | 开发：缺哪个端点或字段 | 回设计补契约 |
| `CONTRACT_CONFLICT` | 1 | 测试：两端行为差异实证 | 主 PM 判契约是否有歧义，再不行上报 |
| `IMPL_MISMATCH` | 3 | 门禁：清单逐条对比结果 | 回开发；一次打回、二次拆小、三次上报 |
| `TEST_FAIL` | 3 | 测试：用例失败 + 归因事实 | 回开发或回测试 |
| `ACCEPT_P0` | 3 | 主 PM 亲验 | 回开发 + 补用例；三次后上报 |

耗尽行为三步：

1. `rework` 使计数达到预算时，返回 `exhausted:true`，`message` 明确要求上报，不再提示「还剩几次」。
2. 此后同阶段内 `advance` **一律拒绝**（即使门已经通过），`findings` 只带 `REWORK_BUDGET_EXHAUSTED`，状态文件不落盘。
3. 唯一机械出口是 `reset`（回 `clarify`、清空计数与历史）；人干预也可以直接改状态文件。`reset` 不是「绕过门的工具」，不允许用它换一个阶段。

预算数值变更（改数字）算契约变更；失败类型增删算破坏性变更（见 §5）。

### 2.5 `state.json` 结构与迁移

路径固定为 `<root>/.dsh/devflow/state.json`。

```json
{
  "version": 2,
  "stage": "test",
  "reworkStage": "test",
  "rework": {
    "DESIGN_UNFEASIBLE": 0,
    "CONTRACT_GAP": 0,
    "CONTRACT_CONFLICT": 0,
    "IMPL_MISMATCH": 1,
    "TEST_FAIL": 0,
    "ACCEPT_P0": 0
  },
  "history": [
    {
      "at": "2026-11-04T09:00:00.000Z",
      "action": "rework",
      "stage": "test",
      "failure": "IMPL_MISMATCH",
      "note": "用例 3 失败"
    }
  ]
}
```

| 字段 | 类型 | 语义 |
|---|---|---|
| `version` | 整数 | 结构版本，本版为 2 |
| `stage` | 枚举 | 当前阶段，6 值之一 |
| `reworkStage` | 枚举 | 计数器所属阶段；正常等于 `stage` |
| `rework` | 对象 | 6 个失败类型到计数的映射；缺失键按 0 补齐 |
| `history` | 数组 | 追加式事件流：`action` 为 `advance`/`rework`/`reset`，`to`、`failure`、`note` 均按需出现 |

迁移规则：

| 读到的形态 | 处理 |
|---|---|
| 文件不存在 | 视为初始态（`stage:clarify`），不写盘，`created` 为真 |
| `version:1`、无 `reworkStage` | 可读：计数归到当前 `stage`（不丢已耗预算）；下次写盘升为 2 |
| `version:2` | 原样读写 |
| JSON 非法、非对象、`stage` 不在枚举内 | **抛错**，不重置；错误文本给修复建议（手改 / 删文件 / `reset`） |
| 其它字段缺失或类型不对 | 读时补默认（`rework` 补零、`history` 补空数组），写时补齐 |

## 3. `devflow.config.json`

项目结构唯一的入口：产物改名、必需章节、评审条数下限、界面是否适用。门禁代码里不写任何项目事实，全部从这里来。

### 3.1 全键位与默认值

文件位置：`<root>/devflow.config.json`。全部键可选，缺文件等价于全默认。

| 键 | 类型 | 默认 | 读取者 | 语义 |
|---|---|---|---|---|
| `files` | 对象（产物键 → 文件名） | 见下表 | 全部门 | 产物改名，相对 root |
| `requirementSections` | 字符串数组 | 空 | clarify（test/accept 读需求时不查章节） | 需求文档必需章节 |
| `designSections` | 字符串数组 | 空 | design | 设计文档必需章节 |
| `testCaseSections` | 字符串数组 | 空 | test | 用例文档必需章节 |
| `testReportSections` | 字符串数组 | 空 | test | 执行报告必需章节 |
| `acceptanceSections` | 字符串数组 | 空 | accept | 验收报告必需章节 |
| `uiAcceptanceSections` | 字符串数组 | 空 | accept | 界面验收报告必需章节（未被豁免时） |
| `reviewMinVerdicts` | 整数 | 30 | review（含 accept 内组合） | 结论条数下限；完整清单 115 条由人/技能执行，机检只保底 30 条 |
| `ui` | 对象 | `{ "applicable": true }` | accept | 界面验收是否适用 |
| `ui.applicable` | 布尔 | true | accept | 为假表示纯后端项目，显式豁免 |
| `ui.reason` | 字符串 | 空 | accept | 豁免理由；`applicable:false` 时必须非空 |

`files` 的产物键与默认文件名：

| 产物键 | 默认文件名 |
|---|---|
| `requirement` | `requirement.md` |
| `assessment` | `assessment.md` |
| `design` | `design.md` |
| `contract` | `api-contract.md` |
| `testcases` | `test-cases.md` |
| `testreport` | `test-report.md` |
| `review` | `review-notes.md` |
| `acceptance` | `acceptance-report.md` |
| `uiacceptance` | `ui-acceptance.md` |

### 3.2 校验与错误

- 文件存在但不是 JSON 对象 → 抛错（`dsh-fullstack-team:` 前缀，点名文件）。
- 已知键类型非法 → 抛错并点名键：`files` 必须是对象、各 `*Sections` 必须是字符串数组、`reviewMinVerdicts` 必须是整数、`ui` 必须是对象且 `applicable` 为布尔、`reason` 为字符串。
- 未知键**忽略**（前向兼容）；拼错的键等于没配，不会报错——这是已接受的取舍。
- 章节匹配用大小写不敏感的子串包含，与源文件里是否带序号无关。

### 3.3 纯后端项目的标准写法

```json
{
  "ui": { "applicable": false, "reason": "纯后端项目，无界面变更（本需求 FP-01~FP-10）" }
}
```

写了这一条，accept 门不读界面产物，但每次 accept 都会在 findings 里回一条 warning，避免豁免记录被遗忘。

## 4. 技能 provider 契约

插件向宿主技能注册表贡献一个 provider：内置技能随包走，pack 技能随角色走。候选结构与路径语义是契约的一部分，因为模型读到的技能正文由它决定。

### 4.1 provider 标识与注册

- 每个插件实例注册一个 provider，名字取配置 `providerName`，默认 `dsh-fullstack-team`。
- 一个 profile 里可以有多个实例（全局行 + 各预设行）；宿主的技能合并按名字逐层覆盖，见 4.7。
- 插件不注册技能目录、不写 profile、不改用户仓库。

### 4.2 `list` 与 `get`

| 方法 | 契约 |
|---|---|
| `list()` | 返回候选数组：内置技能 + 每个已声明且已就绪的 pack 里的技能；按名字升序；重名直接报错，不做「后到覆盖」 |
| `get(candidate, {signal})` | 读候选的 `locator` 文本，解析 frontmatter，返回候选摘要（去掉 `rank` 与 `locator`）+ `content`（见 4.5 的路径改写）；`signal` 透传给文件读取 |

`get` 的失败语义：文件读不到、frontmatter 缺失、`name` 不合规、`description` 为空 → 抛错（不返回空内容、不静默退化成标题）。

### 4.3 候选字段

| 字段 | 类型 | 语义 |
|---|---|---|
| `name` | string | 技能名，kebab-case，同时是 frontmatter 的 `name` |
| `description` | string | 触发文本，来自 frontmatter |
| `invocation` | 对象 | 固定 `{modelInvocable:true,userInvocable:true}` |
| `provider` | string | 本实例的 `providerName` |
| `source` | string | 目前恒为 `bundled`（pack 技能也标这个值，属已知限制，见 §5） |
| `rank` | number | bundled 等级（pack 技能同等级） |
| `resourceBase` | 对象 | `{kind:'directory', path:'<技能自身目录，绝对且以 / 归一>'}` |
| `locator` | string | 该技能 `SKILL.md` 的绝对路径 |
| `metadata` | 对象 | 可选；frontmatter 里 `name`/`description` 之外的键 |

候选结构由宿主消费，**不允许扩展自定义字段**（额外字段可能被宿主校验拒绝）。

### 4.4 `resourceBase` 语义

- 指向**技能自身所在目录**，不是包根、不是 skills 根。
- 绝对路径，分隔符统一为 `/`（Windows 也归一）。
- 它是两件事的唯一事实来源：宿主渲染「技能资源在哪」的提示，以及本插件改写技能正文里的自引用路径。
- 内置与 pack 技能同一语义，不因来源不同而不同。

### 4.5 路径改写（rebase）规则

> 修订 2026-11-04（实现期）：前缀由三种扩为四种，新增裸 `scripts/` 有守卫改写；由主 PM 批准，实现见 `src/catalog.ts:104-166`、`src/index.ts:149-187`。

- 触发点：`get` 返回前。
- 改写对象：技能正文里的四种自引用前缀——`.agent/skills/`、`.agents/skills/`、`.dsh/skills/`、`.claude/skills/`。
- 规则：把 `前缀 + 技能名 + 斜杠` 精确替换为 `resourceBase 的父目录 + 斜杠 + 技能名 + 斜杠`。
- 裸 `scripts/` 改写：仅当该技能目录下**确实存在** `scripts/` 时，才把 `scripts/` 改写为 `resourceBase 的父目录 + 斜杠 + 技能名 + 斜杠 + scripts/`。守卫是刻意的——`role-init` 的 `node scripts/roles.mjs` 指包根、`taste` 的脚本在 `subskills/…/scripts/`，无条件改写会造出不存在的路径。
- 结果：内置技能的引用落到包内 `skills/<name>/`；pack 技能的引用落到该 pack 目录下 `<name>/`。
- 只做字符串替换：不复制文件、不写盘、不改源 `SKILL.md`；大小写敏感；不处理 URL 与其它前缀。
- 幂等：改写后的文本不再含被替换的原始串，二次改写无变化（只有当目标路径本身恰好包含某前缀时例外，属已知边界）。

### 4.6 pack 装载与白名单失败语义

声明位置：预设里本插件条目的 `config.packs[]`，每项 `{name, dir, include?, exclude?, hint?}`。

`dir` 解析顺序：`~` → 家目录；`~/x` → 家目录下；其它 → 相对会话工作目录解析。

启动期四类失败（全部为**致命**错误，会话起不来）：

| 情形 | 错误文本必须包含 |
|---|---|
| pack 目录不存在 | 包名、期望的绝对目录、`hint`（若声明）、「装包或去掉这个角色」 |
| 该路径不是目录 | 同上，措辞改为「不是目录」 |
| 技能名与已广告的技能冲突 | 冲突的技能名、来源包名 |
| `include` 里的名字没有任何来源提供 | 缺失名单（全部列出）、provider 名、当前可见集合（排序后） |

白名单语义：

- 顶层 `include` 为空 = 内置技能全给；非空 = 只给列出的名字。校验在 pack 合并**之后**进行，因此 pack 提供的名字算「有来源」。
- 顶层 `include` 里的 `*` **不是通配符**：按字面名字处理，找不到即报缺失（`*` 只在 pack 的 `include` 里作「整包」语义）。
- pack 的 `include` 只作用于该 pack；`*` 表示「这个 pack 就是该角色的全部装备」，跳过顶层 `include` 的收窄。
- `exclude` 最后生效；同一名字同时出现在 `include` 与 `exclude` 时视为不可见（并因此判为缺失）。
- 离线预检：`node scripts/roles.mjs` 用同一套规则检查 `roles/*.role.yml`，缺名字时打印角色 id 与技能名并以退出码 1 结束，不写生成物。该命令依赖构建产物，必须在构建之后执行。

### 4.7 内置技能隔离语义（已定版：公共核心）

- 包的 bundle patch 保留**唯一一条全局条目**，不带 `include`/`exclude`，把内置技能广播给所有会话。
- 宿主按「全局层 → scope 链」逐层按技能名合并：预设只能遮蔽**同名**技能，**不能移除**其它技能。因此：
  - 预设里的 `include` 缩小的是该实例的视图；
  - 预设里的 `exclude` 对内置技能在会话可见集合层面**无效**；
  - 真正能按角色隔离的只有 pack 技能（pack 只被某个预设实例声明，其它会话不会装载它）。
- 结论：**内置技能 = 全员公共核心**。不允许用预设表达「只让某角色看见内置技能」，也不允许在角色 manifest 里写 `exclude`（生成器视为错误）。
- 这条是裁决，不是建议；改它等于改需求。

### 4.8 与宿主契约的边界

- 只导出 `apply` / `inject` / `Config` 与 `name`，不混用 default class。
- 不注册资源、不返回 cleanup（注册托管在宿主的 registry 层）。
- `Config` 只声明运行期真正读取的键（目前含 `providerName`、`include`、`exclude`、`tools`、`packs[]`（含 `name`/`dir`/`include`/`exclude`/`hint`））。
- 本插件不假设宿主的技能目录布局，也不写用户的 profile 文件。

## 5. 本批契约变更清单

| # | 变更 | 影响面 | 破坏性 | 迁移动作 |
|---|---|---|---|---|
| 1 | `devflow_gate.stage=accept` 的读取清单新增 `review-notes.md`、`ui-acceptance.md` | 全部使用 accept 的项目 | 是（旧的验收材料不足以过门） | 补产物，或按 3.3 显式豁免界面部分 |
| 2 | test 门新增 `test-report.md` | 全部经过 test 阶段的流程 | 是 | 产出执行报告，或用 `files` 改名 |
| 3 | review/accept 的结论必须挂 `路径:行号` | 评审与验收文档 | 是 | 在结论行或下一行补证据 |
| 4 | 新增 7 个 finding code（6 门内 + 1 状态） | 依赖 code 做分支的调用方 | 否（增量） | 无需动作；建议按 code 处理而非按文案 |
| 5 | `P0_OPEN` 识别面扩大 | 验收报告 | 是（过去放行的写法现在阻断） | 按 1.6.3 的样例表调整措辞 |
| 6 | `devflow_state.failure` 枚举 7 → 6（删除部署假绿类型） | 传该值的调用方 | 是 | 改记 `IMPL_MISMATCH` 或 `ACCEPT_P0`；发布假绿走 hotfix 旁路 |
| 7 | `state.json` 增 `reworkStage`、版本 2；预算按阶段重置 | 已有状态目录 | 向后兼容（v1 可读） | 无需动作，首次写盘自动升级 |
| 8 | 预算耗尽后 `advance` 被拒 | 自动化调用方 | 是（新增拒绝路径） | 按 `REWORK_BUDGET_EXHAUSTED` 上报；`reset` 重走 |
| 9 | `root` 必须绝对路径；证据不得越出 root | 传相对路径的调用方、含上跳引用的历史评审 | 是 | 改绝对路径；把证据改到 root 内 |
| 10 | `devflow.config.json` 已知键类型非法从「忽略」改为「抛错」 | 手写配置的项目 | 是（极小概率） | 修正类型 |
| 11 | 新增配置键 `testReportSections`、`uiAcceptanceSections`、`ui`、两个 `files` 键 | 项目配置 | 否（增量，全部可选） | 无需动作 |
| 12 | pack 技能的正文资源路径改按所属包目录 | pack 使用者 | 否（修复） | 无需动作 |
| 13 | `include` 里出现无来源的技能名 → 启动失败 | 手写预设 | 是 | 先跑离线预检并按错误串修正 |
| 14 | 内置技能语义写死为公共核心 | 文档与预设写法 | 否（语义澄清） | 不要再用 `exclude` 表达隔离 |

## 6. 本契约不承诺的事

- 不承诺 findings 的顺序、条数上限与文案措辞（只承诺 code 与 severity）。
- 不承诺跨进程并发写状态的行为（只承诺同一进程内串行、以及锁超时后明确报错）。
- 不承诺对宿主私有 API 的兼容；`inject` 的两个 registry 接口以宿主公开文档为准。
- 不承诺 pack 技能的 `source` 与 `rank` 会在本版内修正（见设计文档 §8 第 2、3 条）。
