# TaskListV2 / Priority / Blockers / Rendering Protocol

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Task Visibility / Footer / Spinner Cross-Layer Runtime`](./28-task-visibility-footer-and-spinner-cross-layer-runtime.md) | [`下一站：Task Language / Spinner Narration / Feedback Loop`](./30-task-language-and-spinner-narration-feedback-loop.md)

本文继续沿任务前台往下钻，但不再讲“任务该显示在哪”，而是专门讲 `TaskListV2` 本身：展开任务以后，到底按什么优先级排序、怎么保留最近完成项、blocker 如何压缩成 UI 语法、以及为什么同一个列表要同时服务 spinner 内联宿主和 REPL standalone 宿主。

## 1. `TaskListV2` 不是通用列表，而是 TodoV2 的专用可视化协议层

源码镜像：[`../../sources/claude-code/src/components/TaskListV2.tsx`](../../sources/claude-code/src/components/TaskListV2.tsx), [`../../sources/claude-code/src/utils/tasks.ts`](../../sources/claude-code/src/utils/tasks.ts), [`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx), [`../../sources/claude-code/src/components/Spinner.tsx`](../../sources/claude-code/src/components/Spinner.tsx)

`TaskListV2` 的输入非常克制：

- `tasks: Task[]`
- `isStandalone?: boolean`

但它隐含依赖的运行时语义很多：

- `Task.status` 只有 `pending / in_progress / completed`
- `Task.activeForm` 决定 spinner 主文案如何从任务板反哺到 leader verb
- `Task.blockedBy` 决定 pending 项是否应该后排
- `Task.owner` 可能映射到 swarm teammate 名称，也可能映射到 agentId

所以它不是“把 task JSON 打出来”，而是 TodoV2 的视觉压缩层。

## 2. `TaskListV2` 先受两个总 gate 约束：功能开关和空列表

源码镜像：[`../../sources/claude-code/src/components/TaskListV2.tsx`](../../sources/claude-code/src/components/TaskListV2.tsx), [`../../sources/claude-code/src/utils/tasks.ts`](../../sources/claude-code/src/utils/tasks.ts)

这层最外面有两个硬门：

- `!isTodoV2Enabled() -> null`
- `tasks.length === 0 -> null`

也就是说：

- 即使 `expandedView === 'tasks'`
- 如果 TodoV2 没开，或者共享 store 已经把列表清成空

`TaskListV2` 自己不会兜底渲染任何占位。

这和上一卷的结论一致：显示模式和数据存在性是两层不同 gate。

## 3. 最近完成任务会被保留 30 秒，这不是排序细节，而是“短暂 linger”协议

源码镜像：[`../../sources/claude-code/src/components/TaskListV2.tsx`](../../sources/claude-code/src/components/TaskListV2.tsx)

`TaskListV2` 自己维护了一套局部状态：

- `RECENT_COMPLETED_TTL_MS = 30_000`
- `completionTimestampsRef`
- `previousCompletedIdsRef`

逻辑不是“completed 一直排前面”，而是：

- 只有刚从非 completed 转成 completed 的任务
- 才被打上一个 timestamp
- 并在接下来 30 秒内视为 `recentCompleted`

之后它还会：

- 找到最早过期的那一项
- `setTimeout(forceUpdate, expiry - now)`

所以这不是静态排序，而是一条显式的 render-time linger lifecycle。它的目标很明显：刚完成的任务不要瞬间沉底，让用户在短时间窗口内还能看到“刚刚收掉了什么”。

## 4. 列表长度过长时，优先级不是简单的 status 排序，而是四段优先级管线

源码镜像：[`../../sources/claude-code/src/components/TaskListV2.tsx`](../../sources/claude-code/src/utils/tasks.ts)

当 `tasks.length > maxDisplay` 时，`TaskListV2` 不会直接按 status sort，而是拆成四段：

- `recentCompleted`
- `inProgress`
- `pending`
- `olderCompleted`

最终顺序是：

1. 最近完成
2. 正在进行
3. 待处理
4. 较早完成

这比一般任务板更偏“刚刚发生了什么 + 现在正在做什么”。它不是项目管理式总览，而是终端里的一次短时态工作面。

## 5. pending 里还会再做一次 blocker-aware 重排，说明 blocked 任务不应挤占前排

源码镜像：[`../../sources/claude-code/src/components/TaskListV2.tsx`](../../sources/claude-code/src/utils/tasks.ts)

在 pending 段内部，排序规则又分成两层：

- 先判断 `blockedBy.some(id => unresolvedTaskIds.has(id))`
- 无 blocker 的 pending 在前
- 有 blocker 的 pending 在后
- 同层再按 `byIdAsc`

这和 `utils/tasks.ts` 里 `claimTask()` / `claimTaskWithBusyCheck()` 的语义是严格对齐的：

- unresolved task 会真正阻塞 claim
- 所以 UI 也不该把被阻塞项和可立即开工项混成同一优先级

因此 `TaskListV2` 不是凭视觉偏好排序，而是在消费 claim-time truth。

## 6. `maxDisplay` 不是固定数，而是终端高度驱动的预算

源码镜像：[`../../sources/claude-code/src/components/TaskListV2.tsx`](../../sources/claude-code/src/components/TaskListV2.tsx), [`../../sources/claude-code/src/hooks/useTerminalSize.ts`](../../sources/claude-code/src/hooks/useTerminalSize.ts)

显示预算来自：

- `rows <= 10 -> 0`
- 否则 `min(10, max(3, rows - 14))`

这说明它不是“最多显示 10 项”这么简单，而是：

- 小终端直接不展开正文
- 正常终端至少保底 3 行
- 再封顶 10 行

也就是说，`TaskListV2` 自己就带 viewport budgeting，而不是把滚动责任完全甩给外层。

## 7. 超出预算的任务不会直接消失，而是被压缩成 `hiddenSummary`

源码镜像：[`../../sources/claude-code/src/components/TaskListV2.tsx`](../../sources/claude-code/src/components/Spinner.tsx)

被截掉的任务会被重新统计成：

- `N in progress`
- `N pending`
- `N completed`

并拼成：

- `… +2 pending, 1 completed`

这层语法的意义是：

- spinner/standalone 宿主都能保留全局感知
- 但不用把所有任务都挤进一个很短的 bottom slot

所以 `hiddenSummary` 不是省略号，而是压缩后的状态分布摘要。

## 8. owner 颜色和 activity 文本不是从 task 本身拿，而是从 `AppState.tasks` 回填

源码镜像：[`../../sources/claude-code/src/components/TaskListV2.tsx`](../../sources/claude-code/src/components/TaskListV2.tsx), [`../../sources/claude-code/src/tasks/InProcessTeammateTask/types.ts`](../../sources/claude-code/src/tasks/InProcessTeammateTask/types.ts)

`TaskListV2` 自己会额外读：

- `teamContext.teammates`，构建 `teammateColors`
- `appState.tasks`，扫描 running `in_process_teammate`

然后建立两张表：

- `owner -> theme color`
- `owner/agentId -> current activity`

这里很关键的一点是：它同时映射

- `agentName`
- `agentId`

因为任务 owner 可能由模型写成任一格式。`TaskListV2` 在这里主动消解了模型输出不稳定性，而不是把格式兼容问题抛给别的层。

## 9. activity 只在 `in_progress 且未 blocked` 时显示，避免双重语义冲突

源码镜像：[`../../sources/claude-code/src/components/TaskListV2.tsx`](../../sources/claude-code/src/components/TaskListV2.tsx), [`../../sources/claude-code/src/utils/collapseReadSearch.ts`](../../sources/claude-code/src/utils/collapseReadSearch.ts)

`TaskItem` 对 activity 的 gate 非常严格：

- `isInProgress`
- `!isBlocked`
- `activity` 存在

才会渲染第二行：

- `  {displayActivity}…`

而 activity 文本本身不是原始 recent activity 列表，而是经过：

- `summarizeRecentActivities(...)`
- 或回退到 `lastActivity.activityDescription`

这说明 blocked 状态优先级高于“正在做什么”。一旦任务已被 blocker 压住，UI 就不再试图同时讲 activity，避免出现语义冲突。

## 10. `TaskItem` 的一行主语法其实编码了 status、owner、blockers 三层信息

源码镜像：[`../../sources/claude-code/src/components/TaskListV2.tsx`](../../sources/claude-code/src/components/TaskListV2.tsx), [`../../sources/claude-code/src/utils/theme.ts`](../../sources/claude-code/src/utils/theme.ts)

主行元素是：

- status icon
- `subject`
- optional `(@owner)`
- optional `blocked by #...`

每层还有自己的视觉规则：

- `completed`：`figures.tick` + `strikethrough`
- `in_progress`：filled square + `bold`
- `pending`：empty square
- `blocked`：整行 `dimColor`

所以 blocker 不是一个二级角标，而是会重写整条行的语义重心。

## 11. owner 只在宽终端且 owner 仍 active 时显示，说明这是“活体 owner 标签”不是历史归属

源码镜像：[`../../sources/claude-code/src/components/TaskListV2.tsx`](../../sources/claude-code/src/components/design-system/ThemedText.tsx)

owner 显示条件是：

- `columns >= 60`
- `task.owner`
- `ownerActive`

这意味着：

- 窄终端直接省掉 owner
- owner 已不再 active 的历史归属也省掉

所以 `(@owner)` 不是审计字段，而是当前协作态提示。它只在“对现在有帮助”时出现。

## 12. standalone 与 inline 宿主只有一层壳差异，但语义不同

源码镜像：[`../../sources/claude-code/src/components/TaskListV2.tsx`](../../sources/claude-code/src/screens/REPL.tsx), [`../../sources/claude-code/src/components/Spinner.tsx`](../../sources/claude-code/src/components/Spinner.tsx)

`isStandalone` 为真时：

- 外层加 `marginTop=1`
- `marginLeft=2`
- 额外渲染总头：
  - 总任务数
  - done 数
  - in progress 数
  - open 数

否则：

- 只渲染正文项

这意味着：

- REPL bottom standalone 版本承担“独立工作面”职责
- Spinner 里的 inline 版本只承担“工作中顺带展开”职责

同一组件服务两个宿主，但没有把宿主语义混在一起。

## 13. `TaskListV2` 和 spinner 主文案之间还有一条反向耦合：`activeForm ?? subject`

源码镜像：[`../../sources/claude-code/src/components/Spinner.tsx`](../../sources/claude-code/src/components/TaskListV2.tsx), [`../../sources/claude-code/src/utils/tasks.ts`](../../sources/claude-code/src/utils/tasks.ts)

Spinner 的 leader 文案优先级是：

- `overrideMessage`
- `currentTodo.activeForm`
- `currentTodo.subject`
- random verb

而 `TaskListV2` 本身负责把 `subject` 和 `status` 可视化出来。

这说明 TodoV2 不是只影响一个“展开列表”，它还通过 `activeForm` 反向影响主 spinner 文案。也就是说，任务系统已经部分接管了 Claude Code 的主工作叙述语言。

## 14. 结论：`TaskListV2` 是终端任务板的压缩引擎，不是普通列表组件

最关键的结论有这些：

- 它内建最近完成 TTL，提供短暂 linger
- 它按 `recentCompleted -> inProgress -> pending -> olderCompleted` 排序，不是普通 status sort
- 它用 unresolved blockers 重排 pending，并把 blocker 语义直接写进 row
- 它从 `AppState.tasks` 回填 owner activity，而不只信 task JSON
- 它区分 standalone 和 inline 两种宿主，避免语义混乱
- 它还通过 `activeForm` 间接影响 spinner 主文案

所以如果下一轮继续下钻，最自然的不是再写一个总览，而是二选一：

- 拆 `TaskListV2 + Spinner.findNextPendingTask + TaskCreate/Update activeForm` 这条“任务语言反哺 spinner”链
- 或拆 `footerSelection / coordinatorTaskIndex / expandedView / viewingAgentTaskId` 这条更纯的任务前台状态机
