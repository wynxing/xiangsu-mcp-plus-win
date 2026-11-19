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

官方已经能做的场景、脚本、预览、保存，只转发，不重写。本仓库注册的自有工具是 `ext_status`、`project_open`、`project_new`、`project_close`，以及曲库 `music_categories`、`music_list`、`music_search`、`music_apply`。若官方以后也注册了同名工具，自有实现优先，并在 `ext_status.shadowed_official_tools` 里写出来。

## 和笔记不一致、已经改掉的假设

- 无窗口冷启动没有可核对的 Windows 命令。笔记里的 `open -g -b com.ies.dyeh` 是 macOS 的。直接把 `.dyehpj` 交给 `Douyin AR.exe` 没有被验证，所以 `project_open` / `project_new` 在零窗口时返回 `WINDOWS_COLD_START_UNVERIFIED`，不创建进程。
- 不移植 `lsappinfo`、`open -b`、最小化或激活。打开的窗口可能到前台。不用键鼠把焦点抢回来。
- 进程身份不用 `ps -o lstart`。Windows 用 `Win32_Process.CreationDate`，Linux 用 `/proc/<pid>/stat` 第 22 字段（`comm` 之后的下标 19）和 `/proc/stat` 的 `btime`。允许约 5 秒时钟偏差。查不到启动时间是错误，不是「没有窗口」。`powershell.exe` 用 `SystemRoot` 下的绝对路径，不用 `PATH`。找不到时启动时间检查失败，进程发现退回其它候选，不把缺少二进制当成空窗口列表。
- 插件版本目录用包版本，不再像上游那样把清单固定成 `0.3.0`、包版本却是 `0.9.0`。
- 状态目录默认是 `~/.xiangsu-mcp-plus-win`，避免和 macOS 版的 `~/.xiangsu-mcp-plus` 混用令牌。仍可用 `XIANGSU_MCP_PLUS_STATE` 覆盖。
- `FileVersion` 的第四段可以超过 16 位，所以读版本资源里的字符串，不用 `VS_FIXEDFILEINFO` 的高低字，也不读 `electron\version`。
- 官方工具数量不写死。笔记里当时看到 39 个，其中多出来的 `dyeh_ai_assets_tools` 不是工程开关。本服务转发当时连上的那一份列表。
- `list_instances.generation` 的第一段被当成 pid，这是上游和笔记里的观察。解析器有测试；编辑器若改了格式，`instance_id` 会是 `null`，不会猜一个 pid。

## 工程生命周期

沿用上游已经在 macOS 上走通的编辑器内部调用，并保持失败码：

- 打开：`OpenProjectFromEditCommand('openLocal', 绝对路径)`。这是编辑器自己的 `launchProject` 同一请求，9.8.1 起首页进程只认它。首页进程决定新窗口还是空闲进程。没有插件进程时不启动编辑器，也不把文件关联当成打开。已有工程的窗口若收到 `reuseCurrent`，仍是 `WINDOW_LIMIT`，避免把工程换进去。没有活动工程的空闲进程收到 `reuseCurrent` 时，等这个 pid 读回目标路径。
- 新建：`createNew`，等到恰好一个窗口的路径里出现 `ProjectCreatedTmp`，再调用官方 `save_project` **一次**（`intention` 为「新建工程首次保存」）。空闲进程自己变成这个临时工程，或另出现一个新 pid，两者都可以；同时出现则 `AMBIGUOUS_NEW_WINDOW`，不保存。已有工程的窗口不能变成这次新建的结果。目标已存在且非空目录则 `TARGET_NOT_EMPTY`，此时不调用保存，也不创建目录。客户端在 `project_launch` 返回之后断开 stdio 时，调用返回 `PROJECT_NEW_INTERRUPTED`，不调用 `save_project`，也不再发一次 `project_launch`。这次调用不是成功。阶段写在状态目录 `logs/stdio.log`（`start`、`launch_returned`、`window_seen`、`ready`、`official_matched`、`save_project`、`finished`，以及 `interrupted_after_launch`、`stdin end`、信号、未捕获错误和 `exit <code>`）。`exit <code>` 只表示 Node 执行到了 exit 事件并带上这个退出码。后面没有新行，不能单独证明进程被杀掉：这一行可能没写到磁盘，进程也可能在处理程序之外停住。这些行是下一次留存的线索，不是某一次断线的原因结论。日志不写工程路径，也不写到 stdout。
- 关闭：`features.project` 承认两种导出。旧版 `Project` 就是类，方法在 `Project.prototype.isProjectChanged`。像塑 9.8.3 的 `Project` 是命名空间，类在 `Project.Project`，方法在 `Project.Project.prototype.isProjectChanged`。两条原型都没有、并且没有已打开工程实例上的 `isProjectChanged` 函数时，`features.project` 仍为假。没有活动工程、方法不是函数，或返回值不是布尔值，都是 `UNKNOWN_DIRTY_STATE`。`changed === true` 时拒绝，不再把 `discard_changes` 当成插件侧脏状态的放行条件。通过之后延迟 300 ms，再读一次插件状态，并再读一次官方 `project_status`。官方读失败、`is_changed` 不是 `false`、或 `scene_dirty === true`，都拒绝。`scene_dirty === false` 不能单独证明干净。官方路径、pid、generation 必须和插件窗口一致。只有插件 `isProjectChanged() === false` 且官方 `is_changed === false`（`scene_dirty` 也是布尔值且不是 `true`）才调用命名空间上的 `Project.unload()`，不改走 `Project.Project.unload()`。失败不会在 `catch` 里改走退出。没有 `taskkill`，没有重启编辑器。
- 同一窗口上的打开、新建、关闭串行。不同窗口可以并行。窗口上限按 2 预检，最终仍以首页进程的 `WINDOW_LIMIT` 为准。
- 多个窗口时必须给出 `project_path` 或 `instance_id`。路径比较在 Windows 上忽略大小写和斜杠，并做 NFC。
- 生命周期变更默认允许普通路径。没有 `XIANGSU_ALLOW_PROJECTS`，且未跟踪的 `config.local.json` 没有 `allowProjects` 键时，不在黑名单里的路径可以打开、新建、关闭。环境变量或 `allowProjects` 数组一旦存在，就只允许那些根目录，空列表也是收窄。已有数组原样保留，不在升级时改写。`XIANGSU_DENY_PROJECTS` / `denyProjects` 优先，返回 `PROTECTED_PROJECT`。名单外的收窄返回 `PROJECT_NOT_ALLOWLISTED`。路径比较在 Windows 上忽略大小写和斜杠，并做 NFC。仓库不写具体工程名。
- 关窗时插件路径必须能读到，并且和官方 `list_instances` 里同一 pid 的路径一致。读不到、对不上，或官方列表读失败，都不调用 `project_close`。
- `project_new` 先在状态目录里用独占创建占用目标路径的锁文件，进程退出或锁文件里的 pid 已死才能接手；活着的 pid 不会被抢走。这个锁不在用户工程目录里，释放或替换过期锁不会删除目标目录。同一进程里还有一把内存锁。空目录检查在两把锁之内做，后一次紧挨着 `save_project`。

已有工程的窗口发起新建时，结果必须是本次 `project_launch` 之后新出现的 pid，且该窗口仍显示原来的工程。空闲进程（插件已连接、没有工程路径）发起时，结果可以是它自己或一个新 pid，但只能有一个 `ProjectCreatedTmp`。启动前已经登记、并且当时已有工程路径的实例，即使当时没有答上 `status`、之后才报出 `ProjectCreatedTmp`，也不是这次新建的结果。同时出现两个新的临时窗口，或者编辑器明确返回的 pid 对不上，返回 `AMBIGUOUS_NEW_WINDOW`，不调用 `save_project`。官方实例的 `project_path` 必须等于插件上报的临时路径，两者都不在黑名单里。多个空闲进程是 `AMBIGUOUS_IDLE_WINDOW`，不挑选。

关闭要求官方 `list_instances` 里存在同一个 pid，且路径与插件路径一致。官方列表是空的、没有这个 pid，或路径不一致，都是 `OFFICIAL_INSTANCE_UNCONFIRMED`，不调用 `project_close`。

`self_check` 强制的只有 `project`：`Project.unload`、`isProjectChanged`（类原型、9.8.3 的 `Project.Project` 原型，或已打开实例上的函数）、`ProjectManager.getInstance`、分析插件的 `flush` / `safelyExitApplication`、`OpenProjectFromEditCommand`、`EditSender.getInstance`、`SceneModule.getEditingSceneService`。缺任何一项，工程工具抛 `INCOMPATIBLE_EDITOR`。曲库工具单独调用 `ensureCompatible('music')`，缺的是 `REQUIRED.music` 里的分类、列表、搜索和 `MusicSquareManager.instance.setDouyinMusicInfo`。这一失败不改变 `features.project`。`quietWindows` 和 `icon` 仍只出现在诊断里。编辑器升级后要重跑 `ext_status`。

曲目的可复用标识是 `music_id` 加 `selection`：`source`（`category` 或 `search`）、对应的 `category_code` 或 `query`，以及取出该页时用的 `page_cursor`（首页为空）。`music_apply` 用这份标识再读同一页，只接受恰好一条相同 `music_id`。标题相同但 id 不同不会绑定。写入只调用 `setDouyinMusicInfo`，结果里的 `binding` 是 `douyin_library`，`local_import` 为假。搜索没有分类，第二个参数省略（`undefined`），不传 `null`。`setDouyinMusicInfo` 返回 `true` 或一个对象，只表示这次调用没有被编辑器拒绝，不是当前绑定。9.8.3 上没有 `getDouyinMusicInfo`。`getLocalMusicList` 和 `getLocalMusicResourceItem` 不作为确认或失败依据，确认逻辑不调用它们。调用前先记下活动工程路径，以及 `Assets/NoImportAsset/<music_id>/MusicInfo.json` 是否已经存在。调用后再读路径。路径变了是 `PROJECT_IDENTITY_CHANGED`，不把文件算作这次导入，也不再调用。文件在调用前就已经存在，是 `MUSIC_APPLY_UNCONFIRMED`（这次导入未被证明，绑定仍未确认）。文件或它所在的 id 目录是符号链接，或者真实路径跑出工程目录，同样是 `MUSIC_APPLY_UNCONFIRMED`。另一条曲目即使标题相同，也不代替这条 `music_id`。只有调用前不存在、调用后新出现的普通文件，真实路径仍在同一工程内，并且标题在两边都非空时一致，才返回 `imported: true`。这时 `confirmed` 和 `bound` 仍是 `false`，`binding` 是 `unconfirmed`，`saved` 是 `false`。标题对不上是 `MUSIC_APPLY_MISMATCH`。文件不存在或读不了是 `MUSIC_APPLY_UNCONFIRMED`。不调用 `showMusicAsset`，不自动 `save_project`，也不再调用 `setDouyinMusicInfo`。`effect.dyehpj` 的 `soundID` 和磁盘上的「抖音音乐」`AudioComponent` 要等之后一次明确的官方保存才会写进文件。官方 `get_scene` 不提供曲目 id，所以不能把场景读回当作绑定证明。多个窗口必须点名。调用前官方实例路径要和插件路径一致，并走当时的允许/拒绝名单；名单本身的默认值不在曲库里改。

官方已转发的工具里，`project_status` 能给出工程路径、`project_id`、`is_saved`、`is_changed` 和 `scene_dirty`，`get_scene` 能给出名为「抖音音乐」的对象及其 `AudioComponent`。这两项都不返回 `effect.dyehpj` 的 `soundID`。没有一条官方只读工具能单独把所选 `music_id` 核对成已保存的绑定。`music_verify` 因此是只读补充，不调用 `setDouyinMusicInfo`，也不调用 `save_project`。`persisted`、`confirmed`、`bound` 同时为真，仅当：传入的 `project_id` 等于当前官方 `project_status.project_id`，官方状态是已保存且 `is_changed` 与 `scene_dirty` 都为假，插件 `isProjectChanged()` 为假，磁盘 `soundID` 与 `music_id` 完全一致，`Assets/NoImportAsset/<music_id>/MusicInfo.json` 是工程内的普通文件且标题、作者、时长与参数一致，并且 `Assets/main.scene` 与官方 `get_scene` 都恰好有一个「抖音音乐」带音频组件。9.8.3 把该组件写成 `DynamicComponent`，其 `name` 或 `className` 为 `AudioComponent`；直接的 `__class: AudioComponent` 也同样算。另一个同名对象，或同一个对象上重复的音频组件，都不是唯一匹配。非音频的 `DynamicComponent` 不算。未保存、旧 `soundID`、旧资源、符号链接或工程身份不一致时，这三项都保持假，`imported` 也保持假。`music_apply` 的 `imported: true` 不会因此变成绑定。

像塑进程不会继承启动 stdio 服务时的 `XIANGSU_MCP_PLUS_STATE`。插件因此把实例写在默认的用户主目录 `.xiangsu-mcp-plus-win`。stdio 若另设了状态目录，列窗口时同时读这两个 `instances` 目录。同一个 pid 有两份仍活着、端口或令牌不同的记录时拒绝选择，错误里不包含令牌。过期记录不会挡住另一目录里仍然对得上进程启动时间的那一份。

## 官方转发

连接失败且请求还没写出：`OfficialUnreachable`，这次调用没有发出。连接之后的传输错误：丢掉客户端，抛出带 `ambiguous` 的错误，**不重试**。协议错误（`McpError`）是官方的答复，也不重试。下一次用户主动调用才会重新连接。`watch` 只在断开时重试连接和 `tools/list`，不调用业务工具。

插件 RPC 使用 `http://127.0.0.1:<端口>/rpc`，并带 `Connection: close`，不把上一次调用的 keep-alive 套接字留给下一次。传输失败变成 `PLUGIN_RPC_FAILED(<方法>): <message> (<cause.code 或 name>)`。`project_launch` 和 `project_close` 在插件里先写 `rpc start`，成功结束写 `rpc done`，抛错写 `rpc error`。这些日志不包含令牌。一次机器上的 `project_new` 只返回了 `fetch failed`，请求有没有到达插件无法从那份日志判断；0.1.3 让下一次失败带上原因码。没有因此重试 `project_launch`。

## 安装与权限

探测顺序：`XIANGSU_EDITOR_EXE`、`XIANGSU_EDITOR_ROOT`、正在运行的 `Douyin AR.exe` 或 `orionkit.exe`、然后是 LocalAppData / Program Files 下的 `Douyin AR`。显式根目录不合法时不会退回到别的候选。产品资源目录是产品根下的 `Resources`。把根指到 `electron` 子目录时，若父目录才有成对的 exe 和 `Resources`，会走到父目录，避免把 Electron 自己的 `Resources` 当成编辑器资源。

令牌文件：POSIX 上目录 `0700`、文件 `0600`。Windows 上用当前用户的 SID 新建空的 `FileSecurity` / `DirectorySecurity`，关掉继承，只加入这一条 Allow，再用 `SetAccessControl` 写回。读回使用 `SecurityIdentifier`，只含 ASCII 的 SID，避免显示名编码。`execFile` 取原始字节：有 UTF-16 BOM 或奇数位大量 NUL 时按 UTF-16LE 解码，否则按 UTF-8。`11f7ca3` 的 Windows CI 里，运行时测试用 UTF-8 解码真实 `powershell.exe` 输出并和 `whoami` 对上了，所以那次调用的默认输出不是 UTF-16LE；字节探针写在 `test-results/windows-acl-evidence.json`，由 CI 上传。读回结果里只要还有别的 SID，就删除令牌文件并停止监听。

Windows 上不从 `PATH` 找这两个程序。`SystemRoot`（没有则 `WINDIR`）必须是盘符路径。`whoami.exe` 用 `System32\whoami.exe`，没有再试 `Sysnative\whoami.exe`。`powershell.exe` 依次试 `System32\WindowsPowerShell\v1.0\powershell.exe`、`Sysnative\WindowsPowerShell\v1.0\powershell.exe`、`SysWOW64\WindowsPowerShell\v1.0\powershell.exe`。都没有就是 `ACL_FAILED`，不会改去搜索 `PATH`，也不会跳过 DACL。像塑进程的 `PATH` 可以只有 `System32`：那里有 `whoami.exe`，没有 `powershell.exe`。令牌文件在 SID 或 DACL 没写成功时删除；目录失败不删目录，并停止监听。

`initPlugin` 接住 `start()` 返回的 Promise。失败时状态目录 `logs/plugin.log` 里有 `init failed` 和错误栈，例如 `ACL_FAILED: ...`。运行时记一行，入口的 `.catch` 再记一行，避免编辑器把它当成未处理拒绝。这行日志不表示 ACL 已经通过。

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
- 分类、列表和搜索返回 `music_id` 与 `selection`，不把曲库原始对象带回客户端
- `music_apply` 只对再读到的那条 id 调用一次 `setDouyinMusicInfo`；失败、读回不一致、旧文件或调用中断都不发第二次
- 两个窗口不点名时不调用曲库；拒绝名单上的工程不绑定；官方路径对不上或窗口已换工程时不绑定
- 令牌不进 401 响应、错误和日志；错误回显里的 Bearer 会被抹掉
- 精简 `PATH` 下仍用 `SystemRoot` 绝对路径调用 `whoami.exe` / `powershell.exe`；找不到就 `ACL_FAILED`，令牌文件删除
- 进程启动时间和正在运行的编辑器发现也用这条绝对路径；二进制缺失不是空窗口列表
- 空闲工程进程可以发起打开和新建；结果是读回路径的那个 pid，可以是它自己或新进程。已有工程的窗口不会被换掉
- 插件启动的异步失败写入 `logs/plugin.log` 的 `init failed`，不留下未处理拒绝
- pid 启动时间晚于记录则丢弃；进程已退出则丢弃；启动时间查询失败不是空列表
- 重复打开不发 `project_launch`；非空目标不发 `save_project`；保存断线只调用一次
- 脏状态、未知脏状态不调用 `project_close`；两个窗口必须点名；同一窗口串行
- 官方 `save_project` 断线后 `callTool` 次数为 1
- 图标图：png / jpeg / gif / webp 中心裁成正方形再缩成 360×360 PNG；源文件字节不变；坏图、空文件、相对路径不留临时文件
- 图标工具：点名窗口后才调用插件；`features.icon` 为假时不写文件且 `features.project` 仍可为真；上传不是 `true` 或调用失败时不自动再传

未测，不能写成编辑器验收：

- 像塑 9.8.3 是否会加载带 CommonJS 边界的 `index.js`。Node 已复现祖先 `"type": "module"` 下裸 `index.js` 的 `ReferenceError`，以及边界文件让 `import()` 和 `require()` 都得到插件类。这还不是编辑器验收。
- `OpenProjectFromEditCommand`、`Project.unload` 在 Windows 9.8.3 上是否还是这些模块路径
- 官方 `17320` 的实时工具列表和 `generation` 字段
- 无窗口启动编辑器的安全命令。plus 自己冷启动仍未实现。用户完全退出后用桌面快捷方式打开，再由 `ext_status` 发现窗口，是用户启动，不是这个工具启动。
- Orion 最小化 / 不抢焦点
- 一次 `project_new` 在 `project_launch` 成功之后 stdio 断开的进程退出原因。后来有完整的 new、close、open，不能把那次断线写成已经修好。`logs/stdio.log` 里没有后续行，只是线索。

## 9.8.3 上已经看到的范围

下面只覆盖一次可丢弃工程上的这些调用。`ext_status.contract.editor_acceptance` 仍是 `unverified`。合同 CI 仍是 `npm test`。不要把这一段写成全部编辑器验收。

实测包是 `77132ee05f80aede42d62feb20c91e019c092fef` 的 `xiangsu-mcp-plus-win-0.1.11.tgz`，SHA-256 `fd2246329ae9ccda8d6e40a6f3d5320d74b8c1aee88aa70d213c8e7023f6128d`。stdio 进程报 0.1.11。打开中的窗口当时仍加载 0.1.10 插件，构建号同为 `75e612dc2c038b4c`，`editor-plugin` 的 9 个源文件字节相同。服务启动时按包版本把磁盘插件目录写成 0.1.11，并曾把 `requires_window_reopen` 标成真。没有按这个标记重开窗口。磁盘上出现 0.1.11 目录，不等于该窗口已经加载了另一份插件逻辑。

重开窗口曾让官方 `is_changed` 和插件未保存标记变成真，而 `effect.dyehpj` 与 `main.scene` 的内容哈希没有变。dirty 门因此返回 `UNSAVED`，并且当时不读磁盘曲目。要核对持久化绑定，先做一次明确的官方 `save_project`，等官方和插件都重新干净，再调用 `music_verify`。`music_verify` 自己不保存，也不调用 `setDouyinMusicInfo`。

在那次明确保存之后、窗口保持干净时，`music_verify` 对 `music_id` `7381809852086241292`、`project_id` `28829cb5-2b74-2d65-111c-b0d9bf8e79e8` 返回 `persisted`、`confirmed`、`bound` 为真，`imported` 为假，`saved` 为真，`binding` 为 `persisted`，`scene_objects` 与 `official_scene_objects` 都是 1，`apply_calls` 与 `save_calls` 都是 0，`reason` 为 `PERSISTED`。错误 `music_id` 返回 `SOUND_ID_MISMATCH`。错误 `project_id` 返回 `PROJECT_ID_MISMATCH`。这三次前后相关文件的哈希和 mtime 没有变。`dyehpj` 哈希是 `878ea5e60696919b2f81a0cc2b2d7448aead0c72db65347fd23ff48fb3c20594`。

同一条较早的可丢弃工程记录里：0.1.9 有两轮 `project_new`、`project_close`、`project_open` 成功；`icon_set` 一次写出两张 360×360 PNG，SHA-256 `6e8b14fc1cff39aebe18adc6b43187a229c4c983bd69bda095a22bea260b09bc`；`music_apply` 一次返回 `imported` 为真、`confirmed` 与 `bound` 为假，随后一次明确的官方保存才把 `soundID` 写进 `effect.dyehpj`。这些不是 `music_verify` 的自动保存，也不是再一次 apply。

仍未覆盖：plus 自己启动编辑器、断线根因、重开后不保存就确认绑定、以及这份记录以外的工程或编辑器版本。

## 图标图（本地）与图标工具（合同测试，编辑器未验收）

上游 `src/icons.mjs`（提交 `05d83470`）用 macOS `sips`：`--cropToHeightWidth` 取较短边的正方形，再 `-z 360 360` 写成新的 PNG。Windows 没有 `sips`。`src/icon-image.mjs` 的 `prepareIcon` 做同一件事，实现是 `sharp` 0.34.5（libvips 预编译包，锁在 `package-lock.json`，`npm ci` 按平台安装，包含 `sharp-win32-x64`）。

- 路径必须是绝对路径。读文件用 Node 的 `fs`，不经过 shell，所以中文和 NFC 路径按系统文件名处理。
- 格式看文件头，不看扩展名：png、jpeg、gif、webp。空文件、目录、截断的图、认不出的头都拒绝。
- 先按 EXIF 方向转正（方向 5–8 会交换宽高），再裁正方形。不补边。已经是正方形的只缩放。比 360 小的会放大。动图只取第一帧。
- 输出是临时目录里的新文件 `xs-icon-*/icon.png`，`wx` 创建。源路径不打开来写。失败时删掉这个临时目录。调用结束后临时目录会删掉。
- 源文件大于 40MB，或任一边大于 8192，拒绝。

`icon_set` / `icon_open` 的编辑器调用顺序来自上游 `editor-plugin/features/delivery.cjs` 的 `iconSet` / `iconOpen`，自检列表来自同一提交的 `REQUIRED.icon`。图标路径用编辑器模块给出的 `iconTypeToProjectIconPathMap`，不在这里写死文件名。

- 先点名一个窗口：插件路径、`project_state` 和官方 `list_instances` 里同一个 pid 必须一致，并且路径在当前允许名单里。对不上就不调用插件。
- 插件先做 `ensureCompatible('icon')`，再核对活动工程就是这个路径（`ProjectManager.getInstance().getActiveProject`，与上游一致）。缺任何一项都是 `INCOMPATIBLE_EDITOR`，不写文件。这不会把 `features.project` 判失败。
- 写入后立刻对照准备好的 PNG 字节。不一致则不上传。上传只调用一次。返回值不是布尔 `true`，或调用抛错、断线、超时，都失败并且不自动再传。
- 成功返回里带 `project_icons` 和 `readback`（路径还在）。合同测试用假的编辑器模块。这不是像塑 9.8.3 的读回。
- `icon_open` 调用 `showIconCreationWindow('tool_bar')`。不最小化，不读窗口列表，所以 `window_readback` 是假，`minimized` 是 `null`。
- 不勾协议，不点提交审核，不发布，不调用付费生成。
- 像塑 9.8.3 上 `REQUIRED.music` 是否仍是这些模块路径，以及 `setDouyinMusicInfo` 的返回值能否读出曲目 id

## 还没在编辑器里做完的

1. 上面那一次 9.8.3 记录没有覆盖全部曲库路径。`music_apply` 的导入语义、搜索分页、分类列表和失败后再试，仍不要写成普遍验收。
2. 图标那一次是同一可丢弃工程上的单次 `icon_set` 和随后的官方保存。`icon_open` 是否让窗口出现，以及别的图片，还没有这份记录。
3. 不代勾协议，不点提交审核，不调用付费生成。plus 不自己启动编辑器。
