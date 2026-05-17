# Remote SDK Message Adaptation / WebSocket / Permission Bridges

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Tool Search / Deferred Tools / MCP Instruction Deltas`](./28-tool-search-deferred-tools-and-mcp-instruction-deltas.md) | [`下一站：Remote Agent Task Polling / Restore / Archive Runtime`](./30-remote-agent-task-polling-restore-and-archive-runtime.md)

本文拆的是 Claude Code 里 remote viewer 这一侧真正的运行时链：`sdkMessageAdapter.ts + SessionsWebSocket.ts + RemoteSessionManager.ts + remotePermissionBridge.ts + useRemoteSession.ts`。它实现的不是单纯“连到远端会话”，而是把 CCR 的 SDK message/control protocol 改写成 REPL 能消费的本地 transcript、spinner、permission queue 和 reconnect 行为。

## 1. 这条链的核心问题不是 transport，而是把“远端 agent 的事实”翻译成本地 REPL 的状态机

源码镜像：[`../../src/remote/sdkMessageAdapter.ts`](../../src/remote/sdkMessageAdapter.ts), [`../../src/remote/RemoteSessionManager.ts`](../../src/remote/RemoteSessionManager.ts), [`../../src/hooks/useRemoteSession.ts`](../../src/hooks/useRemoteSession.ts)

remote viewer 跟本地 query loop 最大的不同是：

- 真正跑 agent 的不是本地 REPL，而是远端 CCR container
- 本地拿到的是 SDK-format messages 和 control requests
- 本地 UI 却仍然只会渲染内部 `Message`、`StreamEvent`、`ToolUseConfirm`

所以这条链本质上是一个协议翻译层。它要同时解决三件事：

- 把 SDK 消息翻译成 transcript 可渲染对象
- 把 WebSocket subscription 做成可恢复的会话流
- 把远端 permission ask 伪装成本地标准审批流

## 2. `convertSDKMessage()` 不是简单的类型转换器，而是一个“什么该进入 transcript、什么该被吞掉”的边界面

源码镜像：[`../../src/remote/sdkMessageAdapter.ts`](../../src/remote/sdkMessageAdapter.ts)

`convertSDKMessage()` 最值得注意的不是 mapping，而是它显式返回三态：

- `{ type: 'message' }`
- `{ type: 'stream_event' }`
- `{ type: 'ignored' }`

这说明 remote viewer 并不假设“所有远端事件都应该显示”。Claude Code 在这里正式区分了：

- 应该进入 transcript 的完整消息
- 应该进入 streaming reducer 的局部事件
- 只作为控制信号存在、不应污染前台的协议事件

## 3. assistant / stream / compact boundary 会被保留，但 `auth_status`、`tool_use_summary`、`rate_limit_event` 会被静默吞掉

源码镜像：[`../../src/remote/sdkMessageAdapter.ts`](../../src/remote/sdkMessageAdapter.ts)

`sdkMessageAdapter` 的保留面相对克制：

- `assistant` -> `AssistantMessage`
- `stream_event` -> `StreamEvent`
- `system:init/status/compact_boundary` -> `SystemMessage`
- `tool_progress` -> `SystemMessage`

但另外几类会被主动忽略：

- `auth_status`
- `tool_use_summary`
- `rate_limit_event`
- 其他未知 message type

这反映出 Claude Code 对 remote transcript 的原则不是“尽量全显示”，而是“只保留本地 REPL 真的有 UI 语义的部分”。

## 4. user message 默认被忽略，只有两种特例会显式转回 transcript

源码镜像：[`../../src/remote/sdkMessageAdapter.ts`](../../src/remote/sdkMessageAdapter.ts)

`user` 分支是这篇里最容易被误读的一段。默认情况下，remote user messages 不进入 transcript，因为：

- live WS 模式里，本地 REPL 已经先把用户输入写进消息列表
- 若远端 echo 再进来，会重复显示

只有两种特例会转回本地：

- `convertToolResults=true` 时，把远端发回的 `tool_result` user blocks 渲染成可折叠的本地 user message
- `convertUserTextMessages=true` 时，把历史事件里的用户文本补回 transcript

这也是 viewer-only 模式必须打开这些开关的原因。那时本地并没有参与原始输入与工具执行，只能靠历史事件回放补齐视图。

## 5. tool result 的判定故意不依赖 `parent_tool_use_id`，说明 agent 侧规范化已经把那个字段做脏了

源码镜像：[`../../src/remote/sdkMessageAdapter.ts`](../../src/remote/sdkMessageAdapter.ts)

`convertSDKMessage()` 明确写了一个很重要的事实：不能靠 `parent_tool_use_id` 判断 tool result，因为 agent 侧 `normalizeMessage()` 会把 top-level tool result 的这个字段硬写成 `null`。

所以这里改成：

- 直接看 `message.content` 里有没有 `tool_result` block

这不是实现小技巧，而是 remote transcript 恢复协议里的一个重要“反事实修复”。也说明 Claude Code 已经承认上游 SDK message shape 不能直接等同于前台语义。

## 6. `isSessionEndMessage()` 很窄，只认 `result`，因为 loading 结束条件必须保守

源码镜像：[`../../src/remote/sdkMessageAdapter.ts`](../../src/remote/sdkMessageAdapter.ts), [`../../src/hooks/useRemoteSession.ts`](../../src/hooks/useRemoteSession.ts)

remote session 的完成判定没有做复杂 heuristics，而是只认：

- `msg.type === 'result'`

这保证了本地 `isLoading` 只会在远端明确宣告一次 turn 结束时落下，不会因为中间收到一条 assistant message 或 tool progress 就误判“已经完成”。

## 7. `SessionsWebSocket` 不是薄封装，而是 session subscription 的可靠性层

源码镜像：[`../../src/remote/SessionsWebSocket.ts`](../../src/remote/SessionsWebSocket.ts)

`SessionsWebSocket` 真正承担的是四件事：

- 组装 `/v1/sessions/ws/{id}/subscribe?organization_uuid=...`
- 用 fresh OAuth token 走 header auth
- 在 Bun native WS 和 Node `ws` 之间做宿主适配
- 处理 ping、close code、reconnect 和 control request/response

所以它不是“RemoteSessionManager 下面的一个 socket 类”，而是 remote viewer transport contract 的主要实现。

## 8. 这里故意接受“任何带 string type 的消息”，因为 allowlist 会让新协议静默丢失

源码镜像：[`../../src/remote/SessionsWebSocket.ts`](../../src/remote/SessionsWebSocket.ts)

`isSessionsMessage()` 的实现很保守：

- 只检查 `value` 是对象
- 有 `type`
- `type` 是 string

注释解释得很直接：这里不做 hardcoded allowlist，因为新 message type 可能先于客户端升级出现。如果在 WebSocket 层就拒掉，新协议会被无声吞掉，后面的 adapter/manager 连“忽略”或“特殊处理”的机会都没有。

## 9. 4001 被当成短暂可恢复，而 4003 被当成永久拒绝，说明它已经吸收了 compaction 期间的真实抖动模型

源码镜像：[`../../src/remote/SessionsWebSocket.ts`](../../src/remote/SessionsWebSocket.ts)

close code 策略不是统一重连：

- `4003 unauthorized`：永久失败，不重连
- `4001 session not found`：限次重试
- 其他 transient close：最多 `MAX_RECONNECT_ATTEMPTS`

为什么 `4001` 单独处理很重要？因为注释已经说明：

- compaction 期间，server 可能短暂把 session 视为 stale
- worker 正忙于 compaction API 调用，暂时不发事件

也就是说，这不是 generic reconnect policy，而是专门为 remote compaction 抖动建的容错模型。

## 10. ping/reconnect 之外，它还提供了 control response 和 interrupt 这两条反向控制通道

源码镜像：[`../../src/remote/SessionsWebSocket.ts`](../../src/remote/SessionsWebSocket.ts)

`SessionsWebSocket` 对外暴露的不只是订阅：

- `sendControlResponse()`：把 permission 决策回发给 CCR
- `sendControlRequest()`：发送 `interrupt`
- `reconnect()`：强制断开后 500ms 重连

所以它既是 inbound message pipe，也是 outbound control plane。

## 11. `RemoteSessionManager` 不是 view model，而是 SDK messages 与 control messages 的协议分拣器

源码镜像：[`../../src/remote/RemoteSessionManager.ts`](../../src/remote/RemoteSessionManager.ts)

`RemoteSessionManager` 的职责很窄但很关键：

- SDK messages 直接 forward 给 `onMessage`
- `control_request` 分流给 permission pipeline
- `control_cancel_request` 清 pending request
- `control_response` 只做 ack 观察，不进 transcript
- `sendMessage()` 走 HTTP POST
- `cancelSession()` 走 WebSocket control request

它真正做的是把“同一条 WS 上混着来的多种协议帧”拆成上层 REPL 能各自处理的回调通道。

## 12. 它只正式支持 `can_use_tool`，对未知 control subtype 会主动回 error，避免远端永远挂住

源码镜像：[`../../src/remote/RemoteSessionManager.ts`](../../src/remote/RemoteSessionManager.ts)

`handleControlRequest()` 这里有个非常好的工程判断：

- 已知 `can_use_tool`：进入本地审批
- 未知 subtype：立刻回 `control_response{subtype:'error'}`

如果这里只是 log 然后丢弃，server 会一直等 reply，整个远端会话可能卡在等待态。Claude Code 没这么做，而是把“不认识”也变成正式的协议响应。

## 13. pending permission requests 存在 manager 层，而不是 hook 层，因为 request/response 必须按 request_id 配对

源码镜像：[`../../src/remote/RemoteSessionManager.ts`](../../src/remote/RemoteSessionManager.ts)

`pendingPermissionRequests` 放在 manager 里有两个原因：

- `request_id` 是 transport-level identity，不是 UI identity
- cancel、allow、deny 都要对同一个 pending request 做配对和清理

这保证了：

- `control_cancel_request` 能反查到 `tool_use_id`
- `respondToPermissionRequest()` 能校验 request 还在不在
- UI queue 可以只关心展示与用户交互，不负责底层协议配对

## 14. 远端 permission ask 之所以能复用本地 `ToolUseConfirm`，靠的是 synthetic assistant message 和 tool stub

源码镜像：[`../../src/remote/remotePermissionBridge.ts`](../../src/remote/remotePermissionBridge.ts)

本地 permission UI 需要两样东西：

- 一个 `AssistantMessage`，里面有 `tool_use` block
- 一个本地 `Tool` 对象

remote mode 天然没有这两样，因为：

- 真正的 assistant/tool use 发生在远端 container
- 本地不一定加载了同名工具，尤其是 MCP tools

所以 `remotePermissionBridge` 专门伪造：

- `createSyntheticAssistantMessage()`
- `createToolStub()`

这就是远端 ask-permission 能进入现有 PermissionDialog 体系的关键。

## 15. `createToolStub()` 的目标不是执行工具，而是让 fallback permission UI 至少有名字、输入摘要和权限语义

源码镜像：[`../../src/remote/remotePermissionBridge.ts`](../../src/remote/remotePermissionBridge.ts)

stub tool 的实现非常克制：

- `userFacingName()` 直接返回工具名
- `renderToolUseMessage()` 抽前三个输入字段做摘要
- `call()` 永远不真正执行
- `needsPermissions()` 恒为 true

这说明它的定位不是“兼容执行”，而是“让本地 permission surface 还能工作”。真正执行和 classifier 都还在远端。

## 16. `useRemoteSession()` 不是单纯的 WS hook，而是 remote viewer 的本地状态编排器

源码镜像：[`../../src/hooks/useRemoteSession.ts`](../../src/hooks/useRemoteSession.ts)

`useRemoteSession()` 真正编排的状态很多：

- transcript messages
- `isLoading`
- remote connection status
- background task count
- in-progress tool use IDs
- streaming tool uses
- permission queue
- compaction timeout mode
- sent UUID echo filter

也就是说，真正把 remote session “接到 REPL 身上”的不是 manager，而是这个 hook。

## 17. echo filter 用 `BoundedUUIDSet` 而不是 delete-on-match Set，是因为同一条本地 POST 可能被远端 echo 多次

源码镜像：[`../../src/hooks/useRemoteSession.ts`](../../src/hooks/useRemoteSession.ts), [`../../src/bridge/bridgeMessaging.ts`](../../src/bridge/bridgeMessaging.ts)

`sentUUIDsRef` 这一段很关键。注释已经说明，同一个本地输入可能被 echo 两次：

- server 直接广播一次
- worker 写路径再 echo 一次

如果用“命中一次就删除”的 Set，第二次 echo 会穿透，导致用户看到重复消息。`BoundedUUIDSet` 的设计目标就是：

- 不靠首次命中删除去重
- 靠 ring cap 控制内存

这说明 remote viewer 的重复消息问题不是理论担心，而是真实碰到过。

## 18. timeout 不是统一 60s，而是 compaction 时抬到 180s，并且任何 WS heartbeat 都会提前清掉计时器

源码镜像：[`../../src/hooks/useRemoteSession.ts`](../../src/hooks/useRemoteSession.ts)

`useRemoteSession()` 的 timeout 策略相当细：

- 普通响应超时：60s
- compaction 中：180s
- 收到任何 message，包括自己 POST 的 echo，也会清 timer

这套策略的目标不是“精确测时”，而是尽量避免把慢但活着的 session 误报成卡死。尤其 compaction 和冷启动时，heartbeat 比真正 assistant content 更先到，所以 timer 清理必须发生在 echo filter 之前。

## 19. `task_started / task_notification / task_progress` 不进入 transcript，而是被抽成 remote background task counter

源码镜像：[`../../src/hooks/useRemoteSession.ts`](../../src/hooks/useRemoteSession.ts)

对 remote subagent/workflow/bash 来说，本地 viewer 的 `AppState.tasks` 是空的，因为任务活在另一个进程。于是 `useRemoteSession()` 只做一件更轻的事：

- 通过 `task_started` / `task_notification` 维护一个 `remoteBackgroundTaskCount`

这说明 remote viewer 目前的任务可见性不是完整任务镜像，而是事件源驱动的计数器视图。

## 20. remote tool use spinner 状态需要本地补写，因为远端发来的是“已经拼好的 assistant message”

源码镜像：[`../../src/hooks/useRemoteSession.ts`](../../src/hooks/useRemoteSession.ts)

本地 session 里，tool use 的 spinner 状态通常由 tool orchestration 路径维护。remote mode 没有那条本地执行路径，于是 `useRemoteSession()` 要手动：

- 在 assistant message 到来时抽出 `tool_use` IDs，加入 `inProgressToolUseIDs`
- 在 user `tool_result` 到来时删掉这些 IDs

否则 UI 会把远端正在运行的工具显示成普通等待态，而不是真实“in progress”。

## 21. permission 请求一旦到本地，会被完整包进 `ToolUseConfirm`，但 `onUserInteraction` 和 `recheckPermission` 都故意变成 no-op

源码镜像：[`../../src/hooks/useRemoteSession.ts`](../../src/hooks/useRemoteSession.ts)

remote permission bridge 的关键不只是 push queue，而是 push 一个合法的 `ToolUseConfirm`：

- `assistantMessage` 用 synthetic message
- `tool` 用真实工具或 stub
- `onAllow/onReject/onAbort` 最终回 `manager.respondToPermissionRequest()`
- `onUserInteraction` no-op
- `recheckPermission` no-op

这说明本地只负责收集用户决定，不负责重新跑 classifier 或本地权限状态机。真正的权限判定宿主仍在远端 container。

## 22. viewer-only 模式不是简单 readonly，而是一组行为降级开关

源码镜像：[`../../src/remote/RemoteSessionManager.ts`](../../src/remote/RemoteSessionManager.ts), [`../../src/hooks/useRemoteSession.ts`](../../src/hooks/useRemoteSession.ts)

`viewerOnly` 至少改了四件事：

- `convertToolResults / convertUserTextMessages` 打开，靠历史事件补图
- 不发 interrupt
- 不更新远端 session title
- 不启用 60s stuck timeout

所以 viewer-only 不是“少一个按钮”，而是把整个 remote session 从“可控制的 attached operator”降成“纯观察者”。

## 23. session title 更新被放在本地首条消息后异步触发，说明 claude.ai 上的 session identity 是 viewer 侧补写的

源码镜像：[`../../src/hooks/useRemoteSession.ts`](../../src/hooks/useRemoteSession.ts)

对于没有 initial prompt 的 remote session，本地在第一次 `sendMessage()` 成功后会：

- 提取纯文本描述
- 调 `generateSessionTitle()`
- 再调 `updateSessionTitle()`

这说明 claude.ai 侧“Background task”变成有意义标题，不是远端 worker 自己天然完成的，而是 viewer hook 补上的一个产品层 side effect。

## 24. 这整条链真正提供的是“远端会话局部镜像”，不是把远端 REPL 完整复制到本地

如果把这五个文件合起来看，它们共同实现的是：

- `SessionsWebSocket`：可靠订阅和控制通道
- `RemoteSessionManager`：protocol demux
- `sdkMessageAdapter`：SDK -> REPL message translation
- `remotePermissionBridge`：remote ask -> local ToolUseConfirm bridge
- `useRemoteSession`：把这些结果编排成本地 transcript/loading/spinner/permission/task-count 状态

所以 Claude Code 的 remote viewer 更准确的定义不是“远端 REPL 镜像”，而是“一个只同步关键运行时语义的本地控制台”。

## 交叉参考

- 远端任务工作面：[`./14-remote-review-workflow-and-monitor-surfaces.md`](./14-remote-review-workflow-and-monitor-surfaces.md)
- Bridge runtime：[`./19-bridge-runtime-polling-and-message-routing.md`](./19-bridge-runtime-polling-and-message-routing.md)
- Bridge transport / auth：[`./20-bridge-transport-auth-and-session-identity.md`](./20-bridge-transport-auth-and-session-identity.md)
- 远端 UI 总述：[`../architecture/08-tasks-remote-and-agent-detail-ui.md`](../architecture/08-tasks-remote-and-agent-detail-ui.md)
