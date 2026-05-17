# SendMessageTool / Peer Routing / Mailbox / Cross-Session Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：ConfigTool / Supported Settings / Source Routing / Immediate Effect Runtime`](./75-config-tool-supported-settings-source-routing-and-immediate-effect-runtime.md) | [`下一站：MCP Resource Listing / Reading / Binary Persistence Runtime`](./77-mcp-resource-listing-reading-and-binary-persistence-runtime.md)

本文把 `SendMessageTool` 从 swarm 前台、task host、agent runtime、bridge runtime 这些旧卷册里抽成一条独立主链。重点不是“可以给 teammate 发消息”，而是它怎样把一次通信请求拆成：

- `address parse`
- `host gate`
- `string vs structured protocol split`
- `local_agent queue/resume`
- `team mailbox write`
- `bridge/UDS cross-session send`
- `minimal UI result surface`

这条链里最关键的事实是：`SendMessageTool` 不是普通聊天工具，而是 Claude Code 多 agent/多会话协调面的正式协议入口。

## 1. `SendMessageTool` 在工具池里不是 swarm 的装饰件，而是多条 agent runtime 都依赖的正式控制面

源码镜像：[`../../src/tools.ts`](../../src/tools.ts), [`../../src/tools/SendMessageTool/SendMessageTool.ts`](../../src/tools/SendMessageTool/SendMessageTool.ts)

它在 `getAllBaseTools()` 里是常驻基础工具：

- `SendMessageTool`

同时在简化工具集里也会被单独补回：

- `replSimple.push(TaskStopTool, SendMessageTool)`
- `simpleTools.push(AgentTool, TaskStopTool, SendMessageTool)`

说明它不是 team-create 之后才临时加上的 helper，而是 Claude Code 认为“只要 agent/swarms 能工作，消息投递就必须存在”的基础 runtime。

## 2. 系统提示词也把它定义成 teammate 可见性的唯一正式通道

源码镜像：[`../../src/utils/swarm/teammatePromptAddendum.ts`](../../src/utils/swarm/teammatePromptAddendum.ts)

`TEAMMATE_SYSTEM_PROMPT_ADDENDUM` 讲得非常硬：

- plain text 对团队其他成员不可见
- 必须用 `SendMessage`
- `to: "<name>"` 是定向
- `to: "*"` 是广播

所以这个工具不是“提供一个更方便的消息能力”，而是 teammate system prompt 里规定的唯一协作出口。

## 3. schema 从一开始就把通信拆成两类：plain text peer DM 和 structured protocol response

源码镜像：[`../../src/tools/SendMessageTool/SendMessageTool.ts`](../../src/tools/SendMessageTool/SendMessageTool.ts), [`../../src/tools/SendMessageTool/prompt.ts`](../../src/tools/SendMessageTool/prompt.ts)

input schema 只有三个字段：

- `to`
- `summary?`
- `message`

但 `message` 不是单一 string，而是：

- `string`
- `shutdown_request`
- `shutdown_response`
- `plan_approval_response`

这说明 `SendMessageTool` 从设计上就不是“只传人类文本”，而是兼任了 swarm protocol response bus。

## 4. `to` 不是单一 teammate 名字，而是一张多宿主地址表

源码镜像：[`../../src/tools/SendMessageTool/prompt.ts`](../../src/tools/SendMessageTool/prompt.ts), [`../../src/utils/peerAddress.ts`](../../src/utils/peerAddress.ts)

在 `UDS_INBOX` 打开时，`to` 可以是：

- teammate name
- `*`
- `uds:/path/to.sock`
- `bridge:session_...`

`parseAddress()` 会把它收束成：

- `scheme: 'uds'`
- `scheme: 'bridge'`
- `scheme: 'other'`

而且还保留了一个兼容分支：

- 以 `/` 开头的 bare socket path 会被当成 `uds`

这说明 `SendMessageTool` 已经不是“team member mailbox wrapper”，而是统一 peer-routing front door。

## 5. prompt 明确把 `ListPeers` 放成 cross-session 发现入口，但当前镜像只拿到了调用 contract

源码镜像：[`../../src/tools/SendMessageTool/prompt.ts`](../../src/tools/SendMessageTool/prompt.ts), [`../../src/commands.ts`](../../src/commands.ts), [`../../src/tools.ts`](../../src/tools.ts), [`../../src/utils/concurrentSessions.ts`](../../src/utils/concurrentSessions.ts)

提示词和命令/工具装配都明确说了：

- cross-session send 之前用 `ListPeers`
- `claude ps`/session registry 通过 `concurrentSessions.ts` 暴露 peer metadata

但当前源码镜像里：

- `tools/ListPeersTool/**`
- `commands/peers/**`

主体没有展开。能确认的是 contract：

- `SendMessageTool` 在 prompt 层依赖 `ListPeers`
- `concurrentSessions.ts` 会把 `messagingSocketPath`、`bridgeSessionId`、`name` 写进会话 PID 文件

因此这条“peer discovery”链目前只能写到可见边界，不能假装已经掌握 `ListPeersTool` 内部实现。

## 6. `SendMessageTool` 被声明成 `shouldDefer`，说明它在 query loop 里不是急同步动作，而是可延后副作用

源码镜像：[`../../src/tools/SendMessageTool/SendMessageTool.ts`](../../src/tools/SendMessageTool/SendMessageTool.ts)

定义里直接写了：

- `shouldDefer: true`

这意味着它和文件写入、agent spawn 一样，属于可以排进 deferred tool-execution 队列的副作用工具，而不是必须先落地、再继续采样的即时只读查询。

## 7. `isReadOnly()` 只对 string message 返回 true，说明 structured protocol 被视作真正状态变更

源码镜像：[`../../src/tools/SendMessageTool/SendMessageTool.ts`](../../src/tools/SendMessageTool/SendMessageTool.ts)

这里的判定不是看“有没有写文件”，而是：

- plain string: `true`
- structured message: `false`

含义是：

- 一条普通 teammate 文本消息，被视作协调性读取/通知
- shutdown/plan response，会真正推进 runtime 状态机

所以同一工具内部已经编码了“聊天消息”和“控制协议”两种不同风险等级。

## 8. `backfillObservableInput()` 说明 transcript/observability 面看到的是归一化协议，不是原始 JSON 输入

源码镜像：[`../../src/tools/SendMessageTool/SendMessageTool.ts`](../../src/tools/SendMessageTool/SendMessageTool.ts)

它会把输入规范化成：

- `type = broadcast | message | shutdown_request | shutdown_response | plan_approval_response`
- `recipient`
- `request_id`
- `content`

也就是说，自动分类器和可观察输入面不是直接读原始 schema，而是读一层 tool-owned normalized view。

## 9. `toAutoClassifierInput()` 故意把结构化协议压成短语义串，说明 classifier 看的是“动作意图”而不是 message body

源码镜像：[`../../src/tools/SendMessageTool/SendMessageTool.ts`](../../src/tools/SendMessageTool/SendMessageTool.ts)

几类输出大致是：

- `to researcher: ...`
- `shutdown_request to researcher`
- `shutdown_response approve abc123`
- `plan_approval reject to teammate`

所以自动审批/分类链真正看到的是“这轮通信在做什么”，不是完整私聊内容。

## 10. 权限层只对 `bridge:` 目标强制 ask，而且这条 ask 是 bypass-immune safety check

源码镜像：[`../../src/tools/SendMessageTool/SendMessageTool.ts`](../../src/tools/SendMessageTool/SendMessageTool.ts)

`checkPermissions(...)` 只有一条特殊分支：

- `bridge:` 目标

结果是：

- `behavior: 'ask'`
- `decisionReason.type = 'safetyCheck'`
- `classifierApprovable: false`

注释也把原因写死了：

- cross-machine prompt injection 必须显式用户同意
- auto-mode allowlist / bypassPermissions 都不能绕过

所以 `SendMessageTool` 的真正高风险边界不是本地 teammate，而是跨机器把消息投递成另一台 Claude 的用户提示。

## 11. 输入校验层把几种错误语义明确拆开，而不是全部丢进“发送失败”

源码镜像：[`../../src/tools/SendMessageTool/SendMessageTool.ts`](../../src/tools/SendMessageTool/SendMessageTool.ts)

`validateInput(...)` 至少拆了这些规则：

- `to` 不能为空
- `@` 不允许出现在 `to`
- `bridge/uds` target 不能为空
- string message 必须带 `summary`
- structured message 不能 broadcast
- cross-session 不允许 structured message
- `shutdown_response` 只能发给 `team-lead`
- reject shutdown 时必须给 `reason`

这说明工具故意把“输入协议不合法”和“运行时投递失败”分层处理。

## 12. `summary` 不是 UI 点缀，而是 plain text message 的强制 preview contract

源码镜像：[`../../src/tools/SendMessageTool/SendMessageTool.ts`](../../src/tools/SendMessageTool/prompt.ts), [`../../src/utils/teammateMailbox.ts`](../../src/utils/teammateMailbox.ts)

当 `message` 是 string 时：

- `summary` 必填

这和 `getLastPeerDmSummary()` 正好闭环：

- transcript 尾部如果上一轮以 peer DM 结束
- 它会优先拿 `summary`
- 没有才 fallback 到正文前 80 字

所以 `summary` 不是锦上添花，而是整个 swarm/operator 面用来压缩最近通信状态的正式字段。

## 13. string message 的第一条分流不是 mailbox，而是“能不能先命中 local_agent route”

源码镜像：[`../../src/tools/SendMessageTool/SendMessageTool.ts`](../../src/state/AppStateStore.ts), [`../../src/tasks/LocalAgentTask/LocalAgentTask.tsx`](../../src/tools/AgentTool/AgentTool.tsx)

在真正写 mailbox 之前，工具会先检查：

- `appState.agentNameRegistry.get(input.to)`
- `toAgentId(input.to)`

这条表来自 `AgentTool` 异步 spawn 时写入：

- `name -> agentId`

所以 `SendMessageTool` 的第一优先级不是“按 teammate 名称查 team file”，而是：

- 先看目标是不是一个本地 background `local_agent`
- 包括显式名字和原始 `agentId`

## 14. 命中运行中的 `local_agent` 时，它不会立刻把文本喂给模型，而是只入 `pendingMessages` 队列

源码镜像：[`../../src/tools/SendMessageTool/SendMessageTool.ts`](../../src/tasks/LocalAgentTask/LocalAgentTask.tsx)

运行中的 local agent 分支会：

- `queuePendingMessage(agentId, input.message, ...)`

返回：

- `Message queued for delivery ... at its next tool round`

这里的关键不是“消息发出去了”，而是：

- 它不会中断 agent 当前正在执行的 tool round
- 只把消息压进 `pendingMessages`
- 等 receiver 下一次 tool-round 边界自行 drain

这和 prompt 里对 UDS/bridge 的描述是同一套语义：消息会 enqueue，而不是打断执行。

## 15. 命中已停止的 `local_agent` 时，`SendMessageTool` 会转成一条 resume runtime，而不是报目标离线

源码镜像：[`../../src/tools/SendMessageTool/SendMessageTool.ts`](../../src/tools/AgentTool/resumeAgent.ts)

如果命中的是：

- stopped local agent task
- 或 registry 里仍有 name/agentId，但 AppState task 已被驱逐

它不会简单失败，而会尝试：

- `resumeAgentBackground(...)`

返回语义也变成：

- resumed in the background
- output file path

所以对 background subagent 来说，`SendMessageTool` 兼任了“继续说话”和“自动恢复上下文”的双重入口。

## 16. 只有 local-agent route miss 掉以后，plain text 才会落到 team mailbox：定向或广播

源码镜像：[`../../src/tools/SendMessageTool/SendMessageTool.ts`](../../src/utils/teammateMailbox.ts)

如果不是 local agent，string path 才会分成：

- `to === '*'` -> `handleBroadcast(...)`
- 其他 -> `handleMessage(...)`

两者最终都调用：

- `writeToMailbox(...)`

所以 swarm mailbox 并不是这工具唯一的数据面，而是 local-agent queue/resume miss 之后的第二层宿主。

## 17. 广播的真实语义是“遍历 team file，排除自己，再逐个写 inbox”，因此成本线性且不带原子 fan-out

源码镜像：[`../../src/tools/SendMessageTool/SendMessageTool.ts`](../../src/utils/swarm/teamHelpers.ts)

`handleBroadcast(...)` 会：

- `readTeamFileAsync(teamName)`
- 遍历 `teamFile.members`
- 排除 sender
- 对每个 recipient 单独 `writeToMailbox(...)`

这和 prompt 中“broadcast is expensive” 完全一致：它不是总线级一次 fan-out，而是 `O(n)` 的逐成员 inbox 写入。

## 18. structured protocol 不是走通用 message path，而是分成 shutdown 和 plan 两条显式状态机

源码镜像：[`../../src/tools/SendMessageTool/SendMessageTool.ts`](../../src/utils/teammateMailbox.ts)

`call(...)` 对 structured message 的 switch 只有：

- `shutdown_request`
- `shutdown_response`
- `plan_approval_response`

其中 shutdown_request 会生成正式 `request_id`，plan approval 则不会“自由传消息”，而是回写固定字段：

- `approved`
- `permissionMode`
- `feedback?`

这说明 `SendMessageTool` 的 structured 部分不是任意 JSON mailbox，而是高度受限的 protocol opcodes。

## 19. shutdown approve 是整篇里最强副作用路径：先回执，再触发本地 abort 或进程退出

源码镜像：[`../../src/tools/SendMessageTool/SendMessageTool.ts`](../../src/tools/SendMessageTool/SendMessageTool.ts), [`../../src/utils/teammateMailbox.ts`](../../src/utils/teammateMailbox.ts), [`../../src/tasks/LocalAgentTask/LocalAgentTask.tsx`](../../src/tasks/LocalAgentTask/LocalAgentTask.tsx)

`handleShutdownApproval(...)` 做了几件事：

- 查 team file 恢复 `paneId/backendType`
- 写 `shutdown_approved` mailbox 回执给 `team-lead`
- 如果是 `in-process` teammate：
  - 找 task
  - `abortController.abort()`
- 否则：
  - fallback 再找 task
  - 还不行就 `setImmediate(() => gracefulShutdown(...))`

也就是说，approval 不是礼貌性确认，而是真正把 receiver 带向退出。

## 20. plan approve/reject 只能由 team lead 发出，而且 approve 会继承 leader 当前 permission mode

源码镜像：[`../../src/tools/SendMessageTool/SendMessageTool.ts`](../../src/Tool.ts)

plan 分支最关键的不是 mailbox 写回，而是：

- `Only the team lead can approve/reject plans`
- `leaderMode === 'plan' ? 'default' : leaderMode`

也就是说，leader 在 plan mode 下批准某个 teammate 进入执行，并不会把 `plan` mode 直接传给对方，而是把：

- `default`
- 或当前非-plan 模式

作为 `permissionMode` 继承过去。

## 21. `UI.tsx` 故意把大部分 routing/result 面静默掉，说明这工具的可视真相主要在别的表面

源码镜像：[`../../src/tools/SendMessageTool/UI.tsx`](../../src/tools/SendMessageTool/SendMessageTool.ts)

UI 策略非常克制：

- structured `plan_approval_response` 的 tool_use 才有一行短标签
- 有 `routing` 的 result 返回 `null`
- 有 `request_id + target` 的 protocol result 也返回 `null`
- 只剩普通纯消息字符串时，才显示 dim message

原因很明确：

- 真正有价值的消息内容会在 inbox/transcript/detail surface 里再次出现
- 这里不想额外复制一份 tool chrome

## 22. `directMemberMessage.ts` 和 `SendMessageTool` 不是重复实现，而是 user fast-path 和 model tool-path 的两套入口

源码镜像：[`../../src/utils/directMemberMessage.ts`](../../src/utils/directMemberMessage.ts), [`../../src/tools/SendMessageTool/SendMessageTool.ts`](../../src/tools/SendMessageTool/SendMessageTool.ts)

两者都会写 mailbox，但宿主不同：

- `sendDirectMemberMessage(...)`
  - 解析 `@agent hi`
  - sender 固定成 `user`
  - 直接绕过模型
- `SendMessageTool`
  - sender 是 leader/teammate/agent
  - 带 summary / protocol message / local-agent route / bridge/UDS route

因此 `@agent` 不是 `SendMessageTool` 的语法糖；它是用户输入层的独立 fast path，而 `SendMessageTool` 是模型和 agent runtime 的正式通信工具。

## 23. cross-session send 的真正 transport 主体在当前镜像里缺失，所以这里只能确认 call-site contract

源码镜像：[`../../src/tools/SendMessageTool/SendMessageTool.ts`](../../src/utils/messages/systemInit.ts), [`../../src/utils/concurrentSessions.ts`](../../src/bridge/replBridge.ts)

当前镜像能确认的事实有：

- `bridge:` path 调 `postInterClaudeMessage(...)`
- `uds:` path 调 `sendToUdsSocket(...)`
- `systemInit.ts` 会把 `messaging_socket_path` 注入 init message
- `concurrentSessions.ts` 会把 `messagingSocketPath` 和 `bridgeSessionId` 写进 session PID registry
- `replBridge.ts` 注释里明确区分了 transport connect / writeMessages / inbound prompt 流

但以下主体在当前镜像里不存在：

- `bridge/peerSessions`
- `utils/udsClient`
- `tools/ListPeersTool/**`

所以这篇能证明的只是：

- `SendMessageTool` 已经正式支持 cross-session address scheme
- bridge/UDS 的 runtime contract 已经写进 prompt、validation、permission 和 call-site

而不能继续伪造更深的 transport 内部细节。

## 24. headless/print 也要专门轮询 teammate 消息，说明 SendMessage 不是 REPL-only 机制

源码镜像：[`../../src/cli/print.ts`](../../src/cli/print.ts)

`print.ts` 在等待队列空闲时会显式做：

- poll unread teammate messages
- 一直轮询到 teammates 结束

注释写得很清楚：

- teammates may send messages while we're waiting

这说明 `SendMessageTool` 的产物不是 REPL 界面私有消息，而是跨宿主的正式协调通道；不然 headless 模式根本不必补这条 polling sidecar。

## 25. `SendMessageTool` 真正把三种通信宿主收束到了一起：background local agent、team mailbox、cross-session peer

从现有源码看，它至少统一了三类完全不同的投递目标：

- `local_agent`
  - queue / resume / output file
- `team teammate`
  - mailbox / broadcast / shutdown / plan approval
- `cross-session peer`
  - `uds:` / `bridge:` address contract

所以它的产品角色已经不是“给队友发消息”，而是 Claude Code 的：

- peer-routing runtime
- mailbox protocol entrypoint
- background-agent continuation surface
- limited cross-session relay front door

## 相关卷册

- 前台 `@agent` fast path 与 mailbox transcript surface：[`../architecture/24-swarm-banner-direct-messages-and-mailbox-surfaces.md`](../architecture/24-swarm-banner-direct-messages-and-mailbox-surfaces.md)
- inbox 协议与 shutdown/plan mailbox 分流：[`./21-swarm-inbox-routing-and-approval-protocols.md`](./21-swarm-inbox-routing-and-approval-protocols.md)
- background local agent 的 pending message / retain host：[`./53-local-agent-task-retention-panel-and-notification-runtime.md`](./53-local-agent-task-retention-panel-and-notification-runtime.md)
- AgentTool 的 name registry 与 async continuation hint：[`./51-agent-definitions-selection-spawn-and-handoff-runtime.md`](./51-agent-definitions-selection-spawn-and-handoff-runtime.md)
