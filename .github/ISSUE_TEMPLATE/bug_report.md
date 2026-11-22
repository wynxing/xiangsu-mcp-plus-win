---
name: Bug Report
about: 提交一个 Bug 报告以帮助我们改进 xiangsu-mcp-plus-win
title: '[Bug]: '
labels: ['bug']
assignees: ''
---

## 问题描述
清晰简洁地描述遇到的问题。

## 环境信息
- **操作系统版本** (例如 Windows 11 23H2 / Windows 10 22H2):
- **像塑版本** (例如 9.8.3):
- **Node.js 版本** (`node -v`，要求 >= 22):
- **xiangsu-mcp-plus-win 版本** (例如 0.1.11):
- **MCP 客户端** (Claude Desktop / Cursor / Windsurf / 其他):

## 诊断信息（关键）
请在问题发生后，调用 `ext_status` 工具并在此粘贴返回内容（敏感信息已被自动脱敏）：
```json
// 在此粘贴 ext_status 输出
```

## 复现步骤
1. 打开像塑...
2. 执行操作...
3. 观察到...

## 预期行为
描述你期望发生的事情。

## 实际行为
描述实际发生的事情，包括任何错误输出或日志。

## 相关日志
如果状态目录 `%USERPROFILE%\.xiangsu-mcp-plus-win\logs\` 中有相关日志（`stdio.log` / `plugin.log`），请附在下方（已自动排除 Token）：
```text
// 日志片段
```

## 补充信息
关于此问题的任何其他上下文或截图。
