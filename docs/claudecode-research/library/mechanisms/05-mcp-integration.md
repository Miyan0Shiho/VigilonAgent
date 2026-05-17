# MCP 集成机制

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：权限、Hooks 与 Policy`](./04-permissions-hooks-and-policy.md) | [`下一站：任务、子代理与后台`](./06-tasks-subagents-and-background.md)

本文聚焦 Claude Code 如何把 MCP 接成动态工具面，而不是静态外挂。

## 1. MCP 不只是“多几个工具”

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/client.ts)

单看 `client.ts` 的结构就能看出 MCP 至少涵盖：

- transport 建连
- auth / OAuth / token cache
- timeout / retry / reconnect
- server cache
- tools / resources / commands 三类能力抓取
- URL elicitation retry
- 工具描述清洗与名称规范化

这不是简单“请求一次 `listTools`”的轻封装。

## 2. Claude Code 把 MCP 拆成三类对象

从 `fetchToolsForClient`、`fetchResourcesForClient`、`fetchCommandsForClient` 可以看出，MCP 在 Claude Code 里至少分成：

- 可直接调用的工具
- 可枚举并读取的资源
- 可转成 prompt / slash command 的命令

也就是说，MCP server 并不是只扩展一个平面，而是在扩展 Claude Code 的多个能力层。

## 3. 为什么要有连接缓存与重连

`connectToServer()`、`ensureConnectedClient()`、`clearServerCache()` 这些接口表明：

- MCP 连接不是一次性对象
- 某些 server 会话可以失效、断开或需要认证刷新
- 工具调用期仍可能触发重新连接

因此 MCP 在 Claude Code 里是“动态连接资源”，而不是“启动时读完配置就结束”。

## 4. 为什么 MCP 必须和权限、工具池、UI 都耦合

它同时影响：

- 最终可见工具池
- prompt 中的可用能力描述
- UI 中的授权 / elicitation 流程
- 工具调用期的错误恢复与重试

如果把 MCP 只看成外部 provider，很容易低估它在整条 agent loop 中的侵入程度。
