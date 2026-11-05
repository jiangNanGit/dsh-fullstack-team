# 002 · detect 通配与度量落盘

> 状态：**已冻结**（2026-11-05）。
> 来源：001 收口后的缺口盘点（`docs/001-design.md` §9 P4 未实现；`detect` 与文档不一致）。
> 边界：只动插件层（本仓）。不碰宿主层（不重启、不改 profile 之外的宿主文件）、不碰业务项目层。

## 1. 原文与依据

1. `skills/role-init/SKILL.md:17` 写 `package.json` + `vite.config.*`，而 `roles/frontend-vue.role.yml:7` 写死 `vite.config.ts`——文档承诺通配，代码只认一个文件名。
2. `docs/001-design.md:346` P4「度量：门禁命中率、打回次数、失败类型分布」标注**未实现**：没有任何计数落盘，事后只能翻 `state.json` 的 history 手工数。

## 2. 功能点

| FP | 内容 | 落点 | 验收标准 |
|---|---|---|---|
| FP-01 | `detect` 标记支持后缀通配 `name.*`：命中「同名任意扩展名」；其它写法保持精确匹配 | `src/roles.ts`、`roles/frontend-vue.role.yml`、`skills/role-init/SKILL.md` | 只有 `vite.config.js`（无 `.ts`）的仓能命中 `frontend-vue`；只有 `package.json` 仍不命中；生成物同步 |
| FP-02 | 度量落盘：状态里记录被门禁拒绝的事件与失败类型，可读出一份统计 | `src/state.ts`、`src/tools.ts`、`docs/003-tools.md` | `devflow_state` 能读到 `metrics`：`advanceBlocked`（按阶段）、`rework`（按失败类型）、`codes`（按 finding code 计数）；旧 state 文件仍可读 |

## 3. 不做

- 不做趋势图/报表导出；只做可读的计数结构。
- 不改 gate 判定逻辑，只记录被拒的结果。
- 不做远端 CI（需要用户授权 push）。

## 4. 冲突与裁决

| # | 冲突 | 裁决 |
|---|---|---|
| C1 | 通配支持放 `detect` 还是放扫描层（先展开扩展名） | 放 `detect`：`roleMatches` 是唯一判定点，扫描层只提供名字集合 |
| C2 | 度量存 state 文件还是单独文件 | 存 state：已有 `history` 与写锁，单独文件要再造一套并发控制 |
| C3 | 旧 state 没有新字段 | 读取时补默认值，不迁移版本号（仍是 v2） |

## 5. FP 与验证对应

| FP | 验证 |
|---|---|
| FP-01 | 单测：`vite.config.js`/`vite.config.mts` 命中、`vite.config.ts` 命中、仅 `package.json` 不命中；`/tmp` 造仓实跑 `roles.mjs` |
| FP-02 | 单测：制造一次 `advance` 失败 → 读到 `metrics.advanceBlocked`；`rework` 一次 → `metrics.rework` 计数 +1；旧 state（无 metrics 字段）读取不报错 |
