# 项目清单 · dsh-fullstack-team

> 声明本仓启用哪几个角色、门禁变体、依赖方向。`role-init` 据此装配；新增角色须同时更新本文件与 `roles/*.role.yml`。

## 0. 三层边界（先说清在改哪一层）

| 层 | 是什么 | 本仓的立场 |
|---|---|---|
| **插件层** | 本仓源码：`src/`、`skills/`、`roles/`、`presets/`、`scripts/`、测试 | 这就是本仓**唯一被开发的对象**；门禁、角色、状态机都住在这里 |
| **宿主层** | DSH 进程：加载 bundle、读 `~/.dsh/profiles/<p>/cordis.patch.yml`、重启后生效 | 不改宿主源码；只通过「生成物 + 合并脚本 + 用户重启」影响它 |
| **业务项目层** | 将来用这套团队去开发的 Java/Vue/Flutter 仓，带数据库与服务器 | 本仓**没有**这一层；权限矩阵、只读账号、生产令牌属于它，本仓不适用 |

判断口径：一句话里出现「数据库/服务器/生产发布令牌」，说的是业务项目层；出现「预设/profile/重启」，说的是宿主层；其余默认插件层。混层是这类文档最容易犯的错。

| 项 | 值 |
|---|---|
| 项目 | dsh-fullstack-team（DSH bundle，Host-only） |
| 端类型 | DSH 插件（无前端/移动端/数据库） |
| 角色集 | `pm`、`backend-design`、`dsh-plugin-dev`、`qa`、`ops` |
| 不装 | `backend-java`、`frontend-vue`、`mobile-flutter`（detect 不命中） |
| 门禁变体 | `devflow` 标准：clarify → design → build → test → accept → ship；review 作为 accept 附加检查 |
| 依赖方向 | 本仓不依赖任何业务仓；下游业务仓通过 bundle 引用本仓技能与工具 |
| 需求目录 | `docs/dev/<NNN-slug>/`；当前 `001-flow-hardening/` |
| 项目规范 | `docs/dev/project-standard.md` |
| 网络 | `github.com` 直连不通，git 走本机代理 `127.0.0.1:7897`（已写入仓库级 `http.proxy`）；离开该网络需清掉这两个配置 |
| 质量基线 | `pnpm check` + 真包集成（缺 pack 则 skip 并报告）+ 宿主插件规范 12 条 |

## 角色职责边界

| 角色 | 写什么 | 不写什么 |
|---|---|---|
| `pm` | 需求/评估/计划/验收文档、裁决、提交 | 业务代码 |
| `backend-design` | `design.md`、`api-contract.md`、门禁契约 | 源码、测试 |
| `dsh-plugin-dev` | `src/`、`scripts/`、`skills/`、`tests/` | 契约、README 口径（须 PM 审定） |
| `qa` | 用例台账、`test-report.md`、证据 | 业务代码 |
| `ops` | CI、发布、`pnpm check` 复跑、包内容核对 | 业务逻辑 |

## 文档契约

| 文档 | 位置 | 谁维护 |
|---|---|---|
| 需求冻结档 / 评估 / 计划 | `docs/dev/001-flow-hardening/` | 主 PM |
| 设计 / 契约 | 同目录 `design.md`、`api-contract.md` | `backend-design` |
| 用例 / 报告 | 同目录 `test-cases.md`、`test-report.md` | `qa` |
| 验收 | 同目录 `acceptance-report.md`、`ui-acceptance.md`（本批无 UI，豁免并写明） | 主 PM |
| 审查 | 同目录 `review-notes.md` | 主 PM |
| 项目规范 | `docs/dev/project-standard.md` | 主 PM |
