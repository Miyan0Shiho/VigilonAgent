# MCP Resource Listing / Reading / Binary Persistence Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：SendMessageTool / Peer Routing / Mailbox / Cross-Session Runtime`](./76-sendmessage-tool-peer-routing-mailbox-and-cross-session-runtime.md) | [`下一站：EnterWorktree / ExitWorktree / Session Switching / Cleanup Runtime`](./78-enter-exit-worktree-session-switching-and-cleanup-runtime.md)

本文把 `ListMcpResourcesTool` 和 `ReadMcpResourceTool` 从旧的 MCP 总述里拆出来。重点不是“它们能列资源、读资源”，而是它们怎样把 MCP 的 resource surface 单独建成：

- `connected-client check`
- `capability gate`
- `LRU cached resources/list`
- `resources/list_changed invalidation`
- `resource body read`
- `binary blob persist-to-disk`
- `JSON-oriented tool_result / UI rendering`

这条链和 `MCPTool` 的“调用工具”是不同产品面：前者面向“服务器公开出来的资源目录与资源体”，后者面向“带 input schema 的可执行操作”。

## 1. 这两把工具是 `MCPTool` 旁边的平行资源面，不是它的 alias

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/client.ts), [`../../sources/claude-code/src/tools/ListMcpResourcesTool/ListMcpResourcesTool.ts`](../../sources/claude-code/src/tools/ListMcpResourcesTool/ListMcpResourcesTool.ts), [`../../sources/claude-code/src/tools/ReadMcpResourceTool/ReadMcpResourceTool.ts`](../../sources/claude-code/src/tools/ReadMcpResourceTool/ReadMcpResourceTool.ts)

在 MCP client 主文件里，三条入口是并列注册的：

- `MCPTool`
- `ListMcpResourcesTool`
- `ReadMcpResourceTool`

这说明 Claude Code 对 MCP 不是“只有 tool calls”，而是承认：

- 工具调用面
- 资源目录面
- 资源内容面

是三种不同 runtime。

## 2. 两把资源工具都被声明成 `readOnly + concurrencySafe + shouldDefer`

源码镜像：[`../../sources/claude-code/src/tools/ListMcpResourcesTool/ListMcpResourcesTool.ts`](../../sources/claude-code/src/tools/ListMcpResourcesTool/ListMcpResourcesTool.ts), [`../../sources/claude-code/src/tools/ReadMcpResourceTool/ReadMcpResourceTool.ts`](../../sources/claude-code/src/tools/ReadMcpResourceTool/ReadMcpResourceTool.ts)

它们共同的底层姿态是：

- `isReadOnly() => true`
- `isConcurrencySafe() => true`
- `shouldDefer: true`

说明 Claude Code 把 MCP resource access 定义成：

- 无本地副作用
- 可并发
- 但仍可被 query loop 延后执行

它们不是 UI-only helper，也不是只能前台同步跑的小工具。

## 3. `ListMcpResourcesTool` 的 schema 极小，表明它的职责只是“列目录”，不负责进一步过滤或分页

源码镜像：[`../../sources/claude-code/src/tools/ListMcpResourcesTool/ListMcpResourcesTool.ts`](../../sources/claude-code/src/tools/ListMcpResourcesTool/ListMcpResourcesTool.ts)

input 只有：

- `server?`

output 是一个资源数组，每项包含：

- `uri`
- `name`
- `mimeType?`
- `description?`
- `server`

没有：

- pagination
- regex filter
- capability shaping

所以它就是一把“拿目录快照”的工具，不承担 richer query planner 的角色。

## 4. `ReadMcpResourceTool` 的 schema 刻意要求 `server + uri` 二元组，说明 URI 不是全局唯一真相源

源码镜像：[`../../sources/claude-code/src/tools/ReadMcpResourceTool/ReadMcpResourceTool.ts`](../../sources/claude-code/src/tools/ReadMcpResourceTool/ReadMcpResourceTool.ts)

输入要求：

- `server`
- `uri`

这意味着 Claude Code 不假设：

- 只靠 URI 就能在全局 MCP 世界里唯一定位一个资源

而是把“哪台 server 提供了这个 URI”作为 read contract 的正式一部分。

## 5. 两把工具的 auto-classifier 输入都故意压得很短，说明它们的意图足够单纯

源码镜像：[`../../sources/claude-code/src/tools/ListMcpResourcesTool/ListMcpResourcesTool.ts`](../../sources/claude-code/src/tools/ReadMcpResourceTool/ReadMcpResourceTool.ts)

它们给 classifier 的输入分别是：

- list: `server ?? ''`
- read: `${server} ${uri}`

没有把资源结果体内容再喂回分类器，说明这两把工具在审批/自动分类链上的语义非常单纯：

- 列哪台 server 的目录
- 读哪台 server 的哪个 URI

## 6. `ListMcpResourcesTool` 的核心不是发请求，而是“逐 server 容错 + per-server reconnect”

源码镜像：[`../../sources/claude-code/src/tools/ListMcpResourcesTool/ListMcpResourcesTool.ts`](../../sources/claude-code/src/services/mcp/client.ts)

它不是简单调用一次全局 `resources/list`，而是：

1. 先选定 `clientsToProcess`
2. 对每个 client：
   - 非 connected 直接跳过
   - `ensureConnectedClient(client)`
   - `fetchResourcesForClient(fresh)`
3. 某一台失败时：
   - `logMCPError(...)`
   - 返回 `[]`

所以一台 MCP server 的重连失败不会击穿整轮资源列举，这是一种明确的 per-server graceful degradation。

## 7. `server` 过滤先发生在工具层，不在 MCP service 层做模糊匹配

源码镜像：[`../../sources/claude-code/src/tools/ListMcpResourcesTool/ListMcpResourcesTool.ts`](../../sources/claude-code/src/tools/ReadMcpResourceTool/ReadMcpResourceTool.ts)

不管 list 还是 read，server 选择逻辑都很硬：

- 名字精确匹配
- 找不到直接报错并列出 available servers

所以工具层不做 fuzzy routing，也不会帮模型猜 server alias。

## 8. `fetchResourcesForClient` 用 LRU cache 按 server name 记忆目录结果，因此“列资源”默认读的是缓存快照

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/client.ts)

client 层把 `fetchResourcesForClient` 包进了：

- `memoizeWithLRU`
- key: `client.name`
- size: `MCP_FETCH_CACHE_SIZE = 20`

而 `ListMcpResourcesTool` 注释直接说明：

- 这层缓存通常在 startup prefetch 时就已经 warm

所以 list tool 的默认体验不是每次重新打 MCP 请求，而是优先返回：

- 每台 server 最近一次、且仍有效的资源目录缓存

## 9. 这层资源缓存不是永远不变，而是靠 `onclose` 和 `resources/list_changed` 两条边触发失效

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/client.ts), [`../../sources/claude-code/src/services/mcp/useManageMCPConnections.ts`](../../sources/claude-code/src/services/mcp/useManageMCPConnections.ts)

当前可见的失效机制有两条：

- 连接断开时删除缓存
- 收到 `resources/list_changed` notification 时：
  - `fetchResourcesForClient.cache.delete(client.name)`
  - 重新抓取资源

因此这套缓存并不是“快但可能 stale”，而是试图在资源目录变更事件上保持一致性。

## 10. `resources/list_changed` 不只刷新资源，还会在启用 `MCP_SKILLS` 时级联刷新 skills/commands

源码镜像：[`../../sources/claude-code/src/services/mcp/useManageMCPConnections.ts`](../../sources/claude-code/src/services/mcp/useManageMCPConnections.ts)

当 server 支持：

- `resources.listChanged`

并且 feature `MCP_SKILLS` 打开时，notification handler 会同时：

- 删掉 resources cache
- 删掉 mcp skills cache
- 删掉 commands/prompts cache
- 并发重抓：
  - resources
  - prompts
  - skills

这说明在 Claude Code 里，MCP resources 并不是孤立资产；它们还可能是 MCP skills 发现链的一部分。

## 11. `ensureConnectedClient` 先做“SDK server 直通”，再做普通 server 的 reconnect

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/services/mcp/client.ts)

这层函数的关键分义是：

- `config.type === 'sdk'`
  - 直接返回原 client
- 其他 server
  - 走 `connectToServer(...)`
  - 如果仍非 connected，则抛错

所以资源工具的 reconnect 语义对：

- SDK in-process MCP
- stdio/SSE/HTTP/WebSocket MCP

并不相同。前者没有真正的“重连 transport”步骤。

## 12. `ReadMcpResourceTool` 先验证 capability，再发 `resources/read`，因此“连接成功”不等于“能读资源”

源码镜像：[`../../sources/claude-code/src/tools/ReadMcpResourceTool/ReadMcpResourceTool.ts`](../../sources/claude-code/src/services/mcp/client.ts)

它按顺序检查：

1. server 是否存在
2. client 是否 connected
3. `client.capabilities?.resources` 是否存在
4. `ensureConnectedClient(client)`
5. `client.request({ method: 'resources/read', params: { uri } })`

这说明 Claude Code 对 MCP resources 有明确 capability gate，而不是只要 transport 连上就默认支持资源协议。

## 13. `ListMcpResourcesTool` 返回“资源目录 JSON”，`ReadMcpResourceTool` 返回“contents array”，两者不是同型输出

源码镜像：[`../../sources/claude-code/src/tools/ListMcpResourcesTool/ListMcpResourcesTool.ts`](../../sources/claude-code/src/tools/ReadMcpResourceTool/ReadMcpResourceTool.ts)

list 的输出是：

- 一组 resource metadata

read 的输出则是：

- `{ contents: [...] }`

每个 content 又可能是：

- text
- mime only
- `blobSavedTo`

这说明 read 工具不是简单把 list 项目展开成一个 text string，而是保留了 MCP `contents[]` 多块结构。

## 14. text content 直接内联，blob content 则强制走 persist-to-disk，这是一条硬分流

源码镜像：[`../../sources/claude-code/src/tools/ReadMcpResourceTool/ReadMcpResourceTool.ts`](../../sources/claude-code/src/utils/mcpOutputStorage.ts)

`result.contents.map(...)` 时：

- 有 `text` 字段
  - 直接返回 `{ uri, mimeType, text }`
- 有 `blob` 字段
  - `Buffer.from(base64, 'base64')`
  - `persistBinaryContent(...)`
  - 再把结果转成：
    - `blobSavedTo`
    - 一段告知路径的 text

所以 Claude Code 对 binary resource 的默认策略不是把 base64 扔进上下文，而是先落盘。

## 15. binary persist 的真正目标不是节省字符，而是保住原始文件类型和后续本地工具可用性

源码镜像：[`../../sources/claude-code/src/utils/mcpOutputStorage.ts`](../../sources/claude-code/src/utils/mcpOutputStorage.ts)

这层工具明确做了：

- MIME -> extension 映射
- 写入 `tool-results` 目录
- 保留原始 bytes

注释说得很清楚：

- 不是 stringified 存储
- 是为了让 `Read`、native tools、pandas、PDF/image reader 之后还能真正打开

所以这里的 persist-to-disk 本质上是“把 MCP binary resource 转成 Claude Code 本地文件资产”。

## 16. blob 保存失败也不会把 read 整体判死，而是退化成一段错误文本

源码镜像：[`../../sources/claude-code/src/tools/ReadMcpResourceTool/ReadMcpResourceTool.ts`](../../sources/claude-code/src/utils/mcpOutputStorage.ts)

如果 `persistBinaryContent(...)` 返回：

- `{ error }`

read 工具不会抛错中断整轮，而是把该块改写成：

- `text: Binary content could not be saved to disk: ...`

这和 list tool 的 per-server graceful degradation 是同一路线：尽量把局部失败变成局部结果，而不是整体失败。

## 17. `getBinaryBlobSavedMessage(...)` 的文案刻意保守，只告诉模型“文件在哪”，不强加处理策略

源码镜像：[`../../sources/claude-code/src/utils/mcpOutputStorage.ts`](../../sources/claude-code/src/utils/mcpOutputStorage.ts)

返回消息只包含：

- source description
- mime type
- file size
- saved path

注释明确说：

- 不给 prescriptive hint
- 因为模型后续能做什么取决于 provider/tooling

所以 Claude Code 只负责把 blob 变成可访问文件，不替模型提前决定消费方式。

## 18. 两把工具的 UI 都选择直接把 JSON pretty-print 成 human-facing result，而不是再设计专门富文本列表

源码镜像：[`../../sources/claude-code/src/tools/ListMcpResourcesTool/UI.tsx`](../../sources/claude-code/src/tools/ReadMcpResourceTool/UI.tsx)

UI 共同点是：

- tool_use message 只给一句短描述
- tool_result message 走 `jsonStringify(..., null, 2)`
- 再喂给 `OutputLine`

这说明资源工具的前台目标是：

- 保真呈现结构化结果

而不是像 `AgentTool`、`BriefTool` 那样做更强的产品化 UI 抽象。

## 19. `ListMcpResourcesTool` 特意把 `server` 字段灌回每个 resource，说明它默认支持“跨 server 扁平聚合视图”

源码镜像：[`../../sources/claude-code/src/services/mcp/client.ts`](../../sources/claude-code/src/tools/ListMcpResourcesTool/ListMcpResourcesTool.ts)

`fetchResourcesForClient(...)` 会对每个 resource 追加：

- `server: client.name`

这不是 MCP 原生字段，而是 Claude Code 自己补的聚合字段。原因很直接：

- list tool 支持不传 `server`
- 这时需要把所有 server 的资源扁平合并成一个数组
- 如果不补 server，后续就无法把目录项重新路由到 read tool

## 20. no-resource 和 no-content 都被设计成 benign result，而不是异常

源码镜像：[`../../sources/claude-code/src/tools/ListMcpResourcesTool/ListMcpResourcesTool.ts`](../../sources/claude-code/src/tools/ListMcpResourcesTool/UI.tsx), [`../../sources/claude-code/src/tools/ReadMcpResourceTool/UI.tsx`](../../sources/claude-code/src/tools/ReadMcpResourceTool/ReadMcpResourceTool.ts)

这里有两种“空”：

- list 结果为空
  - tool_result 直接返回一段 benign text
  - UI 显示 `(No resources found)`
- read 结果 `contents.length === 0`
  - UI 显示 `(No content)`

所以 Claude Code 把“资源面为空”视为一个正常世界状态，而不是错误。

## 21. 这两把工具和 `MCPTool` 的真正分工是：前者暴露资源目录/内容，后者暴露可执行工具

资源链关心的是：

- `resources/list`
- `resources/read`
- resource capability
- cache invalidation
- blob 持久化

`MCPTool` 关心的则是：

- tool schema
- tool invocation
- progress
- truncation
- structured content/tool results

所以 Claude Code 把 MCP 看成一个至少三面的系统：

- tools
- prompts/commands
- resources

而不是单一“callTool”世界。

## 相关卷册

- MCP 总装配与连接治理：[`./05-mcp-integration.md`](./05-mcp-integration.md)
- MCP UI 与审批面：[`../architecture/06-permission-and-mcp-ui-systems.md`](../architecture/06-permission-and-mcp-ui-systems.md)
- AskUserQuestion / Elicitation 等 MCP 交互面：[`../architecture/26-prompt-queue-and-elicitation-input-surfaces.md`](../architecture/26-prompt-queue-and-elicitation-input-surfaces.md)
- Tool search / MCP instruction deltas：[`./28-tool-search-deferred-tools-and-mcp-instruction-deltas.md`](./28-tool-search-deferred-tools-and-mcp-instruction-deltas.md)
