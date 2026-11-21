# xiangsu-mcp-plus-win

非官方的 Windows MCP 桥。官方已经能做的场景、脚本、预览和保存只转发，不重写。本仓库只补官方没有的工程窗口开关：`ext_status`、`project_open`、`project_new`、`project_close`。不是字节跳动或抖音的产品。MIT，上游与归属见 [NOTICE](NOTICE)。

不要把像塑程序、官方源码、素材、令牌或本机配置提交进仓库。不要代勾协议、提交审核或发布特效。

契约细节在 [docs/DESIGN.md](docs/DESIGN.md)。这里和代码冲突时以代码为准。

## 改哪里

| 路径 | 职责 |
| --- | --- |
| `src/server.mjs` | stdio MCP，工具列表与 `ext_status` |
| `src/official.mjs` | 官方 HTTP MCP，一次转发 |
| `src/projects.mjs` | 打开、新建、关闭 |
| `src/bridge.mjs` | 插件 RPC 与实例记录 |
| `editor-plugin/` | 跑在像塑工程窗口里的插件 |
| `src/plugininstall.mjs`、`scripts/` | 安装、卸载、回滚 |
| `src/editor.mjs` | 找产品根和版本 |
| `test/`、`support/` | 合同测试和夹具 |

## 构建与验证

需要 Node.js 22 或更新。

```bash
npm ci
npm test
npm run pack
```

`npm test` 就是 `node --test`，不打开像塑。CI 在 `ubuntu-latest` 和 `windows-latest` 上用 Node 22 和 24 跑同一命令。`npm run pack` 把源码包写到 `release/`，旁边有 `.sha256`。安装和卸载见 [README.md](README.md)。

改了哪一层就跑覆盖那一层的测试。合同测试通过不等于编辑器集成已经通过；写验证说明时把两者分开。在 Windows 上调用工具时，把参数放进 UTF-8 文件，不要用 shell 拼接 JSON。

## 实现

- 依赖的编辑器内部模块先自检。缺了就让对应能力失败并隔离，不要假装成功。模块形状和状态目录见 DESIGN。
- 打开、新建、关闭必须指向一个明确的窗口。同一窗口上的这些变更串行。
- 写操作一旦发出，结果不明（断线或超时）就不要自动再发。
- 会丢掉用户数据的操作，在身份或脏状态无法证明时拒绝。错误要能看出失败阶段和原因，并去掉令牌。
- 允许和拒绝哪些工程路径，以当前代码为准。不要把某次测试用的名单，或还没实现的默认策略，写成永久产品限制。只保留能避免数据丢失的约束。

## 拉取请求

改动范围限于这一件事。用户能看到的契约变了，就同时改 README 或 DESIGN。说明跑了什么：合同测试、打包清单，或一次真实编辑器会话，不要混称。没有约定的集成验证时，不要把 `ext_status.contract.editor_acceptance` 改成已通过。
