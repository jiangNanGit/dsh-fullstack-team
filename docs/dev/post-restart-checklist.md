# 重启后待验清单（一次性，验完可删）

> 背景：下面三项只有在宿主重新加载后才会成立，本会话验不了。
> 每项都给了「怎么验 / 期望看到什么 / 不符合怎么办」。全部通过就把本文件删掉。

## 1. 新构建是否生效

```bash
cd <仓库>
node -e "import('./lib/roles.js').then(m => console.log('markerMatches:', typeof m.markerMatches, '| roleMatches:', typeof m.roleMatches))"
```

- 期望：`markerMatches: function | roleMatches: function`
- 不符：`lib/` 是旧构建，跑 `pnpm build`。

## 2. `plugin_manager` 是否出现在工具里

在一个新会话里问一句「列一下当前 profile 装了哪些 bundle」，或直接看工具列表。

- 期望：工具列表里有 `plugin_manager`，且能返回 bundle 清单。
- 不符：说明预置里那行仍是 `disabled: true`；检查 `presets/roles.patch.yml` 是否含 `disabled: !!js "!ctx.get('profileContext')"`，重新合并 profile 并重启。

## 3. 真机安装（这条才是「别人能装」）

用另一个 profile 验，不碰日常在用的那个。

```bash
cd <仓库>
npm pack --pack-destination /tmp/install-verify      # 得到 tgz
```

然后让 `plugin_manager` 把该 tgz 装进 `packtest` profile，再确认：

- 期望：`list_bundles` 出现 `dsh-fullstack-team`；该 profile 的 `cordis.patch.yml` 里有 8 个 preset；新建会话时预设选择器能看到 `dsh-plugin-dev`。
- 不符：把 `plugin_manager` 的输出贴出来，按报错定位（缺文件 / 缺 peer / 预设 invalid）。

## 4. 预设是否加载

- 期望：新建会话的预设选择器里有 8 个（`backend-design`、`ops`、`pm`、`qa`、`backend-java`、`dsh-plugin-dev`、`frontend-vue`、`mobile-flutter`），且没有 `never started` 报错。
- 不符：贴报错里点名的那一行——那是下一个要与 shipped standard 校准的 row，跑 `node scripts/check-preset-compat.mjs` 会直接指出。

## 记录

| 项 | 结果 | 时间 | 备注 |
|---|---|---|---|
| 1 新构建 | | | |
| 2 plugin_manager | | | |
| 3 真机安装 | | | |
| 4 预设加载 | | | |
