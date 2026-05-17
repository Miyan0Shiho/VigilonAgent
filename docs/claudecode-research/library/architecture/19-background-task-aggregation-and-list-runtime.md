# Background Task Aggregation 与 List Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Bridge Dialogs / Teleport Repo Handoff`](./18-bridge-dialogs-and-teleport-repo-handoff.md) | [`下一站：Task Status / Footer Surfaces`](./20-task-status-and-footer-surfaces.md)

本文不再讲某一种具体 task 的内部实现，而是专门拆 Claude Code 如何把多种后台任务统一折叠成同一个可操作前台：footer pill、任务可见性判定、分组排序、列表项文案、详情对话框路由，以及 feature-gated workflow/monitor surface 如何接进这一层。

## 1. 这层解决的是“后台任务很多，但用户前台只看到一个统一工作面”

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx), [`../../src/components/tasks/BackgroundTask.tsx`](../../src/components/tasks/BackgroundTask.tsx), [`../../src/tasks/types.ts`](../../src/tasks/types.ts), [`../../src/tasks/pillLabel.ts`](../../src/tasks/pillLabel.ts)

Claude Code 的后台任务早就不只是 shell：

- `local_bash`
- `local_agent`
- `remote_agent`
- `in_process_teammate`
- `local_workflow`
- `monitor_mcp`
- `dream`

但用户前台不能为每种类型各开一套入口，所以这一层的职责是把不同 runtime 单元折叠成一个统一 operator surface。

## 2. `BackgroundTaskState` 不是“所有 task”的宇宙全集，而是“可以进入后台工作面”的显示联合类型

源码镜像：[`../../src/tasks/types.ts`](../../src/tasks/types.ts)

`TaskState` 和 `BackgroundTaskState` 看起来一样，实际上语义不同：

- `TaskState`
  - 所有已知 task 状态联合
- `BackgroundTaskState`
  - 当前被后台工作面接纳的 task 状态联合

这说明 `BackgroundTasksDialog` 并不是读取任意 task 后再临时猜，而是建立在一个显式的“可进入后台 UI 的任务族谱”上。

## 3. `isBackgroundTask()` 说明“后台任务”首先是一个可见性判定，而不是一个任务种类

源码镜像：[`../../src/tasks/types.ts`](../../src/tasks/types.ts)

`isBackgroundTask(task)` 只做两件事：

- `status` 必须是 `running` 或 `pending`
- 若对象带 `isBackgrounded`，则不能为 `false`

也就是说，“后台任务”并不等于某个固定子类，而是：

- 运行中/待运行
- 已经被明确放到后台

这使得同一任务实现可以在前台或后台之间切换，而不用改自己的 type tag。

## 4. `getSelectableBackgroundTasks()` 说明后台任务表面还要再减去“当前正在前台看的那个任务”

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

`getSelectableBackgroundTasks(tasks, foregroundedTaskId)` 在 `isBackgroundTask()` 之上又多做了一步：

- 如果任务是 `local_agent` 且其 id 等于 `foregroundedTaskId`
- 直接从后台任务列表里排除

这说明 Claude Code 不把“是否后台显示”完全交给 task 自己，而是在前台视角再做一次剔除，避免一个正在主界面被看的 agent 同时又出现在后台任务对话框里。

## 5. `BackgroundTasksDialog` 的初始模式机首先围绕“是否跳过列表页”设计

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

它的 `ViewState` 只有两态：

- `list`
- `detail`

但初始化逻辑并不简单。它会在以下场景直接跳到 detail：

- 调用方传了 `initialDetailTaskId`
- 当前只有一个可选后台任务

并且用 `skippedListOnMount` 记住“是否一开始跳过了列表”，用于后续 Back 的行为判定。这说明这里不是普通 master-detail，而是有一套专门针对任务数量波动的入口策略。

## 6. “Back 是回列表还是直接关掉对话框”在这里是显式协议，不是 incidental 行为

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

`goBackToList()` 的判定是：

- 若启动时跳过了列表
- 且当前仍然只有 `<= 1` 个任务
- 则 Back 直接关闭对话框

否则才真正回到列表。

注释明确说这是为了避免 stale-state trap：如果打开时只有 1 个任务而自动进 detail，后来又新起了第二个任务，Back 应该显示列表，而不是错误地关闭。

## 7. `BackgroundTasksDialog` 先统一把所有任务映射到 `ListItem`，再做真正的前台排序与分组

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

这里不是边渲染边判断，而是先：

- `backgroundTasks.map(toListItem)`
- 生成统一的 `ListItem` 联合类型

`ListItem` 至少统一了：

- `id`
- `type`
- `label`
- `status`
- `task`

这说明后台任务前台在真正渲染前，先建立了一层 UI 友好的通用视图模型。

## 8. 任务排序规则说明这个工作面优先呈现“现在还能操作的东西”

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

排序策略是：

- `running` 在前
- 非 `running` 在后
- 同组按 `startTime` 倒序

所以这不是按类型或字母排序，而是按 operator 最关心的维度排序：

- 先看到还在活跃的任务
- 再看到最近启动的任务

## 9. `showSpinnerTree` 会改变后台任务对话框里 teammate 的可见性，说明它和另一套前台 surface 共享显示责任

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

当 `expandedView === 'teammates'` 时：

- `teammates = []`

也就是说，如果 spinner tree 已经在另一块前台 surface 里展示 teammates，这里就把它们从后台任务对话框中隐去。说明这不是孤立列表，而是会和其他前台工作面协商“谁负责显示哪个任务族”。

## 10. `leaderItem` 说明 teammate 组在前台不是纯任务列表，而是带有“回到 leader”的导航结构

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/utils/swarm/constants.ts)

当存在 teammates 时，这里会人为插入一个：

- `type: 'leader'`
- `label: @team-lead`
- `status: 'running'`

这说明 teammates 在这个对话框里不是简单并列任务，而是被包装成一个带根节点的导航簇。用户不仅能前景化某个 teammate，也能显式切回 leader。

## 11. `allSelectableItems` 的顺序是显式契约，不只是实现巧合

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

代码里专门写了注释，要求 `allSelectableItems` 顺序必须和 JSX render 顺序一致：

- teammates
- bash
- monitorMcp
- remote
- agent
- workflows
- dream

原因是 `↑/↓` 选择移动必须视觉上一致向上/向下。这说明这个列表不是“数组排好就完了”，而是把键盘导航体验当成了显式不变量。

## 12. `BackgroundTask` 组件说明不同 task type 的行内语义是明确分叉的，而不是统一模板

源码镜像：[`../../src/components/tasks/BackgroundTask.tsx`](../../src/components/tasks/BackgroundTask.tsx)

`BackgroundTask` 对不同类型采取了不同展示协议：

- `local_bash`
  - `monitor` 用 `description`
  - 普通 shell 用 `command`
  - 再拼 `ShellProgress`
- `remote_agent`
  - remote review 直接交给 `RemoteSessionProgress`
  - 其他远端会话带 open/filled diamond + title + progress
- `local_workflow`
  - 取 `workflowName ?? summary ?? description`
  - 运行中显示 `N agent`
- `monitor_mcp`
  - 以 `description` 为主，完成后显示 `done/unread`

说明这一层已经沉淀出一套“每种后台任务在单行里该如何被读”的显示语法。

## 13. `remote_agent` 的 diamond 语义已经从普通任务列表升级成产品状态语言

源码镜像：[`../../src/components/tasks/BackgroundTask.tsx`](../../src/components/tasks/BackgroundTask.tsx), [`../../src/tasks/pillLabel.ts`](../../src/tasks/pillLabel.ts)

这里的规则是：

- `running/pending` 用 open diamond
- 完结态用 filled diamond
- `isRemoteReview` 甚至直接走另一条 progress surface

再配合 `pillLabel.ts` 里对 `isUltraplan` 的特殊文案：

- `◇ ultraplan`
- `◇ ultraplan needs your input`
- `◆ ultraplan ready`

说明远端任务在后台任务系统里已经有一套专属视觉语言，而不是普通 status 文本。

## 14. `pillLabel.ts` 不是简单计数器，而是后台任务系统的术语压缩器

源码镜像：[`../../src/tasks/pillLabel.ts`](../../src/tasks/pillLabel.ts)

`getPillLabel(tasks)` 做的不是“返回任务数”，而是把一组后台任务压缩成用户能扫读的术语：

- `1 shell`, `2 shells`
- `1 monitor`, `N monitors`
- `1 team`, `N teams`
- `◇ 1 cloud session`
- `1 background workflow`
- `dreaming`

并且在 `local_bash` 同类型集合里，还会拆成：

- shells 数
- monitors 数

这说明 footer pill 和 turn-duration transcript line 背后共享的是一套经过精炼的产品词汇表。

## 15. `pillNeedsCta()` 说明不是所有后台任务都值得显示“↓ to view”，只有 attention state 才会提升

源码镜像：[`../../src/tasks/pillLabel.ts`](../../src/tasks/pillLabel.ts)

CTA 触发条件很苛刻：

- 只能有 1 个任务
- 必须是 `remote_agent`
- 必须 `isUltraplan === true`
- `ultraplanPhase` 已定义

也就是说，后台任务 pill 的 attention 设计不是“有任务就提示去看”，而是只在明确需要用户介入或计划已就绪时提升。

## 16. `BackgroundTasksDialog` 的 kill / foreground 键位表明它是统一 operator console，而不只是 viewer

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

`x` 键会按类型调用不同的 stop 路径：

- `LocalShellTask.kill`
- `LocalAgentTask.kill`
- `InProcessTeammateTask.kill`
- `killWorkflowTask`
- `killMonitorMcp`
- `DreamTask.kill`
- `RemoteAgentTask.kill`
- `stopUltraplan`

`f` 键则专门用于：

- foreground teammate
- 切回 leader

这说明这个对话框不是只读面板，而是真正的多任务统一操作台。

## 17. detail 路由说明这层承担的是“任务壳路由器”，而不是每个任务内部逻辑本体

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

进入 detail 后，这里只是按 `task.type` 做分发：

- `ShellDetailDialog`
- `AsyncAgentDetailDialog`
- `RemoteSessionDetailDialog`
- `InProcessTeammateDetailDialog`
- `WorkflowDetailDialog`
- `MonitorMcpDetailDialog`
- `DreamDetailDialog`

所以它的角色不是“解释每个任务怎么运行”，而是把不同任务 runtime 接到同一前台路由壳里。

## 18. `local_workflow` 和 `monitor_mcp` 在当前镜像里是 feature-gated detail surface，不应被硬写成完全可见实现

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx), [`../../src/tasks/types.ts`](../../src/tasks/types.ts)

当前可明确确认的是：

- `WORKFLOW_SCRIPTS` gate 打开时才 `require('./WorkflowDetailDialog')`
- `MONITOR_TOOL` gate 打开时才 `require('./MonitorMcpDetailDialog')`
- 对应 kill/skip/retry API 也都经由 gated `require()` 注入

但 `LocalWorkflowTask`、`MonitorMcpTask` 主体源码在当前镜像里没有完整挂出。因此这套文档只能明确写到：

- 前台列表如何接入它们
- detail surface 何时可见
- 可执行的操作入口是什么

不能伪造它们内部 agent orchestration 或 monitor engine 的完整实现。

## 19. 后台任务对话框还显式处理了“任务消失后 detail 怎么退场”的生命周期问题

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx), [`../../src/tasks/types.ts`](../../src/tasks/types.ts)

当 detail 模式下发现：

- task 被移除
- 或不再满足 `isBackgroundTask()`

它会：

- 若启动时跳过列表，则直接关闭对话框
- 否则退回列表

但 `local_workflow` 被给了一个特例：完成后 detail 仍可短暂停留，让用户看到最终状态。说明这层不仅管路由，还管任务退出前的 UX 收尾策略。

## 20. 这套 background-task runtime，本质上是 Claude Code 的“多异步执行统一前台壳”

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx), [`../../src/components/tasks/BackgroundTask.tsx`](../../src/components/tasks/BackgroundTask.tsx), [`../../src/tasks/types.ts`](../../src/tasks/types.ts), [`../../src/tasks/pillLabel.ts`](../../src/tasks/pillLabel.ts)

把这几层放在一起看，Claude Code 后台任务系统的前台侧已经很明确：

- `tasks/types.ts` 定义哪些任务能进入后台可见性体系
- `pillLabel.ts` 负责把它们压缩成稳定的产品术语
- `BackgroundTask.tsx` 负责每种任务的一行显示语法
- `BackgroundTasksDialog.tsx` 负责分组、排序、键盘操作、detail 路由和生命周期收尾

所以 Claude Code 的后台任务不是一堆独立弹窗，而是一套统一的多异步执行前台壳。shell、remote session、teammate、workflow、monitor、dream 只是被这层收纳进去的不同任务族。
