# Bridge Transport、Auth 与 Session Identity

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Bridge Runtime / Polling / Message Routing`](./19-bridge-runtime-polling-and-message-routing.md) | [`下一站：Swarm Inbox Routing / Approval Protocols`](./21-swarm-inbox-routing-and-approval-protocols.md)

本文继续下钻 bridge，但不再讲 poll loop 本身，而是专门拆那组决定“远端事件怎么进来、本地事件怎么出去、session 身份怎么对齐、认证怎么跨层传递”的侧链：`replBridgeTransport.ts`、`workSecret.ts`、`trustedDevice.ts`、`sessionIdCompat.ts`。

## 1. 这层解决的是 bridge runtime 能不能稳定跨协议、跨 tag、跨认证域工作

源码镜像：[`../../sources/claude-code/src/bridge/replBridgeTransport.ts`](../../sources/claude-code/src/bridge/replBridgeTransport.ts), [`../../sources/claude-code/src/bridge/workSecret.ts`](../../sources/claude-code/src/bridge/workSecret.ts), [`../../sources/claude-code/src/bridge/trustedDevice.ts`](../../sources/claude-code/src/bridge/trustedDevice.ts), [`../../sources/claude-code/src/bridge/sessionIdCompat.ts`](../../sources/claude-code/src/bridge/sessionIdCompat.ts)

前一篇 `mechanisms/19` 关注的是主循环和消息路由；这一层关注的是更底下的协议粘合：

- v1 / v2 transport 如何被压平成一个 REPL 可消费的接口
- `work secret` 如何把 session ingress token 和 API base URL 携带给本地 worker
- trusted-device token 如何变成 bridge API 的安全 sidecar
- `session_*` 和 `cse_*` 这两套 ID 标签如何在 compat 层来回换装

如果没有这层，bridge runtime 虽然有 poll loop，也会在 transport、auth 或 session identity 这几处频繁失配。

## 2. `ReplBridgeTransport` 不是简单接口，而是 bridge 对两套底层传输协议的统一契约

源码镜像：[`../../sources/claude-code/src/bridge/replBridgeTransport.ts`](../../sources/claude-code/src/bridge/replBridgeTransport.ts)

`ReplBridgeTransport` 暴露的最小面包括：

- `write()` / `writeBatch()`
- `setOnData()` / `setOnClose()` / `setOnConnect()`
- `connect()` / `close()` / `flush()`
- `isConnectedStatus()` / `getStateLabel()`
- `getLastSequenceNum()`
- `droppedBatchCount`
- `reportState()`
- `reportMetadata()`
- `reportDelivery()`

这说明 bridge transport 抽象不只是“能收能发”，而是同时承载：

- 数据 IO
- lifecycle 回调
- replay 恢复高水位
- silent batch drop 观测
- worker state / metadata / delivery 上报

换句话说，它是 REPL bridge 对底层 transport 的完整能力契约，不是轻量包装。

## 3. `createV1ReplTransport()` 说明 v1 适配目标是“让 HybridTransport 看起来像统一桥接接口”

源码镜像：[`../../sources/claude-code/src/bridge/replBridgeTransport.ts`](../../sources/claude-code/src/cli/transports/HybridTransport.ts)

v1 适配层几乎是直通：

- `write`、`writeBatch`、`close`、`connect`
- callback wiring
- `droppedBatchCount`

但它故意把两块能力降成 no-op 或恒定值：

- `getLastSequenceNum()` 永远返回 `0`
- `reportState / reportMetadata / reportDelivery` 都是 no-op

这说明 Claude Code 没有强行让 v1 transport 假装支持 CCR v2 的高级能力，而是只把真正兼容的公共表面抽出来。

## 4. v1 的 `getLastSequenceNum() = 0` 明确承认 Session-Ingress WS 的 replay 语义和 SSE 不同

源码镜像：[`../../sources/claude-code/src/bridge/replBridgeTransport.ts`](../../sources/claude-code/src/bridge/replBridge.ts)

注释已经写明：

- v1 Session-Ingress WS 不使用 SSE sequence number
- replay 语义由 server 端 message cursor 处理

所以 bridge runtime 的高水位恢复逻辑不是“所有 transport 一视同仁”，而是：

- v1：无 sequence-num 恢复，靠既有 cursor 语义
- v2：显式传 `from_sequence_num / Last-Event-ID`

这正是 transport abstraction 真正有价值的地方。

## 5. `createV2ReplTransport()` 说明 v2 真正是“读写分离”的 transport 组合，而不是单个连接对象

源码镜像：[`../../sources/claude-code/src/bridge/replBridgeTransport.ts`](../../sources/claude-code/src/cli/transports/SSETransport.ts), [`../../sources/claude-code/src/cli/transports/ccrClient.ts`](../../sources/claude-code/src/cli/transports/ccrClient.ts)

v2 transport 不是一个类，而是：

- `SSETransport` 负责读
- `CCRClient` 负责写、heartbeat、state、delivery tracking

注释明确强调：

- v2 write path 走 `CCRClient.writeEvent`
- 不走 `SSETransport.write()`
- 因为后者对应的是旧 Session-Ingress POST URL 形状

这说明 CCR v2 的引入不是简单 URL 替换，而是读写协议都变了，因此需要组合式 transport 适配层。

## 6. `createV2ReplTransport()` 的 auth 处理说明 v2 认证域和 v1 正好相反

源码镜像：[`../../sources/claude-code/src/bridge/replBridgeTransport.ts`](../../sources/claude-code/src/bridge/workSecret.ts)

v2 的注释明确指出：

- worker endpoints 校验 JWT 的 `session_id` claim 和 worker role
- OAuth token 没这些 claim
- 这与 v1 的 replBridge 路径正好相反

所以 `createV2ReplTransport()` 必须接 ingress JWT，而不能复用 OAuth access token。bridge runtime 到这一步已经不只是“认证存在”，而是“同一 bridge 功能内部不同子协议需要不同 token 域”。

## 7. `getAuthToken` 与 `updateSessionIngressAuthToken()` 说明多 session 支持要求 transport 摆脱进程级 env 共享

源码镜像：[`../../sources/claude-code/src/bridge/replBridgeTransport.ts`](../../sources/claude-code/src/utils/sessionIngressAuth.ts)

v2 transport 支持两条 auth 注入路径：

- `getAuthToken`
  - per-instance
  - 多 session 安全
- 回退到 `updateSessionIngressAuthToken(ingressToken)`
  - 走进程级 env var
  - 只适合 legacy 单 session 路径

这说明 Claude Code 已经显式意识到：如果 transport 认证仍然依赖全局 env，共存的 bridge session 会互相踩 token。`getAuthToken` 的出现，就是把 bridge 从单会话脚本推向多会话 worker 的关键补丁。

## 8. `registerWorker()` 既是 CCR v2 注册动作，也是 worker epoch 的来源

源码镜像：[`../../sources/claude-code/src/bridge/workSecret.ts`](../../sources/claude-code/src/bridge/replBridgeTransport.ts)

`registerWorker(sessionUrl, accessToken)` 做的不只是“告诉 server 我在线了”，它返回：

- `worker_epoch`

而 `createV2ReplTransport()` 会：

- 若 `opts.epoch` 已提供，则直接使用
- 否则主动调用 `registerWorker()`

这说明 worker registration 在 bridge 里不是独立前置步骤，而是 transport handshake 的一部分；epoch 是后续所有 v2 worker 写请求的重要身份版本号。

## 9. epoch mismatch 不是普通错误，而是“当前 worker 身份已经被新实例取代”

源码镜像：[`../../sources/claude-code/src/bridge/replBridgeTransport.ts`](../../sources/claude-code/src/cli/transports/ccrClient.ts)

`createV2ReplTransport()` 给 `CCRClient` 传入的 `onEpochMismatch` 逻辑不是简单重试，而是：

- 记录日志
- `ccr.close()`
- `sse.close()`
- 触发 `onCloseCb?.(4090)`
- 最后抛出 `Error('epoch superseded')`

这说明 epoch mismatch 被解释成：

- 当前 worker 已经过期
- 应该退出当前 transport
- 让上层 poll loop 重新捡 server 重新分派的工作

所以它是一种 worker 身份失效协议，不是一般网络抖动。

## 10. `setOnEvent(received + processed)` 的覆写说明 bridge transport 专门修过“daemon 重启后事件反复回灌”的问题

源码镜像：[`../../sources/claude-code/src/bridge/replBridgeTransport.ts`](../../sources/claude-code/src/cli/transports/SSETransport.ts)

代码里有一段很关键的注释：默认情况下事件可能长期停留在 `received`，导致 daemon 重启后 `reconnectSession` 把它们一再重派，形成 phantom prompts。

所以 transport 在这里直接覆写 `sse.setOnEvent()`，把每个事件都立即：

- `reportDelivery(..., 'received')`
- `reportDelivery(..., 'processed')`

这说明 delivery 状态不只是分析指标，而是会反过来影响 server 是否认为这条事件还需要重新投递。

## 11. `outboundOnly` 说明 v2 transport 可以被裁成只写不读的镜像型附件

源码镜像：[`../../sources/claude-code/src/bridge/replBridgeTransport.ts`](../../sources/claude-code/src/bridge/bridgeMessaging.ts)

`createV2ReplTransport()` 支持：

- `outboundOnly?: boolean`

注释写得很明确：

- 跳过 SSE read stream
- 只保留 CCRClient write path
- 用于 mirror-mode attachments

这说明 transport 层已经能表达“本地只把事件镜像给远端，但不接受 inbound prompt/control request”的运行模式，而不需要上层再做粗暴 if/else。

## 12. `decodeWorkSecret()` 说明 server 派发给 worker 的不是零散字段，而是一个版本化能力包

源码镜像：[`../../sources/claude-code/src/bridge/workSecret.ts`](../../sources/claude-code/src/bridge/types.ts)

`decodeWorkSecret()` 会：

- base64url decode
- JSON parse
- 校验 `version === 1`
- 校验 `session_ingress_token`
- 校验 `api_base_url`

这说明 work secret 不是随手拼的 opaque blob，而是带版本门槛的协议对象。它把 worker 真正需要的最小能力一起交给本地：

- ingress token
- API base URL

后续 build URL、注册 worker、连 ingress 都从这里生长出来。

## 13. `buildSdkUrl()` 和 `buildCCRv2SdkUrl()` 说明 bridge 并存两套 session URL 形状

源码镜像：[`../../sources/claude-code/src/bridge/workSecret.ts`](../../sources/claude-code/src/bridge/replBridgeTransport.ts)

`workSecret.ts` 里有两种 URL builder：

- `buildSdkUrl(apiBaseUrl, sessionId)`
  - 生成 `ws:// / wss://` 风格 Session-Ingress URL
  - localhost 走 `/v2/`
  - 生产环境走 `/v1/`
- `buildCCRv2SdkUrl(apiBaseUrl, sessionId)`
  - 生成 `https://.../v1/code/sessions/{id}`
  - 给 child CC 再派生 worker/SSE 路径

这说明 bridge runtime 同时要面向：

- 旧 ingress websocket surface
- CCR v2 的 code session surface

transport 适配层的复杂度，很大一部分就来自这两套 URL 宇宙的并存。

## 14. `sameSessionId()` 说明 session identity 的难点不在 UUID，而在“同一个 UUID 穿了不同 tag 制服”

源码镜像：[`../../sources/claude-code/src/bridge/workSecret.ts`](../../sources/claude-code/src/bridge/sessionIdCompat.ts)

`sameSessionId(a, b)` 的实现非常有代表性：

- 若完全相同，直接 true
- 否则取最后一个下划线后的 body
- 比较 body 是否一致

注释明确指出场景：

- compat API 侧看到的是 `session_*`
- infra/work queue 侧看到的是 `cse_*`
- UUID 本体相同，tag 不同

所以 bridge runtime 真正关心的不是字符串全等，而是“这两个 ID 是否只是换装后的同一 session”。

## 15. `toCompatSessionId()` / `toInfraSessionId()` 把 session 换装做成了显式边界，而不是到处手写字符串替换

源码镜像：[`../../sources/claude-code/src/bridge/sessionIdCompat.ts`](../../sources/claude-code/src/bridge/workSecret.ts)

这里显式定义了两条方向：

- `toCompatSessionId()`
  - `cse_* -> session_*`
  - 给 `/v1/sessions/{id}` 这类 compat API 用
- `toInfraSessionId()`
  - `session_* -> cse_*`
  - 给 `/bridge/reconnect` 这类 infra 路径用

这说明 Claude Code 没有把 tag 兼容层散落在调用点，而是把它当作正式的身份翻译边界。

## 16. `setCseShimGate()` 说明 session ID 兼容逻辑还受 bundle 约束和 gate 注入约束

源码镜像：[`../../sources/claude-code/src/bridge/sessionIdCompat.ts`](../../sources/claude-code/src/bridge/bridgeEnabled.ts)

`sessionIdCompat.ts` 故意不静态导入 GrowthBook gate，而是通过：

- `setCseShimGate(gate)`

把 kill switch 注入进来。注释解释得很清楚：

- 避免把 `bridgeEnabled.ts -> growthbook.ts -> config.ts` 这条重依赖链拖进 `sdk.mjs`
- SDK 路径不注册 gate 时，shim 默认开启

这说明这层不仅在处理 session tag 兼容，还在处理 bundle 隔离与入口体积约束。

## 17. `trustedDevice.ts` 不是 bridge 的可选装饰，而是 elevated bridge session 的认证 sidecar

源码镜像：[`../../sources/claude-code/src/bridge/trustedDevice.ts`](../../sources/claude-code/src/bridge/bridgeApi.ts)

文件头注释已经定性了这件事：

- bridge session 在 server 侧属于 `SecurityTier=ELEVATED`
- server 可对 `ConnectBridgeWorker` 开 trusted-device 强制
- CLI 侧 gate 控制是否发送 `X-Trusted-Device-Token`

这说明 trusted device 不是普通 remember-me token，而是 elevated bridge 认证侧链的一部分。

## 18. `getTrustedDeviceToken()` 的设计说明它追求的是“热路径便宜、gate 可热切换、存储读可缓存”

源码镜像：[`../../sources/claude-code/src/bridge/trustedDevice.ts`](../../sources/claude-code/src/utils/secureStorage/index.ts)

这里的关键设计是：

- secureStorage 读取被 `memoize`
- env var `CLAUDE_TRUSTED_DEVICE_TOKEN` 优先
- GrowthBook gate 每次 live 检查

结果就是：

- bridge API 热路径不用每次都走 keychain 子进程
- 运营侧 gate flip 后无需重启即可生效
- 测试 / enterprise wrapper 可强制覆盖本地存储

所以它是一个很典型的“热路径安全 sidecar”实现。

## 19. `clearTrustedDeviceToken()` 说明登录切账号时最危险的不是“没有 token”，而是“继续沿用旧账号 token”

源码镜像：[`../../sources/claude-code/src/bridge/trustedDevice.ts`](../../sources/claude-code/src/bridge/trustedDevice.ts), [`../architecture/17-login-oauth-and-trusted-device-ui.md`](../architecture/17-login-oauth-and-trusted-device-ui.md)

这段逻辑在 `/login` 前会：

- 从 secure storage 删除旧 `trustedDeviceToken`
- 清空 memo cache

注释说明原因非常直接：

- enroll 是异步的
- 如果不先清掉旧 token，登录后到 enrollment 完成前这段窗口里，bridge API 可能还会带着前一个账号的 trusted-device token 出去

这说明 trusted-device 的风险模型重点在账号切换污染，而不是单纯 token 缺失。

## 20. `enrollTrustedDevice()` 说明 enrollment 是“登录后短窗口内的最佳努力动作”，不是懒触发补丁

源码镜像：[`../../sources/claude-code/src/bridge/trustedDevice.ts`](../../sources/claude-code/src/utils/auth.ts)

`enrollTrustedDevice()` 的约束非常明确：

- 先过 `checkGate_CACHED_OR_BLOCKING`
- env var 已设置时跳过
- 需要 fresh OAuth access token
- essential-traffic-only 时跳过
- server 只允许 `account_session.created_at < 10min` 的 enrollment

所以它必须发生在 `/login` 之后不久，而不能指望“等 `/bridge` 403 了再懒注册”。这是一条带时间窗的认证补全链。

## 21. bridge transport / work secret / session tag / trusted-device 四者加在一起，构成了 bridge runtime 的协议底盘

源码镜像：[`../../sources/claude-code/src/bridge/replBridgeTransport.ts`](../../sources/claude-code/src/bridge/replBridgeTransport.ts), [`../../sources/claude-code/src/bridge/workSecret.ts`](../../sources/claude-code/src/bridge/workSecret.ts), [`../../sources/claude-code/src/bridge/trustedDevice.ts`](../../sources/claude-code/src/bridge/trustedDevice.ts), [`../../sources/claude-code/src/bridge/sessionIdCompat.ts`](../../sources/claude-code/src/bridge/sessionIdCompat.ts)

把这几层放在一起看，bridge 的底盘就很清楚了：

- `replBridgeTransport.ts` 把 v1/v2 两套读写协议压成统一 REPL transport 契约
- `workSecret.ts` 把本地 worker 所需的 ingress token、API base URL、URL builder 和 session identity helper 一起封成协议工具箱
- `sessionIdCompat.ts` 负责在 compat API 与 infra 层之间给同一 session 换装
- `trustedDevice.ts` 提供 elevated bridge session 的认证 sidecar

所以 bridge 的“能连上”只是一小部分，真正让它可长期运行的是这套跨 transport、跨 token、跨 session tag、跨 bundle 边界的协议底盘。
