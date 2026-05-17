# Workflow / Monitor Console And Task Framework Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Task Watcher / Claiming / Team Status Runtime`](./34-task-watcher-claiming-and-team-status-runtime.md) | [`下一站：产品卷`](../product/01-positioning-and-surface.md)

本文继续补 `workflow / monitor`，但仍然不伪装成“已经拿到 WorkflowTool/MonitorTool 主体执行器”。当前镜像里最扎实可见的是另一条链：`BackgroundTasksDialog.tsx + BackgroundTask.tsx + tasks/pillLabel.ts + utils/task/framework.ts + utils/task/sdkProgress.ts + LocalShellTask.tsx`。它回答的是：workflow/monitor 一旦已经变成任务，Claude Code 怎么把它们编进后台控制台、SDK 事件、通知优先级和状态文法。

## 1. 这条链的起点不是 tool body，而是“任务已经存在时，前台和框架如何接住它”

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx), [`../../src/utils/task/framework.ts`](../../src/utils/task/framework.ts)

也就是说，这篇不回答：

- workflow 脚本本体怎么跑
- monitor MCP body 怎么轮询

它回答的是：

- 任务一旦进入 `AppState.tasks`
- 控制台如何组织它
- 事件层如何给 SDK / 通知系统编码它

## 2. `BackgroundTasksDialog` 明确把 workflow 和 monitor 当作独立 list item 类型，而不是借用 bash/agent 皮肤

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

`ListItem` 联合类型里显式存在：

- `type: 'local_workflow'`
- `type: 'monitor_mcp'`

说明工作流和 MCP monitor 在后台控制台层已经是一级对象，不需要靠 `local_bash.kind` 或 `remote_agent` 变体去伪装。

## 3. 两条链都走 `feature() + require()` 的惰性接线，说明控制台也遵守 build-time 裁剪策略

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

可见接线包括：

- `WorkflowDetailDialog`
- `killWorkflowTask`
- `skipWorkflowAgent`
- `retryWorkflowAgent`
- `MonitorMcpDetailDialog`
- `killMonitorMcp`

这些都通过 `feature('WORKFLOW_SCRIPTS')` 或 `feature('MONITOR_TOOL')` 包裹。这说明即使是前台控制台，也不会静态依赖这些 ant-gated 模块。

## 4. detail dialog 主体当前镜像缺失，但它们的调用 contract 已经足够清楚

当前镜像里看不到：

- `WorkflowDetailDialog.tsx`
- `MonitorMcpDetailDialog.tsx`

但 `BackgroundTasksDialog` 已经暴露了调用约定：

- workflow detail 支持 `onKill / onSkipAgent / onRetryAgent / onBack`
- monitor detail 支持 `onKill / onBack`

因此这篇能确认的是 detail surface 的 control contract，不能伪造 detail body 的内部布局。

## 5. 列表分组顺序不是随意排版，而是一个稳定的任务优先级视图

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

排序后会分成：

- teammates
- bash
- monitorMcp
- remote
- agent
- workflows
- dream

注释还明确要求 `allSelectableItems` 顺序必须和 JSX render order 一致。说明这个对话框不是简单地把数组渲染出来，而是维护一套稳定的键盘导航空间。

## 6. workflow 和 monitor 都有专属 section，不被混进 “Shells” 或 generic background tasks

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

控制台会显式渲染：

- `Workflows (N)`
- `Monitors (N)`

这和 `tasks/pillLabel.ts` 里的术语是一致的，说明 Claude Code 很在意这两类对象在产品词汇表上的独立性。

## 7. `toListItem()` 说明两类任务在 label 生成上遵循不同语义

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

映射规则是：

- `local_workflow` -> `summary ?? description`
- `monitor_mcp` -> `description`

这说明 workflow 被视为“有更高层 summary/name 的编排对象”，而 monitor 更接近“持续观察某件事”的描述性对象。

## 8. `BackgroundTask.tsx` 进一步证明 workflow 和 monitor 的一行显示语法不一样

源码镜像：[`../../src/components/tasks/BackgroundTask.tsx`](../../src/components/tasks/BackgroundTask.tsx)

对于 `local_workflow`：

- 标题优先 `workflowName ?? summary ?? description`
- 运行中 label 是 `N agents`
- completed label 是 `done`
- completed 且 `!notified` 会补 `, unread`

对于 `monitor_mcp`：

- 只显示 `description`
- completed label 也是 `done`
- 同样支持 `, unread`

这说明 workflow 的一行状态重点在“编排规模”，monitor 的重点在“观察对象本身”。

## 9. workflow 行里出现 `agentCount`，说明当前可见外壳已假定 workflow 是多 agent 编排对象

源码镜像：[`../../src/components/tasks/BackgroundTask.tsx`](../../src/components/tasks/BackgroundTask.tsx)

即使没有主体执行器源码，单从 `task.agentCount` 进入 UI 就能确认：

- workflow 不是单步脚本
- 它至少在产品上被建模成会编排多个 agent 的任务

## 10. `x` 快捷键对 workflow/monitor 都生效，但 workflow 额外有 `skip/retry agent` 侧路，说明 stop semantics 不对称

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

列表模式下：

- `x` 可 stop workflow
- `x` 可 stop monitor

但 detail 模式里只有 workflow 还额外接了：

- `skipWorkflowAgent`
- `retryWorkflowAgent`

这说明 workflow 是更细粒度的 orchestrator，可以局部跳过或重试某个子 agent；monitor 暂时只有整体 stop 语义。

## 11. workflow detail 还有一个特别的完成后宽限: detail view 不会像普通任务那样立刻被踢回列表

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

`useEffect` 里专门写了：

- workflow tasks get a grace: their detail view stays open through completion

这说明 workflow 的完成态被认为值得用户读最终状态，而不是像一般背景任务那样一结束就消失。

## 12. `tasks/pillLabel.ts` 和控制台 section 共同构成了 workflow/monitor 的产品词汇表

源码镜像：[`../../src/tasks/pillLabel.ts`](../../src/tasks/pillLabel.ts)

这里明确规定：

- `local_workflow` -> `1 background workflow / N background workflows`
- `monitor_mcp` -> `1 monitor / N monitors`

因此：

- footer pill
- turn-duration transcript line
- BackgroundTasksDialog 分组标题

三者用的是同一套概念语言，不是各说各话。

## 13. shell-monitor 是另一条完全不同的 monitor 语义，不能和 `monitor_mcp` 混为一谈

源码镜像：[`../../src/tasks/LocalShellTask/guards.ts`](../../src/tasks/LocalShellTask/LocalShellTask.tsx), [`../../src/tasks/pillLabel.ts`](../../src/tasks/pillLabel.ts)

`LocalShellTask` 里还有：

- `kind?: 'bash' | 'monitor'`

它只是 `local_bash` 的 UI 变体：

- 用 `description` 替代 `command`
- 通知语义不同

而 `monitor_mcp` 则是完全独立的 `TaskType`。因此当前代码里至少有两种“monitor”：

- shell monitor
- MCP monitor

## 14. `LocalShellTask` 的 monitor 通知分支，揭示了 shell-monitor 与 MCP monitor 共名但不同意图

源码镜像：[`../../src/tasks/LocalShellTask/LocalShellTask.tsx`](../../src/tasks/LocalShellTask/LocalShellTask.tsx)

当 `kind === 'monitor'` 时：

- completed 不表示“条件满足”，只表示 stream ended
- summary 变成 `Monitor "..." stream ended`
- priority 在 `MONITOR_TOOL` 打开时走 `next`

这说明 shell-monitor 是“脚本流结束”语义，而不是 MCP monitor 的那套长期观察对象语义。两者只是在用户词汇上都叫 monitor。

## 15. `task/framework.ts` 说明 workflow 一进入任务框架，就会获得统一的 `task_started` SDK 书挡

源码镜像：[`../../src/utils/task/framework.ts`](../../src/utils/task/framework.ts)

`registerTask()` 会统一发：

- `type: 'system'`
- `subtype: 'task_started'`
- `task_type`
- `description`
- `tool_use_id`

而且如果任务上有 `workflowName`，还会额外发：

- `workflow_name`

这说明 workflow 在 SDK 事件层已被视为比一般任务多一层命名语义。

## 16. `registerTask()` 的 replacement 逻辑说明 workflow/monitor 这类任务支持 resume/re-register，不是纯一次性前台对象

源码镜像：[`../../src/utils/task/framework.ts`](../../src/utils/task/framework.ts)

重新注册时会保留：

- `retain`
- `startTime`
- `messages`
- `diskLoaded`
- `pendingMessages`

这意味着任务框架默认考虑了“任务对象会被替换，但前台查看状态不能丢”的场景。workflow 作为长生命周期对象正好吃到这层能力。

## 17. `evictTerminalTask()` 对所有 terminal task 通用，但 workflow 因为 detail 宽限和 retain/evictAfter 机制，会比普通任务更晚离场

源码镜像：[`../../src/utils/task/framework.ts`](../../src/utils/task/framework.ts)

框架层只看：

- 是否 terminal
- 是否 `notified`
- 是否过了 `evictAfter`

所以 workflow 的“完成后还能看一会儿”不是框架硬编码，而是前台 detail 宽限和 retain policy 共同塑造出来的结果。

## 18. `emitTaskProgress()` 说明 workflow 并不只发 started/completed，它还有专门的 `workflow_progress` 负载

源码镜像：[`../../src/utils/task/sdkProgress.ts`](../../src/utils/task/sdkProgress.ts)

这个 helper 同时服务：

- background agents
- workflows

但只有 workflow 这边会额外传：

- `workflowProgress?: SdkWorkflowProgress[]`

因此在 SDK 事件层，workflow 明确比普通任务多一套结构化进度轨迹。

## 19. monitor 当前可见外壳没有对应的专用 progress payload，说明它和 workflow 的 observability 粒度并不对称

从当前镜像能确认：

- workflow 有 `workflow_progress`
- monitor 只有 task type、控制台分组、stop/detail contract

这说明至少在当前可见证据里，workflow 的进度可观测性要比 monitor 更精细。

## 20. 当前镜像已经足够证明 workflow/monitor 的“控制台接线 + 任务框架事件”是完整存在的，即便主体执行器仍缺失

能确认的部分包括：

- 背景控制台中的独立 item type、section、快捷键和 detail 路由
- workflow 的 kill/skip/retry contract
- monitor 的独立 stop/detail contract
- footer pill 与一行状态语法
- `task_started` / `task_progress(workflow_progress)` 事件骨架
- shell-monitor 与 MCP monitor 的语义分裂

当前不能确认的，仍然是：

- `WorkflowDetailDialog` / `MonitorMcpDetailDialog` 内部视图细节
- `LocalWorkflowTask` / `MonitorMcpTask` 的真正执行状态机

## 交叉参考

- workflow/monitor 外围 gate 与任务类型：[`./24-workflow-monitor-gates-task-types-and-surface-contracts.md`](./24-workflow-monitor-gates-task-types-and-surface-contracts.md)
- workflow command 与 permission surface：[`../commands/11-workflow-command-sources-and-permission-surfaces.md`](../commands/11-workflow-command-sources-and-permission-surfaces.md)
- 后台任务聚合总述：[`../architecture/19-background-task-aggregation-and-list-runtime.md`](../architecture/19-background-task-aggregation-and-list-runtime.md)
- 任务状态与 footer 表面：[`../architecture/20-task-status-and-footer-surfaces.md`](../architecture/20-task-status-and-footer-surfaces.md)
