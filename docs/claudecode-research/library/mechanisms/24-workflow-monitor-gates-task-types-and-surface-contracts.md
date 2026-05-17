# Workflow / Monitor Gates / Task Types / Surface Contracts

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Permission Runtime / Hooks / Classifier / Dialog Pipeline`](./23-permission-runtime-hooks-classifier-and-dialog-pipeline.md) | [`下一站：API Request / Streaming / Retry / Telemetry`](./25-api-request-streaming-retry-and-telemetry.md)

本文不伪装成“已经看到了 WorkflowTool 和 MonitorTool 主体实现”。当前镜像里，这两条链真正清晰可见的是外围接线层：feature gate、tool/task registry、task type 协议、权限白名单、CLI/REPL 流式语义、后台任务 UI 术语，以及 command suggestion 对 workflow 命令的产品标记。目标是把这些真实可见层拆明白，同时明确主体仍然缺失在哪。

## 1. 当前镜像里最可靠的事实不是 tool body，而是 `workflow/monitor` 已经被正式接进 Claude Code 的统一 runtime contract

源码镜像：[`../../sources/claude-code/src/tools.ts`](../../sources/claude-code/src/tools.ts), [`../../sources/claude-code/src/tasks.ts`](../../sources/claude-code/src/tasks.ts), [`../../sources/claude-code/src/Task.ts`](../../sources/claude-code/src/Task.ts), [`../../sources/claude-code/src/tasks/types.ts`](../../sources/claude-code/src/tasks/types.ts)

这几层一起证明了三件事：

- `WorkflowTool` 和 `MonitorTool` 不是文案残留，而是 `getAllBaseTools()` 里的正式工具位。
- `LocalWorkflowTask` 和 `MonitorMcpTask` 不是 UI 假名，而是 `getAllTasks()` 里的正式任务位。
- `local_workflow` 和 `monitor_mcp` 不是日志字符串，而是 `TaskType` 枚举里的一级类型。

也就是说，即使主体文件在当前镜像里没完全挂出来，Claude Code 的主运行时已经把这两类能力当成一等公民来建模，而不是外挂脚本。

## 2. `feature('WORKFLOW_SCRIPTS')` 与 `feature('MONITOR_TOOL')` 说明这两条链是 compile-time / build-time gated，不是单纯的 runtime hide

源码镜像：[`../../sources/claude-code/src/tools.ts`](../../sources/claude-code/src/tools.ts), [`../../sources/claude-code/src/tasks.ts`](../../sources/claude-code/src/tasks.ts), [`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts)

三处 gate 非常一致：

- `tools.ts`：决定 `WorkflowTool` / `MonitorTool` 是否进入工具池
- `tasks.ts`：决定 `LocalWorkflowTask` / `MonitorMcpTask` 是否进入任务注册表
- `commands.ts`：决定 `workflowsCmd` 是否进入 slash command 总表

这说明 Claude Code 对 workflow/monitor 的产品策略不是“先全量暴露，再由 UI 判断隐藏”，而是：

- 工具是否存在
- 任务类型是否可被注册
- 命令是否可被枚举

三层同时由 feature flag 决定。它更接近可裁剪能力包，而不是始终存在的弱功能。

## 3. `WorkflowTool` 的加载方式暴露了一个重要事实：workflow 不只是单个工具，而是带 bundled bootstrap 的工具家族

源码镜像：[`../../sources/claude-code/src/tools.ts`](../../sources/claude-code/src/tools.ts)

`WorkflowTool` 的初始化不是直接 `require('./tools/WorkflowTool/WorkflowTool')`，而是先：

1. `require('./tools/WorkflowTool/bundled/index').initBundledWorkflows()`
2. 再返回 `WorkflowTool`

这说明 workflow 运行时至少有两层：

- bundled workflow catalog/bootstrap
- 真正的 tool body

而当前镜像里只露出了 `constants.ts`，没露出 tool body 和 bundled 目录内容。因此这篇能确认的是“有 bootstrap contract”，但不能伪造 bundled workflow 的具体执行模型。

## 4. `MonitorTool` 和 `MonitorMcpTask` 的命名分裂说明 monitor 不是普通 shell 轮询，而是偏向 MCP-backed 长生命周期任务

源码镜像：[`../../sources/claude-code/src/tools.ts`](../../sources/claude-code/src/tasks.ts), [`../../sources/claude-code/src/Task.ts`](../../sources/claude-code/src/tasks/pillLabel.ts)

这里有两个容易混淆的层：

- 工具名：`MonitorTool`
- 任务类型：`monitor_mcp`

这说明产品上叫 monitor，但任务层更明确地把它建模成 MCP monitor，而不是泛化后台 bash。`pillLabel.ts` 也进一步把 `monitor_mcp` 单独渲染成 `1 monitor / N monitors`，而不是 background workflow 或 shell。

因此 workflow 和 monitor 虽然都落进后台任务体系，但它们的语义不一样：

- workflow：本地工作流编排任务
- monitor：偏长期观察、通常与 MCP surface 绑定的任务

## 5. `Task.ts` 里的 task ID 前缀和共享 base state，说明 workflow/monitor 从任务协议层就被当成 durable background object

源码镜像：[`../../sources/claude-code/src/Task.ts`](../../sources/claude-code/src/Task.ts)

`TaskType` 明确包括：

- `local_workflow`
- `monitor_mcp`

对应 ID 前缀也已固化：

- `local_workflow -> w`
- `monitor_mcp -> m`

再加上共享 `TaskStateBase` 字段：

- `outputFile`
- `outputOffset`
- `notified`
- `startTime/endTime`
- `toolUseId`

这意味着 workflow/monitor 在任务协议里不是“临时 UI 行”，而是和：

- `local_bash`
- `local_agent`
- `remote_agent`

同级的、可落到磁盘输出和通知系统的 durable task object。

## 6. `tasks/types.ts` 说明 background task 可见性对 workflow/monitor 没有特殊豁免，它们遵循统一的前台显隐规则

源码镜像：[`../../sources/claude-code/src/tasks/types.ts`](../../sources/claude-code/src/Task.ts)

`BackgroundTaskState` 显式把二者纳入联合类型。`isBackgroundTask()` 的判定也没有对 workflow/monitor 开后门，只看：

- `status` 是否为 `pending/running`
- `isBackgrounded === false` 时排除前台任务

这说明 workflow/monitor 一旦被 foreground 化或未进入 pending/running，就不会自动拥有更高优先级。它们只是共享后台任务体系，而不是自带专属渲染捷径。

## 7. `pillLabel.ts` 揭示了产品术语差异：workflow 被讲成“background workflows”，monitor 被讲成“monitors”，而 shell monitor 又是第三种东西

源码镜像：[`../../sources/claude-code/src/tasks/pillLabel.ts`](../../sources/claude-code/src/tasks/LocalShellTask/guards.ts)

这里有三个层次必须分开：

- `local_workflow` -> `1 background workflow / N background workflows`
- `monitor_mcp` -> `1 monitor / N monitors`
- `local_bash` 但 `kind === 'monitor'` -> 与 shell 混算，变成 `1 shell, 1 monitor` 这种组合

也就是说 Claude Code 里“monitor”至少有两种实现语义：

- shell-task UI variant 的 monitor
- MCP-backed task type 的 monitor

这解释了为什么 `collapseBackgroundBashNotifications.ts` 会特别强调：

- 只折叠成功的 background bash completion
- 不折叠 agent/workflow notifications
- monitor stream event 也不匹配这套 collapse 条件

产品上都叫 monitor，但底层消息模型并不统一。

## 8. `cli/print.ts` 证明 workflow 已经进入 headless / SDK 输出语义，不只是 fullscreen REPL 里的本地 UI 特例

源码镜像：[`../../sources/claude-code/src/cli/print.ts`](../../sources/claude-code/src/tasks/types.ts)

headless draining loop 有一个关键 hold-back 条件：

- 如果存在 `local_agent` 或 `local_workflow` 类型的 running background task
- `result` 会先被 held back，直到后台任务收敛

这说明 workflow 不只是 REPL 里 `BackgroundTasksDialog` 能看见的项目，它还改变了：

- SDK 结果何时真正吐给消费者
- headless run 什么时候算这一轮“可以发 result 了”

monitor 没出现在这条 hold-back 条件里，也说明它和 workflow 的流式契约不同：workflow 会拖住结果语义，monitor 更像长期伴随任务。

## 9. `commandSuggestions.ts` 证明 workflow commands 在 slash UX 里有专门 badge，而不是普通 prompt command

源码镜像：[`../../sources/claude-code/src/utils/suggestions/commandSuggestions.ts`](../../sources/claude-code/src/types/command.ts), [`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts)

`createCommandSuggestionItem()` 里有一条专门分支：

- `cmd.type === 'prompt' && cmd.kind === 'workflow'`

命中后会：

- `tag: 'workflow'`
- description 不走普通 source formatting，而是直接用 workflow 自己的产品说明

这说明 workflow 在 slash autocomplete 里不是“又一个 prompt command”，而是有独立产品标识的命令族。再结合 `commands.ts` 里的：

- `workflowsCmd`
- `createWorkflowCommand`
- `getAllCommands()` 合并 workflowCommands

可以确认 workflow 至少覆盖了：

- 一组专门的 slash commands
- 一套 autocomplete/badge 语义
- 一个和 skill/plugin commands 并列的命令来源

但当前镜像没有给出 `commands/workflows/index` 与 `createWorkflowCommand` 主体，因此还不能写出 workflow command body 的具体参数协议。

## 10. `ALL_AGENT_DISALLOWED_TOOLS` 与 classifier allowlist 说明 workflow 在权限上被当成“可安全编排、但不可递归扩散”的特殊工具

源码镜像：[`../../sources/claude-code/src/constants/tools.ts`](../../sources/claude-code/src/utils/permissions/classifierDecision.ts)

这里有两个关键信号：

- `ALL_AGENT_DISALLOWED_TOOLS` 在启用 `WORKFLOW_SCRIPTS` 时把 `WORKFLOW_TOOL_NAME` 拉黑
- 注释写得很明确：`Prevent recursive workflow execution inside subagents.`

但另一方面，`SAFE_YOLO_ALLOWLISTED_TOOLS` 又把 `WORKFLOW_TOOL_NAME` 加进自动允许清单，并注明：

- subagents still go through `canUseTool` individually

这两条合起来说明 workflow 的安全模型是：

- 在主线程里，它被视为 orchestration-safe，不需要额外 classifier API 成本
- 在 agent 内部，禁止再次递归启动 workflow，防止无限嵌套和权限膨胀

这类策略非常像“高层编排器”，而不是普通工具。

## 11. `commands/tasks/index.ts` 与现有 task UI 卷册一起证明：workflow/monitor 的真正产品表面首先是统一后台任务控制台

源码镜像：[`../../sources/claude-code/src/commands/tasks/index.ts`](../../sources/claude-code/src/commands/tasks/index.ts), [`../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx), [`../../sources/claude-code/src/components/tasks/BackgroundTask.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTask.tsx)

`/tasks` 的定义非常薄，只是：

- `name: 'tasks'`
- `aliases: ['bashes']`
- `description: 'List and manage background tasks'`
- `load: () => import('./tasks')`

这说明 workflow/monitor 在命令层没有被拆成 `/workflow-tasks`、`/monitors` 这种独立总控，而是先统一纳入 `/tasks`。也就是说，它们对用户最稳定的前台工作面不是专属命令，而是 Background Tasks 控制台。

## 12. `collapseBackgroundBashNotifications.ts` 揭示了通知层一个很重要的边界：workflow/monitor 完成事件不会被压扁成 generic “N commands completed”

源码镜像：[`../../sources/claude-code/src/utils/collapseBackgroundBashNotifications.ts`](../../sources/claude-code/src/constants/xml.ts)

这里的 collapse 条件非常严格：

- 必须是 `<task-notification>`
- 必须 `<status>completed`
- summary 必须带 `BACKGROUND_BASH_SUMMARY_PREFIX`

源码注释明确写出：

- agent/workflow notifications are left alone
- monitor stream events have no `<status>` tag and never match

这说明 workflow/monitor 在通知系统里拥有比 bash 更强的“不可压缩语义”：

- bash completion 可以合并成批量完成
- workflow/monitor completion 或 stream event 必须保留个体意义

这进一步印证它们是更高层的执行对象。

## 13. 这条链当前真正缺的不是“有没有名字”，而是主体执行器源码仍未在镜像中展开

当前可直接确认存在但不可见主体的部分包括：

- `packages/claude-code/src/tools/WorkflowTool/WorkflowTool`
- `packages/claude-code/src/tools/WorkflowTool/bundled/index`
- `packages/claude-code/src/tools/MonitorTool/MonitorTool`
- `packages/claude-code/src/tasks/LocalWorkflowTask/LocalWorkflowTask`
- `packages/claude-code/src/tasks/MonitorMcpTask/MonitorMcpTask`
- `packages/claude-code/src/commands/workflows/index`
- `packages/claude-code/src/tools/WorkflowTool/createWorkflowCommand`

所以这篇的边界必须写清楚：

- 已经拆明白的，是 workflow/monitor 如何被系统接入、命名、 gating、显示、权限化、流式化
- 还没拆明白的，是 workflow script 的具体执行状态机、monitor MCP task 的 polling body、workflow command 的参数与运行步骤

这不是保守，而是当前镜像证据的真实边界。

## 14. 读到这里时，应该把 workflow/monitor 理解成“部分主体缺失，但外围 runtime contract 已经完整可见”

如果只看缺失的 tool body，很容易误判成“这部分没什么可写”。实际上当前镜像已经给出了足够完整的一圈外围契约：

- gate：哪些 build 才有
- registry：怎么进入 tools/tasks/commands
- typing：怎么成为一等 task type
- permission：在哪些场景自动允许、在哪些场景禁止递归
- surface：如何出现在 `/tasks`、footer pill、autocomplete、headless stream
- notification：完成消息怎样保留个体语义

所以最准确的结论不是“workflow/monitor 不可分析”，而是“其 orchestration shell 已经清晰，执行内核仍部分缺席”。

## 交叉参考

- 远端 review、workflow/monitor 的工作面总述：[`./14-remote-review-workflow-and-monitor-surfaces.md`](./14-remote-review-workflow-and-monitor-surfaces.md)
- 后台任务列表与 detail surface：[`../architecture/19-background-task-aggregation-and-list-runtime.md`](../architecture/19-background-task-aggregation-and-list-runtime.md)
- footer pill 与任务状态术语：[`../architecture/20-task-status-and-footer-surfaces.md`](../architecture/20-task-status-and-footer-surfaces.md)
- AskUser / Glob / workflow 半显式接缝：[`./13-ask-user-glob-and-semi-visible-tools.md`](./13-ask-user-glob-and-semi-visible-tools.md)
- permission runtime 总装配：[`./23-permission-runtime-hooks-classifier-and-dialog-pipeline.md`](./23-permission-runtime-hooks-classifier-and-dialog-pipeline.md)
