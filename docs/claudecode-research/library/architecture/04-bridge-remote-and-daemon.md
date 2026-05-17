# Bridge、Remote 与 Daemon

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：REPL 与 UI`](./03-repl-and-ui-runtime.md) | [`下一站：输入预处理`](../implementation/02-input-processing-and-command-dispatch.md)

本文聚焦非本地单会话模式：bridge、remote-control、daemon、background session 和远端执行面的关系。

## 1. Bridge 入口为什么重要

源码镜像：[`../../src/bridge/bridgeMain.ts`](../../src/bridge/bridgeMain.ts)

Bridge 不是简单“远程 shell 代理”，而是一整套环境承载层：

- 维护环境实例与 work item 生命周期
- 生成和管理 session
- 处理 token 刷新、heartbeat、polling、backoff
- 管理 active sessions、session worktrees、completed work ids
- 在超时、网络失败、认证失败时做恢复或重连

这说明 Claude Code 的 remote-control 不是“把本地 REPL 搬远端”，而是有独立的运行与恢复语义。

## 2. `runBridgeLoop()` 在做什么

`runBridgeLoop()` 是 bridge 的核心：

- 持续轮询待处理工作
- 为工作分配或重连 session
- 为活跃工作发 heartbeat
- 追踪 session 与 work item 映射
- 在 session 完成、失败或超时时回收资源

这让 bridge 更像一个轻量 supervisor + session router。

## 3. Daemon 与 Background Session 的关系

`cli.tsx` 里可以看到 daemon 与 background sessions 是单独分流出来的路径。

它们对应的目标不是“另一个 UI”，而是：

- 让会话脱离当前终端长期运行
- 允许 `ps`、`logs`、`attach`、`kill` 等外部控制
- 让自动化和弱交互场景不必一直挂着 REPL

所以 Claude Code 的 session 模型天然不是一次性前台对话，而是可脱离、可恢复、可巡检的工作单元。

## 4. Remote / Background 为什么是一级能力

从代码组织看，remote 相关逻辑并不是零散附着在 BashTool 或 QueryEngine 上，而是贯穿：

- CLI 分流
- bridge / daemon runtime
- task system
- session storage
- remote agent restore

这意味着“远端运行”是产品能力，不是边角插件。

## 5. 应该和哪些文档联读

- 想看任务和远端 agent 如何落地：读 [`../mechanisms/06-tasks-subagents-and-background.md`](../mechanisms/06-tasks-subagents-and-background.md)
- 想看 transcript 与恢复：读 [`../implementation/04-session-storage-and-resume.md`](../implementation/04-session-storage-and-resume.md)
