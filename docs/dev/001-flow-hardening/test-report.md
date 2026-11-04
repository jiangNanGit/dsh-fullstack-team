# 001 · 测试执行报告（test-report）

| 项 | 值 |
|---|---|
| 需求编号 | 001（`requirement.md` 已冻结，声明 29 个功能点） |
| 用例台账 | `test-cases.md`（TC-01 ~ TC-156；批二 116 条 + 批三 40 条） |
| 执行者 | 全栈研发团队 · 测试（qa） |
| 执行日期 | 2026-11-04（第二轮重跑，18:20 ~ 18:32） |
| 执行环境 | 仓库根 `dsh-fullstack-team`；Darwin 23.6.0；Node v22.17.0；pnpm 11.28.5 |
| 结论 | 29 个 FP：**29 PASS / 0 FAIL / 0 SKIP**；另有 3 项子检查 SKIP（需重启宿主，见 §5）。文档口径缺陷 N-01 已于 2026-11-04 处置关闭，P1 未关闭 0（见 §4.1） |
| 能否进 accept | **可以推进**：FP-11、FP-12 已按修正后的冻结判据实测通过；N-01 已关闭，无未关闭 P1 |

本报告只记录实际执行过的命令与实际观察到的输出。无法在本机验证的项目一律记 SKIP 并写明原因，不以「推断通过」替代。本轮变化的来源：①主 PM 于 2026-11-04 修正 FP-11 验收口径（`requirement.md:248`）；②FP-12 的 `detect` 组语义在 `src/roles.ts` 落地并接入 `scripts/roles.mjs`。台账 TC-119、TC-122 已按新判据重写，TC-117、TC-118、TC-120、TC-121 同步了新输出/新语义的断言。

## 1. 环境与前置

| 项 | 实测值 |
|---|---|
| 操作系统 | Darwin 23.6.0（macOS） |
| Node | v22.17.0 |
| pnpm | 11.28.5 |
| npm | 10.9.2 |
| 构建产物 | `lib/index.js`（68731 B）、`lib/roles.js`（10546 B），2026-11-04 18:21 由 `pnpm check` 末尾的 `tsdown` 重建；`lib/roles.js` 已导出 `roleMatches` |
| team-core 技能包 | 存在：`~/.dsh/skill-packs/team-core`，9 个技能（acceptance-guard、dev-orchestrator、error-triage、impeccable、ops-runbook、requirement-clarify、taste、ui-theme-governance、yunxiao-projex-ops） |
| flutter 技能包 | 存在：`~/.dsh/skill-packs/flutter` |
| 生成物 | `presets/roles.patch.yml`，sha256 `b0b42337dbd6514bfb7060f0cce9666aba791b406a86619ff79d71cea194809f`，1171 行；本轮所有命令均未改写它 |
| 真实 profile | `~/.dsh/profiles/desktop/cordis.patch.yml` 未读写；FP-14 只在 `/tmp/fp14` 的副本上操作 |
| 需求目录配置 | `docs/dev/001-flow-hardening/devflow.config.json`：`ui.applicable=false` 且带 reason（UI 产物豁免，合法） |
| 工作目录 | 仓库根；所有命令在此执行；临时产物只写 `/tmp`（`/tmp/fp12`、`/tmp/fp12-java`、`/tmp/fp12-node`、`/tmp/fp14`、`/tmp/fp16b`、`/tmp/fp19`、`/tmp/fp25`、`/tmp/qa-fp24`） |

前置结论：真包集成可以在本机执行（team-core 在位）；宿主级渲染与安装效果不在本机可观测范围，见 §5。

## 2. 执行命令与结果摘要

### 2.1 本轮重跑（全部在当前工作树上实测）

| # | 命令 | 退出码 | 关键输出 |
|---|---|---|---|
| 1 | `pnpm check` | 0 | `typecheck` + `vitest` + `skill-audit` + `tsdown` 全绿；`Test Files 10 passed (10)`、`Tests 248 passed (248)`；`技能体检通过`；`Build complete` |
| 2 | `node scripts/roles.mjs`（仓库根） | 0 | 首行 `roles: 8 total — 8 mountable, 0 blocked`；`matched: backend-design, ops, pm, qa, dsh-plugin-dev`；8 条 `✓`（4 core + 4 stack，均带命中列）；`dsh-plugin-dev` 为 `命中`、`frontend-vue` 为 `未命中`；无 `✗` |
| 3 | `node scripts/roles.mjs --out /tmp/qa-fp24/out2.yml` | 0 | `wrote /tmp/qa-fp24/out2.yml (1171 lines)`、`(presets/roles.patch.yml 未改动；--out 只写指定路径)`；`presets` sha256 前后同为 `b0b42337…4809f` |
| 4 | `node scripts/roles.mjs --out ""` | 2 | stderr `用法：node scripts/roles.mjs [--write] [--out <path>]` |
| 5 | `node scripts/install-presets.mjs --dry-run --profile /tmp/fp14/dry/cordis.patch.yml` | 0 | `dry-run：以下变更不会写入任何文件`；`预设      8 个：…preset-dsh-plugin-dev…`；副本 sha256 不变（`same=yes`）；目录里无 `.bak-*` |
| 6 | `node scripts/install-presets.mjs --profile /tmp/fp14/merge/cordis.patch.yml` | 0 | `已合并 8 个预设 → …`、`备份：…bak-20261104-182547`、`区域外 8 行未改动；结构校验通过`；`presets= 8 unique= 8` |
| 7 | 同一条命令第二次 | 0 | `已是最新：… 与生成物一致（8 个预设），未写入、未备份`；仍只有 1 个备份；合并后 sha256 `df9b6bf0…658fe` |
| 8 | 对含重复顶层 id 的副本执行合并 | 1 | `合并后校验失败，已回滚 /tmp/fp14/bad/cordis.patch.yml（来自 …bak-20261104-182551）`、`✗ 顶层条目 id 重复：ui-chat`；`same=yes`（sha256 复原） |
| 9 | `node scripts/skill-audit.mjs skills` | 0 | `规则：通用 5 条（未找到 project-facts.json，只用通用规则）`、`技能体检通过` |
| 10 | `node scripts/skill-audit.mjs /tmp/fp25/skill --facts /tmp/fp25/facts.json` | 1 | `规则：通用 5 条 + 项目 3 条`；3 处命中（`[公司/项目名]`、`[业务仓名]`、`[业务表名]`）；`共 3 处需要分离` |
| 11 | `node scripts/skill-audit.mjs /tmp/fp25/skill`（无 facts） | 0 | `技能体检通过`（通用规则不含这些词） |
| 12 | `npm pack --dry-run --json --ignore-scripts` | 0 | `files= 40`；`lib/ locale/ icon.svg scripts/ skills/ roles/ templates/ presets/ docs/ examples/ cordis.patch.yml` 全可见；`tests= false src= false` |
| 13 | `node -e "import('./lib/index.js')…"` | 0 | `exports Config,apply,expandDir,inject,name`、`apply is function` |
| 14 | `HOME=/tmp/fp19 npx vitest run tests/integration` | 0 | `(3 tests | 3 skipped)`、`Tests 3 skipped (3)`，无 `passed` |
| 15 | `node -e` 读 README/docs 本地链接（TC-132） | 0 | `local links checked 10 broken 0` |
| 16 | 副本注入 `docs/NOPE.md` 链接（TC-133） | 1 | `checked 11 broken 1`、`BROKEN README.md -> docs/NOPE.md` |
| 17 | `grep -rn "Nine Agent Skills\|SKILL-SYSTEM\.md\|SKILL-INDEX\.md" README.md docs/*.md` | 1（无匹配） | 无输出 |
| 18 | `grep -nE "shuangrui\|科贸\|领先未来\|双蕊\|platform\)-manage" scripts/skill-audit.mjs` | 1（无匹配） | 无输出 |
| 19 | `test -f cordis.patch.yml && test -f tsdown.config.ts` 等（TC-118） | 0 | `HIT`、`NO-VITE`、`NO-FLUTTER` |
| 20 | `node -e` 断言 FP-11 新判据（TC-119） | 0 | 7 行 `PASS`；`include= role-init,dev-orchestrator,requirement-clarify,acceptance-guard`；`ALL= true` |
| 21 | `node -e` 构造仓库 + `roleMatches`（TC-121） | 0 | `markers: ["package.json"]`、`stack roles matched: []`、`frontend-vue matched: false` |
| 22 | `/tmp/fp12-java`（仅 `pom.xml`）跑 `node scripts/roles.mjs`（TC-122） | 0 | `matched: backend-design, ops, pm, qa, backend-java`；`backend-java` 命中、`frontend-vue` 未命中 |
| 23 | `/tmp/fp12-node`（仅 `package.json`）跑 `node scripts/roles.mjs`（TC-122） | 0 | `matched: backend-design, ops, pm, qa`；`frontend-vue` 未命中（组内 AND） |
| 24 | `node -e` 调 `roleMatches` 的 7 行矩阵（TC-122） | 0 | `backend-java ["pom.xml"] => true`、`["build.gradle.kts"] => true`、`[] => false`；`frontend-vue ["package.json"] => false`、`["package.json","vite.config.ts"] => true`；`dsh-plugin-dev ["cordis.patch.yml"] => false`、`[两个标记] => true` |
| 25 | 临时 spec 调 `runGate('test', <001 绝对路径>)` | 0 | 见 §7 |

### 2.2 上一轮已验、本轮未改动模块的保留结果

| # | 命令 | 退出码 | 关键输出 | 说明 |
|---|---|---|---|---|
| 26 | `npx vitest run tests/integration`（有 pack） | 0 | `real-pack.spec.ts (3 tests)`、`Tests 3 passed (3)` | 本轮已被命令 1 的 `vitest run` 覆盖（同 3 例 passed） |
| 27 | 临时 spec 读工具参数描述（TC-155） | 0 | `devflow_gate stage lines= 6`、`devflow_state action lines= 5`、`devflow_state failure lines= 7` | `src/tools.ts` 本轮未改动，结果沿用上一轮；如需可重跑同一临时 spec |

## 3. 逐 FP 结论

| FP | 结果 | 证据 |
|---|---|---|
| FP-01 | PASS | `tests/packs.spec.ts:167`（pack 自引用 rebase）、`tests/integration/real-pack.spec.ts:86`（impeccable 正文无外部前缀且含 `<pack>/impeccable/`）；命令 1 全绿 |
| FP-02 | PASS | `tests/packs.spec.ts:98`（缺包装配抛错）、`:208`（点名每个缺失技能并列出可见集合）；命令 1 全绿 |
| FP-03 | PASS | `tests/gates.spec.ts:545`（30 条无证据 → `REVIEW_EVIDENCE_MISSING` 恰 30 条）；命令 1 |
| FP-04 | PASS | `tests/gates.spec.ts:418`（`ACCEPT_EVIDENCE_MISSING`）、`:463`（`P0_OPEN` 阻断）；命令 1 |
| FP-05 | PASS | `tests/gates.spec.ts:356-359`（缺 `test-report.md` → `FILE_MISSING`，路径为 `test-report.md`）、`:348`（三产物固定顺序）；命令 1 |
| FP-06 | PASS | `tests/gates.spec.ts:485`（缺 `ui-acceptance.md` 失败）、`:492`（有 reason 的豁免通过并告警）；`devflow.config.json` 的 reason 非空；命令 1 |
| FP-07 | PASS | `tests/gates.spec.ts:658`（accept 组合门含 review）、`tests/state.spec.ts:173`（六阶段走完）；命令 1 |
| FP-08 | PASS | `tests/gates.spec.ts:172`（表格行端点）、`:180`（query 归一）、`:184`（尾斜杠等价）；命令 1 |
| FP-09 | PASS | `tests/state.spec.ts:78`（损坏文件拒读、不修复）；命令 1 |
| FP-10 | PASS | `tests/state.spec.ts:195`（新阶段从 1 重新计数）、`:202`（耗尽后即使门过也拒 advance）；命令 1 |
| FP-11 | **PASS** | ①角色报告 8 个全部可装：命令 2 首行 `roles: 8 total — 8 mountable, 0 blocked`、8 条 `✓`、`dsh-plugin-dev` 为 `命中`；②本仓命中：命令 2/19（两个标记都在）；③依赖与兜底有声明：`roles/dsh-plugin-dev.role.yml:3`（description 写明依赖官方 `cordis-plugin-development`、`include` 引用不到、环境不提供时按 `docs/dev/project-standard.md` §8.1 执行）；`docs/dev/project-standard.md:92`（§8.1 标题）、`:94`（12 条清单＝宿主侧等价物，硬写会按 FP-02 启动失败）；④负例断言：`include` 四项不含该名（`:8-12`），命令 20 退出 0、7 条 `PASS`、`ALL= true`。TC-119 按 PM 修正后的判据执行，不再要求 include 出现官方技能 |
| FP-12 | **PASS** | 文档与代码同一语义：`skills/role-init/SKILL.md:20` 逐字给出「组内 AND、组间 OR」、`:22` 指向代码落点 `roleMatches`；代码 `src/roles.ts:143`（`roleMatches`）、`:147-149`（`some` 跨组、`every` 组内）；`scripts/roles.mjs:104-106` 读仓库根标记并调用该函数、`:131` 输出 `matched:`；单测 `tests/roles.spec.ts:108`、`:114`、`:120`、`:127`、`:134`、`:140`、`:145`、`:152`、`:159` 共 9 条。本仓不被判成 `frontend-vue`：命令 2 的 `matched:` 含 `dsh-plugin-dev`、不含 `frontend-vue`；只含 `pom.xml` 的仓命中 `backend-java`：命令 22。命令 23/24 覆盖「只有 `package.json` 不命中 `frontend-vue`」与 7 行真假矩阵。**注**：`docs/dev/project-standard.md:37` 的旧说法曾单列为 N-01，已于 2026-11-04 修正关闭（§4.1）；`project-standard.md:37` 现与 `role-init:20`、`src/roles.ts:143` 三处同语义，不影响本 FP 判定 |
| FP-13 | PASS | TC-123 输出 `pm has impeccable/taste= true`、`mobile-flutter has acceptance-guard= true`、`manifest/preset mismatches= 0`；`presets/roles.patch.yml:429-440`、`:1150-1156`；TC-124 副本删除 `- taste` 后断言失败（exit 1，`MISMATCH pm`） |
| FP-14 | PASS | 命令 5~8 覆盖 dry-run 不写盘、真实合并与备份、二次幂等、校验失败回滚；`tests/scripts/install-presets.spec.ts:93`、`:111`、`:147`、`:160` 共 9 例通过（命令 1 内）；真实 profile 未被改写 |
| FP-15 | PASS | TC-129：`grep -c '^## [1-9]\.' docs/dev/project-standard.md` = `9`；`docs/dev/project-manifest.md:9-10` 声明角色集与不装清单；TC-130 副本缺章或缺角色时断言失败 |
| FP-16 | PASS | 命令 17（三处过时说法零匹配）、命令 15（`local links checked 10 broken 0`）、命令 16（注入断链被抓）；`README.md:10`「one Agent Skill」与 `ls skills` 只有 `role-init` 一致 |
| FP-17 | PASS | `.github/workflows/ci.yml:36`（`run: pnpm check`）、`:41`（`node scripts/skill-audit.mjs skills`）、`:46-62`（真包集成跳过必须在 job summary 说明）；触发为 `push` 与 `pull_request`；集成用例由 `pnpm check → test → vitest` 收集；TC-135 断言缺任一命令即失败 |
| FP-18 | PASS | `skills/role-init/SKILL.md:120`（发布包不含 `tests/` 与 `src/`，安装形态不要跑 `pnpm test`）、`:122`（拿不到源码目录必须「报告给用户」，禁止冒充通过）；TC-137 三个关键词计数均 1 |
| FP-19 | PASS | 命令 1 内 `real-pack.spec.ts` 3 passed（`tests/integration/real-pack.spec.ts:77`、`:86`、`:98`）；命令 14：`HOME` 指向空目录时 3 skipped、无 `passed`，符合「缺包不伪造通过」；`tests/integration/real-pack.spec.ts:52-58` 有显式警告 |
| FP-20 | PASS（渲染子项 SKIP，见 §5） | `locale/en.json:3-4`（title 15 字符 / description 226 字符）、`locale/zh.json:3-4`（6 / 85），均非空；`icon.svg` 471 B < 256 KiB 且首尾为 `<svg …>`/`</svg>`；`package.json:29-33` 的 `exports` 含 `./locale/*.json` 与 `./icon`、`:35-38` 的 `files` 含 `locale/*.json` 与 `icon.svg`；命令 12 的 pack 清单含两项 |
| FP-21 | PASS | `skills/role-init/SKILL.md:31`（「先定包根」小节）、`:38`（`PKG="$(cd "<skill 目录>/../.." && pwd)"`）、`:43`（不许把 `pwd` 当包根）、`:50`（不在包根时用绝对路径）；`docs/005-skill-hygiene.md:30`（包根与绝对路径说明） |
| FP-22 | PASS | `tests/core-skills.spec.ts:63`（全局补丁恰一条）、`:79`/`:88`（文档声明内置技能为公共核心、只有 pack 技能可隔离）、`:95`（preset 不列 `role-init` 时它仍可见）；命令 1 全绿 |
| FP-23 | PASS（安装子项 SKIP，见 §5） | 命令 12：`files= 40`，含 lib/scripts/skills/locale/icon 等 11 类，`tests= false src= false`；`README.md:73`（git 树无 `lib/`，先 `pnpm install && pnpm build` 或 `npm pack`）、`:74`（peer 在 `autoInstallPeers:false` 下不自装）、`:78`（发布包内容与不含 src/tests）；命令 13：入口可加载 |
| FP-24 | PASS | 命令 3：`--out` 写出 1171 行、`presets` sha256 不变；命令 4：缺值退出 2；`grep -c 'providerName: dsh-fullstack-team' presets/roles.patch.yml` = `8`，`examples/role-preset.patch.yml:138` 同值，`docs/002-role-presets.md:69` 写明「不是 `dsh-fullstack-team-<role>`」 |
| FP-25 | PASS（残余风险 R-01） | 命令 9：无 facts 时明说只用通用规则；命令 10：给 facts 时 3 处命中并退出 1；命令 18：被删除的公司名/仓名正则无匹配；`scripts/skill-audit.mjs:184-222` 的规则全部来自配置 |
| FP-26 | PASS | `tests/state.spec.ts:307`（失败类型恰 6 个）、`tests/tools.spec.ts:107`（`failure` enum 为 6 且不含 `DEPLOY_FALSE_GREEN`）；`docs/001-design.md:35` 与 `docs/003-tools.md:7` 均为「六阶段、四门＋一检查、115 条由人执行、机检下限 30」；命令 1 全绿 |
| FP-27 | PASS | 命令 1 内 `tests/config.spec.ts` 3 例通过（`:21-30` 保留 hint、`:32-39` schema 内省 `hint.type === 'string'` 且非必填、`:41-47` 无 hint 时键不存在）；命令 27（临时 spec）：stage/action/failure 参数描述分别 6/5/7 行，逐值给出判据；`src/tools.ts:68-97` 为三个文档常量 |
| FP-28 | PASS | `tests/gates.spec.ts:598`/`:608`（`EVIDENCE_OUTSIDE_ROOT`，越界不读）、`:705`（相对 root 抛 `/must be absolute/`）；`tests/state.spec.ts:281`（20 次串行写不丢计数）、`:341`（写锁）、`:354`（陈旧锁清理）；命令 1 全绿 |
| FP-29 | PASS | `tests/gates.spec.ts:249`（容器标题不报 `EMPTY_SECTION`）、`:258`（真空子节仍报）；命令 25 对 001 自身执行 test 门，产物里没有 `EMPTY_SECTION`；`src/gates/artifact.ts:287-300` 为容器例外实现 |

## 4. 失败与新发现问题

本轮 **FP 级 FAIL = 0**。TC-119、TC-122 按修正后的判据实测通过；未发现新的用例失败。此前唯一一条不属于任何 FP 冻结判据的文档口径缺陷 N-01 已由主 PM 修正，本节保留原问题、处置与复核记录，状态为**已关闭**。

### 4.1 N-01 · `project-standard.md` 的 `detect` 语义（已处置，2026-11-04 关闭；原 P1）

- **原状（已消除）**：`docs/dev/project-standard.md:37` 曾写「**detect 语义**：`roles/*.role.yml` 的 `detect` 是 AND——全部标记命中才装该 stack 角色（core 恒装）……」，与组语义冲突：按字面执行，只有 `pom.xml` 的 Java 仓（`roles/backend-java.role.yml:6-9` 是三个单元素组）将永不命中，与本轮实测（命令 22：`backend-java` 命中）及 `role-init` 的「组内 AND、组间 OR」（`skills/role-init/SKILL.md:20`）相反。
- **处置**：主 PM 于 2026-11-04 改写 `docs/dev/project-standard.md:37`，现文本为「**detect 语义**：`roles/*.role.yml` 的 `detect` 是**组列表**——组内 AND、组间 OR，单个字符串即单元素组（如 `backend-java` 的 `pom.xml`/`build.gradle`/`build.gradle.kts` 是三选一，`frontend-vue` 的 `[package.json, vite.config.ts]` 要求同时存在）。core 恒装。判定由 `src/roles.ts` 的 `roleMatches(role, markers)` 执行，`role-init` 的表格与此同一语义。」
- **复核命令与结果**（2026-11-04 重跑）：
```bash
grep -n "组内 AND、组间 OR" docs/dev/project-standard.md; echo "GROUP-EXIT=$?"
grep -n "detect\` 是 AND\|detect 是 AND" docs/dev/project-standard.md; echo "OLD-LITERAL-EXIT=$?"
```
```text
37:**detect 语义**：`roles/*.role.yml` 的 `detect` 是**组列表**——组内 AND、组间 OR，单个字符串即单元素组（如 `backend-java` 的 `pom.xml`/`build.gradle`/`build.gradle.kts` 是三选一，`frontend-vue` 的 `[package.json, vite.config.ts]` 要求同时存在）。core 恒装。判定由 `src/roles.ts` 的 `roleMatches(role, markers)` 执行，`role-init` 的表格与此同一语义。
GROUP-EXIT=0
OLD-LITERAL-EXIT=1
```
- **结论**：新文本覆盖「组内 AND、组间 OR」并删除了旧的扁平 AND 字面（旧字面零匹配）。`project-standard.md`、`role-init`、`src/roles.ts` 三处口径现已一致；N-01 关闭，P1 未关闭数归零，FP-12 判定不变（PASS）。此前 §4.1 的判定边界（`project-standard.md` 不在 FP-12 冻结落点内）保留为历史记录，不再有未决事项。
- **台账联动**：`test-cases.md` §5 的 D-13 记录仍保留原偏差描述与「待处置」字样；本报告为执行侧最新状态，D-13 的状态以本节为准（本角色边界只允许改 `test-report.md`，不改台账）。

## 5. 跳过项

| # | 子检查 | 为何不能在本机验证 | 处置 |
|---|---|---|---|
| S-01 | FP-20 的「插件页/详情实际显示本包标题、描述、图标」 | 需要宿主重新加载本包并在界面渲染；本会话不重启宿主，界面不可观测 | 文件与 schema 层已由 TC-140 ~ TC-142 锁定；渲染效果留待重启后人工确认 |
| S-02 | FP-23 的「按官方 `install_bundle` 安装并渲染资源」与「重启后 8 预设生效」 | 官方安装流程要在 profile 内执行并重启宿主；本次边界要求不 build、不重启、不动真实 profile | 包清单、README、入口可加载已由 TC-145 ~ TC-147 锁定；安装与生效留待重启后复验 |
| S-03 | 本会话 `devflow_gate` 工具对 001 的 test 结果 | 会话开始时工具返回 19 条 findings（4 条 `EMPTY_SECTION` + 15 条 `FP_UNCOVERED`）；台账与报告补齐后仍余 4 条 `EMPTY_SECTION`（`requirement.md` 的「0. 原文逐字转录」「2. 系统边界推演」「3. 要素澄清表」「6. 风险点 / 问题点 / 待澄清点」）。而仓库当前 `src/gates/artifact.ts:287-300` 与 `lib/index.js:389-391` 都已有容器例外，真实现实测 0 条。说明宿主进程加载的是 FP-29 修复之前的构建（模块缓存），需重启宿主才会换到新构建 | 本报告按任务要求用 `runGate` 真实现自检（§7）；工具侧结果重启后复验，不据此判 FAIL |

## 6. 统计

| 维度 | 数值 |
|---|---|
| 台账用例总数 | 156（TC-01 ~ TC-156） |
| 功能点总数 | 29（`FP-01` ~ `FP-29`） |
| FP 级 PASS | 29 |
| FP 级 FAIL | 0 |
| FP 级 SKIP | 0 |
| 子检查 SKIP | 3（S-01、S-02、S-03，未变） |
| 新发现缺陷 | 1（N-01，文档口径 P1，不属于任何 FP 冻结判据；**已于 2026-11-04 关闭**） |
| P1 未关闭 | 0 |
| 自动化用例执行 | `pnpm check`：10 个文件、248 例全过、0 失败（上一轮 239 例；本轮新增 `tests/roles.spec.ts` 的 9 条 `roleMatches` 用例等） |
| 真包集成 | 有包 3 passed；无包 3 skipped（两条分支都实测） |
| 失败用例数 | 0 |
| 未执行用例数 | 0 |
| 本轮改判 | FP-11 FAIL → PASS；FP-12 FAIL → PASS |

## 7. test 门自检

自检方式：写一个临时 spec（`tests/__tmp_gate_probe.spec.ts`，跑完删除），用项目真实实现 `runGate('test', <001 绝对路径>)`，打印 `pass` 与每条 finding。

- 自检对象：`/Users/jiangnan/Documents/deepseek-harness/default-workspace/dsh-fullstack-team/docs/dev/001-flow-hardening`
- 自检时点：N-01 关闭后、本报告全部编辑完成之后（2026-11-04 18:31）
- 门实现：`src/gates/stages.ts:479`（`runGate`）→ `testGate`（`:289`）
- 实际输出：

```text
PASS= true
CHECKED= requirement.md,test-cases.md,test-report.md
FINDINGS= 0
```

- 解读：`pass= true`，0 条 finding；三份产物 `requirement.md`、`test-cases.md`、`test-report.md` 都被读到，即 29 个 FP 的覆盖检查与执行报告检查都通过。临时 spec 已在自检后删除。

## 8. 残余风险与观察

| # | 风险 | 证据 | 建议 |
|---|---|---|---|
| R-01 | `skill-audit.mjs` 的 docstring 仍以 `mall-manage`、`merchant-web`、`biz_`、`t_` 作为示例值；这些名字与 git 历史中被删除的「业务仓名/表前缀」规则同源（`97382aa`） | `scripts/skill-audit.mjs:31-33` | 把示例值改成 `<repo-name>`、`<table-prefix>`，避免发布脚本里继续出现像真实项目名的字面量；功能判据不受影响 |
| R-02 | FP-11 的官方 `cordis-plugin-development` 由宿主提供，本包不 include、也不保证环境一定提供；当前合规形态是「manifest 声明 + §8.1 的 12 条清单兜底」 | `roles/dsh-plugin-dev.role.yml:3`；`docs/dev/project-standard.md:94` | 宿主未提供该技能时，`dsh-plugin-dev` 必须严格按 §8.1 清单逐条执行；验收时抽查一次该清单是否被真实使用 |
| R-03 | 批三 15 个 FP 不在 `design.md` 覆盖清单内（`design.md:20-21` 明示只覆盖批二 14 个） | `design.md:20`、`:21` | 台账与报告按冻结档验收；设计档缺口由主 PM 在评审时确认是否需要回写 |
| R-04 | 会话内 `devflow_gate` 工具仍是旧构建（见 S-03），重启前它对 001 仍报 4 条 `EMPTY_SECTION`（真实现 0 条） | 工具输出 4 条 vs `src`/`lib` 实测 0 条 | 重启宿主后复跑一次，确认与 §7 一致 |
| R-05 | （已关闭 2026-11-04）`docs/dev/project-standard.md:37` 曾是扁平 AND；现为「组列表——组内 AND、组间 OR」 | 复核 `grep`：`GROUP-EXIT=0`、`OLD-LITERAL-EXIT=1`；`docs/dev/project-standard.md:37` vs `skills/role-init/SKILL.md:20`、`src/roles.ts:143` | 无需再处置；后续改该行时保持组语义 |

## 9. 结论与建议

- 29 个功能点全部 PASS（29/29），其中 FP-11、FP-12 已按修正/落地后的判据实测通过：FP-11 由「include 必须含官方技能」改为「manifest 与文档声明依赖 + §8.1 兜底，且 include 不得硬写」；FP-12 由「无可执行判定」改为「`roleMatches` 可执行 + 组内 AND、组间 OR，本仓不被判成 frontend-vue、pom-only 能命中 backend-java」。
- 本轮重跑覆盖：`pnpm check`（248 例全绿）、`node scripts/roles.mjs`（8 角色可装、`matched:` 含 `dsh-plugin-dev`）、`/tmp/fp12-java` 与 `/tmp/fp12-node` 两个构造目录、FP-11 的 7 条断言、以及台账 §3 的批三命令；结果与台账一致，无新的用例失败。
- 3 个 SKIP 都依赖宿主重启：界面渲染、官方安装流程、会话内工具换新构建。重启后需补一次人工确认，并把结果回填本报告 §5。
- N-01 已于 2026-11-04 关闭：`docs/dev/project-standard.md:37` 改为「组列表——组内 AND、组间 OR」，复核 `GROUP-EXIT=0`、`OLD-LITERAL-EXIT=1`；至此 `project-standard.md`、`role-init`、`src/roles.ts` 三处口径一致，P1 未关闭 0。
- 因此本报告不再有未闭环缺陷，建议直接进入 accept；accept 通过后重启宿主，回填 S-01/S-02/S-03。
