# Context Visualization / MessageSelector / Manual Compact Workbench

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Compaction Warnings / Boundaries / Post-Compact Feedback Surfaces`](./39-compaction-warnings-boundaries-and-post-compact-feedback-surfaces.md) | [`下一站：State Management / Store / Provider / Selector / Sync Runtime`](./41-state-management-store-provider-selector-and-sync-runtime.md)

[`39`](./39-compaction-warnings-boundaries-and-post-compact-feedback-surfaces.md) 讲的是 compaction 的 warning、boundary、survey 自动反馈链；这一卷继续补“用户主动治理上下文”的前台工作面。当前实现里，这条链由三层拼起来：

- `ContextVisualization`：解释上下文现在被什么占满
- `MessageSelector`：让用户显式选择 restore / summarize pivot
- `REPL + partialCompactConversation + useLogMessages`：把这次手动治理安全写回 transcript

它们合在一起，才是 Claude Code 的 manual context-governance workbench。

## 1. `ContextVisualization` 不只是 token 图，而是 runtime context policy 的可视化投影

源码镜像：[`../../src/components/ContextVisualization.tsx`](../../src/components/ContextVisualization.tsx), [`../../src/utils/analyzeContext.ts`](../../src/utils/analyzeContext.ts)

它展示的不是抽象总量，而是运行时拆解后的 category：

- `System prompt`
- `System tools`
- `MCP tools`
- `Custom agents`
- `Memory files`
- `Skills`
- `Messages`
- `Autocompact buffer` 或 manual compact buffer
- `Free space`

Claude Code 并没有把 context pressure 当成黑盒后端状态，而是主动把“为什么快满了”翻译成人类能看懂的工作面。

## 2. reserved buffer 的显隐本身就是产品语义，不是纯计算

源码镜像：[`../../src/utils/analyzeContext.ts`](../../src/utils/analyzeContext.ts)

`analyzeContextUsage(...)` 对 reserved buffer 有三种不同处理：

- autocompact 开启：显示 `Autocompact buffer`
- autocompact 关闭：显示 manual compact buffer
- reactive-only 或 context-collapse 开启：直接跳过 reserved buffer，因为继续显示它会误导用户

所以 visualization 不是简单画内存分布，而是在把“当前由谁负责治理上下文”编码成用户可见模型。

## 3. `CollapseStatus()` 是 context-collapse 唯一正式的显性观测口

源码镜像：[`../../src/components/ContextVisualization.tsx`](../../src/components/ContextVisualization.tsx)

注释写得很明确：

- `<collapsed>` placeholders 是 meta，不会出现在普通 conversation view
- 这里是用户能直接看见 collapse 改写过上下文的地方

它会展示：

- `N spans summarized`
- `staged`
- `empty runs`
- `errors`

因此它承担的是 operator observability，不是装饰信息。

## 4. `generateContextSuggestions(...)` 把“看图”转成“下一步动作”

源码镜像：[`../../src/components/ContextVisualization.tsx`](../../src/components/ContextVisualization.tsx), [`../../src/utils/contextSuggestions.ts`](../../src/utils/contextSuggestions.ts)

`ContextVisualization` 不只是展示分布，还会调用：

- `generateContextSuggestions(data)`

建议会把运行态翻译成动作，例如：

- autocompact 关闭时提示去 `/config` 或手动 `/compact`
- near-capacity 时强调会丢失上下文
- message/tool-result 膨胀时建议局部减肥

所以这块 UI 不是 dashboard，而是 diagnosis -> action recommendation 的闭环。

## 5. `MessageSelector` 在这条链里真正的角色是“手动选择 compact pivot”

源码镜像：[`../../src/components/MessageSelector.tsx`](../../src/components/MessageSelector.tsx)

它当然也支持：

- `restore conversation`
- `restore code`
- `restore both`

但放回 context-governance workbench 里看，最关键的是：

- `summarize from here`
- `summarize up to here`

也就是说，它不只是 history picker，而是 partial compact 的前台边界选择器。

## 6. `MessageSelector` 同时对接 file-history rewind 和 partial compact，两者不是一类后端

源码镜像：[`../../src/components/MessageSelector.tsx`](../../src/components/MessageSelector.tsx), [`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx)

confirm 阶段的几个分支最终走向不同后端：

- `onRestoreCode -> fileHistoryRewind(...)`
- `onRestoreMessage(...)`
- `onSummarize(...)`

所以这不是单纯 restore dialog，而是三类历史治理能力的汇流：

- code rewind
- conversation rewind
- partial compaction

## 7. `summarize from` 和 `summarize up_to` 的差异是 transcript surgery 级别的，不是文案级别的

源码镜像：[`../../src/components/MessageSelector.tsx`](../../src/components/MessageSelector.tsx), [`../../src/services/compact/compact.ts`](../../src/services/compact/compact.ts)

`partialCompactConversation(...)` 对两种方向有不同协议：

- `from`：总结 pivot 之后的消息，保留前缀，cache 对保留段更友好
- `up_to`：总结 pivot 之前的消息，保留后缀，并且必须剥掉旧 compact boundary / old summary

这意味着它们不仅“总结范围”不同，还会改变：

- kept messages 的位置
- boundary 的锚点
- cache 是否仍然友好

## 8. `REPL` 会先投影到 `getMessagesAfterCompactBoundary(...)`，不允许 selector 越过当前阶段切口

源码镜像：[`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx), [`../../src/utils/messages.ts`](../../src/utils/messages.ts)

`onSummarize` 先做：

- `const compactMessages = getMessagesAfterCompactBoundary(messages)`

如果用户选中的消息不在这个投影里：

- 就说明它已经是 snipped 或 pre-compact 消息
- 前台会插 warning，而不是 silent no-op

full scrollback 与 active compact stage 是两套视图：前者可读，后者才可参与新的 partial compact。

## 9. `partialCompactConversation(...)` 是定向 transcript surgery，不是简化版 `/compact`

源码镜像：[`../../src/services/compact/compact.ts`](../../src/services/compact/compact.ts)

这条内核至少会：

- 选出 `messagesToSummarize` 和 `messagesToKeep`
- `up_to` 时剥离旧 boundary 与 old summary
- 合并 pre-compact hook instructions 与 user feedback
- 清 `readFileState` / nested memory path
- 恢复 file / async-agent / plan / plan-mode / skill attachments
- 重新注入 deferred tools / agent listing / MCP instructions deltas
- 生成新的 `CompactBoundaryMessage`

因此它不是“拿一段消息去总结”，而是对 transcript 结构做一次完整 surgery。

## 10. partial compact 之后，REPL 对 `from` 和其他方向的数组回写策略也不同

源码镜像：[`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx), [`../../src/hooks/useLogMessages.ts`](../../src/hooks/useLogMessages.ts)

成功后 REPL 不总是直接 `setMessages(postCompact)`：

- fullscreen 且 `direction === 'from'`：保留旧 scrollback 前缀，再拼新 compact 后后缀
- 其他情况：直接替换成 `postCompact`

原因不是 UI 偏好，而是 logging invariant：

- 如果 head 保持不变但数组只是增长
- `useLogMessages` 会把它误判成 incremental append
- boundary 可能不会正确落盘

所以 transcript UI 的替换策略是为 persistence 正确性服务的。

## 11. `useLogMessages` 的 `same-head shrink` 语义是这条工作面能安全存在的关键后勤

源码镜像：[`../../src/hooks/useLogMessages.ts`](../../src/hooks/useLogMessages.ts)

这个 hook 明确承认：

- first render
- compaction
- same-head shrink

partial compact / snip / rewind 都可能触发“不是 append”的路径。它通过：

- `firstMessageUuidRef`
- `lastRecordedLengthRef`
- `callSeqRef`

避免异步 transcript 记录把新的 compact 结果又覆盖回旧 parent uuid。

## 12. compact 成功后的 UX 收尾也被设计成 operator continuation，而不是静默结束

源码镜像：[`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx), [`../../src/utils/messages.ts`](../../src/utils/messages.ts)

partial compact 成功后，REPL 还会：

- `setConversationId(randomUUID())`
- `runPostCompactCleanup(...)`
- `direction === 'from'` 时用 `textForResubmit(message)` 回填输入框
- 发 `Conversation summarized (ctrl+o for history)` notification

所以这不是“总结完就结束”，而是主动把用户送回：

- 新上下文阶段
- 可继续提交的输入状态
- 可回看的历史入口

## 13. 这篇和 `27`、`39`、`63` 的边界

[`./27-message-selector-idle-return-and-recommendation-dialogs.md`](./27-message-selector-idle-return-and-recommendation-dialogs.md) 讲的是：

- `MessageSelector` 作为历史控制面的大轮廓

[`./39-compaction-warnings-boundaries-and-post-compact-feedback-surfaces.md`](./39-compaction-warnings-boundaries-and-post-compact-feedback-surfaces.md) 讲的是：

- compaction 的 warning / boundary / survey 自动反馈链

[`../mechanisms/63-session-memory-compaction-autocompact-and-post-compact-restoration-runtime.md`](../mechanisms/63-session-memory-compaction-autocompact-and-post-compact-restoration-runtime.md) 讲的是：

- 后端 compaction kernel 与 capability restoration

这一篇只聚焦：

- 用户如何手动选择 compact pivot
- 上下文可视化怎样变成建议
- partial compact 怎样安全落回 transcript 与日志

## 14. 一句话结论

Claude Code 的手动上下文治理不是“看一眼 token 再手动 `/compact`”，而是一套完整的前台 workbench：

- `ContextVisualization` 把上下文负载拆成可见模型
- `generateContextSuggestions` 把诊断翻译成动作
- `MessageSelector` 让用户显式选择 partial compact 的 pivot 与方向
- `REPL + partialCompactConversation + useLogMessages` 再把这次治理安全落回 transcript、attachments、history 和后续输入流

这也是它把 context management 做成 operator surface，而不是隐藏后端策略的另一个强证据。
