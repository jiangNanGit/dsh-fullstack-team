# 浏览器验收：用什么、怎么用

> 背景：本仓没有界面，但下游业务仓（Vue/React）有。UI 验收不能只靠「模型说它好看」。
> 结论：**用真实 Chromium 跑断言**，不靠截图自我感觉。

## 1. 已装的工具

| 工具 | 位置 | 用途 |
|---|---|---|
| `dsh-verify` 0.9.6 | 本仓 devDependency（`pnpm add -D dsh-verify`） | JSON 规格进，真实 Chromium 结论出；出 `report.html` 与截图 |
| Playwright Chromium 158 | `~/Library/Caches/ms-playwright/` | `dsh-verify` 的浏览器内核（一次性 ~100 MB） |
| `scripts/browser.mjs` | 本仓脚本 | 零依赖兜底：CDP 驱动本机 Chrome，取文字/标题/截图/执行 JS |

先试 `dsh-verify`；它跑不起来（没网、没 Chromium）时用 `scripts/browser.mjs` 顶。

## 2. 用 `dsh-verify` 做验收

```bash
npx dsh-verify init <新目录>      # 生成起步 spec 与示例站点（仅在空目录可用）
npx dsh-verify --spec <spec.json> [--json] [--out <dir>]
```

spec 的形状（起步模板就是它）：

```json
{
  "title": "验收标题",
  "serve": "site",
  "steps": [
    { "action": "goto", "path": "/index.html" },
    { "action": "click", "selector": "#hello" },
    { "action": "expect_text", "selector": "#message", "text": "Hello from a real browser", "exact": true },
    { "action": "expect_console_errors", "present": false },
    { "action": "screenshot", "name": "final-state" }
  ]
}
```

可用动作：`goto wait click fill expect_text expect_class capture_style expect_style_changed
expect_url_contains expect_navigation expect_console_errors expect_network_errors screenshot
capture_baseline expect_screenshot`（末两条是视觉回归）。

判据建议（与 `acceptance-guard` 一致，不做单点验证）：

1. 每个功能点至少一条 `goto` + 一次**真实交互**（点击/输入）+ 一个可判定断言（文本/类名/URL/控制台无错）；
2. 关键页面留 `screenshot`，作为验收报告附件；
3. `--json` 的 verdict 原文进验收报告，不转述。

实测（2026-11-06）：起步 spec `PASS 5/5`，产物 `dsh-verify-out/report.html` + 截图。

## 3. 用 `scripts/browser.mjs` 兜底

```bash
node scripts/browser.mjs text  <url>            # 正文
node scripts/browser.mjs title <url>
node scripts/browser.mjs eval  <url> "<js 表达式>"
node scripts/browser.mjs shot  <url> out.png    # 整页截图
node scripts/browser.mjs html  <url>
```

它驱动本机已安装的 Google Chrome（headless），不需要下载内核。局限：没有断言 DSL，断言要靠 `eval` 自己写。

实测（2026-11-06）：`text`/`title`/`eval`（点击后读回「已点击」）/`shot`（2442×1717 PNG）全部通过；对宿主 GUI 也能截图，但 GUI 地址必须带启动时打印的 token。

## 4. 市场里的其它选择（未装）

从官方目录 `dsh-plugin-catalog/index.json`（4569 个插件）搜到的浏览器类：

| 包 | 用途 | 备注 |
|---|---|---|
| `dsh-verify` | 浏览器验收（已装） | 需要 Chromium |
| `dsh-moli` | 驱动本机 Moli 无头浏览器；抓取、JS 求值、语义树、截图、PDF | 需装 Moli；缺失时自称会自动装 |
| `dsh-scrape-webpage` | 抓正文/标题/链接，不含交互 | 只读，不能验收交互 |

## 5. 在会话里直接用（需要 `plugin_manager`）

`dsh-verify` 也是 bundle（`cordis.patch.yml` 插一行自引用）。要让它成为**会话内工具**而不是命令行工具，正规做法是装进 profile：

```bash
dsh plugin --profile desktop add dsh-verify      # 官方 CLI 通道
# 或在应用里：插件 → 添加插件
```

当前阻碍（2026-11-06）：

1. 本会话没有 `plugin_manager` / `plugin_market` 工具——我们自己的预置把 `tool-plugin-manager` 写死成 `disabled: true`，已对齐回 shipped standard，**重启后**才恢复；
2. 手工往 profile 装撞上 pnpm store 版本不一致（宿主用 pnpm 10 的 store，命令行是 11），强行重建 `node_modules` 有把 app 弄起不来的风险，**不做**。

所以现在：仓库内用 `npx dsh-verify`（已跑通），会话内工具等重启后用 `plugin_manager` 装。
