# xiangsu-mcp-plus-win

<div align="left">

[![test](https://github.com/wynxing/xiangsu-mcp-plus-win/actions/workflows/test.yml/badge.svg)](https://github.com/wynxing/xiangsu-mcp-plus-win/actions/workflows/test.yml)
[![Release](https://img.shields.io/github/v/release/wynxing/xiangsu-mcp-plus-win?color=blue)](https://github.com/wynxing/xiangsu-mcp-plus-win/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-brightgreen.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-blue.svg)](https://microsoft.com/windows)
[![MCP Protocol](https://img.shields.io/badge/MCP-Protocol-purple.svg)](https://modelcontextprotocol.io/)

</div>

非官方的 Windows 像塑（Douyin AR）Model Context Protocol (MCP) 桥梁。它把像塑已经提供的官方 MCP 工具原样透明转发，并补齐官方目前没有的工程窗口生命周期管理（`project_open`、`project_new`、`project_close`）、Windows 无头后台冷启动引导、抖音曲库检索与绑定（`music_categories`、`music_list`、`music_search`、`music_apply`、`music_verify`）、图标本地标准化裁切上传（`icon_set`、`icon_open`），以及高可靠的 `ext_status` 运行态自检。

> [!CAUTION]
> **免责声明与安全红线**：  
> 本项目不是字节跳动或抖音的产品，与官方没有从属关系。仅供学习与个人特效制作辅助。严禁使用本项目自动提交审核、代勾选创作者服务协议、发布特效，或对不可丢弃的重要工程做未经备份的自动化关闭和保存。

---

## 功能对比 (Feature Matrix)

| 能力项 | 像塑官方 MCP (`127.0.0.1:17320`) | xiangsu-mcp-plus-win (本项目) |
| :--- | :---: | :---: |
| **官方工具透传** | ✅ 直接提供（场景/节点/资产读写） | ✅ 原样单次转发，严格不自动重放 |
| **工程打开 (`project_open`)** | ❌ 无 | ✅ 安全受控打开，支持路径白名单校验 |
| **工程新建 (`project_new`)** | ❌ 无 | ✅ 校验空目录防误覆盖，断线阶段回滚 |
| **工程安全关闭 (`project_close`)** | ❌ 无 | ✅ 双重脏检查（官方 + 插件 300ms 探测） |
| **无头冷启动 (Cold Start)** | ❌ 需手工先打开像塑客户端 | ✅ 自动后台/最小化引导拉起，零干扰前台 |
| **抖音曲库检索与绑定 (`music_*`)** | ❌ 无 | ✅ 分类/搜索/分页/安全导入/双向持久化核验 |
| **图标标准化裁切上传 (`icon_*`)** | ❌ 无 | ✅ 本地 Lanczos3 裁切为 360×360 PNG 上传 |
| **本地通信鉴权** | ⚠️ 无鉴权（依赖本地网络） | ✅ 环回随机端口 + 独立 Bearer Token |
| **Windows NTFS ACL 权限收敛** | ❌ 无 | ✅ 强制配置 DACL 仅限当前属主用户读写 |
| **并发防护 (Target Lock)** | ❌ 无 | ✅ 跨进程/跨窗口排他锁防止数据写入竞争 |

---

## 快速接入 (Quickstart)

### 1. 环境准备
- Windows 10 / 11 操作系统
- 像塑客户端（官方安装版本，如 9.8.3）
- [Node.js](https://nodejs.org/) `>= 22`

### 2. 克隆与安装插件
在 Windows 终端（PowerShell 或 CMD）中执行：

```bat
git clone https://github.com/wynxing/xiangsu-mcp-plus-win.git
cd xiangsu-mcp-plus-win
npm ci

:: 执行插件安装（支持自动发现像塑路径）
node scripts/install.mjs
```

> [!TIP]
> 如需提前预览将写入的文件而不真正落盘，可运行 `node scripts/install.mjs --dry-run`。

### 3. 配置 MCP 客户端

#### 在 Claude Desktop 中使用
编辑 `%APPDATA%\Claude\claude_desktop_config.json`，在 `mcpServers` 中增加：

```json
{
  "mcpServers": {
    "xiangsu-plus": {
      "command": "node",
      "args": [
        "C:\\path\\to\\xiangsu-mcp-plus-win\\src\\server.mjs"
      ],
      "env": {
        "XIANGSU_MCP_URL": "http://127.0.0.1:17320/mcp"
      }
    }
  }
}
```

#### 在 Cursor / Windsurf / Roo Code 中使用
在对应的 MCP 配置文件中添加：

```json
{
  "mcpServers": {
    "xiangsu-plus": {
      "command": "node",
      "args": [
        "C:/path/to/xiangsu-mcp-plus-win/src/server.mjs"
      ]
    }
  }
}
```

配置完成后重启客户端，调用 `ext_status` 工具确认 `connected: true` 且各扩展功能自检正常即可开始使用。

---

## 许可与来源

MIT。版权与归属见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。

工程生命周期、回环令牌 RPC 和官方转发，改编自 [Muqian-Sun/xiangsu-mcp-plus](https://github.com/Muqian-Sun/xiangsu-mcp-plus)（MIT，核对到提交 `05d83470`，v0.9.0）。Windows 用户插件目录 `%LOCALAPPDATA%\DouyinAR\Plugins\v<短版本>\Local` 的约定参考了 [sleepyquq/xiangsu-mcp](https://github.com/sleepyquq/xiangsu-mcp)（MIT）。设计说明见 [docs/DESIGN.md](docs/DESIGN.md)。

---

## 核心特性与设计细节

- **用户插件安全安装**：安装用户插件 `XiangsuMcpPlus`。安装前备份 `plugins.config.json`，保留其他既有插件。从 npx 缓存运行时，会先把插件代码复制到状态目录。
- **stdio MCP 透传转发**：默认连接 `http://127.0.0.1:17320/mcp`，可用 `XIANGSU_MCP_URL` 自定义。官方调用单次发出，断线或超时绝不自动重放。
- **本地高强度隔离**：每个工程窗口在 `127.0.0.1` 上分配随机端口，使用随机高熵 Bearer 令牌。状态文件与令牌在 Windows 上强制应用 NTFS DACL，仅允许当前用户读写；日志与 `ext_status` 严格抹除令牌。
- **精确防 PID 复用**：用进程启动时间丢弃已退出或 PID 被复用的实例记录。Windows 读 CIM `CreationDate`，Linux 读 `/proc`。
- **健康度与自检 (`ext_status`)**：报告官方连通性、插件安装版本、每个窗口的 `self_check`。缺内部模块时明确报错，拒绝假阳性。
- **受控工程生命周期**：
  - 已有工程窗口时：安全支持 `project_open` / `project_new` / `project_close`。
  - 零工程窗口时：支持 Windows 无头后台冷启动引导（`bootstrapEditor`），自动以最小化模式拉起编辑器并接管预热窗口（返回 `WINDOWS_COLD_START_READY`），不抢占前台焦点。
- **曲库能力**：`music_categories`、`music_list`、`music_search` 提供分类与检索；`music_apply` 执行安全导入；`music_verify` 进行只读双向持久化比对（核对 `soundID`、`MusicInfo.json` 与组件绑定）。
- **图标标准化裁切**：`icon_set` 使用 `sharp` 库在本地按 EXIF 转正、保持中心正方形、以 Lanczos3 算法缩放至 360×360 PNG 上传；`icon_open` 调出编辑器图标窗口。

---

## 环境变量配置

请勿将个人安装路径硬编码进代码，可通过以下环境变量进行灵活配置：

| 环境变量 | 作用与说明 |
| :--- | :--- |
| `XIANGSU_EDITOR_ROOT` | 像塑产品根目录。设置之后不再猜测其他路径。 |
| `XIANGSU_EDITOR_EXE` | 直接显式指定 `Douyin AR.exe` 的完整路径。 |
| `XIANGSU_PLUGIN_ROOT` | 跳过自动探测，直接安装到指定的 `Local` 插件目录。 |
| `XIANGSU_LOCALAPPDATA` | 覆盖默认的 `LOCALAPPDATA` 路径。 |
| `XIANGSU_MCP_URL` | 官方 MCP 端口地址（默认 `http://127.0.0.1:17320/mcp`）。 |
| `XIANGSU_MCP_PLUS_STATE` | 状态与日志存储目录。默认 `%USERPROFILE%\.xiangsu-mcp-plus-win`。 |
| `XIANGSU_ALLOW_PROJECTS` | **路径白名单**。以 `\|` 分隔的绝对路径列表。配置后，打开/新建/关闭仅允许在这些目录下执行。 |
| `XIANGSU_DENY_PROJECTS` | **路径黑名单**。以 `\|` 分隔的绝对路径列表。命中黑名单时优先拦截并返回 `PROTECTED_PROJECT`。 |

---

## 安装、升级与回滚

### 从源码安装

```bat
npm ci
set XIANGSU_EDITOR_ROOT=D:\path\to\Douyin AR
node scripts/install.mjs
```

安装机制保证：
1. 现有 `plugins.config.json` 和旧版本插件目录会自动备份至 `install-backups/`。
2. 新插件先在临时目录校验完整性，再原子替换旧目录。写入失败时旧目录原样保留。
3. 令牌文件在 Windows 上强制设置仅当前用户可访问的 DACL 并读回校验。

### 卸载插件

```bat
node scripts/uninstall.mjs --dry-run
node scripts/uninstall.mjs
```

卸载只清理 `XiangsuMcpPlus` / `XiangsuMcpExt` 目录与配置项，保留其他插件和备份。

### 回滚到前一版本

```bat
node scripts/rollback.mjs --plugin-root "%LOCALAPPDATA%\DouyinAR\Plugins\v9.8.3\Local" --backup "%USERPROFILE%\.xiangsu-mcp-plus-win\install-backups\<时间戳>-<pid>"
```

---

## 冒烟测试（本地实机核验）

`npm test` 为单元与合同 Mock 测试。在实机上进行集成复查时，请遵循以下流程：

1. **测试目录准备**：准备一个类似 `_mcp_win_probe-<时间>` 的新建空目录。严禁使用真实、不可丢弃的特效工程。
2. **保护黑名单**：将重要工程路径加入 `XIANGSU_DENY_PROJECTS`。
3. **健康检查**：调用 `ext_status`，确认 `plugin_install.action !== 'failed'`、官方 `connected: true`，且窗口 `self_check.features.project: true`。
4. **生命周期验证**：
   - 调用 `project_new` 创建临时空工程，核实创建与保存正常。
   - 调用 `project_close` 关闭测试窗口，核对无未保存修改后安全关闭。
   - 调用 `project_open` 重新打开该临时工程，验证路径对齐。
5. **曲库与图标验证**：在可丢弃工程上验证 `music_categories` -> `music_search` -> `music_apply` -> 官方保存 -> `music_verify`，以及 `icon_set` 360×360 裁切上传。
6. **清理**：测试结束后关闭窗口并删除临时目录。

---

## 开发与测试

```bat
npm ci
npm test
```

`npm test` 基于 Node.js 内置测试框架（`node --test`）。GitHub Actions 在 `ubuntu-latest` 和 `windows-latest`（覆盖 Node 22 和 Node 24）上自动执行测试矩阵。

### 构建发布包

```bat
npm run pack
```

产物将输出在 `release/xiangsu-mcp-plus-win-<version>.tgz` 及其对应的 `.sha256` 校验和文件中。

---

## 社区规范与安全

- **参与贡献**：请参阅 [CONTRIBUTING.md](CONTRIBUTING.md) 了解代码规范、提交格式与安全红线。
- **安全策略与漏洞报告**：请参阅 [SECURITY.md](SECURITY.md) 了解防御架构与负责任披露方式。
- **开源许可证**：基于 [MIT License](LICENSE) 开源。
