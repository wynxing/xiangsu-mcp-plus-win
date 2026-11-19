# xiangsu-mcp-plus-win

非官方的 Windows MCP 桥。它把像塑已经提供的官方 MCP 工具原样转发出来，并只补上官方目前没有的工程窗口开关：`project_open`、`project_new`、`project_close`，外加 `ext_status` 自检。

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

曲库和图标工具没有注册。`ext_status` 里的 `features.music` / `features.icon` 只是诊断。

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
| `XIANGSU_MCP_PLUS_STATE` | 状态目录。默认是用户主目录下的 `.xiangsu-mcp-plus-win`。 |
| `XIANGSU_ALLOW_PROJECTS` | 生命周期白名单，用 `|` 隔开的绝对路径。未列入的工程不能被打开、新建或关闭。也可以写在未纳入版本库的 `config.local.json` 的 `allowProjects` 数组里。 |
| `XIANGSU_DENY_PROJECTS` | 黑名单，同样用 `|` 分隔，或写在 `config.local.json` 的 `denyProjects`。命中的目录优先于白名单。 |

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
4. 生成的 `index.js` 用绝对路径加载 `runtime.cjs`，避免 npx 缓存目录变化后插件找不到代码。

令牌文件在 Windows 上会换成只含当前用户的 DACL，并读回来核对。核对失败就删掉令牌文件并停止监听。POSIX 上目录是 `0700`，文件是 `0600`。

同一版本且代码还在时，再次安装结果是 `kept`。`--force` 会重装。

插件只在带 `--projectType=project` 的工程窗口里启动。装完之后要新开一个工程窗口，已经开着的窗口不会自动加载。

把 stdio 服务交给 MCP 客户端时，用本机的 `node` 运行 `src/server.mjs`，工作目录是本包根目录。服务启动时会再尝试安装；安装失败只记在 `ext_status.plugin_install`，官方转发仍然可以启动。

## 回滚与卸载

```bat
node scripts/uninstall.mjs --dry-run
node scripts/uninstall.mjs
```

卸载只删除 `XiangsuMcpPlus` / `XiangsuMcpExt` 的目录和配置项，不删除其他插件，也不删除 `plugins.config.json.bak-*`。

若要回到安装前的配置文件，把对应的 `plugins.config.json.bak-<时间>` 复制回 `plugins.config.json`。那份备份是安装前的完整内容。卸载之后编辑器里已经打开的窗口仍可能留着旧插件，关掉这些窗口即可。

## 冒烟测试（需要你自己的 Windows 和像塑）

下面的步骤**不是**本仓库已经完成的验收。合同测试全是模拟。真正点进 9.8.3 之前，先看 `ext_status`。

1. 准备一个新建的空目录，名字类似 `_mcp_win_probe-<时间>`。不要用不能丢弃的工程，也不要把它放进那些工程里面。
2. 把一次性目录和用来发起操作的那个已打开工程都放进 `XIANGSU_ALLOW_PROJECTS`。不在名单里的路径会被拒绝。不能碰的目录放进 `XIANGSU_DENY_PROJECTS`。不要把这些路径写进仓库。
3. 安装插件后，手工打开一个可丢弃的工程窗口，让插件加载。像塑同时大约只能开两个工程窗口。
4. 调用 `ext_status`。确认 `plugin_install.action` 不是 `failed`，官方 `connected` 为真，测试窗口的 `self_check.features.project` 为真。若为假，列出的 `missing` 就是当前编辑器缺少的内部模块，停在这里，不要继续开关窗口。
5. 用官方 `list_instances` 只读核对测试窗口。官方工具由本服务转发，断线后不会自动再发。
6. `project_close` 只关测试窗口。读不到工程路径、路径和官方实例不一致、或不能证明没有未保存修改时都会拒绝。关窗前会再读一次脏状态；这 300 毫秒里变成了脏且没有 `discard_changes`，进程不会退出。确认别的窗口还在。
7. `project_open` 再打开测试工程目录（里面要有 `effect.dyehpj`）。已经打开时会原样返回。
8. `project_new` 指到一个还不存在、且在白名单里的空目录。保存前会再确认目录仍是空的，并要求官方实例路径和插件里的临时工程路径一致、都不在黑名单里，而且用来新建的那个窗口还停在原来的工程上。对不上就不会调用 `save_project`。
9. 关掉新建窗口，删掉临时目录。不要点提交审核，不要勾选协议。

没有工程窗口时，`project_open` 应返回 `NO_EDITOR_WINDOW` 和 `WINDOWS_COLD_START_UNVERIFIED`，并且不会启动编辑器。

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

产物在 `release/xiangsu-mcp-plus-win-0.1.0.tgz`，旁边有 `.sha256`。包里没有官方程序、素材或令牌。
