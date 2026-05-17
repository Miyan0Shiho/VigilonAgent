# Memdir、Auto Memory 与 Session Memory

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Skills Runtime`](./11-skills-runtime-and-loading.md) | [`下一站：产品卷`](../product/01-positioning-and-surface.md)

本文把 `memdir/**`、`services/SessionMemory/**`、相关 bundled skill 拆成一卷，说明 Claude Code 的记忆系统不是一个文件，而是“长期 typed memory + 当前会话摘要 + 辅助整理技能”的多层结构。

## 1. `MEMORY.md` 不是记忆内容本体，而是索引入口

源码镜像：[`../../src/memdir/memdir.ts`](../../src/memdir/memdir.ts)

`ENTRYPOINT_NAME = 'MEMORY.md'` 配合 `buildMemoryLines()` 已经把语义写死了：

- 每条 memory 应该写到独立文件
- `MEMORY.md` 只保存一行式 pointer
- 新记忆需要“写文件 + 进索引”两步

所以 auto-memory 不是一个不断膨胀的日志文件，而是 topic files 加索引页的文件库结构。

## 2. memdir 先定义“什么能记”，再定义“怎么记”

源码镜像：[`../../src/memdir/memoryTypes.ts`](../../src/memdir/memoryTypes.ts), [`../../src/memdir/memdir.ts`](../../src/memdir/memdir.ts)

`buildMemoryLines()` 拼出来的不是简单操作说明，而是 typed-memory 行为规约：

- 只允许有限类型的 memory taxonomy
- 可从当前仓库直接推导出的事实不该写 memory
- plan、tasks、memory 是不同持久化机制
- recall 结果不是绝对真理，可能过时

因此 memdir 的第一职责不是“存”，而是限制模型别把什么都存进去。

## 3. auto-memory 是否启用，是一条明确的优先级链

源码镜像：[`../../src/memdir/paths.ts`](../../src/memdir/paths.ts)

`isAutoMemoryEnabled()` 的优先级很清楚：

- `CLAUDE_CODE_DISABLE_AUTO_MEMORY`
- `CLAUDE_CODE_SIMPLE`
- remote 但没有持久化目录
- settings 里的 `autoMemoryEnabled`
- 默认开启

这说明 memory 不是“永远存在”的产品前提，而是受运行模式和存储条件控制的能力。

## 4. auto-memory path 不是拍脑袋拼接，而是防御性路径治理

源码镜像：[`../../src/memdir/paths.ts`](../../src/memdir/paths.ts)

`validateMemoryPath()` 与 `getAutoMemPath()` 暴露了很强的安全与稳定性意识：

- 拒绝相对路径、根路径、UNC、空字节
- settings 允许 `~/`，env override 不允许随意缩写
- project settings 故意不能指定 `autoMemoryDirectory`
- 默认路径是 `<memoryBase>/projects/<sanitized-git-root>/memory/`

这说明 memory path 不只是 UX 配置项，它还是文件系统权限边界的一部分。

## 5. 长期 memory 的 prompt 注入本质上是“把写库规则放进 system prompt”

源码镜像：[`../../src/memdir/memdir.ts`](../../src/memdir/memdir.ts), [`../../src/QueryEngine.ts`](../../src/QueryEngine.ts)

`loadMemoryPrompt()` 负责把 memory policy 和入口描述注入系统上下文。它会：

- 先判断 auto / team / KAIROS 哪种模式开启
- 确保 memory 目录存在
- 为 auto/team memory 记录 telemetry
- 决定当前是 index mode 还是 daily-log mode

而 `QueryEngine` 则在系统 prompt 侧消费这段记忆说明。也就是说，长期 memory 的第一层实现不是工具，而是 prompt contract。

## 6. `MEMORY.md` 有硬截断规则，说明它默认会失控增长

源码镜像：[`../../src/memdir/memdir.ts`](../../src/memdir/memdir.ts)

`truncateEntrypointContent()` 同时按两种上限截断：

- `MAX_ENTRYPOINT_LINES = 200`
- `MAX_ENTRYPOINT_BYTES = 25_000`

并在超限时追加 warning。这意味着设计者默认承认一件事：如果没有索引纪律，`MEMORY.md` 很容易劣化成巨型垃圾入口。

所以 memdir 不是“文件放着就行”，而是持续对抗上下文污染。

## 7. KAIROS 模式把长期 memory 改造成“先日志，后蒸馏”

源码镜像：[`../../src/memdir/memdir.ts`](../../src/memdir/paths.ts)

当 `feature('KAIROS')` 且处于 assistant 式长会话时，不再直接把新信息写入 `MEMORY.md` 索引流，而是：

- 写到按日分片的 `logs/YYYY/MM/YYYY-MM-DD.md`
- 采用 append-only 方式
- 再由 nightly `/dream` 去蒸馏 topic files 和 `MEMORY.md`

这说明 Claude Code 已经区分了两种长期记忆写法：

- 普通会话：直接维护 typed memory library
- 超长会话：先写工作日志，再异步蒸馏

## 8. session memory 不是长期 memory，它是为“当前会话连续性”服务的本地摘要文件

源码镜像：[`../../src/services/SessionMemory/sessionMemory.ts`](../../src/services/SessionMemory/prompts.ts)

`DEFAULT_SESSION_MEMORY_TEMPLATE` 已经把用途说得很清楚：它保存的是当前会话的 `Current State`、`Files and Functions`、`Errors & Corrections`、`Worklog` 等。

它和 memdir 的差异在于：

- memdir 面向未来会话复用
- session memory 面向本次会话压缩、恢复、连续工作

所以它不是第二份 `MEMORY.md`，而是当前线程的工作摘要。

## 9. session memory 不是每轮都跑，而是阈值驱动的后台提取器

源码镜像：[`../../src/services/SessionMemory/sessionMemory.ts`](../../src/services/SessionMemory/sessionMemoryUtils.ts)

`shouldExtractMemory()` 同时检查：

- 是否达到初始化 token 阈值
- 与上次提取相比是否增长了足够 token
- 自上次提取后是否积累了足够多工具调用
- 最后一个 assistant turn 是否仍在 tool-call 中

默认阈值也已经写死：

- `minimumMessageTokensToInit = 10000`
- `minimumTokensBetweenUpdate = 5000`
- `toolCallsBetweenUpdates = 3`

这说明 session memory 不是“每轮增量记笔记”，而是只在上下文足够大时触发的稀疏提取器。

## 10. 提取不是在主线程里做，而是 forked agent 专职写 notes

源码镜像：[`../../src/services/SessionMemory/sessionMemory.ts`](../../src/utils/forkedAgent.ts)

`extractSessionMemory()` 的链路是：

- post-sampling hook 触发
- 只允许 `repl_main_thread`
- 创建隔离的 `setupContext`
- 读取或初始化 notes 文件
- 生成 update prompt
- `runForkedAgent()` 跑一个 `session_memory` 子代理

所以 session memory 的设计目标很明确：不要打断主对话，让后台子代理专门把 notes 维护好。

## 11. 这个子代理几乎没有自由度，只允许改一份文件

源码镜像：[`../../src/services/SessionMemory/sessionMemory.ts`](../../src/services/SessionMemory/prompts.ts)

`createMemoryFileCanUseTool()` 只放行：

- `FileEditTool`
- 且 `file_path` 必须等于当前 notes 文件

同时 prompt 里明确要求：

- 只用 Edit
- 保留 section headers 和 italic template lines
- 不要调用任何其他工具
- 只更新每个 section 的正文内容

这说明 session memory 子代理不是开放式总结器，而是受强约束的单文件维护器。

## 12. 自定义入口说明 session memory 已经被当成可运营组件

源码镜像：[`../../src/services/SessionMemory/prompts.ts`](../../src/services/SessionMemory/sessionMemory.ts)

这里至少支持三种可调节点：

- `~/.claude/session-memory/config/template.md`
- `~/.claude/session-memory/config/prompt.md`
- remote config 覆盖三个阈值

再加上 `/summary` 通过 `manuallyExtractSessionMemory()` 可手工触发，说明 session memory 已不是内部实验，而是可以调参、可手动介入的产品子系统。

## 13. skill 与 session memory 已经形成反身回路

源码镜像：[`../../src/skills/bundled/skillify.ts`](../../src/skills/bundled/remember.ts)

这一层特别关键：

- `skillify` 会把 session memory 当作“本次流程沉淀物”，再反向生成可复用 skill
- `remember` 会把 auto-memory、`CLAUDE.md`、`CLAUDE.local.md` 当成待整理资产

所以 Claude Code 的记忆系统不是孤立存储，而是已经参与了“总结 -> 提炼 -> 重组为能力”的闭环。

## 14. 为什么这一卷必须独立

如果只把 memory 讲成“Claude 有记忆功能”，会丢掉最重要的结构差异：

- memdir 解决跨会话长期 recall
- KAIROS daily log 解决超长会话的 append-only 写入
- session memory 解决当前会话压缩与连续性
- bundled skills 负责对记忆资产做整理和能力化

它们共同组成的不是单一 memory feature，而是一套分层持久化系统。
