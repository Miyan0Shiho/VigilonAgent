# 用户 03：扩展与生态开发者

## 目标

- 把团队自己的流程、工具和外部系统接入 Claude Code，而不是把 Claude Code 当封闭产品使用。
- 在不改内核的前提下，扩展技能、subagents、MCP servers、hooks 与 plugins。
- 让扩展既能自动触发，又不会把主会话上下文和权限边界弄乱。

## 主要能力

- 通过 skills 封装重复流程，通过 hooks 把确定性动作外置，通过 MCP 接外部系统，通过 agents/subagents 把任务拆分为专门 worker。
- 在 agent frontmatter 中声明 `skills`、`mcpServers`、`hooks`、`memory`、`background`、`isolation` 等属性，控制扩展执行环境。
- 在 settings 中限制扩展来源、允许的 MCP server、managed-only hooks 或 permission rules，实现“可扩展但可治理”。

## 关键摩擦

- 扩展面很多，能力边界并不天然清晰：skill、hook、MCP、plugin、agent 都能改变行为，但改变的位置和时机不同。
- 扩展越多，越依赖上下文成本治理；官方文档强调 skills/subagents 有利于 context control，但实际设计仍要求作者理解何时 inline、何时 fork、何时 background。
- 企业环境下，扩展开发者经常会遇到 managed policy 与本地实验冲突，调试成本高。
- 扩展一旦涉及权限模式、远端执行或 side effects，就必须同时理解 hooks、permission rules 与 transcript 行为，否则很难稳定发布。

## 关键源码支撑

- `packages/claude-code/src/tools/AgentTool/loadAgentsDir.ts`：agent frontmatter 能声明 `mcpServers`、`hooks`、`skills`、`memory`、`background`、`isolation`。
- `packages/claude-code/src/utils/hooks/hooksConfigManager.ts`：hook event 与 matcher 体系。
- `packages/claude-code/src/tools.ts`：built-in tool 与 MCP tool 的合流点。
- `packages/claude-code/src/Tool.ts`：扩展最终汇入 `ToolUseContext`。
- 官方 `skills`、`sub-agents`、`hooks`、`settings` 文档：定义扩展作者需要遵守的公开接口语义。

## 对 Vigilon 的启发

- 扩展生态要优先设计“职责分工图”：什么该用 skill，什么该用 hook，什么该用 MCP，什么该用 agent。
- 若没有清晰的扩展分层，生态会迅速变成互相覆盖、难以审计、难以调试的黑箱系统。
- 平台能力要与治理能力同步发布，否则企业会把扩展视为风险源，而不是增益源。
