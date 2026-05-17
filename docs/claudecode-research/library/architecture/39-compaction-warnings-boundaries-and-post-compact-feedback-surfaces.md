# Compaction Warnings / Boundaries / Post-Compact Feedback Surfaces

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Dream / Workflow / Monitor Detail Surfaces`](./38-dream-workflow-and-monitor-detail-surfaces.md) | [`下一站：Memory、Skills、Tasks 与 Bridge Operator Dialogs`](./15-memory-skills-tasks-and-bridge-operator-dialogs.md)

这一卷不再讲 compaction 的后端执行，而是讲它在前台怎样被用户看见。Claude Code 并没有把 `/compact` 做成“按下就结束”的一次性命令，而是拆成四个前台面：

- `TokenWarning`：事前风险提示
- `CompactBoundaryMessage`：事后 transcript 边界锚点
- `usePostCompactSurvey`：压缩后效果回访
- `contextSuggestions`：把压缩纳入日常 context hygiene 建议

这四块拼起来，才是 Claude Code 真正的 compaction operator experience。

## 1. compaction 前台不是一个按钮，而是一条完整反馈链

源码镜像：[`../../src/components/TokenWarning.tsx`](../../src/components/TokenWarning.tsx), [`../../src/components/messages/CompactBoundaryMessage.tsx`](../../src/components/messages/CompactBoundaryMessage.tsx), [`../../src/components/FeedbackSurvey/usePostCompactSurvey.tsx`](../../src/components/FeedbackSurvey/usePostCompactSurvey.tsx), [`../../src/utils/contextSuggestions.ts`](../../src/utils/contextSuggestions.ts)

用户在前台真正经历的顺序是：

1. `TokenWarning` 告诉你上下文快满了，或者该考虑 compact
2. `/compact` 或 autocompact 执行真正压缩
3. transcript 里插入 `CompactBoundaryMessage`
4. 后续继续对话后，再由 `usePostCompactSurvey` 追问压缩效果

因此 compaction 的产品形态不是“命令”，而是“告警 -> 分界 -> 回访”的状态链。

## 2. `TokenWarning` 不是单纯显示 token 数，而是 mode-aware 的风险面

源码镜像：[`../../src/components/TokenWarning.tsx`](../../src/components/TokenWarning.tsx)

`TokenWarning` 关心的不只是当前 token 比例，还关心当前环境到底支持哪种压缩路线。它会根据：

- 是否开启 autocompact
- 当前 host 是否允许 compact
- 当前模型/模式是否只能走 reactive fallback
- 是否已经处在 context-collapse 附近

来切换提示语义。也就是说，这块 UI 输出的是“当前上下文治理能力状态”，而不只是一个百分比。

## 3. compact warning 有自己的短时 suppress 协议，不会在刚压完后立刻反复吵用户

源码镜像：[`../../src/services/compact/compactWarningHook.ts`](../../src/services/compact/compactWarningHook.ts), [`../../src/services/compact/compactWarningState.ts`](../../src/services/compact/compactWarningState.ts)

`useCompactWarningSuppression()` 和 `compactWarningState` 共同提供了一层前台抑制语义：

- compaction 刚成功后，warning 不应立刻重新弹出
- suppress 不是永久关闭，只是短时间压住重复提醒
- 这层状态独立于 transcript，本质是 UI 行为节流器

因此 Claude Code 的 compact warning 不是“只要 token 高就永远提示”，而是承认“刚压完就继续提醒”是坏体验。

## 4. `Notifications.tsx` 说明 compact warning 的宿主是 prompt/footer，而不是消息流

源码镜像：[`../../src/components/PromptInput/Notifications.tsx`](../../src/components/PromptInput/Notifications.tsx), [`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx)

compact warning 并不进入 transcript block，而是挂在 `PromptInput` 周围的 notification surface。这个选择很关键：

- warning 是“当前输入前要不要治理上下文”的提示
- 它属于输入时机，而不是历史消息
- 它应该能随状态消失，而不是变成长期 transcript 噪音

因此 Claude Code 把它放在 footer/notification plane，而不是消息面板。

## 5. `CompactBoundaryMessage` 是 transcript 里的历史锚点，不是再次解释 compact 原理

源码镜像：[`../../src/components/messages/CompactBoundaryMessage.tsx`](../../src/components/messages/CompactBoundaryMessage.tsx)

压缩完成后，前台不会把全过程刷成大量系统消息，而是插入一个边界块。它的职责不是教学，而是：

- 告诉用户这里发生过一次上下文压缩
- 为后续 survey 提供可识别的 transcript 边界
- 让历史阅读时知道“前后文为何在这里变短”

这使得 compact 在 transcript 中呈现为“边界事件”，而不是一段冗长操作日志。

## 6. `usePostCompactSurvey` 不会一压完就追问，它要等边界后的真实会话继续发生

源码镜像：[`../../src/components/FeedbackSurvey/usePostCompactSurvey.tsx`](../../src/components/FeedbackSurvey/usePostCompactSurvey.tsx)

survey 的触发条件不是“compact 成功”本身，而是：

- transcript 中已有 compact boundary
- boundary 之后又出现了新的真实消息
- 用户不在 prompt 输入中的冲突状态

这说明 survey 在产品上被定义为“对 compact 效果的事后评价”，而不是“命令完成确认弹窗”。

## 7. survey 还带主动避让协议：输入中、不稳定时、不该打断时不会插入

源码镜像：[`../../src/components/FeedbackSurvey/usePostCompactSurvey.tsx`](../../src/components/FeedbackSurvey/usePostCompactSurvey.tsx)

这条链还明确体现了几种 operator hygiene：

- prompt 正在活跃时不要插 survey
- 压缩后还没形成真实后续体验时不要插 survey
- survey 本身不是每次都发，带采样门槛

当前实现里还有限制采样率的逻辑，约束其成为一个低频、事后、可测量的回访面，而不是每次 compact 都问。

## 8. survey 采的不只是满意度，还顺手记录了使用的是哪种 compact 路线

源码镜像：[`../../src/components/FeedbackSurvey/usePostCompactSurvey.tsx`](../../src/services/compact/sessionMemoryCompact.ts), [`../../src/services/compact/sessionMemoryCompact.ts`](../../src/services/compact/sessionMemoryCompact.ts)

survey 侧会结合 `shouldUseSessionMemoryCompaction()` 这类运行时判断，把“这次是否走了 session-memory 路线”带进埋点上下文。也就是说，Claude Code 在评估的不是抽象的“compact 满不满意”，而是更具体的：

- 哪类 compact 在什么条件下触发
- 用户对该路线的后续体验如何

这让 compact feedback 成为产品策略回路，而不是单纯 UX 装饰。

## 9. `contextSuggestions` 说明 compact 被放进了日常 context hygiene，而不是只当 emergency escape hatch

源码镜像：[`../../src/utils/contextSuggestions.ts`](../../src/utils/contextSuggestions.ts)

`contextSuggestions` 会把 compact 和其他上下文治理建议并列给出。这意味着 Claude Code 想表达的是：

- context 过长不是异常，而是日常运行态问题
- `/compact` 不是最后一刻的救火按钮
- 用户应该把 compact 理解为正常工作流的一环

因此 compact 在产品语义上被拉进了“context maintenance toolkit”。

## 10. `REPL.tsx` 是这几条前台链的总装配点

源码镜像：[`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx)

`REPL.tsx` 负责把这些看似分散的表面挂回同一条会话主轴：

- token warning 走 notification plane
- compact boundary 走 transcript plane
- post-compact survey 走 follow-up plane
- context suggestion 则影响输入前的引导

因此这几块不是各自为战的小组件，而是 REPL orchestration 下的 compaction UX 总装配。

## 11. 这篇和 `63`、`26`、`27` 的边界

[`../mechanisms/63-session-memory-compaction-autocompact-and-post-compact-restoration-runtime.md`](../mechanisms/63-session-memory-compaction-autocompact-and-post-compact-restoration-runtime.md) 讲的是：

- compact 在后端怎样决定走哪条压缩路线
- 压缩后怎样恢复 attachments 和 capability surface

这一篇讲的是：

- 用户在前台何时被提醒
- 压缩后 transcript 怎样形成边界
- 后续怎样被追问体验

[`./26-prompt-queue-and-elicitation-input-surfaces.md`](./26-prompt-queue-and-elicitation-input-surfaces.md) 与 [`./27-message-selector-idle-return-and-recommendation-dialogs.md`](./27-message-selector-idle-return-and-recommendation-dialogs.md) 讲的是其他输入/回访工作面；这一篇则专门覆盖 compaction 相关的 warning 与 survey 子系统。

## 12. 一句话结论

Claude Code 并没有把 compaction 做成“后台静默发生的一次压缩”，而是做成了一条可被感知、可被定位、可被评价的完整前台反馈链：

- 事前 warning
- 事后 boundary
- 后续 survey
- 平时 suggestion

这也是它把 context management 做成产品能力，而不是纯后端策略的一个典型例子。
