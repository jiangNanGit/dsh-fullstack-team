# 001 · 测试用例台账（test-cases）

| 项 | 值 |
|---|---|
| 需求编号 | 001（`requirement.md` 已冻结） |
| 批次 | 批二 · 机制（TC-01 ~ TC-116）＋ 批三补录 · 装配/分发/规范（TC-117 ~ TC-156） |
| 覆盖功能点 | FP-01 ~ FP-29（29 个；批二 14 个 + 批三 15 个） |
| 依据 | `requirement.md` §7 验收标准；`design.md` §3、§9；`api-contract.md` §1~§4；批三追加 `execution-plan.md` 验收口径 |
| 用例总数 | 156（TC-01 ~ TC-156；批二 116 + 批三 40） |
| 执行者 | 开发（自测）/ qa（用例落地与执行报告） |
| 状态 | 台账定版（覆盖 29/29）；执行结果见 `test-report.md` |

> 本台账只回答三件事：怎么复现、期望哪些精确的 code/字段、验收报告引用哪条 `路径:行号`。
> 判定口径固定为 `api-contract.md` §1.5：`pass` ⇔ findings 中没有 `severity:'error'`；`warning` 不阻断、不进计数。

## 0. 执行约定

本节固定环境、fixture、证据回填与判定口径；执行者按本节构造用例，不再各自约定。

### 0.1 环境与命令

- 工作目录 = 仓库根（含 `package.json`、`src/`、`tests/`）。
- 单测与集成：`pnpm vitest run tests/<spec>.ts`，直接执行 TypeScript 源码，不需要先 build。
- CLI / E2E：先 `pnpm build`（`scripts/roles.mjs` 从 `../lib/roles.js` 导入），再执行 `node ...` 命令。
- 每批收口：`pnpm check`（`typecheck` + `test` + `build`）。
- 所有 `root` 一律显式构造为绝对路径（`mkdtempSync` 产出的路径本身就是绝对路径）；相对路径用例单独用 `.` 触发报错。
- 临时目录在 `afterEach` 用 `rmSync(recursive:true, force:true)` 清理，不留在仓库内。

### 0.2 fixture 构造

在 `tests/gates.spec.ts` / `tests/state.spec.ts` / `tests/packs.spec.ts` 已有 helper 的基础上复用下面的最小 helper（若目标 spec 里已有同名 helper，直接用已有的，不要重复定义）：

```ts
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const temporary: string[] = []

function workspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'tc-001-'))
  temporary.push(root)
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(root, relative)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, content, 'utf8')
  }
  return root
}
```

`apply()` 的 provider 捕获 helper 沿用 `tests/packs.spec.ts` 的 `register(config)`；`devflow_state` 工具调用 helper 沿用 `tests/tools.spec.ts` 的 `call(tool, args)`。

### 0.3 公共 fixture

下面四份内容在多条用例中复用，本台账统一叫这些名字。

> REQ_2（需求，2 个功能点）
>
> # 需求
>
> ## 功能点
>
> - FP-01 创建订单
> - FP-02 取消订单

> TC_2（用例文档）
>
> # 用例
>
> ## FP-01 创建订单
>
> 正常创建、库存不足。
>
> ## FP-02 取消订单
>
> 正常取消、重复取消。

> REPORT_OK（执行报告）
>
> # 执行报告
>
> ## 结果
>
> 2 个用例通过。

> ACCEPT_OK（验收报告）
>
> # 验收
>
> ## FP-01 创建订单
>
> pass — 证据：src/a.ts:1
>
> ## FP-02 取消订单
>
> pass — 证据：src/a.ts:2
>
> ## P0
>
> P0 遗留：0

另外三个用代码生成，避免手抄 30 行：

```ts
// 30 条结论，每条同行带一条可解析证据
const REVIEW_OK = '# 审查\n\n' +
  Array.from({ length: 30 }, (_, i) => `- 条目 ${i + 1}：pass — 证据：src/a.ts:1`).join('\n') + '\n'

// 只有结论、没有证据
const REVIEW_BARE = '# 审查\n\n' +
  Array.from({ length: 30 }, (_, i) => `- 条目 ${i + 1}：通过`).join('\n') + '\n'

// 证据目标文件，至少 2 行（split 计行会多算末尾换行，2 行仍安全）
const SRC_A = 'export const a = 1\nexport const b = 2\n'
```

其余具名配置 fixture：

| 名字 | 内容 |
|---|---|
| `CONFIG_WAIVED` | `{"ui":{"applicable":false,"reason":"纯后端项目，无界面变更"}}` |
| `CONFIG_NO_REASON` | `{"ui":{"applicable":false}}` |
| `CONFIG_UI_TRUE` | `{"ui":{"applicable":true}}` |
| `UI_OK` | `# 界面验收` + 空行 + `## 首页` + 空行 + `空态与主按钮已核对。` |
| `STATE_V2(stage, counts, reworkStage)` | 见 `api-contract.md` §2.5 的完整形状；`counts` 未给的键填 0，`history` 缺省为 `[]` |

`ACCEPT_STAGE_OK` = `REQ_2` + `ACCEPT_OK` + `REVIEW_OK` + `UI_OK` + `src/a.ts`（`SRC_A`）。这是 accept 组合门的干净基线；下面每条 accept 用例只替换其中一个产物。

### 0.4 证据落点与回填规则

每条用例的「证据」给出两样东西：

1. **断言落点**：测试文件 + `it(...)` 标题。用例实现后把该 `it` 的起始行回填成 `tests/<spec>.ts:<行号>`，验收报告引用这个形态。
2. **生产锚点**：当前源码的 `路径:行号`，用于证明「测的是实现里的哪个函数」。函数名为准；批一/批二合并后行号会整体位移，回填时以函数名重新定位。

E2E 用例的额外证据是命令原文与退出码，写进 `test-report.md`（例如 `node scripts/roles.mjs --write` → exit 1）。

### 0.5 判定与编号约定

- 期望里的 finding `code` 必须逐字一致；`detail` 文案不承诺，但本台账要求 `detail` 出现的**关键词**是契约或设计明文（如 `reset`、`不是普通文件`、`上报`），只断言关键词，不断言整句。
- fixture 中的功能点编号一律写零填充形态 `FP-01`（与 `requirement.md` §7 同形）。`requirement.md` §7 的负例句用占位写法「FP-xx 通过」（不带数字，`FP_PATTERN` 不会把它算成已声明 id），因此台账里也不需要为它单独留一条 id；fixture 一律用零填充形态。
- 类型三分：**单测** = 单函数/单门；**集成** = 跨模块或工具边界；**E2E** = 起进程、读真实仓库或真实需求目录。
- 标「人工」的用例见 §4，不纳入自动化计数。

## 1. 覆盖矩阵

| FP | 用例区间 | 条数 | 必含负例 |
|---|---|---|---|
| FP-01 | TC-01 ~ TC-08 | 8 | 负例 5（pack 路径） |
| FP-02 | TC-09 ~ TC-17 | 9 | 负例 6（include 缺技能） |
| FP-03 | TC-18 ~ TC-26 | 9 | 负例 1（30 行空话） |
| FP-04 | TC-27 ~ TC-36 | 10 | 负例 2、负例 3 |
| FP-05 | TC-37 ~ TC-42 | 6 | — |
| FP-06 | TC-43 ~ TC-49 | 7 | — |
| FP-07 | TC-50 ~ TC-57 | 8 | — |
| FP-08 | TC-58 ~ TC-67 | 10 | 负例 4（表格行端点） |
| FP-09 | TC-68 ~ TC-75 | 8 | 负例 7（坏状态文件） |
| FP-10 | TC-76 ~ TC-84 | 9 | 负例 8（预算耗尽） |
| FP-11 | TC-117 ~ TC-119 | 3 | 负例 11（装备缺官方技能） |
| FP-12 | TC-120 ~ TC-122 | 3 | 负例 12（无可执行判定） |
| FP-13 | TC-123 ~ TC-124 | 2 | 负例 13（生成物与 manifest 不一致） |
| FP-14 | TC-125 ~ TC-128 | 4 | 负例 14（校验失败回滚） |
| FP-15 | TC-129 ~ TC-130 | 2 | 负例 15（章节或角色集缺失） |
| FP-16 | TC-131 ~ TC-133 | 3 | 负例 16（断链） |
| FP-17 | TC-134 ~ TC-135 | 2 | 负例 17（CI 缺 skill-audit） |
| FP-18 | TC-136 ~ TC-137 | 2 | 负例 18（安装形态跑 pnpm test） |
| FP-19 | TC-138 ~ TC-139 | 2 | —（跳过分支持反例） |
| FP-20 | TC-140 ~ TC-142 | 3 | 负例 19（exports/files 缺项） |
| FP-21 | TC-143 ~ TC-144 | 2 | 负例 20（包根写错） |
| FP-22 | TC-85 ~ TC-88 | 4 | — |
| FP-23 | TC-145 ~ TC-147 | 3 | 负例 21（包内混入 src/tests） |
| FP-24 | TC-148 ~ TC-150 | 3 | 负例 22（参数错误） |
| FP-25 | TC-151 ~ TC-153 | 3 | 负例 23（硬编码项目事实） |
| FP-26 | TC-89 ~ TC-95 | 7 | — |
| FP-27 | TC-154 ~ TC-156 | 3 | 负例 24（参数缺判据） |
| FP-28 | TC-96 ~ TC-110 | 15 | 负例 9（相对 root、越界证据） |
| FP-29 | TC-111 ~ TC-116 | 6 | 负例 10（容器标题） |
| **合计** | TC-01 ~ TC-156 | **156** | 24/24 |

## 2. 用例

以下按功能点分组，每条给前置、步骤、期望与证据四段；编号 TC-01 ~ TC-156 连续，可直接作为 `test-report.md` 的行号索引。批三补录的 40 条（TC-117 ~ TC-156）集中在 §8，编号与本节连续。

### FP-01 · pack 技能资源路径按所属包目录重写

本 FP 的判据：`get` 返回的 `content` 里，`.agent/skills/<name>/`、`.dsh/skills/<name>/`、`.claude/skills/<name>/` 三种前缀被改写成**候选所属目录的父目录** + `<name>/`；内置技能仍落到 `<pkg>/skills/<name>/`。对应 design §3 FP-01 测试点 1~6，回退分支单列 TC-08。

#### TC-01 · pack 技能的自引用改写到 pack 目录

- **FP**：FP-01 ｜ **类型**：集成
- **前置**：临时 pack 目录 `<pack>/alpha/SKILL.md`（frontmatter 含 `name: alpha`、`description: ...`，正文含 `运行 .agent/skills/alpha/scripts/go 检查。`）；同时创建 `<pack>/alpha/scripts/go` 文件；无 `devflow.config.json`
- **步骤**：`const provider = register({ packs: [{ name: 'alpha-pack', dir: pack }] })`；`const candidate = (await provider.list()).find(c => c.name === 'alpha')`；`const skill = await provider.get(candidate, { signal: new AbortController().signal })`
- **期望**：`skill.content` 包含 `<pack>/alpha/scripts/go`（绝对路径，`/` 分隔）；`skill.content` 不含 `.agent/skills/alpha/`；`existsSync(join(pack,'alpha','scripts','go')) === true`（引用确实落到真实文件）
- **证据**：断言落点 `tests/packs.spec.ts › skill packs › rewrites a pack skill's self-reference to the pack directory`（行号实现后回填）；生产锚点 `src/index.ts:202`（`get` 内 rebase 调用）、`src/catalog.ts:122`（`rebaseResourcePaths`）

#### TC-02 · 内置技能的自引用仍落到 `<pkg>/skills/<name>/`

- **FP**：FP-01 ｜ **类型**：单测
- **前置**：无需 fixture；取包内 skills 根 `const shipped = fileURLToPath(new URL('../skills/', import.meta.url))`（`tests/catalog.spec.ts` 已有同款常量）
- **步骤**：`rebaseResourcePaths('.agent/skills/role-init/scripts/x', 'role-init', shipped)`
- **期望**：返回值等于 `` `${shipped.replace(/[\\/]+$/u, '')}/role-init/scripts/x` ``；不含 `.agent/skills/`
- **证据**：断言落点 `tests/catalog.spec.ts › rebaseResourcePaths › rebases a bundled skill to the bundle skills directory`；生产锚点 `src/catalog.ts:122`

#### TC-03 · 三层布局 `<pack>/skills/<name>` 取父目录 `<pack>/skills`

- **FP**：FP-01 ｜ **类型**：集成
- **前置**：`<pack>/skills/alpha/SKILL.md`、`<pack>/skills/beta/SKILL.md`，alpha 正文含 `.dsh/skills/alpha/scripts/go`；config 的 pack 目录指向 `<pack>/skills`
- **步骤**：`register({ packs: [{ name: 'nested', dir: join(pack, 'skills') }] })`；对 alpha 调 `provider.get`
- **期望**：`resourceBase.path === '<pack>/skills/alpha'`；`content` 包含 `<pack>/skills/alpha/scripts/go`，不含 `.dsh/skills/alpha/`
- **证据**：断言落点 `tests/packs.spec.ts › skill packs › uses the pack skills directory for a nested layout`；生产锚点 `src/index.ts` 新增 `rebaseRoot`、`src/catalog.ts:175`（`resourceBase`）

#### TC-04 · 三种自引用前缀都被改写

- **FP**：FP-01 ｜ **类型**：集成
- **前置**：pack 技能 alpha 正文各出现一次 `.agent/skills/alpha/a`、`.dsh/skills/alpha/b`、`.claude/skills/alpha/c`
- **步骤**：`register({ packs: [{ name: 'alpha-pack', dir: pack }] })` 后 `provider.get(alpha)`
- **期望**：三个引用都变成 `<pack>/alpha/a`、`<pack>/alpha/b`、`<pack>/alpha/c`；`content` 中三种原前缀出现次数均为 0
- **证据**：断言落点 `tests/packs.spec.ts › skill packs › rewrites every self-reference prefix`；生产锚点 `src/catalog.ts:122`、`src/catalog.ts:113`（`OWN_RESOURCE_PREFIXES`）

#### TC-05 · `get` 返回形状锁定（无 `rank`/`locator`）

- **FP**：FP-01 ｜ **类型**：集成
- **前置**：pack 技能 alpha，frontmatter 只有 `name`/`description`
- **步骤**：`provider.get(alpha)` 后取 `Object.keys(skill).sort()`
- **期望**：`keys` 等于 `['content','description','invocation','name','provider','resourceBase','source']`；`'rank' in skill === false`；`'locator' in skill === false`；`skill.provider === 'dsh-fullstack-team'`
- **证据**：断言落点 `tests/packs.spec.ts › skill packs › strips rank and locator from get`；生产锚点 `src/index.ts:201`（`const { rank: _rank, locator, ...summary }`）

#### TC-06 · rebase 幂等

- **FP**：FP-01 ｜ **类型**：单测
- **前置**：`body = 'a .agent/skills/alpha/scripts/go b .dsh/skills/alpha/x'`，`root = '/tmp/nonexistent/base'`（纯字符串函数，不读盘）
- **步骤**：`once = rebaseResourcePaths(body, 'alpha', root)`；`twice = rebaseResourcePaths(once, 'alpha', root)`
- **期望**：`twice === once`；`once` 中 `.agent/skills/alpha/` 与 `.dsh/skills/alpha/` 均不出现
- **证据**：断言落点 `tests/catalog.spec.ts › rebaseResourcePaths › is idempotent`；生产锚点 `src/catalog.ts:122`

#### TC-07 · 真实 team-core pack 的 impeccable 引用可解析（条件执行）

- **FP**：FP-01 ｜ **类型**：E2E
- **前置**：本机存在 `~/.dsh/skill-packs/team-core/impeccable/SKILL.md`（本机已具备）；CI 无该目录时本用例 skip，并在 `test-report.md` 记「跳过：本机无 team-core pack」，不得记为通过
- **步骤**：`const packDir = join(homedir(), '.dsh', 'skill-packs', 'team-core')`；`register({ packs: [{ name: 'team-core', dir: packDir }], include: ['impeccable'] })`；取 impeccable 候选并 `get`；`const hits = content.match(new RegExp(`${packDir}/impeccable/`, 'gu')) ?? []`
- **期望**：`hits.length >= 3`（该技能 `SKILL.md` 内至少 3 处自引用被改写）；`content` 包含 `${packDir}/impeccable/scripts/impeccable`；`content` 不含 `.agent/skills/impeccable/`
- **证据**：断言落点 `tests/packs.spec.ts › skill packs › resolves a real pack's self-references`（条件 skip）；生产锚点 `src/index.ts:157`（`apply`）、`src/index.ts:202`

#### TC-08 · `rebaseRoot` 回退分支（不可自动化，人工核对）

- **FP**：FP-01 ｜ **类型**：人工
- **前置**：`rebaseRoot` 是 `src/index.ts` 模块内私有函数，`apply` 内的候选恒由 `discoverSkills` 产出，`resourceBase.path` 必为绝对目录，公开 API 构造不出 `.`/空串/与 fallback 相等 三种输入
- **步骤**：阅读 `src/index.ts` 的 `rebaseRoot`，逐条对照：① `kind !== 'directory'` → 返回 fallback；② `dirname(resourceBase.path)` 结果为 `.`、`''` 或等于 fallback → 返回 fallback；③ 其余返回 `dirname`；再由第二人复核签字
- **期望**：三条分支都在源码中可见且被注释说明；无「未处理」分支
- **证据**：`src/index.ts:<rebaseRoot 定义行>`（实现后回填）+ 代码审查记录；本用例不计入自动化通过数

### FP-02 · 白名单缺技能即启动失败并点名

本 FP 的判据：pack 合并完成后校验 `include`，任何没有来源的名字都让 `apply` 抛错并列出缺失名单与可见集合；`checkRoleIncludes` 与运行期同规则；`scripts/roles.mjs` 退出码 1 且不写生成物；manifest 里出现 `exclude` 键即报错。对应 design §3 FP-02 测试点 1~7。

#### TC-09 · `include:['role-init','does-not-exist']` → 启动抛错并点名

- **FP**：FP-02 ｜ **类型**：集成
- **前置**：无 pack，内置技能只有 `role-init`
- **步骤**：`expect(() => register({ include: ['role-init', 'does-not-exist'] })).toThrow()`；捕获错误文本
- **期望**：错误文本包含 `dsh-fullstack-team:`、`does-not-exist`、`role-init`（可见集合）、`dsh-fullstack-team`（provider 名）；不出现「no skills to advertise」这类笼统文案
- **证据**：断言落点 `tests/packs.spec.ts › skill packs › names every include entry with no source`；生产锚点 `src/index.ts:191`（现有「无技能」抛错点，新校验插在其前）

#### TC-10 · `include:['role-init']` 正常注册

- **FP**：FP-02 ｜ **类型**：集成
- **前置**：无 pack；内置技能只有 `role-init`；无 `devflow.config.json`
- **步骤**：`const provider = register({ include: ['role-init'] })`；`await provider.list()`
- **期望**：不抛错；可见名字恰为 `['role-init']`
- **证据**：断言落点 `tests/packs.spec.ts › skill packs › accepts an include that every name resolves`；生产锚点 `src/index.ts:157`

#### TC-11 · pack 提供的名字算「有来源」（校验在合并之后）

- **FP**：FP-02 ｜ **类型**：集成
- **前置**：pack 提供 `flutter-test`
- **步骤**：`register({ include: ['role-init', 'flutter-test'], packs: [{ name: 'flutter', dir }] })`
- **期望**：不抛错；`provider.list()` 同时含 `role-init` 与 `flutter-test`
- **证据**：断言落点 `tests/packs.spec.ts › skill packs › validates include after merging packs`；生产锚点 `src/index.ts:180`（pack 合并循环）

#### TC-12 · 同名同时出现在 include 与 exclude → 判缺失并点名

- **FP**：FP-02 ｜ **类型**：集成
- **前置**：内置技能只有 `role-init`；无 pack
- **步骤**：`expect(() => register({ include: ['role-init'], exclude: ['role-init'] })).toThrow(/role-init/u)`
- **期望**：错误文本包含 `role-init`；不出现 `/no skills/u`（不能退化成笼统错误）
- **证据**：断言落点 `tests/packs.spec.ts › skill packs › treats include-plus-exclude as missing`；生产锚点 `src/index.ts:170`（`hidden` 集合）

#### TC-13 · `checkRoleIncludes` 全命中返回空数组

- **FP**：FP-02 ｜ **类型**：单测
- **前置**：`roles = [{ id: 'r1', include: ['a','b'] }]`（最小构造）；`available = ['b','a','c']`
- **步骤**：`checkRoleIncludes(roles, available)`
- **期望**：返回 `[]`
- **证据**：断言落点 `tests/roles.spec.ts › checkRoleIncludes › returns no gaps when every name resolves`；生产锚点 `src/roles.ts` 新增导出 `checkRoleIncludes`（实现后回填行号）

#### TC-14 · `checkRoleIncludes` 缺两个名字返回一条含两个名字的记录

- **FP**：FP-02 ｜ **类型**：单测
- **前置**：不读文件；`roles` 与 `available` 直接以对象/数组构造
- **步骤**：`checkRoleIncludes([{ id: 'r1', include: ['a','missing-1','missing-2'] }], ['a'])`
- **期望**：`[{ roleId: 'r1', skills: ['missing-1','missing-2'] }]`（名字保持 include 顺序，一个角色只出一条记录）
- **证据**：断言落点 `tests/roles.spec.ts › checkRoleIncludes › reports every missing name in one record per role`；生产锚点 `src/roles.ts:checkRoleIncludes`

#### TC-15 · 缺 pack 目录的角色不计入缺失技能（E2E）

- **FP**：FP-02 ｜ **类型**：E2E
- **前置**：`pnpm build` 完成；临时仓库布局 `<tmp>/{scripts,lib,templates,package.json}` 从本仓复制；`<tmp>/roles/blocked.role.yml` = `id: blocked` / `include: [ghost-skill]` / `packs: [{ name: ghost, dir: /definitely/not/here }]`；`<tmp>/roles/good.role.yml` = `id: good` / `include: [role-init]`（无 packs）
- **步骤**：`node "<tmp>/scripts/roles.mjs"`，记录 stdout、stderr、退出码
- **期望**：退出码 `0`；stdout 含 `blocked` 与 `ghost`（以 `✗`/blocked 形式报告）；stdout **不含** 任何「缺技能」类错误行；good 角色出现在可挂载列表
- **证据**：断言落点 `tests/roles-cli.spec.ts › preflight › does not validate a blocked role's include`（计划新增，或 `test-report.md` 记录命令输出）；生产锚点 `scripts/roles.mjs` 主流程（`planRoles` 之后）

#### TC-16 · manifest 里出现 `exclude` 键 → `loadRoles` 抛错并点名文件

- **FP**：FP-02、FP-22 ｜ **类型**：单测
- **前置**：临时 roles 目录，`bad.role.yml` 在合法 manifest 基础上加一行 `exclude: [role-init]`
- **步骤**：`expect(() => loadRoles(dir)).toThrow()`
- **期望**：错误文本包含 `bad.role.yml` 与 `exclude`；错误带 `dsh-fullstack-team:` 前缀
- **证据**：断言落点 `tests/roles.spec.ts › loadRoles › rejects a manifest that declares exclude`；生产锚点 `src/roles.ts:76`（`loadRoles`）

#### TC-17 · CLI 预检：缺技能 → 退出码 1 且不写 `presets/roles.patch.yml`

- **FP**：FP-02 ｜ **类型**：E2E
- **前置**：同 TC-15 的临时仓库；只放一个角色 `bad.role.yml`：`include: [role-init, does-not-exist]`、无 packs；`<tmp>/presets/` 不存在
- **步骤**：`node "<tmp>/scripts/roles.mjs" --write`，记录退出码与 stdout
- **期望**：退出码 `1`；stdout 含 `bad`（角色 id）与 `does-not-exist`；`existsSync('<tmp>/presets/roles.patch.yml') === false`
- **证据**：断言落点 `tests/roles-cli.spec.ts › preflight › exits 1 and writes nothing when a name is missing`；生产锚点 `scripts/roles.mjs` 主流程（预检段）

### FP-03 · review 门要求每条结论挂可解析证据

本 FP 的判据：review 的 `pass` 需同时满足「条数达标」「每条结论的窗口内有证据引用」「引用可解析」。窗口 = 该行与其后一行；只有两行窗口，不扩到整节。对应 design §3 FP-03 测试点 1~7。

#### TC-18 · 30 行裸「通过」→ 恰好 30 条 `REVIEW_EVIDENCE_MISSING`

- **FP**：FP-03 ｜ **类型**：单测
- **前置**：临时 root；`review-notes.md` = `REVIEW_BARE`；无 `src/`；无 `devflow.config.json`（`reviewMinVerdicts` 默认 30）
- **步骤**：`const result = runReview(root)`；`const missing = result.findings.filter(f => f.code === 'REVIEW_EVIDENCE_MISSING')`
- **期望**：`result.pass === false`；`missing.length === 30`；`missing.map(f => f.line)` 为 1..30；`findings` 中无 `REVIEW_ITEM_NO_VERDICT`；`result.checked` 为 `['review-notes.md']`
- **证据**：断言落点 `tests/gates.spec.ts › review gate › reports every bare verdict`（行号实现后回填）；生产锚点 `src/gates/stages.ts:294`（`reviewGate`）

#### TC-19 · 同行挂证据 → pass

- **FP**：FP-03 ｜ **类型**：单测
- **前置**：`review-notes.md` = `REVIEW_OK`；`src/a.ts` = `SRC_A`
- **步骤**：`runReview(root)`
- **期望**：`pass === true`；`findings` 为空数组；`checked === ['review-notes.md']`
- **证据**：断言落点 `tests/gates.spec.ts › review gate › passes a verdict with same-line evidence`；生产锚点 `src/gates/stages.ts:294`、`src/gates/artifact.ts` 新增 `evidenceRefs`/`window`/`hasVerdict`

#### TC-20 · 结论行 + 下一行证据 → pass（窗口语义）

- **FP**：FP-03 ｜ **类型**：单测
- **前置**：`review-notes.md` 为 30 组两行：`- 条目 n：pass` 换行 `证据：src/a.ts:1`；`src/a.ts` = `SRC_A`
- **步骤**：`runReview(root)`
- **期望**：`pass === true`；无 `REVIEW_EVIDENCE_MISSING`；无 `EVIDENCE_*`
- **证据**：断言落点 `tests/gates.spec.ts › review gate › accepts evidence on the following line`；生产锚点 `src/gates/stages.ts:294`

#### TC-21 · 有引用但文件不存在 → 只出 `EVIDENCE_MISSING`，不双报

- **FP**：FP-03 ｜ **类型**：单测
- **前置**：`review-notes.md` 为 30 行 `- 条目 n：pass — 证据：src/missing.ts:1`；root 下无 `src/missing.ts`
- **步骤**：`runReview(root)`；按 code 计数
- **期望**：`EVIDENCE_MISSING` 恰 30 条（`path: review-notes.md`，`line` 为各自引用行）；`REVIEW_EVIDENCE_MISSING` 恰 0 条；`pass === false`
- **证据**：断言落点 `tests/gates.spec.ts › review gate › does not double-report an unresolvable reference`；生产锚点 `src/gates/artifact.ts:213`（`checkEvidence`）、`src/gates/stages.ts:304`

#### TC-22 · 行号越界 → `EVIDENCE_OUT_OF_RANGE`

- **FP**：FP-03 ｜ **类型**：单测
- **前置**：`review-notes.md` 为 30 行 `- 条目 n：pass — 证据：src/a.ts:9`；`src/a.ts` 只有 2 行
- **步骤**：`runReview(root)`
- **期望**：`EVIDENCE_OUT_OF_RANGE` 恰 30 条；无 `EVIDENCE_MISSING`；`pass === false`
- **证据**：断言落点 `tests/gates.spec.ts › review gate › reports a line past the end of the file`；生产锚点 `src/gates/artifact.ts:213`

#### TC-23 · 六种结论词都计入

- **FP**：FP-03 ｜ **类型**：单测
- **前置**：`review-notes.md` 30 行，结论词按 `pass`/`fail`/`n/a`/`通过`/`不通过`/`不适用` 循环，每行带 `— 证据：src/a.ts:1`；`src/a.ts` = `SRC_A`
- **步骤**：`runReview(root)`
- **期望**：`pass === true`；无 `REVIEW_ITEM_NO_VERDICT`（说明 30 个词都被计到）；`fail`/`不通过` 只是结论词，不构成门失败
- **证据**：断言落点 `tests/gates.spec.ts › review gate › counts both English and Chinese verdicts`；生产锚点 `src/gates/artifact.ts:203`（`countVerdicts` 抽出的 `VERDICT` 常量）

#### TC-24 · 29 条（各带证据）+ 下限 30 → 只出 `REVIEW_ITEM_NO_VERDICT`

- **FP**：FP-03 ｜ **类型**：单测
- **前置**：`review-notes.md` 为 29 行 `- 条目 n：pass — 证据：src/a.ts:1`；`src/a.ts` = `SRC_A`；无 config（下限 30）
- **步骤**：`runReview(root)`
- **期望**：`pass === false`；`REVIEW_ITEM_NO_VERDICT` 恰 1 条；`REVIEW_EVIDENCE_MISSING` 恰 0 条；无 `EVIDENCE_*`
- **证据**：断言落点 `tests/gates.spec.ts › review gate › reports only the verdict shortfall`；生产锚点 `src/gates/stages.ts:304`

#### TC-25 · 窗口只有两行：证据写在第三行不算

- **FP**：FP-03 ｜ **类型**：单测
- **前置**：29 行合法条目 + 第 30 条为 `- 条目 30：pass`、紧接一个空行、再一行 `证据：src/a.ts:1`；`src/a.ts` = `SRC_A`
- **步骤**：`runReview(root)`
- **期望**：`REVIEW_EVIDENCE_MISSING` 恰 1 条且 `line` 指向第 30 条结论行；`REVIEW_ITEM_NO_VERDICT` 为 0（仍是 30 条结论）；`pass === false`
- **证据**：断言落点 `tests/gates.spec.ts › review gate › limits the evidence window to two lines`；生产锚点 `src/gates/stages.ts:294`（`window` 的 `i + 1` 上界）

#### TC-26 · `reviewMinVerdicts: 0` 放宽条数但不放宽证据

- **FP**：FP-03 ｜ **类型**：单测
- **前置**：`review-notes.md` = `REVIEW_BARE`；`devflow.config.json` = `{"reviewMinVerdicts":0}`
- **步骤**：`runReview(root)`
- **期望**：无 `REVIEW_ITEM_NO_VERDICT`；`REVIEW_EVIDENCE_MISSING` 恰 30 条；`pass === false`
- **证据**：断言落点 `tests/gates.spec.ts › review gate › refuses to relax evidence via the verdict floor`；生产锚点 `src/gates/stages.ts:294`

### FP-04 · accept 门逐 FP 结论带证据；P0 识别覆盖常见写法

本 FP 的判据：对每个已声明 FP，所有出现位置的窗口里至少有一个窗口同时含结论词与证据；有结论无证据出 `ACCEPT_EVIDENCE_MISSING`，全程无结论出 `VERDICT_MISSING`；P0 按四步算法逐行判。`ACCEPT_STAGE_OK` 的评审与界面产物保持干净，下列用例只替换验收报告，避免组合门噪声。对应 design §3 FP-04 测试点 1~8。

#### TC-27 · 标题 + 下一行「pass — 证据」→ pass

- **FP**：FP-04 ｜ **类型**：集成
- **前置**：`ACCEPT_STAGE_OK` 原样（`ACCEPT_OK` 的每个 FP 结论行都在下一行带 `src/a.ts` 引用）
- **步骤**：`const result = runGate('accept', root)`
- **期望**：`pass === true`；`findings` 为空；`stage === 'accept'`；`checked` 为 `['requirement.md','acceptance-report.md','ui-acceptance.md','review-notes.md']`
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › passes every FP with evidence`；生产锚点 `src/gates/stages.ts:249`（`acceptGate`）、`src/gates/artifact.ts` 新增 `fpWindows`

#### TC-28 · 无证据的「FP-xx 通过」→ `ACCEPT_EVIDENCE_MISSING`

- **FP**：FP-04 ｜ **类型**：集成
- **前置**：`ACCEPT_STAGE_OK`，把 `acceptance-report.md` 换成下面的形态。`requirement.md` §7 把这一负例写成占位「FP-xx 通过」（不带数字，不计入声明集合）；fixture 用零填充的 `FP-01` 构造同一行为（判定逻辑与编号形态无关）：
  > # 验收
  >
  > ## FP-01 创建订单
  >
  > 通过
  >
  > ## P0
  >
  > P0 遗留：0
- **步骤**：`runGate('accept', root)`；取 `findings.filter(f => f.code === 'ACCEPT_EVIDENCE_MISSING')`
- **期望**：`pass === false`；该 code 恰 1 条，`path === 'acceptance-report.md'`，`line` = `## FP-01 创建订单` 所在行；无 `EVIDENCE_*`；无 `REVIEW_*`
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › requires evidence per functional point`；生产锚点 `src/gates/stages.ts:249`

#### TC-29 · FP 出现但全文无结论词 → `VERDICT_MISSING`

- **FP**：FP-04 ｜ **类型**：集成
- **前置**：`ACCEPT_STAGE_OK`，验收报告正文只写 `见 src/a.ts:1。`，不含任何结论词
- **步骤**：`runGate('accept', root)`；取 `findings.filter(f => f.code === 'VERDICT_MISSING')`
- **期望**：`pass === false`；`VERDICT_MISSING` 恰 1 条且 `line` = 该 FP 首次出现行；`ACCEPT_EVIDENCE_MISSING` 为 0 条；因聚合条数为 0，另有一条 `VERDICT_SHORTFALL`（预期并存）
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › reports a functional point with no verdict`；生产锚点 `src/gates/stages.ts:249`、`src/gates/artifact.ts` 新增 `hasVerdict`

#### TC-30 · 汇总表格 `| FP-01 | pass | src/a.ts:1 |` → pass

- **FP**：FP-04 ｜ **类型**：集成
- **前置**：`ACCEPT_STAGE_OK`，验收报告的结论区换成一行汇总表：`| FP-01 | pass | src/a.ts:1 |`，并保留 FP-02 的同形态行与 `P0 遗留：0`
- **步骤**：`runGate('accept', root)`
- **期望**：`pass === true`；无 `ACCEPT_EVIDENCE_MISSING`；无 `VERDICT_MISSING`（同一行即窗口）
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › accepts a table row with verdict and evidence`；生产锚点 `src/gates/stages.ts:249`

#### TC-31 · 证据文件不存在 → 只出 `EVIDENCE_MISSING`，不重复出 accept 码

- **FP**：FP-04 ｜ **类型**：集成
- **前置**：`ACCEPT_STAGE_OK`，唯一 FP 的结论行是 `pass — 证据：src/missing.ts:1`；root 下无该文件
- **步骤**：`runGate('accept', root)`；按 code 计数
- **期望**：`EVIDENCE_MISSING` 恰 1 条（`path === 'acceptance-report.md'`）；`ACCEPT_EVIDENCE_MISSING` 为 0；`pass === false`
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › does not double-report an unresolvable reference`；生产锚点 `src/gates/stages.ts:249`、`src/gates/artifact.ts:213`

#### TC-32 · 先出现「覆盖 FP」正文、后出现带证据结论 → pass（任一窗口）

- **FP**：FP-04 ｜ **类型**：集成
- **前置**：`ACCEPT_STAGE_OK`，验收报告在 `## FP-01` 之前先写一行 `本报告覆盖 FP-01。`，再写标题与下一行 `pass — 证据：src/a.ts:1`
- **步骤**：`runGate('accept', root)`
- **期望**：`pass === true`；`VERDICT_MISSING` 为 0；`ACCEPT_EVIDENCE_MISSING` 为 0（第一个窗口不满足不构成失败）
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › accepts a later window that carries evidence`；生产锚点 `src/gates/artifact.ts:fpWindows`、`src/gates/stages.ts:249`

#### TC-33 · P0 十个样例逐行判定 + 4 条 `P0_OPEN`

- **FP**：FP-04 ｜ **类型**：单测 + 集成
- **前置**：`ACCEPT_STAGE_OK`，`## P0` 节正文换成 `api-contract.md` §1.6.3 的十行样例
- **步骤**：① 逐行调 `reportsOpenP0(line)`；② 再调 `runGate('accept', root)` 并取 `P0_OPEN`
- **期望**：① 依次为 `false`、`true`、`true`、`true`、`false`、`false`、`false`、`true`、`false`、`false`；② `P0_OPEN` 恰 4 条，`line` 分别指向 `P0 未关闭：2`、`P0 剩余 2 项`、`blocking P0: 1`、`P0 2`；`pass === false`
- **证据**：断言落点 `tests/gates.spec.ts › reportsOpenP0 › decides the ten contract samples`；生产锚点 `src/gates/stages.ts:168`（`reportsOpenP0`）

#### TC-34 · 「P0 未关闭：2」→ accept 阻断

- **FP**：FP-04 ｜ **类型**：集成
- **前置**：`ACCEPT_STAGE_OK`，`P0` 行替换为 `P0 未关闭：2`，其余产物合格
- **步骤**：`runGate('accept', root)`；取 `P0_OPEN`
- **期望**：`pass === false`；`P0_OPEN` 恰 1 条，`path === 'acceptance-report.md'`，`line` = 该行行号；其余 accept code 为 0
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › blocks a positive P0 count`；生产锚点 `src/gates/stages.ts:275`（P0 扫描循环）

#### TC-35 · 未覆盖的 FP 仍出 `FP_UNCOVERED`（回归）

- **FP**：FP-04 ｜ **类型**：集成
- **前置**：需求声明 FP-01/FP-02/FP-03；验收报告只出现 FP-01/FP-02
- **步骤**：`runGate('accept', root)`
- **期望**：`FP_UNCOVERED` 恰 1 条，`detail` 含 `FP-03`，`path === 'acceptance-report.md'`；`pass === false`
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › still reports an uncovered functional point`；生产锚点 `src/gates/stages.ts:249`、`src/gates/artifact.ts:176`

#### TC-36 · 三类 accept 问题并存（聚合 + 无结论 + 无证据）

- **FP**：FP-04 ｜ **类型**：集成
- **前置**：需求声明 FP-01 ~ FP-04；验收报告为：FP-01 `pass — 证据：src/a.ts:1`；FP-02 只写 `见 src/a.ts:1。`；FP-03 完全不出现；FP-04 写 `通过`（无证据）
- **步骤**：`runGate('accept', root)`；收集 code → path 映射
- **期望**：同时命中 `VERDICT_SHORTFALL`（verdict 总数 2 < 4）、`VERDICT_MISSING`（FP-02）、`ACCEPT_EVIDENCE_MISSING`（FP-04）、`FP_UNCOVERED`（FP-03）；`pass === false`
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › keeps the three accept codes distinct`；生产锚点 `src/gates/stages.ts:249`

### FP-05 · `test-report.md` 纳入状态机

本 FP 的判据：test 门必读三件产物（requirement → test-cases → test-report），报告只做基础不变量，不逐 FP 比对。对应 design §3 FP-05 测试点 1~5。

#### TC-37 · 缺 `test-report.md` → `FILE_MISSING(path=test-report.md)`

- **FP**：FP-05 ｜ **类型**：集成
- **前置**：临时 root 只有 `requirement.md`（`REQ_2`）与 `test-cases.md`（`TC_2`）
- **步骤**：`runGate('test', root)`
- **期望**：`pass === false`；`findings` 恰 1 条 `FILE_MISSING`，`path === 'test-report.md'`；`checked` 为 `['requirement.md','test-cases.md']`（缺失项不进 checked）
- **证据**：断言落点 `tests/gates.spec.ts › test gate › requires a test report`；生产锚点 `src/gates/stages.ts:33`（`DEFAULT_FILES`）、`src/gates/stages.ts:227`（`testGate`）

#### TC-38 · 空报告 → `FILE_EMPTY`；标题下无正文的节 → `EMPTY_SECTION`

- **FP**：FP-05 ｜ **类型**：集成
- **前置**：`REQ_2` + `TC_2`；步骤 a 的 `test-report.md` 为空串；步骤 b 的 `test-report.md` 为 `# 执行报告` + 空行 + `## 结果`（二级标题无正文）
- **步骤**：分别 `runGate('test', root)`
- **期望**：a：`FILE_EMPTY` 1 条，`path === 'test-report.md'`；b：`EMPTY_SECTION` 1 条，`line` = `## 结果` 行；两者 `pass === false`。附注：只写一级标题 `# 执行报告` 不触发 `EMPTY_SECTION`（一级标题是文档标题，既有语义，FP-29 用例 TC-116 锁定）
- **证据**：断言落点 `tests/gates.spec.ts › test gate › rejects an empty or hollow report`；生产锚点 `src/gates/artifact.ts:140`、`src/gates/stages.ts:227`

#### TC-39 · `testReportSections:['执行']` 缺节 → `SECTION_MISSING`

- **FP**：FP-05 ｜ **类型**：集成
- **前置**：`REQ_2` + `TC_2` + `test-report.md`（`# 报告` + `## 结果` + `通过。`）；`devflow.config.json` = `{"testReportSections":["执行"]}`
- **步骤**：`runGate('test', root)`
- **期望**：`pass === false`；`SECTION_MISSING` 1 条，`path === 'test-report.md'`，`detail` 含 `执行`
- **证据**：断言落点 `tests/gates.spec.ts › test gate › enforces the configured report sections`；生产锚点 `src/gates/stages.ts:227`、`src/gates/artifact.ts:152`

#### TC-40 · 三件齐 → pass，`checked` 顺序固定

- **FP**：FP-05 ｜ **类型**：集成
- **前置**：`REQ_2` + `TC_2` + `REPORT_OK`
- **步骤**：`runGate('test', root)`
- **期望**：`pass === true`；`findings` 为空；`checked` 严格等于 `['requirement.md','test-cases.md','test-report.md']`
- **证据**：断言落点 `tests/gates.spec.ts › test gate › reads the three artifacts in order`；生产锚点 `src/gates/stages.ts:227`

#### TC-41 · `files.testreport` 改名后按新名读取

- **FP**：FP-05 ｜ **类型**：集成
- **前置**：`REQ_2` + `TC_2` + `qa-report.md`（内容同 `REPORT_OK`）；`test-report.md` 不存在；`devflow.config.json` = `{"files":{"testreport":"qa-report.md"}}`
- **步骤**：`runGate('test', root)`
- **期望**：`pass === true`；`checked` 含 `qa-report.md`、不含 `test-report.md`；无 `FILE_MISSING`
- **证据**：断言落点 `tests/gates.spec.ts › test gate › honours a renamed report`；生产锚点 `src/gates/stages.ts:83`（`fileName`）

#### TC-42 · 报告里的 FP 编号不参与逐 FP 比对（不重复阻断）

- **FP**：FP-05 ｜ **类型**：集成
- **前置**：`REQ_2` + `TC_2` + 报告正文含一个需求与用例文档都没有的 FP 编号（fixture 里用 `'FP-' + '777'` 拼出，台账不写整串）；报告其余内容合格
- **步骤**：`runGate('test', root)`
- **期望**：`pass === true`；`findings` 中没有任何以 `test-report.md` 为 path 的 `FP_ORPHAN`/`FP_UNCOVERED`（逐 FP 只由 accept 门负责）
- **证据**：断言落点 `tests/gates.spec.ts › test gate › does not run per-FP coverage on the report`；生产锚点 `src/gates/stages.ts:227`

### FP-06 · `ui-acceptance.md` 纳入验收（纯后端可显式豁免）

本 FP 的判据：`applicable` 默认 true → 必读 `ui-acceptance.md`；`applicable:false` → 不读文件，但理由必须非空，且每次 accept 以 warning 回填理由。报告自己写「不适用」不算豁免。对应 design §3 FP-06 测试点 1~6。

#### TC-43 · 无 `ui` 键 + 无文件 → `FILE_MISSING(path=ui-acceptance.md)`

- **FP**：FP-06 ｜ **类型**：集成
- **前置**：`ACCEPT_STAGE_OK` 去掉 `ui-acceptance.md`；无 `devflow.config.json`
- **步骤**：`runGate('accept', root)`
- **期望**：`pass === false`；`FILE_MISSING` 1 条且 `path === 'ui-acceptance.md'`；`checked` 为 `['requirement.md','acceptance-report.md','review-notes.md']`
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › requires a UI report by default`；生产锚点 `src/gates/stages.ts:249`

#### TC-44 · 豁免 + 理由 → pass，且每次 accept 回一条 warning

- **FP**：FP-06 ｜ **类型**：集成
- **前置**：`ACCEPT_STAGE_OK` 去掉 `ui-acceptance.md`；`devflow.config.json` = `CONFIG_WAIVED`
- **步骤**：`runGate('accept', root)`
- **期望**：`pass === true`；`findings` 恰 1 条：`code === 'UI_ACCEPTANCE_WAIVED'`、`severity === 'warning'`、`detail` 含 `纯后端项目`、`path === 'devflow.config.json'`；`checked` 不含 `ui-acceptance.md`；再次调用仍返回同一条 warning（豁免可见、不消失）
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › waives UI with a reason and keeps the warning`；生产锚点 `src/gates/stages.ts:249`

#### TC-45 · 豁免无理由 → `UI_WAIVER_NO_REASON`（error）

- **FP**：FP-06 ｜ **类型**：集成
- **前置**：`ACCEPT_STAGE_OK` 去掉 `ui-acceptance.md`；`devflow.config.json` = `CONFIG_NO_REASON`
- **步骤**：`runGate('accept', root)`
- **期望**：`pass === false`；`UI_WAIVER_NO_REASON` 恰 1 条（`path === 'devflow.config.json'`）；无 `UI_ACCEPTANCE_WAIVED`
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › rejects a waiver without a reason`；生产锚点 `src/gates/stages.ts:249`

#### TC-46 · `applicable:true` + 文件存在 → pass

- **FP**：FP-06 ｜ **类型**：集成
- **前置**：`ACCEPT_STAGE_OK`（含 `UI_OK`）；`devflow.config.json` = `CONFIG_UI_TRUE`
- **步骤**：`runGate('accept', root)`
- **期望**：`pass === true`；无 `UI_*` finding；`checked` 含 `ui-acceptance.md`
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › reads the UI report when applicable`；生产锚点 `src/gates/stages.ts:249`

#### TC-47 · 不写 `ui` 键与 `applicable:true` 等价

- **FP**：FP-06 ｜ **类型**：集成
- **前置**：`ACCEPT_STAGE_OK`（含 `UI_OK`），无 `devflow.config.json`
- **步骤**：`runGate('accept', root)`
- **期望**：`pass === true`；无 `UI_*`；`checked` 含 `ui-acceptance.md`（与 TC-46 结果相同）
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › defaults the UI flag to true`；生产锚点 `src/gates/stages.ts:249`

#### TC-48 · 豁免不吞其它 error

- **FP**：FP-06 ｜ **类型**：集成
- **前置**：`ACCEPT_STAGE_OK` 去掉 `ui-acceptance.md`、把 FP-02 的结论行改成无证据的 `pass`；`devflow.config.json` = `CONFIG_WAIVED`
- **步骤**：`runGate('accept', root)`
- **期望**：`pass === false`；同时存在 `UI_ACCEPTANCE_WAIVED`（warning）与 `ACCEPT_EVIDENCE_MISSING`（error）；warning 不改变 pass
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › a warning does not swallow an error`；生产锚点 `src/gates/types.ts:44`（`pass` 计算）

#### TC-49 · 报告自称「界面不适用」不构成豁免

- **FP**：FP-06 ｜ **类型**：集成
- **前置**：`ACCEPT_STAGE_OK` 去掉 `ui-acceptance.md`；验收报告正文追加一行 `界面不适用。`；无 `devflow.config.json`
- **步骤**：`runGate('accept', root)`
- **期望**：`pass === false`；仍出 `FILE_MISSING` 且 `path === 'ui-acceptance.md'`；无 `UI_ACCEPTANCE_WAIVED`
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › ignores a self-declared waiver`；生产锚点 `src/gates/stages.ts:249`

### FP-07 · review 并入 accept（组合门，不新增阶段）

本 FP 的判据：`runGate('accept')` = 验收门 + 评审检查，`stage` 恒为 `accept`；`checked` 顺序为 requirement → acceptance →（ui-acceptance）→ review-notes；`advance` 在 accept 阶段被评审问题拦住。对应 design §3 FP-07 测试点 1~8。

#### TC-50 · 验收齐 + 无 `review-notes.md` → `FILE_MISSING(path=review-notes.md)`

- **FP**：FP-07 ｜ **类型**：集成
- **前置**：`ACCEPT_STAGE_OK` 去掉 `review-notes.md`
- **步骤**：`runGate('accept', root)`
- **期望**：`pass === false`；`FILE_MISSING` 1 条且 `path === 'review-notes.md'`；`stage === 'accept'`；`checked` 为 `['requirement.md','acceptance-report.md','ui-acceptance.md']`
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › includes the review check`；生产锚点 `src/gates/stages.ts` 新增 `acceptStage`、`src/gates/stages.ts:328`（`runGate`）

#### TC-51 · 验收齐 + 评审 30 条带证据 → pass

- **FP**：FP-07 ｜ **类型**：集成
- **前置**：`ACCEPT_STAGE_OK` 原样
- **步骤**：`runGate('accept', root)`
- **期望**：`pass === true`；`stage === 'accept'`；`checked` 严格等于 `['requirement.md','acceptance-report.md','ui-acceptance.md','review-notes.md']`
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › passes the combined gate`；生产锚点 `src/gates/stages.ts:acceptStage`

#### TC-52 · 评审 29 条 → `REVIEW_ITEM_NO_VERDICT`

- **FP**：FP-07 ｜ **类型**：集成
- **前置**：`ACCEPT_STAGE_OK`，`review-notes.md` 改为 29 行带同行证据的条目（下限 30）
- **步骤**：`runGate('accept', root)`
- **期望**：`pass === false`；`REVIEW_ITEM_NO_VERDICT` 1 条且 `path === 'review-notes.md'`；验收部分无 error
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › reports the review shortfall`；生产锚点 `src/gates/stages.ts:294`

#### TC-53 · 验收 P0 未关 + 评审不合格 → 两类 code 同时出现

- **FP**：FP-07 ｜ **类型**：集成
- **前置**：`ACCEPT_STAGE_OK`，P0 行改为 `P0 未关闭：2`，评审改为 29 行
- **步骤**：`runGate('accept', root)`
- **期望**：`findings` 同时含 `P0_OPEN`（`path === 'acceptance-report.md'`）与 `REVIEW_ITEM_NO_VERDICT`（`path === 'review-notes.md'`）；两类都不被对方吞掉；`pass === false`
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › merges both finding sets`；生产锚点 `src/gates/stages.ts:acceptStage`

#### TC-54 · `stage` 字段：组合门恒为 accept，单跑 review 才是 review

- **FP**：FP-07 ｜ **类型**：集成
- **前置**：`ACCEPT_STAGE_OK`（验收、界面、评审都齐）
- **步骤**：同一 root 上分别 `runGate('accept', root)` 与 `runReview(root)`（root = `ACCEPT_STAGE_OK`）
- **期望**：前者 `stage === 'accept'`；后者 `stage === 'review'`；两者 `pass === true`
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › keeps the accept stage label`；生产锚点 `src/gates/stages.ts:328`、`src/gates/stages.ts:350`

#### TC-55 · 豁免界面时 `checked` 为 3 项且顺序固定

- **FP**：FP-07 ｜ **类型**：集成
- **前置**：`ACCEPT_STAGE_OK` 去掉 `ui-acceptance.md`；`devflow.config.json` = `CONFIG_WAIVED`
- **步骤**：`runGate('accept', root)`
- **期望**：`pass === true`；`checked` 严格等于 `['requirement.md','acceptance-report.md','review-notes.md']`
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › orders checked artifacts when the UI is waived`；生产锚点 `src/gates/stages.ts:acceptStage`

#### TC-56 · 单跑 review 与 accept 内评审的 code 集合一致

- **FP**：FP-07 ｜ **类型**：集成
- **前置**：`ACCEPT_STAGE_OK`，`review-notes.md` 改成 29 条合法 + 1 条裸结论（共 30 条，1 条无证据）
- **步骤**：`const direct = runReview(root).findings.filter(f => f.path === 'review-notes.md')`；`const combined = runGate('accept', root).findings.filter(f => f.path === 'review-notes.md')`；比较两边 `code` 去重集合
- **期望**：两个集合相等，均为 `['REVIEW_EVIDENCE_MISSING']`；条数也相等（同一份实现，不复制规则）
- **证据**：断言落点 `tests/gates.spec.ts › accept gate › reuses the review gate implementation`；生产锚点 `src/gates/stages.ts:reviewGate` 被 `acceptStage` 复用

#### TC-57 · `advance` 在 accept 阶段被评审问题拦住，且不落盘

- **FP**：FP-07 ｜ **类型**：集成
- **前置**：root 含 `REQ_2` + `ACCEPT_OK` + `UI_OK`（无 `review-notes.md`）；`.dsh/devflow/state.json` = `STATE_V2('accept', {}, 'accept')`；记录文件字节
- **步骤**：`const outcome = advance(root)`；再读状态文件
- **期望**：`outcome.advanced === false`；`outcome.pass === false`；`outcome.stage === 'accept'`；`outcome.findings` 含 `FILE_MISSING` 且 `path === 'review-notes.md'`；状态文件字节与调用前完全一致；`history.length` 不变
- **证据**：断言落点 `tests/state.spec.ts › advance › refuses to leave accept without a review`；生产锚点 `src/state.ts:166`（`advance`）、`src/gates/stages.ts:acceptStage`

### FP-08 · 端点识别支持表格、query、尾斜杠

本 FP 的判据：表格是第三个识别源（跳过围栏代码块），归一化四步（去 query、去片段、去尾斜杠、方法大写），`sameEndpoint` 方法缺省为通配。对应 design §3 FP-08 测试点 1~9。

#### TC-58 · 表格行「方法 + 斜杠路径」→ 识别为带方法端点

- **FP**：FP-08 ｜ **类型**：单测
- **前置**：无
- **步骤**：`endpoints('| 方法 | 路径 |\n|---|---|\n| POST | /api/orders |\n')`
- **期望**：严格等于 `[{ path: '/api/orders', method: 'POST' }]`
- **证据**：断言落点 `tests/gates.spec.ts › endpoints › reads a table row`；生产锚点 `src/gates/stages.ts` 新增 `parseEndpoint`、`src/gates/stages.ts:127`（`endpoints`）

#### TC-59 · 单元格带反引号或加粗 → 同样识别

- **FP**：FP-08 ｜ **类型**：单测
- **前置**：无文件依赖（纯字符串函数）
- **步骤**：`endpoints('| **GET** | `/api/orders/{id}` |\n')`
- **期望**：严格等于 `[{ path: '/api/orders/{id}', method: 'GET' }]`
- **证据**：断言落点 `tests/gates.spec.ts › endpoints › strips cell markup`；生产锚点 `src/gates/stages.ts:parseEndpoint`

#### TC-60 · 带查询串与不带查询串视为同一端点

- **FP**：FP-08 ｜ **类型**：单测
- **前置**：无文件依赖（纯字符串函数）
- **步骤**：`endpoints('`POST /api/orders?page=2` 与 `POST /api/orders`')`
- **期望**：长度 1，且等于 `[{ path: '/api/orders', method: 'POST' }]`
- **证据**：断言落点 `tests/gates.spec.ts › endpoints › ignores the query string`；生产锚点 `src/gates/stages.ts:parseEndpoint`

#### TC-61 · 尾斜杠等价，根路径 `/` 保留

- **FP**：FP-08 ｜ **类型**：单测
- **前置**：无文件依赖（纯字符串函数）
- **步骤**：`endpoints('`GET /api/orders/` 与 `GET /api/orders`')`；再 `endpoints('`GET /`')`
- **期望**：前者长度 1，`path === '/api/orders'`；后者 `[{ path: '/', method: 'GET' }]`（长度为 1 时保留）
- **证据**：断言落点 `tests/gates.spec.ts › endpoints › treats a trailing slash as the same path`；生产锚点 `src/gates/stages.ts:parseEndpoint`

#### TC-62 · 表头与分隔行不产生端点

- **FP**：FP-08 ｜ **类型**：单测
- **前置**：无文件依赖（纯字符串函数）
- **步骤**：`endpoints('| 方法 | 路径 |\n|---|---|\n')`
- **期望**：`[]`
- **证据**：断言落点 `tests/gates.spec.ts › endpoints › ignores table header and separator`；生产锚点 `src/gates/stages.ts:endpoints`

#### TC-63 · 小写方法归一为大写

- **FP**：FP-08 ｜ **类型**：单测
- **前置**：无文件依赖（纯字符串函数）
- **步骤**：`endpoints('| post | /api/orders |\n')`
- **期望**：`[{ path: '/api/orders', method: 'POST' }]`
- **证据**：断言落点 `tests/gates.spec.ts › endpoints › normalizes the method case`；生产锚点 `src/gates/stages.ts:parseEndpoint`

#### TC-64 · 围栏代码块内的表格行不产生端点

- **FP**：FP-08 ｜ **类型**：单测
- **前置**：无文件依赖（纯字符串函数）
- **步骤**：`const fence = String.fromCharCode(96).repeat(3)`；`endpoints([fence, '| POST | /api/orders |', fence, ''].join('\n'))`；再把 fence 换成三个波浪号重复一次
- **期望**：两次都返回 `[]`
- **证据**：断言落点 `tests/gates.spec.ts › endpoints › skips fenced tables`；生产锚点 `src/gates/stages.ts:endpoints`（围栏状态机）

#### TC-65 · 片段 `#` 被截掉

- **FP**：FP-08 ｜ **类型**：单测
- **前置**：无文件依赖（纯字符串函数）
- **步骤**：`endpoints('`POST /api/orders#items`')`
- **期望**：`[{ path: '/api/orders', method: 'POST' }]`
- **证据**：断言落点 `tests/gates.spec.ts › endpoints › strips the fragment`；生产锚点 `src/gates/stages.ts:parseEndpoint`

#### TC-66 · 设计端只写表格、契约端只写标题 → design 门 pass

- **FP**：FP-08 ｜ **类型**：集成
- **前置**：`design.md` 的接口节只有表格行 `| POST | /api/orders |`；`api-contract.md` 只有 `### POST /api/orders`
- **步骤**：`runGate('design', root)`
- **期望**：`pass === true`；无 `CONTRACT_MISSING` / `CONTRACT_UNDESIGNED`；`checked` 为 `['design.md','api-contract.md']`
- **证据**：断言落点 `tests/gates.spec.ts › design gate › reads endpoints from a table`；生产锚点 `src/gates/stages.ts:196`（`designGate`）、`src/gates/stages.ts:127`

#### TC-67 · 既有四条端点用例仍绿（回归）

- **FP**：FP-08 ｜ **类型**：集成
- **前置**：无
- **步骤**：`pnpm vitest run tests/gates.spec.ts -t endpoints`
- **期望**：退出码 0；四条既有断言原样通过：内联代码保留方法、标题识别、非路径代码忽略、同路径双方法不混淆
- **证据**：断言落点 `tests/gates.spec.ts › endpoints`（既有四条）；生产锚点 `src/gates/stages.ts:127`

### FP-09 · `state.json` 损坏不静默重置

本 FP 的判据：只有 ENOENT 走「初始态 + `created:true`」；读失败、JSON 非法、结构非法一律抛 `dsh-fullstack-team:` 错误并给出修复动作；`reset` 不读旧文件，因此仍可用。对应 design §3 FP-09 测试点 1~7。

#### TC-68 · 非法 JSON → 抛错，文本含绝对路径与 `reset`

- **FP**：FP-09 ｜ **类型**：单测
- **前置**：临时 root；`.dsh/devflow/state.json` 内容为 `{not json`
- **步骤**：`try { readState(root) } catch (error) { text = String(error) }`
- **期望**：抛出错误；`text` 含 `dsh-fullstack-team:`、`join(root, '.dsh/devflow/state.json')` 的绝对路径、`reset`；不返回任何 state（不得静默 `stage:'clarify'`）
- **证据**：断言落点 `tests/state.spec.ts › state file › rejects a corrupt file`；生产锚点 `src/state.ts:114`（`readState`）、`src/state.ts` 新增 `parseState`

#### TC-69 · 空文件 → 抛错（不退回 clarify）

- **FP**：FP-09 ｜ **类型**：单测
- **前置**：`state.json` 为零字节
- **步骤**：`expect(() => readState(root)).toThrow()`
- **期望**：抛出错误；文本含状态文件绝对路径与 `/reset|删除/u` 之一（给出一行可照做的修复动作）；不出现「静默回 clarify」
- **证据**：断言落点 `tests/state.spec.ts › state file › rejects an empty file`；生产锚点 `src/state.ts:114`

#### TC-70 · 结构非法（stage 越界 / 数组 / null / 字符串）→ 一律抛错

- **FP**：FP-09 ｜ **类型**：单测
- **前置**：四份 state 文件分别写成 `{"stage":"bogus"}`、`[]`、`null`、`"x"`
- **步骤**：对每份 root 调 `readState(root)` 并分别捕获
- **期望**：四次都抛错，且文本含 `dsh-fullstack-team:` 与状态文件绝对路径；无一次返回 `stage:'clarify'`
- **证据**：断言落点 `tests/state.spec.ts › state file › rejects an invalid shape`（表驱动）；生产锚点 `src/state.ts:parseState`

#### TC-71 · `{"stage":"design"}`（缺 rework/history）→ 可读，缺字段补零

- **FP**：FP-09 ｜ **类型**：单测
- **前置**：`state.json` = `{"stage":"design"}`
- **步骤**：`const { state, created } = readState(root)`
- **期望**：`created === false`；`state.stage === 'design'`；六个失败类型计数都为 0；`state.history` 为 `[]`
- **证据**：断言落点 `tests/state.spec.ts › state file › fills missing fields`；生产锚点 `src/state.ts:114`

#### TC-72 · 文件不存在 → `created:true` 且不写盘

- **FP**：FP-09 ｜ **类型**：单测
- **前置**：临时 root，无 `.dsh/devflow/state.json`
- **步骤**：`const result = readState(root)`；`existsSync(stateFile(root))`
- **期望**：`result.created === true`；`result.state.stage === 'clarify'`；`existsSync(...) === false`（read 不落盘）
- **证据**：断言落点 `tests/state.spec.ts › state file › starts at the first stage without writing`；生产锚点 `src/state.ts:22`、`src/state.ts:114`

#### TC-73 · 坏文件时 `advance` 抛错，文件字节未被改写

- **FP**：FP-09 ｜ **类型**：集成
- **前置**：root 含合法 `requirement.md`（`REQ_2`）；`state.json` 内容 `{not json`；记录字节 `before`
- **步骤**：`expect(() => advance(root)).toThrow()`；`readFileSync(statePath)` 取 `after`
- **期望**：抛出错误；`after.equals(before) === true`；不产生任何 stage 迁移
- **证据**：断言落点 `tests/state.spec.ts › advance › surfaces a corrupt state instead of repairing it`；生产锚点 `src/state.ts:166`

#### TC-74 · 坏文件时 `reset` 成功，写完是合法 v2

- **FP**：FP-09 ｜ **类型**：集成
- **前置**：`state.json` 内容 `{not json`；root 可写
- **步骤**：`const outcome = reset(root)`；读回文件 `JSON.parse(...)`；再 `readState(root)`
- **期望**：`outcome.pass === true`、`stage === 'clarify'`；文件为 `version: 2`、`stage: 'clarify'`、`reworkStage: 'clarify'`、六计数全 0、`history: []`；`readState` 不再抛错且 `created === false`
- **证据**：断言落点 `tests/state.spec.ts › reset › repairs a corrupt file`；生产锚点 `src/state.ts:236`

#### TC-75 · 旧 state 里的已删失败类型被容忍

- **FP**：FP-09、FP-26 ｜ **类型**：单测
- **前置**：`state.json` = `{"version":1,"stage":"test","rework":{"IMPL_MISMATCH":1,"DEPLOY_FALSE_GREEN":2},"history":[]}`（旧文件可能带已删类型）
- **步骤**：`const { state } = readState(root)`；再 `writeState(root, state)`；读回 JSON
- **期望**：`readState` 不抛错；`Object.keys(state.rework)` 恰为 6 个合法类型、不含 `DEPLOY_FALSE_GREEN`；写回文件 `version === 2` 且不含该键；`IMPL_MISMATCH` 仍为 1
- **证据**：断言落点 `tests/state.spec.ts › state file › tolerates a removed failure type`；生产锚点 `src/state.ts:114`、`src/state.ts:144`

### FP-10 · rework 预算按阶段重置；耗尽后 `advance` 被拒

本 FP 的判据：预算归属 `reworkStage`；耗尽后 `advance` 即使门通过也返回 `pass:false` + `REWORK_BUDGET_EXHAUSTED` 且不落盘；唯一机械出口是 `reset`。对应 design §3 FP-10 测试点 1~8。

#### TC-76 · 阶段内耗尽 3 次 `IMPL_MISMATCH`，门通过也拒绝 advance

- **FP**：FP-10 ｜ **类型**：集成
- **前置**：root 含合法 `requirement.md`（`REQ_2`，clarify 门本可通过）；`state.json` = `STATE_V2('clarify', { IMPL_MISMATCH: 3 }, 'clarify')`；记录字节
- **步骤**：`const outcome = advance(root)`；再读状态文件
- **期望**：`outcome.advanced === false`；`outcome.pass === false`；`outcome.stage === 'clarify'`；`findings` 恰 1 条且 `code === 'REWORK_BUDGET_EXHAUSTED'`；字节与调用前完全一致
- **证据**：断言落点 `tests/state.spec.ts › advance › refuses when the budget is exhausted`；生产锚点 `src/state.ts:166`、`src/state.ts` 新增 `exhaustedFailures`

#### TC-77 · 拒绝 finding 的内容：类型名 + `reset` + 状态文件路径

- **FP**：FP-10 ｜ **类型**：集成
- **前置**：同 TC-76
- **步骤**：`const outcome = advance(root)`；取 `outcome.findings[0]` 与 `outcome.message`
- **期望**：finding 的 `severity === 'error'`；`path === '.dsh/devflow/state.json'`；`detail` 含 `IMPL_MISMATCH` 与 `reset`；`message` 含 `IMPL_MISMATCH`、`上报`、`reset`
- **证据**：断言落点 `tests/state.spec.ts › advance › names the exhausted type and the way out`；生产锚点 `src/state.ts:advance`

#### TC-78 · advance 成功后所有计数归零，`reworkStage` 置为目标阶段

- **FP**：FP-10 ｜ **类型**：集成
- **前置**：`REQ_2`；`STATE_V2('clarify', { TEST_FAIL: 2, CONTRACT_GAP: 1 }, 'clarify')`，`history: []`
- **步骤**：`const outcome = advance(root)`；读回文件 JSON
- **期望**：`advanced === true`、`pass === true`、`stage === 'design'`；文件 `version === 2`、`stage === 'design'`、`reworkStage === 'design'`、六计数全 0；`history` 长度 1 且最后一条 `{action:'advance', stage:'clarify', to:'design'}`
- **证据**：断言落点 `tests/state.spec.ts › advance › clears counters and moves the counter stage`；生产锚点 `src/state.ts:advance`

#### TC-79 · 新阶段再 rework 同一类型 → `count` 从 1 开始

- **FP**：FP-10 ｜ **类型**：集成
- **前置**：接 TC-78，状态已到 `design`（`reworkStage: 'design'`）
- **步骤**：`const outcome = rework(root, 'IMPL_MISMATCH')`；读回文件
- **期望**：`outcome.rework` 为 `{type:'IMPL_MISMATCH', count:1, budget:3, exhausted:false}`；文件 `rework.IMPL_MISMATCH === 1`、`reworkStage === 'design'`；history 最后一条 `stage === 'design'`
- **证据**：断言落点 `tests/state.spec.ts › rework › restarts the count in a new stage`；生产锚点 `src/state.ts:202`

#### TC-80 · v1 文件（无 `reworkStage`、计数非零）→ 计数归当前阶段，写回 v2

- **FP**：FP-10 ｜ **类型**：集成
- **前置**：`state.json` = `{"version":1,"stage":"test","rework":{"IMPL_MISMATCH":2},"history":[]}`
- **步骤**：`const { state } = readState(root)`；再 `rework(root, 'TEST_FAIL')`；读回文件
- **期望**：读时 `state.rework.IMPL_MISMATCH === 2`、`state.reworkStage === 'test'`、`created === false`；写回后 `version === 2`、`reworkStage === 'test'`、`IMPL_MISMATCH === 2`、`TEST_FAIL === 1`
- **证据**：断言落点 `tests/state.spec.ts › state file › migrates a v1 file`；生产锚点 `src/state.ts:readState`、`src/state.ts:94`（`initialState`）

#### TC-81 · `CONTRACT_CONFLICT` 预算 1：首次 rework 即耗尽，随后 advance 被拒

- **FP**：FP-10 ｜ **类型**：集成
- **前置**：`REQ_2`；`STATE_V2('clarify', {}, 'clarify')`
- **步骤**：`const first = rework(root, 'CONTRACT_CONFLICT')`；`const blocked = advance(root)`
- **期望**：`first.rework` 为 `{type:'CONTRACT_CONFLICT', count:1, budget:1, exhausted:true}`，`first.message` 含 `上报` 或 `escalate`；`blocked.advanced === false`、`blocked.findings[0].code === 'REWORK_BUDGET_EXHAUSTED'`、`blocked.stage === 'clarify'`
- **证据**：断言落点 `tests/state.spec.ts › advance › blocks after a single CONTRACT_CONFLICT`；生产锚点 `src/state.ts:34`（`FAILURE_BUDGETS`）、`src/state.ts:166`

#### TC-82 · `reset` 后计数清零、回 clarify，`advance` 可继续

- **FP**：FP-10 ｜ **类型**：集成
- **前置**：接 TC-81（已耗尽）
- **步骤**：`const cleared = reset(root)`；`const moved = advance(root)`；读回文件
- **期望**：`cleared.stage === 'clarify'`、`cleared.pass === true`；文件六计数全 0、`reworkStage === 'clarify'`、`history === []`；`moved.advanced === true`、`moved.stage === 'design'`
- **证据**：断言落点 `tests/state.spec.ts › reset › clears an exhausted budget`；生产锚点 `src/state.ts:236`

#### TC-83 · 耗尽态下 `read` 的 message 指明「需上报」

- **FP**：FP-10 ｜ **类型**：集成
- **前置**：`REQ_2`；`STATE_V2('clarify', { IMPL_MISMATCH: 3 }, 'clarify')`；`flowTools()` 的 state 工具
- **步骤**：`const result = await call(stateTool, { action: 'read', root })`
- **期望**：`result.pass === true`、`advanced === false`、`findings === []`；`result.message` 含 `IMPL_MISMATCH` 与 `上报`；不显示「还剩几次」
- **证据**：断言落点 `tests/tools.spec.ts › devflow_state › reports an exhausted budget on read`；生产锚点 `src/tools.ts` 的 `read` 分支、`src/state.ts:exhaustedFailures`

#### TC-84 · `reworkStage` 与 `stage` 不一致时先归零再计数

- **FP**：FP-10 ｜ **类型**：集成
- **前置**：`state.json` = `STATE_V2('test', { IMPL_MISMATCH: 2 }, 'design')`（手改或历史遗留）
- **步骤**：`const outcome = rework(root, 'IMPL_MISMATCH')`；读回文件
- **期望**：`outcome.rework.count === 1`（先归零再 +1）；文件 `reworkStage === 'test'`、`rework.IMPL_MISMATCH === 1`；history 最后一条 `stage === 'test'`
- **证据**：断言落点 `tests/state.spec.ts › rework › resets a stale counter stage`；生产锚点 `src/state.ts:202`

### FP-22 · 内置技能＝全员公共核心（语义定死并落地）

本 FP 的判据：`cordis.patch.yml` 保留唯一全局条目且不带 `include`/`exclude`/`tools`；`docs/002` 写死「内置技能＝全员公共核心」「`exclude` 对内置技能无效」；角色 manifest 不得出现 `exclude`。对应 design §3 FP-22 测试点 1~4。

#### TC-85 · bundle patch 恰好一条全局 insert，且不带配置

- **FP**：FP-22 ｜ **类型**：单测
- **前置**：仓库根 `cordis.patch.yml`
- **步骤**：`const doc = parse(readFileSync('cordis.patch.yml','utf8'))`；取 `doc[0].insert`
- **期望**：顶层数组长度 1；`insert` 数组长度 1；`insert[0].id === 'dsh-fullstack-team'`；`insert[0].name === 'dsh-fullstack-team'`；`insert[0].config === undefined`；整个文件文本不含 `include:`、`exclude:`、`tools:`
- **证据**：断言落点 `tests/docs.spec.ts › cordis.patch.yml › keeps one global entry`；生产锚点 `cordis.patch.yml:9`

#### TC-86 · `docs/002` 写死公共核心与 exclude 无效

- **FP**：FP-22 ｜ **类型**：单测
- **前置**：`docs/002-role-presets.md`
- **步骤**：读文件文本，跑两条正则
- **期望**：存在一个标题行匹配 `/^#{2,4}\s*内置技能[＝=].{0,8}公共核心/m`；正文存在一句匹配 `/exclude[^\n]*(对)?内置技能[^\n]*(无效|不生效|不起作用)/u`；同时出现「预设只能遮蔽同名技能」的表述
- **证据**：断言落点 `tests/docs.spec.ts › docs/002 › states the built-in isolation verdict`；生产锚点 `docs/002-role-presets.md` 新增小节（实现后回填行号）

#### TC-87 · `roles/` 下任何 manifest 都不出现 `exclude` 键

- **FP**：FP-22 ｜ **类型**：单测
- **前置**：`roles/*.role.yml`
- **步骤**：`readdirSync('roles').filter(f => f.endsWith('.role.yml'))` 逐个读文本；或 `grep -rnE "^\s*exclude:" roles/`（期望无输出、退出码 1）
- **期望**：所有 manifest 都不含行首 `exclude:`；同时 `loadRoles('roles')` 不抛错
- **证据**：断言落点 `tests/docs.spec.ts › roles › no manifest declares exclude`；生产锚点 `src/roles.ts:loadRoles`

#### TC-88 · `packs.spec` 的实例级 `exclude` 语义仍绿（回归）

- **FP**：FP-22 ｜ **类型**：集成
- **前置**：无
- **步骤**：`pnpm vitest run tests/packs.spec.ts -t exclude`
- **期望**：退出码 0；既有「include 之后应用 exclude」「pack 的 allowlist 只作用于该 pack」断言原样通过（本实例视图语义未被改动）
- **证据**：断言落点 `tests/packs.spec.ts › skill packs › applies exclude after include`（既有）；生产锚点 `src/index.ts:170`

### FP-26 · 文档口径对齐：六阶段 / 四门＋一检查 / 删除不可达失败类型

本 FP 的判据：`FAILURE_TYPES` 恰 6 项（删除部署假绿类型）；工具枚举与文档同步；`docs/001` 与 `docs/003` 与代码同口径。对应 design §3 FP-26 测试点 1~6。

#### TC-89 · `FAILURE_TYPES` 恰 6 项且不含被删类型

- **FP**：FP-26 ｜ **类型**：单测
- **前置**：无
- **步骤**：`FAILURE_TYPES`；`FAILURE_BUDGETS`
- **期望**：`FAILURE_TYPES` 严格等于 `['DESIGN_UNFEASIBLE','CONTRACT_GAP','CONTRACT_CONFLICT','IMPL_MISMATCH','TEST_FAIL','ACCEPT_P0']`；`Object.keys(FAILURE_BUDGETS).length === 6`；不含 `DEPLOY_FALSE_GREEN`
- **证据**：断言落点 `tests/state.spec.ts › budgets › drops the unreachable failure type`；生产锚点 `src/state.ts:34`、`src/state.ts:44`（`FAILURE_TYPES`）

#### TC-90 · `devflow_state.failure` 枚举与 `FAILURE_TYPES` 一致

- **FP**：FP-26 ｜ **类型**：单测
- **前置**：`const [, stateTool] = flowTools()`
- **步骤**：读 `stateTool.parameters.failure.enum`
- **期望**：枚举严格等于 `FAILURE_TYPES`（6 项）；不含被删类型；另以 `// @ts-expect-error` 断言 TS 侧不接受该值
- **证据**：断言落点 `tests/tools.spec.ts › devflow_state › declares six failure types`；生产锚点 `src/tools.ts:208`（`enum: [...FAILURE_TYPES]`）

#### TC-91 · `docs/001-design.md` 口径：六阶段 / 四门＋一检查

- **FP**：FP-26 ｜ **类型**：集成
- **前置**：`docs/001-design.md`
- **步骤**：`grep -nE "五道门|七步" docs/001-design.md`；`grep -c "六阶段" docs/001-design.md`；`grep -c "四道阶段门" docs/001-design.md`；`grep -c "115" docs/001-design.md`
- **期望**：第一条无输出（退出码 1）；「六阶段」≥ 1 处；「四道阶段门」≥ 1 处；「115」仍出现（完整清单）且同文出现「30」（机检下限）；状态图不再给部署假绿配预算（该类型只以「人上报 / 无预算」出现）
- **证据**：断言落点 `tests/docs.spec.ts › docs/001 › states six stages and four gates`；生产锚点 `docs/001-design.md:33`、`:169`、`:221`（实现后回写，行号回填）

#### TC-92 · `docs/003` 的 code 表与源码 code 集合一致

- **FP**：FP-26 ｜ **类型**：集成
- **前置**：`docs/003-tools.md`、`src/**`
- **步骤**：
  1. `{ grep -rhoE "finding\('[A-Z_]+'" src | grep -oE "[A-Z_]+"; grep -rhoE "REWORK_BUDGET_EXHAUSTED" src; } | sort -u > /tmp/tc-src-codes`（该码由状态层产出，可能不是字面 `finding(...)` 调用，故单列并入）
  2. `grep -oE '\`[A-Z]+(_[A-Z]+)+\`' docs/003-tools.md | tr -d '\`' | sort -u > /tmp/tc-doc-codes`
  3. `comm -3 /tmp/tc-src-codes /tmp/tc-doc-codes`
- **期望**：第 3 步无输出、退出码 0；`REWORK_BUDGET_EXHAUSTED` 在两端都存在；文档 code 表共 24 行（17 既有 + 7 新增，见 api-contract §1.4）
- **证据**：断言落点 `tests/docs.spec.ts › docs/003 › lists every finding code`；生产锚点 `docs/003-tools.md` codes 表（实现后回填行号）

#### TC-93 · `docs/003` 预算表与 `FAILURE_BUDGETS` 逐行一致

- **FP**：FP-26 ｜ **类型**：集成
- **前置**：`docs/003-tools.md`、`src/state.ts`
- **步骤**：运行下面的比对脚本，退出码即结论
  ```bash
  node --input-type=module -e "
  import { readFileSync } from 'node:fs'
  const src = readFileSync('src/state.ts', 'utf8')
  const start = src.indexOf('FAILURE_BUDGETS')
  const block = src.slice(start, src.indexOf('} as const', start))
  const code = Object.fromEntries([...block.matchAll(/([A-Z_]+):\s*(\d+)/g)].map(m => [m[1], Number(m[2])]))
  const doc = readFileSync('docs/003-tools.md', 'utf8')
  const rows = Object.fromEntries([...doc.matchAll(/^\|\s*\`([A-Z_]+)\`\s*\|\s*(\d+)\s*\|/gm)].map(m => [m[1], Number(m[2])]))
  const diff = [...new Set([...Object.keys(code), ...Object.keys(rows)])].filter(k => code[k] !== rows[k])
  console.log(JSON.stringify({ code, rows, diff }))
  process.exit(diff.length === 0 && Object.keys(code).length === 6 ? 0 : 1)
  "
  ```
- **期望**：退出码 0；输出中 `diff` 为 `[]`；`code` 恰 6 键；文档不含 `DEPLOY_FALSE_GREEN` 行
- **证据**：断言落点 `tests/docs.spec.ts › docs/003 › budget table matches the code`；生产锚点 `src/state.ts:34`、`docs/003-tools.md:44`（实现后回写）

#### TC-94 · `docs/003` 的 stage 表列出 test 三件产物与 accept 含 review

- **FP**：FP-26 ｜ **类型**：集成
- **前置**：`docs/003-tools.md`
- **步骤**：`grep -n "test-report.md" docs/003-tools.md`；`grep -n "ui-acceptance.md" docs/003-tools.md`；`grep -n "review-notes.md" docs/003-tools.md`
- **期望**：`test` 行同时出现 `test-cases.md` 与 `test-report.md`；`accept` 行出现 `review-notes.md`，并写明 review 在 accept 内执行；`ui-acceptance.md` 至少出现一次并在 accept 行
- **证据**：断言落点 `tests/docs.spec.ts › docs/003 › stage table matches the gates`；生产锚点 `docs/003-tools.md:15` 起 stage 表（实现后回填）

#### TC-95 · 工具参数描述承载新口径（stage/action/failure/root）

- **FP**：FP-26、FP-28 ｜ **类型**：单测
- **前置**：`const [gateTool, stateTool] = flowTools()`
- **步骤**：读四个参数的 `description`
- **期望**：`stage` 描述含 `test-report.md`、`ui-acceptance.md`、`review`；`action` 描述含 `advance`、（`budget` 或 `预算`）、（`exhaust` 或 `耗尽` 或 `refus` 或 `拒绝`）；`failure` 描述含六个类型名且不含被删类型；两个工具的 `root` 描述都含 `absolute`/`绝对路径`，并说明相对路径会被拒绝
- **证据**：断言落点 `tests/tools.spec.ts › flowTools › descriptions carry the staged criteria`；生产锚点 `src/tools.ts:STAGE_DOC`（约 `:68`）、`ACTION_DOC`（约 `:85`）、`FAILURE_DOC`（约 `:98`）、`root` 描述（约 `:180`、`:210`）

### FP-28 · 门禁输入安全

本 FP 的判据：`root` 必须绝对路径且是存在的目录；证据引用解算后必须落在 root 内（root 自身算内），越界出 `EVIDENCE_OUTSIDE_ROOT` 且不读该文件；配置已知键类型非法即抛错点名键；状态写入串行化。对应 design §3 FP-28 测试点 1~11。

#### TC-96 · 相对路径 root → 抛错并点名原文

- **FP**：FP-28 ｜ **类型**：集成
- **前置**：任意 fixture；`const [gateTool] = flowTools()`
- **步骤**：`expect(() => runGate('clarify', '.')).toThrow()`；`expect(() => runReview('.')).toThrow()`；`await expect(call(gateTool, { stage: 'clarify', root: '.' })).rejects.toThrow()`
- **期望**：三次都抛错；错误文本含 `dsh-fullstack-team:`、`must be absolute`（或等价「绝对路径」表述）、原文 `.`
- **证据**：断言落点 `tests/gates.spec.ts › gate root › rejects a relative root`；生产锚点 `src/gates/artifact.ts:61`（`resolveRoot`）

#### TC-97 · 不存在的绝对路径 / 文件当 root → 各自报错

- **FP**：FP-28 ｜ **类型**：集成
- **前置**：`missing = '/definitely/not/here-001'`；`file = join(workspace({ 'requirement.md': 'x' }), 'requirement.md')`
- **步骤**：分别 `runGate('clarify', missing)` 与 `runGate('clarify', file)`
- **期望**：前者抛错且文本含 `does not exist`；后者抛错且文本含 `not a directory`；两者都带 `dsh-fullstack-team:` 前缀
- **证据**：断言落点 `tests/gates.spec.ts › gate root › rejects a missing path and a file`；生产锚点 `src/gates/artifact.ts:61`

#### TC-98 · `../../x.ts:1` → `EVIDENCE_OUTSIDE_ROOT`，且不读取 root 外文件

- **FP**：FP-28 ｜ **类型**：单测
- **前置**：`root = <parent>/req`；`<parent>/req/review-notes.md` 30 条结论，第 1 条引用 `../../outside.ts:99`；`resolve(root, '../../outside.ts')` 处创建一个只有 1 行的文件（若被读取，`:99` 会触发 `EVIDENCE_OUT_OF_RANGE`）
- **步骤**：`runReview(root)`；按 code 计数
- **期望**：`EVIDENCE_OUTSIDE_ROOT` 恰 1 条（`path === 'review-notes.md'`，`line` 指向该引用行）；`EVIDENCE_OUT_OF_RANGE` 为 0（证明没读越界文件）；`EVIDENCE_MISSING` 为 0；`pass === false`
- **证据**：断言落点 `tests/gates.spec.ts › review gate › refuses evidence outside the root`；生产锚点 `src/gates/artifact.ts:213`

#### TC-99 · 绝对路径证据 → `EVIDENCE_OUTSIDE_ROOT`

- **FP**：FP-28 ｜ **类型**：单测
- **前置**：root 内 `review-notes.md` 30 条结论，第 1 条引用 `<parent>/abs.ts:1`（绝对路径，文件真实存在且在 root 外）
- **步骤**：`runReview(root)`
- **期望**：`EVIDENCE_OUTSIDE_ROOT` 恰 1 条；无 `EVIDENCE_MISSING`/`EVIDENCE_OUT_OF_RANGE`
- **证据**：断言落点 `tests/gates.spec.ts › review gate › refuses an absolute path outside the root`；生产锚点 `src/gates/artifact.ts:213`

#### TC-100 · 协议前缀与主机端口形态不当作证据

- **FP**：FP-28 ｜ **类型**：单测
- **前置**：`review-notes.md` = `REVIEW_OK`，末尾追加一段 `参见 https://example.com/a.ts:1 与 http://127.0.0.1:8080/b.ts:2。`
- **步骤**：`runReview(root)`
- **期望**：`pass === true`；`findings` 为空（不产生任何 `EVIDENCE_*`）；该段落没有结论词，因此也不产生 `REVIEW_EVIDENCE_MISSING`
- **证据**：断言落点 `tests/gates.spec.ts › review gate › ignores url-shaped references`；生产锚点 `src/gates/artifact.ts` 新增 `evidenceRefs`（负向环视）

#### TC-101 · 证据指向目录 → `EVIDENCE_MISSING`，detail 说明不是普通文件

- **FP**：FP-28 ｜ **类型**：单测
- **前置**：root 下创建目录 `src/a.dir/`（目录名带点以便匹配引用形态）；`review-notes.md` 第 1 条引用 `src/a.dir:1`
- **步骤**：`runReview(root)`
- **期望**：`EVIDENCE_MISSING` 恰 1 条；`detail` 匹配 `/(不是普通文件|not a regular file)/u`；无 `EVIDENCE_OUT_OF_RANGE`
- **证据**：断言落点 `tests/gates.spec.ts › review gate › treats a directory as missing`；生产锚点 `src/gates/artifact.ts:213`

#### TC-102 · 行号 0 与超过总行数 → `EVIDENCE_OUT_OF_RANGE`

- **FP**：FP-28 ｜ **类型**：单测
- **前置**：`src/a.ts` = `SRC_A`（2 行）；`review-notes.md` 第 1 条同时引用 `src/a.ts:0` 与 `src/a.ts:999`
- **步骤**：`runReview(root)`；取 `EVIDENCE_OUT_OF_RANGE`
- **期望**：恰 2 条，均为 `path === 'review-notes.md'`、`line` 指向同一行；无 `EVIDENCE_MISSING`
- **证据**：断言落点 `tests/gates.spec.ts › review gate › rejects line zero and past-the-end`；生产锚点 `src/gates/artifact.ts:213`

#### TC-103 · 配置已知键类型非法 → 抛错并点名键（表驱动）

- **FP**：FP-28 ｜ **类型**：单测
- **前置**：每个子用例一个 root，`requirement.md` 合法；`devflow.config.json` 依次为下表七种
- **步骤**：对每个 root 调 `runGate('clarify', root)` 并捕获
- **期望**：七次都抛错，且错误文本含 `dsh-fullstack-team:` 与对应键名

  | config 内容 | 必须出现的键名 |
  |---|---|
  | `{"reviewMinVerdicts":"30"}` | `reviewMinVerdicts` |
  | `{"ui":[]}` | `ui` |
  | `{"files":[]}` | `files` |
  | `{"testReportSections":"执行"}` | `testReportSections` |
  | `{"acceptanceSections":[1]}` | `acceptanceSections` |
  | `{"ui":{"applicable":"no"}}` | `applicable` |
  | `{"ui":{"reason":5}}` | `reason` |

- **证据**：断言落点 `tests/gates.spec.ts › gate config › rejects invalid known keys`；生产锚点 `src/gates/stages.ts:72`（`loadGateConfig`）

#### TC-104 · 未知配置键被忽略（前向兼容）

- **FP**：FP-28 ｜ **类型**：单测
- **前置**：`REQ_2` + `devflow.config.json` = `{"unknownKey":1,"reviewMinVerdicts":30}`
- **步骤**：`runGate('clarify', root)`
- **期望**：不抛错；`pass === true`；`findings` 为空
- **证据**：断言落点 `tests/gates.spec.ts › gate config › ignores unknown keys`；生产锚点 `src/gates/stages.ts:72`

#### TC-105 · 同进程 20 次 rework → 计数 20，无丢失

- **FP**：FP-28 ｜ **类型**：集成
- **前置**：临时 root；`.dsh/devflow/state.json` = `STATE_V2('build', {}, 'build')`
- **步骤**：`await Promise.all(Array.from({ length: 20 }, (_, i) => Promise.resolve().then(() => rework(root, 'TEST_FAIL', `n${i}`))))`；读回状态
- **期望**：`state.rework.TEST_FAIL === 20`；`state.history.length === 20`；每条 history 的 `failure === 'TEST_FAIL'`。（本用例只覆盖同进程串行，跨进程不承诺，见 api-contract §6）
- **证据**：断言落点 `tests/state.spec.ts › write › keeps every concurrent counter`；生产锚点 `src/state.ts:withStateLock`（实现后回填）、`src/state.ts:202`

#### TC-106 · 手工占住锁文件 → advance 在约 500ms 内抛错且状态未改

- **FP**：FP-28 ｜ **类型**：集成
- **前置**：`REQ_2`；`STATE_V2('clarify', {}, 'clarify')`；手工创建 `.dsh/devflow/state.lock`（fresh mtime）；记录状态文件字节
- **步骤**：`const t0 = performance.now()`；`expect(() => advance(root)).toThrow()`；`const elapsed = performance.now() - t0`；再读字节
- **期望**：抛错文本含 `dsh-fullstack-team:`；`elapsed >= 300` 且 `elapsed <= 2000`（重试 10×50ms ≈ 500ms）；状态文件字节与调用前完全一致；锁文件仍存在（未误删他人锁）
- **证据**：断言落点 `tests/state.spec.ts › lock › times out instead of writing`；生产锚点 `src/state.ts:withStateLock`

#### TC-107 · 陈旧锁（30 秒前）被清除，写入成功

- **FP**：FP-28 ｜ **类型**：集成
- **前置**：`REQ_2`；`STATE_V2('clarify', {}, 'clarify')`；创建 `.dsh/devflow/state.lock`，`utimesSync(lock, past, past)` 把 mtime 设为 30 秒前
- **步骤**：`const outcome = advance(root)`；`existsSync(lock)`
- **期望**：`advanced === true`、`stage === 'design'`；状态文件已更新为 design；锁文件被删除
- **证据**：断言落点 `tests/state.spec.ts › lock › clears a stale lock`；生产锚点 `src/state.ts:withStateLock`

#### TC-108 · 状态读写的 root 校验

- **FP**：FP-28 ｜ **类型**：单测
- **前置**：任意 state 对象（可用 `readState` 在临时 root 上的返回值）
- **步骤**：`readState('.')`；`readState('/definitely/not/here-001')`；`writeState('.', state)`
- **期望**：三次都抛错；`must be absolute` / `does not exist` 两种文本分别命中；`writeState` 同样先过 `resolveRoot`
- **证据**：断言落点 `tests/state.spec.ts › state file › validates the root`；生产锚点 `src/state.ts:114`、`src/state.ts:144`

#### TC-109 · root 内的 `..` 归一后仍在 root 内 → 合法证据

- **FP**：FP-28 ｜ **类型**：单测
- **前置**：`src/a.ts` = `SRC_A`；`review-notes.md` 30 条带证据，其中第 1 条写 `src/../src/a.ts:1`
- **步骤**：`runReview(root)`
- **期望**：`pass === true`；无任何 `EVIDENCE_*`（解算后仍在 root 内，不得误报越界）
- **证据**：断言落点 `tests/gates.spec.ts › review gate › accepts a normalized in-root path`；生产锚点 `src/gates/artifact.ts:213`

#### TC-110 · 两个工具的 `root` 描述都写明必须绝对路径

- **FP**：FP-28 ｜ **类型**：单测
- **前置**：`const [gateTool, stateTool] = flowTools()`
- **步骤**：分别读 `gateTool.parameters.root.description` 与 `stateTool.parameters.root.description`
- **期望**：两者都匹配 `/absolute|绝对路径/u`，且都匹配 `/relative|相对/u`（说明相对路径会被拒绝）
- **证据**：断言落点 `tests/tools.spec.ts › flowTools › root is documented as absolute`；生产锚点 `src/tools.ts` 的 `root` 描述（约 `:180`、`:210`）

### FP-29 · 容器标题不算空节

本 FP 的判据：`## 节` 之后（跳过空行）首个非空行是更深层标题时，父节不判 `EMPTY_SECTION`；正文真空的子节照判。来源是 `requirement.md` §5 的裁决与 §7 的验收标准；设计与契约的落点缺口见 §5 D-01。

#### TC-111 · `## 节` 紧跟 `### 子节` → 父节不报 `EMPTY_SECTION`

- **FP**：FP-29 ｜ **类型**：单测
- **前置**：临时 root，`requirement.md` 为：
  > # 需求
  >
  > ## 功能点
  >
  > - FP-01 创建订单
  >
  > ## 附录
  >
  > ### 细则
  >
  > 正文
  （`## 附录` 下一行即 `### 细则`，中间无空行）
- **步骤**：`runGate('clarify', root)`；`findings.filter(f => f.code === 'EMPTY_SECTION')`
- **期望**：`pass === true`；`EMPTY_SECTION` 为 `[]`
- **证据**：断言落点 `tests/gates.spec.ts › empty sections › treats a heading followed by a deeper heading as a container`；生产锚点 `src/gates/artifact.ts:140`（`checkEmptySections`）

#### TC-112 · 标题与子标题之间有空行（001 实际排版）→ 父节仍不报

- **FP**：FP-29 ｜ **类型**：单测
- **前置**：同 TC-111，但 `## 附录` 与 `### 细则` 之间保留一个空行
- **步骤**：`runGate('clarify', root)`
- **期望**：`pass === true`；`EMPTY_SECTION` 为 `[]`（判据是「跳过空行后的首个非空行」，不是字面的下一行；`requirement.md` 第 13、70、121、187 行与 `assessment.md` 第 6 行都是这种排版）
- **证据**：断言落点 `tests/gates.spec.ts › empty sections › skips blank lines before the child heading`；生产锚点 `src/gates/artifact.ts:140`

#### TC-113 · 正文真空的子节仍报 `EMPTY_SECTION`

- **FP**：FP-29 ｜ **类型**：单测
- **前置**：`requirement.md`：
  > # 需求
  >
  > ## 功能点
  >
  > - FP-01 创建订单
  >
  > ## 容器
  >
  > ### 真空子节
  >
  > ## 尾部
  >
  > 正文
- **步骤**：`runGate('clarify', root)`；取 `EMPTY_SECTION`
- **期望**：恰 1 条，`path === 'requirement.md'`，`line` = `### 真空子节` 行；`## 容器` 不产生 finding；`pass === false`
- **证据**：断言落点 `tests/gates.spec.ts › empty sections › still reports a truly empty leaf`；生产锚点 `src/gates/artifact.ts:140`

#### TC-114 · 更深层级同样适用（`###` 后跟 `####`）

- **FP**：FP-29 ｜ **类型**：单测
- **前置**：`requirement.md` 含 `## 容器` → `### 中间` → `#### 叶子` → `正文`
- **步骤**：`runGate('clarify', root)`
- **期望**：`EMPTY_SECTION` 为 `[]`（容器规则按「更深层标题」判定，与层级无关）。本条是对 FP-29 同一规则的自然外推，若实现只处理相邻两级，见 §5 D-03 裁定后再执行
- **证据**：断言落点 `tests/gates.spec.ts › empty sections › applies the container rule at every level`；生产锚点 `src/gates/artifact.ts:140`

#### TC-115 · dogfood：001 自身在 clarify/test/accept 三门不再因容器标题报红

- **FP**：FP-29 ｜ **类型**：E2E
- **前置**：真实需求目录 `const R = fileURLToPath(new URL('../docs/dev/001-flow-hardening/', import.meta.url))`（绝对路径；本机当前为 `/Users/jiangnan/Documents/deepseek-harness/default-workspace/dsh-fullstack-team/docs/dev/001-flow-hardening`）；`requirement.md`、`assessment.md`、`test-cases.md` 均为仓库现状
- **步骤**：① `runGate('clarify', R)`；② `runGate('test', R)`；③ `runGate('accept', R)`；对 ②③ 只筛 `code === 'EMPTY_SECTION'` 且 `path` 为 `requirement.md`/`assessment.md`/`test-cases.md` 的条目
- **期望**：① `pass === true`，`findings === []`，`checked === ['requirement.md','assessment.md']`；②③ 的空节条目为 `[]`。②③ 仍会因缺少执行报告/验收材料报其它 code（见 §5 D-04），本用例只断言「不再因容器标题误报」
- **证据**：断言落点 `tests/gates.spec.ts › dogfood › 001 clears the container-heading false positive`；生产锚点 `src/gates/artifact.ts:140`、`src/gates/stages.ts:177`

#### TC-116 · 一级标题无正文仍不算空节（回归）

- **FP**：FP-29 ｜ **类型**：单测
- **前置**：`requirement.md` = `# 需求` + 空行 + `## 功能点` + 空行 + `- FP-01 创建订单`
- **步骤**：`runGate('clarify', root)`
- **期望**：`pass === true`；无 `EMPTY_SECTION`（`# 需求` 是文档标题，不是节）
- **证据**：断言落点 `tests/gates.spec.ts › empty sections › ignores the document title`；生产锚点 `src/gates/artifact.ts:140`

## 3. 必含负例索引

| # | 负例要求 | 用例 | 断言要点 |
|---|---|---|---|
| 1 | 30 行空话「通过」→ review 门 fail | TC-18 | `pass:false`，`REVIEW_EVIDENCE_MISSING` 恰 30 条 |
| 2 | 无证据的「FP-xx 通过」→ accept 门 fail | TC-28 | `ACCEPT_EVIDENCE_MISSING` 1 条，`line` 指向 FP 行 |
| 3 | 「P0 未关闭：2」→ accept 门 fail | TC-34 | `P0_OPEN` 1 条，`pass:false` |
| 4 | 表格行（方法单元格 `POST`、路径单元格 `/api/orders`）→ design 门识别端点 | TC-58、TC-66 | `endpoints` 返回 `{path:'/api/orders',method:'POST'}`；design 门无 `CONTRACT_*` |
| 5 | pack 的 `.agent/skills/alpha/scripts/go` → 落到 pack 目录 | TC-01、TC-03、TC-07 | `content` 含 `<pack>/alpha/scripts/go`，不含 `.agent/skills/alpha/` |
| 6 | `include:['role-init','does-not-exist']` → 启动抛错并点名 | TC-09 | 错误文本含 `does-not-exist`、`role-init`、`dsh-fullstack-team:` |
| 7 | 损坏 `state.json` → 报错，不重置为 clarify | TC-68、TC-73 | `readState`/`advance` 抛错；文件字节不变 |
| 8 | 预算耗尽 → `advance` 拒绝（即使门通过） | TC-76、TC-81 | `REWORK_BUDGET_EXHAUSTED`，`advanced:false`，stage 不变 |
| 9 | 相对 root 报错；`../../x:1` 证据被拒 | TC-96、TC-98 | `/must be absolute/`；`EVIDENCE_OUTSIDE_ROOT` 且不读越界文件 |
| 10 | 容器标题不报 `EMPTY_SECTION`；真空子节仍报 | TC-111、TC-112、TC-113 | 父节 0 条；真空子节恰 1 条且 `line` 正确 |
| 11 | `dsh-plugin-dev` 的 `include` 不得硬写官方 `cordis-plugin-development`（本包 provider 无此技能，硬写按 FP-02 启动失败）；依赖须在 manifest 与文档中声明 + §8.1 兜底 | TC-119 | exit 0，7 条 `PASS`、`ALL= true`；`include` 四项不含该名；description 含依赖与 §8.1 |
| 12 | 只命中一个标记的仓库不得判成 stack 角色（组内 AND、组间 OR） | TC-122 | `/tmp/fp12-java` 命中 `backend-java`；`/tmp/fp12-node` 不命中 `frontend-vue`；本仓 `matched:` 含 `dsh-plugin-dev`、不含 `frontend-vue` |
| 13 | 生成物 include 与 `roles/*.role.yml` 不一致（如 pm 少 `taste`）必须被发现 | TC-124 | 副本删行后断言 exit 1，输出 `MISMATCH pm` |
| 14 | profile 校验失败必须回滚且退出非零 | TC-128 | exit 1，文件 sha256 与合并前相同，输出 `已回滚` |
| 15 | 规范九章或清单角色集缺一项必须被发现 | TC-130 | 缺章/缺角色时 exit 1 |
| 16 | README/docs 指向不存在的本地文件必须被发现 | TC-133 | 副本注入 `docs/NOPE.md` → `broken 1`、exit 1 |
| 17 | CI 缺 `skill-audit` 步骤即不达标 | TC-135 | 两条命令串各出现 1 次；缺一则 exit 1 |
| 18 | 安装形态不得声称 `pnpm test` 通过 | TC-137 | SKILL.md 必须写「发布包不含 tests/ 与 src/」「报告给用户」 |
| 19 | `exports` 缺 `./locale/*.json`／`./icon`，或 `files` 缺两项即不达标 | TC-142 | 缺任一项 exit 1 |
| 20 | 包根推导写成 `pwd` 或省略包根说明即不达标 | TC-144 | 必须出现「不要拿 `pwd` 假设当前目录就是包根」 |
| 21 | 发布包不得携带 `tests/` 或 `src/` | TC-147 | pack 清单两个前缀都不出现；`lib/index.js` 可加载 |
| 22 | `--out` 缺值必须报用法并退出 2 | TC-150 | exit 2，stderr 含 `用法：node scripts/roles.mjs` |
| 23 | 审计脚本不得回退到内置项目事实 | TC-153 | 公司名四词与旧「业务仓名」正则（`platform)-manage`）均无匹配 |
| 24 | 工具参数描述必须逐值给出判据 | TC-156 | stage 6 行、action 5 行、failure 7 行；缺值判据即失败 |

## 4. 无法自动化 / 需人工确认的用例

| 用例 | 为何不能自动化 | 替代处置 |
|---|---|---|
| TC-08（`rebaseRoot` 回退分支） | 函数是 `src/index.ts` 模块内私有；`apply` 的候选恒来自 `discoverSkills`，`resourceBase.path` 必为绝对目录，公开 API 构造不出 `.`/空串/等于 fallback 的输入 | 代码审查：逐条对照三分支并签字；若要求可测，由实现方导出该函数（additive）或加 `__test` 出口，届时转为单测 |
| TC-07（真实 pack 的 impeccable 引用） | 依赖本机 `~/.dsh/skill-packs/team-core`，CI 无包环境跑不到 | `it.skipIf(!existsSync(pack))`；`test-report.md` 记录「跳过 + 原因」，不得记为通过 |
| FP-22 的语义本身（内置技能对所有会话可见） | 该结论由宿主 `@deepseek-ai/dsh-skill` 的 `collectFresh` 合并行为决定，本仓测试环境没有宿主运行时 | 机器只校验文档与 manifest 约束（TC-85~TC-87）；语义正确性由人对照 `requirement.md` §2.4 复核并在验收报告注明 |
| FP-26 的叙述性口径（除 code 表、预算表、stage 表之外） | 文档里「六阶段/四门＋一检查/115 与 30 的关系」是叙述，脚本只能比表格与关键词 | TC-91 锁关键词；剩余叙述由主 PM 在验收时通读 `docs/001`、`docs/003` 签字 |
| FP-04 P0 识别面的扩展部分 | api-contract §1.6.3 只固定 10 个样例，且明文允许扩充开启/关闭词集合 | 本批只锁 10 个样例（TC-33）；新增措辞不纳入本批验收，新增时补样例 |
| FP-01 的「模型实际看到的技能正文」 | 需要把本包挂进 profile、重启 GUI 后由真实会话读取，超出批二范围（Q5 未执行） | TC-07 在 provider 层证明改写正确；会话级留到验收阶段的 dogfood/真包集成 |
| FP-20 的「插件页/详情实际显示标题、描述、图标」 | 需要宿主加载本包并在界面渲染；本会话不重启宿主，界面不可观测 | 文件与 schema 层由 TC-140 ~ TC-142 锁定；渲染效果在 `test-report.md` §6 记 SKIP |
| FP-23 的「按官方 `install_bundle` 安装并渲染资源」 | 官方安装流程要在 profile 内执行并引导包安装，随后重启宿主；本机只读验证，不重启 | 包清单与 README 由 TC-145 ~ TC-147 锁定；安装效果在 `test-report.md` §6 记 SKIP |
| FP-11 的「官方技能在本环境是否可见」 | `cordis-plugin-development` 打在 `app.asar` 内，本会话文件系统看不到该目录 | 以 manifest description 与 §8.1 清单的**声明**为判据（TC-119）；宿主是否实际提供该技能留待环境侧确认，可见性不作为通过依据（PM 已修正判据） |

## 5. 与冻结档、设计、契约的偏差（执行前需裁定）

| # | 偏差 | 影响 | 建议处置 |
|---|---|---|---|
| D-01 | FP-29 只有需求档落点：`design.md` §0 覆盖清单（`design.md:20`）不含它、§3 无专节，只有 §8 第 11 条以「未落地、待裁决」登记（`design.md:436`）；而 `requirement.md` §5 已裁决落地（`requirement.md:180`）、§7 有验收标准（`requirement.md:265`） | 设计与需求不一致；`api-contract.md` §1.4 的 `EMPTY_SECTION` 行（`api-contract.md:76`）仍写「二级及更深的标题没有正文」，没有容器例外 | 补 FP-29 设计小节 + 契约改一行（容器标题不算空节）；验收报告注明本批按需求档裁决实现 |
| D-02 | `design.md` §8 第 11 条写「标题下一行是更深层标题」，但 001 冻结档的实际排版是「标题 → 空行 → 子标题」（`requirement.md:13-15`、`:70-72`、`:121-123`、`:187-189`、`assessment.md:6-8`） | 按字面「下一行」实现，001 自身仍会红，FP-29 验收不成立 | 判据定死为「跳过空行后的首个非空行」；TC-112 按此断言 |
| D-03 | FP-29 只举 `##` → `###`，未说 `###` → `####` 是否同一规则 | TC-114 属外推，可能超范围 | 主 PM 裁定；若不适用，删除 TC-114 并同步验收口径 |
| D-04 | 批二台账只覆盖 14 个功能点，测试门在 001 目录上必然报其余功能点的 `FP_UNCOVERED` 与 `FILE_MISSING(test-report.md)` | 001 无法在批二内从 test 推进到 accept，dogfood 不能以「全绿」作为批二通过条件 | 验收报告的 dogfood 节按此口径记录：批二只验机制用例，全量 dogfood 等全量台账与执行报告齐备 |
| D-05 | FP-07 的 `checked` 顺序（requirement → acceptance →（ui-acceptance）→ review-notes）设计与本台账按此固定，但 `api-contract.md` §1.2 只写「顺序固定」，未列具体值 | 实现与验收可能各写一套顺序 | 契约 §1.2 补一行具体顺序；本批以 TC-51、TC-55 锁定 |
| D-06 | FP-05 设计测试点 2 写「只有标题 → `EMPTY_SECTION`」，但现有一级标题语义是「文档标题不算节」（`api-contract.md:76` 的「二级及更深」、`src/gates/artifact.ts:135` 的注释） | 字面按「只有一级标题」测，会与既有语义冲突 | TC-38 用「一级标题 + 空二级节」复现；请设计确认口径 |
| D-07 | FP-01 的回退分支（`rebaseRoot`）没有可测出口 | 见 §4 | 代码审查或补导出 |
| D-08 | `checkRoleIncludes(roles, available)` 的第二参数形态（数组 / Set）设计未定 | 用例写法依赖实现选择 | 台账按只读字符串数组写；实现若用 Set，只改调用不改断言 |
| D-09 | `REWORK_BUDGET_EXHAUSTED` 由状态层产出，可能不以字面 `finding(...)` 出现 | TC-92 的源码集合比对可能误报差集 | 比对脚本已把该码单独并入源码集合；实现请保证它经 `finding(...)` 或同源常量产出 |
| D-10 | FP-11 的验收标准第三条「角色装备含官方 `cordis-plugin-development`」（`requirement.md:248`）未达成：`roles/dsh-plugin-dev.role.yml` 的 `include` 无该项，生成物同；执行计划把它记为 G5 挂账（`execution-plan.md:60`），但 FP 本身仍标在批零完成项里 | 冻结档与执行计划口径不一致；按旧口径该 FP 不能判 PASS | **已处置（2026-11-04）**：主 PM 修正冻结档判据——要求 manifest 与文档声明「依赖官方能力、`include` 引用不到、环境不提供时按 §8.1 清单执行」，不再要求 include 出现该技能；执行计划 G5 挂账随之关闭。TC-119 按新判据重写并实测 exit 0 |
| D-11 | FP-12 要求「文档与代码同一语义」，但旧实现 `src/` 内没有任何消费 `detect` 的判定函数（`src/roles.ts:41` 只是类型声明）；评估档承诺的「在 `roles.ts` 落成可执行判定」（`assessment.md:35`）未实现，也没有对应单测 | 「只命中一个标记不被判成 stack 角色」只能人工演绎，无法对产品代码执行 | **已处置（2026-11-04）**：`src/roles.ts:143` 落成 `roleMatches`（组内 AND、组间 OR）；`roles/*.role.yml` 改为分组写法；`scripts/roles.mjs:104-106` 消费该函数并输出「本仓命中」列；`tests/roles.spec.ts:108-164` 共 9 条相关 `it`。TC-122 改为可执行矩阵，实测全过 |
| D-13 | `docs/dev/project-standard.md:37` 仍写「`detect` 是 AND——全部标记命中才装该 stack 角色」，与同文件 `:23` 指到的 `roleMatches` 及 `role-init` 的「组内 AND、组间 OR」冲突（按字面，只有 `pom.xml` 的 Java 仓将永不命中） | 「本仓技术事实来源」与代码口径不一致；不影响 TC-122 的函数级断言，但会误导读者与其他项目的角色编写 | **待处置**：改成「组内 AND、组间 OR」一行。本批边界只允许写 `test-cases.md`/`test-report.md`，故只登记不改文档；见 `test-report.md` §4.1 |
| D-12 | 批三用例的判据多落在脚本与文件事实（`node scripts/*.mjs`、`npm pack`、manifest/YAML 内省），不是门禁函数；「断言落点」因此写成命令 + 关键输出行，而非 `tests/*.spec.ts` 行号 | 与批二「测试文件 + it 行号」的证据形态不同，验收报告需按 §8 的形态引用 | 报告统一按「命令 + 输出行 + 文件行号」三件套回填，不回填不存在的单测行 |

## 6. 执行顺序与回归

按 design §6 的依赖顺序执行，前一组绿了再进后一组：

| 顺序 | 组 | 用例 | 命令 |
|---|---|---|---|
| 1 | 输入安全 | FP-28（TC-96 ~ TC-110） | `pnpm vitest run tests/gates.spec.ts tests/state.spec.ts tests/tools.spec.ts` |
| 2 | 状态机 | FP-09、FP-10（TC-68 ~ TC-84） | `pnpm vitest run tests/state.spec.ts` |
| 3 | 产物门 | FP-05、FP-06（TC-37 ~ TC-49） | `pnpm vitest run tests/gates.spec.ts` |
| 4 | 证据门 | FP-03、FP-04（TC-18 ~ TC-36） | `pnpm vitest run tests/gates.spec.ts` |
| 5 | 组合门 | FP-07（TC-50 ~ TC-57） | `pnpm vitest run tests/gates.spec.ts tests/state.spec.ts` |
| 6 | 端点 | FP-08（TC-58 ~ TC-67） | `pnpm vitest run tests/gates.spec.ts -t endpoints` |
| 7 | 装配 | FP-01、FP-02（TC-01 ~ TC-17） | `pnpm build && pnpm vitest run tests/packs.spec.ts tests/catalog.spec.ts tests/roles.spec.ts` |
| 8 | 口径 | FP-22、FP-26、FP-29（TC-85 ~ TC-95、TC-111 ~ TC-116） | `pnpm vitest run tests/docs.spec.ts tests/gates.spec.ts` |
| 9 | 收口 | 全部 | `pnpm check` |
| 10 | 批三 · 装配与分发 | FP-11 ~ FP-21、FP-23 ~ FP-25、FP-27（TC-117 ~ TC-156） | `npx vitest run` + §8 各条给出的 `node`／`npm pack` 命令 |
| 11 | 批三 · 门自检 | 全量 | 临时 spec 调 `runGate('test', <001 绝对路径>)`，`pass` 必须为 `true` |

回归红线（design §9）：`tests/catalog.spec.ts`、`tests/roles.spec.ts` 的既有断言（除新增导出）、`tests/packs.spec.ts` 的 pack 隔离语义、`tests/tools.spec.ts` 的工具名与错误文本不得被改动；`tests/state.spec.ts` 的「坏文件被修复」用例按 FP-09 反转。

## 7. 台账自检

| 检查项 | 结果 |
|---|---|
| 覆盖 29 个功能点 | 29/29（见 §1 矩阵） |
| 用例条数 | 156，编号连续无空洞（TC-01 ~ TC-156） |
| 必含负例 | 24/24（§3 的 1~10 + 11~24） |
| 每条用例四要素（前置/步骤/期望/证据） | 156/156 |
| 期望含精确 code、退出码或输出字段 | 是；批三以退出码 + 关键输出行 + 文件行号三件套判定；仅 §4 标注的条目转人工 |
| 台账内出现未声明的 FP 编号 | 无；fixture 只用 `FP-01`/`FP-02`/`FP-03`/`FP-04`，脏编号用字符串拼接 |
| 台账内出现源码 `PLACEHOLDERS` 收录的占位词 | 无（已按该常量逐词扫描） |
| 台账自身无空节 | 是（每个标题都有正文） |

## 8. 批三补录：装配、分发与规范（TC-117 ~ TC-156）

本节补齐冻结档剩余的 15 个功能点：FP-11 ~ FP-21（11 个）与 FP-23、FP-24、FP-25、FP-27（4 个）。批三的判据多落在**仓库文件、生成物与脚本行为**上，不经过门禁函数，因此类型以 E2E 为主，「证据」写成「命令 + 关键输出行 + 文件行号」，执行者照命令即可复现。

### 8.0 批三执行约定

- 工作目录 = 仓库根；命令一律在仓库根执行，`node scripts/*.mjs` 就按相对路径写。
- 临时产物只写 `/tmp`（`/tmp/fp12`、`/tmp/fp13`、`/tmp/fp14`、`/tmp/fp15`、`/tmp/fp16b`、`/tmp/fp19`、`/tmp/fp24`、`/tmp/fp25`）。**真实 profile（`~/.dsh/profiles/desktop/cordis.patch.yml`）一律不碰**：FP-14 只用 `--profile <副本路径>`。
- 批三不 build、不改源码、不改 profile；`npm pack --dry-run` 只读清单，不产出 tarball。
- 判定：每条用例给出显式退出码；`0` = 通过，非 `0` = 不通过。命令输出里的关键行必须逐字复现；容差只允许 npm/pnpm 的版本提示行。
- 环境基线：Node v22.17.0、pnpm 11.28.5；`~/.dsh/skill-packs/team-core`（9 技能）与 `~/.dsh/skill-packs/flutter` 均在位。

### FP-11 · `dsh-plugin-dev` 可装、命中本仓、依赖与兜底有声明

判据（`requirement.md:248`，主 PM 于 2026-11-04 修正）：8 角色可装；本仓命中；角色 manifest 与文档声明「依赖宿主提供的官方 `cordis-plugin-development`，本包 `include` 无法引用，环境不提供时按 `project-standard` §8.1 清单执行」。

#### TC-117 · 角色报告 8 个全部可装

- **FP**：FP-11 ｜ **类型**：E2E ｜ **性质**：正例
- **前置**：`lib/roles.js` 存在（源码形态需先 `pnpm build`，安装形态由包自带）；两个 pack 目录都在位
- **步骤**：`node scripts/roles.mjs; echo "EXIT=$?"`
- **期望**：exit 0；首行逐字为 `roles: 8 total — 8 mountable, 0 blocked`；第三行逐字为 `matched: backend-design, ops, pm, qa, dsh-plugin-dev`（该行由 `roleMatches` 对 cwd 顶层条目算出）；`✓` 行恰 8 条（4 core + 4 stack），每行带「命中／未命中」列；含 `✓ stack  dsh-plugin-dev   命中    全栈研发团队 · 插件开发（TypeScript）` 与 `✓ stack  frontend-vue     未命中  全栈研发团队 · 前端开发（Web）`；无 `✗` 行；不含 `include 校验失败`；末行逐字为 `(report only; pass --write to emit presets/roles.patch.yml, or --out <path> for a specific file)`
- **证据**：命令 + 首行/`matched:`/末行原文；生产锚点 `scripts/roles.mjs:96`（`loadRoles`）、`:97`（`planRoles`）、`:129`（首行）、`:131`（`matched:` 行）、`:134`（带命中列的报告行）、`:168`（report-only 提示）

#### TC-118 · 本仓命中 `dsh-plugin-dev`（两个 detect 标记都在）

- **FP**：FP-11 ｜ **类型**：E2E ｜ **性质**：正例
- **前置**：仓库根 = `dsh-fullstack-team`
- **步骤**：
```bash
test -f cordis.patch.yml && test -f tsdown.config.ts && echo HIT
ls vite.config.* 2>/dev/null || echo NO-VITE
ls pubspec.yaml 2>/dev/null || echo NO-FLUTTER
```
- **期望**：依次输出 `HIT`、`NO-VITE`、`NO-FLUTTER`；与 `roles/dsh-plugin-dev.role.yml:6-7` 的 `detect: [[cordis.patch.yml, tsdown.config.ts]]`（同一组，组内 AND）两项全中一致；`frontend-vue` 的组 `[[package.json, vite.config.ts]]` 差 `vite.config.ts`，`backend-java` 的三个单元素组 `[pom.xml, build.gradle, build.gradle.kts]` 全缺
- **证据**：`roles/dsh-plugin-dev.role.yml:5`（组语义注释）、`:6`、`:7`；`roles/frontend-vue.role.yml:6-7`；`roles/backend-java.role.yml:6-9`；命令输出三行

#### TC-119 · 负例 11：`include` 不得硬写官方 `cordis-plugin-development`，依赖须由声明 + §8.1 兜底

- **FP**：FP-11 ｜ **类型**：E2E ｜ **性质**：负例
- **前置**：`roles/dsh-plugin-dev.role.yml`、`docs/dev/project-standard.md` 可读；工作目录 = 仓库根
- **判据变更**：主 PM 于 2026-11-04 修正 FP-11 验收标准（`requirement.md:248`）：不再要求 `include` 出现官方技能，改为要求 manifest 与文档**声明依赖 + 兜底路径**。原因是本包 `include` 只服务本包 provider 的技能，`cordis-plugin-development` 随宿主安装包提供、不在本包 provider 里；硬写会命中启动校验（`src/index.ts:237-243`）而按 FP-02 启动失败。因此「`include` 出现该名字」从达标条件变为必须避免的形态。
- **步骤**：
```bash
node -e "
const fs=require('fs'),YAML=require('yaml');
const role=YAML.parse(fs.readFileSync('roles/dsh-plugin-dev.role.yml','utf8'));
const std=fs.readFileSync('docs/dev/project-standard.md','utf8');
const desc=role.description||'', include=role.include||[];
const ok=[
  ['description names the dependency', desc.includes('cordis-plugin-development')],
  ['description names §8.1 fallback', desc.includes('§8.1')],
  ['description says include cannot reference it', desc.includes('include')&&desc.includes('引用不到')],
  ['§8.1 section exists', /### 8\.1 /.test(std)],
  ['§8.1 declares host-side equivalent', std.includes('宿主侧等价物')],
  ['§8.1 explains hard-writing fails per FP-02', std.includes('FP-02')&&std.includes('启动失败')],
  ['include does NOT list cordis-plugin-development', !include.includes('cordis-plugin-development')],
];
for(const [name,pass] of ok) console.log((pass?'PASS':'FAIL'),name);
console.log('include=',include.join(','));
console.log('ALL=',ok.every(([,p])=>p));
process.exit(ok.every(([,p])=>p)?0:1);
"
echo "EXIT=$?"
```
- **期望**：exit 0；7 行逐字为 `PASS`（依次为 `description names the dependency`、`description names §8.1 fallback`、`description says include cannot reference it`、`§8.1 section exists`、`§8.1 declares host-side equivalent`、`§8.1 explains hard-writing fails per FP-02`、`include does NOT list cordis-plugin-development`）；`include= role-init,dev-orchestrator,requirement-clarify,acceptance-guard`；`ALL= true`。最后一条是本用例的负例断言：`include` 一旦出现 `cordis-plugin-development` 即 FAIL（硬写会按 FP-02 启动失败），不再以「include 含该技能」作为通过条件
- **证据**：`roles/dsh-plugin-dev.role.yml:3`（description 声明依赖、`include` 引用不到、§8.1 兜底）、`:8-12`（include 四项）；`docs/dev/project-standard.md:92`（§8.1 标题）、`:94`（12 条清单＝宿主侧等价物；硬写会按 FP-02 启动失败）；`src/index.ts:237-243`（启动校验）、`src/roles.ts:190`（离线同规则 `checkRoleIncludes`）；命令 + 7 行 `PASS` + `ALL= true`

### FP-12 · `detect` 语义定死为「组内 AND、组间 OR」，并可执行

判据（`requirement.md:249`）：文档与代码同一语义；本仓不被判成 `frontend-vue`；只含 `pom.xml` 的仓能命中 `backend-java`。

#### TC-120 · 文档侧：同一格用 `+` 表示组内两个标记都要命中

- **FP**：FP-12 ｜ **类型**：E2E ｜ **性质**：正例（文档）
- **前置**：无
- **步骤**：`nl -ba skills/role-init/SKILL.md | sed -n '14,22p'`
- **期望**：第 17 行逐字为 ``| `package.json` + `vite.config.*`（同一组，两个都要在） | `frontend-vue` |``（同一格、` + ` 连接，即组内 AND）；第 16 行的 Java 用「或」连三个构建文件（三个单元素组，组间 OR）；第 20 行逐字给出「组内 AND、组间 OR」并说明字符串即单元素组；第 22 行声明 `detect` 是唯一事实来源，且代码落点为 `src/roles.ts` 的 `roleMatches(role, markers)`；表里没有把 Vue 的两个标记拆成两行各行成规则的写法
- **证据**：`skills/role-init/SKILL.md:14-18`（表）、`:20`（组语义）、`:22`（唯一事实来源 + 代码落点）；数据锚点 `roles/frontend-vue.role.yml:6-7`（同一组）、`roles/backend-java.role.yml:6-9`（三个单元素组）

#### TC-121 · 只命中一个标记的仓库不判成 stack 角色

- **FP**：FP-12 ｜ **类型**：E2E ｜ **性质**：正例（构造仓库）
- **前置**：
```bash
rm -rf /tmp/fp12 && mkdir -p /tmp/fp12/repo-only-package && : > /tmp/fp12/repo-only-package/package.json
```
- **步骤**：
```bash
node -e "
const fs=require('fs');
import('./lib/roles.js').then(({loadRoles, roleMatches})=>{
  const markers=new Set(fs.readdirSync('/tmp/fp12/repo-only-package'));
  const roles=loadRoles('roles');
  const hits=roles.filter(r=>roleMatches(r,markers));
  console.log('markers:',JSON.stringify([...markers]));
  console.log('stack roles matched:',JSON.stringify(hits.filter(r=>r.kind==='stack').map(r=>r.id)));
  console.log('frontend-vue matched:',hits.some(r=>r.id==='frontend-vue'));
  process.exit(hits.some(r=>r.kind==='stack')?1:0);
})"
echo "EXIT=$?"
```
- **期望**：exit 0；`markers: ["package.json"]`、`stack roles matched: []`、`frontend-vue matched: false`——只命中 `package.json` 一个标记时，`frontend-vue`（同一组还差 `vite.config.ts`）与其余 stack 角色都不命中
- **证据**：命令 + 三行输出；`src/roles.ts:143`（`roleMatches`）；`roles/frontend-vue.role.yml:6-7`、`roles/dsh-plugin-dev.role.yml:6-7`

#### TC-122 · 负例 12：只命中一个标记不得判成 stack 角色（组内 AND、组间 OR，可执行）

- **FP**：FP-12 ｜ **类型**：E2E ｜ **性质**：负例（判定边界）
- **前置**：
```bash
rm -rf /tmp/fp12-java /tmp/fp12-node
mkdir -p /tmp/fp12-java /tmp/fp12-node
: > /tmp/fp12-java/pom.xml
: > /tmp/fp12-node/package.json
```
- **步骤**：
  1. 直接调产品函数（`lib/roles.js` 为当前构建产物）：
```bash
node -e "
import('./lib/roles.js').then(({loadRoles, roleMatches}) => {
  const roles = loadRoles('roles')
  const find = (id) => roles.find(r => r.id === id)
  const cases = [
    ['backend-java', new Set(['pom.xml'])],
    ['backend-java', new Set(['build.gradle.kts'])],
    ['backend-java', new Set([])],
    ['frontend-vue', new Set(['package.json'])],
    ['frontend-vue', new Set(['package.json','vite.config.ts'])],
    ['dsh-plugin-dev', new Set(['cordis.patch.yml'])],
    ['dsh-plugin-dev', new Set(['cordis.patch.yml','tsdown.config.ts'])],
  ]
  for (const [id, markers] of cases) console.log(id, JSON.stringify([...markers]), '=>', roleMatches(find(id), markers))
})"
```
  2. CLI 在构造目录与仓库根上真跑：
```bash
(cd /tmp/fp12-java && node <仓库根>/scripts/roles.mjs); echo "EXIT=$?"
(cd /tmp/fp12-node && node <仓库根>/scripts/roles.mjs); echo "EXIT=$?"
node scripts/roles.mjs; echo "EXIT=$?"
```
- **期望**：
  - 函数矩阵逐行为 `backend-java ["pom.xml"] => true`、`backend-java ["build.gradle.kts"] => true`、`backend-java [] => false`、`frontend-vue ["package.json"] => false`、`frontend-vue ["package.json","vite.config.ts"] => true`、`dsh-plugin-dev ["cordis.patch.yml"] => false`、`dsh-plugin-dev ["cordis.patch.yml","tsdown.config.ts"] => true`
  - java-only：`matched: backend-design, ops, pm, qa, backend-java`——只有一个 `pom.xml` 也命中 Java（证组间 OR；纯组内 AND 会让它永不命中）
  - node-only：`matched: backend-design, ops, pm, qa`，不含 `frontend-vue`（证组内 AND）
  - 仓库根：`matched: backend-design, ops, pm, qa, dsh-plugin-dev`，含 `dsh-plugin-dev`、不含 `frontend-vue`
  - 三条命令 exit 0
- **证据**：`src/roles.ts:143`（`roleMatches`）、`:147-149`（`some` 跨组、`every` 组内）；`scripts/roles.mjs:104-106`（读 cwd 顶层标记并调用 `roleMatches`）、`:131`（`matched:` 输出）；单测 `tests/roles.spec.ts:108`、`:114`、`:120`、`:127`、`:145`、`:152`；命令输出原文

### FP-13 · 角色装备补齐（pm + impeccable/taste；mobile-flutter + acceptance-guard）

判据（`requirement.md:250`）：双闸所需件在主 PM 装备内。

#### TC-123 · 生成物与 manifest 双向一致，且两项补齐都在

- **FP**：FP-13 ｜ **类型**：E2E ｜ **性质**：正例
- **前置**：`presets/roles.patch.yml` 为最新生成物
- **步骤**：
```bash
node -e "
const fs=require('fs'),YAML=require('yaml');
const file=process.argv[1]||'presets/roles.patch.yml';
const doc=YAML.parse(fs.readFileSync(file,'utf8'));
const presets=doc.filter(e=>e.insert).flatMap(e=>e.insert).filter(p=>p.id&&p.id.startsWith('preset-'));
const seen={};
for(const p of presets){const plugin=p.config.plugins.find(x=>x.id==='dsh-fullstack-team');seen[p.config.id]=plugin.config.include}
const pm=seen.pm||[], mf=seen['mobile-flutter']||[];
const pmOk=pm.includes('impeccable')&&pm.includes('taste');
const mfOk=mf.includes('acceptance-guard');
console.log('pm has impeccable/taste=',pmOk);
console.log('mobile-flutter has acceptance-guard=',mfOk);
let bad=0;
for(const f of fs.readdirSync('roles').filter(f=>f.endsWith('.role.yml'))){const r=YAML.parse(fs.readFileSync('roles/'+f,'utf8'));const got=seen[r.id];if(!got||got.slice().sort().join(',')!==r.include.slice().sort().join(',')){bad++;console.log('MISMATCH',r.id,JSON.stringify(got),JSON.stringify(r.include))}}
console.log('manifest/preset mismatches=',bad);
process.exit(pmOk&&mfOk&&bad===0?0:1)
" 2>/dev/null
echo "EXIT=$?"
```
- **期望**：exit 0；输出 `pm has impeccable/taste= true`、`mobile-flutter has acceptance-guard= true`、`manifest/preset mismatches= 0`
- **证据**：`presets/roles.patch.yml:429-440`（pm 的 10 项 include）、`:1150-1156`（mobile-flutter 的 5 项）；`roles/pm.role.yml:5-15`；`roles/mobile-flutter.role.yml:7-12`

#### TC-124 · 负例 13：生成物少一项必须被发现

- **FP**：FP-13 ｜ **类型**：E2E ｜ **性质**：负例
- **前置**：复制生成物到 `/tmp`，删掉 pm 块里的 `- taste` 一行
- **步骤**：
```bash
mkdir -p /tmp/fp13 && cp presets/roles.patch.yml /tmp/fp13/presets.yml
node -e "const fs=require('fs');const p='/tmp/fp13/presets.yml';const lines=fs.readFileSync(p,'utf8').split('\n');const i=lines.findIndex(l=>l.trim()==='- taste');lines.splice(i,1);fs.writeFileSync(p,lines.join('\n'))"
# 再跑 TC-123 的脚本，只把 presets 路径换成 /tmp/fp13/presets.yml
node -e "<TC-123 的脚本原文>" /tmp/fp13/presets.yml; echo "EXIT=$?"
```
- **期望**：exit 1；输出 `pm has impeccable/taste= false` 与 `MISMATCH pm`（生成物缺 `taste` 时断言必须失败）
- **证据**：命令 + `MISMATCH pm` 行；对照 `roles/pm.role.yml:10-11`

### FP-14 · 预设安装脚本：生成 → 合并 → 备份 → 幂等 → 回滚

判据（`requirement.md:251`）：一条命令完成生成 + 合并 + 提示重启；重复执行不产生重复 id。

#### TC-125 · `--dry-run` 不写盘、不备份

- **FP**：FP-14 ｜ **类型**：E2E ｜ **性质**：正例
- **前置**：`/tmp/fp14/dry/cordis.patch.yml` 为手写副本
- **步骤**：
```bash
mkdir -p /tmp/fp14/dry && printf '%s\n' "- id: ui-chat" "  name: '@deepseek-ai/dsh-client-ui-chat'" > /tmp/fp14/dry/cordis.patch.yml
before=$(shasum -a 256 /tmp/fp14/dry/cordis.patch.yml | cut -d' ' -f1)
node scripts/install-presets.mjs --dry-run --profile /tmp/fp14/dry/cordis.patch.yml; echo "EXIT=$?"
after=$(shasum -a 256 /tmp/fp14/dry/cordis.patch.yml | cut -d' ' -f1)
echo "same=$([ \"$before\" = \"$after\" ] && echo yes || echo no)"; ls /tmp/fp14/dry
```
- **期望**：exit 0；`same=yes`；目录里只有 `cordis.patch.yml`（无 `.bak-*`）；stdout 含 `dry-run：以下变更不会写入任何文件`、`预设      8 个：preset-backend-design, ...`、`备份      ...bak-<时间戳>（合并前）`、`区域外    8 行保持原样` 这一类计划行。注：输出里还会出现 `wrote /var/folders/.../dsh-presets-*/roles.patch.yml`，那是生成器写到临时目录的中间产物；dry-run 不写 profile，副本 sha256 不变
- **证据**：`scripts/install-presets.mjs:433`（dry-run 分支）、`:436-445`（计划输出）；命令 + `same=yes`

#### TC-126 · 真实合并：追加块、备份、结构校验

- **FP**：FP-14 ｜ **类型**：E2E ｜ **性质**：正例
- **前置**：副本没有本插件的块（只有两条无关条目）
- **步骤**：
```bash
mkdir -p /tmp/fp14/merge && printf '%s\n' "# scratch profile (copy)" "- id: ui-chat" "  name: '@deepseek-ai/dsh-client-ui-chat'" "" "- id: ui-settings" "  name: '@deepseek-ai/dsh-client-ui-settings'" > /tmp/fp14/merge/cordis.patch.yml
node scripts/install-presets.mjs --profile /tmp/fp14/merge/cordis.patch.yml; echo "EXIT=$?"
ls /tmp/fp14/merge
node -e "
const fs=require('fs');
const lines=fs.readFileSync('/tmp/fp14/merge/cordis.patch.yml','utf8').split('\n');
const ids=lines.map(l=>/^\s+-\s+id:\s+(preset-[\w.-]+)\s*$/.exec(l)?.[1]).filter(Boolean);
console.log('presets=',ids.length,'unique=',new Set(ids).size);
console.log('registry=',lines.some(l=>l.startsWith('- id: agent-preset-registry')));
"
```
- **期望**：exit 0；`ls` 出现 `cordis.patch.yml` 与 `cordis.patch.yml.bak-<时间戳>`；`presets= 8 unique= 8`；`registry= true`；stdout 含 `已合并 8 个预设`、`备份：`、`区域外 ... 行未改动；结构校验通过`、`重启 DSH`
- **证据**：`scripts/install-presets.mjs:476-482`；命令输出；`tests/scripts/install-presets.spec.ts:93`（有单测同款，9 例通过）

#### TC-127 · 幂等：第二次执行不写、不新增备份

- **FP**：FP-14 ｜ **类型**：E2E ｜ **性质**：正例
- **前置**：TC-126 已合并完成的同一副本
- **步骤**：
```bash
h1=$(shasum -a 256 /tmp/fp14/merge/cordis.patch.yml | cut -d' ' -f1)
node scripts/install-presets.mjs --profile /tmp/fp14/merge/cordis.patch.yml; echo "EXIT=$?"
h2=$(shasum -a 256 /tmp/fp14/merge/cordis.patch.yml | cut -d' ' -f1)
echo "same=$([ \"$h1\" = \"$h2\" ] && echo yes || echo no)"; ls /tmp/fp14/merge
```
- **期望**：exit 0；`same=yes`；`ls` 仍只有 1 个 `.bak-*`；stdout 含 `已是最新：/tmp/fp14/merge/cordis.patch.yml 与生成物一致（8 个预设），未写入、未备份`
- **证据**：`scripts/install-presets.mjs:452`；`tests/scripts/install-presets.spec.ts:111`；命令输出

#### TC-128 · 负例 14：合并后校验失败必须回滚并退出 1

- **FP**：FP-14 ｜ **类型**：E2E ｜ **性质**：负例
- **前置**：副本里预先放两个重复的顶层 id（`ui-chat` 出现两次），模拟 profile 原有内容不自洽
- **步骤**：
```bash
mkdir -p /tmp/fp14/rb && printf '%s\n' "- id: ui-chat" "  name: '@deepseek-ai/dsh-client-ui-chat'" "- id: ui-chat" "  name: '@deepseek-ai/dsh-client-ui-chat'" > /tmp/fp14/rb/cordis.patch.yml
h0=$(shasum -a 256 /tmp/fp14/rb/cordis.patch.yml | cut -d' ' -f1)
node scripts/install-presets.mjs --profile /tmp/fp14/rb/cordis.patch.yml; echo "EXIT=$?"
h1=$(shasum -a 256 /tmp/fp14/rb/cordis.patch.yml | cut -d' ' -f1)
echo "restored=$([ \"$h0\" = \"$h1\" ] && echo yes || echo no)"
```
- **期望**：exit 1；`restored=yes`；stderr 含 `合并后校验失败，已回滚`、`✗ 顶层条目 id 重复：ui-chat`；不得出现 `已合并`
- **证据**：`scripts/install-presets.mjs:467-474`；`tests/scripts/install-presets.spec.ts:147`（`rolls back and exits non-zero when verification fails`）；命令输出

### FP-15 · 本仓 `project-standard.md`（九章）与 `project-manifest.md`（角色集）

判据（`requirement.md:252`）：两文件存在并声明本仓角色集。

#### TC-129 · 九章齐、角色集明确

- **FP**：FP-15 ｜ **类型**：E2E ｜ **性质**：正例
- **前置**：两个文件存在
- **步骤**：
```bash
test -f docs/dev/project-standard.md && echo STD-OK
test -f docs/dev/project-manifest.md && echo MANIFEST-OK
grep -c '^## [1-9]\.' docs/dev/project-standard.md
grep -n '角色集\|不装' docs/dev/project-manifest.md
```
- **期望**：`STD-OK`、`MANIFEST-OK`；标题计数 `9`；manifest 第 9 行 `| 角色集 | \`pm\`、\`backend-design\`、\`dsh-plugin-dev\`、\`qa\`、\`ops\` |`，第 10 行 `| 不装 | \`backend-java\`、\`frontend-vue\`、\`mobile-flutter\`（detect 不命中） |`
- **证据**：`docs/dev/project-standard.md:6`、`:17`、`:37`、`:45`、`:49`、`:70`、`:74`、`:88`、`:109`（九章）；`docs/dev/project-manifest.md:9-10`

#### TC-130 · 负例 15：少一章或缺一个角色必须被发现

- **FP**：FP-15 ｜ **类型**：E2E ｜ **性质**：负例
- **前置**：副本 `/tmp/fp15`
- **步骤**：
```bash
mkdir -p /tmp/fp15 && cp docs/dev/project-standard.md docs/dev/project-manifest.md /tmp/fp15/
node -e "
const fs=require('fs');
const base='/tmp/fp15';
const std=fs.readFileSync(base+'/project-standard.md','utf8').split('\n').filter(l=>/^## [1-9]\./.test(l)).length;
const man=fs.readFileSync(base+'/project-manifest.md','utf8');
const ids=['pm','backend-design','dsh-plugin-dev','qa','ops'];
const missing=ids.filter(id=>!man.includes('\`'+id+'\`'));
console.log('chapters=',std,'missing roles=',JSON.stringify(missing));
process.exit(std===9&&missing.length===0?0:1)
"; echo "EXIT=$?"
```
- **期望**：副本未改动时 exit 0、`chapters= 9 missing roles= []`；把副本 `## 9.` 整章删掉或删掉含 `\`qa\`` 的行后重跑，必须 exit 1 并分别报出 `chapters= 8` 或 `missing roles= ["qa"]`
- **证据**：命令 + 两次输出；对照 `docs/dev/project-standard.md:109`、`docs/dev/project-manifest.md:9`

### FP-16 · README/docs 与实现对齐（技能数、包来源、断链）

判据（`requirement.md:253`）：无断链；技能数与实况一致。

#### TC-131 · 三个过时说法已消失

- **FP**：FP-16 ｜ **类型**：E2E ｜ **性质**：正例
- **前置**：无
- **步骤**：
```bash
grep -rn "Nine Agent Skills\|SKILL-SYSTEM\.md\|SKILL-INDEX\.md" README.md docs/*.md; echo "GREP-EXIT=$?"
```
- **期望**：无匹配、`GREP-EXIT=1`；README 第 10 行写「ships **one** Agent Skill of its own — `role-init`」，与 `ls skills` 只有 `role-init` 一致
- **证据**：`README.md:10`；`ls skills` 输出 `role-init`

#### TC-132 · 本地链接体检 10 条全部可解析

- **FP**：FP-16 ｜ **类型**：E2E ｜ **性质**：正例
- **前置**：无
- **步骤**：
```bash
node -e "
const fs=require('fs'),path=require('path');
const files=['README.md',...fs.readdirSync('docs').filter(f=>f.endsWith('.md')).map(f=>'docs/'+f)];
let bad=0,total=0;
for(const f of files){const text=fs.readFileSync(f,'utf8');
  for(const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){let t=m[1].trim();
    if(t.startsWith('http')||t.startsWith('mailto:')||t.startsWith('#'))continue;
    t=t.split('#')[0]; if(!t)continue; total++;
    if(!fs.existsSync(path.resolve(path.dirname(f),t))){bad++;console.log('BROKEN',f,'->',m[1])}}}
console.log('local links checked',total,'broken',bad);
process.exit(bad?1:0)
"
echo "EXIT=$?"
```
- **期望**：exit 0；`local links checked 10 broken 0`
- **证据**：命令 + 输出行；链接清单见 `README.md` 的 `docs/*.md` 与 `examples/*.yml` 引用（`:96-128` 一带）

#### TC-133 · 负例 16：注入断链必须被发现

- **FP**：FP-16 ｜ **类型**：E2E ｜ **性质**：负例
- **前置**：把 README 连同 `docs/`、`examples/` 复制到 `/tmp/fp16b`，再追加一条指向 `docs/NOPE.md` 的链接
- **步骤**：
```bash
rm -rf /tmp/fp16b && mkdir -p /tmp/fp16b && cp README.md /tmp/fp16b/README.md && cp -R docs /tmp/fp16b/docs && cp -R examples /tmp/fp16b/examples
printf '\n见 [方案](docs/NOPE.md)。\n' >> /tmp/fp16b/README.md
# 用 TC-132 的脚本，root 改为 /tmp/fp16b、files 只含 README.md
node -e "<TC-132 脚本，root 换成 /tmp/fp16b>" ; echo "EXIT=$?"
```
- **期望**：exit 1；`checked 11 broken 1 ["docs/NOPE.md"]`（断链被点名）
- **证据**：命令 + 输出行

### FP-17 · CI：`pnpm check` + skill-audit + 真包集成

判据（`requirement.md:254`）：push/PR 自动跑，失败即红。

#### TC-134 · 两条命令都在工作流里，触发覆盖 push 与 PR

- **FP**：FP-17 ｜ **类型**：E2E ｜ **性质**：正例
- **前置**：`.github/workflows/ci.yml` 存在
- **步骤**：
```bash
test -f .github/workflows/ci.yml && echo CI-OK
grep -c 'run: pnpm check' .github/workflows/ci.yml
grep -c 'node scripts/skill-audit.mjs skills' .github/workflows/ci.yml
grep -n '^on:\|^  push:\|^  pull_request:' .github/workflows/ci.yml
grep -n 'name: check (node 24)\|Note skipped real-pack cases' .github/workflows/ci.yml
```
- **期望**：`CI-OK`；两个计数均为 `1`；`on:` 下有 `push:` 与 `pull_request:`；job 名 `check (node 24)` 与步骤 `Note skipped real-pack cases` 都在；真包集成由 `pnpm check` → `pnpm test` → `vitest` 收集 `tests/integration/*.spec.ts`（工作流注释与摘要步骤明确「缺包则 skip 并说明」）
- **证据**：`.github/workflows/ci.yml:36`、`:41`、`:46-62`；`package.json` 的 `check` 脚本串（`typecheck && test && audit:skills && build`）

#### TC-135 · 负例 17：缺 skill-audit 步骤即不达标

- **FP**：FP-17 ｜ **类型**：E2E ｜ **性质**：负例
- **前置**：复制工作流到 `/tmp/fp17/ci.yml`，删掉 skill-audit 步骤
- **步骤**：
```bash
mkdir -p /tmp/fp17 && cp .github/workflows/ci.yml /tmp/fp17/ci.yml
node -e "const fs=require('fs');const p='/tmp/fp17/ci.yml';const l=fs.readFileSync(p,'utf8').split('\n').filter(x=>!x.includes('node scripts/skill-audit.mjs skills'));fs.writeFileSync(p,l.join('\n'))"
grep -c 'node scripts/skill-audit.mjs skills' /tmp/fp17/ci.yml; echo "COUNT-EXIT=$?"
grep -c 'run: pnpm check' /tmp/fp17/ci.yml
```
- **期望**：`grep -c` 输出 `0` 且 `COUNT-EXIT=1`（缺即判失败）；原文件计数必须为 1。另断言工作流没有 `--exclude tests/integration`（`grep` 无匹配、exit 1），即集成用例不会被静默排除
- **证据**：命令 + 计数行；`.github/workflows/ci.yml:41`

### FP-18 · `role-init` 的命令可移植

判据（`requirement.md:255`）：用户项目内执行能定位包内脚本，或明确说明在包目录执行。

#### TC-136 · `pnpm test` 段落写清包形态与失败处置

- **FP**：FP-18 ｜ **类型**：E2E ｜ **性质**：正例
- **前置**：无
- **步骤**：`sed -n '112,122p' skills/role-init/SKILL.md`
- **期望**：出现 `pnpm test`；写明「发布包不含 tests/ 与 src/」；写明「把『`pnpm test` 未执行，原因是没有源码目录』报告给用户」；写明不得冒充验证通过（「禁止用别的手段冒充」）
- **证据**：`skills/role-init/SKILL.md:114-122`（尤其 `:120`、`:122`）

#### TC-137 · 负例 18：安装形态声称 `pnpm test` 通过即不达标

- **FP**：FP-18 ｜ **类型**：E2E ｜ **性质**：负例
- **前置**：无
- **步骤**：
```bash
grep -c '发布包不含 tests/ 与 src/' skills/role-init/SKILL.md
grep -c '报告给用户' skills/role-init/SKILL.md
grep -c '禁止用别的手段冒充' skills/role-init/SKILL.md
```
- **期望**：三个计数均 ≥ 1（当前 1/1/1）；任一为 0 → 判失败。另断言 `skills/role-init/SKILL.md` 不存在「在安装形态运行 pnpm test 即可」这类断言（`grep -n '安装形态.*pnpm test.*通过'` 无匹配、exit 1）
- **证据**：`skills/role-init/SKILL.md:120`、`:122`

### FP-19 · 真包集成测试（team-core + 角色 include）

判据（`requirement.md:256`）：断言每角色可见技能集合符合 manifest；FP-01/02 有回归。

#### TC-138 · 有 pack：3 条全过

- **FP**：FP-19 ｜ **类型**：集成 ｜ **性质**：正例
- **前置**：`~/.dsh/skill-packs/team-core` 存在
- **步骤**：`npx vitest run tests/integration; echo "EXIT=$?"`
- **期望**：exit 0；输出 `tests/integration/real-pack.spec.ts (3 tests)` 与 `Tests  3 passed (3)`；三条分别覆盖：发现集合 = 内置 `role-init` + pack 9 技能、`impeccable` 正文 rebase 后无外部前缀、`roles/*.role.yml` 的 include 全部可解析
- **证据**：`tests/integration/real-pack.spec.ts:77`、`:86`、`:98`；命令输出

#### TC-139 · 无 pack：3 条 skip，不得记为通过

- **FP**：FP-19 ｜ **类型**：集成 ｜ **性质**：正例（跳过分支）
- **前置**：把 `HOME` 指到空目录，令 `expandDir('~/.dsh/...')` 找不到 pack
- **步骤**：`HOME=/tmp/fp19 npx vitest run tests/integration; echo "EXIT=$?"`
- **期望**：exit 0；输出 `tests/integration/real-pack.spec.ts (3 tests | 3 skipped)` 与 `Tests  3 skipped (3)`，**不得**出现 `passed`；警告行说明「跳过真包集成：未找到 ...」；`test-report.md` 必须按 SKIP 记录
- **证据**：`tests/integration/real-pack.spec.ts:52-58`（skip 与警告）；命令输出

### FP-20 · 展示元数据（locale / icon / exports / files）

判据（`requirement.md:257`）：`meta.title`/`meta.description` 非空；`icon.svg` 有效且 ≤256 KiB；`exports` 含 `./locale/*.json` 与 `./icon`；`files` 补齐。

#### TC-140 · 两种语言都有非空标题与描述

- **FP**：FP-20 ｜ **类型**：E2E ｜ **性质**：正例
- **前置**：`locale/en.json`、`locale/zh.json` 存在
- **步骤**：
```bash
node -e "
const fs=require('fs');
for(const l of ['en','zh']){const j=JSON.parse(fs.readFileSync('locale/'+l+'.json','utf8'));
 const t=(j.meta&&j.meta.title||'').trim(), d=(j.meta&&j.meta.description||'').trim();
 console.log(l,'title=',t.length,'description=',d.length); if(!t||!d) process.exit(1)}
"; echo "EXIT=$?"
```
- **期望**：exit 0；`en title= 15 description= 226`、`zh title= 6 description= 85`（长度只作非空证据，具体数值随文案变；断言是「均非空」）
- **证据**：`locale/en.json:3-4`；`locale/zh.json:3-4`；命令输出

#### TC-141 · 图标是有效 SVG 且远小于 256 KiB

- **FP**：FP-20 ｜ **类型**：E2E ｜ **性质**：正例
- **前置**：`icon.svg` 在包内
- **步骤**：
```bash
node -e "
const fs=require('fs');const s=fs.statSync('icon.svg');const t=fs.readFileSync('icon.svg','utf8');
console.log('bytes=',s.size);console.log('svg=',t.startsWith('<svg')&&t.trim().endsWith('</svg>'));
process.exit(s.size<256*1024&&t.startsWith('<svg')&&t.trim().endsWith('</svg>')?0:1)
"; echo "EXIT=$?"
```
- **期望**：exit 0；`bytes= 471`；`svg= true`（首字符 `<svg`、末字符 `</svg>`，`xmlns` 存在）
- **证据**：`icon.svg:1`；`package.json` 的 `files` 含 `icon.svg`

#### TC-142 · 负例 19：`exports`/`files` 缺一项即不达标

- **FP**：FP-20 ｜ **类型**：E2E ｜ **性质**：负例
- **前置**：无
- **步骤**：
```bash
node -e "
const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));
const ex=p.exports||{}, fl=p.files||[];
const ok=ex['./locale/*.json']==='./locale/*.json'&&ex['./icon']==='./icon.svg'&&fl.includes('locale/*.json')&&fl.includes('icon.svg');
console.log('exports locale=',ex['./locale/*.json'],'icon=',ex['./icon']);
console.log('files has locale/icon=',fl.includes('locale/*.json'),fl.includes('icon.svg'));
console.log('ok=',ok);process.exit(ok?0:1)
"; echo "EXIT=$?"
```
- **期望**：exit 0、`ok= true`；把 `/tmp` 副本里的 `"./icon": "./icon.svg"` 删掉后重跑同一脚本（读副本路径）必须 exit 1、`ok= false`
- **证据**：`package.json:29-33`（exports）、`:35-38`（files）；命令输出

### FP-21 · 技能内命令按安装形态修正

判据（`requirement.md:258`）：技能给出的每条命令在安装形态下可执行，或改为「报告给用户」。

#### TC-143 · 「先定包根」段落与 `PKG=` 推导都在

- **FP**：FP-21 ｜ **类型**：E2E ｜ **性质**：正例
- **前置**：无
- **步骤**：
```bash
grep -n '### 先定包根' skills/role-init/SKILL.md
grep -n 'PKG="$(cd "<skill 目录>/../.." && pwd)"' skills/role-init/SKILL.md
grep -n '包根' docs/005-skill-hygiene.md | head -3
```
- **期望**：命中 `skills/role-init/SKILL.md:31`（小节标题）、`:38`（`PKG=` 推导）；`docs/005-skill-hygiene.md:30` 说明「脚本在包根、换目录用绝对路径」
- **证据**：`skills/role-init/SKILL.md:31-50`；`docs/005-skill-hygiene.md:30`

#### TC-144 · 负例 20：把 `pwd` 当包根即不达标

- **FP**：FP-21 ｜ **类型**：E2E ｜ **性质**：负例
- **前置**：无
- **步骤**：
```bash
grep -c '不要拿 `pwd` 假设当前目录就是包根' skills/role-init/SKILL.md
grep -c '但你必须在包根执行' skills/role-init/SKILL.md
```
- **期望**：第一个计数为 1（`:43`）；第二个为 0（不存在「必须在包根执行」这类未给推导的硬要求）。任一不符 → 判失败
- **证据**：`skills/role-init/SKILL.md:43`、`:50`

### FP-23 · 分发与安装形态

判据（`requirement.md:260`）：发布包可安装可加载；README 安装说明齐。

#### TC-145 · 包清单含运行时文件、不含 tests/src

- **FP**：FP-23 ｜ **类型**：E2E ｜ **性质**：正例
- **前置**：根 `package.json` 的 `files` 已补齐
- **步骤**：
```bash
npm pack --dry-run --json --ignore-scripts 2>/dev/null > /tmp/pack.json
node -e "
const j=require('/tmp/pack.json');const f=j[0].files.map(x=>x.path);
const need=['lib/','locale/','icon.svg','scripts/','skills/','roles/','templates/','presets/','docs/','examples/','cordis.patch.yml'];
console.log('files=',f.length);
for(const p of need)console.log(p,f.some(x=>x.startsWith(p)));
console.log('tests=',f.some(x=>x.startsWith('tests/')),'src=',f.some(x=>x.startsWith('src/')));
"
```
- **期望**：`files= 39`；11 个必备前缀全部 `true`；`tests= false src= false`
- **证据**：`package.json:35-48`（files 列表）；命令输出；`npm pack` 退出码 0

#### TC-146 · README 写清 git 安装先 build、peer 依赖不自装

- **FP**：FP-23 ｜ **类型**：E2E ｜ **性质**：正例
- **前置**：无
- **步骤**：
```bash
grep -n 'No `lib/`' README.md
grep -n 'Peer dependencies are not auto-installed' README.md
grep -n 'does \*\*not\*\* carry `src/` or `tests/`' README.md
```
- **期望**：命中 `README.md:73`（git 树无入口，先 `pnpm install && pnpm build` 或 `npm pack`）、`:74`（四个 peer 在 `autoInstallPeers:false` 下不会自装）、`:78`（发布包含 lib 等、不含 src/tests）
- **证据**：`README.md:73-78`

#### TC-147 · 负例 21：包内混入源码或测试即不达标；入口必须可加载

- **FP**：FP-23 ｜ **类型**：E2E ｜ **性质**：负例
- **前置**：TC-145 的 `/tmp/pack.json`
- **步骤**：
```bash
node -e "
const j=require('/tmp/pack.json');const f=j[0].files.map(x=>x.path);
const bad=f.filter(x=>x.startsWith('tests/')||x.startsWith('src/'));
console.log('bad entries=',JSON.stringify(bad));process.exit(bad.length?1:0)
"; echo "EXIT=$?"
node -e "import('./lib/index.js').then(m=>console.log('exports',Object.keys(m).join(','),'| apply is',typeof m.apply)).catch(e=>{console.error('LOAD FAIL',e.message);process.exit(1)})"; echo "LOAD-EXIT=$?"
```
- **期望**：`bad entries= []`、exit 0；`exports Config,apply,expandDir,inject,name | apply is function`、`LOAD-EXIT=0`（发布形态入口可加载）
- **证据**：命令输出；`.gitignore` 对 `lib/` 的说明与 `README.md:73`

### FP-24 · 生成器输出可配置、`providerName` 统一

判据（`requirement.md:261`）：生成物与 docs/examples 同口径；写入目标可配置。

#### TC-148 · `--out` 写指定路径且不改 `presets/roles.patch.yml`

- **FP**：FP-24 ｜ **类型**：E2E ｜ **性质**：正例
- **前置**：`/tmp/fp24` 可写
- **步骤**：
```bash
mkdir -p /tmp/fp24
before=$(shasum -a 256 presets/roles.patch.yml | cut -d' ' -f1)
node scripts/roles.mjs --out /tmp/fp24/out.yml; echo "EXIT=$?"
after=$(shasum -a 256 presets/roles.patch.yml | cut -d' ' -f1)
echo "presets-unchanged=$([ \"$before\" = \"$after\" ] && echo yes || echo no)"
ls -l /tmp/fp24/out.yml
```
- **期望**：exit 0；`presets-unchanged=yes`；`/tmp/fp24/out.yml` 存在（1171 行左右）；stdout 含 `wrote /tmp/fp24/out.yml` 与 `(presets/roles.patch.yml 未改动；--out 只写指定路径)`
- **证据**：`scripts/roles.mjs:145-155`；命令输出

#### TC-149 · 8 个预设的 `providerName` 都是 `dsh-fullstack-team`

- **FP**：FP-24 ｜ **类型**：E2E ｜ **性质**：正例
- **前置**：生成物与 `examples/`、`docs/002`
- **步骤**：
```bash
grep -c 'providerName: dsh-fullstack-team' presets/roles.patch.yml
grep -c 'providerName: dsh-fullstack-team' examples/role-preset.patch.yml examples/role-preset-flutter.patch.yml
grep -n 'never a per-role provider name\|not `dsh-fullstack-team-<role>`' docs/002-role-presets.md
```
- **期望**：生成物计数 `8`；两个 examples 各 `1`；`docs/002-role-presets.md:69` 明确「每个角色都是 `dsh-fullstack-team`，不是 `dsh-fullstack-team-<role>`」
- **证据**：`presets/roles.patch.yml:134`（8 处，行号 134/276/428/577/720/864/1007/1151）；`examples/role-preset.patch.yml:138`；`docs/002-role-presets.md:69`

#### TC-150 · 负例 22：`--out` 缺值必须报用法并退出 2

- **FP**：FP-24 ｜ **类型**：E2E ｜ **性质**：负例
- **前置**：无
- **步骤**：
```bash
node scripts/roles.mjs --out ""; echo "EXIT=$?"
node scripts/roles.mjs --out; echo "EXIT=$?"
```
- **期望**：两次均 exit 2；stderr 含 `用法：node scripts/roles.mjs [--write] [--out <path>]`；不得写出任何文件
- **证据**：`scripts/roles.mjs:46-51`；命令输出

### FP-25 · `skill-audit.mjs` 去硬编码

判据（`requirement.md:262`）：发布脚本不含任何具体项目事实；体检仍可跑。

#### TC-151 · 无 `project-facts.json` 时只用通用规则

- **FP**：FP-25 ｜ **类型**：E2E ｜ **性质**：正例
- **前置**：仓库根与工作区根都没有 `project-facts.json`
- **步骤**：`node scripts/skill-audit.mjs skills; echo "EXIT=$?"`
- **期望**：exit 0；首行 `规则：通用 5 条（未找到 project-facts.json，只用通用规则）`；末行 `技能体检通过：没有项目内容混进能力文件`
- **证据**：`scripts/skill-audit.mjs:231`；命令输出

#### TC-152 · 负例 23：给了项目事实清单就必须命中

- **FP**：FP-25 ｜ **类型**：E2E ｜ **性质**：负例
- **前置**：临时技能目录里写入项目词，另写一份 facts 文件
- **步骤**：
```bash
rm -rf /tmp/fp25 && mkdir -p /tmp/fp25/skill
printf '# 项目技能\n\n本技能服务 某某公司 的 mall-manage 仓，主表 biz_order。\n' > /tmp/fp25/skill/SKILL.md
printf '{"companyNames":["某某公司"],"repoNames":["mall-manage"],"tablePrefixes":["biz_"]}' > /tmp/fp25/facts.json
node scripts/skill-audit.mjs /tmp/fp25/skill --facts /tmp/fp25/facts.json; echo "WITH-FACTS-EXIT=$?"
node scripts/skill-audit.mjs /tmp/fp25/skill; echo "NO-FACTS-EXIT=$?"
```
- **期望**：有 facts 时 exit 1，首行 `规则：通用 5 条 + 项目 3 条（/tmp/fp25/facts.json）`，并输出 3 条命中（`[公司/项目名]`、`[业务仓名]`、`[业务表名]`），末行「共 3 处需要分离」；无 facts 时 exit 0 且未命中（通用规则不含这些词）
- **证据**：`scripts/skill-audit.mjs:184-222`（facts → rules）、`:231`；命令输出

#### TC-153 · 负例 24：脚本源码不得含被移除的项目事实

- **FP**：FP-25 ｜ **类型**：E2E ｜ **性质**：负例
- **前置**：无
- **步骤**：
```bash
grep -nE "shuangrui|科贸|领先未来|双蕊" scripts/skill-audit.mjs; echo "COMPANY-EXIT=$?"
grep -n "platform)-manage" scripts/skill-audit.mjs; echo "REPO-PATTERN-EXIT=$?"
```
- **期望**：两条 grep 均无匹配、退出码均为 1（git 历史里被删掉的公司名与「业务仓名」正则不得回来）；docstring 中的示例值（`mall-manage`、`merchant-web`、`biz_`、`t_`）只作为 JSON 示例出现，不构成规则；若这些示例名被判为「具体项目事实」，按 R-01 单列风险
- **证据**：`scripts/skill-audit.mjs:31-33`；git 历史 `97382aa chore: finish the separation — the audit is clean`

### FP-27 · `Config` 补 `packs[].hint`；工具参数判据下沉

判据（`requirement.md:264`）：`Config.listConfigs` 能看到 `hint`；参数描述自带判据。

#### TC-154 · `hint` 被运行时保留、在 schema 里可见且非必填

- **FP**：FP-27 ｜ **类型**：单测 ｜ **性质**：正例
- **前置**：无
- **步骤**：`npx vitest run tests/config.spec.ts; echo "EXIT=$?"`
- **期望**：exit 0；`tests/config.spec.ts (3 tests)` 全过；三条分别锁定：带 hint 的配置解析后 `packs[0].hint` 仍在、schema 中 `hint.type === 'string'` 且 `meta.required !== true`、不写 hint 时键不存在
- **证据**：`tests/config.spec.ts:21-30`、`:32-39`、`:41-47`；`src/index.ts:48`（`hint: z.string()`）

#### TC-155 · 三个参数的描述逐值给出判据

- **FP**：FP-27 ｜ **类型**：集成 ｜ **性质**：正例
- **前置**：临时 spec（跑完删除）注册工具并读 `parameters`
- **步骤**：
```bash
cat > tests/__tmp_probe.spec.ts <<'EOF'
import { describe, it } from 'vitest'
import { apply, type DevflowContext } from '../src/index'
describe('probe', () => {
  it('prints parameter criteria', () => {
    const tools: any[] = []
    const ctx: DevflowContext = { skills: { registerProvider: () => undefined }, tools: { register: (d) => tools.push(d) } }
    apply(ctx, { packs: [] })
    for (const tool of tools) {
      for (const key of ['stage', 'action', 'failure']) {
        const d = tool.parameters.properties[key]?.description
        if (d) console.log(tool.name, key, 'lines=', d.split('\n').length)
      }
    }
  })
})
EOF
npx vitest run tests/__tmp_probe.spec.ts 2>&1 | grep 'lines='
rm -f tests/__tmp_probe.spec.ts
```
- **期望**：输出 `devflow_gate stage lines= 6`、`devflow_state action lines= 5`、`devflow_state failure lines= 7`（1 行总述 + 5 个 gate / 4 个 action / 6 个 failure 各自的判据行）
- **证据**：`src/tools.ts:68-97`（`STAGE_DOC`/`ACTION_DOC`/`FAILURE_DOC`）、`:154`/`:198`/`:209`（挂到参数上）

#### TC-156 · 负例 25：任一枚举值缺判据即失败

- **FP**：FP-27 ｜ **类型**：集成 ｜ **性质**：负例
- **前置**：同上临时 spec，额外断言每个枚举值都出现在描述的独立行里
- **步骤**：在 TC-155 的 spec 里加入：
```ts
const st = tools.find(t => t.name === 'devflow_gate')!.parameters.properties.stage.description as string
const missing = ['clarify','design','test','accept','review'].filter(v => !st.split('\n').some(l => l.includes(v + ' — ')))
console.log('missing stage criteria:', JSON.stringify(missing))
```
- **期望**：`missing stage criteria: []`；`action` 的 4 个值（`read`/`advance`/`rework`/`reset`）与 `failure` 的 6 个类型同样逐个在独立行出现；缺任一 → 判失败
- **证据**：`src/tools.ts:68-97`；命令输出

### 8.4 批三证据回填要求

- 批三用例的证据形态固定为三件套：**命令原文** + **关键输出行原文** + **对应文件行号**。不接受「已测试」「符合预期」这类无输出的结论。
- 输出行里允许省略的部分只有：npm/pnpm 的版本升级提示、YAML 的 `TAG_RESOLVE_FAILED` 警告（§8 的 `node -e` 内省脚本建议加 `2>/dev/null`）。
- 退出码必须回填；`0` 之外的值一律按失败处理，除用例本身明确要求非零（TC-119、TC-122、TC-124、TC-128、TC-130、TC-133、TC-135、TC-150、TC-152、TC-153 的负例断言）。
- 需重启宿主才能观测的项（FP-20 的界面渲染、FP-23 的 `install_bundle` 安装效果）不进入本台账的自动化计数，按 `test-report.md` §6 记 SKIP 并写明原因。


