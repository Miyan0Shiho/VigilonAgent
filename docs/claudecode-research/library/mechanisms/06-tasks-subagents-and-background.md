# 任务、子代理与后台执行

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：MCP`](./05-mcp-integration.md) | [`下一站：架构总卷`](../architecture/01-04.md)

本文聚焦 Claude Code 如何把“长时间执行”和“多代理委派”变成任务系统，而不是一次性函数调用。

## 1. AgentTool 是委派入口，不是普通工具

源码镜像：[`../../src/tools/AgentTool/AgentTool.tsx`](../../src/tools/AgentTool/AgentTool.tsx)

从 imports 和 schema 可以看出，AgentTool 同时接入：

- 本地 agent task
- remote agent task
- async agent lifecycle
- worktree 隔离
- remote 隔离
- teammate / swarm
- session metadata
- tool pool 继承

这说明 AgentTool 的职责不是“再开一次 query”，而是“创建一个新的执行单元并管理它的生命周期”。

## 2. `run_in_background` 只是表面参数

真正复杂的是后台化后的承接链：

- 注册 task
- 写 output file
- 持续更新 progress
- 完成或失败时发通知
- 允许后续 `TaskGet` / `TaskList` / `TaskOutput` / `TaskStop`

这也是为什么后台执行能力必须和任务系统一起理解。

## 3. LocalShellTask 与 RemoteAgentTask 分别解决什么

从 `tasks/LocalShellTask/LocalShellTask.tsx` 和 `tasks/RemoteAgentTask/RemoteAgentTask.tsx` 可见：

- LocalShellTask 负责本地 bash / powershell 的长命令承接、stall watchdog、通知与背景化
- RemoteAgentTask 负责远端 session polling、事件增量拉取、review / ultraplan 提取、超时和完成判断

所以 Claude Code 的任务系统不是单一抽象，而是按执行面拆成多个专门实现。

## 4. 为什么这层和 sessionStorage 强耦合

任务、子代理和后台执行都依赖：

- transcript 分流
- agent metadata
- 恢复时重新挂回 app state

否则 session 恢复后只能看到“曾经有个任务”，却无法继续关联它的输出、状态和 UI 表示。
