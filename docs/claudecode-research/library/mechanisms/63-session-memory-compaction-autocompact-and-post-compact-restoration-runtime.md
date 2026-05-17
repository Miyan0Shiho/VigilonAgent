# Session Memory Compaction / Autocompact / Post-Compact Restoration Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Session Memory Prompt / Template / Waiting / Manual Summary Runtime`](./62-session-memory-prompt-template-waiting-and-manual-summary-runtime.md) | [`下一站：Session Memory / Away Summary / Skillify Consumer Runtime`](./64-session-memory-away-summary-and-skillify-consumer-runtime.md)

`62` 已经把 session-memory 自己的模板、等待协议和手动 extraction 拆开了，但还有一条更关键的消费链没有单独讲清：这些 notes 不是写完就放着，它们会直接改写 `/compact` 和 autocompact 的分流方式。这一卷只讲这条 runtime。

## 1. `/compact` 不是单一路径，而是 `session-memory -> reactive -> legacy` 三段路由

源码镜像：

- [`../../src/commands/compact/compact.ts`](../../src/commands/compact/compact.ts)

`/compact` 的主流程很明确：

- 先 `getMessagesAfterCompactBoundary(messages)`
- 没有 custom instructions 时，先试 `trySessionMemoryCompaction(...)`
- 失败后，如果开了 reactive-only mode，再走 `compactViaReactive(...)`
- 否则才回到 `compactConversation(...)`

所以 session memory compaction 不是辅助优化，而是手动 `/compact` 的第一优先级分支。

## 2. custom instructions 会直接关闭 session-memory compaction

源码镜像：[`../../src/commands/compact/compact.ts`](../../src/commands/compact/compact.ts)

判断条件很硬：

- 只有 `!customInstructions` 时才会调用 `trySessionMemoryCompaction(...)`

原因也写在注释里：

- session-memory compaction 不支持 custom instructions

这说明产品把它当成“固定协议压缩器”，不是通用摘要模型接口。

## 3. 手动 `/compact` 走 session-memory 分支成功后，也要补完整的 post-compact 状态迁移

源码镜像：

- [`../../src/commands/compact/compact.ts`](../../src/commands/compact/compact.ts)
- [`../../src/services/compact/postCompactCleanup.ts`](../../src/services/compact/postCompactCleanup.ts)

成功路径不是只返回一份 `CompactionResult`。它还会做：

- `getUserContext.cache.clear?.()`
- `runPostCompactCleanup()`
- `notifyCompaction(...)`
- `markPostCompaction()`
- `suppressCompactWarning()`

也就是说，session-memory compaction 虽然跳过了传统 compact API 调用，但它仍然要把自己伪装成一次“真正发生过的 compaction event”。

## 4. reactive compact 不是 session-memory 的上层包装，而是它后面的第二候选分支

源码镜像：[`../../src/commands/compact/compact.ts`](../../src/commands/compact/compact.ts)

`compactViaReactive(...)` 只有在两件事同时成立时才会运行：

- session-memory compaction 没成功
- `reactiveCompact?.isReactiveOnlyMode()`

它还会：

- 并行执行 `executePreCompactHooks(...)` 和 `getCacheSharingParams(...)`
- `mergeHookInstructions(...)`
- 把 SDK status 设成 `compacting`

所以 reactive compact 不是 `/compact` 的默认主路径，而是 session-memory 之后的一条 feature-gated fallback。

## 5. autocompact 也复用同一分流，但它比手动 `/compact` 多一层 circuit breaker

源码镜像：[`../../src/services/compact/autoCompact.ts`](../../src/services/compact/autoCompact.ts)

`autoCompactIfNeeded(...)` 的顺序和手动路径一样，先试：

- `trySessionMemoryCompaction(messages, toolUseContext.agentId, autoCompactThreshold)`

失败后才回到：

- `compactConversation(..., isAutoCompact=true, recompactionInfo)`

但它额外维护了：

- `consecutiveFailures`
- `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`

这说明自动压缩被当成“会反复重试的后台机制”，所以要有专门的熔断保护；手动 `/compact` 则不需要这层。

## 6. autocompact 并不是“token 高了就压”，它先过一串 recursion 和宿主冲突 gate

源码镜像：[`../../src/services/compact/autoCompact.ts`](../../src/services/compact/autoCompact.ts)

`shouldAutoCompact(...)` 明确跳过：

- `querySource === 'session_memory'`
- `querySource === 'compact'`
- `querySource === 'marble_origami'` 的 context-collapse agent 情况
- reactive-only mode
- context-collapse enabled
- 全局或用户设置关闭 auto-compact

这些 gate 说明 autocompact 不是单纯 token policy，而是一个要避开别的 context-management runtime 的协调器。

## 7. session-memory compaction 自己也有一整套 gate，不是 notes 文件存在就一定会用

源码镜像：[`../../src/services/compact/sessionMemoryCompact.ts`](../../src/services/compact/sessionMemoryCompact.ts)

`trySessionMemoryCompaction(...)` 会依次检查：

- `shouldUseSessionMemoryCompaction()`
- remote config 初始化
- `waitForSessionMemoryExtraction()`
- `getSessionMemoryContent()`
- `isSessionMemoryEmpty(sessionMemory)`

其中 `shouldUseSessionMemoryCompaction()` 又受：

- `ENABLE_CLAUDE_CODE_SM_COMPACT`
- `DISABLE_CLAUDE_CODE_SM_COMPACT`
- `tengu_session_memory`
- `tengu_sm_compact`

共同控制。也就是说，这条路径同时受 env、feature flag、notes readiness 三层 gate 约束。

## 8. 它不是简单“保留最后 N 条消息”，而是按 summary cursor 决定保留段

源码镜像：[`../../src/services/compact/sessionMemoryCompact.ts`](../../src/services/compact/sessionMemoryCompact.ts)

核心 cursor 是：

- `getLastSummarizedMessageId()`

两种情况：

- 正常情况：找到这个 UUID，把它之后的消息视为未摘要区
- resumed session：cursor 不存在，但 notes 已有内容，于是先假定“当前所有消息都可能已被摘要”，再从尾部重新扩张保留段

这说明 session-memory compaction 的核心不是“时间最近”，而是“notes 已经覆盖到哪里”。

## 9. `calculateMessagesToKeepIndex()` 体现的不是 UX 策略，而是 API invariant 维护

源码镜像：[`../../src/services/compact/sessionMemoryCompact.ts`](../../src/services/compact/sessionMemoryCompact.ts)

这层同时维护三种约束：

- 至少 `minTokens`
- 至少 `minTextBlockMessages`
- 不超过 `maxTokens`

默认值是：

- `minTokens = 10000`
- `minTextBlockMessages = 5`
- `maxTokens = 40000`

但更关键的是，它最后一定会过：

- `adjustIndexToPreserveAPIInvariants(...)`

这里显式修两类断裂：

- `tool_use / tool_result` 被切开
- 同一 `message.id` 的 thinking/tool_use streaming block 被切开

所以它不是单纯的“保留多少上下文”，而是“裁剪以后仍然能喂给 normalize/API”的结构修复器。

## 10. session-memory compaction 还会等待 notes 更新完成，避免拿到半旧状态

源码镜像：

- [`../../src/services/compact/sessionMemoryCompact.ts`](../../src/services/compact/sessionMemoryCompact.ts)
- [`../../src/services/SessionMemory/sessionMemoryUtils.ts`](../../src/services/SessionMemory/sessionMemoryUtils.ts)

它会在真正读 notes 前调用：

- `await waitForSessionMemoryExtraction()`

所以 compact 与 session-memory 不是松耦合的“谁先完成算谁的”，而是明确存在一条同步协议：尽量等 notes 刷到最新，再决定如何压。

## 11. session-memory compaction 的 summary 不是重新调模型生成，而是把 notes 文件转译成 compact summary message

源码镜像：[`../../src/services/compact/sessionMemoryCompact.ts`](../../src/services/compact/sessionMemoryCompact.ts)

`createCompactionResultFromSessionMemory(...)` 做的事是：

- 建 `compact_boundary`
- `truncateSessionMemoryForCompact(sessionMemory)`
- `getCompactUserSummaryMessage(...)`
- `createUserMessage({ isCompactSummary: true, isVisibleInTranscriptOnly: true })`

也就是说，这条路径的“摘要生成”已经提前发生在 notes extraction 阶段；compact 时只是把 notes 再包装成 transcript 里的 compact summary。

## 12. 这条路径也会补 `plan attachment` 和 preserved-segment 元数据

源码镜像：

- [`../../src/services/compact/sessionMemoryCompact.ts`](../../src/services/compact/sessionMemoryCompact.ts)
- [`../../src/services/compact/compact.ts`](../../src/services/compact/compact.ts)

session-memory compaction 不是只回：

- `boundary + summary`

它还会补：

- `createPlanAttachmentIfNeeded(agentId)`
- `annotateBoundaryWithPreservedSegment(...)`

后者把：

- `headUuid`
- `anchorUuid`
- `tailUuid`

写进 boundary metadata。说明 suffix-preserving 的 session-memory compact 仍然要和 transcript loader / resume chain 对齐。

## 13. 如果 post-compact token 仍然太大，autocompact 会放弃这条路径，改走 legacy compact

源码镜像：[`../../src/services/compact/sessionMemoryCompact.ts`](../../src/services/compact/sessionMemoryCompact.ts)

当 `autoCompactThreshold` 被传入时，它会比较：

- `postCompactTokenCount >= autoCompactThreshold`

一旦超阈值：

- 记录 `tengu_sm_compact_threshold_exceeded`
- 返回 `null`

所以 session-memory compaction 虽然优先级高，但它没有被强行推行；只要 compact 后仍不够小，就会把机会让给传统摘要压缩。

## 14. `buildPostCompactMessages(...)` 定义了 compaction 之后真正保留下来的消息顺序

源码镜像：[`../../src/services/compact/compact.ts`](../../src/services/compact/compact.ts)

这个顺序是：

- `boundaryMarker`
- `summaryMessages`
- `messagesToKeep`
- `attachments`
- `hookResults`

这说明 compaction 之后的上下文不是“摘要替换全部历史”那么简单，attachment 和 session-start hook 仍然被当成 active context 的一部分重新挂回去。

## 15. 传统 compact 会在 compaction 后主动重播几类 attachment，修复“摘要吃掉先前声明”的问题

源码镜像：

- [`../../src/services/compact/compact.ts`](../../src/services/compact/compact.ts)
- [`../../src/utils/attachments.ts`](../../src/utils/attachments.ts)

compact 之后会重新注入：

- `deferred_tools_delta`
- `agent_listing_delta`
- `mcp_instructions_delta`

源码注释写得很直接：

- compaction 吃掉了先前 delta attachments
- first post-compact turn 需要重新拥有这些工具/指令上下文

所以 post-compact restoration 不只是文件附件恢复，也包括 capability announcement 的恢复。

## 16. `runPostCompactCleanup()` 真正清理的是“会被 compaction 弄脏的进程态”，不是只清 message cache

源码镜像：[`../../src/services/compact/postCompactCleanup.ts`](../../src/services/compact/postCompactCleanup.ts)

它会统一做：

- `resetMicrocompactState()`
- main-thread 时才 `resetContextCollapse()`
- main-thread 时才 `resetGetMemoryFilesCache('compact')`
- `clearSystemPromptSections()`
- `clearClassifierApprovals()`
- `clearSpeculativeChecks()`
- `clearBetaTracingState()`
- `clearSessionMessagesCache()`

并且明确不做：

- `resetSentSkillNames()`

因为那会让 post-compact 重新灌完整 `skill_listing`，造成纯 cache_creation 浪费。

## 17. subagent compaction 和 main-thread compaction 共用同一个 cleanup API，但不会被允许互相污染

源码镜像：[`../../src/services/compact/postCompactCleanup.ts`](../../src/services/compact/postCompactCleanup.ts)

`runPostCompactCleanup(querySource?)` 里有一个专门的区分：

- `querySource` 是 main-thread / sdk 时，才清 main-thread module-level state
- `agent:*` 这类 subagent compaction 不会重置主线程的 context-collapse、memory-file cache 等共享状态

这说明 compaction cleanup 也考虑到了同进程多 agent 共享模块状态的问题。

## 18. `/summary` 当前在命令目录里仍然是隐藏 stub，真正的手动 notes 刷新后端已经转到 session-memory runtime

源码镜像：

- [`../../src/commands/summary/index.js`](../../src/commands/summary/index.js)
- [`../../src/services/SessionMemory/sessionMemory.ts`](../../src/services/SessionMemory/sessionMemory.ts)

当前镜像里：

- `commands/summary/index.js` 只是 `isEnabled: () => false` 的 stub

但手动 summary 的真实执行语义已经在：

- `manuallyExtractSessionMemory(...)`

里落地了。所以命令表面和运行时后端现在是分离状态。

## 19. 这条链的真实角色不是“又一种 memory feature”，而是 Claude Code 的 context-management 子系统

综合上面几层可以看到，session-memory 在这里承担的是三件事：

- 作为 compact 的高优先级摘要底稿
- 作为 autocompact 的低成本第一候选
- 作为 post-compact continuity 的状态锚点

所以把它只理解成“自动写笔记”是不够的。它已经是上下文治理 runtime 的正式组成部分。
