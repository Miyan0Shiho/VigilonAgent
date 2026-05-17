# Bridge Runtime、Polling 与 Message Routing

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Swarm Discovery / Layout / Spawn Inheritance`](./18-swarm-discovery-layout-and-spawn-inheritance.md) | [`下一站：Bridge Transport / Auth / Session Identity`](./20-bridge-transport-auth-and-session-identity.md)

本文不再讲 bridge 的登录对话框、QR handoff 或 teleport repo 修正，而是专门下钻 CLI 与远端环境之间真正持续运行的 bridge runtime：环境注册、work poll、session spawn、heartbeat、OAuth 重试、transport swap、ingress 去重，以及 server control request 如何安全落到本地 REPL。

## 1. 这层才是 Claude Code bridge 变成“长期在线 worker”的核心

源码镜像：[`../../sources/claude-code/src/bridge/bridgeMain.ts`](../../sources/claude-code/src/bridge/bridgeMain.ts), [`../../sources/claude-code/src/bridge/bridgeApi.ts`](../../sources/claude-code/src/bridge/bridgeApi.ts), [`../../sources/claude-code/src/bridge/replBridge.ts`](../../sources/claude-code/src/bridge/replBridge.ts), [`../../sources/claude-code/src/bridge/bridgeMessaging.ts`](../../sources/claude-code/src/bridge/bridgeMessaging.ts)

前面的 bridge UI 卷册解决的是“怎么接入”和“怎么操作”，这一层解决的是更难的问题：

- 远端工作项如何持续投递到本地 worker
- 一个 bridge environment 如何同时管理多 session
- OAuth、trusted device、work lease、heartbeat 这些约束怎样压进同一条 poll loop
- server 发来的消息怎样去重、分类、回灌到本地 REPL
- inbound control request 怎样在不破坏本地权限语义的前提下执行

所以这里不是 bridge 的附属细节，而是它真正的 runtime 内核。

## 2. `runBridgeLoop()` 是 bridge 的长期 worker 主循环

源码镜像：[`../../sources/claude-code/src/bridge/bridgeMain.ts`](../../sources/claude-code/src/bridge/bridgeMain.ts)

`runBridgeLoop()` 接受：

- `BridgeConfig`
- `environmentId`
- `environmentSecret`
- `BridgeApiClient`
- `SessionSpawner`
- `BridgeLogger`
- `AbortSignal`
- `BackoffConfig`
- 可选 `initialSessionId`
- 可选 `getAccessToken`

这说明它不是 UI 回调，也不是一次性连接函数，而是 bridge environment 的长期 worker 主循环。它对外只暴露“配置 + API + spawn + 日志 + 中断”，其余 session、work、poll、cleanup 状态全部内聚在内部。

## 3. `runBridgeLoop()` 内部已经是多 session orchestration，而不是单连接壳

源码镜像：[`../../sources/claude-code/src/bridge/bridgeMain.ts`](../../sources/claude-code/src/bridge/bridgeMain.ts)

这层内部维护的核心状态包括：

- `activeSessions`
- `sessionStartTimes`
- `sessionWorkIds`
- `sessionCompatIds`
- `sessionIngressTokens`
- `sessionTimers`
- `completedWorkIds`
- `sessionWorktrees`
- `timedOutSessions`
- `titledSessions`

这组状态说明 bridge runtime 不是“poll 到一个工作，拉起一个子进程，然后等它结束”的脚本，而是一个真正的 session coordinator。它同时追踪：

- 运行中的本地 session handle
- server work item 与本地 session 的对应关系
- compat / infra session id 映射
- ingress JWT 与 OAuth token 的分离
- watchdog timeout、cleanup 与标题状态

所以 bridge 的最小单位不是 socket，而是 environment 下的一组被编排的 session。

## 4. `SPAWN_SESSIONS_DEFAULT` 和 `isMultiSessionSpawnEnabled()` 说明多会话是正式能力，不是后门

源码镜像：[`../../sources/claude-code/src/bridge/bridgeMain.ts`](../../sources/claude-code/src/bridge/bridgeMain.ts)

这里显式定义了：

- `SPAWN_SESSIONS_DEFAULT = 32`
- `isMultiSessionSpawnEnabled()`

并且注释已经点明这是多 session per environment 的正式 gate，而不是调试开关。也就是说，bridge runtime 的设计目标本来就包含：

- 一个 host:dir 对应一个 environment
- 该 environment 可承载多个 session
- web 侧可以根据 capacity 选择是否派发更多工作

这让 Claude Code on the web 看到的不是“是否在线”，而是“当前还能接多少活”。

## 5. `createSessionSpawner()` 和 `spawnScriptArgs()` 说明本地 worker 拉起也有构建形态兼容层

源码镜像：[`../../sources/claude-code/src/bridge/bridgeMain.ts`](../../sources/claude-code/src/bridge/sessionRunner.ts)

这一层没有假设所有本地 bridge worker 都能直接运行 `claude`。`spawnScriptArgs()` 明确区分：

- bundled mode：直接用 `process.execPath`
- npm / node 脚本模式：要把 `process.argv[1]` 作为脚本入口补进去

注释已经解释了原因：否则 node 会把 `--sdk-url` 之类参数误当成 node 自己的启动参数。bridge runtime 在这里解决的是“本地 child session 怎么在不同打包形态下稳定拉起”的兼容问题。

## 6. `heartbeatActiveWorkItems()` 说明 bridge 保活的是 work lease，不只是 transport 活性

源码镜像：[`../../sources/claude-code/src/bridge/bridgeMain.ts`](../../sources/claude-code/src/bridge/bridgeApi.ts)

这段逻辑的关键不是“session 还活着吗”，而是“server 上的 work lease 还活着吗”。它会：

- 遍历 `activeSessions`
- 通过 `sessionWorkIds` 和 `sessionIngressTokens` 找到 workId + ingress JWT
- 调 `api.heartbeatWork(environmentId, workId, ingressToken)`

返回值被压缩成：

- `'ok'`
- `'auth_failed'`
- `'fatal'`
- `'failed'`

这说明 bridge runtime 的心跳协议围绕的是远端工作项的续租，而不是简单 ping REPL socket。

## 7. 401/403 heartbeat 失败会走 `reconnectSession()`，因为核心问题是“工作需要重新派发”

源码镜像：[`../../sources/claude-code/src/bridge/bridgeMain.ts`](../../sources/claude-code/src/bridge/bridgeApi.ts)

`heartbeatActiveWorkItems()` 遇到 `BridgeFatalError` 且状态为 `401/403` 时，不是直接杀本地 session，而是把 `sessionId` 加进 `authFailedSessions`，然后调用：

- `api.reconnectSession(environmentId, sessionId)`

注释已经解释了这个设计：如果 ingress JWT 过期，而工作还被 ACK 出 PEL，不触发 server 侧重新投递，就会出现本地一直空轮询、远端工作却永远不回来的死锁。所以 bridge runtime 把 401/403 解释成“需要 server 重新派发这条工作”，而不是单纯 transport auth error。

## 8. `BackoffConfig` 把连接错误和一般错误分成两套预算

源码镜像：[`../../sources/claude-code/src/bridge/bridgeMain.ts`](../../sources/claude-code/src/bridge/replBridge.ts)

`BackoffConfig` 不是单一指数退避，它分成：

- `connInitialMs / connCapMs / connGiveUpMs`
- `generalInitialMs / generalCapMs / generalGiveUpMs`

并且还单独带：

- `shutdownGraceMs`
- `stopWorkBaseDelayMs`

这说明 bridge runtime 已经承认两类错误语义不同：

- 连接类错误更像 transport / network / poll loop 问题
- 一般错误更像 work 处理、会话控制或 stopWork 重试问题

所以它的容错模型不是“所有异常统一 sleep 再试”。

## 9. `pollSleepDetectionThresholdMs()` 说明 bridge 专门防系统睡眠把错误预算无限重置

源码镜像：[`../../sources/claude-code/src/bridge/bridgeMain.ts`](../../sources/claude-code/src/bridge/replBridge.ts)

这一层把 sleep/wake detection 阈值定义成 `connCapMs * 2`，注释直接指出目的：

- 阈值必须大于最大 backoff cap
- 否则正常 backoff 会被误判为系统睡眠
- 进而错误地重置错误预算

这说明 bridge runtime 不只是处理“请求失败”，还显式处理“宿主机器睡眠后恢复”的本地环境扰动。

## 10. `createBridgeApiClient()` 把 OAuth、trusted device 和 URL path safety 包在同一 HTTP 边界里

源码镜像：[`../../sources/claude-code/src/bridge/bridgeApi.ts`](../../sources/claude-code/src/bridge/bridgeApi.ts)

`createBridgeApiClient()` 里有三个关键边界：

- `validateBridgeId()`：限制 server 提供的 path segment 只能匹配安全字符
- `withOAuthRetry()`：401 时可尝试 OAuth refresh 并重试一次
- `getHeaders()`：统一注入 `Authorization`、`anthropic-beta`、runner version、可选 trusted device token

这三层叠起来说明 bridge API client 不是薄 axios 壳，而是：

- URL 注入防线
- auth refresh 策略层
- request metadata 编排层

## 11. `registerBridgeEnvironment()` 的 payload 已经暴露出 web 端环境调度所需的最小模型

源码镜像：[`../../sources/claude-code/src/bridge/bridgeApi.ts`](../../sources/claude-code/src/bridge/types.ts)

注册环境时会发送：

- `machine_name`
- `directory`
- `branch`
- `git_repo_url`
- `max_sessions`
- `metadata.worker_type`
- 可选 `environment_id` 作为 `reuseEnvironmentId`

这说明 server/web 侧需要看到的不只是“某台机器上线了”，还要知道：

- 当前 repo / branch 是什么
- 这是哪种 worker
- 当前最多能承载几个 session
- 这次是不是在恢复既有 environment

也就是说，bridge environment 本身已经是带产品语义的可调度对象。

## 12. `pollForWork()` 的“空轮询计数”说明 bridge 把 no-work 视作正常稳定态

源码镜像：[`../../sources/claude-code/src/bridge/bridgeApi.ts`](../../sources/claude-code/src/bridge/pollConfig.ts)

`pollForWork()` 会维护：

- `consecutiveEmptyPolls`
- `EMPTY_POLL_LOG_INTERVAL`

并且只有首个 empty 或每隔固定次数才打日志。这说明 bridge runtime 对 “poll 返回 null” 的理解是：

- 正常空闲，不是错误
- 需要低噪声观测，而不是把日志刷爆

同时它还支持可选参数：

- `reclaim_older_than_ms`

这表明 work poll 不只是被动取任务，还能配合 server 回收过旧 lease。

## 13. `initBridgeCore()` 是 bootstrap-free core，`replBridge.ts` 只是 REPL wrapper

源码镜像：[`../../sources/claude-code/src/bridge/replBridge.ts`](../../sources/claude-code/src/bridge/bridgeMain.ts)

`replBridge.ts` 里对 `BridgeCoreParams` 的注释说得很明确：这是一套 bootstrap-free core 输入。它要求调用方显式提供：

- cwd / git / title
- access token 获取器
- `createSession`
- `archiveSession`
- `toSDKMessages`
- `onAuth401`
- `getPollIntervalConfig`
- `onInboundMessage`
- `onPermissionResponse`
- `onInterrupt`
- `onSetModel`
- `onSetMaxThinkingTokens`
- `onSetPermissionMode`

这说明 Claude Code 有意识地把 bridge runtime 核心做成“与 main.tsx / sessionStorage / command registry 解耦”的可嵌入核心；REPL 只是其中一个包装器。

## 14. `initBridgeCore()` 真正管理的是 environment registration -> session creation -> poll loop -> ingress transport 的整条链

源码镜像：[`../../sources/claude-code/src/bridge/replBridge.ts`](../../sources/claude-code/src/bridge/bridgeApi.ts)

`initBridgeCore()` 的职责不是单点：

- 注册 environment
- 创建 / 归档 session
- 建立 ingress transport
- 维持 poll loop
- 在 transport swap 时保留高水位
- 在 teardown 时释放资源

这意味着 bridge runtime 的真正“会话壳”并不在命令层，也不在 UI，对应的就是这个 core。

## 15. `lastTransportSequenceNum` 和 `recentInboundUUIDs` 说明 bridge 把 replay 问题当一等公民处理

源码镜像：[`../../sources/claude-code/src/bridge/replBridge.ts`](../../sources/claude-code/src/bridge/bridgeMessaging.ts)

这层有两套去重 / 恢复机制：

- `lastTransportSequenceNum`
  - 用于 transport swap 或进程恢复时通过 `from_sequence_num` 避免 server 重放全历史
- `recentInboundUUIDs`
  - 用于防御式去重，挡掉 server 因协商失效而重复投递的 inbound user 消息

再配合 `recentPostedUUIDs` 去掉自己发出去又被 server echo 回来的消息，bridge runtime 实际上把“消息可能被 replay / echo / 重投”当成了默认威胁模型。

## 16. `handleIngressMessage()` 把 server 输入拆成三条路：control response、control request、SDK message

源码镜像：[`../../sources/claude-code/src/bridge/bridgeMessaging.ts`](../../sources/claude-code/src/bridge/bridgeMessaging.ts), [`../../sources/claude-code/src/entrypoints/agentSdkTypes.ts`](../../sources/claude-code/src/entrypoints/agentSdkTypes.ts), [`../../sources/claude-code/src/bridge/replBridge.ts`](../../sources/claude-code/src/bridge/replBridge.ts)

`handleIngressMessage()` 的路由顺序是：

- 先识别 `control_response`
- 再识别 `control_request`
- 最后才看是否是 `SDKMessage`

而不是反过来。这是因为：

- `control_response` 不是普通 SDK message
- `control_request` 必须快速响应，否则 server 会主动断开 WS

这一层已经不只是 JSON parse，而是带协议时序要求的 ingress dispatcher。

## 17. `BoundedUUIDSet` + `recentPostedUUIDs` 解决的是 echo 问题，而不是一般缓存问题

源码镜像：[`../../sources/claude-code/src/bridge/bridgeMessaging.ts`](../../sources/claude-code/src/bridge/replBridge.ts)

这套 UUID 集合的产品语义非常明确：

- `recentPostedUUIDs`
  - 记录本地刚投给 bridge transport 的消息
  - 如果 server 又把同 UUID 消息推回来，就判为 echo
- `recentInboundUUIDs`
  - 记录已被接收入本地 REPL 的远端 user 消息
  - 如果 transport swap 后 server 重放，就判为 re-delivery

所以它们不是一般“去重缓存”，而是专门针对 bridge 双向 transport 的 echo/replay 协议补丁。

## 18. `isEligibleBridgeMessage()` 说明并非所有本地 transcript 都会上送远端

源码镜像：[`../../sources/claude-code/src/bridge/bridgeMessaging.ts`](../../sources/claude-code/src/bridge/bridgeMessaging.ts), [`../../sources/claude-code/src/bridge/replBridge.ts`](../../sources/claude-code/src/bridge/replBridge.ts)

这一层明确过滤：

- virtual `user/assistant`
- 非 `user`
- 非 `assistant`
- 非 `system/local_command`

也就是说，bridge outward projection 的模型是：

- 人类 turn
- assistant turn
- slash command system event

而不是整个 REPL transcript 原样镜像。tool_result、progress、内部虚拟消息都被留在本地。

## 19. `extractTitleText()` 说明 session title 只从“真人文本输入”里提炼

源码镜像：[`../../sources/claude-code/src/bridge/bridgeMessaging.ts`](../../sources/claude-code/src/bridge/replBridge.ts)

`extractTitleText()` 会排除：

- 非 user 消息
- meta / nudge
- tool result
- compact summary
- 非 human origin
- 纯 display-tag 内容

这说明 bridge runtime 不接受“任何文本都可做标题”，而是把 title derivation 绑定到真正的人类 prompt 上，避免控制消息、摘要、系统标签污染远端 session card。

## 20. `handleServerControlRequest()` 把 inbound remote control 做成了受策略约束的本地能力桥

源码镜像：[`../../sources/claude-code/src/bridge/bridgeMessaging.ts`](../../sources/claude-code/src/bridge/replBridge.ts)

server 发来的 control request 可能要求：

- `interrupt`
- `set_model`
- `set_max_thinking_tokens`
- `set_permission_mode`

这层不会直接改全局状态，而是通过注入回调：

- `onInterrupt`
- `onSetModel`
- `onSetMaxThinkingTokens`
- `onSetPermissionMode`

尤其 `onSetPermissionMode` 的注释已经写明，调用方必须先做：

- auto mode gate 检查
- bypassPermissions 可用性检查

再去 transition。说明 remote control 的本地落地不是“server 说了算”，而是经过本地策略守卫的能力桥。

## 21. outbound-only 模式下，mutable control request 会返回显式错误而不是假成功

源码镜像：[`../../sources/claude-code/src/bridge/bridgeMessaging.ts`](../../sources/claude-code/src/bridge/replBridge.ts)

`ServerControlRequestHandlers` 里有：

- `outboundOnly?: boolean`

注释明确规定：

- `initialize` 仍然要回 success，否则 server 会杀连接
- 其他可变请求要回 error，而不是 false-success

这说明 Claude Code 在协议层区分了两件事：

- 连接是否存在
- 远端是否有权驱动本地变更

所以 outbound-only 不是断桥，而是只保留可观察、不保留可控写入的一种 runtime 模式。

## 22. bridge runtime 的消息和控制设计，本质上是在给 claude.ai/code 提供“可恢复、可调度、可受控”的本地执行器

源码镜像：[`../../sources/claude-code/src/bridge/bridgeMain.ts`](../../sources/claude-code/src/bridge/bridgeApi.ts), [`../../sources/claude-code/src/bridge/replBridge.ts`](../../sources/claude-code/src/bridge/replBridge.ts), [`../../sources/claude-code/src/bridge/bridgeMessaging.ts`](../../sources/claude-code/src/bridge/bridgeMessaging.ts)

把这几层放在一起看，Claude Code bridge runtime 的真实形态已经很清楚：

- `bridgeApi.ts` 提供受 OAuth、trusted device、URL safety 保护的 server API 边界
- `bridgeMain.ts` 提供 environment 级别的 poll、heartbeat、spawn、backoff、timeout 编排
- `replBridge.ts` 提供 REPL 包装层和 bootstrap-free core 接缝
- `bridgeMessaging.ts` 提供 echo/replay 防御、title 提取、control request 路由和 outbound-only 保护

所以所谓 bridge，不是“把网页和本地终端连一下”，而是把本地 Claude Code 重新包装成一个长期在线、可多会话调度、受本地策略保护、能与远端状态持续同步的 worker runtime。
