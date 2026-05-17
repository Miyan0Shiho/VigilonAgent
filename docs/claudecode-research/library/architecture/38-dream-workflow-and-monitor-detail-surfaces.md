# Dream / Workflow / Monitor Detail Surfaces

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Shell / Agent / Teammate Detail Dialog Family`](./37-shell-agent-and-teammate-detail-dialog-family.md) | [`下一站：Auto-Dream Gating / Forked Agent / Task Surfacing Runtime`](../mechanisms/60-auto-dream-gating-forked-agent-and-task-surfacing-runtime.md)

`BackgroundTasksDialog` 在 detail 层并不只承认 shell、local agent 和 teammate。当前镜像里还能明确看到另一组 detail family：

- `components/tasks/DreamDetailDialog.tsx`
- `components/tasks/WorkflowDetailDialog.tsx` 的调用 contract
- `components/tasks/MonitorMcpDetailDialog.tsx` 的调用 contract

但这三者的可见性并不对称。`DreamDetailDialog` 的主体源码在镜像里存在，可以拆到实现级；`WorkflowDetailDialog` 和 `MonitorMcpDetailDialog` 的主体文件当前没有挂载，只能拆到 `BackgroundTasksDialog` 暴露出来的 contract 层。这一卷因此故意分成“可完整下钻的 dream”和“只写可证接缝的 workflow/monitor”两部分。

## 1. `BackgroundTasksDialog` 继续按宿主硬分叉，dream/workflow/monitor 都不是“通用 task detail”

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

在 `viewState.mode === 'detail'` 的分支里，当前镜像能直接看见：

- `local_workflow -> WorkflowDetailDialog`
- `monitor_mcp -> MonitorMcpDetailDialog`
- `dream -> DreamDetailDialog`

这说明 detail 层的抽象单位从来不是“任务对象”，而是“任务宿主类型”。`dream` 被当作 memory-consolidation host，`workflow` 被当作 orchestration host，`monitor_mcp` 被当作 observe/stop host。

## 2. `WorkflowDetailDialog` 和 `MonitorMcpDetailDialog` 在当前镜像里只有 contract，可见性必须诚实降级

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

当前镜像里能看见：

- `require('./WorkflowDetailDialog')`
- `require('./MonitorMcpDetailDialog')`
- `killWorkflowTask`
- `skipWorkflowAgent`
- `retryWorkflowAgent`
- `killMonitorMcp`

但对应的 `WorkflowDetailDialog.tsx` 和 `MonitorMcpDetailDialog.tsx` 主体文件并未挂载。这里能被确认的只有：

- workflow detail 至少承认 `workflow`、`onDone`、`onKill`、`onSkipAgent`、`onRetryAgent`、`onBack`
- monitor detail 至少承认 `task`、`onKill`、`onBack`
- 两者都经过 feature gate 才会 materialize：
  - `WORKFLOW_SCRIPTS`
  - `MONITOR_TOOL`

所以这两条链当前只能写成“detail surface contract 已可见，body 缺失”。不能把它们硬装成已经掌握内部布局。

## 3. `DreamDetailDialog` 的标题直接暴露了它的产品语义：它不是 dream 聊天窗口，而是 memory consolidation 观察面

源码镜像：[`../../src/components/tasks/DreamDetailDialog.tsx`](../../src/components/tasks/DreamDetailDialog.tsx)

这份 dialog 的标题被硬编码成：

- `Memory consolidation`

副标题则拼成：

- elapsed time
- `reviewing N session(s)`
- 可选的 `M files touched`

也就是说，dream detail 从标题层就不承认“这是一名普通 subagent”，而是明确把它产品化成“记忆整合过程”的 operator surface。

## 4. dream detail 仍共享 detail family 的 modal grammar，但动作更克制

源码镜像：[`../../src/components/tasks/DreamDetailDialog.tsx`](../../src/components/tasks/DreamDetailDialog.tsx)

它继续复用 detail family 共有的外壳协议：

- 外层 `Box(tabIndex=0, autoFocus, onKeyDown=...)`
- 内层 `Dialog`
- `confirm:yes -> onDone`
- `Esc/Enter/Space` 关闭
- `←` 返回 list

但它的运行时动作比 teammate/workflow 更克制：

- 只有 running 时才暴露 `x = stop`
- 没有 `f = foreground`
- 没有 `skip/retry agent`

这说明 dream detail 被建模成“后台 consolidation 观察面”，不是可深度操纵的 orchestration console。

## 5. dream transcript 不是完整消息流，而是“只保留有文字的最近若干 assistant turn”

源码镜像：

- [`../../src/components/tasks/DreamDetailDialog.tsx`](../../src/components/tasks/DreamDetailDialog.tsx)
- [`../../src/tasks/DreamTask/DreamTask.ts`](../../src/tasks/DreamTask/DreamTask.ts)

这条链有几层明确裁剪：

- `DreamTask` 只记录 `DreamTurn = { text, toolUseCount }`
- prompt 不进入 `turns`
- `DreamDetailDialog` 先 `filter(t => t.text !== '')`
- `VISIBLE_TURNS = 6`
- 更早的内容只显示成 `(N earlier turns)`

因此 dream detail 不是 transcript viewer，而是“近期文字输出摘要面”。只有非空文本 turn 才有资格成为可见历史。

## 6. tool use 在 dream detail 里被折叠成计数，而不是 activity timeline

源码镜像：[`../../src/components/tasks/DreamDetailDialog.tsx`](../../src/components/tasks/DreamDetailDialog.tsx)

每条可见 turn 底下最多只会再追加：

- `(N tool(s))`

它不会像 async agent detail 那样渲染 `recentActivities`，也不会像 shell detail 那样看输出文件。dream detail 承认的最细 tool 粒度只是“这一轮用了几个工具”。这与它的产品角色一致：用户关心的是 consolidation 是否在推进，而不是每次 Edit/Write 的逐条活动。

## 7. `DreamTask` 本体明确声明：这是 UI surfacing shell，不是 dream agent 本身

源码镜像：[`../../src/tasks/DreamTask/DreamTask.ts`](../../src/tasks/DreamTask/DreamTask.ts)

文件头注释已经把边界写死了：

- 这是 auto-dream 的 background task entry
- 目标是把原本不可见的 forked agent 显性化到 footer pill 和后台列表
- dream agent 本身没有被改写，这里只是任务注册与 UI surfacing

这很关键。它说明 dream detail 不是“记忆系统主体实现”，而是记忆系统给 TUI 暴露出的观测壳。

## 8. dream phase 被故意压缩成两态：`starting -> updating`

源码镜像：[`../../src/tasks/DreamTask/DreamTask.ts`](../../src/tasks/DreamTask/DreamTask.ts)

`DreamTask` 明确没有去解析 dream prompt 的完整四阶段结构。它只保留：

- `starting`
- `updating`

转折条件也很直接：

- 第一次观察到新的 `Edit/Write` 触碰路径，就把 phase 翻到 `updating`

所以 dream detail 里显示的 phase 不是真实 cognitive stage，而是 UI 足够用的最小状态词表。

## 9. `filesTouched` 是“至少这些文件被碰过”，不是精确改动清单

源码镜像：[`../../src/tasks/DreamTask/DreamTask.ts`](../../src/tasks/DreamTask/DreamTask.ts)

`filesTouched` 的注释已经明确给出限制：

- 只从匹配到的 `Edit/Write tool_use` 中提取
- bash-mediated 写入会漏掉
- 它表示的是 `at least these were touched`

因此 dream detail 副标题里的 `M files touched` 只是下界，不是审计真相。这点必须和 shell detail 的 output-tail 不完整性一样，被当成 surface contract 的一部分。

## 10. dream 在列表面和 detail 面刻意用两种不同密度表达同一状态

源码镜像：

- [`../../src/components/tasks/BackgroundTask.tsx`](../../src/components/tasks/BackgroundTask.tsx)
- [`../../src/components/tasks/DreamDetailDialog.tsx`](../../src/components/tasks/DreamDetailDialog.tsx)

列表行的 dream 语法是：

- `description · phase · N session(s)` 或 `N file(s) · done/unread`

detail 页则升级成：

- elapsed time
- reviewing N sessions
- files touched
- 最近 turn 摘要

也就是说，dream surface 明确是双层压缩：

- list 只给 operator 一眼判断
- detail 才给最近 consolidation 过程

## 11. dream 的 stop 语义和普通 kill 不同：它还要回滚 consolidation lock

源码镜像：[`../../src/tasks/DreamTask/DreamTask.ts`](../../src/tasks/DreamTask/DreamTask.ts)

`DreamTask.kill(...)` 做的不是普通终止：

- `abortController.abort()`
- 任务状态改成 `killed`
- 若有 `priorMtime`，再 `rollbackConsolidationLock(priorMtime)`

这说明 dream 的 `x` 不是“停掉一个后台聊天”。它还承担记忆 consolidation 锁的恢复语义，确保下一次 session 还能重新尝试。

## 12. workflow detail 的 contract 明确暴露了“多 agent orchestration”才是它的宿主真相

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

即使主体文件缺失，当前 contract 也已经能说明两件事：

- `onSkipAgent(agentId)` 和 `onRetryAgent(agentId)` 是一级动作
- `workflow={task}` 而不是 generic `task={task}`

这表示 workflow detail 承认的核心对象不是单个后台任务，而是“一个带 agent 子单元的 orchestration host”。它和 shell/agent/dream 这种单宿主 detail 是不同建模层级。

## 13. monitor detail 的 contract 明确更窄：它更像 observe/stop surface，而不是 agent orchestration console

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

`MonitorMcpDetailDialog` 当前可见的 contract 只有：

- `task`
- `onKill`
- `onBack`

没有 `skipAgent`
没有 `retryAgent`
没有 foreground handoff

这说明 monitor detail 至少在当前产品面上被视为“看状态、必要时停掉”的较窄控制面，而不是 workflow 那种多 agent orchestration detail。

## 14. 这篇和 `37`、`35` 的边界

`37` 讲的是：

- shell / local agent / in-process teammate 三类已完整可见的 local detail family

这一篇讲的是：

- dream 这条完整可见但语义特殊的 consolidation detail
- workflow / monitor 这两条当前只拿到 contract 的 detail surface

`35` 继续往下讲的是：

- workflow / monitor 在后台控制台和 task framework 里的事件、状态文法和 operator surface 接缝

也就是说，`38` 的重点不是执行内核，而是把 detail-family 里最后这组异构宿主收口，并把“可见主体”和“仅可见 contract”明确分层。
