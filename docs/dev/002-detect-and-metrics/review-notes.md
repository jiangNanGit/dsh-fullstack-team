# 002 · 审查记录（review-notes）

> 审查对象：002「detect 通配与度量落盘」。
> 适用范围判别：本需求只动插件层（本仓源码），不涉宿主层与业务项目层。
> 机检下限按本需求规模设为 10 条（`devflow.config.json` 的 `reviewMinVerdicts`）；全量清单由人按需执行。
> 证据路径相对本目录。

## 1. 功能点审查

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 1 | FP-01 通配在真实仓库里成立：`vite.config.js` 的仓能命中 `frontend-vue` | 通过 | test-report.md:170 |
| 2 | FP-01 没有把精确匹配改坏：`vitest.config.ts` 不误判、`package.json` 不当通配 | 通过 | test-report.md:166 |
| 3 | FP-01 没有削弱组合逻辑：组内 AND 仍要求 `package.json` 同时存在 | 通过 | test-report.md:167 |
| 4 | FP-01 三处同步：manifest、`role-init` 表、生成物 | 通过 | test-report.md:168 |
| 5 | FP-02 计数与归因：按阶段、按失败类型、按 code 都能对上 | 通过 | test-report.md:187 |
| 6 | FP-02 `reset` 保留 metrics（打回是既成事实，不因重置消失） | 通过 | test-report.md:176 |
| 7 | FP-02 warning 只进 findings 不进 codes（`UI_ACCEPTANCE_WAIVED` 噪声） | 通过 | test-report.md:177 |
| 8 | FP-02 旧状态文件补零可读、版本仍为 2、下次写盘自然带上 | 通过 | test-report.md:178 |
| 9 | FP-02 `metrics` 动作纯读：不推进、不写盘、无状态不建文件 | 通过 | test-report.md:179 |

## 2. 交付面审查

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 10 | 回归未退：全量 11 文件 264 例通过，含新增的 12 条度量用例 | 通过 | test-report.md:203 |
| 11 | 真机形态验证：8 个造仓实跑 `roles.mjs`，退出码全 0 | 通过 | test-report.md:205 |
| 12 | 范围克制：未做趋势图、未改门禁判定、未碰远端 CI | 通过 | requirement.md:19 |

## 3. 结论

未关闭 P0：0。

审查收口，无阻断项。一条保留意见：`codes` 只按 code 聚合，不带阶段维度——同一 code 在 design 与 accept 被拒会合并计数，看到数字后仍需翻 history 定位。已记在 `design.md` §6，属下一步。

## 4. 说明

- 本需求规模小（2 个 FP），审查按「每条验收标准都要有实测证据」执行，不为凑条数写空结论。
- 拒绝记录中的用例编号走过一次弯路（台账里写了非零填充的编号被门判为孤儿），已改台账表述，未动实现。
