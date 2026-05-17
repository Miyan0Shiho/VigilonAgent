# Remote Interactive Host Adapters / Failure Semantics

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Remote Host Modes / History / Command Filtering`](./31-remote-host-modes-history-and-command-filtering.md) | [`下一站：Remote Web Onboarding / Environments / Managed Settings`](./37-remote-web-onboarding-environments-and-managed-settings.md)

本文继续沿 `remote` 往下拆，但不再讲“有哪些宿主”，而是讲 `useRemoteSession.ts + useDirectConnect.ts + useSSHSession.ts + directConnectManager.ts + remotePermissionBridge.ts` 这条真实交互链。核心问题是：Claude Code 怎么把三种远端宿主都塞进同一个 REPL 输入面，又让 permission ask、disconnect、reconnect、重复 init、WS echo 和 interrupt 这些细节各自落在正确语义上。

## 1. `useRemoteSession` 和 `useDirectConnect/useSSHSession` 不是同一类 remote

源码镜像：[`../../src/hooks/useRemoteSession.ts`](../../src/hooks/useRemoteSession.ts), [`../../src/hooks/useDirectConnect.ts`](../../src/hooks/useDirectConnect.ts), [`../../src/hooks/useSSHSession.ts`](../../src/hooks/useSSHSession.ts)

三条 hook 对 REPL 暴露的是同一组返回值：

- `isRemoteMode`
- `sendMessage()`
- `cancelRequest()`
- `disconnect()`

但运行时语义并不一样：

- `useRemoteSession` 是 Claude.ai CCR session 的 viewer/controller
- `useDirectConnect` 是本地 REPL 直接连一个 `stream-json` WebSocket 宿主
- `useSSHSession` 是本地 REPL 绑一个 ssh child + auth proxy 宿主

所以“remote hook 统一接口”只是 REPL 兼容层，不是三个 transport 已经完全同构。

## 2. 真正共享的是 transcript/permission 适配协议，而不是 transport 生命周期

源码镜像：[`../../src/remote/sdkMessageAdapter.ts`](../../src/remote/sdkMessageAdapter.ts), [`../../src/remote/remotePermissionBridge.ts`](../../src/remote/remotePermissionBridge.ts)

三条链都复用两块核心协议：

- `convertSDKMessage()`
- `createSyntheticAssistantMessage() + createToolStub()`

这说明 Claude Code 的设计重点不是把所有 remote transport 抽成一个巨大基类，而是先统一两件事：

- 远端 SDK message 怎么落成本地 transcript block
- 远端 `can_use_tool` 请求怎么落成本地 `ToolUseConfirm`

也因此，transport 不同不意味着要重写 permission UI 和 transcript UI。

## 3. `remotePermissionBridge` 本质上是在“伪造一个足够像本地 tool_use 的壳”

源码镜像：[`../../src/remote/remotePermissionBridge.ts`](../../src/remote/remotePermissionBridge.ts)

`createSyntheticAssistantMessage()` 做的不是普通 wrapper，而是专门补一个最小的 assistant message：

- `type: 'assistant'`
- `content` 里只放一个 `tool_use`
- `id` 变成 `remote-${requestId}`
- `usage/model` 全部降成空值或零值

这样做的原因很直接：`ToolUseConfirm` 不接受“纯 permission request”，它要求一个真正的 assistant tool-use message。remote 侧既然没有本地 query loop 生成的那条消息，就只能合成一条。

## 4. `createToolStub()` 说明本地 permission UI 不要求“本地真的装了该工具”

源码镜像：[`../../src/remote/remotePermissionBridge.ts`](../../src/remote/remotePermissionBridge.ts)

当远端请求的工具本地找不到时，Claude Code 不会放弃渲染，而是生成 stub：

- `userFacingName()` 直接返回工具名
- `renderToolUseMessage()` 只把前几个 input key/value 压成摘要
- `needsPermissions()` 仍返回 `true`
- `isReadOnly()` 默认 `false`

这说明 remote permission surface 的目标不是“本地重建完整工具实现”，而是“保证审批 UI 能继续工作，即便工具只存在于远端容器”。

## 5. `useDirectConnect` 和 `useSSHSession` 的 onMessage 基本同构，说明 interactive remote 有一套稳定最小契约

源码镜像：[`../../src/hooks/useDirectConnect.ts`](../../src/hooks/useDirectConnect.ts), [`../../src/hooks/useSSHSession.ts`](../../src/hooks/useSSHSession.ts)

这两条 hook 的 `onMessage` 路线几乎一模一样：

- `isSessionEndMessage()` 到了就 `setIsLoading(false)`
- `system:init` 只吃第一次，后面靠 `hasReceivedInitRef` 去重
- `convertSDKMessage(..., { convertToolResults: true })`
- 只有 `converted.type === 'message'` 才 append 进 transcript

也就是说，Claude Code 已经把“实时 remote 宿主”的最小 contract 定死了：

- 会重复发 init
- 本地已先写用户消息，不需要回放 user text
- tool result 要落回 transcript
- session end 才是 loading 结束真相

## 6. 它们都没有 viewer-mode 的 user-echo 去重，因为 interactive remote 的本地写入路径不同

源码镜像：[`../../src/hooks/useRemoteSession.ts`](../../src/hooks/useRemoteSession.ts), [`../../src/hooks/useDirectConnect.ts`](../../src/hooks/useDirectConnect.ts), [`../../src/hooks/useSSHSession.ts`](../../src/hooks/useSSHSession.ts)

`useRemoteSession` 需要 `BoundedUUIDSet` 去挡掉 WS 回来的 user echo，因为：

- 本地 REPL 已经先 append 了用户消息
- CCR 订阅流还会把同一条 user message 回推回来

而 `useDirectConnect/useSSHSession` 没有这层显式 UUID 去重。根本原因不是它们“不会 echo”，而是它们的 transcript 语义更简单：

- 本地 REPL 发送的是实时 interactive turn
- hook 只负责远端输出和 tool result 折回
- 当前实现不承担 viewer-only 那种 history/live 拼接压力

所以它们复用的是 message adapter，不复用 CCR viewer 的 echo-invariant。

## 7. `useRemoteSession` 会维护 response timeout，而 direct/SSH 不会

源码镜像：[`../../src/hooks/useRemoteSession.ts`](../../src/hooks/useRemoteSession.ts)

CCR viewer/controller 这条链有完整的超时治理：

- 普通 turn 60 秒
- compaction 中 180 秒
- 收到任何 WS message 就清 timeout
- 超时后写 warning transcript，再 `manager.reconnect()`

这说明 `useRemoteSession` 假设“session 还活着，只是订阅通道可能 stale 了”。

相反，`useDirectConnect/useSSHSession` 没做这套 timeout + reconnect loop。它们更像“当前 REPL 的主宿主进程”，不是可脱附的外部 session viewer。

## 8. interactive remote 的 permission queue 是 paused loading，而不是 viewer reconnect 流程

源码镜像：[`../../src/hooks/useRemoteSession.ts`](../../src/hooks/useRemoteSession.ts), [`../../src/hooks/useDirectConnect.ts`](../../src/hooks/useDirectConnect.ts), [`../../src/hooks/useSSHSession.ts`](../../src/hooks/useSSHSession.ts)

三条 hook 在 permission ask 上都采用同一条本地 UX：

- 生成 `ToolUseConfirm`
- push 到 `setToolUseConfirmQueue`
- `setIsLoading(false)`

用户动作再映射成远端 response：

- `onAllow(updatedInput)` -> `behavior: 'allow'`
- `onReject(feedback)` -> `behavior: 'deny'`
- `onAbort()` -> `behavior: 'deny', message: 'User aborted'`

这里的关键不是 API shape 一样，而是 loading 语义也统一了：

- remote agent 等审批时，本地一定暂停 loading
- 只有 allow 后才 resume loading

这让 remote permission ask 看起来像本地 ask，而不是外部系统弹回来的异步异常。

## 9. `useRemoteSession` 比 direct/SSH 多了 `onPermissionCancelled`

源码镜像：[`../../src/hooks/useRemoteSession.ts`](../../src/hooks/useRemoteSession.ts)

只有 CCR session viewer 这条链显式处理：

- `onPermissionCancelled(requestId, toolUseId)`

它会：

- 从 queue 里删掉对应 `ToolUseConfirm`
- `setIsLoading(true)`

这说明 CCR remote 允许“远端自己撤销这次 ask”，本地 UI 需要收回审批框。而 direct connect / SSH 当前只暴露了“本地用户答复”这一半，没有单独的 cancel callback。

## 10. `useDirectConnect` 的 disconnect 是硬退出，`useSSHSession` 的 disconnect 会带 stderr 解释，`useRemoteSession` 则只是连接状态切换

源码镜像：[`../../src/hooks/useDirectConnect.ts`](../../src/hooks/useDirectConnect.ts), [`../../src/hooks/useSSHSession.ts`](../../src/hooks/useSSHSession.ts), [`../../src/hooks/useRemoteSession.ts`](../../src/hooks/useRemoteSession.ts)

三条断开语义差异非常大：

- `useDirectConnect`
  - 从未连接成功：打印 `Failed to connect`
  - 连接后断开：打印 `Server disconnected`
  - 然后 `gracefulShutdown(1)`
- `useSSHSession`
  - 可能先经历 `onReconnecting`
  - 最终断开时根据 `connected / exitCode / stderr tail` 拼最终错误
  - 然后 `gracefulShutdown(1, ...)`
- `useRemoteSession`
  - 只更新 `remoteConnectionStatus`
  - 清 loading / remote task count / in-progress tool IDs
  - 不直接结束整个本地 REPL

所以“disconnect”这个词在三条链上根本不是同一件事：

- CCR 是附着式 viewer 连接
- direct/SSH 是当前 REPL 的执行宿主

## 11. SSH 比 direct connect 多一个显式的 `onReconnecting` transcript side effect

源码镜像：[`../../src/hooks/useSSHSession.ts`](../../src/hooks/useSSHSession.ts)

`useSSHSession` 在掉线重连时会主动 append 一条系统消息：

- `SSH connection dropped — reconnecting (attempt X/Y)...`

同时立刻：

- `setIsLoading(false)`

这说明 SSH transport 被视为“底层链路可能瞬断，但 shell/agent 还可能续上”。用户必须在 transcript 里看见这个状态变化，而不是只靠 footer。

## 12. direct connect manager 额外承担了 transport-level 帧过滤，不只是 socket 包装器

源码镜像：[`../../src/server/directConnectManager.ts`](../../src/server/directConnectManager.ts)

`DirectConnectSessionManager` 做的不只是：

- 开 WS
- 发 JSON
- 收 JSON

它还明确过滤：

- `keep_alive`
- `control_response`
- `control_cancel_request`
- `streamlined_text`
- `streamlined_tool_use_summary`
- `system:post_turn_summary`

这层过滤说明 direct connect 收到的是比 CCR viewer 更低层的 agent stdout 协议。没有这层 transport hygiene，`sdkMessageAdapter` 之前就已经会被噪音帧污染。

## 13. direct connect 和 SSH 的 interrupt 语义比 CCR 更原始

源码镜像：[`../../src/server/directConnectManager.ts`](../../src/server/directConnectManager.ts), [`../../src/hooks/useDirectConnect.ts`](../../src/hooks/useDirectConnect.ts), [`../../src/hooks/useSSHSession.ts`](../../src/hooks/useSSHSession.ts), [`../../src/hooks/useRemoteSession.ts`](../../src/hooks/useRemoteSession.ts)

三条取消链路都是“发一个远端中断”：

- direct connect：`sendInterrupt()`
- SSH：`sendInterrupt()`
- CCR：`cancelSession()`

但 CCR 额外受 `viewerOnly` gate 约束：

- `viewerOnly` 模式下本地 `Ctrl+C` 不允许 interrupt 远端 agent

而 direct/SSH 没有 viewer-only 这种 observer 角色，它们默认就是执行宿主，因此 interrupt 没有再被角色分叉。

## 14. `handleRemoteInit()` 和 `activeRemote` 一起说明：真正统一的是 REPL 控制面，不是底层故障模型

源码镜像：[`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx)

REPL 对三条宿主只做两件统一操作：

- 选当前激活的 `activeRemote`
- 在 CCR `init.slash_commands` 到来后裁剪本地 command catalog

换句话说，REPL 的统一层只关心：

- 我该把输入发给谁
- 我该暴露哪些命令

至于：

- echo 去重
- timeout/reconnect
- stderr 尾部解释
- permission cancelled
- shutdown 时是否直接退出

都保留在各自宿主 adapter 内部。

## 15. 这套设计的真正边界是：“统一交互面，保留宿主故障语义”

综合这些实现细节，Claude Code 在 remote interactive 这层并没有强行抽象成“一切都是 session manager”。它做的是更保守、也更稳的分层：

- `REPL`
  - 统一输入/取消/断开接口
  - 统一 command visibility surface
- `sdkMessageAdapter + remotePermissionBridge`
  - 统一 transcript 和 permission 适配协议
- 各宿主 adapter
  - 保留各自的 transport 噪音过滤、echo 语义、timeout 模型、stderr 诊断和 shutdown 策略

这才是 Claude Code remote 体系可扩展的原因：前台像一个产品，底层故障模型却没有被过度抹平。

## 交叉参考

- 多宿主 remote 总览：[`./31-remote-host-modes-history-and-command-filtering.md`](./31-remote-host-modes-history-and-command-filtering.md)
- CCR viewer / WebSocket / permission bridge：[`./29-remote-sdk-message-adaptation-websocket-and-permission-bridges.md`](./29-remote-sdk-message-adaptation-websocket-and-permission-bridges.md)
- 远端后台任务：[`./30-remote-agent-task-polling-restore-and-archive-runtime.md`](./30-remote-agent-task-polling-restore-and-archive-runtime.md)
- 远端 UI 工作面：[`../architecture/08-tasks-remote-and-agent-detail-ui.md`](../architecture/08-tasks-remote-and-agent-detail-ui.md)
