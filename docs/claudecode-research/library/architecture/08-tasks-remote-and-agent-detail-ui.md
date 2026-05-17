# Tasks、Remote 与 Agent Detail UI

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：PromptInput / Search UI`](./07-prompt-input-and-search-ui.md) | [`下一站：命令体系`](../commands/01-command-registry-and-dispatch.md)

本文聚焦 `BackgroundTasksDialog`、`RemoteSessionDetailDialog`、`AsyncAgentDetailDialog`、`useRemoteSession`、`RemoteSessionManager` 这一组文件，说明 Claude Code 如何把后台任务、远端会话和 agent 进度做成一个可切换、可前台化、可中断的交互层。

## 1. `BackgroundTasksDialog` 是任务目录页，不是单一对话框

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

它首先做的是任务分类与导航，而不是展示详情：

- `local_bash`
- `remote_agent`
- `local_agent`
- `in_process_teammate`
- `local_workflow`
- `monitor_mcp`
- `dream`
- 特殊的 `leader` 项

这说明背景任务面板的本质是“后台执行单元目录”，不是某一类任务的专属 UI。

## 2. 它内部维护的是 list/detail 双态路由

`BackgroundTasksDialog` 自己维护：

- `viewState = list | detail`
- `selectedIndex`
- 初次进入时是否跳过 list

并且会根据：

- `initialDetailTaskId`
- 当前是否只有一个 task
- foregroundedTaskId
- spinner-tree / teammate view

决定用户是先看列表还是直接进入详情页。也就是说，它实际上就是一个终端里的小路由器。

## 3. 任务列表不只是展示，还承载控制动作

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

在 list 模式下，它已经支持：

- 上下选择
- `confirm:yes` 进入详情
- `x` 按任务类型触发 kill / stop
- `f` 切到 teammate 或 leader foreground view
- `left` 关闭对话框

因此这个列表页本身就已经是控制台，而不是只读状态页。

## 4. `RemoteSessionDetailDialog` 展示的是“远端 agent 产品状态”

源码镜像：[`../../src/components/tasks/RemoteSessionDetailDialog.tsx`](../../src/components/tasks/RemoteSessionDetailDialog.tsx)

从 `formatToolUseSummary()` 和 `UltraplanSessionDetail` 可以看出，它不是简单回放 transcript，而是在做产品摘要：

- 区分 `needs_input`、`plan_ready` 等 phase
- 统计 spawned agents 与 tool call 数量
- 从最近一次 tool_use 构造一行摘要
- 生成 web session URL
- 对 `ultraplan` 提供单独的 stop confirm 流程

这说明 remote session 详情页的任务，不只是“展示远端消息”，而是把 web 侧执行态翻译回本地 operator 能理解的摘要。

## 5. `AsyncAgentDetailDialog` 是本地 agent 的最小观察窗

源码镜像：[`../../src/components/tasks/AsyncAgentDetailDialog.tsx`](../../src/components/tasks/AsyncAgentDetailDialog.tsx)

这个组件的结构很清楚：

- 标题来自 `selectedAgent.agentType` 和 `description`
- 副标题合并 status、elapsed time、token count、tool use count
- `recentActivities` 渲染成 progress 区
- prompt 很长时截断，但若有 `<plan>` 标签则走 `UserPlanMessage`
- 失败态单独显示 error

它提供的其实是“一个异步 agent 当前值班快照”。

## 6. `useRemoteSession` 才是远端 viewer 真正的运行时桥

源码镜像：[`../../src/hooks/useRemoteSession.ts`](../../src/hooks/useRemoteSession.ts)

这个 hook 负责的不是单一 websocket 连接，而是一套 REPL 适配层：

- 初始化 `RemoteSessionManager`
- 把收到的 SDK message 转成 REPL message
- 过滤本地已发消息的 WS echo，避免用户看到自己消息重复
- 维护 remote background task count
- 识别 compaction 中的长超时窗口
- 把 permission request 转成现有 `ToolUseConfirm` 队列

因此 remote mode 并不是另起一套 UI，而是通过这个 hook 把远端会话“嵌回”本地 REPL。

## 7. `RemoteSessionManager` 管的是协议，不是视图

源码镜像：[`../../src/remote/RemoteSessionManager.ts`](../../src/remote/RemoteSessionManager.ts)

这个类把远端 session 切成三类通信：

- SDK messages
- control_request
- control_response / control_cancel_request

其中最关键的是：

- `can_use_tool` control request 会进入 pending permission map
- 本地随后通过简化版 `RemotePermissionResponse` 回写 allow / deny
- sendMessage 走 HTTP POST，接收走 WebSocket subscribe

所以远端交互在协议层本来就是“消息流 + 控制流”双通道，不是单一流式文本。

## 8. 为什么这一卷要从任务 UI 单独拆出来

如果只看 tasks 目录名，很容易把这些组件当成“后台列表”。但实际拆开后能看到三层：

- `BackgroundTasksDialog` 是目录与导航层
- `RemoteSessionDetailDialog` / `AsyncAgentDetailDialog` 是不同任务类型的观察层
- `useRemoteSession` / `RemoteSessionManager` 是远端协议到本地 UI 的桥接层

它们共同定义了 Claude Code 如何把“后台跑着的东西”重新变成用户可见、可控、可恢复的会话对象。
