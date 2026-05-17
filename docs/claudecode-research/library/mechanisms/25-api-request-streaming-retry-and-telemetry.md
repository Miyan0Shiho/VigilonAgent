# API Request / Streaming / Retry / Telemetry

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Workflow / Monitor Gates / Task Types / Surface Contracts`](./24-workflow-monitor-gates-task-types-and-surface-contracts.md) | [`下一站：Prompt Cache Break Detection / Stability Auditing`](./26-prompt-cache-break-detection-and-stability-auditing.md)

本文拆的是 Claude Code 最容易被误写成“就是 SDK 调一下”的一层：`services/api/claude.ts` 并不是薄包装，而是请求装配、tool schema 变换、message normalization、streaming 组包、retry/fallback、usage/cost 结算、OTel/session tracing 汇流点。重点拆的是 `claude.ts + withRetry.ts + logging.ts + utils/api.ts + utils/messages.ts + sessionTracing.ts` 这条真实实现链。

## 1. `services/api/claude.ts` 是 Claude Code 的 LLM transport kernel，不只是 SDK adapter

源码镜像：[`../../sources/claude-code/src/services/api/claude.ts`](../../sources/claude-code/src/services/api/claude.ts), [`../../sources/claude-code/src/services/api/withRetry.ts`](../../sources/claude-code/src/services/api/withRetry.ts), [`../../sources/claude-code/src/services/api/logging.ts`](../../sources/claude-code/src/services/api/logging.ts)

从导入面就能看出它负责的不只是发请求：

- provider / base URL / model 归一化
- betas / effort / thinking / fast mode / context management
- tool schema 编译与 message normalization
- request metadata / attribution / fingerprint
- streaming state accumulation 与 watchdog
- fallback 到 non-streaming 的恢复路径
- usage / cost / telemetry / tracing

也就是说，Claude Code 的 API 层不是“QueryEngine 下方的一条 HTTP 线”，而是把产品策略、模型能力协商、容错、可观测性都压在一层里。

## 2. 请求体不是直接拼 JSON，而是先经过一层“extra body + metadata + cache policy”协商

源码镜像：[`../../sources/claude-code/src/services/api/claude.ts`](../../sources/claude-code/src/services/api/claude.ts)

`getExtraBodyParams()`、`getAPIMetadata()`、`getPromptCachingEnabled()`、`getCacheControl()` 这几段一起说明，请求体在真正进入 SDK 前先经过一层本地协商：

- `CLAUDE_CODE_EXTRA_BODY` 可注入额外 body，但必须是 object，而且会先 shallow clone，避免污染解析缓存。
- Bedrock 的 beta headers 不是只走 `betas` 数组，还会被并进 `extraBodyParams.anthropic_beta`。
- anti-distillation、1h prompt cache TTL、global cache scope 都不是调用方直接传，而是 API 层按 provider、用户类型、GrowthBook 与 session latch 决定。
- metadata 里不仅有 `device_id`，还有 OAuth `account_uuid` 和 `session_id`，说明服务端归因不是单靠 API key。

这里的关键点是：Claude Code 把“请求参数可配”与“请求参数可稳定缓存”放在同一层处理，避免上游任意拼 body 直接打爆 server-side cache key。

## 3. message 送去 API 前，先经历 tool schema 编译、tool search 裁剪与 message 修复

源码镜像：[`../../sources/claude-code/src/services/api/claude.ts`](../../sources/claude-code/src/services/api/claude.ts), [`../../sources/claude-code/src/utils/api.ts`](../../sources/claude-code/src/utils/api.ts), [`../../sources/claude-code/src/utils/messages.ts`](../../sources/claude-code/src/utils/messages.ts)

这条链的真实顺序不是“messages 原样送 API”，而是：

1. 判断 `ToolSearch` 是否启用。
2. 根据 deferred tool、pending MCP server、已发现 tool_reference 决定 `filteredTools`。
3. 用 `toolToAPISchema()` 把工具变成 API schema，并在需要时加 `defer_loading` / `eager_input_streaming` / cache marker。
4. `normalizeMessagesForAPI()` 做 message 归一化。
5. 若当前 model 不支持 tool search，再二次剥离 `tool_reference` 与 `caller`。
6. `ensureToolResultPairing()` 修补 orphaned `tool_use/tool_result`。
7. `stripAdvisorBlocks()`、`stripExcessMediaItems()` 再做模型/协议级清理。

这意味着 Claude Code 的 API 层自己维护了一份“可发给模型的最小一致 transcript”，而不是把 UI transcript 直接透传给 SDK。

## 4. system prompt 也不是静态字符串，而是由 attribution、CLI prefix、advisor、chrome tool-search 指令动态装配

源码镜像：[`../../sources/claude-code/src/services/api/claude.ts`](../../sources/claude-code/src/services/api/claude.ts), [`../../sources/claude-code/src/utils/api.ts`](../../sources/claude-code/src/utils/api.ts)

在 `systemPrompt` 真正变成 API blocks 之前，Claude Code 会依次注入：

- `getAttributionHeader(fingerprint)`
- `getCLISyspromptPrefix(...)`
- advisor tool instructions
- Chrome tool-search instructions

其中 fingerprint 必须在注入 synthetic message 之前计算，说明 attribution 想绑定的是“真实用户输入”，不是后置工具公告。另一层重要点是：deferred tool 列表和 Chrome MCP 指令并不总是直接塞 system prompt，有些场景会改走 attachment/delta，目的就是减少 prompt cache churn。

## 5. 真正的请求参数是在 `paramsFromContext()` 里按“重试上下文”二次生成的

源码镜像：[`../../sources/claude-code/src/services/api/claude.ts`](../../sources/claude-code/src/services/api/claude.ts)

`paramsFromContext()` 是这条链最关键的函数之一，因为它说明 Claude Code 并不是先生成一次 params 然后盲重试，而是每次 attempt 按 `RetryContext` 重新装配：

- model 可被 fallback / normalization 改写
- betas 会动态拼上 1M context、tool-search、fast mode、AFK、cache-editing、structured outputs、task budgets
- `output_config` 里会被并入 effort、task budget、JSON output format
- thinking 会在 adaptive 与 fixed budget 之间按 model capability 切换
- `context_management` 会按 thinking/redaction/clear-latch 决定
- fast mode header 是 sticky latch，但 `speed='fast'` 仍是动态字段

这说明 Claude Code 的 retry 不是“重发同一请求”，而是“在尽量保持 cache key 稳定的前提下做最小必要修正”。

## 6. `startLLMRequestSpan()` 和 `logAPIQuery()` 发生在 streaming 之前，说明 tracing/analytics 绑定的是 request chain，不是最终消息

源码镜像：[`../../sources/claude-code/src/services/api/claude.ts`](../../sources/claude-code/src/services/api/claude.ts), [`../../sources/claude-code/src/utils/telemetry/sessionTracing.ts`](../../sources/claude-code/src/utils/telemetry/sessionTracing.ts), [`../../sources/claude-code/src/services/api/logging.ts`](../../sources/claude-code/src/services/api/logging.ts)

请求发出前，Claude Code 会先做两件事：

- `startLLMRequestSpan(model, newContext, messagesForAPI, isFastMode)`
- 异步拿 permission mode 后调用 `logAPIQuery(...)`

这里很关键的一点是 `previousRequestId` 来自消息链最后一个 assistant message，而不是全局变量。也就是说：

- main thread
- subagent
- teammate

都可以有各自独立的 request chain，不会互相污染。回滚 transcript 后，这个链也会自然回退。

## 7. streaming path 明确绕开了高层 `BetaMessageStream`，因为 Claude Code 自己接管了 block accumulation

源码镜像：[`../../sources/claude-code/src/services/api/claude.ts`](../../sources/claude-code/src/services/api/claude.ts)

流式主路径里最重要的设计决定是：

- 不走高层 `BetaMessageStream`
- 直接用 raw stream + `.withResponse()`

原因写得很直白：避免对 `input_json_delta` 做 O(n²) partial JSON parsing，因为 Claude Code 自己维护 `contentBlocks[]`，自己累加：

- `tool_use.input += partial_json`
- `text.text += delta.text`
- `thinking.thinking += delta.thinking`
- `thinking.signature = delta.signature`

也就是说，Claude Code 的 transcript 粒度和 API SDK 默认组包粒度并不一致，它主动抢走了这层控制权，以换取性能、恢复能力和更稳定的 UI/event surface。

## 8. streaming 不只是 `for await`，还带 watchdog、stall telemetry 和 native resource cleanup

源码镜像：[`../../sources/claude-code/src/services/api/claude.ts`](../../sources/claude-code/src/services/api/claude.ts)

这条 streaming loop 不是裸循环，而是三层保护：

- `releaseStreamResources()`：主动取消 `Response.body`，避免 native TLS/socket buffer 泄漏
- idle watchdog：长时间无 chunk 直接中止流
- stall detection：chunk 间隔过长时打 `tengu_streaming_stall`

这里最值得注意的是，watchdog 不是只记录日志，而是真的 `releaseStreamResources()`。这说明 Claude Code 已经遇到过“fetch 超时管不到 streaming body”的问题，所以把“流挂死”当成 transport 层故障来处理，而不是等上层超时。

## 9. Claude Code 是按 `content_block_stop` 产出 assistant message，而不是等整条 message 结束

源码镜像：[`../../sources/claude-code/src/services/api/claude.ts`](../../sources/claude-code/src/services/api/claude.ts), [`../../sources/claude-code/src/utils/messages.ts`](../../sources/claude-code/src/utils/messages.ts)

在 loop 里，真正 `yield assistant message` 的时机是 `content_block_stop`。这会把当前 block 通过 `normalizeContentFromAPI()` 转成单条 `AssistantMessage` 并立刻发出去。

随后 `message_delta` 才把这些已发出的 message 回写：

- `usage`
- `stop_reason`
- `research`

这解释了 Claude Code 为什么能做到“thinking / text / tool_use 分块实时显示”，同时 transcript 最终又保持整条 assistant turn 的 usage 和 stop reason 一致。

## 10. stop reason、拒答、成本与 quota 状态都在 API 层被第一时间解释成产品事件

源码镜像：[`../../sources/claude-code/src/services/api/claude.ts`](../../sources/claude-code/src/services/api/claude.ts), [`../../sources/claude-code/src/services/api/logging.ts`](../../sources/claude-code/src/services/api/logging.ts)

`message_delta` 不是只更新 usage，还会立刻触发几类产品语义：

- `stop_reason === 'max_tokens'` -> 生成用户可见 API error message
- `stop_reason === 'model_context_window_exceeded'` -> 单独事件链
- refusal -> `getErrorMessageIfRefusal(...)`
- usage -> `calculateUSDCost(...) + addToTotalSessionCost(...)`
- headers -> `extractQuotaStatusFromHeaders(...)`

也就是说，Claude Code 的 API 层不是只提供原始 stop reason 给上游再解释，而是直接把模型终止语义翻译成产品级消息和计费/限制状态。

## 11. non-streaming fallback 不是异常分支拼凑，而是独立 helper + retry generator

源码镜像：[`../../sources/claude-code/src/services/api/claude.ts`](../../sources/claude-code/src/services/api/claude.ts), [`../../sources/claude-code/src/services/api/withRetry.ts`](../../sources/claude-code/src/services/api/withRetry.ts)

`executeNonStreamingRequest()` 证明 fallback 不是“stream 失败后顺手再调一次 create”，而是单独的一条恢复协议：

- 继承同一套 `withRetry(...)`
- 重新从 `paramsFromContext()` 生成请求
- 做 `adjustParamsForNonStreaming(...)`
- 用独立 timeout 上限
- 记录 `tengu_nonstreaming_fallback_error`
- 带上 originating request ID 做 funnel 关联

这说明 Claude Code 把 streaming 与 non-streaming 看成两条并列 transport，不是主路径和临时补丁。

## 12. `withRetry()` 本身就是产品策略层：fast mode、529 fallback、persistent retry、context overflow 修正都在这里

源码镜像：[`../../sources/claude-code/src/services/api/withRetry.ts`](../../sources/claude-code/src/services/api/withRetry.ts)

`withRetry()` 远不只是指数退避。它至少承载了四类产品策略：

- fast mode 429/529 时，先短等保 cache，再进入 cooldown 降回标准速度
- repeated 529 时，可触发 `FallbackTriggeredError(originalModel, fallbackModel)`
- persistent retry 模式会长等待并周期性 `yield system api_retry`，防止宿主把 session 判 idle
- context overflow 会解析错误内容并下调下一次 attempt 的 `max_tokens`

换句话说，Claude Code 的 retry layer 不是网络层，而是“请求是否值得继续、继续时要换什么策略”的决策层。

## 13. 成功路径的收尾不只是“打日志”，而是把 usage、文本长度、thinking 长度、tool input 长度都写进 tracing

源码镜像：[`../../sources/claude-code/src/services/api/logging.ts`](../../sources/claude-code/src/services/api/logging.ts), [`../../sources/claude-code/src/utils/telemetry/sessionTracing.ts`](../../sources/claude-code/src/utils/telemetry/sessionTracing.ts)

`logAPISuccessAndDuration()` 的收尾比普通 analytics 细很多。它会从 `newMessages` 里抽出：

- text output 总长度
- thinking output 总长度
- per-tool input JSON 长度
- connector text block 数量
- fast/normal speed
- previous request ID
- global cache strategy
- request setup / retry timing

如果 beta tracing 打开，还会把：

- model output
- ant-only thinking output
- hasToolCall

一起送进 span 结束逻辑。也就是说，Claude Code 在 API 层已经建立了“每次 LLM 请求的内容侧 profile”，不只是 token 计数器。

## 14. 真正的边界不是“这篇还缺什么”，而是这条链的上下游已经分得很清

当前这篇已经能拆清的边界是：

- 上游：`query.ts` 决定什么时候发起、什么时候 fallback、什么时候消费这些事件
- 中游：`claude.ts` 决定请求如何组装、流如何解释、usage 如何落产品语义
- 下游：`client.ts` 负责 SDK client，`messages.ts` / `utils/api.ts` / `logging.ts` / `sessionTracing.ts` 分别提供专用子协议

因此这篇不需要伪装成“已经解释了整个 query loop”。它真正覆盖的是 Claude Code 的 LLM transport/runtime kernel，而不是上层 agentic loop 本身。

## 交叉参考

- Query loop 如何消费这些 stream event：[`../implementation/03-query-loop-and-recovery.md`](../implementation/03-query-loop-and-recovery.md)
- Tool schema 与 ToolUseContext 总装配：[`./02-tool-pool-and-tool-use-context.md`](./02-tool-pool-and-tool-use-context.md)
- Read/Search/Web/Task 工具族怎样进入 API：[`./08-read-search-web-and-task-tools.md`](./08-read-search-web-and-task-tools.md)
- Permission runtime 与 tool execution 交界：[`./23-permission-runtime-hooks-classifier-and-dialog-pipeline.md`](./23-permission-runtime-hooks-classifier-and-dialog-pipeline.md)
