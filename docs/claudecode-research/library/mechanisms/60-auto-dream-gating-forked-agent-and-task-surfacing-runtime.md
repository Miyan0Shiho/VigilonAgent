# Auto-Dream Gating / Forked Agent / Task Surfacing Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Dream / Workflow / Monitor Detail Surfaces`](../architecture/38-dream-workflow-and-monitor-detail-surfaces.md) | [`下一站：Extract Memories / Session Memory / Auto-Dream Comparative Runtime`](./61-extract-memories-session-memory-and-auto-dream-comparative-runtime.md)

`architecture/38` 已经把 dream 的 detail surface 拆开了，但那一篇刻意停在“你能看到什么”。当前镜像其实还能再往下一层，把 `autoDream` 的触发、锁、fork、进度观察、任务显性化一路串起来。这一卷只讲这条执行桥：

- `services/autoDream/config.ts`
- `services/autoDream/consolidationLock.ts`
- `services/autoDream/consolidationPrompt.ts`
- `services/autoDream/autoDream.ts`
- `services/extractMemories/extractMemories.ts`
- `utils/forkedAgent.ts`
- `tasks/DreamTask/DreamTask.ts`
- `tasks.ts`

## 1. auto-dream 是 stop-hook sidecar，不是普通 slash command

源码镜像：[`../../src/services/autoDream/autoDream.ts`](../../src/services/autoDream/autoDream.ts)

文件头已经把它的定位写死了：

- background memory consolidation
- 由 `initAutoDream()` 初始化 closure-scoped runner
- 从 stop hooks 入口执行
- 只在完整 query loop 收尾后才有机会触发

这说明 auto-dream 不是用户主动开的一个命令面，而是 REPL 停顿后后台尝试触发的 maintenance sidecar。

## 2. gate 顺序被明确优化成“先便宜后昂贵”

源码镜像：[`../../src/services/autoDream/autoDream.ts`](../../src/services/autoDream/autoDream.ts)

auto-dream 的 gate order 在注释里就是显式协议：

1. time gate
2. session gate
3. lock gate

理由也很直接：

- 先做一次 `stat`
- 只有 time 过了才扫 transcript 候选
- 只有确认值得做才尝试争锁

这说明它的目标不是“尽快 dream”，而是“尽量廉价地知道今天该不该 dream”。

## 3. enabled gate 不是单一 feature flag，而是多条件组合

源码镜像：

- [`../../src/services/autoDream/config.ts`](../../src/services/autoDream/config.ts)
- [`../../src/services/autoDream/autoDream.ts`](../../src/services/autoDream/autoDream.ts)

`isAutoDreamEnabled()` 自己只决定：

- user settings 里的 `autoDreamEnabled`
- 否则 fall through 到 GrowthBook `tengu_onyx_plover.enabled`

但真正的 `isGateOpen()` 还叠了更多前置：

- `getKairosActive()` 为真则禁用
- `getIsRemoteMode()` 为真则禁用
- `isAutoMemoryEnabled()` 为假则禁用
- `isAutoDreamEnabled()` 才是最后一个开关

所以 auto-dream 不是简单 feature flag，而是 `local + auto-memory + non-KAIROS + policy/settings enabled` 的组合 gate。

## 4. scheduling knobs 来自 GB，但会做 defensive validation

源码镜像：[`../../src/services/autoDream/autoDream.ts`](../../src/services/autoDream/autoDream.ts)

`getConfig()` 会从 `tengu_onyx_plover` 里取：

- `minHours`
- `minSessions`

并做每字段防御性校验：

- 必须是 finite number
- 必须大于 0
- 否则回退到默认值

默认值是：

- `minHours = 24`
- `minSessions = 5`

这说明 GB 在这里提供的是调度旋钮，不是可信配置源。

## 5. time gate 之后还有一层 scan throttle，避免“每回合都重新扫 transcript”

源码镜像：[`../../src/services/autoDream/autoDream.ts`](../../src/services/autoDream/autoDream.ts)

即使 `hoursSince >= minHours`，也不会每个 turn 都扫 session：

- `SESSION_SCAN_INTERVAL_MS = 10 * 60 * 1000`
- closure 里保存 `lastSessionScanAt`

所以当 time gate 通过但 session gate 还没达到阈值时，系统不会在每一轮 stop hook 上都重做同样的 transcript candidate scan。

## 6. session gate 用的是“自上次 consolidation 以来被 touched 的 session”，不是 birthtime

源码镜像：[`../../src/services/autoDream/consolidationLock.ts`](../../src/services/autoDream/consolidationLock.ts)

`listSessionsTouchedSince(sinceMs)` 的语义是：

- 按当前 cwd 的 transcript project dir 扫候选
- 用 `mtime`
- 只要 `mtime > sinceMs` 就算 touched

而且 caller 还会显式剔除当前 session：

- `sessionIds = sessionIds.filter(id => id !== currentSession)`

所以 auto-dream 关心的是“自上次 consolidation 以来，有多少历史 session 被更新过”，而不是“创建了多少个新 session 文件”。

## 7. lock file 既是互斥锁，也是 `lastConsolidatedAt` 的存储体

源码镜像：[`../../src/services/autoDream/consolidationLock.ts`](../../src/services/autoDream/consolidationLock.ts)

`.consolidate-lock` 有双重语义：

- body 存 holder PID
- `mtime` 就是 `lastConsolidatedAt`

因此：

- `readLastConsolidatedAt()` 只要一次 `stat`
- acquire 成功后把 `mtime` 推到现在
- 失败时通过 rollback 把 `mtime` 倒回去

这不是传统“锁文件只管互斥”，而是把调度时钟和互斥状态折叠进同一个 inode。

## 8. lock reclaim 不是只看 PID，还看 holder age

源码镜像：[`../../src/services/autoDream/consolidationLock.ts`](../../src/services/autoDream/consolidationLock.ts)

`tryAcquireConsolidationLock()` 的阻塞条件是：

- lock 存在
- `Date.now() - mtimeMs < HOLDER_STALE_MS`
- holder PID 仍然 live

其中：

- `HOLDER_STALE_MS = 1h`

所以即便 PID 还活着，只要锁太老，也会视为可回收。这是在防 PID reuse 和长期挂死之间取折中。

## 9. dream 一旦决定触发，会先 materialize 一个 `DreamTask` 再 fork

源码镜像：

- [`../../src/services/autoDream/autoDream.ts`](../../src/services/autoDream/autoDream.ts)
- [`../../src/tasks/DreamTask/DreamTask.ts`](../../src/tasks/DreamTask/DreamTask.ts)

触发路径里最关键的转折是：

- 先拿 `setAppState`
- 创建 `AbortController`
- `registerDreamTask(setAppState, { sessionsReviewing, priorMtime, abortController })`

然后才进入真正的 forked agent。也就是说，UI surfacing 不是事后补的，而是运行前先注册出一个可观察宿主。

## 10. consolidation prompt 不是通用 dream prompt，而是一个明确四阶段的 memory-maintenance script

源码镜像：[`../../src/services/autoDream/consolidationPrompt.ts`](../../src/services/autoDream/consolidationPrompt.ts)

`buildConsolidationPrompt(...)` 明确把任务分成：

- Phase 1 — Orient
- Phase 2 — Gather recent signal
- Phase 3 — Consolidate
- Phase 4 — Prune and index

而且它强制模型围绕：

- memory root
- transcript dir
- `ENTRYPOINT_NAME`
- `MAX_ENTRYPOINT_LINES`

来工作。这说明 auto-dream 不是“自由反思”，而是被强约束成 memory index 维护工作流。

## 11. prompt 的 “Additional context” 会把本次待看的 sessions 和工具约束显式灌进去

源码镜像：[`../../src/services/autoDream/autoDream.ts`](../../src/services/autoDream/autoDream.ts)

构造 prompt 时，`autoDream.ts` 还会附加一段 `extra`：

- Bash 只能做 read-only 命令
- 本次 sessions since last consolidation 的 UUID 列表

这段额外信息不写进共享 prompt 主体，而是只在 auto-dream 运行时拼接。这么做是为了：

- 不误导手动 `/dream`
- 让这次 fork 知道该看哪些 recent sessions
- 提前告知 shell 能力边界

## 12. dream fork 复用 `runForkedAgent()`，而且刻意走 cache-safe、no-transcript 路线

源码镜像：

- [`../../src/services/autoDream/autoDream.ts`](../../src/services/autoDream/autoDream.ts)
- [`../../src/utils/forkedAgent.ts`](../../src/utils/forkedAgent.ts)

真正执行时传的是：

- `cacheSafeParams: createCacheSafeParams(context)`
- `querySource: 'auto_dream'`
- `forkLabel: 'auto_dream'`
- `skipTranscript: true`
- `overrides: { abortController }`

这里有两个重要含义：

- 它想共享主线程 prompt cache
- 它不想为这个 background maintenance fork 单独记录 sidechain transcript

所以 auto-dream 的持久化产品面是 `DreamTask + memory files`，不是一条可恢复的 agent transcript。

## 13. tool 权限不是梦游式放开，而是复用 auto-memory 的最小 allowlist

源码镜像：[`../../src/services/extractMemories/extractMemories.ts`](../../src/services/extractMemories/extractMemories.ts)

`createAutoMemCanUseTool(memoryDir)` 被 extract-memories 和 auto-dream 共用，允许的只有：

- `REPL`
- `FileRead`
- `Grep`
- `Glob`
- read-only `Bash`
- `FileEdit / FileWrite` 但目标必须在 auto-memory path 内

也就是说，dream 的 fork 虽然在做“记忆整理”，但并没有获得通用写权限。它能修改的只有 memory 目录，而且 shell 只允许只读探索。

## 14. REPL 被放行不是放宽权限，而是为了保持工具表 cache-identical

源码镜像：[`../../src/services/extractMemories/extractMemories.ts`](../../src/services/extractMemories/extractMemories.ts)

注释明确说明：

- ant-default 下 primitive tools 可能隐藏在 REPL 后面
- REPL 内层每次 primitive 调用仍会重新过 `canUseTool`
- 如果 fork 改了 tool list，会破坏 prompt cache sharing

因此允许 `REPL` 的真正目的不是给 dream 更多能力，而是让 fork 的 tool face 和 parent 足够一致，从而保住 cache。

## 15. progress watcher 只消费 assistant message，并把它压成 `text + toolUseCount + touchedPaths`

源码镜像：[`../../src/services/autoDream/autoDream.ts`](../../src/services/autoDream/autoDream.ts)

`makeDreamProgressWatcher(...)` 的逻辑很克制：

- 非 `assistant` message 直接跳过
- `text` block 直接拼接
- `tool_use` 只累计数量
- 只有 `FILE_EDIT` / `FILE_WRITE` 才尝试提取 `file_path`

最后写回：

- `{ text: text.trim(), toolUseCount }`
- `touchedPaths`

所以 detail 页之所以只看到“最近几段文本 + 每轮几个工具”，不是前台懒，而是 watcher 一开始就只生产这么粗的摘要。

## 16. completion surface 是“双收尾”：任务终态 + 主 transcript 的 memory-saved system message

源码镜像：[`../../src/services/autoDream/autoDream.ts`](../../src/services/autoDream/autoDream.ts)

fork 成功后会先：

- `completeDreamTask(taskId, setAppState)`

然后再看：

- `appendSystemMessage` 是否存在
- `dreamState.filesTouched.length > 0`

若满足，就往主 transcript 里注入：

- `createMemorySavedMessage(dreamState.filesTouched)`
- 但把 `verb` 改成 `Improved`

因此用户看见的完成面是两层：

- 后台任务从 running 变 completed
- 主会话再插入一条 “Improved memories” 风格的 system note

## 17. failure 和 user-kill 会被刻意分流，避免双重 rollback

源码镜像：[`../../src/services/autoDream/autoDream.ts`](../../src/services/autoDream/autoDream.ts)

异常路径里先看：

- `abortController.signal.aborted`

如果是用户从后台面板杀掉：

- `DreamTask.kill()` 已经做了状态更新
- 也已经做了 `rollbackConsolidationLock(priorMtime)`

这时 `autoDream.ts` 会直接返回，不再：

- `failDreamTask(...)`
- 再次 rollback

所以 dream 的 kill path 被设计成“任务宿主负责善后，runner 负责识别并让路”。

## 18. dream 真正成为一等后台任务，是因为它正式注册进 `getAllTasks()`

源码镜像：[`../../src/tasks.ts`](../../src/tasks.ts)

`getAllTasks()` 里直接包含：

- `LocalShellTask`
- `LocalAgentTask`
- `RemoteAgentTask`
- `DreamTask`

workflow 和 monitor 还是 feature-gated push 进去，而 dream 是基础任务表的一部分。这就是为什么它能自然出现在：

- footer pill
- `Shift+Down` 背景任务列表
- `DreamDetailDialog`

它不是借壳显示，而是 task registry 里的正式成员。

## 19. 这篇和 `38`、`12`、`35` 的边界

`38` 讲的是：

- dream 在 detail 面上如何被观察

这一篇讲的是：

- dream 何时触发
- 怎么争锁
- 如何 fork
- 如何把进度压缩成 task state
- 如何把完成结果回写到主 transcript

`12` 讲的是：

- memdir 和 session memory 的更大机制面

`35` 继续讲的是：

- workflow/monitor 在 task framework 和 operator console 里的更一般运行时

也就是说，`60` 是 dream 专属的执行桥，把 memory-maintenance sidecar 和 task-surfacing shell 真正接起来。
