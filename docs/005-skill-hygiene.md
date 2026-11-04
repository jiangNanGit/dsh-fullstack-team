# 技能体检：能力里不许有项目

一条判据：**换个项目，这份 SKILL.md 一字不改还能用吗？**

能用 = 能力。要改项目名、表名、地址、账号才能用 = 项目事实混进了能力文件。

## 为什么这是硬约束

技能被多少个项目挂载，错误就被复制多少份。更麻烦的是反向：项目改了表名，技能里那份不会跟着改，而它看上去像是权威。

所以分工是刚性的：

| 内容 | 归属 | 位置 |
| --- | --- | --- |
| 怎么做、怎么判、判据是什么 | 技能 | `skills/<能力名>/SKILL.md` |
| 项目叫什么、表叫什么、地址是什么、账号是谁 | 项目 | `<项目根>/.agents/specs/` |

技能里唯一允许出现的项目信息，是**索引指针**：读 `<项目根>/.agents/specs/INDEX.md`。索引长什么样由项目自己定，技能不假设条目名，只要求"取不到就报告，不要拼凑"。

## 检查方式

```bash
# 体检一个技能包；项目事实清单缺省时只跑通用规则
node scripts/skill-audit.mjs ~/.dsh/skill-packs/team-core

# 指定项目事实清单
node scripts/skill-audit.mjs skills --facts /path/to/project-facts.json
```

脚本位于包根 `scripts/`（本仓即包根，`docs/` 的上一级），需在包根执行——上面的 `scripts/skill-audit.mjs` 是相对路径，换个目录就找不到文件；也可改用绝对路径 `<包根>/scripts/skill-audit.mjs` 在任意目录调用。被体检的 `~/.dsh/skill-packs/team-core` 是用户侧的技能包，与包根无关，照写即可。`pnpm audit:skills` 等价于 `node scripts/skill-audit.mjs skills`，已并入 `pnpm check`。

规则分两套：

- **通用规则（始终启用，无需配置）**，四类：本机绝对路径、口令或手机号、接口路径、主机或连接串。这些事实在任何项目里都是错的，所以写死在脚本里。
- **项目规则（可选，来自 `project-facts.json`）**：公司名、业务仓名、表前缀、表名、主机、接口、账号，以及自定义词条。脚本自身不携带任何项目事实；没有这个文件就只跑通用规则，并在输出里明说「未找到 project-facts.json，只用通用规则」。

`project-facts.json` 放在工作区根。查找顺序：`--facts <file>` → `<cwd>/project-facts.json` → 本仓根 `project-facts.json`。所有键均可省略，值是字符串或字符串数组，**按字面量匹配，不是正则**（下面各值是示意，实际填本项目自己的）：

```json
{
  "companyNames": ["某某公司", "某某品牌"],
  "repoNames": ["mall-manage", "merchant-web"],
  "tablePrefixes": ["biz_", "t_"],
  "tableNames": ["biz_order", "sys_user"],
  "hosts": ["rds.example.internal"],
  "endpoints": ["/api/order/list"],
  "accounts": ["admin1", "13800138000"],
  "extraRules": [{ "label": "业务术语", "pattern": "双十一会场" }]
}
```

`$` 或 `_` 开头的键视为注释；未知键或类型不对是错误（退出码 2），不会静默跳过——拼错的键正好会藏住要查的东西。命中即列出 `文件:行号`。

检测到就是不合格，没有"轻微违规"这一档。

## 分离动作

1. 把命中的段落**原文搬**到 `<项目根>/.agents/specs/<主题>-facts.md`——搬不是删，事实不能丢
2. 在 `specs/INDEX.md` 加一行条目
3. 技能里那段换成指针
4. 重跑体检，归零

凭证类（口令、手机号、密钥）**不搬家，直接删**，改存凭据库；文档里只留"见凭据库"。
