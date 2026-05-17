# Swarm Worker Permission Origin / Wait State

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Swarm Inbox Routing / Approval Protocols`](./21-swarm-inbox-routing-and-approval-protocols.md) | [`下一站：Permission Runtime / Hooks / Classifier / Dialog Pipeline`](./23-permission-runtime-hooks-classifier-and-dialog-pipeline.md)

本文继续下钻 swarm permission，但不再讲 mailbox 回执，而是专门拆“worker 侧的 ask-permission 是从哪里起、为什么会先经过 `useCanUseTool` 总入口、process worker 和 in-process teammate 为什么分两条起点、等待 leader 时前台又如何挂状态”的起源层：`useCanUseTool.tsx`、`swarmWorkerHandler.ts`、`inProcessRunner.ts`、`permissionSync.ts`、`AppStateStore.ts`、`REPL.tsx`、`WorkerPendingPermission.tsx`、`AssistantToolUseMessage.tsx`。

## 1. 这层解决的是 ask-permission 从工具调用现场怎样长成 swarm 协议，而不是 leader 端如何回复

源码镜像：[`../../src/hooks/useCanUseTool.tsx`](../../src/hooks/useCanUseTool.tsx), [`../../src/hooks/toolPermission/handlers/swarmWorkerHandler.ts`](../../src/hooks/toolPermission/handlers/swarmWorkerHandler.ts), [`../../src/utils/swarm/inProcessRunner.ts`](../../src/utils/swarm/inProcessRunner.ts), [`../../src/utils/swarm/permissionSync.ts`](../../src/utils/swarm/permissionSync.ts), [`../../src/state/AppStateStore.ts`](../../src/state/AppStateStore.ts), [`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx), [`../../src/components/permissions/WorkerPendingPermission.tsx`](../../src/components/permissions/WorkerPendingPermission.tsx), [`../../src/components/messages/AssistantToolUseMessage.tsx`](../../src/components/messages/AssistantToolUseMessage.tsx)

前一篇 `mechanisms/21` 已经把 inbox router、permission response、sandbox queue、plan/shutdown cleanup 拆明白了。这里继续回答更靠前的问题：

- tool 调用最早在哪一层决定“这是 swarm worker ask，不是普通 interactive ask”
- process worker 和 in-process teammate 为什么不是同一条 permission 起点
- `pendingWorkerRequest` 为什么能同时影响 tab status、permission dialog、tool-use progress 行

所以这篇是 swarm permission 的 origin layer。

## 2. `useCanUseTool()` 是所有 tool permission 路由的总闸，不是 swarm 的专用入口

源码镜像：[`../../src/hooks/useCanUseTool.tsx`](../../src/hooks/useCanUseTool.tsx)

这层先统一做三件事：

- `hasPermissionsToUseTool(...)`
- 为 deny/allow/ask 建立统一 `PermissionContext`
- 在 ask 分支上按顺序尝试不同 handler

真正的顺序是：

1. `handleCoordinatorPermission(...)`
2. `handleSwarmWorkerPermission(...)`
3. speculative bash classifier grace period
4. `handleInteractivePermission(...)`

这说明 swarm worker ask-permission 不是旁路，而是正式插在全局 permission pipeline 里的第二阶段。

## 3. `handleSwarmWorkerPermission()` 只在 “agent swarms enabled + isSwarmWorker()” 时接管，说明 swarm ask 是角色化分叉

源码镜像：[`../../src/hooks/toolPermission/handlers/swarmWorkerHandler.ts`](../../src/hooks/toolPermission/handlers/swarmWorkerHandler.ts), [`../../src/utils/swarm/permissionSync.ts`](../../src/utils/swarm/permissionSync.ts)

它一开始就要求：

- `isAgentSwarmsEnabled()`
- `isSwarmWorker()`

否则返回 `null`，让调用方落回普通 interactive handling。

这说明 same tool permission prompt 在 Claude Code 里不是单一路径，而是按当前执行身份分流；只有 process-based swarm worker 才会走 mailbox-forward 这条 ask path。

## 4. bash classifier 在 swarm worker 路径里仍然优先，说明 leader 不会被无意义的低风险 ask 打断

源码镜像：[`../../src/hooks/toolPermission/handlers/swarmWorkerHandler.ts`](../../src/hooks/toolPermission/handlers/swarmWorkerHandler.ts), [`../../src/tools/BashTool/bashPermissions.ts`](../../src/tools/BashTool/bashPermissions.ts)

`swarmWorkerHandler` 的第一步不是立刻发 mailbox，而是：

- 如果 feature `BASH_CLASSIFIER`
- 并且有 `pendingClassifierCheck`
- 先 `await ctx.tryClassifier(...)`

一旦 classifier 给出 allow，就直接返回 `PermissionDecision`。

这说明 swarm worker 模型不是“凡是 ask 都交给 leader”，而是“能自动批准的先本地批准，只把 unresolved ask 升级到 leader”。

## 5. process worker 的 ask-permission 是“注册 callback 再发请求”，说明代码优先防 race，不优先发消息

源码镜像：[`../../src/hooks/toolPermission/handlers/swarmWorkerHandler.ts`](../../src/hooks/useSwarmPermissionPoller.ts)

这条链的关键顺序是：

1. `createPermissionRequest(...)`
2. `registerPermissionCallback(...)`
3. `sendPermissionRequestViaMailbox(request)`
4. `setAppState(...pendingWorkerRequest...)`

源码注释直接说明这样做是为了避免：

- leader 回复比 callback 注册更早

所以这里真正优先的是响应闭环完整性，不是最早把 request 发出去。

## 6. `createPermissionRequest()` 说明 worker ask 被序列化成一份稳定协议对象，而不是临时 UI 事件

源码镜像：[`../../src/utils/swarm/permissionSync.ts`](../../src/utils/swarm/permissionSync.ts)

这份请求会固定带上：

- `workerId`
- `workerName`
- `workerColor`
- `teamName`
- `toolName`
- `toolUseId`
- `description`
- `input`
- `permissionSuggestions`
- `status: 'pending'`
- `createdAt`

这说明 worker ask 从起点开始就被设计成 durable request object，而不是“前台弹个框，后端顺便发个消息”。

## 7. `pendingWorkerRequest` 说明 process worker 在等待 leader 时会把 ask 状态显式写进全局 AppState

源码镜像：[`../../src/hooks/toolPermission/handlers/swarmWorkerHandler.ts`](../../src/hooks/toolPermission/handlers/swarmWorkerHandler.ts), [`../../src/state/AppStateStore.ts`](../../src/state/AppStateStore.ts)

等待态字段非常小：

- `toolName`
- `toolUseId`
- `description`

但它的作用很重，因为这意味着 worker waiting-for-approval 不是 promise 内部私有状态，而是进入了 REPL 全局状态树。

## 8. `pendingWorkerRequest` 不只是装饰，它会直接改 `sessionStatus` 和 `waitingFor`

源码镜像：[`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx)

REPL 会把这些合起来计算：

- `isWaitingForApproval = ... || pendingWorkerRequest || pendingSandboxRequest`
- `sessionStatus = 'waiting'`
- `waitingFor = 'worker request'`

这说明 worker ask-permission 不是某块局部 UI 的 spinner，而是会把整个 session 从 busy/idle 切成 waiting。

## 9. `WorkerPendingPermission` 说明 process worker 等待 leader 时会有专门的本地等待壳，而不是只在 transcript 里静默卡住

源码镜像：[`../../src/components/permissions/WorkerPendingPermission.tsx`](../../src/components/permissions/WorkerPendingPermission.tsx), [`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx)

这个组件会显示：

- spinner
- `Waiting for team lead approval`
- 当前 worker badge
- `Tool:` 与 `Action:` 明细
- `Permission request sent to team "{team}" leader`

这说明 worker 侧等待态被明确产品化了：它不是网络请求中的无 UI 间隙，而是一块正式的 REPL surface。

## 10. `AssistantToolUseMessage` 也消费 `pendingWorkerRequest.toolUseId`，说明等待态会回流到具体的 tool-use block

源码镜像：[`../../src/components/messages/AssistantToolUseMessage.tsx`](../../src/components/messages/AssistantToolUseMessage.tsx)

这里会算：

- `isWaitingForPermission = pendingWorkerRequest?.toolUseId === param.id`

这说明等待 leader 审批的状态不只体现在全局 REPL 框，也会反向标记到对应的 assistant tool use message，让用户知道究竟是哪一个 tool call 卡在 leader approval 上。

## 11. process worker 路径的 abort 语义是“清等待态 + 取消 promise”，说明 permission wait 被视为可中断工作

源码镜像：[`../../src/hooks/toolPermission/handlers/swarmWorkerHandler.ts`](../../src/hooks/toolPermission/PermissionContext.ts)

这条路里会：

- 监听 `abortController.signal`
- 一旦 abort，先 `clearPendingRequest()`
- 记 cancellation
- `resolveOnce(ctx.cancelAndAbort(...))`

这说明 swarm worker ask-permission 并不是 leader 一旦收到就一定要等到底；worker 自己的执行中断会主动把本地等待链收掉。

## 12. in-process teammate 的 permission 起点不走 `swarmWorkerHandler`，而是 `createInProcessCanUseTool()`

源码镜像：[`../../src/utils/swarm/inProcessRunner.ts`](../../src/utils/swarm/inProcessRunner.ts)

这是另一条完全不同的起点：

- 只给 in-process teammate 用
- 先 `hasPermissionsToUseTool(...)`
- ask 时优先走 leader 的 `ToolUseConfirm` 桥
- bridge 缺席时才退回 mailbox request/response

这说明 in-process teammate 不是 `isSwarmWorker()` 的特殊分支，而是另一套 origin path：它尽可能直接复用 leader REPL，而不是先走 process worker 的邮箱式等待壳。

## 13. in-process teammate 的标准路径不是 `pendingWorkerRequest`，而是 leader 的 `ToolUseConfirmQueue`

源码镜像：[`../../src/utils/swarm/inProcessRunner.ts`](../../src/utils/swarm/leaderPermissionBridge.ts)

只要 `getLeaderToolUseConfirmQueue()` 可用，它就会：

- 构造带 `workerBadge` 的 `ToolUseConfirm`
- 塞进 leader 的标准 permission queue
- 支持 `onAllow / onReject / onAbort / recheckPermission`

因此 in-process teammate ask-permission 在产品面上更像“leader 自己的一个带 badge 的工具请求”，而不是“远端 worker 的外部请求”。

## 14. in-process teammate 的 mailbox fallback 仍然存在，说明 leader UI bridge 只是优化路径，不是唯一前提

源码镜像：[`../../src/utils/swarm/inProcessRunner.ts`](../../src/hooks/useSwarmPermissionPoller.ts)

如果 leader queue 不可用，它会退回到：

- `createPermissionRequest(...)`
- `registerPermissionCallback(...)`
- `sendPermissionRequestViaMailbox(request)`
- 本地 `setInterval` 轮询自己 mailbox
- 读到 `permission_response` 后 `processMailboxPermissionResponse(...)`

这说明即便是 in-process teammate，底层仍然保留 mailbox protocol；leader bridge 只是首选，不是硬依赖。

## 15. process worker 与 in-process teammate 的分歧，本质上是“谁拥有最短权限回路”的分歧

源码镜像：[`../../src/hooks/toolPermission/handlers/swarmWorkerHandler.ts`](../../src/hooks/toolPermission/handlers/swarmWorkerHandler.ts), [`../../src/utils/swarm/inProcessRunner.ts`](../../src/utils/swarm/inProcessRunner.ts)

两条起点最核心的差异是：

- process worker：`callback registry -> mailbox request -> pendingWorkerRequest -> leader reply`
- in-process teammate：`leader ToolUseConfirm queue -> immediate shared-state callback`

前者优先稳定跨进程；后者优先最短 UI 闭环。

所以它们不是“同一协议的两个实现细节”，而是两种不同的 permission-origin topology。

## 16. 这条机制最终说明 swarm permission 的真正起源层由四段拼起来

源码镜像：[`../../src/hooks/useCanUseTool.tsx`](../../src/hooks/useCanUseTool.tsx), [`../../src/hooks/toolPermission/handlers/swarmWorkerHandler.ts`](../../src/hooks/toolPermission/handlers/swarmWorkerHandler.ts), [`../../src/utils/swarm/inProcessRunner.ts`](../../src/utils/swarm/inProcessRunner.ts), [`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx), [`../../src/components/permissions/WorkerPendingPermission.tsx`](../../src/components/permissions/WorkerPendingPermission.tsx)

真正叠在一起工作的是：

- 总入口：`useCanUseTool()`
- process worker ask 起点：`handleSwarmWorkerPermission()`
- in-process teammate ask 起点：`createInProcessCanUseTool()`
- 等待态表面：`pendingWorkerRequest -> REPL -> WorkerPendingPermission -> AssistantToolUseMessage`

因此 Claude Code 的 swarm permission 并不是“有 mailbox 回执就行”，而是从工具调用当场开始，就已经按执行拓扑分成了两条起点，并且把等待态明确写回了前台和 session 状态机。
