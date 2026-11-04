# 项目开发规范 · dsh-fullstack-team

> 本仓是 DSH bundle（Host 插件）：一个插件行 + 随包技能 + 两个确定性工具 + 角色 manifest。
> 本文件是本仓的技术事实来源；流程规则见 `dev-orchestrator`，需求产物见 `docs/dev/<NNN>/`。

## 1. 项目定位与技术栈

| 项 | 值 |
|---|---|
| 形态 | DSH bundle（`dsh.bundle.patch` → `cordis.patch.yml`），Host-only，无 UI |
| 运行时 | Node.js `^22.19.0 \|\| >=24`；DSH `^0.2.1-rc.5` |
| 语言 | TypeScript（ESM，`type: module`），NodeNext 解析 |
| 构建 | `tsdown` → `lib/index.js`、`lib/roles.js` |
| 测试 | `vitest`（`tests/**/*.spec.ts`） |
| 依赖 | 运行期只有 `yaml`；`@deepseek-ai/*` 为 peer |

## 2. 目录结构与分层

```
src/
  index.ts        插件入口：apply / inject / Config，技能 provider，pack 装载
  catalog.ts      SKILL.md 发现与校验、资源路径 rebase
  roles.ts        角色 manifest 加载、detect 判定（roleMatches）、可行性计划、preset 渲染
  tools.ts        devflow_gate / devflow_state 的工具定义（薄壳）
  state.ts        持久状态：读写、advance、rework 预算
  gates/          纯函数门禁：artifact（文本不变量）、stages（四道阶段门 + review 附加检查）、types
skills/           随包发布的 Agent Skills（内置=全员公共核心）
roles/            角色 manifest（数据，非代码）
scripts/          roles.mjs（生成 preset）、skill-audit.mjs（体检）
presets/          生成物（勿手改）
templates/        preset 模板（上游 standard 的副本）
docs/dev/<NNN>/   需求产物
```

**分层铁律**：`gates/` 不读配置外的项目事实；`tools.ts` 只做 wire，不做判定；`index.ts` 只装配，不含业务规则；`roles/` 是数据，代码里不写死角色。

**detect 语义**：`roles/*.role.yml` 的 `detect` 是**组列表**——组内 AND、组间 OR，单个字符串即单元素组（如 `backend-java` 的 `pom.xml`/`build.gradle`/`build.gradle.kts` 是三选一，`frontend-vue` 的 `[package.json, vite.config.ts]` 要求同时存在）。core 恒装。判定由 `src/roles.ts` 的 `roleMatches(role, markers)` 执行，`role-init` 的表格与此同一语义。

## 3. 命名与代码惯例

- 文件 kebab-case；导出 `apply` / `inject` / `Config`，不混用 default class。
- JSDoc 覆盖公开函数（`@param`/`@returns`/`@throws`），中文注释不进入导出符号名。
- 门禁函数是纯函数：入参（root、config）→ `GateResult`，不写文件、不抛业务错。
- 错误信息统一前缀 `dsh-fullstack-team:`，必须点名出问题的文件或包。
- 技能名 kebab-case（`^[a-z0-9]+(-[a-z0-9]+)*$`）；前端 frontmatter 只放 `name`/`description`。

## 4. 数据库规范

**本项目不适用**（无数据库、无 DDL/DML）。任何依赖数据库的流程（迁移、备份、只读账号）在本仓一律跳过，不写入规范。

## 5. 基础模板

### 5.1 Host 插件骨架

```ts
export const name = 'devflow'
export const inject = ['skills', 'tools']
export const Config = z.object({ /* ... */ })
export function apply(ctx: DevflowContext, config: DevflowConfig = {}): void { /* 注册 */ }
```

### 5.2 门禁函数骨架

```ts
export function someGate(root: string, config: GateConfig): GateResult {
  const findings: Finding[] = []
  // 只读产物、只产出 finding
  return { stage: 'design', pass: !findings.some(f => f.severity === 'error'), findings, checked }
}
```

## 6. 页面与交互标准

**本项目不适用**（无 UI；`impeccable`/`taste` 不挂本仓开发角色）。若将来引入 Web 面板，按 `ui-theme-governance` 补本节。

## 7. 命令

```bash
pnpm install
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run
pnpm build            # tsdown
pnpm check            # typecheck + test + build（提交前必跑）
node scripts/roles.mjs [--write] [--out <path>]
node scripts/skill-audit.mjs skills
```

**本地联调**：desktop profile 以 `link:` 指向本仓，改 `src/` 后需 `pnpm build` 并重启 GUI；技能与角色变更需重新生成 preset 并合并 profile。

## 8. 专项验证与审查清单

### 8.1 宿主插件规范（每次发布前逐条）

> 这 12 条清单是官方 `cordis-plugin-development` 能力的**宿主侧等价物**：该技能随宿主安装包提供，本包的 `include` 只能引用本包 provider 的技能，引用不到它（硬写会按 FP-02 启动失败）。因此 `dsh-plugin-dev` 角色以文档声明该依赖，环境提供时加载、不提供时按本清单执行。

1. `exports` 含 `.`、`./locale/*.json`、`./icon`；`files` 含 `lib`、`skills`、`locale/*.json`、`icon.svg`、`cordis.patch.yml`。
2. `locale/en.json`、`locale/zh.json` 均有 `meta.title`/`meta.description`，且与交付内容一致。
3. `icon.svg` 为有效图片、≤256 KiB、位于包内。
4. `dsh.bundle.patch` 指向存在的 patch；`manifestVersion: 1`。
5. `engines.dsh` 与运行版本一致；peer 依赖在安装形态下可解析。
6. 安装走 `plugin_manager` `install_bundle`，不手写 profile、不在 profile 目录跑 pnpm。
7. 打包后 `npm pack` 列表核对：无缺文件、无测试夹带。

### 8.2 本仓追加规则

8. `pnpm check` 全绿；新增门禁行为必须有对应用例。
9. 技能里不出现项目事实（公司名/仓名/表名/地址/账号）；脚本同理。体检脚本的项目规则由工作区根 `project-facts.json` 提供（通用规则不依赖配置），配置格式见 `scripts/skill-audit.mjs` 头部注释。
10. 改变门禁语义必须同步 `docs/003-tools.md`，并在 README 标注行为变化。
11. 生成物（`presets/roles.patch.yml`、`lib/`）不手改；`lib/` 不入库。
12. 角色 include 里的每个技能必须真实存在（生成时校验）。
13. 设计与契约文档里**不要写真实路由字面量**（`/api/orders` 这类）：它会被端点集合比对当作契约声明，两侧不同步即报 `CONTRACT_MISSING`/`CONTRACT_UNDESIGNED`。举例用判据描述或 `<resource>` 占位，围栏代码块不豁免。

## 9. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-04 | 首建：批零（角色与自举） |
