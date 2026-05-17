# MCPTool / Dynamic Tool Synthesis / Progress / Elicitation / Result Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：RemoteTriggerTool / OAuth Headers / Action Surface / Raw Result Runtime`](./83-remote-trigger-tool-oauth-headers-action-surface-and-raw-result-runtime.md) | [`下一站：ToolSearchTool / Deferred Discovery / tool_reference / Schema Recovery Runtime`](./85-toolsearch-tool-deferred-discovery-tool-reference-and-schema-recovery-runtime.md)

本文把 `MCPTool` 从旧的 MCP 总述、resource 工具卷和 UI 卷里单独抽出来，专门讲“可执行 MCP tool”这条动态主链。相邻卷册已经覆盖了：

- [`77`](./77-mcp-resource-listing-reading-and-binary-persistence-runtime.md)：`resources/list` 与 `resources/read`
- [`68`](./68-ask-user-question-schema-preview-and-operator-loop-runtime.md)：`AskUserQuestion`
- [`28`](./28-tool-search-deferred-tools-and-mcp-instruction-deltas.md)：`mcp_instructions_delta`
- [`06`](../architecture/06-permission-and-mcp-ui-systems.md)：MCP UI、审批与连接面

而这篇只讲 `MCPTool` 自己的运行时：

- placeholder tool 和真正动态 tool 之间的分层
- `tools/list` 到本地 `Tool[]` 的合成
- `_meta` 和 annotations 如何变成模型侧与 UI 侧语义
- 真实的 `callTool` 执行、进度回调、URL elicitation 重试
- 会话过期 / auth 过期恢复
- 结果裁剪、富渲染、special-server override

先说明边界：当前仓库镜像里 `MCPTool.ts` 本体是薄壳，真正逻辑集中在 [`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/client.ts)。所以这里讲的是“动态 tool runtime”，不是静态类定义。

## 1. `MCPTool.ts` 只是占位模板，真正的可执行工具是运行时合成出来的

源码镜像：[`../../sources/claude-code/src/tools/MCPTool/MCPTool.ts`](../../sources/claude-code/src/tools/MCPTool/MCPTool.ts), [`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/client.ts)

`MCPTool.ts` 自己只声明了这些默认值：

- `name: 'mcp'`
- `description()/prompt()/call()` 都只是占位实现
- `inputSchema = z.object({}).passthrough()`
- `outputSchema = z.string()`
- `checkPermissions()` 返回通用 `passthrough`
- 默认 `renderToolUseMessage/renderToolUseProgressMessage/renderToolResultMessage`

文件里还直接写了注释：

- “Overridden in mcpClient.ts”

这说明 Claude Code 对 MCP 可执行工具的建模不是“一个静态工具类 + 若干参数实例”，而是：

- 先保留一个通用占位模板
- 再在连接到具体 server 后，按 `tools/list` 的结果动态克隆出真正的 tool object

## 2. 真正的 `Tool[]` 是在 `fetchToolsForClient(...)` 里按 server tool catalog 现做的

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/client.ts)

`fetchToolsForClient(client)` 的主流程是：

1. 确认连接类型是 `connected`
2. 检查 `client.capabilities?.tools`
3. 发 MCP 请求：
   - `{ method: 'tools/list' }`
4. 用 `ListToolsResultSchema` 校验返回
5. 先做 `recursivelySanitizeUnicode(result.tools)`
6. 再把每一个 MCP tool 合成为本地 `Tool`

也就是说，MCP tools 在 Claude Code 里不是预编译 catalog，而是：

- 每个 server 独立拉 catalog
- 拉完之后现地编译成 Claude Code 的统一工具协议

这和 `ListMcpResourcesTool` 那类“固定工具 + 动态参数”完全不同。

## 3. server tool 名字不会原样暴露；默认会被组装成 fully-qualified `mcp__...` 风格工具名

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/client.ts), [`../../sources/claude-code/src/services/mcp/mcpStringUtils.ts`](../../sources/claude-code/src/services/mcp/mcpStringUtils.ts)

默认流程里，每个工具都先构造：

- `fullyQualifiedName = buildMcpToolName(client.name, tool.name)`

然后作为模型侧 `name`。

只有一条例外：

- `client.config.type === 'sdk'`
- 且设置了 `CLAUDE_AGENT_SDK_MCP_NO_PREFIX`

这时才会把模型侧 `name` 改回原始 `tool.name`，允许 SDK MCP tools 覆盖 builtins。同一时间，权限系统并不会丢掉服务器上下文，因为它仍保留：

- `mcpInfo: { serverName, toolName }`

所以这里其实有两套名字：

- 模型看到的 invocation name
- 本地权限和连接系统认的真实 MCP 身份

## 4. `_meta` 和 annotations 不只是附属信息，而是会直接改写工具语义

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/client.ts)

`fetchToolsForClient(...)` 会把 MCP 返回里的 metadata/annotation 编译进本地 `Tool`：

- `_meta['anthropic/searchHint']` -> `searchHint`
- `_meta['anthropic/alwaysLoad'] === true` -> `alwaysLoad`
- `readOnlyHint` -> `isConcurrencySafe()` 和 `isReadOnly()`
- `destructiveHint` -> `isDestructive()`
- `openWorldHint` -> `isOpenWorld()`

这里有两个关键点：

- `searchHint` 还会先做 whitespace collapse，避免污染 deferred-tool list
- `alwaysLoad` 不是提示文案，而是后续工具池装配的重要信号

所以 MCP server 返回的 tool catalog 在 Claude Code 里并不是“仅供展示的描述信息”，而是可直接参与：

- 自动加载
- permission policy
- UI collapsing
- open-world / destructive 分类

## 5. `isSearchOrReadCommand()` 不是从 annotation 推出来的，而是走本地 allowlist 分类器

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/client.ts), [`../../sources/claude-code/src/tools/MCPTool/classifyForCollapse.ts`](../../sources/claude-code/src/tools/MCPTool/classifyForCollapse.ts)

动态 tool 上的：

- `isSearchOrReadCommand()`

并不信任远端 server 自报，而是调用：

- `classifyMcpToolForCollapse(client.name, tool.name)`

这个分类器本质上是本地 per-tool allowlist，里面硬编码了很多生态 server 的常见搜索/读取 tool 名，例如：

- Slack
- GitHub
- Linear
- Notion
- Gmail
- Google Drive
- Filesystem
- Brave Search
- PubMed

也就是说，在 Claude Code 里，MCP tool 的“可以折叠为 search/read UI”资格不是 server 自己宣称，而是本地产品方白名单判断。

## 6. 权限建议不是 generic MCP allow，而是精确到 fully-qualified tool name 的本地规则建议

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/client.ts)

动态 tool 的 `checkPermissions()` 会返回：

- `behavior: 'passthrough'`
- message: `MCPTool requires permission.`
- suggestions:
  - `type: 'addRules'`
  - `toolName: fullyQualifiedName`
  - `destination: 'localSettings'`
  - `behavior: 'allow'`

这说明 Claude Code 对 MCP 可执行工具的默认权限哲学是：

- 不做 server 级 blanket allow 建议
- 而是默认引导用户把“这一个 fully-qualified MCP tool”写进本地规则

换句话说，运行时把 MCP tool 当成和 builtin tool 一样细粒度的一等权限对象。

## 7. `userFacingName()` 明确把 server 名字带进来，说明同名工具冲突是被预期的

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/client.ts)

动态 tool 的展示名不是单独的 `tool.name`，而是：

- `${client.name} - ${displayName} (MCP)`

这表示系统默认假定：

- 不同 server 可能暴露同名能力
- 用户需要在 UI 上看见它来自哪个 MCP server

模型侧 invocation name 可以有 skip-prefix 模式，但 operator-facing label 仍然牢牢保留 source identity。

## 8. 真正的 call path 会先抽取 `toolUseId`，把它重新穿进 MCP `_meta`

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/client.ts)

动态 `call(...)` 一开始会：

- `extractToolUseId(parentMessage)`

然后把它重写进：

- `_meta['claudecode/toolUseId']`

这说明 Claude Code 并不满足于“本地 transcript 里知道 tool_use_id”，而是会主动把它作为 out-of-band metadata 送给 MCP server。结果是：

- server 端如果愿意，可以把本次调用和 Claude Code transcript 实体对上
- 后续 progress/result 也能更稳定地挂回同一个 tool use

这是一条明确的跨边界 tracing sidecar。

## 9. `mcp_progress` 不是内部日志，而是正式 progress 协议

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/tools/MCPTool/UI.tsx)

动态 tool 在 call lifecycle 上会显式发三类 outer progress：

- `started`
- `completed`
- `failed`

而 `callMCPTool(...)` 内部又会把 SDK 的 `onprogress` 转写成：

- `type: 'mcp_progress'`
- `status: 'progress'`
- `progress`
- `total`
- `progressMessage`

于是 `MCPTool/UI.tsx` 才能统一渲染：

- 无进度时的 `Running…`
- 有 `total` 时的百分比进度条
- 无 `total` 时的 `Processing… N` 或自定义 progress message

所以 `mcp_progress` 在 Claude Code 里已经是一条完整协议，不是调试信息。

## 10. 真正执行前还会再走一层 `ensureConnectedClient(...)`，动态 tool 自己不持有连接真相

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/client.ts)

动态 `call(...)` 即便拿到的是 `clientConnection`，真正执行前仍然会：

- `await ensureConnectedClient(client)`

这说明 tool object 自己不把“连接还活着”当作静态事实，而是每次调用前都重新确认：

- 连接在不在
- 会话有没有过期
- cache 是否需要刷新

也因此，MCP executable tools 其实依附于“连接恢复器”，而不是直接依附于某个长生不死的 client。

## 11. `callMCPToolWithUrlElicitationRetry(...)` 说明 MCP tool call 不是单段 RPC，而是可中途暂停的人机循环

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/client.ts)

真实执行不会直接调用 `callMCPTool(...)`，而是先进入：

- `callMCPToolWithUrlElicitationRetry(...)`

这层 wrapper 处理的特殊错误是：

- `McpError`
- `error.code === ErrorCode.UrlElicitationRequired`

也就是 MCP `-32042` URL elicitation。

这条链的语义是：

- tool call 途中 server 可以要求用户打开 URL / 完成外部动作
- Claude Code 不能把这当普通失败
- 而是必须进一个“暂停 -> 询问/等待 -> 再试一次”的 operator loop

## 12. URL elicitation 有三层处理器：hooks、structured handler、REPL queue

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/elicitationHandler.ts), [`../../sources/claude-code/src/components/mcp/ElicitationDialog.tsx`](../../sources/claude-code/src/components/mcp/ElicitationDialog.tsx)

`callMCPToolWithUrlElicitationRetry(...)` 的处理顺序是：

1. `runElicitationHooks(...)`
2. 如果当前宿主提供 `handleElicitation`
   - print / SDK mode 走 structured control channel
3. 否则
   - REPL mode 把请求压进 `appState.elicitation.queue`
   - 交给 `ElicitationDialog`
4. 用户/宿主回结果后，再走：
   - `runElicitationResultHooks(...)`

这和普通 tool call 最大的不同是：

- tool 自己不是直接面向用户
- 它可以触发二阶段 external consent flow

因此 `MCPTool` 在某些 server 上本质上已经是“半工具、半 operator workflow”。

## 13. REPL 模式下的 URL elicitation 明确是两阶段：先 accept，再 waiting，再 retry/cancel

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/components/mcp/ElicitationDialog.tsx)

REPL fallback path 里，排队项会带：

- `waitingState.actionLabel = 'Retry now'`
- `showCancel = true`

并且 `respond(result)` 的语义是分裂的：

- `accept` 只是 phase-1 consent，不会立即 resolve 外层 retry promise
- 真正 resolve 要等：
  - `decline/cancel`
  - 或 waiting phase 的 `retry/cancel`

这说明 URL elicitation 在本地 TUI 里不是单个 yes/no dialog，而是：

- 同意去浏览器做动作
- 回来后再明确告诉系统“现在重试”

## 14. 这层 retry 不是无限的，最多 3 次 URL elicitation 循环

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/client.ts)

`callMCPToolWithUrlElicitationRetry(...)` 里硬编码：

- `MAX_URL_ELICITATION_RETRIES = 3`

所以这条 operator loop 不是开放式 while-loop，而是明确防止：

- server 不停要求外部 URL action
- tool call 永远不收敛

这也是 Claude Code 对 MCP server 的一个 fail-safe 约束。

## 15. 真正的 `callMCPTool(...)` 还包了一层自己的 timeout race，因为 SDK timeout 不足以兜底

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/client.ts)

`callMCPTool(...)` 里并不只信 `client.callTool(..., { timeout })`，还额外自己做了：

- `Promise.race([client.callTool(...), timeoutPromise])`

原因源码里写得很直白：

- SDK 内部 timeout 在某些 broken SSE 情况下可能不工作

所以 Claude Code 自己又补了一层 host-side timeout，默认值来自：

- `MCP_TOOL_TIMEOUT`
- 否则是接近无限的超长默认值

也就是：

- 正常情况：由 SDK timeout 生效
- transport 断得很怪时：host timeout 兜底

## 16. `result.isError` 不会被静默转成文本，而是提升成专门的 `McpToolCallError`

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/client.ts)

如果 MCP result 带：

- `isError: true`

执行层会：

- 尝试从 `result.content[0].text` 提取错误文本
- 否则再看 legacy `result.error`
- 记录 `logMCPError`
- 抛 `McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS`

而且这类错误会尽量保留：

- `result._meta`

用于 SDK 消费方继续获取 structured context。

所以 MCP tool error 在 Claude Code 里不是“普通 tool_result 文本”，而是 protocol-level failure。

## 17. 会话过期和 auth 过期是两种不同恢复模型

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/client.ts)

### auth 过期

如果遇到：

- HTTP 401
- 或 `UnauthorizedError`

就抛：

- `McpAuthError(serverName, ...)`

这条线要求用户重新授权。

### session 过期

如果遇到：

- HTTP 404 + JSON-RPC `-32001`
- 或 HTTP/claudeai-proxy 模式下 `-32000 Connection closed`

就会：

- `clearServerCache(name, config)`
- 抛 `McpSessionExpiredError`

而动态 `call(...)` 外层会捕这个错误并：

- 最多重试一次

所以恢复策略是：

- auth 过期：需要重新身份授权
- session 过期：自动清缓存、拿 fresh client 再试一轮

## 18. 返回值不是只有 `content`，还保留 `_meta` 和 `structuredContent`

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/client.ts)

成功路径最终返回：

- `data: mcpResult.content`
- 可选 `mcpMeta._meta`
- 可选 `mcpMeta.structuredContent`

这说明 Claude Code 没把 MCP SDK result 扁平成纯文本，而是保留了两条 sidecar：

- server 自己的 `_meta`
- MCP structured content

这也是后续 richer host/SDK surface 还能继续理解结果结构的前提。

## 19. 结果在进入 transcript 之前会先走 `processMCPResult(...)` 与 `truncateMcpContentIfNeeded(...)`

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/utils/mcpValidation.ts), [`../../sources/claude-code/src/utils/mcpOutputStorage.ts`](../../sources/claude-code/src/utils/mcpOutputStorage.ts)

`callMCPTool(...)` 并不会把原始 SDK result 直接回给模型，而是先：

- `processMCPResult(result, tool, name)`

这条链会处理：

- 文本/内容块归一化
- 大结果落盘
- binary blob 持久化
- 再做 `truncateMcpContentIfNeeded(...)`

而 `mcpValidation.ts` 里的裁剪策略是：

- 默认阈值 `25000` tokens
- 可由 `MAX_MCP_OUTPUT_TOKENS` 覆盖
- 或由 GrowthBook `tengu_satin_quoll['mcp_tool']` 覆盖
- 大图会尝试压缩
- 最终总会追加明确的 truncation warning

所以 `MCPTool` 的大输出控制是独立于通用 tool persistence 阈值的专用层。

## 20. 默认 UI 已经不把 MCP 结果当纯字符串，而是有一套专门的“富结果压缩器”

源码镜像：[`../../sources/claude-code/src/tools/MCPTool/UI.tsx`](../../sources/claude-code/src/tools/MCPTool/UI.tsx)

`renderToolResultMessage(...)` 的处理顺序大致是：

1. 非 verbose 时先试特殊 compact renderer
   - 例如 Slack send success
2. 估算 token 体积
   - 超过约 `10k` token 就显示 warning
3. 如果是 `ContentBlock[]`
   - image -> `[Image]`
   - text -> 走 `MCPTextOutput`
4. `MCPTextOutput` 再试三层：
   - unwrap dominant text payload
   - flatten 小型 flat JSON object
   - 回退到普通 `OutputLine`

因此 MCP 输出在默认前台上并不是“把 JSON 原封不动打出来”，而是有一层专门的可读性压缩协议。

## 21. 但默认渲染并不是最终答案，Chrome / Computer Use 两类 MCP server 还能替换工具行为和渲染

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/utils/claudeInChrome/toolRendering.tsx), [`../../sources/claude-code/src/utils/computerUse/wrapper.tsx`](../../sources/claude-code/src/utils/computerUse/wrapper.tsx)

`client.ts` 会按 server 类型走 lazy override：

- Claude in Chrome server -> `claudeInChromeToolRendering()`
- Computer Use server -> `computerUseWrapper()`

其中：

- Chrome 主要替换 `userFacingName` / render hooks / result summary
- Computer Use 不只是换渲染，还会替换 `.call()`
  - 把 MCP tool call 接进本地 host adapter、lock、approval、Esc hotkey、screenshot state

这说明 `MCPTool` 的默认 runtime 更像“通用 MCP executor 内核”，而不是所有 server 共享的最终体验层。

## 22. 因而 `MCPTool` 在 Claude Code 里的真实定位，是“动态工具编译器 + 可暂停 RPC 宿主 + 富结果转译层”

把上面这些链收束起来，可以看到它不是单一职责工具：

- `MCPTool.ts` 提供统一模板
- `fetchToolsForClient(...)` 负责把远端 catalog 编译成本地 `Tool`
- `callMCPToolWithUrlElicitationRetry(...)` 提供 operator-loop 执行模型
- `callMCPTool(...)` 负责 transport、timeout、session/auth recovery
- `processMCPResult(...) + mcpValidation.ts` 负责内容裁剪和持久化
- `MCPTool/UI.tsx` 负责默认前台压缩展示
- server-specific override 再在上面接出 Chrome / Computer Use 这种特化宿主

所以如果只把它看成“一把 MCP 工具”，会低估它的真实角色。更准确的说法是：

- `MCPTool` 是 Claude Code 把 MCP server 暴露成一等工具系统的动态编译与执行内核。
