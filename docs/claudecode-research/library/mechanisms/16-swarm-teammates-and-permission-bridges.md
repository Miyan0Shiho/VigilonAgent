# Swarm、Teammates 与 Permission Bridges

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Review / GitHub Workflow Integration`](./15-review-and-github-workflow-integration.md) | [`下一站：产品卷`](../product/01-positioning-and-surface.md)

本文把 Claude Code 里分散在 task、permission、mailbox、spinner、hook 和 spawn backend 里的 swarm teammate 机制单独拆成一卷，说明它不是“多开几个 agent”而已，而是一套带身份注入、执行隔离、消息投递、权限回传、空闲钩子和前台漫游的多代理运行时。

## 1. swarm runtime 不是 AgentTool 的附属，而是一套独立的并发执行层

源码镜像：[`../../src/utils/swarm/spawnInProcess.ts`](../../src/utils/swarm/spawnInProcess.ts), [`../../src/utils/swarm/inProcessRunner.ts`](../../src/utils/swarm/inProcessRunner.ts), [`../../src/utils/teammate.ts`](../../src/utils/teammate.ts)

从这些文件可以看出，Claude Code 把 swarm teammate 运行时拆成了至少三层：

- 身份层：这个 agent 到底是谁、属于哪个 team、是否必须先进 plan mode
- 执行层：它是 tmux teammate、iTerm teammate，还是 in-process teammate
- 协调层：权限、mailbox、idle hooks、leader/worker UI 如何回流

因此 “multi-agent” 在 Claude Code 里不是一个单工具，而是一整条 runtime。

## 2. teammate 身份解析有明确优先级，而不是散落在 env 里

源码镜像：[`../../src/utils/teammate.ts`](../../src/utils/teammate.ts), [`../../src/utils/teammateContext.ts`](../../src/utils/teammateContext.ts)

身份解析优先级是：

1. `AsyncLocalStorage` 里的 `TeammateContext`
2. `dynamicTeamContext`
3. 某些 leader 场景下显式传入的 teamContext

`teammate.ts` 统一暴露了：

- `getAgentId()`
- `getAgentName()`
- `getTeamName()`
- `getTeammateColor()`
- `isTeammate()`
- `isPlanModeRequired()`
- `getParentSessionId()`

这意味着 swarm 相关代码不应该自己乱读 env 或 CLI 参数，而是都经过同一层身份解析器。

## 3. `TeammateContext` 是 in-process teammate 的隔离内核

源码镜像：[`../../src/utils/teammateContext.ts`](../../src/utils/teammateContext.ts)

`TeammateContext` 里装的不是 UI 数据，而是运行时最小闭环：

- `agentId`
- `agentName`
- `teamName`
- `color`
- `planModeRequired`
- `parentSessionId`
- `abortController`
- `isInProcess: true`

`runWithTeammateContext()` 用 `AsyncLocalStorage` 把这份身份注入执行路径。这使得多个 in-process teammate 共处同一 Node 进程时，不会因为全局状态冲突而串身份。

## 4. in-process teammate 不是 leader query 的子中断，而是独立生命周期任务

源码镜像：[`../../src/utils/swarm/spawnInProcess.ts`](../../src/utils/swarm/spawnInProcess.ts)

`spawnInProcessTeammate()` 的关键设计是：

- 生成稳定 `agentId`
- 创建独立 `AbortController`
- 记录 `parentSessionId` 用于 transcript 关联
- 生成 `InProcessTeammateTaskState`
- 立刻注册到 AppState task 框架

源码注释明确写了：teammates should not be aborted when the leader's query is interrupted。也就是说它不是 leader 当前一轮推理的“协程”，而是一个被正式建模成 task 的长期执行单元。

## 5. `InProcessTeammateTaskState` 已经把产品语义编码进任务状态

源码镜像：[`../../src/utils/swarm/spawnInProcess.ts`](../../src/utils/swarm/spawnInProcess.ts)

注册进去的 task state 不只保存 prompt，还直接带了：

- `permissionMode`
- `awaitingPlanApproval`
- `isIdle`
- `shutdownRequested`
- `pendingUserMessages`
- `messages`
- `spinnerVerb` / `pastTenseVerb`

这说明 swarm teammate 在 Claude Code 里不是普通后台任务，而是专门的 agent task 类型，连 spinner 叙事和 plan approval 等产品状态都写进了 task 协议。

## 6. `inProcessRunner` 是真正把 teammate 变成可运行 agent 的执行壳

源码镜像：[`../../src/utils/swarm/inProcessRunner.ts`](../../src/utils/swarm/inProcessRunner.ts)

这层不是简单调用 `runAgent()`，而是额外承担：

- `runWithTeammateContext()` 身份隔离
- progress tracker 和 AppState 增量回写
- mailbox 消息读取与标记
- permission wait 时间扣除
- auto compact / microcompact 接缝
- task 认领与 task 列表同步
- teammate idle / shutdown / message preview 状态维护

所以 teammate 执行层并不是 AgentTool 直接复用，而是有自己的一套外围控制壳。

## 7. mailbox 是 swarm 的文件级消息总线，不是 UI 提示层

源码镜像：[`../../src/utils/teammateMailbox.ts`](../../src/utils/teammateMailbox.ts)

mailbox 结构是：

- `~/.claude/teams/{team}/inboxes/{agent}.json`

并且提供了：

- `readMailbox()`
- `readUnreadMessages()`
- `writeToMailbox()`
- `markMessageAsReadByIndex()`

写入时还用了 lockfile 重试预算，说明这不是松散日志，而是明确面向并发 swarm 的消息通道。

## 8. mailbox 的 key 不是 agent ID，而是 agent name

源码镜像：[`../../src/utils/teammateMailbox.ts`](../../src/utils/teammateMailbox.ts)

文件注释直接说：inboxes are keyed by agent name within a team。

这意味着 mailbox 路由依赖的是：

- team 内 agent name 唯一性
- team 目录命名空间隔离

所以 swarm 的通信模型不是全局 UUID message bus，而是“team namespace + human-readable agent name”。

## 9. worker 权限请求默认不是本地弹框，而是 leader 协调流

源码镜像：[`../../src/hooks/toolPermission/handlers/swarmWorkerHandler.ts`](../../src/hooks/toolPermission/handlers/swarmWorkerHandler.ts), [`../../src/utils/swarm/permissionSync.ts`](../../src/utils/swarm/permissionSync.ts)

`handleSwarmWorkerPermission()` 说明 worker 权限流是：

1. 先尝试 bash classifier auto-approval
2. 不通过时，创建 `SwarmPermissionRequest`
3. 通过 mailbox 发给 leader
4. 注册 callback 等 leader 回复
5. 在 AppState 里显示 `pendingWorkerRequest`

这意味着 worker 默认没有独立最终裁决权，它的 ask-permission 行为会被升级成 leader-facing governance flow。

## 10. `SwarmPermissionRequest` 已经是一份稳定协议，而不是临时对象

源码镜像：[`../../src/utils/swarm/permissionSync.ts`](../../src/utils/swarm/permissionSync.ts)

这份 schema 里包含：

- `id`
- `workerId` / `workerName` / `workerColor`
- `teamName`
- `toolName`
- `toolUseId`
- `description`
- `input`
- `permissionSuggestions`
- `status`
- `resolvedBy`
- `feedback`
- `updatedInput`
- `permissionUpdates`

而且 pending / resolved 目录也是显式建模的。这说明 leader-worker 权限协调不是一次性消息，而是可落盘、可重读、可审计的 swarm 子协议。

## 11. in-process teammate 优先走 leader 的标准 ToolUseConfirm UI，而不是 mailbox fallback

源码镜像：[`../../src/utils/swarm/inProcessRunner.ts`](../../src/utils/swarm/inProcessRunner.ts), [`../../src/utils/swarm/leaderPermissionBridge.ts`](../../src/utils/swarm/leaderPermissionBridge.ts)

`createInProcessCanUseTool()` 的标准路径是：

- 从 `leaderPermissionBridge` 取到 `setToolUseConfirmQueue`
- 把 worker 的请求塞进 leader 的标准 ToolUseConfirm 队列
- 同时附带 `workerBadge`

只有 bridge 不可用时，才退回 mailbox permission flow。

这说明 Claude Code 对 in-process teammate 的目标不是“另做一套权限 UI”，而是让 worker 尽量复用 leader 的原生工具权限界面。

## 12. `leaderPermissionBridge` 是 React UI 与非 React runner 之间的接缝

源码镜像：[`../../src/utils/swarm/leaderPermissionBridge.ts`](../../src/utils/swarm/leaderPermissionBridge.ts)

这个桥非常小，但很关键。它把两类 setter 暴露成模块级注册表：

- `setToolUseConfirmQueue`
- `setToolPermissionContext`

这样非 React 的 in-process runner 也能把权限请求推回 leader 的 REPL 状态树。它本质上是 swarm runtime 穿越 React 边界的治理接缝。

## 13. stop hooks 之后还有 teammate 专属的 `TaskCompleted` 和 `TeammateIdle` 钩子

源码镜像：[`../../src/query/stopHooks.ts`](../../src/query/stopHooks.ts)

普通 stop hooks 跑完后，如果当前会话是 teammate，还会继续做两件事：

- 对当前 teammate owner 的 in-progress tasks 运行 `TaskCompleted` hooks
- 运行 `TeammateIdle` hooks

而且它们同样能：

- 产出 progress message
- 产出 blocking error
- `preventContinuation`
- 生成 `hook_stopped_continuation` attachment

这说明 teammate 的“空闲”不是简单 UI 状态，而是被正式接进 hook 生命周期的工作流事件。

## 14. teammate view 不是只看 spinner，而是完整的 transcript retain / evict 机制

源码镜像：[`../../src/state/teammateViewHelpers.ts`](../../src/state/teammateViewHelpers.ts)

`enterTeammateView()` 和 `exitTeammateView()` 做的不只是切视图：

- 设置 `viewingAgentTaskId`
- 对本地 agent task 打 `retain: true`
- 关闭 `evictAfter`
- 切换离开时把旧任务释放回 stub form

这说明前台漫游到 teammate transcript 时，Claude Code 会显式阻止该 transcript 被磁盘逐出，而不是纯 UI 层切一个 tab。

## 15. `stopOrDismissAgent()` 暗示 swarm 视图同时承担“控制面”职责

源码镜像：[`../../src/state/teammateViewHelpers.ts`](../../src/state/teammateViewHelpers.ts)

这里的 `x` 操作是上下文敏感的：

- running -> `abort`
- terminal -> `dismiss`

并且如果正在看被 dismiss 的 agent，还会自动退回 leader view。也就是说 teammate foreground view 不是只读观察面，而是带运行控制语义的操作面。

## 16. 这条 swarm runtime 的真实闭环应该这样理解

源码镜像：[`../../src/utils/teammate.ts`](../../src/utils/teammate.ts), [`../../src/utils/swarm/spawnInProcess.ts`](../../src/utils/swarm/spawnInProcess.ts), [`../../src/utils/swarm/inProcessRunner.ts`](../../src/utils/swarm/inProcessRunner.ts), [`../../src/utils/teammateMailbox.ts`](../../src/utils/teammateMailbox.ts), [`../../src/utils/swarm/permissionSync.ts`](../../src/utils/swarm/permissionSync.ts), [`../../src/query/stopHooks.ts`](../../src/query/stopHooks.ts), [`../../src/state/teammateViewHelpers.ts`](../../src/state/teammateViewHelpers.ts)

可以压成七步：

1. leader 决定要不要生成 teammate
2. spawn 层创建 identity、abort controller 和 teammate task
3. runner 在 AsyncLocalStorage 身份下执行 agent loop
4. mailbox 负责 direct message 与部分异步协调
5. permission sync 把 worker ask 升级成 leader governance
6. stop hooks 把 teammate idle / task completed 接进生命周期
7. foreground view 允许用户回到某个 teammate transcript 并控制它

这已经不是“多代理 support”，而是一套可持续运行的 team runtime。

## 17. 为什么这块值得单独成卷

如果不把 swarm runtime 单独拆出来，就很容易误以为 Claude Code 的多代理只是：

- AgentTool 多调几次
- spinner 多几行
- task 多几条记录

但源码表明它至少多了一整套：

- teammate 身份解析协议
- in-process 执行隔离
- 文件级 mailbox 总线
- leader-worker 权限桥
- teammate idle / task completed hooks
- transcript retain / evict 与 foreground 漫游

所以 swarm teammate 已经是 Claude Code 内部一条成熟的功能子系统，不应再被埋在 task 或 permission 总述里。
