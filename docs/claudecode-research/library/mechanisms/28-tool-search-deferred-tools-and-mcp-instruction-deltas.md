# Tool Search / Deferred Tools / MCP Instruction Deltas

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：API Provider / Auth / Client / Error Taxonomy`](./27-api-provider-auth-client-and-error-taxonomy.md) | [`下一站：Remote SDK Message Adaptation / WebSocket / Permission Bridges`](./29-remote-sdk-message-adaptation-websocket-and-permission-bridges.md)

本文拆的是 Claude Code 里一条非常关键、但之前只散落在 API 和 attachment 总述里的协议链：`toolSearch.ts + mcpInstructionsDelta.ts + attachments.ts + messages.ts + claude.ts`。它真正实现的不是“搜索一下工具”，而是把大量 deferred tools 和 late-connected MCP instructions 从主 system prompt/tool schema 里搬出去，改成按需发现、增量宣布、会话内持久重放的协议。

## 1. 这条链的核心目标不是搜索 UX，而是把动态工具池从主 prompt cache key 里拆出去

源码镜像：[`../../src/utils/toolSearch.ts`](../../src/utils/toolSearch.ts), [`../../src/utils/mcpInstructionsDelta.ts`](../../src/utils/mcpInstructionsDelta.ts), [`../../src/services/api/claude.ts`](../../src/services/api/claude.ts)

从注释和调用链看，Tool Search 子系统最核心的目标其实是两个：

- 大量 deferred tools 不要每轮都塞进主 tools array
- late-connected MCP instructions 不要每轮都重新拼 system prompt

也就是说，这条链首先是 cache-stability / context-budget engineering，其次才是“模型如何搜索工具”的 UX 功能。

## 2. `ToolSearchMode` 不是开关，而是三态策略：`tst / tst-auto / standard`

源码镜像：[`../../src/utils/toolSearch.ts`](../../src/utils/toolSearch.ts)

`getToolSearchMode()` 暴露出 Claude Code 对 tool search 的真实策略模型：

- `tst`：始终启用 ToolSearchTool
- `tst-auto`：超过阈值才启用
- `standard`：完全禁用，所有工具直接内联

而且 `ENABLE_TOOL_SEARCH=auto:N` 不是语法糖，而是正式的阈值控制面。Claude Code 没有把 deferred tools 做成单一 feature flag，而是把它建模成“永远 defer / 超阈值 defer / 永不 defer”三种运行模式。

## 3. `isToolSearchEnabledOptimistic()` 和 `isToolSearchEnabled()` 的分裂，说明“消息协议保守保留”和“本轮 definitively enable”是两件事

源码镜像：[`../../src/utils/toolSearch.ts`](../../src/utils/toolSearch.ts), [`../../src/utils/messages.ts`](../../src/utils/messages.ts)

这里最值得注意的是双层判定：

- `isToolSearchEnabledOptimistic()`：只回答“是否可能启用”
- `isToolSearchEnabled()`：回答“这次请求到底启不启用”

这层分裂的意义很大：

- optimistic check 让 `ToolSearchTool` 可以进入基础工具池，也让 `tool_reference` / delta attachment 在消息层先保留下来
- definitive check 再结合 model support、threshold、ToolSearchTool availability 决定这轮 API 请求到底是不是 defer-loading 模式

也就是说，Claude Code 把“协议兼容性保留”与“本轮策略生效”明确拆开了。

## 4. tool search 不是所有模型都能用，`modelSupportsToolReference()` 是协议能力 gate，而不是产品文案 gate

源码镜像：[`../../src/utils/toolSearch.ts`](../../src/utils/toolSearch.ts)

`modelSupportsToolReference()` 的真实作用不是隐藏一个菜单，而是确认模型能不能处理：

- `defer_loading`
- `tool_reference` blocks

Haiku 这类模型被明确列在 unsupported patterns 里，而默认策略是“新模型默认支持，除非明确拉黑”。这说明 tool search 在 Claude Code 里被视为 API 协议能力，不是普通产品实验按钮。

## 5. `tst-auto` 的阈值不是猜大小，而是先试 token 级计数，失败后才退回 char heuristic

源码镜像：[`../../src/utils/toolSearch.ts`](../../src/utils/toolSearch.ts)

自动模式的阈值判断并不粗糙：

- 先用 `countToolDefinitionTokens()` 精确估算 deferred tools 的定义 token
- 扣掉 `TOOL_TOKEN_COUNT_OVERHEAD`
- 如果 token API 不可用，再退回 chars/token heuristic

这说明 Claude Code 并不是凭“工具多了就开 ToolSearch”，而是试图按真实 context window 压力做决策。`auto` 本质上是“工具定义占上下文比例超过阈值时，切到动态发现模式”。

## 6. `extractDiscoveredToolNames()` 说明 deferred tools 一旦被 ToolSearch 发现，就会成为后续请求里的正式工具

源码镜像：[`../../src/utils/toolSearch.ts`](../../src/utils/toolSearch.ts), [`../../src/services/api/claude.ts`](../../src/services/api/claude.ts)

动态加载的关键不在于“搜索”，而在于 discovered set 会被重新注入下一轮请求：

- `ToolSearchTool` 返回 `tool_reference`
- `extractDiscoveredToolNames(messages)` 扫历史
- `claude.ts` 只把已发现的 deferred tools 重新放进 `filteredTools`

这意味着 ToolSearch 不只是一次性 lookup，而是把“模型已知道哪些 deferred tools”编码进了会话状态。被发现过的工具，后续就变成真实可调用工具，而不是每次都要重新搜索。

## 7. compaction 不是把 discovered tools 丢掉，而是通过 `compact_boundary` 把它们续命

源码镜像：[`../../src/utils/toolSearch.ts`](../../src/utils/messages.ts)

`extractDiscoveredToolNames()` 对 `compact_boundary` 的特殊处理暴露了一个关键设计：

- compaction 会吃掉携带 `tool_reference` 的旧消息
- 所以 compact boundary 要把 `preCompactDiscoveredTools` 快照下来
- 后续扫描再从 boundary 里恢复 discovered set

这说明 Claude Code 已经把“工具发现状态要跨 compaction 保持”视为正式需求，而不是 incidental side effect。

## 8. `deferred_tools_delta` 不是提示文本，而是 persisted attachment protocol

源码镜像：[`../../src/utils/toolSearch.ts`](../../src/utils/toolSearch.ts), [`../../src/utils/attachments.ts`](../../src/utils/attachments.ts), [`../../src/utils/messages.ts`](../../src/utils/messages.ts)

`getDeferredToolsDelta()` 和 `getDeferredToolsDeltaAttachment()` 共同说明，deferred tools 的宣布方式不是临时提示，而是持久 attachment：

- 先扫描历史 attachment，重建 announced set
- 比对当前 deferred pool
- 生成 `addedNames / addedLines / removedNames`
- 写入 `type='deferred_tools_delta'`
- `normalizeAttachmentForAPI()` 再把它翻译成真正给模型看的消息

所以它不是 UI decoration，而是会话内持久的协议对象。模型和客户端都靠它来同步“哪些 deferred tools 现在可搜、哪些已经下线”。

## 9. 它对“undeferred but still in pool”的工具做静默处理，说明 delta 协议的目标是真实可用性，而不是历史完美对称

源码镜像：[`../../src/utils/toolSearch.ts`](../../src/utils/toolSearch.ts)

`getDeferredToolsDelta()` 里一个很细但很重要的决策是：

- 若工具以前是 deferred，现在不再 deferred，但仍在 base pool 中
- 不把它记作 removed

原因很明确：它仍然可以直接调用，如果告诉模型“no longer available”反而是错的。也就是说，这条 delta 协议关注的是“当前通过 ToolSearch 是否需要 discover”，不是机械维护一份 perfectly symmetric announce/retract log。

## 10. `mcp_instructions_delta` 和 deferred tools delta 是平行协议：一个同步工具可发现性，一个同步 server instructions

源码镜像：[`../../src/utils/mcpInstructionsDelta.ts`](../../src/utils/mcpInstructionsDelta.ts), [`../../src/utils/attachments.ts`](../../src/utils/attachments.ts), [`../../src/utils/messages.ts`](../../src/utils/messages.ts)

`mcp_instructions_delta` 基本复用了同样的结构：

- 扫历史 attachment 重建 announced server set
- 对当前 connected MCP servers + client-side instructions 做 diff
- 生成 `addedNames / addedBlocks / removedNames`
- 通过 attachment 持久进会话

所以这条链真正做的是两类 delta protocol：

- deferred tools delta：同步“哪些工具可被 ToolSearch 发现”
- MCP instructions delta：同步“哪些 server instructions 已经进入会话”

它们共同目标都是把 late-bound 动态内容从主 prompt body 拆出去。

## 11. `attachments.ts` 是这两条协议真正进入主线程和子代理会话的分发器

源码镜像：[`../../src/utils/attachments.ts`](../../src/utils/attachments.ts)

`getAttachments()` 里这两项很关键：

- `deferred_tools_delta`
- `mcp_instructions_delta`

而且 `deferred_tools_delta` 在主线程和子代理上会带不同 `callSite`：

- `attachments_main`
- `attachments_subagent`

这说明 Claude Code 不是只在主 REPL 维护这些协议，subagent 也能带着自己的会话历史和 attachment lineage 继续运行。

## 12. `claude.ts` 保留了旧 prepend 路径，但只在 delta gate 关闭时回退，说明这是一次真正的架构替换而不是并行功能

源码镜像：[`../../src/services/api/claude.ts`](../../src/services/api/claude.ts)

在 `claude.ts` 里能清楚看到旧新两条路：

- 旧路：每次请求 prepend `<available-deferred-tools>` 或拼 Chrome MCP 指令
- 新路：通过 `deferred_tools_delta` / `mcp_instructions_delta` 持久进会话

而且是 `gate on -> 新路`，`gate off -> 旧路` 的互斥关系。这说明 delta attachments 不是补充 UX，而是对原先 cache-busting prompt prepend 方案的正式架构替换。

## 13. `messages.ts` 是这些 attachment 变成模型可读指令的最终翻译层

源码镜像：[`../../src/utils/messages.ts`](../../src/utils/messages.ts)

这两类 attachment 最后都会在 `normalizeAttachmentForAPI()` 里变成可读文本：

- deferred tools：`The following deferred tools are now available via ToolSearch...`
- MCP instructions：server blocks 被转成真正的 instruction text

这意味着 attachment protocol 不是只给前端看的 metadata。它最终会进入 API 消息流，成为模型上下文的一部分，只是变成了“增量同步的消息块”，而不是“每轮重建的 system/tool preamble”。

## 14. 真正应该把这条链理解成“延迟能力发现协议”，而不是单个 ToolSearch 开关

如果只按名字看，很容易把它理解成“有个 ToolSearchTool”。但源码显示，它其实是四层联动：

- `toolSearch.ts`：决定 defer、不 defer、何时启用、如何恢复 discovered set
- `mcpInstructionsDelta.ts`：决定 server instructions 的增量同步
- `attachments.ts`：把两类 delta 挂进具体会话
- `messages.ts / claude.ts`：把 delta 协议翻译进模型上下文，并替代旧的 prompt prepend 方案

所以这条链真正提供的是一套“动态工具和动态 server instructions 的会话内持久同步协议”。

## 交叉参考

- API transport 主链：[`./25-api-request-streaming-retry-and-telemetry.md`](./25-api-request-streaming-retry-and-telemetry.md)
- Prompt cache 稳定性审计：[`./26-prompt-cache-break-detection-and-stability-auditing.md`](./26-prompt-cache-break-detection-and-stability-auditing.md)
- MCP 总装配：[`./05-mcp-integration.md`](./05-mcp-integration.md)
- Read/Search/Web/Task 工具总述：[`./08-read-search-web-and-task-tools.md`](./08-read-search-web-and-task-tools.md)
