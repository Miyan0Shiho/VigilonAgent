# McpAuthTool / needs-auth Placeholder / Background Reconnect Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：ToolSearchTool / Deferred Discovery / tool_reference / Schema Recovery Runtime`](./85-toolsearch-tool-deferred-discovery-tool-reference-and-schema-recovery-runtime.md) | [`下一站：FileEditTool / Staleness / Quote Normalization / Atomic Write Runtime`](./87-fileedit-tool-staleness-quote-normalization-and-atomic-write-runtime.md)

本文把 `McpAuthTool` 从 MCP 总述、连接管理、以及 `/mcp` 菜单叙事里单独抽出来，专门讲“needs-auth server 在工具池里是怎么显形、怎么触发 OAuth、以及怎样在后台被真实工具替换掉”的这一条运行时主链。

相邻卷册已经覆盖了：

- [`84`](./84-mcp-tool-dynamic-tool-synthesis-progress-elicitation-and-result-runtime.md)：已经连通的 executable MCP tools
- [`77`](./77-mcp-resource-listing-reading-and-binary-persistence-runtime.md)：connected server 的 resource tools
- [`06`](../architecture/06-permission-and-mcp-ui-systems.md)：MCP UI 和审批表面

而这篇只讲：

- `needs-auth` 连接状态如何变成一把伪工具
- 为什么这把工具不是普通 MCP tool
- `performMCPOAuthFlow(...)` 的后台继续执行模型
- reconnect 完成后怎样把伪工具原地替换成真实 tool/command/resource
- 自动工具流和 `/mcp` 手动菜单流之间的分工

## 1. `McpAuthTool` 不是 executable MCP tool，而是“needs-auth server 的占位代理”

源码镜像：[`../../src/tools/McpAuthTool/McpAuthTool.ts`](../../src/tools/McpAuthTool/McpAuthTool.ts), [`../../src/services/mcp/client.ts`](../../src/services/mcp/client.ts)

`createMcpAuthTool(serverName, config)` 的注释直接说了它的定位：

- server 已经安装
- 但还没认证
- 真正的 tools 暂时不可用
- 先 surface 一把 pseudo-tool 让模型知道“这个 server 存在，并且可以替用户启动 OAuth”

这说明在 Claude Code 的 MCP worldview 里，`needs-auth` 不是“连接失败就什么都不显示”，而是：

- 退化成一个可操作的占位工具面

## 2. 这把伪工具是按 `mcp__<server>__authenticate` 命名的，所以它能被 prefix-based replacement 自动清掉

源码镜像：[`../../src/tools/McpAuthTool/McpAuthTool.ts`](../../src/tools/McpAuthTool/McpAuthTool.ts), [`../../src/services/mcp/mcpStringUtils.ts`](../../src/services/mcp/mcpStringUtils.ts)

工具名不是通用 `mcp_authenticate`，而是：

- `buildMcpToolName(serverName, 'authenticate')`

同时：

- `mcpInfo = { serverName, toolName: 'authenticate' }`

这件事很关键，因为后面 reconnect 成功后，替换逻辑并不需要额外记住“哪把是 auth tool”，而是直接按：

- `mcp__<server>__*`

整段 prefix 批量替换。伪工具之所以能自动消失，靠的就是它和真实 server tools 共享同一命名空间。

## 3. 它显式标自己是 `isMcp`，但又不是普通 MCP dynamic tool

源码镜像：[`../../src/tools/McpAuthTool/McpAuthTool.ts`](../../src/tools/McpAuthTool/McpAuthTool.ts)

`McpAuthTool` 会声明：

- `isMcp: true`
- `mcpInfo.serverName/toolName`

但与此同时，它没有走：

- `fetchToolsForClient(...)`
- `tools/list`
- `callTool(...)`

也没有从远端 server catalog 动态得出 schema。

所以它在分类上属于：

- MCP lineage 工具

但在执行模型上又完全不是普通 executable MCP tool，而是：

- 本地 auth launcher

## 4. 它故意不是只读，也不是并发安全，说明系统把认证视为独占式状态迁移

源码镜像：[`../../src/tools/McpAuthTool/McpAuthTool.ts`](../../src/tools/McpAuthTool/McpAuthTool.ts)

工具声明是：

- `isConcurrencySafe() => false`
- `isReadOnly() => false`

这很合理，因为一次认证会改变：

- 本地 secure storage 中的 token
- needs-auth cache
- appState.mcp.clients/tools/commands/resources

换句话说，它触发的是一场：

- 宿主状态迁移

而不是一个只读远程查询。

## 5. 输入 schema 被压成空对象，说明这把工具的全部参数空间都来自闭包里的 server config

源码镜像：[`../../src/tools/McpAuthTool/McpAuthTool.ts`](../../src/tools/McpAuthTool/McpAuthTool.ts)

输入是：

- `z.object({})`

调用时也没有让模型传：

- auth URL
- callback port
- scopes
- transport 选择

这些信息都来自 `createMcpAuthTool(serverName, config)` 捕获下来的 server config。

这说明 `McpAuthTool` 不是“开放式 auth client”，而是：

- 某一个已知 server 的固定 auth launcher

## 6. 权限层直接 `allow`，因为它的本质不是执行危险动作，而是把用户带到认证流程

源码镜像：[`../../src/tools/McpAuthTool/McpAuthTool.ts`](../../src/tools/McpAuthTool/McpAuthTool.ts)

`checkPermissions()` 直接返回：

- `behavior: 'allow'`

这里没有额外 permission dialog，也没有 path/domain rule 建议。

原因很直接：

- 真正的危险边界在 OAuth 浏览器交互和后续 server capability
- 不是在“启动这个 auth launcher”本身

所以 Claude Code 选择把它当成：

- 低阻力 operator bridge

而不是再套一层权限确认。

## 7. `claudeai-proxy` 明确不走这条工具流，而是把用户打回 `/mcp`

源码镜像：[`../../src/tools/McpAuthTool/McpAuthTool.ts`](../../src/tools/McpAuthTool/McpAuthTool.ts), [`../../src/components/mcp/MCPRemoteServerMenu.tsx`](../../src/components/mcp/MCPRemoteServerMenu.tsx)

一上来就有一条 hard fork：

- `config.type === 'claudeai-proxy'`

直接返回：

- `status: 'unsupported'`
- 让用户运行 `/mcp` 并手动选择 server 认证

源码注释写得很清楚：

- claude.ai connectors 用的是单独的 auth flow
- 这里不会程序化调用它

这意味着 `McpAuthTool` 的自动 launcher 只服务：

- `sse`
- `http`

而不服务 claude.ai org-managed connector。

## 8. 非 HTTP/SSE transport 也会被防御性拒绝，因为 `needs-auth` 理论上只该出现在这些远端 transport 上

源码镜像：[`../../src/tools/McpAuthTool/McpAuthTool.ts`](../../src/tools/McpAuthTool/McpAuthTool.ts)

第二条 fork 是：

- `config.type !== 'sse' && config.type !== 'http'`

这时也返回：

- `status: 'unsupported'`
- 要求用户去 `/mcp` 手动处理

注释里说明了为什么这看起来像多余防守：

- `needs-auth` 状态通常只在 HTTP 401 后出现
- 所以理论上非这些 transport 不该走到这里

但代码仍然保留 defensive branch，避免未来 transport 扩展时误入错误 launcher。

## 9. 工具真正做的第一件事不是发 OAuth 请求，而是创建“一条等 URL 的 Promise”和“一条完整 flow 的 Promise”

源码镜像：[`../../src/tools/McpAuthTool/McpAuthTool.ts`](../../src/tools/McpAuthTool/McpAuthTool.ts)

`call(...)` 里先造了两条并行语义：

- `authUrlPromise`
- `oauthPromise = performMCPOAuthFlow(...)`

其中：

- `authUrlPromise` 只等 `onAuthorizationUrl(...)`
- `oauthPromise` 等整场 flow 真正完成

后面再：

- `Promise.race([authUrlPromise, oauthPromise.then(() => null)])`

这说明工具的交互模型不是“等认证完成再返回”，而是：

- 只要拿到 auth URL 就先把它回给模型/用户
- 真正的认证完成在后台继续

## 10. `performMCPOAuthFlow(...)` 本身就是一条复杂宿主流程，`McpAuthTool` 只是它的启动器

源码镜像：[`../../src/services/mcp/auth.ts`](../../src/services/mcp/auth.ts)

`performMCPOAuthFlow(...)` 不是简单打开浏览器，它内部还负责：

- XAA 分支优先级
- 读取并清理 cached step-up scope / discovery state
- 挑 callback port
- 建 redirect URI
- 拉 auth metadata
- 启本地 callback server
- 跑 SDK auth flow

而 `McpAuthTool` 调它时只加了一层关键选项：

- `{ skipBrowserOpen: true }`

这说明工具层故意不替用户直接弹浏览器，而是把 URL 交还给 operator / 模型，再由外层决定如何让用户打开。

## 11. 它支持 silent success，这也是为什么 race 里要允许 `oauthPromise` 先完成

源码镜像：[`../../src/tools/McpAuthTool/McpAuthTool.ts`](../../src/services/mcp/auth.ts), [`../../src/commands/mcp/xaaIdpCommand.ts`](../../src/commands/mcp/xaaIdpCommand.ts)

`Promise.race(...)` 的另一支是：

- `oauthPromise.then(() => null)`

源码注释明确点名了一个场景：

- XAA with cached IdP token
- silent auth

也就是说有些情况下：

- 用户根本不会先拿到一个要打开的 URL
- flow 会直接在后台完成

这时工具仍然返回：

- `status: 'auth_url'`
- 但 message 变成 “Authentication completed silently...”

所以 `auth_url` 这个状态名本身已经带一点历史包袱；它实际表示的是：

- auth launcher 正常启动，可能返回 URL，也可能 silent 完成

## 12. 真正重要的不是即时返回，而是后面的 fire-and-forget continuation

源码镜像：[`../../src/tools/McpAuthTool/McpAuthTool.ts`](../../src/services/mcp/client.ts)

`oauthPromise` 会被单独接一条：

- `void oauthPromise.then(...).catch(...)`

这条 background continuation 才是整个设计的核心，因为它会在 flow 完成后：

1. `clearMcpAuthCache()`
2. `reconnectMcpServerImpl(serverName, config)`
3. 找到 `mcp__<server>__` prefix
4. 在 `appState.mcp` 里把旧 client/tools/commands/resources 原地替换掉

也就是说，`McpAuthTool` 不是“返回 URL 就结束”，而是：

- 先把 URL 给到用户
- 再偷偷在后台把 server 从 `needs-auth` 翻成 `connected`

## 13. `clearMcpAuthCache()` 很关键：不先清 15 分钟 needs-auth cache，后续 reconnect 还会被自己挡回去

源码镜像：[`../../src/services/mcp/client.ts`](../../src/services/mcp/client.ts), [`../../src/tools/McpAuthTool/McpAuthTool.ts`](../../src/tools/McpAuthTool/McpAuthTool.ts)

连接层有一条明确逻辑：

- 如果远端 server 在 15 分钟 needs-auth cache 里
- 就会跳过真实连接，直接继续 surface `needs-auth`

所以工具完成 OAuth 之后，第一件事必须是：

- `clearMcpAuthCache()`

否则：

- token 已经拿到了
- 但 reconnect 还是会被旧的 needs-auth cache 短路

这一步实际上是 auth launcher 和连接层之间的关键手工接缝。

## 14. `reconnectMcpServerImpl(...)` 才是把占位工具“物化”为真实 server surface 的主入口

源码镜像：[`../../src/services/mcp/client.ts`](../../src/services/mcp/client.ts)

`reconnectMcpServerImpl(...)` 自己会：

- `clearKeychainCache()`
- `clearServerCache(...)`
- `connectToServer(...)`
- 重新拉：
  - `fetchToolsForClient(...)`
  - `fetchCommandsForClient(...)`
  - `fetchMcpSkillsForClient(...)`
  - `fetchResourcesForClient(...)`
- 必要时再补 `ListMcpResourcesTool` / `ReadMcpResourceTool`

所以对 `McpAuthTool` 来说，OAuth 完成后的世界切换并不是“只替换一把 authenticate tool”，而是整套 server surface 重建：

- client
- tools
- commands
- skills
- resources

## 15. prefix-based replacement 说明工具层没有额外写“删除 auth tool”的专门逻辑

源码镜像：[`../../src/tools/McpAuthTool/McpAuthTool.ts`](../../src/tools/McpAuthTool/McpAuthTool.ts), [`../../src/services/mcp/useManageMCPConnections.ts`](../../src/services/mcp/useManageMCPConnections.ts)

后台 continuation 在更新 `appState` 时会：

- `reject(prev.mcp.tools, t => t.name?.startsWith(prefix))`
- `reject(prev.mcp.commands, c => c.name?.startsWith(prefix))`

然后再 append 新拉回来的 tool/command。

因此 auth tool 的消失不是靠：

- “如果是 authenticate 就删掉”

而是靠：

- 整个 server namespace 被刷新

这让 auth tool、真实 tools、真实 commands 共享一套统一替换机制。

## 16. `needs-auth` 状态本身就是在连接层构造的，并且会触发这个伪工具的注入

源码镜像：[`../../src/services/mcp/client.ts`](../../src/services/mcp/client.ts)

连接层有两条关键信号：

- `handleRemoteAuthFailure(...)` 会把连接结果标成 `type: 'needs-auth'`
- `getMcpToolsCommandsAndResources(...)` 在遇到 `needs-auth` 时，不返回真实工具，而是返回：
  - `tools: [createMcpAuthTool(name, config)]`

并且对：

- cached needs-auth
- probe 发现 “have discovery but no token”

这两种情况也会直接走同样的伪工具注入。

所以 `McpAuthTool` 不是孤立工具，而是 `needs-auth` 连接状态在工具池中的官方投影。

## 17. `/mcp` 手动路径和 `McpAuthTool` 自动路径是并列关系，不是重复实现

源码镜像：[`../../src/commands/mcp/mcp.tsx`](../../src/commands/mcp/mcp.tsx), [`../../src/services/mcp/useManageMCPConnections.ts`](../../src/services/mcp/useManageMCPConnections.ts)

手动路径主要是：

- `/mcp`
- `MCPSettings`
- `MCPReconnect`
- enable/disable/toggle

而 `McpAuthTool` 则是：

- 模型在看到 needs-auth server 时，直接从工具层发起 auth launcher

两者分工不同：

- `/mcp` 是 operator menu
- `McpAuthTool` 是 agent-callable auth bridge

特别是对 `claudeai-proxy`，系统还明确要求：

- 只能走 `/mcp`

这也进一步证明这两条 auth path 不是重复，而是 transport-specific 分流。

## 18. 从结果协议看，这把工具真正返回的是“如何继续”的 operator message，而不是结构化 credential artifact

源码镜像：[`../../src/tools/McpAuthTool/McpAuthTool.ts`](../../src/tools/McpAuthTool/McpAuthTool.ts)

输出 schema 只有：

- `status`
- `message`
- 可选 `authUrl`

而 `mapToolResultToToolResultBlockParam(...)` 最终只把：

- `data.message`

写回 tool_result。

也就是说，它不会把：

- token
- callback state
- discovery metadata

暴露给模型。模型拿到的只有：

- 让用户去打开哪个 URL
- 或者告诉用户改走 `/mcp`
- 或者说明 silent auth 已完成

这是一条典型的：

- operator-in-the-loop message contract

## 19. 因而 `McpAuthTool` 在 Claude Code 里的真实定位，是“needs-auth MCP server 的本地引导器和后台 surface replacement 触发器”

把整条链收束起来，可以看到它不是普通工具，也不是纯 UI 菜单：

- 连接层把 auth failure 投影成 `needs-auth`
- 工具池把 `needs-auth` server 投影成 `mcp__<server>__authenticate`
- 工具调用层只负责启动 `performMCPOAuthFlow(...)`
- 真正的世界切换在后台 continuation：
  - 清 auth cache
  - reconnect
  - prefix 替换
  - 真实 tools/commands/resources 上线

所以更准确的说法不是：

- “McpAuthTool 用来做 OAuth”

而是：

- `McpAuthTool` 是 Claude Code 把“未认证的 MCP server”显性化、可操作化、再无缝翻转成真实 server surface 的本地引导器。
