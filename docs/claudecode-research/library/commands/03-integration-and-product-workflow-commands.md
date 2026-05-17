# 集成与产品工作流命令

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：工作区与会话命令`](./02-workspace-session-and-config-commands.md) | [`下一站：技能与记忆`](../mechanisms/07-skills-and-memory.md)

本文聚焦更“产品级”的命令族：MCP、plugins、memory、skills、review、plan、tasks、remote-setup 等。

## 1. 这些命令不是辅助，而是产品功能入口

相关目录包括：

- `commands/mcp`
- `commands/plugin`
- `commands/memory`
- `commands/skills`
- `commands/review`
- `commands/plan`
- `commands/tasks`
- `commands/remote-setup`

它们的重要性在于：很多高级能力并不是先通过模型自由推理发现的，而是先通过命令进入系统。

## 2. `/init`、`/review`、`/plan` 说明命令可以承载复杂工作流

`/init` 的 prompt 已经显示出这种模式：

- 先问问题
- 再探索代码库
- 再补文档、skill、hook、优化建议

同理，`review`、`plan`、`tasks` 这类命令也不是单步动作，而是产品定义好的工作流入口。

## 3. 集成命令和底层机制的关系

- `mcp` 命令把连接管理、server 配置、授权流程暴露给用户
- `plugin` 命令把插件市场、安装、信任、管理暴露给用户
- `memory` / `skills` 命令把文件型长期能力和知识资产暴露给用户
- `remote-setup` / `bridge` 命令把远端执行面暴露给用户

因此命令层在这里扮演的是“产品控制台”。

## 4. 为什么这层对大模型文档库很重要

如果一个模型只读源码主链而不读这些命令层文档，它会低估 Claude Code 的产品面：

- 以为所有能力都是 tool call 推出来的
- 看不到哪些能力是产品显式提供的 workflow
- 看不到用户如何主动操控这些系统
