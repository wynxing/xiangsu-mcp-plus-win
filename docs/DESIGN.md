# 第一刀设计说明

核对日期：2026-11-19。上游 [Muqian-Sun/xiangsu-mcp-plus](https://github.com/Muqian-Sun/xiangsu-mcp-plus) 提交 `05d8347073fece93bd80f7dc28e88f0d140efe8b`（v0.9.0）。sleepyquq/xiangsu-mcp 提交 `f20dc033` 只用来核对 Windows 插件目录形状。

调查笔记里「仓库还不能写代码」已经过时。本仓库就是交付位置。笔记里的个人路径、机器名和受保护工程名不进入源码。

## 架构

```text
MCP 客户端 --stdio--> src/server.mjs
                         |-- OfficialMcp --> http://127.0.0.1:17320/mcp
                         |-- Projects ----> 已有工程窗口里的插件 RPC
                         '-- ext_status

像塑工程窗口 --加载--> XiangsuMcpPlus/index.js
                         '-- editor-plugin/runtime.cjs
                               127.0.0.1:随机端口  POST /rpc
                               Bearer 随机令牌
                               状态文件 instances/<pid>.json
```

官方已经能做的场景、脚本、预览、保存，只转发，不重写。本刀注册的自有工具只有 `ext_status`、`project_open`、`project_new`、`project_close`。若官方以后也注册了同名工具，自有实现优先，并在 `ext_status.shadowed_official_tools` 里写出来。

## 和笔记不一致、已经改掉的假设

- 无窗口冷启动没有可核对的 Windows 命令。笔记里的 `open -g -b com.ies.dyeh` 是 macOS 的。直接把 `.dyehpj` 交给 `Douyin AR.exe` 没有被验证，所以 `project_open` / `project_new` 在零窗口时返回 `WINDOWS_COLD_START_UNVERIFIED`，不创建进程。
- 不移植 `lsappinfo`、`open -b`、最小化或激活。打开的窗口可能到前台。不用键鼠把焦点抢回来。
- 进程身份不用 `ps -o lstart`。Windows 用 `Win32_Process.CreationDate`，Linux 用 `/proc/<pid>/stat` 第 22 字段（`comm` 之后的下标 19）和 `/proc/stat` 的 `btime`。允许约 5 秒时钟偏差。查不到启动时间是错误，不是「没有窗口」。
- 插件版本目录用包版本，不再像上游那样把清单固定成 `0.3.0`、包版本却是 `0.9.0`。
- 状态目录默认是 `~/.xiangsu-mcp-plus-win`，避免和 macOS 版的 `~/.xiangsu-mcp-plus` 混用令牌。仍可用 `XIANGSU_MCP_PLUS_STATE` 覆盖。
- `FileVersion` 的第四段可以超过 16 位，所以读版本资源里的字符串，不用 `VS_FIXEDFILEINFO` 的高低字，也不读 `electron\version`。
- 官方工具数量不写死。笔记里当时看到 39 个，其中多出来的 `dyeh_ai_assets_tools` 不是工程开关。本服务转发当时连上的那一份列表。
- `list_instances.generation` 的第一段被当成 pid，这是上游和笔记里的观察。解析器有测试；编辑器若改了格式，`instance_id` 会是 `null`，不会猜一个 pid。

## 工程生命周期

沿用上游已经在 macOS 上走通的编辑器内部调用，并保持失败码：

- 打开：`OpenProjectFromEditCommand('openLocal', 绝对路径)`。首页进程决定新窗口还是空闲进程。`reuseCurrent` 视为 `WINDOW_LIMIT`，避免把工程换进当前窗口。
- 新建：`createNew`，等到路径里出现 `ProjectCreatedTmp`，再调用官方 `save_project` **一次**（`intention` 为「新建工程首次保存」）。目标已存在且非空目录则 `TARGET_NOT_EMPTY`，此时不调用保存，也不创建目录。
- 关闭：`features.project` 承认两种导出。旧版 `Project` 就是类，方法在 `Project.prototype.isProjectChanged`。像塑 9.8.3 的 `Project` 是命名空间，类在 `Project.Project`，方法在 `Project.Project.prototype.isProjectChanged`。两条原型都没有、并且没有已打开工程实例上的 `isProjectChanged` 函数时，`features.project` 仍为假。没有活动工程、方法不是函数，或返回值不是布尔值，都是 `UNKNOWN_DIRTY_STATE`。`changed === true` 时拒绝，不再把 `discard_changes` 当成插件侧脏状态的放行条件。通过之后延迟 300 ms，再读一次插件状态，并再读一次官方 `project_status`。官方读失败、`is_changed` 不是 `false`、或 `scene_dirty === true`，都拒绝。`scene_dirty === false` 不能单独证明干净。官方路径、pid、generation 必须和插件窗口一致。只有插件 `isProjectChanged() === false` 且官方 `is_changed === false`（`scene_dirty` 也是布尔值且不是 `true`）才调用命名空间上的 `Project.unload()`，不改走 `Project.Project.unload()`。失败不会在 `catch` 里改走退出。没有 `taskkill`，没有重启编辑器。
- 同一窗口上的打开、新建、关闭串行。不同窗口可以并行。窗口上限按 2 预检，最终仍以首页进程的 `WINDOW_LIMIT` 为准。
- 多个窗口时必须给出 `project_path` 或 `instance_id`。路径比较在 Windows 上忽略大小写和斜杠，并做 NFC。
- 生命周期变更使用白名单。`XIANGSU_ALLOW_PROJECTS` 或未跟踪的 `config.local.json`（`allowProjects`）列出允许的根目录；不在名单里的路径返回 `PROJECT_NOT_ALLOWLISTED`。`XIANGSU_DENY_PROJECTS` / `denyProjects` 优先，返回 `PROTECTED_PROJECT`。仓库不写具体工程名。
- 关窗时插件路径必须能读到，并且和官方 `list_instances` 里同一 pid 的路径一致。读不到、对不上，或官方列表读失败，都不调用 `project_close`。
- `project_new` 先在状态目录里用独占创建占用目标路径的锁文件，进程退出或锁文件里的 pid 已死才能接手；活着的 pid 不会被抢走。这个锁不在用户工程目录里，释放或替换过期锁不会删除目标目录。同一进程里还有一把内存锁。空目录检查在两把锁之内做，后一次紧挨着 `save_project`。

新建窗口必须是本次 `project_launch` 之后新出现的 pid。启动前已经登记过的实例，即使当时没有答上 `status`、之后才报出 `ProjectCreatedTmp`，也不是这次新建的结果。同时出现两个新的临时窗口，或者编辑器明确返回的 pid 对不上，返回 `AMBIGUOUS_NEW_WINDOW`，不调用 `save_project`。官方实例的 `project_path` 必须等于插件上报的临时路径，两者都不在黑名单里。发起新建的窗口必须仍显示原来的已允许工程。

关闭要求官方 `list_instances` 里存在同一个 pid，且路径与插件路径一致。官方列表是空的、没有这个 pid，或路径不一致，都是 `OFFICIAL_INSTANCE_UNCONFIRMED`，不调用 `project_close`。

`self_check` 强制的只有 `project`：`Project.unload`、`isProjectChanged`（类原型、9.8.3 的 `Project.Project` 原型，或已打开实例上的函数）、`ProjectManager.getInstance`、分析插件的 `flush` / `safelyExitApplication`、`OpenProjectFromEditCommand`、`EditSender.getInstance`、`SceneModule.getEditingSceneService`。缺任何一项，工具抛 `INCOMPATIBLE_EDITOR`。`quietWindows`、`music`、`icon` 只出现在诊断里。编辑器升级后要重跑 `ext_status`。

像塑进程不会继承启动 stdio 服务时的 `XIANGSU_MCP_PLUS_STATE`。插件因此把实例写在默认的用户主目录 `.xiangsu-mcp-plus-win`。stdio 若另设了状态目录，列窗口时同时读这两个 `instances` 目录。同一个 pid 有两份仍活着、端口或令牌不同的记录时拒绝选择，错误里不包含令牌。过期记录不会挡住另一目录里仍然对得上进程启动时间的那一份。

## 官方转发

连接失败且请求还没写出：`OfficialUnreachable`，这次调用没有发出。连接之后的传输错误：丢掉客户端，抛出带 `ambiguous` 的错误，**不重试**。协议错误（`McpError`）是官方的答复，也不重试。下一次用户主动调用才会重新连接。`watch` 只在断开时重试连接和 `tools/list`，不调用业务工具。

插件 RPC 使用 `http://127.0.0.1:<端口>/rpc`，并带 `Connection: close`，不把上一次调用的 keep-alive 套接字留给下一次。传输失败变成 `PLUGIN_RPC_FAILED(<方法>): <message> (<cause.code 或 name>)`。`project_launch` 和 `project_close` 在插件里先写 `rpc start`，成功结束写 `rpc done`，抛错写 `rpc error`。这些日志不包含令牌。0.1.2 的一次 `project_new` 只返回了 `fetch failed`，当时看不出请求有没有到达插件。0.1.3 在像塑 9.8.3 上后来有一次受控流程没有再现这个错误；这没有证明原因消失，也没有因此自动重试 `project_launch`。操作规则见仓库根目录 `AGENTS.md`。

## 安装与权限

探测顺序：`XIANGSU_EDITOR_EXE`、`XIANGSU_EDITOR_ROOT`、正在运行的 `Douyin AR.exe` 或 `orionkit.exe`、然后是 LocalAppData / Program Files 下的 `Douyin AR`。显式根目录不合法时不会退回到别的候选。产品资源目录是产品根下的 `Resources`。把根指到 `electron` 子目录时，若父目录才有成对的 exe 和 `Resources`，会走到父目录，避免把 Electron 自己的 `Resources` 当成编辑器资源。

令牌文件：POSIX 上目录 `0700`、文件 `0600`。Windows 上用当前用户的 SID 新建空的 `FileSecurity` / `DirectorySecurity`，关掉继承，只加入这一条 Allow，再用 `SetAccessControl` 写回。读回使用 `SecurityIdentifier`，只含 ASCII 的 SID，避免显示名编码。`execFile` 取原始字节：有 UTF-16 BOM 或奇数位大量 NUL 时按 UTF-16LE 解码，否则按 UTF-8。`11f7ca3` 的 Windows CI 里，运行时测试用 UTF-8 解码真实 `powershell.exe` 输出并和 `whoami` 对上了，所以那次调用的默认输出不是 UTF-16LE；字节探针写在 `test-results/windows-acl-evidence.json`，由 CI 上传。读回结果里只要还有别的 SID，就删除令牌文件并停止监听。

安装：先把将要替换的插件目录整份复制到 `install-backups`，新目录在临时名称下写完并核对之后才替换。写到一半失败时，原来的 `index.js` 还在。服务启动时的自动安装走同一条路径。

生成的插件目录保持清单 `"entry": "index.js"`，并写入只含 `"type": "commonjs"` 的 `package.json`。这是离入口最近的包边界。像塑 9.8.3 的一次加载日志里，`index.js` 被 Node 当成 ES 模块执行，因为从插件目录向上找到了用户主目录的 `"type": "module"`，于是 `require` 抛出 `require is not defined in ES module scope`。`.cjs` 入口在 Node 里也能强制 CommonJS，但编辑器这次实际打开的是清单里的 `index.js`，所以不改入口文件名。`editor-plugin` 复制到状态目录 `editor-plugin/<版本>/<构建号>/`，入口用绝对路径引用那份 `runtime.cjs`。

同一 `version` 且 `install.json` 的 `build` 与当前包一致、边界文件还在、状态目录里的 `runtime.cjs` 还在，才返回 `kept`。已安装版本更高时不降级。0.1.0 没有 `build`，也没有边界文件，0.1.1 会替换它。替换后需要重新打开工程窗口，已经开着的窗口不会加载新入口。

## 已测与未测

已在本仓库用 `npm test`（`node --test`）测过，CI 矩阵是 Ubuntu 与 Windows、Node 22 与 24：

- Windows 路径的斜杠、大小写、尾部分隔符、NFC（`Café`）
- 合成 PE 的 `FileVersion` `9.8.3.942073156`，旁边的 `electron/version`（`41.7.1`）不被采用
- `electron` 子目录布局和误把 `electron` 当根
- 安装保留其他插件、非法配置不改文件、卸载只删自己、npx 缓存复制
- 缺 `OpenProjectFromEditCommand` 时 `self_check.ok === false`
- 曲库模块缺失不单独把 project 判失败，同时 `features.music === false`
- 令牌不进 401 响应、错误和日志；错误回显里的 Bearer 会被抹掉
- pid 启动时间晚于记录则丢弃；进程已退出则丢弃；启动时间查询失败不是空列表
- 重复打开不发 `project_launch`；非空目标不发 `save_project`；保存断线只调用一次
- 脏状态、未知脏状态不调用 `project_close`；两个窗口必须点名；同一窗口串行
- 官方 `save_project` 断线后 `callTool` 次数为 1

未测，或只跑通过一次、不能写成编辑器验收：

- 像塑 9.8.3 上，带 CommonJS 边界的 `index.js` 已经加载，并且完成过一次隔离的 `project_new` → `project_close` → `project_open`（官方与磁盘读回一致，发起操作的窗口没有关，新建只保存一次）。`ext_status.contract.editor_acceptance` 仍是 `unverified`。这一次不是全覆盖验收，也没有证明早先 `fetch failed` 的原因消失。见 `AGENTS.md`。
- 同一次流程调用过 `OpenProjectFromEditCommand` 和命名空间 `Project.unload`。没有做反汇编级核对，也不能外推到别的编辑器版本。
- 官方 `17320` 的工具列表和 `generation` 字段没有写成永久契约
- 无窗口启动编辑器的安全命令
- Orion 最小化 / 不抢焦点
- 曲库绑定和图标上传

## 下一阶段（本刀不做）

1. 曲库：`music_categories`、`music_list`、`music_search`、`music_apply`。先看测试窗口里 `features.music`。模块路径与上游 `REQUIRED.music` 相同。
2. 图标：替换 macOS `sips` 的 360×360 处理，再接 `icon_set` / `icon_open`。上传仍依赖 `REQUIRED.icon` 自检。
3. 不代勾协议，不点提交审核，不调用付费生成。
