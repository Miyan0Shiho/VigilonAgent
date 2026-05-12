# Claude Code V2 研究图谱索引

本目录包含了 Claude Code 深度研究 V2 库的所有学术风 SVG 图谱。

## 核心图谱列表 (01-10)

| 编号 | 图谱名称 | 描述 | 关键源码符号 |
| :--- | :--- | :--- | :--- |
| 01 | [Product Surface](./01-product-surface.svg) | Claude Code 产品表面与核心组件交互总览 | CLI, Subagents, MCP, Skills |
| 02 | [CLI Dispatch](./02-cli-dispatch.svg) | CLI 入口的多路 fast-path 分发逻辑 | `cli.tsx:main()`, `cliMain()` |
| 03 | [Main Bootstrap](./03-main-bootstrap.svg) | 系统启动与 QueryEngine 装配序列 | `main.tsx`, `QueryEngine` |
| 04 | [Query Kernel](./04-query-kernel.svg) | 核心 Agent Loop (queryLoop) 状态机 | `query()`, `queryLoop()` |
| 05 | [Process User Input](./05-process-user-input.svg) | 用户输入预处理、Slash 命令与提交流 | `processUserInput()` |
| 06 | [ToolUseContext](./06-tool-use-context.svg) | 跨工具共享的状态上下文结构 | `ToolUseContext`, `readFileState` |
| 07 | [Permission Boundary](./07-permission-boundary.svg) | 权限检查与企业策略边界 | `canUseTool()`, `isPolicyAllowed()` |
| 08 | [Session Lifecycle](./08-session-lifecycle.svg) | 会话生命周期与持久化存储 | `sessionStorage.ts`, `JSONL Transcript` |
| 09 | [User Roles](./09-user-roles.svg) | 终端用户、团队管理员与开发者角色能力图 | Roles, Capabilities |
| 10 | [Doc-to-Runtime Map](./10-doc-to-runtime-map.svg) | 文档卷册与运行时组件的映射关系 | Doc Layers, Symbols |

## 设计规范

- **风格**: 学术风 (Nature/Science Style)
- **背景**: 纯白 (#FFFFFF)
- **配色**: Okabe-Ito 色盲友好色板
- **字体**: 无衬线字体 (Arial/Helvetica)
- **对齐**: 符号名严格对齐源码实现
