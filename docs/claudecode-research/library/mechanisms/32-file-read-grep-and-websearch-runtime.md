# FileRead / Grep / WebSearch Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Remote Host Modes / History / Command Filtering`](./31-remote-host-modes-history-and-command-filtering.md) | [`下一站：TaskCreate / TaskList / TaskGet / TaskUpdate Runtime`](./33-task-create-list-get-update-runtime.md)

本文把 `FileReadTool + GrepTool + WebSearchTool` 从旧的工具总述里单独拆出来。它们共同负责 Claude Code 最基础的一件事: 先观察，再搜索，再在必要时拿到仓库外的实时信息。源码里这三者都不是“小工具 wrapper”，而是各自带着权限、预算、格式分流、UI chrome 和 message contract 的独立运行时。

## 1. `FileReadTool` 不是 `readFile()`，而是统一内容摄取层

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts), [`../../sources/claude-code/src/tools/FileReadTool/limits.ts`](../../sources/claude-code/src/tools/FileReadTool/limits.ts), [`../../sources/claude-code/src/tools/FileReadTool/imageProcessor.ts`](../../sources/claude-code/src/tools/FileReadTool/imageProcessor.ts)

从 `searchHint` 就能看出来它的范围不是“读文本文件”，而是：

- file
- image
- PDF
- notebook
- memory file

所以 Claude Code 把读取建模成统一 ingestion runtime，而不是文本 I/O helper。

## 2. 它的第一职责不是读取，而是先把路径、权限和危险路径约束干净

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

`FileReadTool` 在真正碰文件前先做了几层治理：

- `backfillObservableInput()` 先把用户输入路径扩展成更稳定的可观察值
- `preparePermissionMatcher()` 基于 `file_path` 建 wildcard matcher
- `checkPermissions()` 统一走 `checkReadPermissionForTool`
- `validateInput()` 先查显式 deny rule
- `isBlockedDevicePath()` 阻断设备路径
- UNC path 直接走特殊分支，避免把 Windows 网络路径探测变成副作用

这意味着它首先是“安全可读性裁判”，其次才是读取器。

## 3. PDF 页范围不是装饰参数，而是正式预算控制面

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

`pages` 不是任意字符串拼接，它会经过：

- `parsePDFPageRange()`
- 最大页数上限 `PDF_MAX_PAGES_PER_READ`

也就是说，Claude Code 没把 PDF 当大文本暴力抽取，而是把“页范围”做成了正式的 token/latency 节流器。

## 4. 二进制拒绝逻辑说明它不是“什么都能读”，而是只对被定义过的媒体类型开口

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

`FileReadTool` 会明确拒绝多数二进制扩展，只给几类特判：

- PDF
- image
- SVG 相关可渲染路径

这说明它的能力边界不是“底层能打开就行”，而是“上层 message protocol 知道怎么表达这种内容才允许进入”。

## 5. `file_unchanged` 分支暴露出它带有读去重语义，不是每次都返回实体内容

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

如果当前读请求命中已有 read state，它可以直接返回：

- `type: 'file_unchanged'`
- `FILE_UNCHANGED_STUB`

而且这条路还有 `tengu_read_dedup_killswitch`。这说明 FileRead runtime 不是“无状态读文件”，而是会参与减少重复上下文灌入。

## 6. 读文件还会触发技能发现和条件激活，说明读取本身就是 capability discovery 入口

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

这条链里最容易被忽略的是：

- `discoverSkillDirsForPaths()`
- `addSkillDirectories()`
- `activateConditionalSkillsForPaths()`

也就是说，读路径不是纯观察动作。Claude Code 会把“看到了哪些目录/文件”继续变成 skill runtime 的条件激活输入。

## 7. `limits.ts` 说明 FileRead 有双预算模型: bytes cap 和 token cap 并存

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/limits.ts`](../../sources/claude-code/src/tools/FileReadTool/limits.ts)

默认限制不是一个数，而是两层：

- `maxSizeBytes`
- `maxTokens`

而且 token cap 的优先级是：

1. `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`
2. GrowthBook `tengu_amber_wren`
3. 默认 `25000`

这说明 FileRead 的预算治理既受环境变量控制，也受实验系统控制。

## 8. `includeMaxSizeInPrompt` 和 `targetedRangeNudge` 说明预算不只影响执行，还会反过来塑造模型行为

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/limits.ts`](../../sources/claude-code/src/tools/FileReadTool/limits.ts)

这些 flag 的存在说明，FileRead 的限制不是纯后端截断。Claude Code 还会把“该精确缩小读取范围”这种意图反馈给模型，尽量把粗暴大读改造成更有目标的局部读取。

## 9. 输出类型是多分支协议，不是统一文本

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

`FileReadTool` 的输出至少覆盖：

- `text`
- `image`
- `pdf`
- `parts`
- `notebook`
- `file_unchanged`

这说明上层 agent loop 接到的不是“读取后的字符串”，而是一个多媒体内容块协议。

## 10. 图片和 PDF 分支说明它带着专门的媒体压缩与提取子运行时

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/imageProcessor.ts`](../../sources/claude-code/src/tools/FileReadTool/imageProcessor.ts), [`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

图片分支会走：

- bundled `image-processor-napi`
- fallback `sharp`
- `compressImageBufferWithTokenLimit()`

PDF 分支会走：

- `extractPDFPages()`

这说明 FileRead runtime 自己就内嵌了“媒体转可喂模型格式”的预处理层。

## 11. notebook、line number、memory freshness prefix 说明文本输出也不是原样透传

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

即使最后落成文本，它也还会继续加工：

- notebook 走 `readNotebook()`
- 文本加 line number
- auto-memory 文件前置 `memoryFileFreshnessPrefix()`

所以 FileRead 输出的是“适合 agent 推理的阅读表示”，不是原始文件副本。

## 12. 它还会在特定模型下附带 cyber-risk mitigation reminder，说明读取层也知道模型治理语义

源码镜像：[`../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts`](../../sources/claude-code/src/tools/FileReadTool/FileReadTool.ts)

这类提醒不是 query loop 后补，而是直接嵌在 FileRead 结果整形阶段。含义很明确：文件内容本身就可能需要带策略提示，读取 runtime 不是中立字节泵。

## 13. `GrepTool` 的定位不是 shell 透传，而是 permission-aware 的结构化内容搜索器

源码镜像：[`../../sources/claude-code/src/tools/GrepTool/GrepTool.ts`](../../sources/claude-code/src/tools/GrepTool/GrepTool.ts), [`../../sources/claude-code/src/tools/GrepTool/UI.tsx`](../../sources/claude-code/src/tools/GrepTool/UI.tsx)

`searchHint` 已经把它定义成：

- `search file contents with regex (ripgrep)`

但真正关键的是它把 `rg` 包进了自己的输入校验、忽略规则、分页协议和 UI summary contract。

## 14. Grep 的路径约束和 UNC 特判，说明“搜索”也被视为可能泄漏环境信息的动作

源码镜像：[`../../sources/claude-code/src/tools/GrepTool/GrepTool.ts`](../../sources/claude-code/src/tools/GrepTool/GrepTool.ts)

它会先做：

- path 存在性校验
- `checkReadPermissionForTool`
- UNC path 早退

也就是说，在 Claude Code 里，grep 不是 harmless read helper，而是正式受文件系统权限治理的观察工具。

## 15. 它的噪音治理不是几条硬编码，而是三层忽略源合流

源码镜像：[`../../sources/claude-code/src/tools/GrepTool/GrepTool.ts`](../../sources/claude-code/src/tools/GrepTool/GrepTool.ts)

GrepTool 至少会合并三类忽略来源：

- VCS 目录: `.git/.svn/.hg/.bzr/.jj/.sl`
- orphaned plugin cache globs
- permission-derived ignore patterns

而 permission-derived patterns 还会经 `normalizePatternsToPath()` 归一化。也就是说，搜索范围不是固定的 repo glob，而是“版本控制噪音 + 插件噪音 + 权限边界”三者共同裁出来的。

## 16. `content / files_with_matches / count` 三模式说明它输出的不是一份结果，而是三种不同认知粒度

源码镜像：[`../../sources/claude-code/src/tools/GrepTool/GrepTool.ts`](../../sources/claude-code/src/tools/GrepTool/GrepTool.ts)

GrepTool 的模式不是 cosmetic：

- `content`: 要具体命中内容
- `files_with_matches`: 先给文件级命中面
- `count`: 只给统计规模

这意味着 Claude Code 把“先估规模，再决定是否深读”做成了搜索 runtime 的正式策略入口。

## 17. `DEFAULT_HEAD_LIMIT`、`offset` 和 `applyHeadLimit()` 表明 grep 是可分页的搜索协议

源码镜像：[`../../sources/claude-code/src/tools/GrepTool/GrepTool.ts`](../../sources/claude-code/src/tools/GrepTool/GrepTool.ts)

关键机制包括：

- `DEFAULT_HEAD_LIMIT = 250`
- `offset`
- `applyHeadLimit()`
- `formatLimitInfo()`

所以它不是一次性把 `rg` stdout 倒给模型，而是维护一个“窗口化命中集”，允许模型逐步推进。

## 18. ripgrep 参数合成层说明 Claude Code 真正在维护的是“受控 rg DSL”

源码镜像：[`../../sources/claude-code/src/tools/GrepTool/GrepTool.ts`](../../sources/claude-code/src/tools/GrepTool/GrepTool.ts)

它会主动控制：

- hidden files
- max columns
- multiline
- case-insensitive
- type filter
- glob splitting

其中 glob splitting 还要保留 brace 语义。这不是对 shell 参数的薄包装，而是一层稳定的搜索 DSL 编译器。

## 19. `UI.tsx` 说明 Grep 有意把“给模型的内容”和“给人看的摘要 chrome”拆开

源码镜像：[`../../sources/claude-code/src/tools/GrepTool/UI.tsx`](../../sources/claude-code/src/tools/GrepTool/UI.tsx)

UI 里走的是：

- `SearchResultSummary`
- compact / verbose 分支

这说明 transcript 给人的呈现并不等于模型拿到的内容。Claude Code 在搜索工具上明确维护了“model-facing result”和“operator-facing chrome”的双表面。

## 20. `WebSearchTool` 不是直接调搜索 API，而是“用模型去调用 server tool”的二级封装

源码镜像：[`../../sources/claude-code/src/tools/WebSearchTool/WebSearchTool.ts`](../../sources/claude-code/src/tools/WebSearchTool/WebSearchTool.ts), [`../../sources/claude-code/src/tools/WebSearchTool/UI.tsx`](../../sources/claude-code/src/tools/WebSearchTool/UI.tsx)

它最不直观的一点是: 本地工具实现自己还会再次调用 `queryModelWithStreaming()`，再让那个模型去使用：

- `web_search_20250305`

也就是说，WebSearchTool 不是“本地客户端发 HTTP 搜索请求”，而是“Claude Code 再开一轮受控 tool-use 子对话”。

## 21. provider gate 说明 web search 首先是模型/供应商协议能力，不是通用工具能力

源码镜像：[`../../sources/claude-code/src/tools/WebSearchTool/WebSearchTool.ts`](../../sources/claude-code/src/tools/WebSearchTool/WebSearchTool.ts)

`isEnabled()` 的判断很明确：

- `firstParty` 可用
- `foundry` 可用
- `vertex` 只在部分 Claude 4 家族模型名上可用

这说明 WebSearchTool 的 availability 不是本地配置开关，而是 provider capability matrix。

## 22. 它的权限语义是 `passthrough`，说明重点不在文件边界，而在显式工具同意与来源可追溯

源码镜像：[`../../sources/claude-code/src/tools/WebSearchTool/WebSearchTool.ts`](../../sources/claude-code/src/tools/WebSearchTool/WebSearchTool.ts)

`checkPermissions()` 返回的是：

- `behavior: 'passthrough'`

而 allow-rule suggestion 会直接针对 `WEB_SEARCH_TOOL_NAME`。这意味着 WebSearch 的审批语义不是“限定某个 path”，而是“是否允许这个外部实时搜索能力被调用”。

## 23. `allowed_domains` 和 `blocked_domains` 互斥，说明域名过滤是正式输入协议，而不是附加建议

源码镜像：[`../../sources/claude-code/src/tools/WebSearchTool/WebSearchTool.ts`](../../sources/claude-code/src/tools/WebSearchTool/WebSearchTool.ts)

它会明确拒绝：

- 空 query
- 同时指定 allow 和 block domain list

所以 domain filter 不是宽松 hint，而是工具 schema 的正式约束。

## 24. WebSearch 的 streaming progress 暴露出一个少见模式: 工具内部还有自己的工具调用进度

源码镜像：[`../../sources/claude-code/src/tools/WebSearchTool/WebSearchTool.ts`](../../sources/claude-code/src/tools/WebSearchTool/WebSearchTool.ts)

它会解析内部 streaming 事件，抽出：

- `query_update`
- `search_results_received`

甚至从 `input_json_delta` 里恢复实时 query。这意味着用户看到的搜索进度，不是 Claude Code 瞎编的本地 spinner，而是 server tool 子调用的真实阶段信息。

## 25. 最终结果不是纯文本，而是“解释文本 + 结构化 hits”混合块

源码镜像：[`../../sources/claude-code/src/tools/WebSearchTool/WebSearchTool.ts`](../../sources/claude-code/src/tools/WebSearchTool/WebSearchTool.ts)

`makeOutputFromSearchResponse()` 会把内容拆成两类：

- commentary text
- structured result objects

所以 WebSearch 的 tool result 本质上是一个混合响应协议，不等于普通 assistant message。

## 26. 它在 tool result 里强制追加 source reminder，说明“给用户带链接”是运行时契约，不是提示词好习惯

源码镜像：[`../../sources/claude-code/src/tools/WebSearchTool/WebSearchTool.ts`](../../sources/claude-code/src/tools/WebSearchTool/WebSearchTool.ts)

`mapToolResultToToolResultBlockParam()` 会额外塞一句强提醒，要求最终回答必须带 markdown hyperlinks。也就是说，Claude Code 把“搜索结果必须可追源”写成了工具输出 contract。

## 27. `UI.tsx` 刻意不展示全文搜索内容，只展示搜索次数和耗时

源码镜像：[`../../sources/claude-code/src/tools/WebSearchTool/UI.tsx`](../../sources/claude-code/src/tools/WebSearchTool/UI.tsx)

UI 层真正展示的是：

- domain filters
- progress
- `Did N searches in Xs`

而 `extractSearchText()` 故意返回空。说明 Claude Code 有意避免把大量外部搜索正文直接塞进工具消息 chrome，转而把“真正内容”留在模型上下文和最终回答里。

## 28. 这三条工具链共同说明 Claude Code 的观察层是分级的: 读本地内容、搜本地结构、搜外部世界

从调用语义看，它们形成了一个很清晰的层级：

- `FileReadTool`: 精确摄取某个已知对象
- `GrepTool`: 在本地工作区里扩大搜索面
- `WebSearchTool`: 在仓库外补实时知识

它们不是平行小工具，而是一条递进式 observation ladder。

## 29. 共同特征也很一致: 都带权限、预算、结果整形和 UI/human-facing chrome 的分离

这三者的共同点不是“都在搜索”，而是都遵守同一种 Claude Code runtime 哲学：

- 权限不是外挂，而是工具自身的一部分
- 预算不是截断补丁，而是输入协议与结果协议的一部分
- 给模型的 result 和给人的 chrome 不是同一层
- 工具输出不是原始系统调用结果，而是为 agent 推理整形后的语义块

## 交叉参考

- 工具池与上下文：[`./02-tool-pool-and-tool-use-context.md`](./02-tool-pool-and-tool-use-context.md)
- 任务文件协议：[`./10-task-list-and-ownership.md`](./10-task-list-and-ownership.md)
- 延迟工具发现协议：[`./28-tool-search-deferred-tools-and-mcp-instruction-deltas.md`](./28-tool-search-deferred-tools-and-mcp-instruction-deltas.md)
- API transport 主链：[`./25-api-request-streaming-retry-and-telemetry.md`](./25-api-request-streaming-retry-and-telemetry.md)
- 旧的工具总述：[`./08-read-search-web-and-task-tools.md`](./08-read-search-web-and-task-tools.md)
