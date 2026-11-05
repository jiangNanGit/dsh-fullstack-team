# 002 · 设计（detect 通配与度量落盘）

> 依据：`requirement.md`（已冻结，2 个功能点）。本设计只描述**已经确定要做的两件事**，不扩范围。

## 1. 目标与不变量

| 项 | 内容 |
|---|---|
| 目标 | ① `detect` 的标记写法与文档承诺一致（`vite.config.*` 真的能命中任意扩展名）；② 门禁拒绝与返工被计数落盘，能回答「打回几次、失败类型怎么分布」 |
| 不变量 | 门禁判定逻辑一行不改；`state.json` 版本仍为 2；旧状态文件读取不得报错；预设生成物不含 `detect`，字节不变 |

## 2. FP-01：`detect` 后缀通配

### 2.1 语法

标记是字符串。**仅当**以 `.*` 结尾时按通配处理，否则精确匹配。

| 写法 | 语义 | 例子 |
|---|---|---|
| `pom.xml` | 精确 | 只有 `pom.xml` 命中 |
| `package.json` | 精确（**不是**通配） | `package.yaml`、`package.json.bak` 都不命中 |
| `vite.config.*` | 后缀通配 | `vite.config.js`、`vite.config.mts`、`vite.config.ts` 命中 |

### 2.2 判定规则

命中通配标记的条件：工作区顶层条目里存在一个名字，满足

1. 名字以「去掉末尾 `*` 的前缀」开头（前缀含末尾的点，即 `vite.config.`）；
2. 名字比前缀更长（后缀非空）。

两条推论写进了单测：

- `vitest.config.ts` **不**命中 `vite.config.*`——前缀必须完整，`vite.` 不等于 `vitest.`；
- `vite.config` 与 `vite.config.` **不**命中——后缀必须非空。

### 2.3 为什么不做通用 glob

不做 `*` 出现在中间、`?`、字符类、递归 `**` 这些写法。理由：

1. 只在仓库顶层扫描一次，嵌套模式本来就用不上；
2. 通用 glob 要引入匹配器与转义规则，出错面比收益大；
3. 现在的真需求只有「同一配置文件的不同扩展名」这一种。

要扩的时候再扩，别提前造一个半吊子匹配器。

### 2.4 角色数据变化

`frontend-vue` 的组从 `[package.json, vite.config.ts]` 变为 `[package.json, vite.config.*]`，仍是**同组 AND**：`package.json` 与任一 `vite.config.<ext>` 同时存在才命中。

## 3. FP-02：度量落盘

### 3.1 数据结构

`FlowState.metrics` 三张计数表：

| 键 | 含义 | 键的集合 |
|---|---|---|
| `advanceBlocked` | 某阶段的 `advance` 被拒次数 | 固定六个阶段，零填充 |
| `rework` | 按失败类型的返工次数 | 固定六种失败类型，零填充 |
| `codes` | 按 finding code 的拒绝原因分布 | 从空开始，只增 |

零填充是有意为之：读出来的形状稳定，调用方不用处理「键不存在」。

### 3.2 写入点

| 事件 | 是否计数 | 说明 |
|---|---|---|
| `advance` 门禁不通过 | 计 | 阶段 +1，该次 findings 的 code 逐个累加 |
| `advance` 因预算耗尽被拒 | 计 | 同上，且带 `REWORK_BUDGET_EXHAUSTED` |
| `advance` 成功 | 不计 | 成功不是拒绝 |
| `rework` | 计 | 对应失败类型 +1 |
| `reset` | **保留** | 打回是既成事实，重置流程不该抹掉观测数据 |

计数与 `history`、`stage`、`rework` **同一次落盘**（同一个写锁、同一次 `writeState`），不允许分两次写——否则中途崩溃会出现「历史有、计数没有」的账实不符。

### 3.3 只统计 error

`codes` 只累加 `severity !== 'warning'` 的 finding。原因很实在：`UI_ACCEPTANCE_WAIVED` 每次 accept 必出，如果 warning 也计入，`codes` 里会永久挂一条噪声，命中率就没法看了。

### 3.4 兼容

旧 `state.json` 没有 `metrics` 字段：读取时补零值结构，**不升版本号、不做迁移脚本**。补出来的零值在下一次写盘时自然落盘。

## 4. 工具契约

`devflow_state` 的 `action` 枚举新增 `metrics`，语义是**纯读**：不推进阶段、不改状态、不创建文件（状态不存在时返回零结构）。

入参与其它 action 一致：`{ action: "metrics", root }`。输出在通用字段之外带 `reworkStage` 与 `metrics`。详细 I/O 见 `api-contract.md`。

## 5. 落点对照

| FP | 文件 | 具体位置 |
|---|---|---|
| FP-01 | `src/roles.ts` | `roleMatches` 的标记匹配改为 `markerMatches` |
| FP-01 | `roles/frontend-vue.role.yml` | 组内第二个标记改 `.*` |
| FP-01 | `skills/role-init/SKILL.md`、`docs/dev/project-standard.md` | 语义说明同步 |
| FP-02 | `src/state.ts` | `Metrics` 结构、补零、`recordRefusal`、`bump`、写入点 |
| FP-02 | `src/tools.ts` | `action` 枚举与 `metrics` 输出、工具描述 |
| FP-02 | `docs/003-tools.md` | `metrics` 的 I/O 与语义 |

## 6. 未列入本需求的发现

1. `role-init` 的「市场安装 / 全网检索」两级没有对应工具，靠人和技能执行——本需求不碰。
2. `metrics` 目前只有计数，没有时间维度（何时被拒）。要做趋势图得加时间戳，属下一步。
3. `codes` 只按 code 聚合，不区分阶段与 code 的组合分布。

## 7. 测试概览

| 面 | 用例 |
|---|---|
| 通配 | 四个扩展名命中、同组 AND 仍成立、`vitest.config.ts` 不误判、普通带点文件名不当通配、空后缀不命中 |
| 计数 | 门禁失败计数、跨阶段归因、rework 计数、旧状态补零、并发不丢更新、成功不计数 |
| 工具 | `metrics` 纯读、状态不存在不建文件、输出形状 |
