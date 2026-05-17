# Session Memory Prompt / Template / Waiting / Manual Summary Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Extract Memories / Session Memory / Auto-Dream Comparative Runtime`](./61-extract-memories-session-memory-and-auto-dream-comparative-runtime.md) | [`下一站：Session Memory Compaction / Autocompact / Post-Compact Restoration Runtime`](./63-session-memory-compaction-autocompact-and-post-compact-restoration-runtime.md)

`61` 已经把 `sessionMemory` 放回三条后台记忆路径里比较清楚了，但它还没有把 session-memory 自己的“可操作面”拆开。当前源码里，这条线至少还有四个独立机制值得单独讲清：

- 可替换的 `template.md`
- 可替换的 `prompt.md`
- `waitForSessionMemoryExtraction()` 这条跨功能同步协议
- `/summary` 触发的手动 extraction 路径

这一卷只讲这些更细的 operator/runtime 细节。

## 1. session memory 不是硬编码 markdown 文件，它先加载可替换模板

源码镜像：[`../../sources/claude-code/src/services/SessionMemory/prompts.ts`](../../sources/claude-code/src/services/SessionMemory/prompts.ts)

`loadSessionMemoryTemplate()` 会优先读：

- `~/.claude/session-memory/config/template.md`

如果不存在才回退到：

- `DEFAULT_SESSION_MEMORY_TEMPLATE`

因此 session memory 的文件结构不是内建不可变的，而是有一个正式的用户可替换入口。

## 2. 默认模板本身是一个强结构笔记协议，不是自由摘要

源码镜像：[`../../sources/claude-code/src/services/SessionMemory/prompts.ts`](../../sources/claude-code/src/services/SessionMemory/prompts.ts)

默认模板强制定义了固定 section：

- `# Session Title`
- `# Current State`
- `# Task specification`
- `# Files and Functions`
- `# Workflow`
- `# Errors & Corrections`
- `# Codebase and System Documentation`
- `# Learnings`
- `# Key results`
- `# Worklog`

而且每一节后面都带 italic instruction line。也就是说，session memory 默认不是“模型随便写几段总结”，而是一个结构化工作笔记骨架。

## 3. update prompt 也不是写死在代码里，它同样支持用户替换

源码镜像：[`../../sources/claude-code/src/services/SessionMemory/prompts.ts`](../../sources/claude-code/src/services/SessionMemory/prompts.ts)

`loadSessionMemoryPrompt()` 优先读：

- `~/.claude/session-memory/config/prompt.md`

不存在时才回退到 `getDefaultUpdatePrompt()`。这意味着产品允许两层自定义：

- 改 notes 文件的结构
- 改 forked agent 更新 notes 的提示词

所以 session memory 是一个可运营组件，不只是内部 feature。

## 4. prompt/template 不是纯文本包含，而是走 `{{variable}}` 单次替换协议

源码镜像：[`../../sources/claude-code/src/services/SessionMemory/prompts.ts`](../../sources/claude-code/src/services/SessionMemory/prompts.ts)

`substituteVariables(...)` 当前支持的是：

- `{{currentNotes}}`
- `{{notesPath}}`

而且特意做成：

- single-pass replacement

注释还点名避免两类 bug：

- `$` backreference 污染
- 用户内容里恰好再出现 `{{var}}` 导致二次替换

这说明 session-memory prompt customization 不是临时字符串拼接，而是有意设计过的模板协议。

## 5. 默认 update prompt 的首要目标不是“写好总结”，而是“严守结构”

源码镜像：[`../../sources/claude-code/src/services/SessionMemory/prompts.ts`](../../sources/claude-code/src/services/SessionMemory/prompts.ts)

默认 prompt 里最重的约束不是内容风格，而是结构保护：

- 只能用 `Edit`
- 不能改 section header
- 不能改 italic description lines
- 只能改这两者之后的正文
- 不得新增 section

这说明 session memory fork 的核心工作不是生成新文档，而是维护一份受模板约束的状态文件。

## 6. section-size 和 total-budget 管理是 prompt-building 阶段就做的，不等模型自己悟出来

源码镜像：[`../../sources/claude-code/src/services/SessionMemory/prompts.ts`](../../sources/claude-code/src/services/SessionMemory/prompts.ts)

这一层有两组硬预算：

- `MAX_SECTION_LENGTH = 2000`
- `MAX_TOTAL_SESSION_MEMORY_TOKENS = 12000`

`buildSessionMemoryUpdatePrompt(...)` 会先：

- `analyzeSectionSizes(currentNotes)`
- `roughTokenCountEstimation(currentNotes)`
- 再拼 `generateSectionReminders(...)`

所以“某节太长了该压缩”不是模型自由判断，而是 prompt builder 先把超预算警报嵌进去。

## 7. oversized-section 提醒说明 session memory 被视为会持续膨胀的资产

源码镜像：[`../../sources/claude-code/src/services/SessionMemory/prompts.ts`](../../sources/claude-code/src/services/SessionMemory/prompts.ts)

当某个 section 超预算，或者整份 notes 超总预算时，prompt 会自动追加：

- 哪些 section 过长
- 总 token 预算是否爆掉
- 要优先保留什么

这和 `MEMORY.md` 的截断思路一致：设计者默认承认 session memory 会越来越长，所以必须把“何时压缩旧内容”前置到提示词层。

## 8. `isSessionMemoryEmpty()` 说明 notes 文件不只是显示面，还是 compact 路线的判定输入

源码镜像：[`../../sources/claude-code/src/services/SessionMemory/prompts.ts`](../../sources/claude-code/src/services/SessionMemory/prompts.ts)

`isSessionMemoryEmpty(content)` 的语义不是单纯“文件有没有字”，而是：

- 内容是否仍然等于模板

注释已经写明：

- 这用于判断是否还没有真正提取出内容
- 若为空，就应该回退到 legacy compact behavior

所以 session memory 不只是供人读的 side file，它还会影响后续 compact 策略选择。

## 9. `waitForSessionMemoryExtraction()` 是一条跨功能同步协议，不是 session-memory 内部细节

源码镜像：[`../../sources/claude-code/src/services/SessionMemory/sessionMemoryUtils.ts`](../../sources/claude-code/src/services/SessionMemory/sessionMemoryUtils.ts)

它维护了一个单独的等待协议：

- `EXTRACTION_WAIT_TIMEOUT_MS = 15000`
- `EXTRACTION_STALE_THRESHOLD_MS = 60000`

语义是：

- 如果没有进行中的 extraction，立即返回
- 如果 extraction 太老，视为 stale，不再等待
- 最多等 15s
- 期间每秒 sleep 轮询一次

这说明外部消费者是允许“等 notes 更新一下再继续”的。

## 10. extraction state 被单独抽成 util shared state，说明有多个消费者要同步它

源码镜像：[`../../sources/claude-code/src/services/SessionMemory/sessionMemoryUtils.ts`](../../sources/claude-code/src/services/SessionMemory/sessionMemoryUtils.ts)

这层共享状态至少包括：

- `lastSummarizedMessageId`
- `extractionStartedAt`
- `tokensAtLastExtraction`
- `sessionMemoryInitialized`
- live `sessionMemoryConfig`

并暴露：

- `markExtractionStarted()`
- `markExtractionCompleted()`
- `recordExtractionTokenCount()`
- `getSessionMemoryContent()`
- `waitForSessionMemoryExtraction()`

这说明 session-memory 并不是一个封闭类，而是一个“可被别的子系统读取和等待”的 shared runtime。

## 11. `/summary` 不是 UI 假动作，而是正式走一条 manual fork 路线

源码镜像：[`../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts`](../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts)

`manuallyExtractSessionMemory(...)` 明确写着：

- bypass threshold checks
- used by `/summary`

它会：

- 创建 isolated `setupContext`
- 准备 notes 文件
- 重建 cache-safe params
- 用 `forkLabel: 'session_memory_manual'`
- 跑一轮 forked agent

所以 `/summary` 在这里不是读现成 notes，而是主动请求一轮即时 extraction。

## 12. manual `/summary` 和自动 post-sampling 路线共享目标，但不共享完整入口条件

源码镜像：[`../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts`](../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts)

自动路径要求：

- `querySource === 'repl_main_thread'`
- gate enabled
- `shouldExtractMemory(messages)`

而 manual 路线只要求：

- `messages.length > 0`

然后直接执行 extraction。也就是说，`/summary` 是一个 operator override：跳过稀疏更新条件，立即强制把当前会话 notes 刷新到最新。

## 13. manual 路线还会重建 system prompt / contexts，而不是依赖 stop-hook 上下文现成透传

源码镜像：[`../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts`](../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts)

自动 post-sampling 路线可以直接：

- `createCacheSafeParams(context)`

但 manual 路线没有现成 `REPLHookContext`，所以它要手动重建：

- `getSystemPrompt(tools, mainLoopModel)`
- `getUserContext()`
- `getSystemContext()`
- `forkContextMessages: messages`

这说明 `/summary` 不是调用自动 hook 的薄包装，而是一条独立组装的 manual execution path。

## 14. `getSessionMemoryContent()` 把 session memory 正式暴露成可消费资产

源码镜像：[`../../sources/claude-code/src/services/SessionMemory/sessionMemoryUtils.ts`](../../sources/claude-code/src/services/SessionMemory/sessionMemoryUtils.ts)

这层不仅允许等待 extraction，还允许直接读取内容：

- `getSessionMemoryContent(): Promise<string | null>`

而且读取会打：

- `tengu_session_memory_loaded`

这说明 session memory 的内容已经被视为“可以被其他产品面拿来用”的资源，而不只是后台自娱自乐的笔记文件。

## 15. 至少两个外部消费者已经把 session memory 当成输入，而不是输出

源码镜像：

- `skills/bundled/skillify.ts`
- `services/awaySummary.ts`

当前代码搜索已经能确认：

- `skillify` 会读取 `getSessionMemoryContent()`
- `awaySummary` 也会读取 `getSessionMemoryContent()`

这意味着 session memory 不只是压缩结果，它还是后续能力生成和 away-summary 的上游上下文源。

## 16. 为什么这一卷必须独立

如果只看 `12` 和 `61`，会得到“大概有 session memory”这个结论，但会遗漏它最关键的实现细节：

- 它支持自定义模板与自定义更新 prompt
- 它有 token/section 双预算治理
- 它暴露了 wait/read 两类 shared-state 接口
- 它有 `/summary` 的手动强制刷新通道
- 它已经被别的子系统当成输入资源消费

这些都说明 session memory 不是一个被动 side file，而是一个真正参与 runtime 编排的中间资产。
