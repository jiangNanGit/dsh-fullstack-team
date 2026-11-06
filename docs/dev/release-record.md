# 发布记录（2026-11-06）

> 目标：让「别人一条命令能装」。记录尝试了什么、成了什么、卡在哪、下一步是什么。

## 1. npm 上架：卡在账号授权，不是技术问题

| 检查 | 结果 |
|---|---|
| registry 可达 | `npm ping` → PONG 1166ms |
| 包名可用 | `npm view dsh-fullstack-team` → 404（未被占用） |
| 打包内容 | 35 个文件、105.5 kB，`--dry-run` 通过 |
| 账号 | **未登录**，`npm whoami` → `need auth`；`~/.npmrc` 无 token |

**阻塞原因**：注册/登录 npm 需要邮箱、密码、邮箱验证码，且 `npm login` 走浏览器授权流。本会话没有浏览器控制工具，也不应持有账号密码。这属于「必须由人完成的凭据动作」，按 `pm-guidance.md` 的例外条款处理。

**解锁方式（一条命令）**：`npm login` → 之后执行
```bash
npm publish --access public
git tag v0.1.0 && git push --tags
npm view dsh-fullstack-team version
```

## 2. 改走 GitHub 直装：已验证可用

仓库公开，因此不依赖 npm 账号也能装。**实测过的两条命令**：

```bash
# pnpm（推荐，干净通过）
pnpm add github:jiangNanGit/dsh-fullstack-team        # 9.3s，退出码 0

# npm（需加 --legacy-peer-deps，否则命中 npm 自身 bug：
#      "Cannot read properties of null (reading 'edgesOut')"）
npm i github:jiangNanGit/dsh-fullstack-team --legacy-peer-deps
```

装完之后：

- `node_modules/dsh-fullstack-team/lib/index.js` 存在（`prepare` 自动构建，无需手工 `pnpm build`）；
- `node_modules/.bin/dsh-fullstack-team` 可执行；
- `dsh-fullstack-team --dry-run` 能打印宿主版本、profile、8 个预设、备份名与重启说明。

## 3. 为发布做的三处修复

| 修复 | 原因 |
|---|---|
| `files` 收窄 56 → 35 | 原先会把 `docs/dev` 的需求档、测试报告、`.dsh` 状态一起发出去 |
| `prepare` 改为 `scripts/prepare-build.mjs` | git 安装需要在装完后构建 `lib/`；但 `prepare` 也参与 `npm pack`，原实现的 tsdown 输出会污染 `--json`（`install-contract` 测试因此红） |
| 入口用 `realpathSync` 比较 | pnpm 安装的副本常是软链，`argv[1]` 与 `import.meta.url` 字符串不同，直接执行会静默退出 |

## 4. 当前结论

- **「别人能装」已达成**，路径是 `pnpm add github:…` + `dsh-fullstack-team install`，无需任何账号；
- **npm 上面还没有这个包**，等账号授权后一条命令即可；
- 未做的事：打 tag、写 changelog、GitHub Release（都可以在 npm 上架后一并做）。

## 5. 待办（按顺序）

1. `npm login`（人）
2. `npm publish --access public`（agent）
3. `git tag v0.1.0 && git push --tags`（agent）
4. 干净目录 `npx dsh-fullstack-team@0.1.0 install --dry-run` 验证（agent）
5. GitHub Release 附 tarball（agent，可选）
