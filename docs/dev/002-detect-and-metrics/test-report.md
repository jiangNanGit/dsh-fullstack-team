# 002 · 测试执行报告（test-report）

| 项 | 值 |
|---|---|
| 需求编号 | 002（`requirement.md` 已冻结，声明 2 个功能点） |
| 用例台账 | `test-cases.md`（TC-01 ~ TC-24，24 条） |
| 执行者 | 全栈研发团队 · 测试 |
| 执行日期 | 2026-11-05（10:45 ~ 10:56） |
| 执行环境 | 仓库根 `dsh-fullstack-team`；Darwin 23.6.0 / macOS 14.8.3；Node v22.17.0；pnpm 11.28.5 |
| 结论 | 2 个功能点：**2 PASS / 0 FAIL / 0 SKIP**；台账 24 条用例全部执行并通过；未发现实现缺陷 |
| 能否进 accept | **可以推进**：无未关闭缺陷，无跳过项 |

本报告只记录实际执行过的命令与实际观察到的输出。无法在本机验证的项目一律记 SKIP 并写明原因，不以「推断通过」替代；本需求没有出现需要 SKIP 的项。

本轮验证对象是**当前工作树**（`git status` 显示 `src/roles.ts`、`src/state.ts`、`src/tools.ts`、`roles/frontend-vue.role.yml`、`tests/roles.spec.ts`、`tests/state.spec.ts`、`tests/metrics.spec.ts` 等为未提交改动）。所有断言都跑在 TypeScript 源码或本次 `tsdown` 重建的 `lib/` 上，没有复用旧构建。

## 1. 环境与前置

| 项 | 实测值 |
|---|---|
| 操作系统 | macOS 14.8.3（Darwin 23.6.0） |
| Node | v22.17.0 |
| pnpm / npm | 11.28.5 / 10.9.2 |
| 测试与构建工具 | vitest 4.1.8、tsdown 0.22.14（均在 `package.json` 的 devDependencies 内） |
| 构建产物 | `lib/index.js` 74761 B、`lib/roles.js` 12072 B，2026-11-05 10:51 由 `pnpm check` 末尾的 `tsdown` 重建（`lib/roles.js` 已导出 `roleMatches`、`loadRoles`） |
| 生成物 | `presets/roles.patch.yml`，sha256 `b0b42337dbd6514bfb7060f0cce9666aba791b406a86619ff79d71cea194809f`，1170 行；本轮所有命令均未改写它（`git status --porcelain presets/` 无输出） |
| 需求目录产物 | `requirement.md`、`design.md`、`api-contract.md`（均由 PM 冻结）；本轮新增 `test-cases.md`、`test-report.md` |
| 临时产物 | 只写 `/tmp`：`/tmp/tc002-repos/*`（七个造仓）、`/tmp/tc002-logs/*`（命令原始输出）；临时探针 spec 跑完即删，仓库内无残留 |
| 未触碰项 | 未改代码/测试/README/docs/roles/presets；未读写 `~/.dsh` 与真实 profile；未执行 `install-presets.mjs`；未 commit |

前置结论：`scripts/roles.mjs` 从 `../lib/roles.js` 导入，因此**先跑 `pnpm check`（含 `tsdown`）再造仓实跑**，保证验证的是本轮代码而不是上一次构建。

## 2. 执行命令与结果摘要

### 2.1 命令表（全部在本机真实执行）

| # | 命令 | 退出码 | 关键输出 |
|---|---|---|---|
| 1 | `sw_vers -productVersion; uname -r; node -v; pnpm -v; npm -v` | 0 | `14.8.3` / `23.6.0` / `v22.17.0` / `11.28.5` / `10.9.2` |
| 2 | `pnpm check` | 0 | `tsc --noEmit` 无输出；`Test Files 11 passed (11)`、`Tests 264 passed (264)`；`技能体检通过：没有项目内容混进能力文件`；`lib/index.js 74.76 kB`、`lib/roles.js 12.07 kB`、`Build complete` |
| 3 | 造仓 fixture：`mkdir -p /tmp/tc002-repos/{vite-js,vite-mts,vite-ts,only-pkg,vitest,dot-ext,java-pom}` 并按台账 §0.2 写顶层文件（含用 `: > "/tmp/tc002-repos/dot-ext/vite.config."` 真实创建带尾点文件名） | 0 | `ls -b` 显示 `package.json`、`vite.config.` 两个条目（尾点文件在 APFS 上创建成功） |
| 4 | `cd <仓库根> && node scripts/roles.mjs` | 0 | `roles: 8 total — 8 mountable, 0 blocked`；`cwd: …/dsh-fullstack-team (24 top-level entries)`；`matched: backend-design, ops, pm, qa, dsh-plugin-dev`；`frontend-vue 未命中`（本仓无 `vite.config.*`） |
| 5 | `cd /tmp/tc002-repos/vite-js && node <仓库根>/scripts/roles.mjs` | 0 | `cwd: /private/tmp/tc002-repos/vite-js (2 top-level entries)`；`matched: backend-design, ops, pm, qa, frontend-vue`；`✓ stack frontend-vue 命中` |
| 6 | `cd /tmp/tc002-repos/vite-mts && node <仓库根>/scripts/roles.mjs` | 0 | `(3 top-level entries)`；`matched: … frontend-vue`；`frontend-vue 命中` |
| 7 | `cd /tmp/tc002-repos/vite-ts && node <仓库根>/scripts/roles.mjs` | 0 | `(2 top-level entries)`；`matched: … frontend-vue`；`frontend-vue 命中` |
| 8 | `cd /tmp/tc002-repos/only-pkg && node <仓库根>/scripts/roles.mjs` | 0 | `(1 top-level entries)`；`matched: backend-design, ops, pm, qa`；`frontend-vue 未命中` |
| 9 | `cd /tmp/tc002-repos/vitest && node <仓库根>/scripts/roles.mjs` | 0 | `matched: backend-design, ops, pm, qa`；`frontend-vue 未命中`（`vitest.config.ts` 不算 `vite.config.*`） |
| 10 | `cd /tmp/tc002-repos/dot-ext && node <仓库根>/scripts/roles.mjs` | 0 | `(2 top-level entries)`；`matched: backend-design, ops, pm, qa`；`frontend-vue 未命中`（`vite.config.` 空后缀不命中） |
| 11 | `cd /tmp/tc002-repos/java-pom && node <仓库根>/scripts/roles.mjs` | 0 | `(1 top-level entries)`；`matched: backend-design, ops, pm, qa, backend-java`；`frontend-vue 未命中` |
| 12 | `grep -n 'vite\.config' skills/role-init/SKILL.md docs/dev/project-standard.md`；`git status --porcelain presets/`；`shasum -a 256 presets/roles.patch.yml`；`grep -c 'detect' presets/roles.patch.yml` | 0 | `skills/role-init/SKILL.md:17`（表格 `package.json` + `vite.config.*` 同组）、`:20`（后缀通配语义整段）；`docs/dev/project-standard.md:37`（同一语义）；`presets/` 无改动；sha256 `b0b42337…4809f`；`detect` 计数 `0` |

### 2.2 断言探针（临时 spec，逐条执行、跑完即删）

`devflow_state` 的 `metrics` 动作与 `roleMatches` 的边界矩阵不是靠读代码判断的，而是用临时 spec 直接调 `src/tools.ts` / `src/state.ts` / `src/roles.ts` 的真实现，每条用例单独执行一次：

```bash
npx vitest run tests/__tmp_tc002_probe_b.spec.ts -t 'TC-xx '
```

- 全量一次跑：`Test Files 1 passed (1)`、`Tests 22 passed (22)`、退出码 0。
- 逐条跑：22 条全部退出码 0（见 §3）。
- 该 spec 只做断言与打印，不写仓库内任何文件；执行完成后已删除（`ls tests/ | grep tmp` 无输出），`pnpm check` 的最终一次运行发生在删除之后（264 例，不含探针）。

## 3. 逐条执行结果

结果口径：`PASS` = 断言全部成立；`FAIL` = 任一断言不成立；`SKIP` = 未能在本机验证（本报告无此项）。「证据」列给出命令编号（§2.1）或探针编号（§2.2，输出原文见 §3.1/§3.2）。

| 用例 | FP | 结果 | 证据 | 关键观察 |
|---|---|---|---|---|
| TC-01 | FP-01 | PASS | 命令 5 + 探针 TC-01 | `roles.mjs` 的 `matched:` 含 `frontend-vue`；`roleMatches(...) === true` |
| TC-02 | FP-01 | PASS | 命令 6 + 探针 TC-02 | `vite.config.mts` 命中 |
| TC-03 | FP-01 | PASS | 命令 7 + 探针 TC-03 | `vite.config.ts` 命中（旧行为未回退） |
| TC-04 | FP-01 | PASS | 命令 8 + 探针 TC-04 | 只有 `package.json` 时 `matched:` 无 `frontend-vue`，函数返回 `false` |
| TC-05 | FP-01 | PASS | 命令 9 + 探针 TC-05 | `vitest.config.ts` 不命中，函数返回 `false` |
| TC-06 | FP-01 | PASS | 探针 TC-06 | `package.json` 精确命中；`package.yaml`、`package.json.bak` 均 `false` |
| TC-07 | FP-01 | PASS | 命令 10 + 探针 TC-07 | 真实尾点文件 `vite.config.` 不命中；`vite.config` 也不命中；`vite.config.js` 命中 |
| TC-08 | FP-01 | PASS | 探针 TC-08 | `vite*.config` 只字面命中，`vite1.config` 不命中 |
| TC-09 | FP-01 | PASS | 探针 TC-09 | 只有 `vite.config.js`（无 `package.json`）时 `false`：组内 AND 未被通配削弱 |
| TC-10 | FP-01 | PASS | 命令 11 + 探针 TC-10 | `pom.xml`/`build.gradle`/`build.gradle.kts` 任一即命中 `backend-java`；`package.json` 不命中 |
| TC-11 | FP-01 | PASS | 命令 12 | 清单 `[package.json, vite.config.*]`；两处文档同语义；生成物 0 处 `detect`、sha256 未变 |
| TC-12 | FP-02 | PASS | 探针 TC-12 | 六阶段/六失败类型全 0、`codes` 为 `{}`、`version === 2` |
| TC-13 | FP-02 | PASS | 探针 TC-13 | `advanceBlocked.clarify === 1`、`codes === {FILE_MISSING:1}`、`stage` 与 `history` 未变 |
| TC-14 | FP-02 | PASS | 探针 TC-14 | `design` 阶段 +1、`clarify` 仍 0、`codes === {FILE_MISSING:2}` |
| TC-15 | FP-02 | PASS | 探针 TC-15 | 成功的 `advance` 后三张表仍为零结构 |
| TC-16 | FP-02 | PASS | 探针 TC-16 | 两次 rework ⇒ `metrics.rework.CONTRACT_GAP === 2`；磁盘上 `rework`/`metrics.rework`/`history` 三者一致（同一次写） |
| TC-17 | FP-02 | PASS | 探针 TC-17 | `reset` 后 `stage=clarify`、`rework=0`、`history=[]`，而三张表全部保留、`version` 仍 2 |
| TC-18 | FP-02 | PASS | 探针 TC-18 | 老文件 `created=false`、`version === 2`、metrics 补零；写盘后 `metrics.rework.IMPL_MISMATCH === 1` |
| TC-19 | FP-02 | PASS | 探针 TC-19 | findings 含 `warning:UI_ACCEPTANCE_WAIVED`，`codes` 只有 `{EVIDENCE_MISSING:1, FILE_MISSING:1}` |
| TC-20 | FP-02 | PASS | 探针 TC-20 | 预算耗尽被拒 ⇒ `codes === {REWORK_BUDGET_EXHAUSTED:1}`、`advanceBlocked.clarify === 1` |
| TC-21 | FP-02 | PASS | 探针 TC-21 | `metrics` 返回 `stage=clarify`/`advanced=false`/`pass=true`；前后文件字节相同（`bytesEqual=true`） |
| TC-22 | FP-02 | PASS | 探针 TC-22 | 无状态目录返回零结构、`stateFileExists=false` |
| TC-23 | FP-02 | PASS | 探针 TC-23 | 损坏文件抛 `dsh-fullstack-team: flow state … is not valid JSON`，文件字节仍为 `{broken` |
| TC-24 | FP-02 | PASS | 命令 2（`tests/metrics.spec.ts:126` 在本轮 264 例内通过） | 同一锁内连续两次被拒 ⇒ `advanceBlocked.clarify === 2`、`codes.FILE_MISSING === 2` |

### 3.1 FP-01 探针原始输出

```text
PROBE TC-01 = true
PROBE TC-02 = true
PROBE TC-03 = true
PROBE TC-04 = false
PROBE TC-05 = false
PROBE TC-06 = {"exact":true,"yaml":false,"bak":false}
PROBE TC-07 = {"vite.config.":false,"vite.config":false,"vite.config.js":true}
PROBE TC-08 = {"vite1.config":false,"vite*.config":true}
PROBE TC-09 = false
PROBE TC-10 = [["pom.xml",true],["build.gradle",true],["build.gradle.kts",true],["package.json",false]]
```

### 3.2 FP-02 探针原始输出

```text
PROBE TC-12 = {"version":2,"metrics":{"advanceBlocked":{"clarify":0,"design":0,"build":0,"test":0,"accept":0,"ship":0},"rework":{"DESIGN_UNFEASIBLE":0,"CONTRACT_GAP":0,"CONTRACT_CONFLICT":0,"IMPL_MISMATCH":0,"TEST_FAIL":0,"ACCEPT_P0":0},"codes":{}}}
PROBE TC-13 = {"pass":false,"advanced":false,"findings":["error:FILE_MISSING"],"stage":"clarify","history":0,"metrics":{"advanceBlocked":{"clarify":1,"design":0,"build":0,"test":0,"accept":0,"ship":0},"rework":{"DESIGN_UNFEASIBLE":0,"CONTRACT_GAP":0,"CONTRACT_CONFLICT":0,"IMPL_MISMATCH":0,"TEST_FAIL":0,"ACCEPT_P0":0},"codes":{"FILE_MISSING":1}}}
PROBE TC-14 = {"findings":["error:FILE_MISSING","error:FILE_MISSING"],"metrics":{"advanceBlocked":{"clarify":0,"design":1,"build":0,"test":0,"accept":0,"ship":0},"rework":{"DESIGN_UNFEASIBLE":0,"CONTRACT_GAP":0,"CONTRACT_CONFLICT":0,"IMPL_MISMATCH":0,"TEST_FAIL":0,"ACCEPT_P0":0},"codes":{"FILE_MISSING":2}}}
PROBE TC-15 = {"advanced":true,"stage":"design","metrics":{"advanceBlocked":{"clarify":0,"design":0,"build":0,"test":0,"accept":0,"ship":0},"rework":{"DESIGN_UNFEASIBLE":0,"CONTRACT_GAP":0,"CONTRACT_CONFLICT":0,"IMPL_MISMATCH":0,"TEST_FAIL":0,"ACCEPT_P0":0},"codes":{}}}
PROBE TC-16 = {"budgets":[{"type":"CONTRACT_GAP","count":1,"budget":3,"exhausted":false},{"type":"CONTRACT_GAP","count":2,"budget":3,"exhausted":false}],"metrics":{"DESIGN_UNFEASIBLE":0,"CONTRACT_GAP":2,"CONTRACT_CONFLICT":0,"IMPL_MISMATCH":0,"TEST_FAIL":0,"ACCEPT_P0":0},"persisted":{"version":2,"rework":2,"metricsRework":2,"history":2}}
PROBE TC-17 = {"outcome":["clarify",true],"stage":"clarify","budget":0,"history":0,"version":2,"metrics":{"advanceBlocked":{"clarify":1,"design":0,"build":0,"test":0,"accept":0,"ship":0},"rework":{"DESIGN_UNFEASIBLE":0,"CONTRACT_GAP":0,"CONTRACT_CONFLICT":0,"IMPL_MISMATCH":0,"TEST_FAIL":1,"ACCEPT_P0":0},"codes":{"FILE_MISSING":1}}}
PROBE TC-18 = {"created":false,"version":2,"stage":"test","metrics":{"advanceBlocked":{"clarify":0,"design":0,"build":0,"test":0,"accept":0,"ship":0},"rework":{"DESIGN_UNFEASIBLE":0,"CONTRACT_GAP":0,"CONTRACT_CONFLICT":0,"IMPL_MISMATCH":0,"TEST_FAIL":0,"ACCEPT_P0":0},"codes":{}},"persisted":{"version":2,"metricsRework":{"DESIGN_UNFEASIBLE":0,"CONTRACT_GAP":0,"CONTRACT_CONFLICT":0,"IMPL_MISMATCH":1,"TEST_FAIL":0,"ACCEPT_P0":0}}}
PROBE TC-19 = {"findings":["warning:UI_ACCEPTANCE_WAIVED","error:EVIDENCE_MISSING","error:FILE_MISSING"],"metrics":{"advanceBlocked":{"clarify":0,"design":0,"build":0,"test":0,"accept":1,"ship":0},"rework":{"DESIGN_UNFEASIBLE":0,"CONTRACT_GAP":0,"CONTRACT_CONFLICT":0,"IMPL_MISMATCH":0,"TEST_FAIL":0,"ACCEPT_P0":0},"codes":{"EVIDENCE_MISSING":1,"FILE_MISSING":1}}}
PROBE TC-20 = {"pass":false,"codes":["REWORK_BUDGET_EXHAUSTED"],"metrics":{"advanceBlocked":{"clarify":1,"design":0,"build":0,"test":0,"accept":0,"ship":0},"rework":{"DESIGN_UNFEASIBLE":0,"CONTRACT_GAP":0,"CONTRACT_CONFLICT":1,"IMPL_MISMATCH":0,"TEST_FAIL":0,"ACCEPT_P0":0},"codes":{"REWORK_BUDGET_EXHAUSTED":1}}}
PROBE TC-21 = {"stage":"clarify","advanced":false,"pass":true,"reworkStage":"clarify","metrics":{"advanceBlocked":{"clarify":1,"design":0,"build":0,"test":0,"accept":0,"ship":0},"rework":{"DESIGN_UNFEASIBLE":0,"CONTRACT_GAP":0,"CONTRACT_CONFLICT":0,"IMPL_MISMATCH":0,"TEST_FAIL":1,"ACCEPT_P0":0},"codes":{"FILE_MISSING":1}},"message":"metrics — stage clarify, rework counters belong to clarify\nadvance blocked by stage: clarify=1\nrework by failure type: TEST_FAIL=1\nfinding codes: FILE_MISSING=1","bytesEqual":true}
PROBE TC-22 = {"stage":"clarify","reworkStage":"clarify","metrics":{"advanceBlocked":{"clarify":0,"design":0,"build":0,"test":0,"accept":0,"ship":0},"rework":{"DESIGN_UNFEASIBLE":0,"CONTRACT_GAP":0,"CONTRACT_CONFLICT":0,"IMPL_MISMATCH":0,"TEST_FAIL":0,"ACCEPT_P0":0},"codes":{}},"stateFileExists":false}
PROBE TC-23 = {"error":"dsh-fullstack-team: flow state /var/folders/…/T/tc002-probe-8zpYsf/.dsh/devflow/state.json is not valid JSON (Expected property name or '}' in JSON at position 1 (line 1 column 2)); fix it by editing the file, deleting it, or calling devflow_state with action \"reset\"","bytesAfter":"{broken"}
```

### 3.3 造仓实跑的原始输出（节选）

```text
# 命令 4（仓库根）
roles: 8 total — 8 mountable, 0 blocked
cwd: /Users/jiangnan/Documents/deepseek-harness/default-workspace/dsh-fullstack-team (24 top-level entries)
matched: backend-design, ops, pm, qa, dsh-plugin-dev
  ✓ stack  frontend-vue     未命中  全栈研发团队 · 前端开发（Web）

# 命令 5（vite-js）
roles: 8 total — 8 mountable, 0 blocked
cwd: /private/tmp/tc002-repos/vite-js (2 top-level entries)
matched: backend-design, ops, pm, qa, frontend-vue
  ✓ stack  frontend-vue     命中    全栈研发团队 · 前端开发（Web）

# 命令 8（only-pkg）
cwd: /private/tmp/tc002-repos/only-pkg (1 top-level entries)
matched: backend-design, ops, pm, qa
  ✓ stack  frontend-vue     未命中  全栈研发团队 · 前端开发（Web）

# 命令 10（dot-ext，含真实尾点文件 vite.config.）
cwd: /private/tmp/tc002-repos/dot-ext (2 top-level entries)
matched: backend-design, ops, pm, qa
  ✓ stack  frontend-vue     未命中  全栈研发团队 · 前端开发（Web）

# 命令 11（java-pom）
cwd: /private/tmp/tc002-repos/java-pom (1 top-level entries)
matched: backend-design, ops, pm, qa, backend-java
```

## 4. 逐 FP 结论

### 4.1 FP-01 · detect 后缀通配 —— PASS

| 验收标准（`requirement.md` §2） | 结论 | 证据 |
|---|---|---|
| 只有 `vite.config.js`（无 `.ts`）的仓能命中 `frontend-vue` | 通过 | 命令 5：`matched:` 含 `frontend-vue`、该行 `命中`；探针 TC-01 `true`；`src/roles.ts:180`（`markerMatches`）、`roles/frontend-vue.role.yml:8` |
| `.mts` / `.ts` 同样命中 | 通过 | 命令 6、7 + 探针 TC-02、TC-03 |
| 只有 `package.json` 仍不命中 | 通过 | 命令 8：`matched:` 无 `frontend-vue`；探针 TC-04 `false`；`src/roles.ts:157-159`（组内 `every`） |
| 其它写法精确匹配（`vitest.config.ts` 不误判、`package.json` 不当通配、空后缀不命中） | 通过 | 命令 9、10 + 探针 TC-05、TC-06、TC-07、TC-08；`src/roles.ts:181-186` |
| 组合逻辑不变（组内 AND、组间 OR） | 通过 | 探针 TC-09（通配不削弱 AND）、TC-10（`backend-java` 三选一仍成立）、命令 11 |
| 生成物同步 | 通过 | 命令 12：`roles/frontend-vue.role.yml:8` 为 `[package.json, vite.config.*]`；`skills/role-init/SKILL.md:17`、`:20` 与 `docs/dev/project-standard.md:37` 三处同语义；`presets/roles.patch.yml` 0 处 `detect`、sha256 未变（符合 `design.md` §1 不变量） |

结论：FP-01 **PASS（6/6 条验收标准逐项有实测证据）**。

### 4.2 FP-02 · 度量落盘 —— PASS

| 验收标准（`requirement.md` §2 / `api-contract.md` §1.4） | 结论 | 证据 |
|---|---|---|
| `advanceBlocked` 按阶段计数、六阶段零填充 | 通过 | 探针 TC-12（全 0）、TC-13（`clarify=1`）、TC-14（`design=1`、`clarify` 仍 0）、TC-20（预算耗尽也 +1）；`src/state.ts:238-244` |
| `codes` 按 finding code 计数、只统计非 warning | 通过 | 探针 TC-13（`{FILE_MISSING:1}`）、TC-14（同一 code 两条 error ⇒ `2`）、TC-19（warning 在 findings、不在 codes）、TC-20（`REWORK_BUDGET_EXHAUSTED`）；`src/state.ts:241` |
| `rework` 按失败类型计数 | 通过 | 探针 TC-16（两次 ⇒ `CONTRACT_GAP:2`，且与阶段预算同一次写盘）；`src/state.ts:533`、`:541` |
| `advance` 成功不计数 | 通过 | 探针 TC-15（三张表仍全零） |
| `reset` 保留 metrics | 通过 | 探针 TC-17（阶段/预算/历史清空，三张表保留、`version` 仍 2）；`src/state.ts:570-579` |
| 旧 state 缺字段补零、可读、不升版本 | 通过 | 探针 TC-18（`created=false`、`version===2`、补零、下次写盘带上）；`src/state.ts:280`、`:283`、`:287-291` |
| `devflow_state` 新增只读 `metrics` 动作 | 通过 | 探针 TC-21（`advanced=false`、`pass=true`、`reworkStage` 与 `metrics` 齐备、调用前后字节一致）；`src/tools.ts:326-341` |
| 状态不存在时不建文件、返回零结构 | 通过 | 探针 TC-22（`stateFileExists=false`）；`src/state.ts:306-321` |
| 损坏状态维持既有行为（报错、不自动修复） | 通过 | 探针 TC-23（抛 `is not valid JSON`，文件未被改写）；`api-contract.md` §4 |
| 计数与 history/stage 同一次落盘、并发不丢更新 | 通过 | 探针 TC-16（三者同一次写的证据）+ 命令 2（`tests/metrics.spec.ts:126` 同一锁内两次被拒 ⇒ 计数为 2） |

结论：FP-02 **PASS（10/10 条判据逐项有实测证据）**。

## 5. 跳过项

无。本需求是插件层内部逻辑，不依赖宿主重启、不依赖界面渲染、不依赖真实 profile，因此台账 24 条用例全部在本机可执行并已执行完毕；没有以「推断通过」代替实测的条目。

## 6. 统计

| 维度 | 数值 |
|---|---|
| 台账用例总数 | 24（TC-01 ~ TC-24） |
| 功能点总数 | 2（FP-01、FP-02） |
| 用例级 PASS | 24 |
| 用例级 FAIL | 0 |
| 用例级 SKIP | 0 |
| FP 级 PASS / FAIL / SKIP | 2 / 0 / 0 |
| 自动化用例执行（命令 2） | 11 个测试文件、264 例全过、0 失败（含 `tests/metrics.spec.ts` 12 例、`tests/roles.spec.ts` 46 例） |
| 断言探针执行（§2.2） | 全量 22 例全过；逐条 22 次运行全部退出码 0 |
| 造仓实跑 | 7 个 `/tmp` 仓 + 仓库根，共 8 次 `roles.mjs`，全部退出码 0 |
| 新发现缺陷 | 0 |
| 未关闭 P1 | 0 |
| 未执行用例 | 0 |

## 7. test 门自检

自检方式：写一个临时 spec（跑完即删），用项目真实实现 `runGate('test', <002 需求目录绝对路径>)`，打印 `pass` 与每条 finding。

- 自检对象：`/Users/jiangnan/Documents/deepseek-harness/default-workspace/dsh-fullstack-team/docs/dev/002-detect-and-metrics`
- 自检时点：台账与本报告全部编辑完成之后（2026-11-05 10:54）
- 门实现：`src/gates/stages.ts:479`（`runGate`）→ `testGate`（`:289`；读 `requirement.md`、`test-cases.md`、`test-report.md`，逐条比对功能点覆盖与用例集孤儿 id）
- 临时 spec 命令与输出（spec 名为 `tests/__tmp_gate_probe_002.spec.ts`，自检后已删除）：

```text
$ npx vitest run tests/__tmp_gate_probe_002.spec.ts
GATE PASS= true
GATE CHECKED= requirement.md,test-cases.md,test-report.md
GATE FINDINGS= 0
Test Files  1 passed (1)
     Tests  1 passed (1)
EXIT=0
```

- 解读：`pass= true`、0 条 finding，三份产物都被读到——`requirement.md` 声明的 2 个功能点在 `test-cases.md` 里都有覆盖，且 `test-cases.md` 没有引入需求未声明的功能点编号；报告存在且非草稿、无空节。
- 第一次自检曾**未通过**，如实记录：`GATE PASS= false`、1 条 `FP_ORPHAN`（`FP-1 in test-cases.md is not declared in requirement.md`）。原因是台账 §0.2 的 fixture 原文里写了一个非零填充的功能点编号 `FP-1`，被门当成「用例集引用了需求未声明的编号」。已把 fixture 统一改成需求里声明的零填充形态（`FP-01`），复跑后 `pass= true`、`FINDINGS= 0`。这是台账自身的表述问题，不涉及实现；探针与 `tests/metrics.spec.ts` 里的 fixture 用的是另一种写法，影响仅是 id 文本，断言语义不变。
- 本报告末尾的时间戳修正完成后又复跑了一次同一条门（临时 spec 换名为 `tests/__tmp_gate_probe_002b.spec.ts`），输出相同：`PASS= true`、`CHECKED= requirement.md,test-cases.md,test-report.md`、`FINDINGS= 0`；该 spec 同样已删除，仓库内无残留。

## 8. 残余风险与观察

| # | 观察 | 证据 | 影响与建议 |
|---|---|---|---|
| R-01 | `markerMatches` 对顶层**目录**名同样生效：工作区里若存在名为 `vite.config.x/` 的目录也会命中 | `src/roles.ts:183-186` 遍历的是 `readdirSync` 的条目名集合，`scripts/roles.mjs:104` 未区分文件与目录 | 与 `api-contract.md` §3「顶层条目名」一致，不构成缺陷；若日后要收紧成「必须是文件」，属新需求 |
| R-02 | `codes` 只按 code 聚合、不带阶段维度，因此 `FILE_MISSING` 在 clarify 与 design 两处会被合并 | 探针 TC-13 与 TC-14 的 `codes` 形状；`design.md` §6.3 已声明这是有意为之 | 不影响本需求判据；要做「阶段 × code」分布需另立需求 |
| R-03 | `pnpm check` 打印 `Unsupported engine: wanted {"node":"^22.19.0 || >=24.0.0"} (current v22.17.0)` | 命令 2 的 stderr（`package.json` 的 `engines.node`） | 环境既有偏差，与本需求无关，`typecheck`/`test`/`build` 均通过；升级 Node 时一并消除 |
| R-04 | `devflow_state` 的 `action` 语义在 `src/tools.ts:87-94`（`ACTION_DOC`）与 `docs/003-tools.md` 两处各写一遍 | `src/tools.ts:90`（`metrics` 段）、`docs/003-tools.md:36` | 本次两处已同步；后续改语义需同时改，属人工一致性风险 |
| R-05 | 临时探针 spec 已按任务边界删除，报告里保留的是它的命令与原始输出；永久回归靠 `tests/metrics.spec.ts`、`tests/roles.spec.ts` | §2.2、§3.1、§3.2；命令 2 的 264 例 | 探针结论与永久用例结论一致（22 例 vs 12+4 例），无单点依赖 |

## 9. 结论与建议

- 2 个功能点全部 PASS（2/2），24 条用例全部执行、0 FAIL、0 SKIP。
- FP-01 的「通配命中」与「通配不越界」两个方向都在真实 `roles.mjs` 进程里跑过：`vite.config.js`/`.mts`/`.ts` 三种扩展名命中，`vitest.config.ts`、`vite.config.`、只有 `package.json` 三种边界都不命中，`backend-java` 的三选一（组间 OR）未回归。
- FP-02 的三张计数表经 `src/state.ts` 与 `src/tools.ts` 真实现逐条验证：门禁拒绝按阶段归因、同一次拒绝的多个 error 逐个累加、成功不计数、`rework` 与阶段预算同一次写盘、`reset` 保留、旧状态补零且版本不变、`metrics` 动作纯读且不建文件、warning 只进 findings 不进 codes。
- 未发现实现缺陷，本报告无须改判的 FAIL；建议直接进入 accept。
- 交付前提醒：本轮只写 `test-cases.md`、`test-report.md`，未改任何代码或测试；工作树中的实现改动仍待 PM 复核后提交。
