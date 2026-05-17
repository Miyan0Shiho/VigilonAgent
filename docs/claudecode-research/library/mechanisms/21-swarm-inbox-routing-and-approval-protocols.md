# Swarm Inbox Routing / Approval Protocols

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Bridge Transport / Auth / Session Identity`](./20-bridge-transport-auth-and-session-identity.md) | [`下一站：Swarm Worker Permission Origin / Wait State`](./22-swarm-worker-permission-origin-and-wait-state.md)

本文继续下钻 swarm，但不再讲 teammate spawn、banner 或 transcript surface，而是专门拆“mailbox 里的 structured protocol message 如何被 `useInboxPoller` 分流、leader/worker 两边怎样互相回执、shutdown/plan/mode/sandbox request 怎样写回运行时”的协议层：`useInboxPoller.ts`、`useSwarmPermissionPoller.ts`、`teammateMailbox.ts`、`permissionSync.ts`、`inProcessTeammateHelpers.ts`。

## 1. 这层解决的是 swarm mailbox 怎么从“消息文件”升级成“协议总线”

源码镜像：[`../../src/hooks/useInboxPoller.ts`](../../src/hooks/useInboxPoller.ts), [`../../src/hooks/useSwarmPermissionPoller.ts`](../../src/hooks/useSwarmPermissionPoller.ts), [`../../src/utils/teammateMailbox.ts`](../../src/utils/teammateMailbox.ts), [`../../src/utils/swarm/permissionSync.ts`](../../src/utils/swarm/permissionSync.ts), [`../../src/utils/inProcessTeammateHelpers.ts`](../../src/utils/inProcessTeammateHelpers.ts)

前几卷已经把这些讲清了：

- swarm teammate 如何生成、恢复、切视图
- `@agent` 直发消息和 mailbox attachment 怎样回到 transcript

这一卷继续回答更靠内核的问题：

- 哪些 mailbox 消息绝不能直接进 transcript
- leader 怎样把 worker permission request 重新挂进标准 ToolUseConfirm UI
- worker 怎样拿到 leader 的 allow/reject 决策
- plan approval、shutdown、mode set、sandbox host approval 怎样穿过同一条 inbox 总线

所以这里不是前台消息面，而是 swarm 的 inbox protocol router。

## 2. `getAgentNameToPoll()` 说明 inbox poller 的第一原则不是“谁有邮箱就轮询谁”，而是“谁的接收模型允许文件轮询”

源码镜像：[`../../src/hooks/useInboxPoller.ts`](../../src/hooks/useInboxPoller.ts), [`../../src/utils/teammate.ts`](../../src/utils/teammate.ts), [`../../src/utils/teammateContext.ts`](../../src/utils/teammateContext.ts)

它先把 poll 资格分成三类：

- in-process teammate：不轮询
- process-based teammate：用 `CLAUDE_CODE_AGENT_NAME`
- team lead：从 `teamContext.teammates` 里反查 lead name

这说明 `useInboxPoller` 不是“mailbox file reader”，而是一个只给 file-backed participant 开的协议处理器。in-process teammate 共享 leader AppState，所以它必须走别的接收路径。

## 3. poller 的核心输入不是一条消息，而是一批未读消息上的多协议分类

源码镜像：[`../../src/hooks/useInboxPoller.ts`](../../src/hooks/useInboxPoller.ts), [`../../src/utils/teammateMailbox.ts`](../../src/utils/teammateMailbox.ts)

每轮 poll 拿到 `readUnreadMessages(...)` 之后，不会直接拼成 transcript，而是先分类成：

- `permissionRequests`
- `permissionResponses`
- `sandboxPermissionRequests`
- `sandboxPermissionResponses`
- `shutdownRequests`
- `shutdownApprovals`
- `teamPermissionUpdates`
- `modeSetRequests`
- `planApprovalRequests`
- `regularMessages`

这说明 mailbox 在 swarm 里不是“消息文本流”，而是一条承载多种 RPC/控制协议的 shared bus。

## 4. `isStructuredProtocolMessage()` 说明 Claude Code 已经明确列出了“禁止当原始模型上下文消费”的消息类型

源码镜像：[`../../src/utils/teammateMailbox.ts`](../../src/utils/teammateMailbox.ts), [`../../src/utils/attachments.ts`](../../src/utils/attachments.ts)

被视为 structured protocol 的消息包括：

- `permission_request`
- `permission_response`
- `sandbox_permission_request`
- `sandbox_permission_response`
- `shutdown_request`
- `shutdown_approved`
- `team_permission_update`
- `mode_set_request`
- `plan_approval_request`
- `plan_approval_response`

`attachments.ts` 会显式过滤这批消息，原因不是 UI 美观，而是避免它们先变成 transcript attachment，结果错过真正的 handler。

## 5. leader 侧的 tool permission 请求不是自定义弹窗，而是被重新包装成标准 `ToolUseConfirm` 队列项

源码镜像：[`../../src/hooks/useInboxPoller.ts`](../../src/hooks/useInboxPoller.ts), [`../../src/Tool.ts`](../../src/Tool.ts), [`../../src/utils/swarm/permissionSync.ts`](../../src/utils/swarm/permissionSync.ts)

当 leader 收到 `permission_request` 时，poller 会：

- 用 `findToolByName(getAllBaseTools(), parsed.tool_name)` 找到真实 tool
- 构造一条 `ToolUseConfirm`
- 附上 `workerBadge`
- 注入 `onAllow / onReject / onAbort`

而这些回调并不直接改 worker 内存，而是统一走：

- `sendPermissionResponseViaMailbox(workerName, resolution, requestId, teamName)`

所以 worker ask-permission 会被 leader 重新投影成标准 REPL permission UI，而不是平行维护第二套审批面板。

## 6. `sendPermissionResponseViaMailbox()` 说明 leader 给 worker 的 allow/reject 仍然走 mailbox，而不是 React 内存捷径

源码镜像：[`../../src/utils/swarm/permissionSync.ts`](../../src/utils/swarm/permissionSync.ts), [`../../src/utils/teammateMailbox.ts`](../../src/utils/teammateMailbox.ts)

这条回执协议会：

- 构造 `permission_response`
- `subtype` 只分 `success / error`
- 携带 `updated_input` 和 `permission_updates`
- 以 leader 名义写回 worker mailbox

注释已经写明：这是 mailbox-based approach，替代旧的 file-based resolved directory。

这意味着 swarm 权限审批已经从“磁盘目录轮询”迁到了“同一 inbox bus 上的 request/response message”。

## 7. worker 侧不是盲等文件变化，而是通过 callback registry 把协议响应回接到原始 tool 调用

源码镜像：[`../../src/hooks/useSwarmPermissionPoller.ts`](../../src/hooks/useSwarmPermissionPoller.ts), [`../../src/hooks/useInboxPoller.ts`](../../src/hooks/useInboxPoller.ts)

`useSwarmPermissionPoller.ts` 维护两套模块级 registry：

- `pendingCallbacks`：tool permission
- `pendingSandboxCallbacks`：sandbox host permission

worker 发起请求时会先注册 callback；之后无论响应来自：

- mailbox message
- 旧的 `pollForResponse(...)` 路径

最终都会通过 `processMailboxPermissionResponse()` 或 `processSandboxPermissionResponse()` 把决策回接到原始 `onAllow / onReject / resolve`。

所以 inbox 协议和工具执行之间真正的粘合点不是消息文本，而是 `requestId -> callback registry`。

## 8. `parsePermissionUpdates()` 说明外部 swarm 响应被当成“不可信输入”处理，而不是直接灌回 permission context

源码镜像：[`../../src/hooks/useSwarmPermissionPoller.ts`](../../src/hooks/useSwarmPermissionPoller.ts), [`../../src/utils/permissions/PermissionUpdateSchema.ts`](../../src/utils/permissions/PermissionUpdateSchema.ts)

当 mailbox 响应里带 `permissionUpdates` 时，系统不会直接相信，而是：

- 先检查是不是数组
- 逐项过 `permissionUpdateSchema()`
- 丢弃 malformed entry

这说明 swarm IPC 虽然发生在同一个产品内，但在协议边界上仍被视为外部输入，需要做 schema validation。

## 9. sandbox host approval 不是 tool permission 的特例，而是第二条并行协议

源码镜像：[`../../src/hooks/useInboxPoller.ts`](../../src/hooks/useInboxPoller.ts), [`../../src/hooks/useSwarmPermissionPoller.ts`](../../src/hooks/useSwarmPermissionPoller.ts), [`../../src/utils/swarm/permissionSync.ts`](../../src/utils/swarm/permissionSync.ts), [`../../src/utils/teammateMailbox.ts`](../../src/utils/teammateMailbox.ts)

sandbox 路径有自己独立的：

- request type：`sandbox_permission_request`
- response type：`sandbox_permission_response`
- callback registry
- leader-side AppState queue：`workerSandboxPermissions.queue`

leader 收到请求后，不会进普通 `ToolUseConfirm`，而是把：

- `workerId`
- `workerName`
- `workerColor`
- `host`
- `createdAt`

塞进专门的 sandbox permission 队列。

这说明“网络 host 审批”在 Claude Code 里不是普通 tool allow list，而是另一条 UI 和状态机都独立的 swarm 协议。

## 10. team permission update 说明 leader 还能主动把 session allow rules 下发给 teammate，而不仅仅是一次性批准某个 tool use

源码镜像：[`../../src/hooks/useInboxPoller.ts`](../../src/hooks/useInboxPoller.ts), [`../../src/utils/permissions/PermissionUpdate.ts`](../../src/utils/permissions/PermissionUpdate.ts)

当 teammate 收到 `team_permission_update` 时，poller 会：

- 校验 `permissionUpdate.rules` 和 `behavior`
- 调 `applyPermissionUpdate(...)`
- 目标是 `destination: 'session'`

这说明 leader 和 worker 之间不只有 request/response 语义，还存在“把权限规则直接同步到 teammate 当前 session”的下行治理面。

## 11. `mode_set_request` 说明 leader 可以远程改 teammate 的 permission mode，而且会同步回 team file

源码镜像：[`../../src/hooks/useInboxPoller.ts`](../../src/hooks/useInboxPoller.ts), [`../../src/utils/swarm/teamHelpers.ts`](../../src/utils/swarm/teamHelpers.ts)

这条协议有两个硬约束：

- 只接受 `from === 'team-lead'`
- 先把 mode 解析成 `permissionModeFromString(...)`

然后做两件事：

- 本地 `toolPermissionContext` 改成新的 mode
- `setMemberMode(teamName, agentName, targetMode)` 写回 team file

所以 mode set 不是 UI 层切换，而是“teammate 当前权限模式 + team 共享状态”同时更新的治理协议。

## 12. plan approval 其实是 swarm 里专门的“先批准、再让模型继续看到上下文”的双通道协议

源码镜像：[`../../src/hooks/useInboxPoller.ts`](../../src/hooks/useInboxPoller.ts), [`../../src/utils/inProcessTeammateHelpers.ts`](../../src/utils/inProcessTeammateHelpers.ts), [`../../src/components/messages/PlanApprovalMessage.tsx`](../../src/components/messages/PlanApprovalMessage.tsx)

leader 侧收到 `plan_approval_request` 时会：

- 自动构造 `plan_approval_response`
- 继承 leader 当前 permission mode
- 写回 worker mailbox
- 如果目标是 in-process teammate，还额外调用 `handlePlanApprovalResponse(...)`

但它又会把原始 request 继续 `push` 到 `regularMessages`。

这说明 plan approval 被有意拆成两层：

- 协议层：先把批准结果发回去，解除等待
- 模型层：再把请求文本作为上下文继续交给 transcript / model

所以它不是“批准即隐藏”，而是“协议先执行，文本仍可见”。

## 13. `handlePlanApprovalResponse()` 只负责清掉 `awaitingPlanApproval`，说明 in-process teammate 的 UI 状态和 agent loop 权限模式故意解耦

源码镜像：[`../../src/utils/inProcessTeammateHelpers.ts`](../../src/utils/inProcessTeammateHelpers.ts), [`../../src/tasks/InProcessTeammateTask/types.ts`](../../src/tasks/InProcessTeammateTask/types.ts)

这个 helper 很克制：

- 只把 `awaitingPlanApproval` 设回 `false`
- 不直接改 `permissionMode`

源码注释已经写明：permissionMode from response is handled separately by the agent loop。

这说明计划审批 UI 的解除和真正执行权限的继承不是同一个状态写点，避免 helper 把 agent runtime 语义吞掉。

## 14. shutdown 在 swarm 里被拆成“请求保留给 UI、批准驱动资源清理”两段

源码镜像：[`../../src/hooks/useInboxPoller.ts`](../../src/hooks/useInboxPoller.ts), [`../../src/components/messages/ShutdownMessage.tsx`](../../src/components/messages/ShutdownMessage.tsx)

收到 `shutdown_request` 时，teammate 侧不会立刻吞掉，而是直接转成 `regularMessages`，因为：

- UI 需要渲染成可读的 shutdown request
- model 也可能需要看见这条指令语境

而 leader 侧收到 `shutdown_approved` 时，则会进入资源清理路径：

- 如果是 pane backend，尝试 `killPane`
- `removeTeammateFromTeamFile(...)`
- `unassignTeammateTasks(...)`
- 在 AppState 里把对方从 `teamContext.teammates` 移除
- 给相关 task 打上 `completed`
- 追加 `teammate_terminated` 系统消息

所以 shutdown request/approval 不是一条消息的两个状态，而是两段完全不同的运行时效果。

## 15. `regularMessages` + XML wrapper 说明经过分流后，剩下的 swarm 消息仍然会被重新封装成模型可消费输入

源码镜像：[`../../src/hooks/useInboxPoller.ts`](../../src/hooks/useInboxPoller.ts), [`../../src/constants/xml.ts`](../../src/constants/xml.ts)

所有 surviving regular messages 最终都会被编码成：

- `<TEAMMATE_MESSAGE_TAG teammate_id="..." color="..." summary="...">`

然后根据 session 当前状态决定：

- idle：立即 `onSubmitTeammateMessage(formatted)`
- busy：排进 `AppState.inbox.messages`

这说明 poller 并不是只做 protocol dispatch；它在末端还承担了“把剩余消息重新转成 Claude prompt 输入”的桥接职责。

## 16. pending / processed inbox 状态说明 mid-turn mailbox delivery 不是 fire-and-forget，而是带二阶段清理协议

源码镜像：[`../../src/hooks/useInboxPoller.ts`](../../src/hooks/useInboxPoller.ts), [`../../src/utils/attachments.ts`](../../src/utils/attachments.ts)

`AppState.inbox.messages` 至少有三种状态语义：

- `pending`：已经可靠排队，但还没在空闲时正式提交
- `processed`：已经通过 attachment mid-turn 展示过，等待清理
- 被清除：已成功正式提交或已完成清理

当 session 重新 idle 时，poller 会：

- 先删掉 `processed`
- 再尝试提交 `pending`
- 成功后只删本次提交的那些 ID

这说明 mid-turn mailbox integration 不是单次 append，而是带 replay-safe 清理逻辑的两阶段协议。

## 17. `markRead()` 的调用位置说明 Claude Code 优先保证“不丢协议效果”，而不是尽快清空 inbox

源码镜像：[`../../src/hooks/useInboxPoller.ts`](../../src/hooks/useInboxPoller.ts), [`../../src/utils/attachments.ts`](../../src/utils/attachments.ts)

在 poller 里，只有当下面两种条件之一满足时才 `markRead()`：

- 非 regular protocol 已经被正确处理
- regular messages 已经被成功提交或可靠排队

源码注释反复强调的都是同一个目标：

- 如果 session 忙、提交失败、或处理链中途崩掉，消息下次 poll 还能重读

所以这条协议的第一设计目标不是 inbox 干净，而是 delivery at least once。

## 18. 这条机制最终说明 swarm inbox runtime 实际上由五段协议拼起来

源码镜像：[`../../src/hooks/useInboxPoller.ts`](../../src/hooks/useInboxPoller.ts), [`../../src/hooks/useSwarmPermissionPoller.ts`](../../src/hooks/useSwarmPermissionPoller.ts), [`../../src/utils/teammateMailbox.ts`](../../src/utils/teammateMailbox.ts), [`../../src/utils/swarm/permissionSync.ts`](../../src/utils/swarm/permissionSync.ts), [`../../src/utils/inProcessTeammateHelpers.ts`](../../src/utils/inProcessTeammateHelpers.ts)

真正叠在一起工作的是这五段：

- mailbox schema：`teammateMailbox.ts`
- inbox router：`useInboxPoller.ts`
- permission callback glue：`useSwarmPermissionPoller.ts`
- leader/worker mailbox response transport：`permissionSync.ts`
- in-process teammate state patch：`inProcessTeammateHelpers.ts`

因此 Claude Code 的 swarm inbox 不是“有个 JSON inbox 文件”那么简单，而是一整套：

- 控制消息先分流
- 再根据角色改 AppState / queue / task state
- 最后把剩余消息安全地回到 model transcript

所以这篇不是 mailbox 补遗，而是 swarm 协议层的中枢卷册。
