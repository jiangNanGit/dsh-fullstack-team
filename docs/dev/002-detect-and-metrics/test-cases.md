# 002 · 测试用例台账（test-cases）

| 项 | 值 |
|---|---|
| 需求编号 | 002（`requirement.md` 已冻结，声明 2 个功能点） |
| 覆盖功能点 | FP-01（detect 后缀通配）、FP-02（度量落盘） |
| 依据 | `requirement.md` §2 验收标准、§4 裁决；`design.md` §2、§3、§7；`api-contract.md` §1~§5 |
| 用例总数 | 24（TC-01 ~ TC-24：FP-01 11 条 + FP-02 13 条） |
| 判定口径 | 门禁判定固定为「findings 中没有 `severity:'error'` ⇒ `pass`」；`metrics` 的计数语义固定为 `api-contract.md` §1.4 的五条事件行 |
| 状态 | 台账定版（覆盖 2/2 功能点）；执行结果见 `test-report.md` |
| 编写者 | 全栈研发团队 · 测试 |

> 本台账只回答三件事：怎么复现、期望哪些精确的字段值与 code、验收报告引用哪条证据。
> 每条用例的期望都收敛到可判定量：命中的角色 id、`matched:` 的内容、`metrics` 的某个键值、finding 的 `code` 与 `severity`、退出码。

## 0. 执行约定

本节固定环境、fixture、证据落点与判定口径；执行者按本节构造用例，不再各自约定。

### 0.1 环境与命令

- 工作目录 = 仓库根（含 `package.json`、`src/`、`tests/`、`roles/`、`scripts/`）。
- 单测：`npx vitest run tests/<spec>.ts`，直接执行 TypeScript 源码，不需要先 build。
- CLI：`scripts/roles.mjs` 从 `../lib/roles.js` 导入，**必须先 `pnpm build`**，否则测的是上一次构建的代码。
- 每批收口：`pnpm check`（`typecheck` + `test` + `skill-audit` + `tsdown`）。
- 角色命中实跑一律用「造仓 + 改工作目录」的方式：`mkdir -p /tmp/<name>`、只写需要的顶层文件、`cd` 进去后执行 `node <仓库根>/scripts/roles.mjs`。判定只看该命令输出的 `matched:` 行与 `frontend-vue` 那一行的 `命中`/`未命中` 列。
- 所有 `root` 一律是绝对路径（`mkdtempSync` 的产物天然绝对）；临时目录在 `afterEach` 删除。

### 0.2 fixture 构造

临时需求目录统一由下面这个 helper 造（与 `tests/metrics.spec.ts:15` 同形）：

```ts
function workspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'tc-002-'))
  temporary.push(root)
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(root, relative)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, content, 'utf8')
  }
  return root
}
```

具名 fixture：

| 名字 | 内容 |
|---|---|
| `REQ` | `# 需求` + 空行 + `## 功能点` + `- FP-01 创建订单`（只用于让 clarify 门通过，从而把流程推进到 design） |
| `STATE_OLD` | `{"version":2,"stage":"test","reworkStage":"test","rework":{"IMPL_MISMATCH":1},"history":[{…}]}`——**没有 `metrics` 键**的版本 2 文件 |
| `CONFIG_WAIVED` | `{"ui":{"applicable":false,"reason":"纯后端项目，无界面变更"}}` |
| `ACCEPT_HOLLOW` | `# 验收` + `## FP-01 创建订单` + `pass — 证据：src/missing.ts:1` + `## P0` + `P0 遗留：0`（证据指向不存在的文件，必然出 `EVIDENCE_MISSING`） |

角色命中的实跑仓固定用六个目录，名字即预期：

| 目录 | 顶层文件 | 预期 |
|---|---|---|
| `/tmp/tc002-repos/vite-js` | `package.json`、`vite.config.js` | 命中 |
| `/tmp/tc002-repos/vite-mts` | `package.json`、`vite.config.mts`、`README.md` | 命中 |
| `/tmp/tc002-repos/vite-ts` | `package.json`、`vite.config.ts` | 命中 |
| `/tmp/tc002-repos/only-pkg` | `package.json` | 未命中 |
| `/tmp/tc002-repos/vitest` | `package.json`、`vitest.config.ts` | 未命中 |
| `/tmp/tc002-repos/dot-ext` | `package.json`、`vite.config.`（带尾点的空后缀） | 未命中 |

### 0.3 证据落点与回填规则

每条用例的「证据」给两样东西：

1. **生产锚点**：当前源码的 `路径:行号`，证明断言打在哪个函数上，例如 `src/roles.ts:180`（`markerMatches`）、`src/state.ts:238`（`recordRefusal`）。
2. **复现落点**：永久自动化用例的 `tests/<spec>.ts:<行号>`（实现侧已落盘的单测），或 `test-report.md` 里的证据编号。「命令 N」指该报告 §2 的命令表行号；「探针 TC-xx」指该报告 §3 里用临时 spec（跑完即删）逐条执行本用例的那一行，含命令原文、退出码与原始输出。

路径约定：源码与用例路径**相对仓库根**书写（与 001 报告同一写法）；需求目录内的产物直接写文件名（`test-report.md`、`requirement.md`）。行号以本轮执行时的文件为准，改动后按函数名重新定位。

### 0.4 判定与编号约定

- 期望里的 finding `code` 必须逐字一致；`detail` 文案不承诺，只断言契约明文的关键词（如 `is not valid JSON`、`needs a \`failure\``）。
- 类型三分：**单测** = 单函数；**集成** = 跨模块或工具边界；**E2E** = 起进程、读真实目录或真实造仓。
- 台账不写「推断通过」：每条期望都在 `test-report.md` 里有对应命令输出或断言文件行号。

## 1. 覆盖矩阵

| FP | 用例区间 | 条数 | 覆盖的必测点 |
|---|---|---|---|
| FP-01 | TC-01 ~ TC-11 | 11 | 三种扩展名命中（js/mts/ts）、只有 `package.json` 不命中、`vitest.config.ts` 不命中、`package.json` 不当通配、空后缀 `vite.config.` 不命中、星号非末尾按普通字符、组内 AND、组间 OR 未被破坏、文档与生成物同步 |
| FP-02 | TC-12 ~ TC-24 | 13 | 零结构、门禁失败计数与 code 归因、跨阶段归因、成功不计数、rework 计数、reset 保留、旧 state 补零、warning 不进 codes、预算耗尽也计数、`metrics` 纯读、无状态不建文件、损坏 state 报错、并发不丢计数 |
| **合计** | TC-01 ~ TC-24 | **24** | 2/2 功能点 |

## 2. FP-01 · detect 后缀通配

本 FP 的判据（`api-contract.md` §3）：标记以 `.*` 结尾时按「前缀 + 非空后缀」匹配，前缀含末尾的点；其它写法精确匹配；角色命中仍是「组内 AND、组间 OR」。

#### TC-01 · 只有 `vite.config.js` 的 Node 仓命中 `frontend-vue`

- **FP**：FP-01 ｜ **类型**：E2E
- **前置**：`pnpm build` 已执行（`lib/roles.js` 是本次代码）；`/tmp/tc002-repos/vite-js` 只有 `package.json` 与 `vite.config.js`
- **步骤**：`cd /tmp/tc002-repos/vite-js && node <仓库根>/scripts/roles.mjs`，看退出码与 `matched:` 行
- **期望**：退出码 `0`；`matched:` 含 `frontend-vue`；`frontend-vue` 行显示 `命中`；`cwd:` 行显示 `2 top-level entries`
- **证据**：生产锚点 `src/roles.ts:180`（`markerMatches`）、`src/roles.ts:157`（组内 `every`）；清单 `roles/frontend-vue.role.yml:8`；自动化 `tests/roles.spec.ts:134`；实跑见 `test-report.md` 命令 5（`/tmp/tc002-repos/vite-js` 的 `roles.mjs`）+ 探针 TC-01

#### TC-02 · `vite.config.mts` 同样命中

- **FP**：FP-01 ｜ **类型**：E2E
- **前置**：`/tmp/tc002-repos/vite-mts` 含 `package.json`、`vite.config.mts`、`README.md`
- **步骤**：同上，在该目录执行 `roles.mjs`
- **期望**：退出码 `0`；`matched:` 含 `frontend-vue`；`frontend-vue` 行为 `命中`；`cwd:` 行显示 `3 top-level entries`（证明多一个无关文件不影响判定）
- **证据**：生产锚点 `src/roles.ts:180`；自动化 `tests/roles.spec.ts:134`；实跑见 `test-report.md` 命令 6（`/tmp/tc002-repos/vite-mts`）+ 探针 TC-02

#### TC-03 · `vite.config.ts` 仍是命中（回归，旧行为不得回退）

- **FP**：FP-01 ｜ **类型**：E2E
- **前置**：`/tmp/tc002-repos/vite-ts` 含 `package.json`、`vite.config.ts`
- **步骤**：同上，执行 `roles.mjs`
- **期望**：退出码 `0`；`matched:` 含 `frontend-vue`；`frontend-vue` 行为 `命中`
- **证据**：生产锚点 `src/roles.ts:180`；自动化 `tests/roles.spec.ts:134`；实跑见 `test-report.md` 命令 7（`/tmp/tc002-repos/vite-ts`）+ 探针 TC-03

#### TC-04 · 只有 `package.json` 不命中（组内 AND 仍成立）

- **FP**：FP-01 ｜ **类型**：E2E
- **前置**：`/tmp/tc002-repos/only-pkg` 只有 `package.json`
- **步骤**：执行 `roles.mjs`；再直接调 `roleMatches(frontend-vue, new Set(['package.json']))`
- **期望**：`matched:` **不含** `frontend-vue`；`frontend-vue` 行为 `未命中`；`roleMatches` 返回 `false`
- **证据**：生产锚点 `src/roles.ts:157`（`every` 要求组内全中）；自动化 `tests/roles.spec.ts:127`；实跑见 `test-report.md` 命令 8（`/tmp/tc002-repos/only-pkg`）+ 探针 TC-04

#### TC-05 · `vitest.config.ts` 不命中（前缀必须完整）

- **FP**：FP-01 ｜ **类型**：E2E
- **前置**：`/tmp/tc002-repos/vitest` 含 `package.json`、`vitest.config.ts`
- **步骤**：执行 `roles.mjs`；再直接调 `roleMatches` 于 `new Set(['package.json','vitest.config.ts'])`
- **期望**：`matched:` 不含 `frontend-vue`；`frontend-vue` 行为 `未命中`；`roleMatches` 返回 `false`（`vite.` ≠ `vitest.`）
- **证据**：生产锚点 `src/roles.ts:182`（`stem = slice(0, -1)` 保留末尾的点）、`src/roles.ts:184`；自动化 `tests/roles.spec.ts:142`；实跑见 `test-report.md` 命令 9（`/tmp/tc002-repos/vitest`）+ 探针 TC-05

#### TC-06 · 普通带点文件名 `package.json` 按精确匹配，不当通配

- **FP**：FP-01 ｜ **类型**：单测
- **前置**：构造 `role({ detect: ['package.json'] })`（最小角色对象）；标记集合分别取 `['package.json']`、`['package.yaml']`、`['package.json.bak']`
- **步骤**：三次调 `roleMatches`
- **期望**：`['package.json']` → `true`；`['package.yaml']` → `false`；`['package.json.bak']` → `false`
- **证据**：生产锚点 `src/roles.ts:181`（不以 `.*` 结尾即走 `markers.has(marker)`）；自动化 `tests/roles.spec.ts:146`；实跑输出见 `test-report.md` 探针 TC-06

#### TC-07 · 空后缀 `vite.config.` 与无后缀 `vite.config` 都不命中

- **FP**：FP-01 ｜ **类型**：E2E + 单测
- **前置**：`/tmp/tc002-repos/dot-ext` 含 `package.json` 与真实创建出来的 `vite.config.`（`ls -b` 可见尾点）
- **步骤**：① 在该目录执行 `roles.mjs`；② 直接调 `roleMatches(role({detect:['vite.config.*']}), new Set(['vite.config.']))` 与 `new Set(['vite.config'])`
- **期望**：① `matched:` 不含 `frontend-vue`，该行为 `未命中`；② 两次调用都返回 `false`（后缀必须非空）
- **证据**：生产锚点 `src/roles.ts:184`（`name.length > stem.length`）；自动化 `tests/roles.spec.ts:156`；实跑见 `test-report.md` 命令 10（`/tmp/tc002-repos/dot-ext`）+ 探针 TC-07

#### TC-08 · 星号不在末尾时按普通字符全等

- **FP**：FP-01 ｜ **类型**：单测
- **前置**：构造 `role({ detect: ['vite*.config'] })`；标记集合分别取 `['vite1.config']`、`['vite*.config']`
- **步骤**：两次调 `roleMatches`
- **期望**：`['vite1.config']` → `false`；`['vite*.config']` → `true`（只认「末尾是 `.*`」，其余按字面比较）
- **证据**：生产锚点 `src/roles.ts:181`（`endsWith(WILDCARD)` 是唯一入口）；契约 `api-contract.md` §3 约束 1；实跑输出见 `test-report.md` 探针 TC-08

#### TC-09 · 通配不改变组合逻辑：`vite.config.js` 单独存在仍不命中

- **FP**：FP-01 ｜ **类型**：单测
- **前置**：标记集合 `['vite.config.js']`（无 `package.json`）
- **步骤**：调 `roleMatches(frontend-vue, new Set(['vite.config.js']))`
- **期望**：返回 `false`——通配只影响单个标记的判定，组内仍需同时命中 `package.json`
- **证据**：生产锚点 `src/roles.ts:157-159`（`some` 跨组、`every` 组内，两个逻辑未改）；自动化 `tests/roles.spec.ts:134` 末行；实跑输出见 `test-report.md` 探针 TC-09

#### TC-10 · 组间 OR 回归：`backend-java` 三个构建文件任一即命中

- **FP**：FP-01 ｜ **类型**：E2E + 单测
- **前置**：`/tmp/tc002-repos/java-pom` 只有 `pom.xml`
- **步骤**：① 在该目录执行 `roles.mjs`；② 直接调 `roleMatches(backend-java, …)` 于 `pom.xml`、`build.gradle`、`build.gradle.kts`、`package.json`
- **期望**：① `matched:` 含 `backend-java`、不含 `frontend-vue`；② 前三次 `true`，`package.json` → `false`
- **证据**：生产锚点 `src/roles.ts:157`（`some` 跨组）；清单 `roles/backend-java.role.yml`；自动化 `tests/roles.spec.ts:120`、`:174`；实跑见 `test-report.md` 命令 11（`/tmp/tc002-repos/java-pom`）+ 探针 TC-10

#### TC-11 · 清单、文档与生成物三处同步

- **FP**：FP-01 ｜ **类型**：集成（静态核对）
- **前置**：无
- **步骤**：① 读 `roles/frontend-vue.role.yml` 的 `detect`；② `grep -n 'vite\.config'` 于 `skills/role-init/SKILL.md`、`docs/dev/project-standard.md`；③ `grep -c 'detect' presets/roles.patch.yml` 并 `shasum -a 256 presets/roles.patch.yml`
- **期望**：① `detect` 严格等于 `[[package.json, vite.config.*]]`；② 两处文档都出现 `vite.config.*` 且写明「后缀通配 / 前缀须完整 / 其它精确匹配」；③ 生成物中 `detect` 出现 `0` 次，sha256 仍为 `b0b42337dbd6514bfb7060f0cce9666aba791b406a86619ff79d71cea194809f`（`design.md` §1 不变量：生成物不含 `detect`、字节不变）
- **证据**：`roles/frontend-vue.role.yml:8`；`skills/role-init/SKILL.md:17`、`:20`；`docs/dev/project-standard.md:37`；实跑见 `test-report.md` 命令 12

## 3. FP-02 · 度量落盘

本 FP 的判据（`api-contract.md` §1.4、§2）：`advanceBlocked` 按阶段计数并六阶段零填充；`rework` 按失败类型计数并六类型零填充；`codes` 只累计非 warning finding 的 code、从空开始；`advance` 成功不计数；`reset` 保留；旧状态缺字段补零且不升版本；`metrics` 动作纯读。

#### TC-12 · 模板完整输出：三张表 + 六阶段/六类型零填充

- **FP**：FP-02 ｜ **类型**：单测
- **前置**：空需求目录（`workspace()`，无状态文件）
- **步骤**：`readState(root).state.metrics`
- **期望**：`advanceBlocked` 的键恰为 `clarify, design, build, test, accept, ship` 且全为 `0`；`rework` 恰 6 个失败类型且全为 `0`；`codes` 严格等于 `{}`；`version === 2`
- **证据**：生产锚点 `src/state.ts:154`（`freshMetrics`）、`src/state.ts:287-291`（读取时补零）；自动化 `tests/metrics.spec.ts:51`；实跑输出见 `test-report.md` 探针 TC-12

#### TC-13 · `advance` 门禁失败：当前阶段 +1，codes 按 finding 归因，流程不动

- **FP**：FP-02 ｜ **类型**：集成
- **前置**：空需求目录（clarify 门必失败：`requirement.md` 缺失）
- **步骤**：`advance(root)` → `readState(root)`；记录 `outcome.findings` 与 `state.history.length`
- **期望**：`outcome.pass === false`、`advanced === false`；`findings` 为 `[error:FILE_MISSING]`；`metrics.advanceBlocked.clarify === 1`，其余阶段 `0`；`metrics.codes === {FILE_MISSING:1}`；`stage === 'clarify'`；`history` 长度仍为 `0`（拒绝不是进展）
- **证据**：生产锚点 `src/state.ts:238`（`recordRefusal`）、`src/state.ts:480-482`（门禁失败分支同一次 `writeState`）；自动化 `tests/metrics.spec.ts:56`；实跑输出见 `test-report.md` 探针 TC-13

#### TC-14 · 跨阶段归因：design 阶段 +1，且同 code 逐条累加

- **FP**：FP-02 ｜ **类型**：集成
- **前置**：`workspace({ 'requirement.md': REQ })`（clarify 门可过，design 门因 `design.md`、`api-contract.md` 双缺而失败）
- **步骤**：`advance(root)`（成功推进到 design）→ 再 `advance(root)`（design 门失败）→ `readState`
- **期望**：第二次 `findings` 为 `[error:FILE_MISSING, error:FILE_MISSING]`；`advanceBlocked` 恰为 `{clarify:0, design:1, build:0, test:0, accept:0, ship:0}`；`codes === {FILE_MISSING:2}`（一条拒绝、两个 error，各 +1）
- **证据**：生产锚点 `src/state.ts:239`（按 `state.stage` 计数）、`:240-243`（逐条 finding 累加）；自动化 `tests/metrics.spec.ts:69`；实跑输出见 `test-report.md` 探针 TC-14

#### TC-15 · `advance` 成功不计数

- **FP**：FP-02 ｜ **类型**：集成
- **前置**：`workspace({ 'requirement.md': REQ })`
- **步骤**：`advance(root)` → `readState(root)`
- **期望**：`advanced === true`、`stage === 'design'`；`metrics.advanceBlocked` 六阶段全 `0`；`metrics.codes === {}`；`metrics.rework` 全 `0`
- **证据**：生产锚点 `src/state.ts:493-503`（成功路径只改 `stage`/`rework`/`history`，不碰 `metrics`）；自动化 `tests/metrics.spec.ts:81`；实跑输出见 `test-report.md` 探针 TC-15

#### TC-16 · `rework` 计数：每次 +1，且与阶段预算同一次写盘

- **FP**：FP-02 ｜ **类型**：集成
- **前置**：空需求目录
- **步骤**：`rework(root,'CONTRACT_GAP')` 两次；读 `readState` 与磁盘 JSON
- **期望**：返回的 `rework` 分别为 `{count:1,budget:3,exhausted:false}`、`{count:2,budget:3,exhausted:false}`；`metrics.rework.CONTRACT_GAP === 2`，其余类型 `0`；磁盘上 `rework.CONTRACT_GAP === 2`、`metrics.rework.CONTRACT_GAP === 2`、`history.length === 2`（同一次写，不允许分两次）
- **证据**：生产锚点 `src/state.ts:533`（`bump(state.metrics.rework, failure)`）、`:541`（同一次 `writeState`）；自动化 `tests/metrics.spec.ts:88`；实跑输出见 `test-report.md` 探针 TC-16

#### TC-17 · `reset` 保留 metrics，只清阶段/预算/历史

- **FP**：FP-02 ｜ **类型**：集成
- **前置**：先制造一次 clarify 门禁失败（`advance`）与一次 `rework(TEST_FAIL)`
- **步骤**：`reset(root)` → `readState(root)`
- **期望**：`outcome.stage === 'clarify'`、`pass === true`；`state.stage === 'clarify'`、`state.rework.TEST_FAIL === 0`、`state.history === []`；`metrics.advanceBlocked.clarify === 1`、`metrics.rework.TEST_FAIL === 1`、`metrics.codes === {FILE_MISSING:1}` 全部保留；`version === 2`
- **证据**：生产锚点 `src/state.ts:570-579`（`reset` 读旧 metrics 后写入新 state）；`api-contract.md` §1.4 最后一行；自动化 `tests/metrics.spec.ts:138`；实跑输出见 `test-report.md` 探针 TC-17

#### TC-18 · 旧 state（无 `metrics` 字段）可读：补零、不升版本、下次写盘落盘

- **FP**：FP-02 ｜ **类型**：集成
- **前置**：`workspace({ [STATE_FILE]: STATE_OLD })`（`version:2`、`stage:test`、`rework.IMPL_MISMATCH:1`、无 `metrics`）
- **步骤**：`readState(root)`；再 `rework(root,'IMPL_MISMATCH')`；读磁盘 JSON
- **期望**：`created === false`；`state.version === 2`（**不升版本**）；`state.stage === 'test'`；`metrics` 为完整零结构（六阶段/六类型全 0、`codes === {}`）；写盘后磁盘 `version === 2` 且 `metrics.rework.IMPL_MISMATCH === 1`
- **证据**：生产锚点 `src/state.ts:280`（`persistedMetrics` 缺省取 `{}`）、`:283`（版本常量写死 2）、`:287-291`；`api-contract.md` §2 第 2 条；自动化 `tests/metrics.spec.ts:104`；实跑输出见 `test-report.md` 探针 TC-18

#### TC-19 · warning 不计入 codes，但仍出现在 findings 里

- **FP**：FP-02 ｜ **类型**：集成
- **前置**：`stage:'accept'` 的旧 state；`REQ` + `ACCEPT_HOLLOW` + `CONFIG_WAIVED`（豁免界面 → 每次 accept 必出 `UI_ACCEPTANCE_WAIVED`）
- **步骤**：`advance(root)`；取 `outcome.findings` 的 `severity:code` 列表与 `readState(root).state.metrics`
- **期望**：findings 恰含 `warning:UI_ACCEPTANCE_WAIVED`、`error:EVIDENCE_MISSING`、`error:FILE_MISSING`；`metrics.codes === {EVIDENCE_MISSING:1, FILE_MISSING:1}`，**没有** `UI_ACCEPTANCE_WAIVED` 键；`metrics.advanceBlocked.accept === 1`
- **证据**：生产锚点 `src/state.ts:241`（`severity === 'warning'` 跳过）、`src/gates/stages.ts`（豁免 warning 生成点）；`design.md` §3.3；自动化 `tests/metrics.spec.ts:164`；实跑输出见 `test-report.md` 探针 TC-19

#### TC-20 · 预算耗尽被拒也计数，并追加 `REWORK_BUDGET_EXHAUSTED`

- **FP**：FP-02 ｜ **类型**：集成
- **前置**：空需求目录；先 `rework(root,'CONTRACT_CONFLICT')` 一次（该类型预算为 1，立即耗尽）
- **步骤**：`advance(root)`；取 findings 与 `metrics`
- **期望**：`pass === false`；findings 的 code 为 `[REWORK_BUDGET_EXHAUSTED]`；`advanceBlocked.clarify === 1`；`codes === {REWORK_BUDGET_EXHAUSTED:1}`
- **证据**：生产锚点 `src/state.ts:458-468`（预算分支同样调用 `recordRefusal`）；`api-contract.md` §1.4 第 2 行；实跑输出见 `test-report.md` 探针 TC-20

#### TC-21 · `devflow_state` 的 `metrics` 动作是纯读：字节不变、不推进

- **FP**：FP-02 ｜ **类型**：集成（工具边界，走 `src/tools.ts` 真实现）
- **前置**：先经工具执行 `advance`（必败）与 `rework(TEST_FAIL)`，记录状态文件字节
- **步骤**：`call(stateTool, { action:'metrics', root })`；再次读文件字节比较
- **期望**：返回对象 `stage==='clarify'`、`advanced===false`、`pass===true`、`reworkStage==='clarify'`；`metrics` 等于 `{advanceBlocked:{clarify:1,…其余 0}, rework:{TEST_FAIL:1,…其余 0}, codes:{FILE_MISSING:1}}`；`message` 含 `advance blocked by stage: clarify=1`；调用前后文件字节**完全相同**
- **证据**：生产锚点 `src/tools.ts:326-341`（`metrics` 分支只读 `readState`，不调用 `writeState`）；`api-contract.md` §1.3、§1.4；自动化 `tests/metrics.spec.ts:191`；实跑输出见 `test-report.md` 探针 TC-21

#### TC-22 · 状态不存在时 `metrics` 返回零结构且不创建文件

- **FP**：FP-02 ｜ **类型**：集成（工具边界）
- **前置**：新建空目录，`.dsh/devflow/state.json` 不存在
- **步骤**：`call(stateTool, { action:'metrics', root })`；`existsSync(join(root, STATE_FILE))`
- **期望**：`stage==='clarify'`、`reworkStage==='clarify'`；`metrics` 为完整零结构；`existsSync(...) === false`（目录内不出现 `.dsh/devflow/state.json`）
- **证据**：生产锚点 `src/state.ts:306-321`（`readState` 的 ENOENT 分支返回 `initialState()` 且不写盘）、`src/tools.ts:326`；`api-contract.md` §1.3「状态不存在」「纯读」两行；自动化 `tests/metrics.spec.ts:212`；实跑输出见 `test-report.md` 探针 TC-22

#### TC-23 · 状态文件损坏时 `metrics` 报错，不返回零结构、不修复

- **FP**：FP-02 ｜ **类型**：集成（工具边界）
- **前置**：`workspace({ [STATE_FILE]: '{broken' })`
- **步骤**：`call(stateTool, { action:'metrics', root })`，捕获异常消息；读文件字节
- **期望**：抛错，消息含 `dsh-fullstack-team: flow state` 与 `is not valid JSON`，并给出修复指引（编辑/删除/`reset`）；文件字节仍为 `{broken`（未被改写）
- **证据**：生产锚点 `src/state.ts:259-266`（`parseState` 抛 `stateError`）、`src/state.ts:573-577`（只有 `reset` 吞掉读错误）；`api-contract.md` §4「状态文件损坏」；实跑输出见 `test-report.md` 探针 TC-23

#### TC-24 · 同锁内连续两次被拒，计数不丢

- **FP**：FP-02 ｜ **类型**：集成
- **前置**：空需求目录；在 `withStateLock(root, () => { advance(root); advance(root) })` 内执行
- **步骤**：读 `metrics`
- **期望**：`advanceBlocked.clarify === 2`；`codes.FILE_MISSING === 2`（两次读-改-写不互相覆盖）
- **证据**：生产锚点 `src/state.ts:354`（`withStateLock` 可重入）、`src/state.ts:468`/`:482`（同一临界区内写盘）；自动化 `tests/metrics.spec.ts:126`、`tests/state.spec.ts`（串行写不丢计数）；实跑见 `test-report.md` 命令 2（`pnpm check` 全绿）

## 4. 执行状态

本台账 24 条用例已在 2026-11-05 全部执行，逐条结果、命令与原始输出见 `test-report.md`；跳过项（如有）在该报告「跳过项」节写明原因，不计入通过。
