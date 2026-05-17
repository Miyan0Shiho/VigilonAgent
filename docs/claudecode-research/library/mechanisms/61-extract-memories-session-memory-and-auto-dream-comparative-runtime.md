# Extract Memories / Session Memory / Auto-Dream Comparative Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Auto-Dream Gating / Forked Agent / Task Surfacing Runtime`](./60-auto-dream-gating-forked-agent-and-task-surfacing-runtime.md) | [`下一站：Session Memory Prompt / Template / Waiting / Manual Summary Runtime`](./62-session-memory-prompt-template-waiting-and-manual-summary-runtime.md)

Claude Code 当前并不是“只有一个 memory 后台代理”。在源码里，至少有三条并列的后台记忆路径：

- `services/extractMemories/extractMemories.ts`
- `services/SessionMemory/sessionMemory.ts`
- `services/autoDream/autoDream.ts`

它们都用到了 forked agent，但目标、触发条件、权限边界、用户可见面都不一样。这一卷不再讲长期 memory 概念，而是把三条 runtime 放到一起对照。

## 1. 三条路径分别解决三种不同问题，不是同一 feature 的三种 UI

源码镜像：

- [`../../sources/claude-code/src/services/extractMemories/extractMemories.ts`](../../sources/claude-code/src/services/extractMemories/extractMemories.ts)
- [`../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts`](../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts)
- [`../../sources/claude-code/src/services/autoDream/autoDream.ts`](../../sources/claude-code/src/services/autoDream/autoDream.ts)

三者的职责分工在文件头和主流程里都很明确：

- `extractMemories`
  - 从当前会话里抽 durable memories
  - 写进 auto-memory library
- `sessionMemory`
  - 维护当前会话的 notes 文件
  - 为压缩和连续工作服务
- `autoDream`
  - 周期性 consolidation 最近多条 session
  - 像 nightly maintenance 一样整理 memory library

所以它们不是重复系统，而是“同一记忆栈里的三层不同后台作业”。

## 2. 三条路径都走 forked agent，但各自复用方式不同

源码镜像：

- [`../../sources/claude-code/src/utils/forkedAgent.ts`](../../sources/claude-code/src/utils/forkedAgent.ts)
- [`../../sources/claude-code/src/services/extractMemories/extractMemories.ts`](../../sources/claude-code/src/services/extractMemories/extractMemories.ts)
- [`../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts`](../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts)
- [`../../sources/claude-code/src/services/autoDream/autoDream.ts`](../../sources/claude-code/src/services/autoDream/autoDream.ts)

共同点是：

- 都通过 `runForkedAgent(...)`
- 都尽量复用 `createCacheSafeParams(...)`

但差别也很明确：

- `extractMemories`
  - `forkLabel: 'extract_memories'`
  - `skipTranscript: true`
  - `maxTurns: 5`
- `sessionMemory`
  - `forkLabel: 'session_memory'`
  - 不显式 `skipTranscript`
  - 用 `overrides.readFileState` 让 fork 改 notes 文件
- `autoDream`
  - `forkLabel: 'auto_dream'`
  - `skipTranscript: true`
  - `overrides.abortController`

也就是说，三者都用同一 fork runtime，但每条线只拿自己需要的那部分能力。

## 3. `extractMemories` 是“每轮结束后，尽量便宜地提取 durable facts”

源码镜像：[`../../sources/claude-code/src/services/extractMemories/extractMemories.ts`](../../sources/claude-code/src/services/extractMemories/extractMemories.ts)

它的触发位置是：

- query loop 结束
- fire-and-forget stop hook

而且只跑在：

- main agent
- auto-memory enabled
- 非 remote
- feature gate 开启

这条线的本质是“在主线程已经结束之后，低扰动地试着把本轮值得长期保存的东西抽出来”。

## 4. `sessionMemory` 是“上下文变大后，稀疏更新当前会话 notes”

源码镜像：

- [`../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts`](../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts)
- [`../../sources/claude-code/src/services/SessionMemory/sessionMemoryUtils.ts`](../../sources/claude-code/src/services/SessionMemory/sessionMemoryUtils.ts)

它的触发点不是“每轮都提取”，而是：

- 只在 `querySource === 'repl_main_thread'`
- 只在 gate 打开
- 只在 `shouldExtractMemory(messages)` 返回真时

默认阈值是：

- `minimumMessageTokensToInit = 10000`
- `minimumTokensBetweenUpdate = 5000`
- `toolCallsBetweenUpdates = 3`

所以 session memory 的模型是“上下文变大到一定程度，后台更新一份会话摘要”。

## 5. `autoDream` 是“按小时和 session 数量稀疏触发的整理任务”

源码镜像：

- [`../../sources/claude-code/src/services/autoDream/autoDream.ts`](../../sources/claude-code/src/services/autoDream/autoDream.ts)
- [`../../sources/claude-code/src/services/autoDream/consolidationLock.ts`](../../sources/claude-code/src/services/autoDream/consolidationLock.ts)

它不是按单轮信息量触发，而是按：

- `minHours`
- `minSessions`
- lock 可用性

来判断是否该跑一轮 consolidation。换句话说：

- `extractMemories` 看“这一轮结束后值不值得抽”
- `sessionMemory` 看“当前会话长到该记 notes 了吗”
- `autoDream` 看“最近积累够不够多，值得做一次库级整理了吗”

## 6. 三条路径的写入目标完全不同

源码镜像：

- [`../../sources/claude-code/src/services/extractMemories/extractMemories.ts`](../../sources/claude-code/src/services/extractMemories/extractMemories.ts)
- [`../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts`](../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts)
- [`../../sources/claude-code/src/services/autoDream/consolidationPrompt.ts`](../../sources/claude-code/src/services/autoDream/consolidationPrompt.ts)

写入目标分别是：

- `extractMemories`
  - auto-memory directory 下的 topic files 和索引
- `sessionMemory`
  - 一份固定的 session notes 文件
- `autoDream`
  - memory library 本身，包括 topic files 和 `MEMORY.md` 索引整理

所以只有 `sessionMemory` 是单文件维护器；另外两条都面向 library 级写入。

## 7. 权限边界也分成两类：单文件极限收紧 vs memory-dir 受限写

源码镜像：

- [`../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts`](../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts)
- [`../../sources/claude-code/src/services/extractMemories/extractMemories.ts`](../../sources/claude-code/src/services/extractMemories/extractMemories.ts)

`sessionMemory` 的 `createMemoryFileCanUseTool(memoryPath)` 只允许：

- `FileEdit`
- 且 `file_path === memoryPath`

而 `extractMemories` / `autoDream` 共享的 `createAutoMemCanUseTool(memoryDir)` 则允许：

- `FileRead`
- `Grep`
- `Glob`
- read-only `Bash`
- `FileEdit / FileWrite` 但必须在 memory dir 内
- `REPL` 作为 primitive tool 宿主

这说明 session-memory 被当成“笔记本编辑器”，而 extract/dream 被当成“受限的记忆库维护器”。

## 8. `extractMemories` 有一条明确的互斥原则：主 agent 已经写过 memory，就别再 fork 一次

源码镜像：[`../../sources/claude-code/src/services/extractMemories/extractMemories.ts`](../../sources/claude-code/src/services/extractMemories/extractMemories.ts)

`hasMemoryWritesSince(...)` 会先检查：

- 最近 assistant message 里是否已经有 `Write/Edit` 指向 auto-memory path

如果有，就：

- 跳过 fork
- 把 cursor 推到最新消息

这条互斥原则很关键。它说明 extractMemories 不是“无论如何再来一遍”，而是只在主 agent 没有自己保存 memory 时才兜底。

## 9. `extractMemories` 还有 trailing/coalescing 语义，承认自己会慢

源码镜像：[`../../sources/claude-code/src/services/extractMemories/extractMemories.ts`](../../sources/claude-code/src/services/extractMemories/extractMemories.ts)

如果 extraction 已经在进行中：

- 新 context 不会并发开第二个 fork
- 只会覆盖 `pendingContext`
- 等当前 extraction 完成后再做 trailing run

同时还维护：

- `inFlightExtractions`
- `drainer(timeoutMs)`

这说明 extractMemories 被显式设计成“可落后于主线程，但不能无界堆积”的后台 sidecar。

## 10. `sessionMemory` 的 gate 逻辑不是“token 多了就写”，而是 token 与 tool-call 的组合条件

源码镜像：

- [`../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts`](../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts)
- [`../../sources/claude-code/src/services/SessionMemory/sessionMemoryUtils.ts`](../../sources/claude-code/src/services/SessionMemory/sessionMemoryUtils.ts)

`shouldExtractMemory(messages)` 的关键逻辑是：

- 先满足初始化阈值
- 之后每次都必须满足 `minimumTokensBetweenUpdate`
- 再加上两种触发方式之一：
  - tool-call 数也达标
  - 或最后一个 assistant turn 已经不在 tool-calling 状态

源码注释还把一条原则写得很硬：

- token threshold 始终是必要条件

所以 session memory 并不会因为工具调用多就频繁更新，它更偏向“在自然停顿点，以 context-growth 为主信号”。

## 11. `sessionMemory` 还绑定 `auto-compact`，说明它本质上是压缩基础设施的一部分

源码镜像：[`../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts`](../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts)

`initSessionMemory()` 里有一条关键判断：

- `const autoCompactEnabled = isAutoCompactEnabled()`
- 若未开启，直接不注册 hook

这说明 session memory 不只是“额外记点笔记”，而是被产品上视为 compaction/runtime continuity 的配套基础设施。

## 12. `autoDream` 和 `extractMemories` 都会往主 transcript 回灌 memory-saved 提示，但语义不同

源码镜像：

- [`../../sources/claude-code/src/services/extractMemories/extractMemories.ts`](../../sources/claude-code/src/services/extractMemories/extractMemories.ts)
- [`../../sources/claude-code/src/services/autoDream/autoDream.ts`](../../sources/claude-code/src/services/autoDream/autoDream.ts)

两者都会在成功后走 `appendSystemMessage`，但用法不同：

- `extractMemories`
  - 统计 `writtenPaths`
  - 生成普通 `createMemorySavedMessage(memoryPaths)`
- `autoDream`
  - 看的是 `dreamState.filesTouched`
  - 复用同一个 message builder，但把 `verb` 改成 `Improved`

所以两者的用户可见面都像“memory note”，但产品语义分别是：

- extract: 保存了新记忆
- dream: 改进了既有记忆库

## 13. `sessionMemory` 默认不会向主 transcript 插这种保存提示

源码镜像：[`../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts`](../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts)

和另外两条线相比，session memory 完成后主要做的是：

- 记录 telemetry
- 更新 `lastSummarizedMessageId`
- 记录 `tokensAtLastExtraction`

它没有对应的 `appendSystemMessage(createMemorySavedMessage(...))` 路线。也就是说，session memory 更像内部工作笔记维护，而不是用户需要显式感知的“存档事件”。

## 14. `autoDream` 是三者里唯一一个先 materialize task host，再启动 fork 的后台作业

源码镜像：

- [`../../sources/claude-code/src/services/autoDream/autoDream.ts`](../../sources/claude-code/src/services/autoDream/autoDream.ts)
- [`../../sources/claude-code/src/tasks.ts`](../../sources/claude-code/src/tasks.ts)

只有 auto-dream 会：

- `registerDreamTask(...)`
- 出现在 task registry
- 有 footer pill / BackgroundTasksDialog / DreamDetailDialog

`extractMemories` 和 `sessionMemory` 都没有各自的任务宿主。它们更像 invisible maintenance fork，而不是 operator-visible background task。

## 15. 三条路径的“压缩目标”也不同

源码镜像：

- [`../../sources/claude-code/src/services/extractMemories/extractMemories.ts`](../../sources/claude-code/src/services/extractMemories/extractMemories.ts)
- [`../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts`](../../sources/claude-code/src/services/SessionMemory/sessionMemory.ts)
- [`../../sources/claude-code/src/services/autoDream/consolidationPrompt.ts`](../../sources/claude-code/src/services/autoDream/consolidationPrompt.ts)

可以把它们理解成三种不同粒度的压缩：

- `extractMemories`
  - 从“这轮对话”压缩出 durable facts
- `sessionMemory`
  - 从“当前会话上下文”压缩出 working notes
- `autoDream`
  - 从“最近多条 session + 现有记忆库”压缩出更整洁的长期知识库

所以它们共享的不是具体 prompt，而是“压缩”这个总体意图；真正压缩的对象根本不同。

## 16. 为什么这一卷必须独立

如果只看 `12`，会以为“Claude Code 有长期 memory 和 session memory 两层”。但当前实现里，后台真正跑的其实是三条不同作业：

- 一条追求每轮兜底写库
- 一条追求当前会话 notes 稀疏更新
- 一条追求跨 session 的周期性 consolidation

它们共同构成的不是单一 memory service，而是一套分层的记忆维护流水线。
