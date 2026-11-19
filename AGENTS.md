# 给后续改动的规则

非官方 Windows 桥，MIT，上游见 [NOTICE](NOTICE)。代码与 [docs/DESIGN.md](docs/DESIGN.md) 冲突时以代码为准。这里只记已经踩过、还会再犯的操作。不要代勾协议、不要提交审核、不要发布特效。

## 证据怎么读

分三档，不要混写：

1. **合同测试**：`npm test`。模拟编辑器，不打开像塑。CI 是 Ubuntu / Windows，Node 22 和 24。
2. **一次受控实机**（2026-11-19，像塑 9.8.3，包 0.1.3）：`self_check.ok`、`features.project`、`official.connected` 均为真。隔离目录上完成一次 `project_new` → `project_close` → `project_open`，官方状态和磁盘读回一致，用来发起操作的窗口没有被关掉，新建只保存了一次。这次没有再出现 `fetch failed`。
3. **不是正式验收**。`ext_status.contract.editor_acceptance` 仍是 `unverified`，不要改这个字段，也不要把这一次写成全版本、全路径的兼容保证。

## 改代码时遵守

- 插件清单 `entry` 保持 `index.js`。同目录放 `{"type":"commonjs"}` 的 `package.json`。用户主目录的 `"type":"module"` 会让没有这层边界的 `index.js` 在加载时没有 `require`。不要改用户主目录的 `package.json`，不要改像塑安装目录。
- 像塑 9.8.3 的 `Project` 是命名空间，不是类。自检要同时接受 `Project.prototype.isProjectChanged` 和 `Project.Project.prototype.isProjectChanged`。两条都没有、也没有已打开实例上的函数时，`features.project` 必须为假。关闭调用命名空间上的 `Project.unload()`，不要改成 `Project.Project.unload()`。
- 关闭要插件 `isProjectChanged()===false` 且官方 `is_changed===false`，延迟后再读一次，并且路径、pid、generation 对得上。`scene_dirty===false` 不能单独当干净。读失败、非布尔、或任一源为脏，都拒绝。`discard_changes` 不能绕过插件侧的脏状态。
- 官方 `is_changed` 可以在本服务没有发出写操作时从干净变成脏。看到脏就停，不要猜原因后继续保存或关闭。
- Windows 上调用本服务的工具参数用 UTF-8 文件。PowerShell 拼接 JSON 会吞引号，在 `Client.connect()` 之前就 `JSON.parse` 失败，写操作还没发出。连接前的解析失败和发出之后的结果不明是两回事。请求已经写出去之后，不要自动再发一次。
- 插件传输失败要带原因：`PLUGIN_RPC_FAILED(<方法>): <message> (<cause.code 或 name>)`。用 `rpc start` / `rpc done` / `rpc error` 判断请求停在哪一步。错误和日志里不能出现 Bearer 令牌。`Connection: close` 是当前写法，用来避免复用可能已死的连接；不能把它写成旧 `fetch failed` 已经证实的根因。0.1.3 那次成功也没有证明这个原因消失。
- 像塑进程通常拿不到 stdio 的 `XIANGSU_MCP_PLUS_STATE`，实例写在默认的用户主目录 `.xiangsu-mcp-plus-win`。列窗口时默认目录和配置的状态目录都要读。同一个 pid 有两份仍活着、端口或令牌不同的记录时拒绝选择，错误里不要带令牌。
- 发布前核对 `npm pack` 的清单含 `scripts/install.mjs`、`scripts/uninstall.mjs`、`scripts/rollback.mjs`、`src/server.mjs`。回滚必须同时恢复插件目录和 `plugins.config.json`。同一版本只有构建号、CommonJS 边界和运行时副本都还在才 `kept`。已经开着的窗口不会加载新插件，装完要关掉可丢弃窗口再打开一次。
- 依赖用锁文件安装，并核对包版本。某次 `npm install` 挂起时复制过一份依赖，那只是当场的诊断，不要写成通用安装方法。
- 今天的打开、新建、关闭要求调用方给出允许的根目录，黑名单优先。这是当前代码，不是以后永远的产品策略。不要把某次测试名单，或尚未实现的「默认可用」方案，写进文档当永久规则。会丢数据的拒绝留下；不要为了好写测试去加别的永久限制。
- 公开仓库不写真实工程名、个人路径、机器名、令牌或整段私人日志。实机只用可丢弃的新建目录。

## 还没有证实

- 冷启动时用什么命令打开像塑才安全。没有窗口时继续返回 `WINDOWS_COLD_START_UNVERIFIED`，不要补一条未验证的启动命令。
- 曲库、图标、最小化、不抢焦点。
- `fetch failed` 的操作系统原因码。0.1.2 的失败文本里没有 `cause`。
