# 贡献指南 (Contributing Guide)

感谢你关注并愿意为 `xiangsu-mcp-plus-win` 做出贡献！本项目致力于为 Windows 环境下的抖音像塑（Douyin AR）提供安全、受控、遵循最小权限原则的非官方 MCP 桥梁扩展。

为了保证项目的高质量与社区的安全协作，请在提交代码前仔细阅读以下规范。

---

## 一、核心安全红线（不可违背）

本项目服务于特效创作者的学习与辅助制作，必须坚守以下安全与合规底线，任何违背以下红线的代码均会被直接拒绝：

1. **绝对禁止修改或覆盖用户的特效工程**：
   - 默认禁止触碰创作者已有的工程资产；
   - 涉及新建或打开工程操作，必须经过严格的路径白名单（`XIANGSU_ALLOW_PROJECTS`）与黑名单（`XIANGSU_DENY_PROJECTS`）过滤；
   - 新建工程必须核验目录为空，断线时必须执行阶段回滚，防止并发脏写。
2. **严禁代点创作者协议**：
   - 不允许通过自动化手段代用户勾选、同意或静默接受任何创作者协议或平台条款。
3. **严禁代点提交审核与发布**：
   - 扩展能力严格止步于编辑器辅助制作，绝不实现任何代点「提交审核」、「发布特效」或触发付费生成的操作。
4. **强隔离与最小权限通信**：
   - 插件 RPC 仅监听 `127.0.0.1` 环回地址，分配随机端口；
   - 每次握手必须使用独立随机生成的 Bearer Token，并在 Windows 上配置 NTFS DACL 权限收敛（仅属主账户可读写）；
   - 日志与诊断输出必须全面脱敏，严禁泄露 Token。

---

## 二、开发环境准备

- **操作系统**：Windows 10 / 11（推荐用于端到端与 ACL 测试）；macOS / Linux 可用于无依赖单元测试与合同测试。
- **运行环境**：Node.js `>= 22`（开发推荐 Node 22 或 Node 24）。
- **编辑器**：抖音像塑（Douyin AR）Windows 客户端（官方版本如 9.8.3）。

### 获取代码与安装依赖

```bash
git clone https://github.com/wynxing/xiangsu-mcp-plus-win.git
cd xiangsu-mcp-plus-win
npm ci
```

> **注意**：本项目使用 `npm-shrinkwrap.json` 锁定严格依赖。请始终使用 `npm ci` 安装，确保跨平台构建一致性。

---

## 三、测试规范

我们采用 Node.js 原生测试运行器（`node --test`），所有核心逻辑均具备严格的合同测试与安全用例。

```bash
# 运行全部测试
npm test
```

### 测试原则：
1. **测试先行与零回归**：任何新特性或 Bug 修复均需附带对应的测试用例（位于 `test/` 目录下）。
2. **Mock 与环境隔离**：单元测试严禁依赖实际运行中的像塑进程，必须通过依赖注入（如 `discover`, `spawn`, `windowsExe` 等 mock 参数）模拟各种异常状态（无进程、超时、进程复用、权限不足等）。
3. **真实集成测试**：`windows-acl.integration.test.mjs` 等依赖真实 Windows DACL 的测试具备平台探针与 capability-gate 跳过机制，保证在非 Windows CI 环境下平稳跳过。

---

## 四、提交规范 (Conventional Commits)

提交信息请严格遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范，格式如下：

```
<type>(<scope>): <subject>

<body>

Co-authored-by: OpenBot <335604065+openbotgit[bot]@users.noreply.github.com>
```

- **常用类型 (`type`)**：
  - `feat`: 新增特性（例如支持无头冷启动、新增曲库检索等）
  - `fix`: 修复缺陷
  - `test`: 增加或修改测试用例
  - `docs`: 文档完善或修正
  - `refactor`: 重构（既非新增特性亦非修复缺陷的代码重整）
  - `perf`: 性能优化
  - `ci` / `chore`: 构建配置、CI 流程或依赖维护

---

## 五、Pull Request 流程

1. Fork 本仓库并基于 `main` 分支拉取新的特性分支（如 `feat/your-feature-name`）。
2. 在本地编码、撰写单元测试，并确保 `npm test` 全绿通过。
3. 提交代码并推送到个人远程分支。
4. 在 GitHub 发起 Pull Request，按照 [PR 模板](.github/PULL_REQUEST_TEMPLATE.md) 逐项填写变更说明并勾选安全红线检查单。
5. 自动化 GitHub Actions 校验通过后，维护者将进行 Code Review 并合并。
