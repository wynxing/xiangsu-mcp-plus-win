# xiangsu-mcp-plus-win

非官方的 Windows MCP 桥。它把像塑已经提供的官方 MCP 工具原样转发出来，并补上官方目前没有的工程窗口开关（`project_open`、`project_new`、`project_close`）和抖音曲库（`music_categories`、`music_list`、`music_search`、`music_apply`），外加 `ext_status` 自检。

这不是字节跳动或抖音的产品，与官方没有从属关系。只供学习和个人制作。不要用它提交审核、勾选创作者协议、发布特效，或对不能丢弃的工程做关闭和保存。

## 许可与来源

MIT。版权与归属见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。

工程生命周期、回环令牌 RPC 和官方转发，改编自 [Muqian-Sun/xiangsu-mcp-plus](https://github.com/Muqian-Sun/xiangsu-mcp-plus)（MIT，核对到提交 `05d83470`，v0.9.0）。Windows 用户插件目录 `%LOCALAPPDATA%\DouyinAR\Plugins\v<短版本>\Local` 的约定参考了 [sleepyquq/xiangsu-mcp](https://github.com/sleepyquq/xiangsu-mcp)（MIT）。那个仓库的文件会话桥和场景工具没有搬进来，也不能代替这里要补的工程开关。

设计说明、已测契约和尚未在编辑器里验收的部分见 [docs/DESIGN.md](docs/DESIGN.md)。

## 这一版做什么

- 安装用户插件 `XiangsuMcpPlus`。安装前备份 `plugins.config.json`，保留其他插件条目。从 npx 缓存运行时，会先把插件代码复制到状态目录。
- stdio MCP 转发官方工具。默认 `http://127.0.0.1:17320/mcp`，可用 `XIANGSU_MCP_URL` 改。官方调用只发一次；发出后断线或超时不会自动重放。
- 每个工程窗口在 `127.0.0.1` 上开随机端口，使用随机 Bearer 令牌。状态文件只留给当前用户。日志和 `ext_status` 会抹掉令牌。
- 用进程启动时间丢掉已经退出或 pid 被复用的实例记录。Windows 读 CIM `CreationDate`，Linux 读 `/proc`。不使用 macOS 的 `ps -o lstart`。
- `ext_status` 报告官方连通、安装结果、每个窗口的 `self_check`。缺内部模块时失败，不假装成功。
- 已有工程窗口时：`project_open` / `project_new` / `project_close`。
- 没有工程窗口时：明确返回 `WINDOWS_COLD_START_UNVERIFIED`。本版不会去启动 `Douyin AR.exe`。

曲库工具已注册，还没有在像塑里验收。`music_categories`、`music_list`、`music_search` 返回 `category_code` 或 `music_id`，以及可原样交回 `music_apply` 的 `selection`（`source`、`category_code` 或 `query`、`page_cursor`）。绑定只按这个 `music_id` 再读同一页，走曲库的 `setDouyinMusicInfo`，不把本地音频文件导进工程。`confirmed` 只在读回的 id 一致时为真；写完读不到、对不上、或调用中断，都不会再发一次。多个窗口时曲库工具也要 `project_path` 或 `instance_id`。`music_apply` 沿用当时的允许/拒绝路径规则，并要求插件路径和官方实例路径仍是同一个工程。`features.music` 为假时曲库工具失败，不把 `features.project` 判失败。

`icon_set` 和 `icon_open` 已注册，但还没有在像塑 9.8.3 里读回。多个工程窗口时必须给出 `project_path` 或 `instance_id`。插件先做 `features.icon` 自检，缺模块就失败，工程开关仍可用。`icon_set` 先在本机做成 360×360 的新 PNG，再交给那个窗口写到编辑器报告的图标路径并上传一次。上传返回值不是 `true`、或请求断线、超时时，不自动再传，也不把结果说成成功。这不是提交审核：不勾协议、不点提交、不发布、不调用付费生成。`icon_open` 只调用 `showIconCreationWindow`，不声称窗口已经可见，也不去最小化。

360×360 的图标图由 `src/icon-image.mjs` 在本机生成。它按文件头识别 png、jpeg、gif、webp，先按 EXIF 转正，再按较短边裁出正方形（左/上偏移是 `floor((源边 - 边长) / 2)`，多出来的一像素留在右侧或下侧），然后用 lanczos3 缩放到 360 的新 PNG。小于 360 的图会放大，不留边。源文件不改。不调用 macOS `sips`。依赖 `sharp` 0.34.5，安装时用 `npm ci`，它会按当前系统拉取对应的预编译包（Windows 为 `sharp-win32-x64`）。

## 环境

- Windows 上的像塑 / Douyin AR。本仓库的合同测试没有在 9.8.3 编辑器里跑过。
- Node.js 22 或更新。开发机上的合同测试用的是 Node 22；CI 同时覆盖 Node 22 和 24。
- 官方 MCP 管理器一般在 `127.0.0.1:17320`。实例端口由官方分配，不要写成固定的 17321。

产品根目录是同时放着 `Resources` 和可执行文件的那一层。可执行文件可以是 `<产品根>\Douyin AR.exe`，也可以是 `<产品根>\electron\Douyin AR.exe`。`electron\version` 是 Electron 的版本，不能当成像塑版本。像塑版本读的是 exe 里的 `FileVersion` 字符串，用户插件目录只用前三段（例如 `9.8.3.942073156` → `v9.8.3`）。

不要把个人安装路径写进程序。用下面的环境变量：

| 变量 | 作用 |
| --- | --- |
| `XIANGSU_EDITOR_ROOT` | 产品根。设置之后不再猜其他位置。 |
| `XIANGSU_EDITOR_EXE` | 直接给出 `Douyin AR.exe`。 |
| `XIANGSU_PLUGIN_ROOT` | 跳过探测，装到这个 `Local` 目录。 |
| `XIANGSU_LOCALAPPDATA` | 覆盖 `LOCALAPPDATA`。 |
| `XIANGSU_MCP_URL` | 官方 MCP 地址。 |
| `XIANGSU_MCP_PLUS_STATE` | 状态目录。默认是用户主目录下的 `.xiangsu-mcp-plus-win`。像塑进程通常拿不到这个变量，插件仍写默认目录；stdio 会同时查看默认目录。 |
| `XIANGSU_ALLOW_PROJECTS` | 可选。用 `|` 隔开的绝对路径。设置了环境变量，或 `config.local.json` 里写了 `allowProjects` 数组，打开、新建、关闭就只发生在这些根目录里。两者都没写时，不在黑名单里的普通路径可用。空字符串或空数组是明确的收窄，不是「没配置」。已有的 `allowProjects` 会原样保留。 |
| `XIANGSU_DENY_PROJECTS` | 黑名单，用 `|` 分隔，或写在未跟踪的 `config.local.json` 的 `denyProjects`。命中优先于默认允许和白名单，返回 `PROTECTED_PROJECT`。 |

未设置根目录时，只在运行中的 `Douyin AR.exe` / `orionkit.exe`，以及 `%LOCALAPPDATA%\Douyin AR`、`Program Files\Douyin AR` 里查找。

## 安装

从 git 检出时用锁定的依赖；`release/` 里的 `.tgz` 是 `npm pack` 的结果，不含 lockfile，解压后用 `npm install`。

```bat
npm ci
set XIANGSU_EDITOR_ROOT=D:\path\to\Douyin AR
node scripts/install.mjs
```

先看会写什么、不落盘：

```bat
node scripts/install.mjs --dry-run
```

安装会：

1. 先把现有 `plugins.config.json` 和将要换掉的 `XiangsuMcpPlus` / `XiangsuMcpExt` 目录复制到 `install-backups`。配置文件旁边也会留一份 `plugins.config.json.bak-<时间>`。
2. 新插件先写到临时目录并核对 `index.js`、清单和标记都在，再替换旧目录。写入失败时旧目录还在。
3. 其他插件原样保留。
4. 生成的 `index.js` 仍是清单里的 `entry`。同目录有一份只写 `"type": "commonjs"` 的 `package.json`。Node 用离文件最近的 `package.json` 判断 `.js` 是 CommonJS 还是 ES 模块。用户主目录若是 `"type": "module"`，而插件目录没有自己的 `package.json`，`index.js` 里的 `require` 会在加载时失败。不要改主目录的 `package.json`，也不要把入口改成尚未在编辑器里核对过的 `.cjs`。
5. `editor-plugin` 会复制到状态目录 `editor-plugin/<版本>/<构建号>/`。入口用绝对路径加载那里的 `runtime.cjs`，解压目录或 npx 缓存删掉之后仍然找得到。

令牌文件在 Windows 上会换成只含当前用户的 DACL，并读回来核对。核对失败就删掉令牌文件并停止监听。POSIX 上目录是 `0700`，文件是 `0600`。

同一版本只有在构建号一致、这份 CommonJS 边界还在、并且状态目录里的 `runtime.cjs` 还在时，再次安装才是 `kept`。0.1.2 没有把插件 RPC 的 `fetch failed` 原因码写出来，安装 0.1.3 会替换它。`--force` 仍会重装。

插件只在带 `--projectType=project` 的工程窗口里启动。已经开着的窗口不会重新加载。装完 0.1.3 之后，关掉可丢弃的工程窗口再打开一次。

从已经装过 0.1.2 的机器升级时，不要改 `%USERPROFILE%\package.json`，也不要改像塑程序目录：

```bat
set XIANGSU_EDITOR_ROOT=D:\path\to\Douyin AR
node scripts\install.mjs --dry-run
node scripts\install.mjs
```

需要替换时，`--dry-run` 的 `action` 是 `dry-run`，`version` 是 `0.1.3`，`requires_window_reopen` 为真。若 `action` 已是 `kept` 且 `version` 仍是 `0.1.2`，跑到的还是旧包。

从源码包安装：

```bat
tar -xf xiangsu-mcp-plus-win-0.1.7.tgz
cd package
npm ci
set XIANGSU_EDITOR_ROOT=D:\path\to\Douyin AR
node scripts\install.mjs
```

插件目录是 `%LOCALAPPDATA%\DouyinAR\Plugins\v9.8.3\Local\XiangsuMcpPlus@0.1.7`。运行时代码在 `%USERPROFILE%\.xiangsu-mcp-plus-win\editor-plugin\0.1.7\<构建号>\`。不要为了让窗口出现而改用户主目录的 `package.json`。stdio 即使设置了别的 `XIANGSU_MCP_PLUS_STATE`，也会读取默认主目录里的实例文件。同一个 pid 在两个目录里都有活记录且端口或令牌不同时，服务拒绝选择。

`features.project` 在类直接导出（`Project.prototype.isProjectChanged`）或 9.8.3 命名空间（`Project.Project.prototype.isProjectChanged`）时可以为真；两条都没有、也没有已打开工程上的实例方法时仍为假。关闭还要求插件方法和官方 `project_status` 的 `is_changed` 都是 `false`，并且官方 `scene_dirty` 不是 `true`。这还不是编辑器验收，装完要重新打开可丢弃窗口后再看 `ext_status`。

0.1.3 的插件 RPC 每次单独连接（`Connection: close`），避免复用一条已经被对端关掉的 keep-alive 连接。失败时工具文本是 `PLUGIN_RPC_FAILED(<方法>): fetch failed (<原因码>)`，不再只有 `fetch failed`。插件在 `project_launch` / `project_close` 开始和正常结束时写 `rpc start` / `rpc done`，抛错时仍写 `rpc error`。日志和错误里不包含 Bearer 令牌。这次机器上的 `fetch failed` 没有留下原因码，所以还不能断定连接复用就是那次失败的原因；下一次失败应能直接看到原因码，以及请求有没有进到插件。脏状态和窗口身份的拒绝没有放宽。未配置白名单时，普通路径可以操作。

0.1.5 写 DACL 时不从 `PATH` 找 `powershell.exe` 或 `whoami.exe`，只用 `SystemRoot` 下的绝对路径。只有 `System32`、没有 `WindowsPowerShell\v1.0` 的进程也能定位到系统里的 `powershell.exe`。找不到就失败，不跳过 ACL。插件启动失败写到 `logs/plugin.log` 的 `init failed`，并接住异步拒绝。这不是像塑实机验收。

0.1.6 把同一条绝对路径用到 stdio 的进程启动时间检查和正在运行的编辑器发现。启动时间查不到仍是错误，不是空窗口列表。空闲工程进程（插件已连接、`project_path` 为空）可以发起 `project_open` / `project_new`。首页进程可能把工程放进这个进程，也可能另开一个进程；读回路径对上的那个 pid 才是结果。已经显示工程的窗口不会被换成新工程。没有插件进程时仍不启动编辑器。文件关联不是这个请求。这不是像塑实机验收。

0.1.7 把 0.1.6 与已完成的图标、曲库改动放进同一个安装包。`npm ci` 会安装 `sharp` 0.34.5 的当前平台预编译包。图标和曲库的编辑器读回仍未验收。

把 stdio 服务交给 MCP 客户端时，用本机的 `node` 运行 `src/server.mjs`，工作目录是本包根目录。服务启动时会再尝试安装；安装失败只记在 `ext_status.plugin_install`，官方转发仍然可以启动。

## 回滚与卸载

```bat
node scripts/uninstall.mjs --dry-run
node scripts/uninstall.mjs
```

卸载只删除 `XiangsuMcpPlus` / `XiangsuMcpExt` 的目录和配置项，不删除其他插件，也不删除备份。

成功安装时，状态目录 `install-backups/<时间戳>-<pid>/` 里同时有两样东西：安装前的完整 `plugins.config.json`，以及被替换的插件目录（例如 `XiangsuMcpPlus@<旧版本>`）。同目录旁边的 `plugins.config.json.bak-<时间戳>` 只是配置文件的另一份副本，里面没有插件代码。只把 `.bak` 拷回去会留下新版本的代码目录，编辑器仍可能加载新代码。

回到这一次安装之前：

```bat
node scripts/rollback.mjs --plugin-root "%LOCALAPPDATA%\DouyinAR\Plugins\v9.8.3\Local" --backup "%USERPROFILE%\.xiangsu-mcp-plus-win\install-backups\<时间戳>-<pid>"
```

这会按备份里的配置写回 `plugins.config.json`，把备份中的插件目录放回 `Local`，并删掉这次新装上、备份里没有的 `XiangsuMcpPlus` / `XiangsuMcpExt` 目录。其他插件的目录和配置项保持备份里的样子。备份目录本身不会被删。卸载之后，已经打开的窗口里可能还留着旧插件，关掉这些窗口即可。

## 冒烟测试（需要你自己的 Windows 和像塑）

下面的步骤**不是**本仓库已经完成的验收。合同测试全是模拟。真正点进 9.8.3 之前，先看 `ext_status`。

1. 准备一个新建的空目录，名字类似 `_mcp_win_probe-<时间>`。不要用不能丢弃的工程，也不要把它放进那些工程里面。
2. 不能碰的目录放进 `XIANGSU_DENY_PROJECTS` 或 `config.local.json` 的 `denyProjects`。没有配置白名单时，其他普通路径可以操作。若已经写了 `allowProjects` 或 `XIANGSU_ALLOW_PROJECTS`，就只在那些根目录里操作。不要把这些路径写进仓库。
3. 安装插件后，手工打开一个可丢弃的工程窗口，让插件加载。像塑同时大约只能开两个工程窗口。
4. 调用 `ext_status`。确认 `plugin_install.action` 不是 `failed`，官方 `connected` 为真，测试窗口的 `self_check.features.project` 为真。若为假，列出的 `missing` 就是当前编辑器缺少的内部模块，停在这里，不要继续开关窗口。
5. 用官方 `list_instances` 只读核对测试窗口。官方工具由本服务转发，断线后不会自动再发。
6. `project_close` 只关测试窗口。读不到工程路径、路径和官方实例不一致、或不能证明没有未保存修改时都会拒绝。关窗前会再读一次脏状态；这 300 毫秒里变成了脏且没有 `discard_changes`，进程不会退出。确认别的窗口还在。
7. `project_open` 再打开测试工程目录（里面要有 `effect.dyehpj`）。已经打开时会原样返回。
8. `project_new` 指到一个还不存在的空目录，且不在黑名单里。若配置了白名单，目录还必须落在其中。保存前会再确认目录仍是空的，并要求官方实例路径和插件里的临时工程路径一致、都不在黑名单里。发起窗口如果本来就显示着一个工程，它必须还停在那个工程上。空闲窗口可以自己变成新建结果。对不上就不会调用 `save_project`。
9. 关掉新建窗口，删掉临时目录。不要点提交审核，不要勾选协议。

没有插件进程时，`project_open` 应返回 `NO_EDITOR_WINDOW` 和 `WINDOWS_COLD_START_UNVERIFIED`，并且不会启动编辑器。只有一个空闲工程进程时，可以对一个可丢弃的空目录调用 `project_new`，再对一个含 `effect.dyehpj` 的可丢弃工程调用 `project_open`。结果里的 pid 可以是原来的空闲进程，也可以是新进程；插件路径和官方实例路径都要读回成目标路径。`PATH` 里没有 `WindowsPowerShell\v1.0` 时，`ext_status` 仍应列出这个窗口，而不是 `PROCESS_START_CHECK_FAILED`。这两步还不是已经完成的实机验收。

曲库还要在可丢弃窗口上另做一次，做完不要保存到不能丢的工程，也不要勾协议或提交审核：

1. `ext_status` 里该窗口的 `self_check.features.music` 必须为真。为假就停，缺的是 `missing` 里的曲库模块，不是工程开关。
2. `music_categories`，再 `music_search`（或 `music_list`）。记下一条的 `music_id` 和整份 `selection`。
3. `music_apply` 把这份 `selection` 原样传回，并带上同一个 `project_path` 或 `instance_id`。`confirmed` 为真且 `readback.music_id` 等于所选 id，才算这次绑定对上了。`binding` 应为 `douyin_library`。
4. 若返回 `MUSIC_APPLY_UNCONFIRMED`、`MUSIC_APPLY_MISMATCH` 或传输失败，不要再调一次。错误里若有可读方法名，记下来即可。不要把合同测试的通过写成编辑器验收。

图标在同一个可丢弃工程上另做一次，不要提交审核、勾协议、发布或付费：

1. `ext_status` 里该窗口的 `self_check.features.icon` 必须为真。为假就停。
2. 准备一张可丢弃的 png、jpeg、gif 或 webp，绝对路径交给 `icon_set`，并带上该窗口的 `project_path` 或 `instance_id`。
3. 返回里 `uploaded` 为真、`calls` 为 1、`prepared` 是 360×360，`project_icons` 里的路径还能读到刚写入的 PNG。对不上或 `ICON_UPLOAD_UNCONFIRMED` 时不要再传。
4. `icon_open` 只要求插件调用了 `showIconCreationWindow`。不要把窗口是否出现在屏幕上当成已经证明。

## 开发测试

```bat
npm ci
npm test
```

`npm test` 就是 `node --test`。GitHub Actions 在 `ubuntu-latest` 和 `windows-latest` 上分别用 Node 22 和 Node 24 运行同一命令。

这些测试覆盖路径、版本和资源目录、安装保留其他插件、缺模块时的 `ext_status`、令牌与鉴权、过期窗口、重复打开和新建、安全关闭，以及官方转发不重放。它们不打开像塑。

源码包：

```bat
npm run pack
```

产物在 `release/xiangsu-mcp-plus-win-0.1.7.tgz`，旁边有 `.sha256`。解压后的包包含 `npm-shrinkwrap.json`、`scripts/install.mjs`、`scripts/uninstall.mjs`、`scripts/rollback.mjs` 和 `src/server.mjs`。在解压目录执行 `npm ci` 才会装上 `sharp` 0.34.5 的当前平台预编译包。包里没有官方程序、素材或令牌。
