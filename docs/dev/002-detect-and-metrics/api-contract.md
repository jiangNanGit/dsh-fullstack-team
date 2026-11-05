# 002 · 接口契约

> 只有两处对外契约发生变化：`devflow_state` 新增 `metrics` 动作，`detect` 新增 `.*` 通配写法。
> 本需求不引入任何网络接口，路径类字面量一律不写。

## 1. `devflow_state` 工具

### 1.1 入参

```ts
{
  action: 'read' | 'metrics' | 'advance' | 'rework' | 'reset'
  root: string                 // 需求目录绝对路径
  note?: string                // advance 用
  failure?: FailureType        // rework 必填
}
```

`metrics` 只读 `root`，不需要其它参数。

### 1.2 出参（各动作共有字段）

```ts
{
  stage: Stage                 // 当前阶段
  advanced: boolean            // 本次是否推进了阶段
  pass: boolean                // 本次动作是否成功
  message: string              // 人类可读摘要
  findings: Finding[]          // 门禁发现
}
```

### 1.3 `metrics` 的附加字段

```ts
{
  reworkStage: Stage           // 返工计数当前归属的阶段
  metrics: {
    advanceBlocked: Record<Stage, number>        // 六阶段零填充
    rework: Record<FailureType, number>          // 六类型零填充
    codes: Record<string, number>                // 从空开始，只增
  }
}
```

| 规则 | 内容 |
|---|---|
| 纯读 | 不推进阶段、不写状态、不创建状态文件 |
| 状态不存在 | 返回零结构，`stage` 为 `clarify` |
| 旧状态缺字段 | 读取时补零，出参与新状态同形 |

### 1.4 计数语义（对外可依赖）

| 事件 | `advanceBlocked` | `codes` | `rework` |
|---|---|---|---|
| `advance` 门禁不通过 | 当前阶段 +1 | 该次 findings 的 `code` 各 +1（仅非 warning） | 不变 |
| `advance` 预算耗尽被拒 | 当前阶段 +1 | 追加 `REWORK_BUDGET_EXHAUSTED` | 不变 |
| `advance` 成功 | 不变 | 不变 | 不变 |
| `rework(failure)` | 不变 | 不变 | 该失败类型 +1 |
| `reset` | 保留 | 保留 | 保留 |

## 2. 状态文件

```ts
{
  version: 2
  stage: Stage
  reworkStage: Stage
  rework: Record<FailureType, number>
  metrics: {
    advanceBlocked: Record<Stage, number>
    rework: Record<FailureType, number>
    codes: Record<string, number>
  }
  history: HistoryEntry[]
}
```

- `metrics` 在类型上必填，磁盘上可缺；缺省按零结构补。
- 版本号**不因本次变化而升级**：新增可选字段不构成不兼容变更。

## 3. `detect` 标记写法（角色数据契约）

| 写法 | 判定 | 示例 |
|---|---|---|
| 普通字符串 | 顶层条目名**全等** | `package.json` |
| 以 `.*` 结尾 | 顶层条目名以「去掉末尾星号的前缀」开头，且长度大于该前缀 | `vite.config.*` |

约束：

1. 只有末尾是 `.*` 才按通配处理；星号出现在别处没有特殊含义，按普通字符全等比较。
2. 前缀包含末尾的点，`vitest.config.ts` 不命中 `vite.config.*`。
3. 后缀不可为空：`vite.config.` 不命中。
4. 角色命中仍是「组内 AND、组间 OR」：通配只改变单个标记的判定，不改变组合逻辑。

## 4. 兼容与错误

| 场景 | 行为 |
|---|---|
| 旧状态文件无 `metrics` | 正常读取，补零结构，下次写盘带上 |
| 状态文件损坏 | 维持既有行为：报错、**不自动修复** |
| `metrics` 动作在无状态目录执行 | 返回零结构，不创建文件 |
| `detect` 里出现非法通配（星号非末尾） | 按普通字符全等处理，不报错 |

## 5. 不变量

1. 门禁判定结果不因 `metrics` 而改变（只记录，不参与判定）。
2. `metrics` 不影响 `advance` 是否被允许。
3. 预设生成物不含 `detect`，本次改动不改变生成物字节。
