# Task Status 与 Footer Surfaces

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Background Task Aggregation / List Runtime`](./19-background-task-aggregation-and-list-runtime.md) | [`下一站：Coordinator / Spinner Tree / Teammate View Runtime`](./21-coordinator-spinner-tree-and-teammate-view-runtime.md)

本文继续下钻后台任务前台，但不再讲列表/详情壳，而是专门拆“状态怎么被说出来、怎么被压缩成 footer、怎么在远端 review 上变成特殊视觉语言”这条显示链：`RemoteSessionProgress.tsx`、`ShellProgress.tsx`、`taskStatusUtils.tsx`、`BackgroundTaskStatus.tsx`。

## 1. 这层解决的是“任务状态的前台语言统一”，不是任务怎么执行

源码镜像：[`../../sources/claude-code/src/components/tasks/RemoteSessionProgress.tsx`](../../sources/claude-code/src/components/tasks/RemoteSessionProgress.tsx), [`../../sources/claude-code/src/components/tasks/ShellProgress.tsx`](../../sources/claude-code/src/components/tasks/ShellProgress.tsx), [`../../sources/claude-code/src/components/tasks/taskStatusUtils.tsx`](../../sources/claude-code/src/components/tasks/taskStatusUtils.tsx), [`../../sources/claude-code/src/components/tasks/BackgroundTaskStatus.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTaskStatus.tsx)

任务系统前面已经有：

- 后台任务联合类型
- list/detail 工作面
- footer pill 术语压缩

这一层继续解决更细的问题：

- 同一个状态在不同行里要用什么词
- 用什么 icon / 颜色表达
- 什么时候显示 `done`、`error`、`stopped`
- 什么时候变成 `◇ ultraplan`、彩虹 `ultrareview`
- footer 在 spinner tree / teammate foreground 时怎样切换成另一套 surface

所以它是任务前台语言层，不是 runtime 执行层。

## 2. `TaskStatusText` 说明基础状态语法先被压成一个最小原子组件

源码镜像：[`../../sources/claude-code/src/components/tasks/ShellProgress.tsx`](../../sources/claude-code/src/components/tasks/ShellProgress.tsx)

`TaskStatusText` 只有三个输入：

- `status`
- `label?`
- `suffix?`

但它统一了最基本的显示规则：

- `completed -> success`
- `failed -> error`
- `killed -> warning`
- 其他状态不强着色

并把输出固定成：

- `(label)`
- `(label, unread)`

这说明任务显示层最底下先定义了一个状态词法原子，再由不同任务类型组合。

## 3. `ShellProgress` 说明 shell 族的状态词表很克制，避免把终端任务说得过于花哨

源码镜像：[`../../sources/claude-code/src/components/tasks/ShellProgress.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTask.tsx)

`ShellProgress` 对 shell 只保留四种说法：

- `completed -> done`
- `failed -> error`
- `killed -> stopped`
- `running/pending -> running`

这说明 Claude Code 对 shell 的状态语言非常克制：不解释 stdout，不解释 phase，只给一个清晰的终态词，避免把最常见任务表面做复杂。

## 4. `taskStatusUtils.tsx` 是更上层的“语义解释器”，不是简单 helper 集

源码镜像：[`../../sources/claude-code/src/components/tasks/taskStatusUtils.tsx`](../../sources/claude-code/src/components/tasks/taskStatusUtils.tsx), [`../../sources/claude-code/src/components/tasks/BackgroundTaskStatus.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTaskStatus.tsx)

这里聚合了四类规则：

- `isTerminalStatus`
- `getTaskStatusIcon`
- `getTaskStatusColor`
- `describeTeammateActivity`
- `shouldHideTasksFooter`

这说明它不是普通工具杂项，而是一个明确的任务状态解释层，专门给多个前台 surface 提供统一语义。

## 5. `getTaskStatusIcon()` 说明 Claude Code 的任务状态 icon 优先级不是按 status 单字段决定的

源码镜像：[`../../sources/claude-code/src/components/tasks/taskStatusUtils.tsx`](../../sources/claude-code/src/components/tasks/taskStatusUtils.tsx)

它看的是：

- `hasError`
- `awaitingApproval`
- `shutdownRequested`
- `status`
- `isIdle`

优先级大致是：

- error
- awaiting approval
- shutdown requested
- running with idle special-case
- completed
- failed/killed

所以前台看到的 icon 并不是 `status -> icon` 的一元映射，而是一个带 override flag 的优先级语义树。

## 6. `getTaskStatusColor()` 和 `getTaskStatusIcon()` 是平行的语义层，而不是互相派生

源码镜像：[`../../sources/claude-code/src/components/tasks/taskStatusUtils.tsx`](../../sources/claude-code/src/utils/theme.ts)

颜色规则独立处理：

- error / failed -> `error`
- approval / killed / shutdown -> `warning`
- completed -> `success`
- idle / running -> `background`

这说明 Claude Code 没有把颜色死绑在 icon 上，而是允许：

- icon 传达动作语义
- color 传达风险/完成度语义

这是一个更稳定的前台信息层分工。

## 7. `describeTeammateActivity()` 说明 teammate 的“状态”并不是 running/idle 二元，而是多层后备的活动摘要

源码镜像：[`../../sources/claude-code/src/components/tasks/taskStatusUtils.tsx`](../../sources/claude-code/src/utils/collapseReadSearch.ts)

teammate 行文案的优先级是：

- `shutdownRequested -> stopping`
- `awaitingPlanApproval -> awaiting approval`
- `isIdle -> idle`
- `recentActivities -> summarizeRecentActivities(...)`
- `lastActivity.activityDescription`
- 最后回退 `working`

这说明 teammate 的前台状态词表比 shell 丰富很多，因为它承担的是 agent 过程解释，而不是单一命令执行状态。

## 8. `summarizeRecentActivities()` 的接入说明 teammate 前台已经在做活动压缩，不是原样打印 trace

源码镜像：[`../../sources/claude-code/src/components/tasks/taskStatusUtils.tsx`](../../sources/claude-code/src/utils/collapseReadSearch.ts)

这里不会把 `recentActivities` 原样列出来，而是先做摘要压缩。这说明 Claude Code 已经把 agent 进度前台化的难点当成“压缩成一句用户能扫读的话”，而不是“忠实显示内部事件流”。

## 9. `shouldHideTasksFooter()` 说明 footer 是否出现，本身也是一条状态协商规则

源码镜像：[`../../sources/claude-code/src/components/tasks/taskStatusUtils.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTaskStatus.tsx)

这个函数回答的问题不是“有没有任务”，而是：

- spinner tree 是否开启
- 所有可见后台任务是否都是 in-process teammates
- ant 环境里的 panel-managed agents 是否应该被排除

如果都满足，就直接隐藏 footer。

这说明 footer 不是永远出现的 global status bar，而是要与 spinner tree、coordinator/panel 等其他前台 surface 协调责任。

## 10. `BackgroundTaskStatus` 是真正把任务状态语言压进底部一行的 orchestrator

源码镜像：[`../../sources/claude-code/src/components/tasks/BackgroundTaskStatus.tsx`](../../sources/claude-code/src/tasks/pillLabel.ts), [`../../sources/claude-code/src/components/tasks/taskStatusUtils.tsx`](../../sources/claude-code/src/components/tasks/taskStatusUtils.tsx)

它负责整合：

- 当前运行中的 background tasks
- teammate foreground / leader view
- spinner tree 状态
- pill 术语压缩
- 横向滚动窗口
- `shift + ↓` CTA

也就是说，真正的 footer surface 不是 `pillLabel.ts`，而是这个 orchestrator 组件。

## 11. `BackgroundTaskStatus` 先区分“全部是 teammates 的 footer 模式”和“普通 summary pill 模式”

源码镜像：[`../../sources/claude-code/src/components/tasks/BackgroundTaskStatus.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTaskStatus.tsx)

它的第一层分叉是：

- `allTeammates`
- `isViewingTeammate`

如果满足这些条件，就不用普通 summary pill，而切到 agent pill 模式。否则才走：

- `SummaryPill`
- `getPillLabel(runningTasks)`

这说明 teammate 在 footer 里被当成另一种完全不同的交互模式，而不是 summary pill 上再贴个标签。

## 12. teammate footer pills 不是普通文本，而是可横向滚动、可点选、可区分 viewed/selected 的导航控件

源码镜像：[`../../sources/claude-code/src/components/tasks/BackgroundTaskStatus.tsx`](../../sources/claude-code/src/utils/horizontalScroll.ts), [`../../sources/claude-code/src/state/teammateViewHelpers.ts`](../../sources/claude-code/src/state/teammateViewHelpers.ts)

这一套 teammate pills 有：

- `name`
- `color`
- `isIdle`
- `taskId`
- `idx`

再加上：

- `selectedIdx`
- `viewedIdx`
- `calculateHorizontalScrollWindow(...)`
- 左右箭头

说明它本质上是一个压缩版 agent navigator，而不是简单 badge 列表。

## 13. main pill 的存在说明 footer 里不仅要能看 teammates，还要能回到 leader/main

源码镜像：[`../../sources/claude-code/src/components/tasks/BackgroundTaskStatus.tsx`](../../sources/claude-code/src/state/teammateViewHelpers.ts)

这里人为构造了：

- `mainPill`
  - `name: "main"`
  - `taskId: undefined`

然后在点击时：

- 有 `taskId` 就 `enterTeammateView`
- 没有就 `exitTeammateView`

所以 footer teammate 模式本质上编码了“leader/main 与 teammates 之间的双向跳转”。

## 14. `stringWidth` 和 `calculateHorizontalScrollWindow()` 说明 footer pill 的布局不是近似处理，而是按终端真实宽度做窗口裁剪

源码镜像：[`../../sources/claude-code/src/components/tasks/BackgroundTaskStatus.tsx`](../../sources/claude-code/src/ink/stringWidth.ts), [`../../sources/claude-code/src/utils/horizontalScroll.ts`](../../sources/claude-code/src/utils/horizontalScroll.ts)

teammate pills 会先测：

- 每个 `@name` 的真实宽度

再结合：

- 终端 `columns`
- 固定边距预算
- 当前选中索引

计算真正可见窗口。这说明 footer team navigator 不是“超长就截断”，而是一个受键盘选择驱动的横向滚动条。

## 15. `RemoteSessionProgress` 说明 remote session 的状态词表要比 shell 更有结构

源码镜像：[`../../sources/claude-code/src/components/tasks/RemoteSessionProgress.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTask.tsx)

它至少分成三条路径：

- `isRemoteReview`
  - 走 `ReviewRainbowLine`
- 普通 remote session
  - `completed -> done`
  - `failed -> error`
  - 有 todoList 时显示 `completed/total`
  - 否则显示 `status...`

这说明远端会话的前台状态语言不仅要表达终态，还要表达 todo completion 进度。

## 16. `formatReviewStageCounts()` 说明 ultrareview 已经有独立的“阶段词典”

源码镜像：[`../../sources/claude-code/src/components/tasks/RemoteSessionProgress.tsx`](../../sources/claude-code/src/components/tasks/RemoteSessionProgress.tsx)

它区分：

- `finding`
- `verifying`
- `synthesizing`

并明确规定：

- 用单词而不是 `✓/✗`
- `refuted` 为 0 时隐藏
- `synthesizing` 阶段显示 `deduping`

注释还说明这一行和 detail dialog 必须共享同一逻辑，防止不同 surface 用不同话术。这已经不是 UI 小细节，而是产品语言一致性约束。

## 17. `ReviewRainbowLine` 说明 ultrareview 被前台特判成“品牌化状态条”，而不是普通 progress label

源码镜像：[`../../sources/claude-code/src/components/tasks/RemoteSessionProgress.tsx`](../../sources/claude-code/src/components/tasks/RemoteSessionProgress.tsx), [`../../sources/claude-code/src/utils/thinking.ts`](../../sources/claude-code/src/utils/thinking.ts)

这里会：

- 用 `RainbowText("ultrareview")`
- 用 `useAnimationFrame(TICK_MS)`
- 用 phase 推动彩虹渐变流动

完成、失败、运行态各有不同文案：

- `ultrareview ready · shift+↓ to view`
- `ultrareview · error`
- `ultrareview · N found · M verified ...`

这说明 ultrareview 在前台上已经拥有独立视觉身份，而不是普通 remote task 的一个布尔分支。

## 18. `useSmoothCount()` 说明 review 数字前台化时，Claude Code 连“跳数动画”都做了专门控制

源码镜像：[`../../sources/claude-code/src/components/tasks/RemoteSessionProgress.tsx`](../../sources/claude-code/src/hooks/useSettings.ts)

`useSmoothCount(target, time, snap)` 的规则是：

- reduced motion 或非 running 时直接 snap
- target 增长时每 tick 只加 1
- target 回退时直接同步

这说明 review 统计不是收到新值就瞬间跳变，而是被当成一个需要可读性和动效节制的前台数字系统。

## 19. `BackgroundTaskStatus` + `pillNeedsCta()` 说明 footer CTA 也是受任务语义驱动的，不是固定提示

源码镜像：[`../../sources/claude-code/src/components/tasks/BackgroundTaskStatus.tsx`](../../sources/claude-code/src/tasks/pillLabel.ts)

summary pill 模式下，它只会在：

- `pillNeedsCta(runningTasks) === true`

时追加：

- `· ↓ to view`

而前面我们已经知道这只对某些 ultraplans attention state 成立。说明 footer CTA 是语义性提示，不是装饰性提示。

## 20. 这条状态显示链，本质上是 Claude Code 的“任务前台语言引擎”

源码镜像：[`../../sources/claude-code/src/components/tasks/RemoteSessionProgress.tsx`](../../sources/claude-code/src/components/tasks/RemoteSessionProgress.tsx), [`../../sources/claude-code/src/components/tasks/ShellProgress.tsx`](../../sources/claude-code/src/components/tasks/ShellProgress.tsx), [`../../sources/claude-code/src/components/tasks/taskStatusUtils.tsx`](../../sources/claude-code/src/components/tasks/taskStatusUtils.tsx), [`../../sources/claude-code/src/components/tasks/BackgroundTaskStatus.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTaskStatus.tsx)

把这几层连起来看：

- `ShellProgress.tsx` 定义最朴素的任务状态词表
- `taskStatusUtils.tsx` 定义跨任务共享的状态语义、icon、颜色和 teammate activity 摘要
- `RemoteSessionProgress.tsx` 给 remote/ultrareview 提供专属进度语言和动画
- `BackgroundTaskStatus.tsx` 把这些语言压缩进 footer，按 teammate 模式和 summary pill 模式切换

所以后台任务前台并不是“拿状态字段直接渲染”，而是有一套专门的任务语言引擎：先解释语义，再选择视觉，再压缩成终端里一行可扫读的状态表面。
