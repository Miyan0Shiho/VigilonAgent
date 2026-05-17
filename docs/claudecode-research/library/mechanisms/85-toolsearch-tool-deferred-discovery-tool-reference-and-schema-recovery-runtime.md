# ToolSearchTool / Deferred Discovery / tool_reference / Schema Recovery Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：MCPTool / Dynamic Tool Synthesis / Progress / Elicitation / Result Runtime`](./84-mcp-tool-dynamic-tool-synthesis-progress-elicitation-and-result-runtime.md) | [`下一站：McpAuthTool / needs-auth Placeholder / Background Reconnect Runtime`](./86-mcp-auth-tool-needs-auth-placeholder-and-background-reconnect-runtime.md)

本文把 `ToolSearchTool` 从 [`28`](./28-tool-search-deferred-tools-and-mcp-instruction-deltas.md) 的“attachment 与 discovered-set 总述”里单独抽出来，专门讲它自己的工具本体和恢复链。`28` 已经讲清了：

- deferred tools / `deferred_tools_delta`
- `tool_reference` 与 compaction 边界
- `mcp_instructions_delta`

而这篇只讲 `ToolSearchTool` 作为一把真实工具时的运行时：

- 什么时候暴露出来
- 如何在 deferred tool pool 上做 exact select 与 keyword search
- cache invalidation 和 pending MCP server 提示
- 为什么它返回的是 `tool_reference` 而不是 schema 文本
- schema 没发到 API 时，tool execution 层怎样反向提示模型先重新加载工具

也先说明边界：当前仓库里没有单独的 `ToolSearchTool/UI.tsx`。这把工具几乎完全靠：

- `ToolSearchTool.ts`
- `ToolSearchTool/prompt.ts`
- `utils/toolSearch.ts`
- `services/tools/toolExecution.ts`

这几层完成，前台表面极薄。

## 1. `ToolSearchTool` 的职责不是“搜索所有工具”，而是“把 deferred tools 正式加载进当前 prompt”

源码镜像：[`../../src/tools/ToolSearchTool/ToolSearchTool.ts`](../../src/tools/ToolSearchTool/ToolSearchTool.ts), [`../../src/tools/ToolSearchTool/prompt.ts`](../../src/tools/ToolSearchTool/prompt.ts)

`prompt.ts` 开头就把目的说死了：

- 它抓取 deferred tools 的完整 schema definition
- 没 fetch 之前，模型只知道名字，不知道参数 schema
- 一旦命中，结果会以 `<functions>` / `<function>{...}</function>` 风格把 schema 注回模型上下文

所以这把工具不是通用 catalog 搜索框，而是：

- deferred tool loading runtime

搜索只是它暴露这一 runtime 的控制方式。

## 2. 它本身也是 gating 过的工具，只有“tool search 可能开启”时才进工具池

源码镜像：[`../../src/tools/ToolSearchTool/ToolSearchTool.ts`](../../src/tools/ToolSearchTool/ToolSearchTool.ts), [`../../src/utils/toolSearch.ts`](../../src/utils/toolSearch.ts), [`../../src/tools.ts`](../../src/tools.ts)

`ToolSearchTool.isEnabled()` 只看：

- `isToolSearchEnabledOptimistic()`

而 `tools.ts` 里把它放进基础工具池时也是同一条 optimistic gate。

这意味着：

- 它不是每次请求都一定真正可用
- 但只要系统认为“这次也许会走 tool search”，就必须先把它放进工具池

原因很直接：后面的 definitive decision 还依赖：

- model 是否支持 `tool_reference`
- tool 本身有没有被 disallow
- `tst-auto` 是否超过阈值

如果前面就不把它放进工具池，后面就没有机会进入真正的 deferred loading 路线。

## 3. `isDeferredTool(...)` 才是它的真正上游边界，ToolSearchTool 自己永远不能被 defer

源码镜像：[`../../src/tools/ToolSearchTool/prompt.ts`](../../src/tools/ToolSearchTool/prompt.ts)

`prompt.ts` 里的 `isDeferredTool(tool)` 先做几条关键判断：

- `alwaysLoad === true` -> 永不 defer
- `tool.isMcp === true` -> 默认 defer
- `tool.name === TOOL_SEARCH_TOOL_NAME` -> 永不 defer
- fork 模式下 `AgentTool` turn-1 可见 -> 永不 defer
- `BriefTool` / `SendUserFileTool` 在特定 gate 下 -> 永不 defer
- 其他才看 `tool.shouldDefer === true`

这里最关键的是：

- ToolSearchTool 自己绝不能被 defer

否则整个 deferred loading 机制会递归自锁。

## 4. 这把工具是只读且可并发的，说明它被当成低风险 prompt-shaping primitive，而不是 side-effect 工具

源码镜像：[`../../src/tools/ToolSearchTool/ToolSearchTool.ts`](../../src/tools/ToolSearchTool/ToolSearchTool.ts)

工具声明是：

- `isConcurrencySafe() => true`
- `isReadOnly() => true`

这和它的真实行为一致：

- 不改磁盘
- 不改进程状态
- 只改变后续 prompt 中“有哪些工具 schema 被注入”

因此在 Claude Code 的工具分类里，它本质上是：

- context-shaping tool

而不是 execution tool。

## 5. 输入面非常小，但其实编码了两种完全不同的模式：`select:` 和 keyword search

源码镜像：[`../../src/tools/ToolSearchTool/ToolSearchTool.ts`](../../src/tools/ToolSearchTool/ToolSearchTool.ts)

输入 schema 只有两个字段：

- `query`
- `max_results`

但 `call(...)` 里会先检查：

- `^select:(.+)$`

于是实际有两种运行模式：

### `select:...`

- 直接按名字抓工具
- 支持 `select:A,B,C` 多选
- 允许从 deferred set 查
- 也允许从 full tool set 查

### keyword search

- 在 deferred tools 上做打分检索
- 最后返回 best matches

这两种模式的产品目的不同：

- `select:` 是精确加载
- keyword search 是发现能力

## 6. `select:` 路线即使工具已经 loaded 也会返回它，这不是 bug，而是故意的 no-op 兼容

源码镜像：[`../../src/tools/ToolSearchTool/ToolSearchTool.ts`](../../src/tools/ToolSearchTool/ToolSearchTool.ts)

`select:` 分支查找顺序是：

- 先 `findToolByName(deferredTools, toolName)`
- 再 `findToolByName(tools, toolName)`

也就是说，只要这个名字存在于完整工具池，就允许返回，即使它根本不是 deferred tool。

源码注释把原因说得很明确：

- 已经 loaded 的工具被“再次选择”只是 harmless no-op
- 这样可以避免模型因为“它以为 schema 没在 prompt 里”而进入不必要的重试抖动

所以 ToolSearchTool 的行为设计明显偏向：

- 宽容恢复

而不是严格只服务 deferred subset。

## 7. keyword search 的核心不是全文语义检索，而是围绕工具名和 `searchHint` 的轻量高精度排序器

源码镜像：[`../../src/tools/ToolSearchTool/ToolSearchTool.ts`](../../src/tools/ToolSearchTool/ToolSearchTool.ts)

`searchToolsWithKeywords(...)` 的主要打分来源有：

- 解析后的 tool name parts
- full name fallback
- `searchHint`
- prompt/description 文本

打分权重也很明显：

- exact part match 最高
- MCP tool 对 exact/partial part match 权重更高
- `searchHint` 高于 description
- description 只是弱信号兜底

这说明这把工具并不试图做 embedding-style 搜索，而是刻意偏向：

- server name / tool name / curated capability phrase 的高精度匹配

## 8. `searchHint` 在这里是高信号补充，但又被严格限制成单行 capability phrase

源码镜像：[`../../src/services/mcp/client.ts`](../../src/services/mcp/client.ts), [`../../src/tools/ToolSearchTool/ToolSearchTool.ts`](../../src/tools/ToolSearchTool/ToolSearchTool.ts)

动态 MCP tool 合成时会把：

- `_meta['anthropic/searchHint']`

编译进工具对象，并先做 whitespace collapse。

然后 ToolSearchTool keyword search 会给 `searchHint` 一个高于 description 的加分。

这说明 `searchHint` 的定位不是展示文案，而是：

- 为 tool search 提供更精确的 capability alias

同时因为它被压成单行、去掉多余空白，也说明系统不希望它演变成第二份长 prompt。

## 9. description 搜索是带 word-boundary 的，说明它刻意规避 prompt 长文本里的偶然误命中

源码镜像：[`../../src/tools/ToolSearchTool/ToolSearchTool.ts`](../../src/tools/ToolSearchTool/ToolSearchTool.ts)

description 命中用的是：

- 预编译 `\bterm\b` regex

而不是简单 `includes()`。

目的很明确：

- 不让长 prompt 里偶然出现的子串把工具抬上来
- 尽量把真正 capability phrase 留给 `searchHint`
- description 只作为保底弱信号

这也是为什么代码里还要 memoize 每个工具的 prompt 文本，而不是把 description 当一等索引键。

## 10. `getToolDescriptionMemoized(...)` 和 `maybeInvalidateCache(...)` 说明这把工具对 deferred pool 变化是显式有缓存意识的

源码镜像：[`../../src/tools/ToolSearchTool/ToolSearchTool.ts`](../../src/tools/ToolSearchTool/ToolSearchTool.ts)

`ToolSearchTool` 会 memoize：

- `tool.prompt(...)`

缓存键只按：

- `toolName`

但外层又用：

- 所有 deferred tool 名字拼成 `cachedDeferredToolNames`

做整体 invalidation。

一旦 deferred pool 变化，就会：

- `getToolDescriptionMemoized.cache.clear?.()`

这说明它没有试图追踪更细的 prompt 内容变化，而是用“deferred tool 名单变了没有”作为粗粒度失效条件。

对这把工具来说，这个 tradeoff 是合理的，因为最常见的变化就是：

- MCP server 连接/断开
- plugin/tool pool 变化

## 11. no-match 时会把 `pending_mcp_servers` 一起带回去，这不是附带信息，而是重要恢复提示

源码镜像：[`../../src/tools/ToolSearchTool/ToolSearchTool.ts`](../../src/tools/ToolSearchTool/ToolSearchTool.ts)

当搜索结果为空时，工具会额外看：

- `appState.mcp.clients.filter(c => c.type === 'pending')`

如果有仍在连接中的 MCP servers，就把它们的名字塞进返回结构：

- `pending_mcp_servers`

后面 `mapToolResultToToolResultBlockParam(...)` 在 no-match 路径里还会把这件事变成用户可读提示：

- 一些 MCP servers 还在 connecting
- 稍后再试

这说明 ToolSearchTool 的 no-match 语义不是单纯“没找到”，而是会区分：

- truly no such deferred tool
- 也可能只是 server 还没连上，catalog 还没进来

## 12. 它真正返回给模型的不是字符串化 schema，而是 `tool_reference` blocks

源码镜像：[`../../src/tools/ToolSearchTool/ToolSearchTool.ts`](../../src/utils/toolSearch.ts)

只要 `content.matches.length > 0`，`mapToolResultToToolResultBlockParam(...)` 就会返回：

- `content: matches.map(name => ({ type: 'tool_reference', tool_name: name }))`

而不是直接把 JSONSchema 拼成文本。

所以 ToolSearchTool 的真正职责不是“自己输出 schema”，而是：

- 通过 `tool_reference` 告诉 API/宿主：把这些工具的正式 schema 展开进上下文

这也是它和普通搜索工具最大的不同。

## 13. `tool_reference` 的成立依赖模型能力、beta wire format 和 ToolSearchTool 自身可见性三重 gate

源码镜像：[`../../src/utils/toolSearch.ts`](../../src/utils/toolSearch.ts)

真正的 `isToolSearchEnabled(...)` 会同时检查：

- model 是否支持 `tool_reference`
- `ToolSearchTool` 是否真的在工具池里
- `ENABLE_TOOL_SEARCH` 决定的 mode
- `tst-auto` 时是否超过阈值

还要考虑：

- third-party proxy / first-party Anthropic base URL
- `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`

因此 ToolSearchTool 虽然在 optimistic 层可能被提前放进工具池，但是否真正构成一条可工作的 `tool_reference` 链，还要过这些更严格的 gate。

## 14. `tst-auto` 不是 UX 花活，而是 context-budget guard：deferred tool 过重时才正式延迟加载

源码镜像：[`../../src/utils/toolSearch.ts`](../../src/utils/toolSearch.ts)

`ToolSearchMode` 有三种：

- `tst`
- `tst-auto`
- `standard`

其中 `tst-auto` 的关键逻辑是：

- 计算 deferred tool description token/char 规模
- 和模型 context window 百分比阈值比较

只有超过阈值才正式打开 tool search。

这说明 ToolSearchTool 的意义并不只是 MCP catalog 太多，而是：

- 让“把所有 deferred tool schema 直接塞进 prompt”这件事变成按预算触发的策略

## 15. ToolSearchTool 结果和 `deferred_tools_delta` attachment 是两层不同协议

源码镜像：[`../../src/tools/ToolSearchTool/prompt.ts`](../../src/utils/toolSearch.ts)

`prompt.ts` 里明确说：

- 开启 delta 时，deferred tools 会按名字出现在 `<system-reminder>`
- 否则会在 `<available-deferred-tools>` 块里列出来

而 ToolSearchTool 自己只负责：

- 根据这些名字去加载正式 schema

也就是说：

- `deferred_tools_delta` 负责“告诉模型有哪些 deferred tools 存在”
- `ToolSearchTool` 负责“把其中某些工具真正 materialize 成可调用 schema”

这两层不能混为一谈。

## 16. compaction 之后为什么 tool search 还能继续工作，关键在 discovered set 恢复，而不是工具自己有状态

源码镜像：[`../../src/utils/toolSearch.ts`](../../src/utils/attachments.ts)

`extractDiscoveredToolNames(messages)` 会从两处恢复已发现工具：

- 历史 `tool_result` 里的 `tool_reference`
- `compact_boundary.compactMetadata.preCompactDiscoveredTools`

而 `buildSchemaNotSentHint(...)` 又会反过来检查：

- 某工具是否 deferred
- ToolSearchTool 是否可用
- 该工具名是否已经在 discovered set 里

如果不在，就给出精确提示：

- 先调用 `ToolSearch`
- `select:<tool.name>`
- 再重试

因此 compaction 之后 ToolSearch 之所以还能自洽，不是因为工具自己持久化了缓存，而是因为：

- discovered set 被 transcript / boundary attachment 接续了

## 17. 这条 `schema not sent` 恢复链非常关键，它把“Zod 类型错了”重新解释成“你没先加载 schema”

源码镜像：[`../../src/services/tools/toolExecution.ts`](../../src/utils/toolSearch.ts)

在 `toolExecution.ts` 里，如果工具输入先被：

- `tool.inputSchema.safeParse(input)`

打回，系统会再试着追加：

- `buildSchemaNotSentHint(...)`

这条 hint 会明确告诉模型：

- 这个工具 schema 没被发到 API
- 所以数组/数字/布尔被当成字符串，客户端 parse 失败
- 先 `ToolSearch select:<tool>` 再重试

这很重要，因为原始 Zod 报错通常只会说：

- `expected array, got string`

而不会解释真正根因是“deferred schema 根本没在 prompt 里”。ToolSearch 恢复链的价值就在这里。

## 18. 所以 ToolSearchTool 在 Claude Code 里的真正定位，是“延迟工具池的 schema loader 和恢复枢纽”

把这些链收束起来，可以看到它不只是一个搜索工具：

- `prompt.ts` 定义 deferred tool 的暴露哲学
- `ToolSearchTool.ts` 负责 select/search 两种加载入口
- `utils/toolSearch.ts` 负责 capability gate、threshold、attachment 协议和 discovered-set 恢复
- `toolExecution.ts` 负责在 parse 失败时把问题重新引回 ToolSearch

因此更准确的说法不是：

- “ToolSearchTool 用来找工具”

而是：

- `ToolSearchTool` 是 Claude Code 延迟工具池的 schema materialization 和自恢复枢纽。
