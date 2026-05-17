# Session Memory / Away Summary / Skillify Consumer Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Session Memory Compaction / Autocompact / Post-Compact Restoration Runtime`](./63-session-memory-compaction-autocompact-and-post-compact-restoration-runtime.md) | [`下一站：Skillify Materialization / Command Permission Runtime`](./65-skillify-materialization-and-command-permission-runtime.md)

`61-63` 已经把 session memory 的生成、等待、手动 summary、compact 分流讲开了，但还有一块关键运行时没单独拆明白：这些 notes 一旦写出来，并不会只躺在磁盘上。Claude Code 还把它直接接进了至少两条下游产品链：

- `away summary`：用户离开一段时间后，回来时给一句“你刚才在做什么”
- `skillify`：把这次会话抽成可复用 skill

这两条消费链共同说明，session memory 在系统里不是“日志”，而是一个被主动复用的共享中间资产。

## 1. session memory 的运行时定位已经从“后台笔记”升级成了共享 read model

源码镜像：[`../../sources/claude-code/src/services/SessionMemory/sessionMemoryUtils.ts`](../../sources/claude-code/src/services/SessionMemory/sessionMemoryUtils.ts), [`../../sources/claude-code/src/services/awaySummary.ts`](../../sources/claude-code/src/services/awaySummary.ts), [`../../sources/claude-code/src/skills/bundled/skillify.ts`](../../sources/claude-code/src/skills/bundled/skillify.ts)

这几条链都直接读取：

- `getSessionMemoryContent()`

而不是重新从 transcript 做全量归纳。这意味着 session memory 在 Claude Code 里已经被抬成一种共享 read model：

- extraction 负责把长会话压成可消费 notes
- 下游功能直接读这份 notes
- 不再各自重新做一轮昂贵总结

这和“只是给用户留个 markdown 文件”是两种完全不同的系统角色。

## 2. `getSessionMemoryContent()` 故意做成无环依赖 utility，就是为了给下游功能随时拿来读

源码镜像：[`../../sources/claude-code/src/services/SessionMemory/sessionMemoryUtils.ts`](../../sources/claude-code/src/services/SessionMemory/sessionMemoryUtils.ts)

`sessionMemoryUtils.ts` 顶部就明确写了：它和主 `sessionMemory.ts` 分离，是为了避免把 `runAgent` 那条重运行时链带进来。这使它能提供几种轻量只读能力：

- `getSessionMemoryContent()`
- `waitForSessionMemoryExtraction()`
- `getLastSummarizedMessageId()`

因此 away summary、skillify、compact 都能在不引入完整 extraction runtime 的情况下，直接把 notes 当依赖读走。

## 3. away summary 不是“再做一次 transcript 总结”，而是 `session memory + recent window` 的双层 recap

源码镜像：[`../../sources/claude-code/src/services/awaySummary.ts`](../../sources/claude-code/src/services/awaySummary.ts)

`generateAwaySummary(...)` 的 prompt 装配非常克制：

- 先 `await getSessionMemoryContent()`
- 再只截 `messages.slice(-30)`
- 最后补一条 recap instruction user message

也就是说，它不是把整条会话再喂一遍模型，而是做：

- broader context 走 session memory
- immediate recency 走最近 `30` 条消息

这是一个典型的“notes 负责长程压缩，recent window 负责局部 freshness”的双层消费模型。

## 4. away summary 的 prompt 明确把 session memory 定义成 broader context，而不是最终答案来源

源码镜像：[`../../sources/claude-code/src/services/awaySummary.ts`](../../sources/claude-code/src/services/awaySummary.ts)

`buildAwaySummaryPrompt(memory)` 里把 notes 包装成：

- `Session memory (broader context):`

然后要求模型：

- 只写 `1-3 short sentences`
- 先说用户在构建/调试什么
- 再说具体下一步
- `Skip status reports and commit recaps`

这说明 away summary 并不把 notes 当“现成文案”，而是把它当成高层背景，用来约束一个极短、面向复工的 recap。

## 5. away summary 还是一个特意做小的模型调用：小模型、无工具、无 streaming、recent-only

源码镜像：[`../../sources/claude-code/src/services/awaySummary.ts`](../../sources/claude-code/src/services/awaySummary.ts)

它调用的是：

- `queryModelWithoutStreaming(...)`
- `getSmallFastModel()`
- `thinkingConfig: { type: 'disabled' }`
- `tools: []`
- `querySource: 'away_summary'`
- `skipCacheWrite: true`

这说明这条消费链被明确定义成：

- 低成本
- 快速
- 不需要工具
- 不需要留下 cache 写痕

因此 session memory 在这里最大的价值不是“让答案更长”，而是“让小模型也能快速知道你之前在干什么”。

## 6. `useAwaySummary` 说明 away summary 的真实宿主不是命令，而是 terminal focus hook

源码镜像：[`../../sources/claude-code/src/hooks/useAwaySummary.ts`](../../sources/claude-code/src/hooks/useAwaySummary.ts)

前台触发条件并不是 slash command，而是：

- terminal `blurred` 持续 `5 * 60_000`
- 当前没有 turn in progress
- 自上次 user turn 以来还没有 `away_summary`

并且它还会：

- 订阅 `subscribeTerminalFocus(...)`
- blur 时启动 timer
- focus 时清 timer 并 abort in-flight request

所以 away summary 是一个 focus-driven resume sidecar，不是普通命令面。

## 7. away summary 会在 turn 中途主动延迟，说明它优先服从主会话节奏

源码镜像：[`../../sources/claude-code/src/hooks/useAwaySummary.ts`](../../sources/claude-code/src/hooks/useAwaySummary.ts)

当 blur 定时器到点时，如果：

- `isLoadingRef.current === true`

它不会硬插 summary，而是先：

- `pendingRef.current = true`

等 turn 结束、且终端仍然 blurred 时再生成。这说明 away summary 虽然是系统自动插入，但它不会打断主线程推理/响应节奏。

## 8. away summary 还用 compact boundary 做切口，避免旧 recap 重复污染新阶段

源码镜像：[`../../sources/claude-code/src/utils/messages.ts`](../../sources/claude-code/src/utils/messages.ts), [`../../sources/claude-code/src/skills/bundled/skillify.ts`](../../sources/claude-code/src/skills/bundled/skillify.ts)

session memory 这条线和 compaction 的一个重要接缝是：

- `getMessagesAfterCompactBoundary(...)`

skillify 明确只看 compact boundary 之后的用户消息，away summary 虽然自己直接截最近窗口，但前面 `63` 已经说明 compact 后 notes 与 suffix 已经被重新对齐。因此 compact boundary 在这里相当于会话阶段切口，防止“很久之前的 steering”无限滚入当前消费面。

## 9. `skillify` 不是简单导出 notes，而是把 session memory 当作访谈前的结构化 briefing

源码镜像：[`../../sources/claude-code/src/skills/bundled/skillify.ts`](../../sources/claude-code/src/skills/bundled/skillify.ts)

`skillify` 的 prompt 结构很清楚：

- 一段 `<session_memory>`：当前会话摘要
- 一段 `<user_messages>`：当前阶段的用户原话
- 然后要求模型先分析流程，再通过 `AskUserQuestion` 逐轮访谈

这说明 session memory 在这里不是最终产物，而是 interview bootstrap briefing。它负责让模型先抓住：

- 这次 workflow 在做什么
- 成功标准是什么
- 用户在哪些地方纠偏过

而真正的 skill 规范化仍然通过后续交互完成。

## 10. `skillify` 还特意保留 user raw messages，说明 notes 无法替代 steering 细节

源码镜像：[`../../sources/claude-code/src/skills/bundled/skillify.ts`](../../sources/claude-code/src/skills/bundled/skillify.ts)

它没有只靠 session memory，而是还会：

- `extractUserMessages(...)`
- 从 `getMessagesAfterCompactBoundary(context.messages)` 里抽出用户原文

原因很直接：session memory 更像抽象后的 notes，而 skillify 真正关心的是：

- 用户怎么改过你
- 哪些约束是口头定下来的
- 哪些偏好适合写进 future skill rules

因此 skillify 的输入模型是：

- notes 给高层结构
- raw user messages 给细粒度 steering evidence

## 11. `skillify` 还是一个强约束的人机协作面，不允许模型直接静默落盘

源码镜像：[`../../sources/claude-code/src/skills/bundled/skillify.ts`](../../sources/claude-code/src/skills/bundled/skillify.ts)

这条 skill 的 prompt 明确要求：

- 所有问题都必须用 `AskUserQuestion`
- 分多轮确认 name、description、steps、arguments、save location
- 写入前先输出完整 `SKILL.md` yaml code block
- 再次 AskUserQuestion 确认后才能保存

所以 session memory 在 skillify 里承担的是“加速理解”，不是“授权自动产出”。这和 away summary 那种全自动 resume recap 是完全不同的消费风格。

## 12. `disableModelInvocation: true` 说明 skillify 是 operator-invoked capture flow，不是模型自发套路

源码镜像：[`../../sources/claude-code/src/skills/bundled/skillify.ts`](../../sources/claude-code/src/skills/bundled/skillify.ts)

注册时它显式声明：

- `userInvocable: true`
- `disableModelInvocation: true`

这表示 skillify 不是普通可被模型自动调用的内建 skill，而是需要人明确触发的 operator flow。session memory 在这里被用来支撑“人为决定把一次流程产品化”，而不是让模型自己随手把任何会话都抽成 skill。

## 13. `tipRegistry` 又给这条消费链补了一层 discoverability sidecar

源码镜像：[`../../sources/claude-code/src/services/tips/tipRegistry.ts`](../../sources/claude-code/src/services/tips/tipRegistry.ts)

当前镜像里还存在一条内部 tip：

- `[ANT-ONLY] Use /skillify at the end of a workflow to turn it into a reusable skill`

这意味着 skillify 这条下游消费链还被接进了 tips surface。也就是说，Claude Code 不只是“支持从 session memory 生成 skill”，还会在产品上提醒操作者：这次 workflow 结束后，值得把它沉淀下来。

## 14. away summary 和 skillify 体现了 session memory 的两种截然不同消费风格

源码镜像：[`../../sources/claude-code/src/services/awaySummary.ts`](../../sources/claude-code/src/skills/bundled/skillify.ts)

away summary 的风格是：

- 自动触发
- 小模型
- 低成本
- 只产 1-3 句复工提示

skillify 的风格是：

- 人工触发
- 长 prompt
- 交互式访谈
- 最终产出可复用 artifact

两者唯一的共同点，是都把 session memory 当成“先验压缩背景”，而不是重新回放整条 transcript。

## 15. 这篇和 `62`、`63`、`11` 的边界

[`./62-session-memory-prompt-template-waiting-and-manual-summary-runtime.md`](./62-session-memory-prompt-template-waiting-and-manual-summary-runtime.md) 讲的是：

- session memory 自己怎样被写、等、手动触发

[`./63-session-memory-compaction-autocompact-and-post-compact-restoration-runtime.md`](./63-session-memory-compaction-autocompact-and-post-compact-restoration-runtime.md) 讲的是：

- session memory 怎样反过来改写 compact 和 autocompact

这一篇讲的是：

- session memory 被别的产品面怎样读走和再利用

[`./11-skills-runtime-and-loading.md`](./11-skills-runtime-and-loading.md) 则讲 skills runtime 自己怎样被发现和加载；本篇只覆盖 `skillify` 把一次 session 沉淀成 skill 的消费链，不展开 skill loader 本体。

## 16. 一句话结论

session memory 在 Claude Code 里已经不是“后台自动记点笔记”这么简单了。它实际承担的是一个共享压缩背景层：

- 向前，喂给 compact/autocompact 做上下文治理
- 向后，喂给 away summary 做复工提示
- 向侧，喂给 skillify 做流程沉淀

这也是它从 feature 变成 runtime substrate 的真正标志。
