# 001 · 审查记录（review-notes）

> 审查对象：需求 001「流程硬化」的全部交付物。
> 审查方式：逐条对照冻结档的功能点与验收标准，**以实际执行过的证据为准**，不以「设计上应该有」为准。
> 证据路径相对本目录；每条结论都必须能顺着 `文件:行号` 复核到具体记录。
> 清单全量 115 条由人与技能执行；此处记录机检下限之上的关键条目（32 条）。

## 1. 功能点审查（29 条）

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 1 | FP-01 pack 技能 rebase 到 pack 根，不再落到空路径 | 通过 | test-report.md:76 |
| 2 | FP-02 include 缺源时启动即报错并点名可见集合 | 通过 | test-report.md:77 |
| 3 | FP-03 review 检查要求条数下限与逐条证据 | 通过 | test-report.md:78 |
| 4 | FP-04 accept 要求逐 FP 结论、证据与 P0 清零 | 通过 | test-report.md:79 |
| 5 | FP-05 test 产物固定三件套，缺件即 `FILE_MISSING` | 通过 | test-report.md:80 |
| 6 | FP-06 UI 产物可显式豁免，豁免必须带理由 | 通过 | test-report.md:81 |
| 7 | FP-07 accept 串起 review 检查，六阶段可走完 | 通过 | test-report.md:82 |
| 8 | FP-08 端点识别覆盖表格/行内/标题三源并归一 | 通过 | test-report.md:83 |
| 9 | FP-09 状态文件损坏拒读且不自动修复 | 通过 | test-report.md:84 |
| 10 | FP-10 返工预算按阶段重置，耗尽即拒 advance | 通过 | test-report.md:85 |
| 11 | FP-11 插件开发角色的装备与依赖声明 | 通过 | test-report.md:86 |
| 12 | FP-12 detect 组语义在代码中可执行且与文档一致 | 通过 | test-report.md:87 |
| 13 | FP-13 角色装备补齐后与生成物一致 | 通过 | test-report.md:88 |
| 14 | FP-14 预设合并脚本具备备份、幂等、校验、回滚 | 通过 | test-report.md:89 |
| 15 | FP-15 本仓规范与角色清单落盘 | 通过 | test-report.md:90 |
| 16 | FP-16 文档口径纠正，断链清零 | 通过 | test-report.md:91 |
| 17 | FP-17 CI 固定 Node 24 并执行同一套检查 | 通过 | test-report.md:92 |
| 18 | FP-18 技能内命令在安装形态下的可移植性说明 | 通过 | test-report.md:93 |
| 19 | FP-19 真包集成有用例，缺包时跳过而非伪造通过 | 通过 | test-report.md:94 |
| 20 | FP-20 展示元数据（标题/描述/图标）与导出声明 | 通过 | test-report.md:95 |
| 21 | FP-21 技能内先定包根，禁止把 `pwd` 当包根 | 通过 | test-report.md:96 |
| 22 | FP-22 内置技能为公共核心，不可被预设排除 | 通过 | test-report.md:97 |
| 23 | FP-23 分发形态：包清单、git 安装与 peer 限制 | 通过 | test-report.md:98 |
| 24 | FP-24 生成器输出可指定，安装形态不写只读包目录 | 通过 | test-report.md:99 |
| 25 | FP-25 技能体检去硬编码，项目事实外置 | 通过 | test-report.md:100 |
| 26 | FP-26 失败类型收敛为 6 个，文档三处同口径 | 通过 | test-report.md:101 |
| 27 | FP-27 角色包提示字段可配置且 schema 可见 | 通过 | test-report.md:102 |
| 28 | FP-28 gate root 必须绝对路径，证据不得越界 | 通过 | test-report.md:103 |
| 29 | FP-29 容器标题不计入空节判定 | 通过 | test-report.md:104 |

## 2. 交付面审查（3 条）

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 30 | 测试与构建可重复：`pnpm check` 一条命令覆盖类型、用例、体检、构建 | 通过 | test-report.md:131 |
| 31 | 统计口径自洽：29 个功能点全部有结论，失败与未执行为 0 | 通过 | test-report.md:141 |
| 32 | 界面豁免有理由，不是用「不适用」三个字糊过去 | 通过 | devflow.config.json:2 |

## 3. 审查中提出并已闭环的问题

| 问题 | 审查结论 | 处置 | 证据 |
|---|---|---|---|
| FP-11 原验收标准要求 `include` 携带宿主技能，技术上不可实现 | 不通过（原标准有误） | 改标准不改实现：声明依赖 + §8.1 清单兜底 | requirement.md:248 |
| FP-12 `detect` 只被读入、没有消费者 | 不通过（实现缺口） | 补 `roleMatches` 并接入报告列 | requirement.md:249 |
| FP-12 纯 AND 让 `backend-java` 永不命中 | 不通过（语义过度简化） | 改为组内 AND、组间 OR | requirement.md:249 |
| N-01 `project-standard.md` 的 detect 摘要与实现不一致 | 不通过（文档口径） | 已按组语义重写该行 | test-report.md:112 |

## 4. 结论

未关闭 P0：0。

审查收口，无阻断项（见 test-report.md:131）。三点保留意见，均已在需求档与测试报告中登记，不影响本次验收：

1. `docs/001-design.md` §4.1–4.3 已改标「本仓不适用」（本仓无数据库/服务器/发布令牌），本仓对等约束见 `docs/dev/project-standard.md` §8.3；§9 P4 度量仍未实现。
2. 真机 `plugin_manager install_bundle` 安装与重启后预设生效未在本机验证，记为 SKIP（test-report.md:123），需重启后人工复验。
3. 本会话内 `devflow_gate` 工具运行的是修复前的构建（模块缓存），门禁结论以 `lib/` 真实现为准（test-report.md:124）。
