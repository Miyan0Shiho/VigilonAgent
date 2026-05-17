# Remote Session Detail / Background Task Operator Surfaces

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Task Status / Footer Surfaces`](./20-task-status-and-footer-surfaces.md) | [`下一站：Shell / Agent / Teammate Detail Dialog Family`](./37-shell-agent-and-teammate-detail-dialog-family.md)

前面的卷册已经分别讲过：

- `08`：任务、remote 与 agent detail 这组 UI 的总装配关系
- `19`：后台任务列表如何排序、分组、进入 detail
- `20`：`RemoteSessionProgress` 这类状态词表和 footer surface
- `30`：`RemoteAgentTask` 的轮询、恢复、归档运行时

但真正把 `remote_launched` 之后的 operator front-end 单独做成产品系统的，是这一条更细的前台链：

- `components/tasks/BackgroundTasksDialog.tsx`
- `components/tasks/RemoteSessionDetailDialog.tsx`
- `components/tasks/RemoteSessionProgress.tsx`

这一卷只讲这三层如何把 `RemoteAgentTaskState` 变成一个可浏览、可停止、可回跳到 web、可 teleport 的本地控制台。

## 1. `BackgroundTasksDialog` 不是“任务列表”，而是后台执行对象的目录路由器

源码镜像：[`../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx)

这份组件先做的不是渲染 task row，而是把统一 `tasks` 数据面路由成多种 operator surface：

- `local_bash`
- `remote_agent`
- `local_agent`
- `in_process_teammate`
- `local_workflow`
- `monitor_mcp`
- `dream`
- 特殊的 `leader`

同时它维护了：

- `viewState = list | detail`
- `selectedIndex`
- “是否在首次进入时跳过 list”的状态

这说明 `BackgroundTasksDialog` 本质上是一个终端里的迷你目录页，不是某个 detail dialog 的包壳。

## 2. remote session 在目录页里和 shell、local agent、workflow 是平级族，不是 review 专属例外

源码镜像：[`../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx)

`remote_agent` 会和其他后台任务一起被：

- 统一排序
- 统一 section 分组
- 统一吃 `↑/↓/Enter`
- 统一吃 `x` 这种 stop 动作

这说明 `remote_launched` 进入后台后，不会再被当成 `AgentTool` 的私有状态，而是正式变成全局后台任务目录中的一员。

## 3. 这个目录页编码了“哪个远端任务能停、哪个要走专用停止路径”

源码镜像：[`../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx)

在 list 模式下，按 `x` 并不是统一 `kill(taskId)`：

- 普通 `remote_agent`：走 `killRemoteAgentTask(task.id)`
- `isUltraplan`：改走 `stopUltraplan(task.id, task.sessionId, setAppState)`

而在 detail 分派里也是同样逻辑：

- `task.status !== 'running'` 时不再传 `onKill`
- running 且 `isUltraplan` 时传的是 `stopUltraplan`
- 否则才传 `RemoteAgentTask.kill`

所以远端任务在前台从一开始就分成了：

- generic remote session
- ultraplan operator session

两条不同的停止协议。

## 4. `BackgroundTasksDialog` 的 detail route 才是 remote session 真正从 task shell 进入 operator UI 的桥

源码镜像：[`../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx)

一旦 `viewState.mode === 'detail'`，remote task 会被直接路由到：

- `RemoteSessionDetailDialog`

而不是继续复用：

- `AsyncAgentDetailDialog`
- `ShellDetailDialog`

这说明 `remote_agent` 虽然和 local agent 都算后台任务，但在 detail 层就已经彻底分宿主了。

## 5. `RemoteSessionDetailDialog` 不是 transcript viewer，而是远端任务的产品摘要台

源码镜像：[`../../sources/claude-code/src/components/tasks/RemoteSessionDetailDialog.tsx`](../../sources/claude-code/src/components/tasks/RemoteSessionDetailDialog.tsx)

这份组件最关键的分支不是“渲染消息列表”，而是先按任务语义拆成三条模式：

- `session.isUltraplan`
- `session.isRemoteReview`
- 普通 remote session

也就是说，detail dialog 首先承认的是“远端任务属于哪种产品族”，而不是“它有多少条 log”。

## 6. 普通 remote session detail 只给最小 operator 摘要，不给完整远端 transcript

源码镜像：[`../../sources/claude-code/src/components/tasks/RemoteSessionDetailDialog.tsx`](../../sources/claude-code/src/components/tasks/RemoteSessionDetailDialog.tsx)

对普通 remote session，这个 dialog 重点显示的是：

- `Status`
- `Runtime`
- `Title`
- `Progress`
- `Session URL`

键盘层面则只支持：

- `Esc/Enter/Space` 关闭
- `←` 返回 list
- `t` teleport

这说明普通远端任务 detail 的定位是“任务控制和状态浏览”，不是把 claude.ai transcript 完整搬回本地。

## 7. `t` 键和 teleport 行为把本地 detail 变成了一个 handoff console

源码镜像：[`../../sources/claude-code/src/components/tasks/RemoteSessionDetailDialog.tsx`](../../sources/claude-code/src/components/tasks/RemoteSessionDetailDialog.tsx)

普通 remote session detail 里有一条非常明确的动作线：

- `t` 触发 `teleportResumeCodeSession(session.sessionId)`
- `openBrowser(sessionUrl)` 作为显式浏览器 handoff

这说明它不是想替代远端原生界面，而是承担：

- 本地先做发现和粗控制
- 需要深看时 handoff 回 web

的 operator 控制台角色。

## 8. `RemoteSessionProgress` 是 detail、list、footer 共享的状态词表内核

源码镜像：[`../../sources/claude-code/src/components/tasks/RemoteSessionProgress.tsx`](../../sources/claude-code/src/components/tasks/RemoteSessionProgress.tsx)

这个组件不是某个 dialog 的私有小部件。它定义的是整条 remote 任务前台链共享的状态语义：

- `isRemoteReview`：走 review 彩虹状态条
- `completed`：统一成 `done`
- `failed`：统一成 `error`
- 普通远端任务：用 `todoList` 计算 `completed/total`
- 没有 todoList 时：降级成 `running...` / `starting...`

因此 remote session 的“进度到底怎么说”并不分散在多个 view 里，而是被集中在这里统一定义。

## 9. ultrareview 的彩虹状态条不是装饰，而是专用进度协议的前台落点

源码镜像：[`../../sources/claude-code/src/components/tasks/RemoteSessionProgress.tsx`](../../sources/claude-code/src/components/tasks/RemoteSessionProgress.tsx)

`RemoteSessionProgress` 对 review 分支单独做了：

- `formatReviewStageCounts(...)`
- `RainbowText`
- `useSmoothCount(...)`

它依赖的不是一般 task status，而是 `reviewProgress.stage/bugsFound/bugsVerified/bugsRefuted`。

这说明 ultrareview 的前台并不是“远端 review 结果回来以后凑个漂亮颜色”，而是本地从一开始就承认它有一套专门的进度语法。

## 10. `RemoteSessionDetailDialog` 把 `ultraplan` 和 `ultrareview` 再拆成两套专用 operator surface

源码镜像：[`../../sources/claude-code/src/components/tasks/RemoteSessionDetailDialog.tsx`](../../sources/claude-code/src/components/tasks/RemoteSessionDetailDialog.tsx)

`UltraplanSessionDetail` 的重点是：

- `needs_input / plan_ready` phase label
- spawned agent 数、tool call 数
- 最近一次 tool 调用摘要
- 打开 web / stop ultraplan / back

`ReviewSessionDetail` 的重点是：

- `ready / running / failed`
- stage pipeline
- `reviewCountsLine(session)`
- 打开 web / stop ultrareview / dismiss

这说明同属 `remote_agent` task family 的不同 remoteTask subtype，在 operator 前台已经被拆成了两套产品面，而不是一个 detail 模板加条件文案。

## 11. `formatToolUseSummary()` 说明 detail dialog 想提供的是“最近一次有意义动作”，不是原始 tool payload

源码镜像：[`../../sources/claude-code/src/components/tasks/RemoteSessionDetailDialog.tsx`](../../sources/claude-code/src/components/tasks/RemoteSessionDetailDialog.tsx)

这个 helper 会：

- 对 `ExitPlanMode` 直接翻成 `Review the plan in Claude Code on the web`
- 对 `AskUserQuestion` 优先提取真实 question 文本
- 对其他 tool 输入取第一个有意义字符串并压成单行

所以 remote detail dialog 的“last tool call”是一次产品化摘要，而不是 debug 视角的原始 JSON。

## 12. `BackgroundTasksDialog -> RemoteSessionDetailDialog -> RemoteSessionProgress` 三层分别承担不同密度的信息面

可以把这条链分成三种信息密度：

- `BackgroundTasksDialog`
  - 目录页
  - 解决“系统里当前有哪些后台执行对象、我能选哪个”
- `RemoteSessionDetailDialog`
  - 详情页
  - 解决“这个远端任务当前在什么阶段、我能不能停/回 web/teleport”
- `RemoteSessionProgress`
  - 状态原语层
  - 解决“running/ready/error/3/7/deduping 到底怎么统一表述”

这三层叠起来，才构成了 `remote_launched` 之后完整的 operator front-end。

## 13. 这篇和 `30` 的边界

`30` 讲的是：

- `registerRemoteAgentTask`
- `restoreRemoteAgentTasks`
- `startRemoteSessionPolling`
- stable idle、review timeout、kill/archive

这一篇讲的是：

- 本地如何列出这些远端任务
- 何时路由到哪种 detail dialog
- 哪些动作暴露给 operator
- 远端状态词表如何在前台统一消费

也就是说，`30` 是 remote task runtime，`36` 是 remote task operator surface。
