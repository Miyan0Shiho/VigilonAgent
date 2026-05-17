# Coordinator / Spinner Tree / Teammate View Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Task Status / Footer Surfaces`](./20-task-status-and-footer-surfaces.md) | [`下一站：Teammate Selection / Preview / Expanded View Protocol`](./22-teammate-selection-preview-and-expanded-view-protocol.md)

本文继续下钻任务前台，但不再讲 footer 词表或后台任务列表，而是专门拆“leader 与 teammate 之间如何切视图、coordinator panel 如何保活本地 agent、spinner tree 为什么和 footer pills 分治”这条运行时：`CoordinatorAgentStatus.tsx`、`Spinner.tsx`、`Spinner/TeammateSpinnerTree.tsx`、`PromptInputFooterLeftSide.tsx`、`state/teammateViewHelpers.ts`。

## 1. 这层解决的是“多 agent 前台如何被操纵”，不是 task 如何被创建

源码镜像：[`../../src/components/CoordinatorAgentStatus.tsx`](../../src/components/CoordinatorAgentStatus.tsx), [`../../src/components/Spinner.tsx`](../../src/components/Spinner.tsx), [`../../src/components/Spinner/TeammateSpinnerTree.tsx`](../../src/components/Spinner/TeammateSpinnerTree.tsx), [`../../src/components/PromptInput/PromptInputFooterLeftSide.tsx`](../../src/components/PromptInput/PromptInputFooterLeftSide.tsx), [`../../src/state/teammateViewHelpers.ts`](../../src/state/teammateViewHelpers.ts)

前面几卷已经把这些层拆开：

- task 联合类型与列表工作面
- footer status 词法与 pill 压缩
- swarm teammate 身份、spawn、permission bridge

这一层继续回答的是更前台的问题：

- 为什么有些 agent 出现在后台任务列表，有些出现在 coordinator panel
- leader transcript 和 teammate transcript 如何前后台切换
- spinner tree 和 footer pills 为什么不能同时当主 surface
- `expandedView`、`viewSelectionMode`、`viewingAgentTaskId` 怎样共同决定当前可见交互面

所以它是 task/team 前台编排层，不是执行层。

## 2. `CoordinatorTaskPanel` 说明 panel-managed local agent 是一条独立于 background tasks 的工作面

源码镜像：[`../../src/components/CoordinatorAgentStatus.tsx`](../../src/components/CoordinatorAgentStatus.tsx), [`../../src/tasks/LocalAgentTask/LocalAgentTask.tsx`](../../src/tasks/LocalAgentTask/LocalAgentTask.tsx)

`CoordinatorTaskPanel` 只看一类任务：

- `isPanelAgentTask(t)`
- `t.evictAfter !== 0`

它不复用通用后台任务列表，而是直接在 prompt footer 下方渲染一套可 steer 的 agent 行。这说明 panel-managed `local_agent` 被当成一种“当前主操控区附近的 agent surface”，而不是普通后台任务。

## 3. `getVisibleAgentTasks()` 说明可见性不是 UI 即时判断，而是被提升成共享过滤协议

源码镜像：[`../../src/components/CoordinatorAgentStatus.tsx`](../../src/components/CoordinatorAgentStatus.tsx)

这个 helper 同时服务：

- panel 渲染
- `useCoordinatorTaskCount()`
- 索引/选中边界解析

规则很简单：

- 只取 panel agent
- 过滤 `evictAfter === 0`
- 按 `startTime` 排序

这说明 coordinator panel 的“谁还在列表里”不是散在多个组件里的局部判断，而是一个共享可见性协议。

## 4. `evictAfter` 说明 panel row 的生命周期被设计成“可 linger 的 stub”，不是任务一结束就消失

源码镜像：[`../../src/components/CoordinatorAgentStatus.tsx`](../../src/state/teammateViewHelpers.ts)

这里有三种状态：

- `undefined`：运行中或被 retain，持续显示
- 时间戳：终态后短暂保留，等待 grace period 过期
- `0`：立刻隐藏

再加上 `CoordinatorTaskPanel` 内部的 1 秒 tick 会调用 `evictTerminalTask(...)`，说明 panel row 生命周期是显式建模的，而不是“task 终止 = React 消失”。

## 5. `MainLine` 和 `AgentLine` 说明 coordinator panel 本质上编码了 leader/main 与 agent transcript 的双向导航

源码镜像：[`../../src/components/CoordinatorAgentStatus.tsx`](../../src/state/teammateViewHelpers.ts)

`MainLine` 点击走：

- `exitTeammateView(setAppState)`

`AgentLine` 点击走：

- `enterTeammateView(task.id, setAppState)`

并且二者都带：

- `isSelected`
- `isViewed`
- hover/highlight

这说明 panel 不是静态状态板，而是 transcript foreground router。

## 6. `AgentLine` 说明 coordinator panel 讲的是“agent work summary”，不是 transcript 原文

源码镜像：[`../../src/components/CoordinatorAgentStatus.tsx`](../../src/components/CoordinatorAgentStatus.tsx), [`../../src/ink/stringWidth.ts`](../../src/ink/stringWidth.ts)

每一行拼装的信息包括：

- agent 名称
- `progress.summary || task.description`
- elapsed time
- token count
- queued message count
- `x to stop/clear` hint

再通过 `stringWidth` 和 `wrapText(..., "truncate-end")` 按终端宽度裁剪描述。这说明 panel 行是 agent 摘要卡片，不是 message 流缩略图。

## 7. `enterTeammateView()` 说明切到 teammate transcript 的关键副作用不是“只改一个 selected id”

源码镜像：[`../../src/state/teammateViewHelpers.ts`](../../src/state/teammateViewHelpers.ts)

它至少会做三件事：

- 设置 `viewingAgentTaskId`
- 设置 `viewSelectionMode: "viewing-agent"`
- 对 `local_agent` 设 `retain: true` 并清掉 `evictAfter`

如果此前已经在看另一个 retained local agent，还会把上一个 release 回 stub。这说明 foreground teammate view 会改变任务对象本身的驻留策略，而不只是切 UI 焦点。

## 8. `release()` 说明 teammate transcript 退出后不会保留完整内存态，而是回退成 stub 任务对象

源码镜像：[`../../src/state/teammateViewHelpers.ts`](../../src/state/teammateViewHelpers.ts)

`release(task)` 会：

- `retain: false`
- `messages: undefined`
- `diskLoaded: false`
- 如果已终态则设置新的 `evictAfter`

这说明 Claude Code 对本地 agent transcript 用的是“按需提升为 retained full view，退出后回退为 stub”的策略，避免长期挂住完整消息体。

## 9. `exitTeammateView()` 和 `stopOrDismissAgent()` 说明 foreground transcript 与 row 生命周期是耦合治理的

源码镜像：[`../../src/state/teammateViewHelpers.ts`](../../src/state/teammateViewHelpers.ts)

`exitTeammateView()` 会：

- 清掉 `viewingAgentTaskId`
- 设 `viewSelectionMode: "none"`
- 如当前任务是 retained local agent，则 release

`stopOrDismissAgent()` 则区分：

- running -> `abortController?.abort()`
- terminal -> `evictAfter = 0`
- 如果正在看这个 agent，还要同时退回 leader

这说明“x 键停止/清除 agent”与“当前看谁的 transcript”是同一状态机里的两个面，而不是彼此独立。

## 10. `SpinnerWithVerbInner` 说明 spinner 不是纯动画，而是 task/team 前台路由器

源码镜像：[`../../src/components/Spinner.tsx`](../../src/components/Spinner.tsx), [`../../src/state/selectors.ts`](../../src/state/selectors.ts)

这个组件会同时读：

- `tasks`
- `viewingAgentTaskId`
- `expandedView`
- `selectedIPAgentIndex`
- `viewSelectionMode`
- `foregroundedTeammate`

它不是只算 spinner 文案，而是在决定：

- 显示普通 spinner
- 显示静态 idle 行
- 显示 `TeammateSpinnerTree`
- 显示 `TaskListV2`

所以 spinner 这一层其实承担了多任务前台的分发逻辑。

## 11. `expandedView` 说明 footer / spinner / task list 之间有一个显式三态工作面切换器

源码镜像：[`../../src/components/Spinner.tsx`](../../src/components/PromptInput/PromptInputFooterLeftSide.tsx)

当前可见分叉核心是：

- `expandedView === "none"`
- `expandedView === "tasks"`
- `expandedView === "teammates"`

其中：

- `"tasks"` -> `TaskListV2`
- `"teammates"` -> `TeammateSpinnerTree`
- `"none"` -> 普通 spinner + footer 压缩 surface

这说明 Claude Code 没把所有任务控制面都堆进一个底栏，而是做了一个显式展开模式机。

## 12. `leaderIsIdle + teammates running` 的分支说明 leader spinner 和 swarm spinner 语义必须拆开

源码镜像：[`../../src/components/Spinner.tsx`](../../src/components/Spinner.tsx)

当：

- leader 已 idle
- teammates 仍在跑
- 当前看的是 leader

组件不会继续播 leader 的动画 spinner，而是改成：

- 一行静态 `Idle`
- 可选的 `· teammates running`
- 再挂 `TeammateSpinnerTree`

原因源码里写得很直白：否则 stall 检测会把 leader 看起来像“卡住变红”。这说明多 agent 模式下，leader 与 teammates 的活跃语义必须拆分展示。

## 13. `foregroundedTeammate?.isIdle` 的特殊分支说明 teammate transcript 前台也要避免假忙动画

源码镜像：[`../../src/components/Spinner.tsx`](../../src/components/Spinner.tsx), [`../../src/components/Spinner/TeammateSpinnerTree.tsx`](../../src/components/Spinner/TeammateSpinnerTree.tsx)

如果当前前台 teammate 已 idle，就直接显示：

- `Worked for ...`
- 或 `Idle`

必要时仍挂 spinner tree。也就是说，teammate foreground 后不是继续复用 leader 的 thinking spinner，而是切到 teammate 语义。

## 14. `TeammateSpinnerTree` 说明 teammate 展示面不是 pill 列表放大版，而是一棵可导航的树

源码镜像：[`../../src/components/Spinner/TeammateSpinnerTree.tsx`](../../src/components/Spinner/TeammateSpinnerTree.tsx), [`../../src/tasks/InProcessTeammateTask/InProcessTeammateTask.tsx`](../../src/tasks/InProcessTeammateTask/InProcessTeammateTask.tsx)

它先构造：

- 一个 `team-lead` 顶行
- 多个 running teammate 行
- 选择模式下额外的 `hide` 行

并显式维护：

- `selectedIndex`
- `isInSelectionMode`
- `viewingAgentTaskId`
- `allIdle`

这说明 spinner tree 是一个键盘导航树，而不是视觉上长得像树的列表。

## 15. `selectedIndex === -1` 和 `selectedIndex === teammateTasks.length` 说明这棵树把 leader 与 collapse 都编码成一等节点

源码镜像：[`../../src/components/Spinner/TeammateSpinnerTree.tsx`](../../src/components/Spinner/TeammateSpinnerTree.tsx)

这里的索引语义是：

- `-1` -> leader
- `0...n-1` -> teammate rows
- `n` -> hide row

这说明 tree 不是只遍历 teammate 数组，而是把“回 leader”和“折叠树”都纳入同一光标系统。

## 16. `TEAMMATE_SELECT_HINT`、`enter to view`、`enter to collapse` 说明 tree 的第一职责是 steer，不是摘要

源码镜像：[`../../src/components/Spinner/TeammateSpinnerTree.tsx`](../../src/components/Spinner/teammateSelectHint.ts)

leader 行和 hide 行都会直接提示：

- 如何选择
- 如何进入 teammate view
- 如何折叠 tree

这说明 spinner tree 的主要价值不是多显示几个状态，而是把 swarm 交互正式拉进当前 turn 的键盘工作流。

## 17. `PromptInputFooterLeftSide` 说明 footer 不是单一 byline，而是多 surface 汇流器

源码镜像：[`../../src/components/PromptInput/PromptInputFooterLeftSide.tsx`](../../src/components/PromptInput/PromptInputFooterLeftSide.tsx), [`../../src/components/tasks/BackgroundTaskStatus.tsx`](../../src/components/tasks/BackgroundTaskStatus.tsx)

这一层同时判断：

- `hasBackgroundTasks`
- `hasInProcessTeammates`
- `hasTeammatePills`
- `hasTeams`
- `showSpinnerTree`
- `hasCoordinatorTasks`

然后决定：

- `BackgroundTaskStatus` 单独一行
- `Byline` 是否显示提示
- tasks pill 是否整体隐藏
- coordinator panel 是否追加 `↓ to manage tasks`

这说明 footer 左侧其实是 task/team surface 的总协商点。

## 18. `hasTeammatePills` 与 `showSpinnerTree` 的互斥说明 teammate pills 和 spinner tree 是两种互斥主表面

源码镜像：[`../../src/components/PromptInput/PromptInputFooterLeftSide.tsx`](../../src/components/PromptInput/PromptInputFooterLeftSide.tsx), [`../../src/components/tasks/taskStatusUtils.tsx`](../../src/components/tasks/taskStatusUtils.tsx)

源码里明确写了两层规则：

- spinner-tree mode 下 pills 禁用
- `shouldHideTasksFooter(tasks, showSpinnerTree)` 满足时 footer 直接隐藏

也就是说：

- 压缩模式 -> footer pills
- 展开 teammate 模式 -> spinner tree

Claude Code 没有让二者同时争夺主可见性。

## 19. 这条链最终说明 Claude Code 的多 agent 前台不是“任务列表”，而是三套协同 surface

源码镜像：[`../../src/components/CoordinatorAgentStatus.tsx`](../../src/components/CoordinatorAgentStatus.tsx), [`../../src/components/Spinner.tsx`](../../src/components/Spinner.tsx), [`../../src/components/PromptInput/PromptInputFooterLeftSide.tsx`](../../src/components/PromptInput/PromptInputFooterLeftSide.tsx), [`../../src/state/teammateViewHelpers.ts`](../../src/state/teammateViewHelpers.ts)

真正协同工作的不是一个大列表，而是三套表面：

- coordinator panel：panel-managed local agent 的 steerable row
- footer pills：压缩态的 teammate/background summary
- spinner tree：展开态的 running teammate 树

再加上一条共享 transcript 切换协议：

- `viewingAgentTaskId`
- `viewSelectionMode`
- `retain / release / evictAfter`

所以“leader 与 teammates 如何共存”在 Claude Code 里并不是单个组件解决的，而是一条跨 panel、spinner、footer、state helper 的前台运行时。

## 20. 对阅读这套库的意义：这一卷是 swarm UI 和 task UI 之间的接缝页

如果你刚读完前几卷，最容易混淆的是：

- [architecture/19-background-task-aggregation-and-list-runtime.md](./19-background-task-aggregation-and-list-runtime.md) 讲的是后台任务如何被联合显示
- [architecture/20-task-status-and-footer-surfaces.md](./20-task-status-and-footer-surfaces.md) 讲的是状态词法和 footer 压缩
- [mechanisms/16-swarm-teammates-and-permission-bridges.md](../mechanisms/16-swarm-teammates-and-permission-bridges.md) 讲的是 teammate runtime、mailbox 和 permission bridge

这一卷位于它们之间，专门讲前台如何把这些机制编排成“可看、可切、可退回 leader”的真实操作面。
