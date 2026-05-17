# LSPTool / Initialization / Deferred Loading / Diagnostic Attachment Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：TaskStopTool / stopTask / Shared Kill Path / SDK Bookend Runtime`](./79-taskstop-tool-stoptask-shared-kill-path-and-sdk-bookend-runtime.md) | [`下一站：ScheduleCron Tools / Scheduler / Durable-Session Runtime`](./81-schedule-cron-tools-scheduler-and-durable-session-runtime.md)

本文把 `LSPTool` 从 recommendation、plugin、read/search 总述里单独拆出来。重点不是“Claude Code 支持 go-to-definition”，而是它怎样把一套 editor-style code intelligence 收束成：

- feature-gated tool exposure
- `defer_loading` API surface
- singleton LSP manager lifecycle
- read-permission-aware file opening
- two-step call-hierarchy flow
- formatter/UI dual surface
- passive diagnostics as async attachments

这条链本质上是“把 REPL 里的代码智能做成一个可延迟装配、可失败降级、可附带被动诊断的只读工具 runtime”。

## 1. `LSPTool` 不是默认常驻工具，而是被环境 gate 明确控制

源码镜像：[`../../src/tools.ts`](../../src/tools.ts), [`../../src/tools/LSPTool/LSPTool.ts`](../../src/tools/LSPTool/LSPTool.ts)

工具池里它的装配条件是：

- `isEnvTruthy(process.env.ENABLE_LSP_TOOL) ? [LSPTool] : []`

所以 Claude Code 并不假设所有宿主都能安全、稳定地提供 LSP。它先把这件事当成 capability gate，再决定是否让模型看见这把工具。

## 2. 即便工具暴露了，`isEnabled()` 也还要再过一层 runtime 健康检查

源码镜像：[`../../src/tools/LSPTool/LSPTool.ts`](../../src/tools/LSPTool/LSPTool.ts), [`../../src/services/lsp/manager.ts`](../../src/services/lsp/manager.ts)

`LSPTool.isEnabled()` 调的是：

- `isLspConnected()`

这层不是“是否初始化过”，而是：

- init 没失败
- manager 存在
- 至少有一台 server
- 且至少一台 server `state !== 'error'`

所以工具可见性不是纯 feature flag，而是 feature flag 加 runtime health。

## 3. API 层还单独支持 `defer_loading`，因为 LSP 初始化本来就被允许晚于会话启动

源码镜像：[`../../src/services/api/claude.ts`](../../src/services/api/claude.ts)

`shouldDeferLspTool(tool)` 的规则很简单：

- 只对 `tool.isLsp === true` 生效
- 当 `getInitializationStatus()` 是 `pending` 或 `not-started`
- 就把这把工具当成 `defer_loading`

这说明 Claude Code 不会因为 LSP 还没准备好就直接把工具从 schema 里删掉，而是让模型先知道“这把工具会来，只是现在还没 ready”。

## 4. 这种 deferred surface 不是 UI trick，而是和 API/tool-search 协议绑定的

源码镜像：[`../../src/services/api/claude.ts`](../../src/services/api/claude.ts)

`claude.ts` 里明确写着：

- `defer_loading` 是工具 schema 层属性
- hash/cache 计算还会特意把 defer-loading 工具排除出某些稳定性计算

所以 LSP 的“晚到”不是 REPL 自己处理的，而是进入了模型 API 契约层。

## 5. LSP manager 是全局 singleton，而且初始化状态机比普通 service 更细

源码镜像：[`../../src/services/lsp/manager.ts`](../../src/services/lsp/manager.ts)

它维护的不是一个简单布尔值，而是：

- `not-started`
- `pending`
- `success`
- `failed`

同时还带：

- `initializationError`
- `initializationGeneration`
- `initializationPromise`

这说明 Claude Code 很明确地把 “LSP 可能初始化慢、初始化失败、插件刷新后要重建” 当成一等运行时问题。

## 6. 初始化本身还是故意异步且不阻塞 startup 的

源码镜像：[`../../src/services/lsp/manager.ts`](../../src/services/lsp/manager.ts)

`initializeLspServerManager()` 做的是：

1. 创建 manager instance
2. 标成 `pending`
3. `initialize()` 异步跑
4. 成功后注册 passive notification handlers
5. 失败后把 instance 清空并记下 error

所以 Claude Code 接受一种正常状态：

- 主会话已经开始
- LSP 还没 ready

这正是前面 `defer_loading` 存在的原因。

## 7. `LSPTool.call()` 会主动等待 pending init，但不会等待 not-started 之外的奇迹

源码镜像：[`../../src/tools/LSPTool/LSPTool.ts`](../../src/tools/LSPTool/LSPTool.ts), [`../../src/services/lsp/manager.ts`](../../src/services/lsp/manager.ts)

调用时它先看：

- `const status = getInitializationStatus()`

如果是 `pending`：

- `await waitForInitialization()`

但如果 manager 最终不存在，就直接返回：

- `LSP server manager not initialized. This may indicate a startup issue.`

也就是说，它愿意等“已经开始的初始化”，但不会自己偷偷启动另一套初始化流程。

## 8. 输入 schema 看起来统一，真正的类型校验却故意走 discriminated union

源码镜像：[`../../src/tools/LSPTool/LSPTool.ts`](../../src/tools/LSPTool/LSPTool.ts), [`../../src/tools/LSPTool/schemas.ts`](../../src/tools/LSPTool/schemas.ts)

对外暴露的 tool schema 是普通 strict object，字段统一是：

- `operation`
- `filePath`
- `line`
- `character`

但 `validateInput()` 实际跑的是：

- `lspToolInputSchema().safeParse(input)`

而那个 schema 是按 `operation` 的 discriminated union 分开的。

这说明 Claude Code 想同时拿到两件事：

- API/tool schema 侧的简单统一接口
- 校验错误时更细的 operation-aware 类型安全

## 9. 这把工具是只读且并发安全，但仍然强制走文件读取权限检查

源码镜像：[`../../src/tools/LSPTool/LSPTool.ts`](../../src/tools/LSPTool/LSPTool.ts)

它声明了：

- `isConcurrencySafe() => true`
- `isReadOnly() => true`

但权限检查仍然是：

- `checkReadPermissionForTool(LSPTool, input, appState.toolPermissionContext)`

所以“只读”不等于“不需要权限”。Claude Code 把 LSP 定义成一种 file-intelligence read path，而不是内部免审能力。

## 10. validate 阶段还专门防了一类和普通 Read/Grep 不完全一样的风险：UNC path

源码镜像：[`../../src/tools/LSPTool/LSPTool.ts`](../../src/tools/LSPTool/LSPTool.ts)

它有一段很罕见的分支：

- 如果路径以 `\\\\` 或 `//` 开头
- 跳过后续本地文件 stat 流程

注释写的是：

- 防止 UNC path 触发 NTLM credential leak

这说明 LSPTool 的 threat model 已经不只是“能不能读文件”，还包括“为了确认文件是否存在而触发了什么网络副作用”。

## 11. 即使路径合法，它也会在真正发 LSP request 前补一条 `didOpen` side effect

源码镜像：[`../../src/tools/LSPTool/LSPTool.ts`](../../src/tools/LSPTool/LSPTool.ts)

在 `manager.sendRequest(...)` 之前，它会检查：

- `manager.isFileOpen(absolutePath)`

如果还没 open：

- 本地读文件
- 大于 10MB 直接拒绝
- `await manager.openFile(absolutePath, fileContent)`

这说明在 Claude Code 的 runtime 里，LSP request 不是纯 RPC；很多 server 需要先把 file 变成一份已打开文档状态。

## 12. 这个 open-file 行为还有一个严格预算：10MB 上限

源码镜像：[`../../src/tools/LSPTool/LSPTool.ts`](../../src/tools/LSPTool/LSPTool.ts)

如果文件超过：

- `MAX_LSP_FILE_SIZE_BYTES = 10_000_000`

它不会硬送进 server，而是直接返回：

- `File too large for LSP analysis ... exceeds 10MB limit`

这说明 LSP 在这里被当成交互式代码智能，不是大文件索引器。

## 13. operation 到 LSP method 的映射是显式白名单，不存在任意 method 透传

源码镜像：[`../../src/tools/LSPTool/LSPTool.ts`](../../src/tools/LSPTool/LSPTool.ts)

`getMethodAndParams(...)` 只支持固定几类：

- `textDocument/definition`
- `textDocument/references`
- `textDocument/hover`
- `textDocument/documentSymbol`
- `workspace/symbol`
- `textDocument/implementation`
- `textDocument/prepareCallHierarchy`

而且行列坐标会统一从用户的 1-based 转成协议的 0-based。

所以 `LSPTool` 不是 “开放式 LSP console”，而是包装过的、被产品层筛过的有限能力集。

## 14. `incomingCalls` / `outgoingCalls` 不是单 request，而是强制两段式调用

源码镜像：[`../../src/tools/LSPTool/LSPTool.ts`](../../src/tools/LSPTool/LSPTool.ts)

这两种操作先跑：

- `textDocument/prepareCallHierarchy`

拿到 `CallHierarchyItem[]` 之后，再用第一项去跑：

- `callHierarchy/incomingCalls`
- `callHierarchy/outgoingCalls`

这说明 Claude Code 没把 call hierarchy 藏进 server 端黑盒，而是明确把“两段式 LSP 协议”留在 tool runtime 里。

## 15. “没有可用 server” 不是异常，而是被当成正常降级结果

源码镜像：[`../../src/tools/LSPTool/LSPTool.ts`](../../src/tools/LSPTool/LSPTool.ts)

当：

- `manager.sendRequest(...)` 返回 `undefined`

工具不会 throw，而是返回：

- `No LSP server available for file type: ...`

所以 LSP 缺席在 Claude Code 里是一个正常产品状态，不是 crash。

## 16. location-based 结果还会过一层 `.gitignore` 过滤，说明 LSP 输出不会被原样直通给模型

源码镜像：[`../../src/tools/LSPTool/LSPTool.ts`](../../src/tools/LSPTool/LSPTool.ts)

对这些 operation：

- `findReferences`
- `goToDefinition`
- `goToImplementation`
- `workspaceSymbol`

如果结果是 location array，就会：

- 提取出 location
- `filterGitIgnoredLocations(...)`
- 再按过滤后的 URI 重建结果

也就是说，LSP server 看到的工作区范围，不一定等于最终愿意暴露给模型的结果范围。

## 17. formatter 层承担了大量 defensive normalization，而不是只做排版

源码镜像：[`../../src/tools/LSPTool/formatters.ts`](../../src/tools/LSPTool/formatters.ts)

这里干的事不只是美化文本，还包括：

- `file://` URI 正规化
- Windows drive-letter 修正
- `decodeURIComponent` 容错
- 用相对路径替代过长绝对路径
- 过滤 malformed/undefined URI
- `LocationLink -> Location` 统一
- 按 file 分组 references

所以 formatter 在 LSP runtime 里其实是“清洗不稳定 server 输出”的安全垫。

## 18. UI 层也不是简单回显：tool-use 和 tool-result 走的是两套完全不同的上下文压缩协议

源码镜像：[`../../src/tools/LSPTool/UI.tsx`](../../src/tools/LSPTool/UI.tsx), [`../../src/tools/LSPTool/symbolContext.ts`](../../src/tools/LSPTool/symbolContext.ts)

tool-use message 会尽量展示：

- `operation`
- symbol at position
- display path

这里甚至会同步读文件前 64KB，从指定位置抽 symbol，优先让 operator 看见：

- `symbol: "foo"`

而不是只看：

- `position: 120:13`

但 tool-result message 又会分成：

- collapsed summary
- verbose expanded body

所以同一把工具在“调用前提示”和“调用后结果”用了两套不同的信息压缩逻辑。

## 19. LSP 还有一条完全平行的被动诊断 sidecar，不走 `LSPTool.call()`

源码镜像：[`../../src/services/lsp/LSPDiagnosticRegistry.ts`](../../src/services/lsp/LSPDiagnosticRegistry.ts), [`../../src/utils/attachments.ts`](../../src/utils/attachments.ts)

被动诊断链是：

1. LSP server 异步发 `publishDiagnostics`
2. registry 里 `registerPendingLSPDiagnostic(...)`
3. query 前 `checkForLSPDiagnostics()`
4. `getLSPDiagnosticAttachments(...)`
5. 转成 attachment 发给模型

这说明 Claude Code 的 LSP 能力不是只有“模型主动调用 LSPTool”，还有“服务器被动把错误推回来”的第二条通道。

## 20. 这条被动通道还刻意要求当前 agent 具备 Bash 能力，否则诊断根本不送

源码镜像：[`../../src/utils/attachments.ts`](../../src/utils/attachments.ts)

`getLSPDiagnosticAttachments(...)` 第一层 gate 就是：

- 当前 tool set 里必须有 Bash

注释写得很明确：

- LSP diagnostics are only useful if the agent has the Bash tool to act on them

所以 Claude Code 认为 passive diagnostics 不是纯观察信息，而是“应该能立刻采取修复行动的上下文”。

## 21. 诊断 registry 本身也内建了强 dedup 和体积上限

源码镜像：[`../../src/services/lsp/LSPDiagnosticRegistry.ts`](../../src/services/lsp/LSPDiagnosticRegistry.ts)

它至少有这些限制：

- `MAX_DIAGNOSTICS_PER_FILE = 10`
- `MAX_TOTAL_DIAGNOSTICS = 30`
- `MAX_DELIVERED_FILES = 500`
- 按 `message + severity + range + source + code` 做 cross-turn dedup

所以 passive LSP 不会无限把同一错误反复灌进上下文。

## 22. classifier 和 streamlined output 也把 LSP 视作“安全搜索/读路径”，不是高风险执行工具

源码镜像：[`../../src/utils/permissions/classifierDecision.ts`](../../src/utils/permissions/classifierDecision.ts), [`../../src/utils/streamlinedTransform.ts`](../../src/utils/streamlinedTransform.ts)

两个侧面都能看出来：

- auto-mode safe allowlist 里直接包含 `LSP_TOOL_NAME`
- streamlined summary 里把 LSP 归到 `SEARCH_TOOLS`

这说明产品上它被归类成：

- read/search intelligence

而不是：

- external execution
- high-risk mutation

## 23. 结论：`LSPTool` 真正统一的不是 editor feature，而是“延迟可用的代码智能协议”

它统一了几件事：

- 什么时候让模型看见这把工具
- 什么时候把它标成 `defer_loading`
- 什么时候应该等待 initialization
- 什么时候只返回 benign “no server available”
- 怎样把位置型请求转成稳定的 LSP method 白名单
- 怎样把被动 diagnostics 安全、限量、去重地附着到对话里

所以 `LSPTool` 在 Claude Code 里不是“IDE 能力搬进终端”，而是一套围绕初始化、降级、权限、结果清洗和被动反馈构建出来的只读 code-intelligence runtime。
