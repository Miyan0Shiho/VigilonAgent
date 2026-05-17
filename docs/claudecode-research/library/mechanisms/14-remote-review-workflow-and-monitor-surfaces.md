# Remote Review、Workflow 与 Monitor Surfaces

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：AskUser / Glob / 半显式工具接缝`](./13-ask-user-glob-and-semi-visible-tools.md) | [`下一站：产品卷`](../product/01-positioning-and-surface.md)

本文把 `/ultrareview` 的远端执行链、Background Tasks 里的 workflow/monitor 工作面，以及 `PermissionRequest` 对 workflow/monitor tool 的接缝拆成一卷。重点不是重复 `/review` 命令总述，而是说明 Claude Code 怎样把“云端 review”“本地 workflow”“MCP monitor”这三类长任务收敛到同一套后台任务与前台对话面。

## 1. 这是一组“后台工作面”，不是单一工具实现

源码镜像：[`../../sources/claude-code/src/commands/review/reviewRemote.ts`](../../sources/claude-code/src/commands/review/reviewRemote.ts), [`../../sources/claude-code/src/commands/review/ultrareviewCommand.tsx`](../../sources/claude-code/src/commands/review/ultrareviewCommand.tsx), [`../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx), [`../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx), [`../../sources/claude-code/src/components/permissions/PermissionRequest.tsx`](../../sources/claude-code/src/components/permissions/PermissionRequest.tsx)

这条链跨了三个层次：

- command 层：决定是否允许发起远端 review，以及如何提示计费
- task 层：把远端会话、本地 workflow、MCP monitor 挂进统一后台任务框架
- UI 层：把它们收纳进 Background Tasks 列表、detail dialog、permission request

因此这篇文档讨论的不是一个函数，而是一组“长生命周期执行面”的合流。

## 2. `/review` 和 `/ultrareview` 在产品上相近，在实现上是两条链

源码镜像：[`../../sources/claude-code/src/commands/review.ts`](../../sources/claude-code/src/commands/review.ts), [`../../sources/claude-code/src/commands/review/reviewRemote.ts`](../../sources/claude-code/src/commands/review/reviewRemote.ts)

此前命令卷已经说明：

- `/review` 走本地 review prompt
- `/ultrareview` 才是唯一远端 bughunter / CCR 路径

这一卷继续往下拆时，最重要的事实是：远端 review 并不是“换个 prompt 发给模型”，而是：

- 先做远端可用性和仓库条件检查
- 再做 quota / Extra Usage 计费门控
- 再发起 teleport / remote session
- 最后注册成本地 `RemoteAgentTask`，让结果异步回流

所以 `/ultrareview` 实际上更像一次“远端任务提交”而不是即时命令执行。

## 3. `checkOverageGate()` 说明远端 review 首先是 billing-gated 功能

源码镜像：[`../../sources/claude-code/src/commands/review/reviewRemote.ts`](../../sources/claude-code/src/commands/review/reviewRemote.ts)

`checkOverageGate()` 先于 launch 执行，并明确分成四种结果：

- `proceed`
- `not-enabled`
- `low-balance`
- `needs-confirm`

这里的判断顺序也很产品化：

- Team / Enterprise 直接放行，不走 consumer quota 逻辑
- free review quota 未耗尽，附带“这是第几次免费 ultrareview”的 billing note
- quota 用尽但 utilization 拉取失败，也先放行，交给服务端兜底
- Extra Usage 未开启或余额过低，则直接在本地拦截

这说明 Claude Code 并不是“远端失败后再告诉你没配计费”，而是把 billing gate 提前到命令入口。

## 4. `UltrareviewOverageDialog` 不是普通确认框，而是可中断的 launch gate

源码镜像：[`../../sources/claude-code/src/commands/review/UltrareviewOverageDialog.tsx`](../../sources/claude-code/src/commands/review/UltrareviewOverageDialog.tsx), [`../../sources/claude-code/src/components/CustomSelect/select.tsx`](../../sources/claude-code/src/components/CustomSelect/select.tsx)

这个 dialog 用的是 `CustomSelect`，但它不是简单问一句 yes/no。

它有三个关键实现点：

- `AbortController` 在组件内常驻，Esc during launch 可以中断 in-flight `onProceed`
- `isLaunching` 让 UI 从 `Select` 切到 `Launching…` 文本，防止重复触发
- 只有 launch 非 aborted 时，外层才会 `confirmOverage()`，把“本会话已确认 overage”标志固化下来

这意味着 overage dialog 不是单纯展示法务文案，而是 launch 生命周期的一部分。

## 5. `launchRemoteReview()` 把 PR 模式和 branch 模式明确分流

源码镜像：[`../../sources/claude-code/src/commands/review/reviewRemote.ts`](../../sources/claude-code/src/commands/review/reviewRemote.ts)

这条函数最核心的分支是：

- `args` 是纯数字 → PR mode
- 否则 → branch mode

PR mode：

- 先 `detectCurrentRepositoryWithHost()`
- 必须是 `github.com`
- branchName 用 `refs/pull/<N>/head`
- environment variables 填 `BUGHUNTER_PR_NUMBER` 和 `BUGHUNTER_REPOSITORY`

branch mode：

- 先找默认分支
- 再做 `git merge-base <base> HEAD`
- 用 merge-base SHA 而不是 branch name 传给远端
- 空 diff 会在本地提前 bail out，不启动容器

所以远端 review 不只是“有无 PR 编号”的体验差异，而是两套不同的远端定位协议。

## 6. 远端环境变量不是装饰，而是 bughunter 行为控制面

源码镜像：[`../../sources/claude-code/src/commands/review/reviewRemote.ts`](../../sources/claude-code/src/commands/review/reviewRemote.ts)

`commonEnvVars` 明确带了：

- `BUGHUNTER_DRY_RUN`
- `BUGHUNTER_FLEET_SIZE`
- `BUGHUNTER_MAX_DURATION`
- `BUGHUNTER_AGENT_TIMEOUT`
- `BUGHUNTER_TOTAL_WALLCLOCK`

而且这些值不是盲信 GB 配置，而是经过 `posInt()` + 上限兜底。

注释直接点明了原因：

- 120s agent timeout 会让 verifier 中途被杀，出现无限 respawn
- total wallclock 必须小于本地 `RemoteAgentTask` 的 30min poll timeout，否则本地会永远等不到终态

这说明 `/ultrareview` 的远端参数并不是随便透传，而是被本地任务框架反向约束过。

## 7. 远端 launch 成功后，并不会立刻“把 review 文本返回给当前 turn”

源码镜像：[`../../sources/claude-code/src/commands/review/reviewRemote.ts`](../../sources/claude-code/src/commands/review/ultrareviewCommand.tsx)

远端 review 的首轮成功返回，实际上只是：

- 一个 session URL
- 一个后台任务注册结果
- 一段引导模型简短确认已发起的文本块

`launchAndDone()` 在本地会把 `ContentBlockParam[]` 转成字符串，并以 `shouldQuery: true` 交回会话。也就是说：

- 当前 turn 只负责告诉用户“远端 review 已经发起”
- 真正 findings 不是同步产出，而是稍后通过后台任务注入

因此 `/ultrareview` 在交互语义上更接近“submit job”而不是“run and wait”。

## 8. `registerRemoteAgentTask()` 是远端任务接回本地的统一入口

源码镜像：[`../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx)

无论是 remote-agent、ultraplan 还是 ultrareview，最终都要收敛到 `registerRemoteAgentTask()`。

它做的事情包括：

- 生成 `taskId`
- 先 `initTaskOutput(taskId)`，让 readers 有文件可读
- 构造 `RemoteAgentTaskState`
- `registerTask()` 写入统一任务系统
- `persistRemoteAgentMetadata()` 写 sidecar，供 `--resume` 复活
- 启动 polling

因此远端会话不是“命令执行完就没了”，而是被本地任务系统正式建模成可恢复对象。

## 9. `RemoteAgentTask` 的 polling 逻辑已经特化到 remote-review

源码镜像：[`../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx)

远端 review 不是 generic remote task 的薄封装，它有一套专门逻辑：

- `REMOTE_REVIEW_TIMEOUT_MS = 30min`
- `STABLE_IDLE_POLLS = 5`
- delta 扫描 `cachedReviewContent`
- `extractReviewTagFromLog()` 与 `extractReviewFromLog()` 双路径
- `reviewProgress` 从 orchestrator heartbeat echo 里解析

这里最重要的是 completion 条件不是单一的：

- bughunter path：等 `<remote-review>` tag
- prompt fallback path：没有 SessionStart hook，且 stable idle，且已有 assistant events
- 超时 path：30 分钟兜底失败

这说明远端 review 的“什么时候算完成”并不是读一个 status 字段，而是本地根据日志形态推断出来的。

## 10. review 结果回流不是写文件让模型自己找，而是直接注入 task-notification

源码镜像：[`../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx)

当 review 成功完成时，`enqueueRemoteReviewNotification()` 会直接向消息队列塞一条 task-notification：

- task id
- task type
- completed status
- “Remote review completed”
- review findings 正文

失败时也有专门的 `enqueueRemoteReviewFailureNotification()`，并且文案会明确提示：

- 重试 `/ultrareview`
- 或退回本地 `/review`

因此远端 review 的结果回流不是“用户自己点开 URL 去看”，而是主动注入回当前本地会话。

## 11. `BackgroundTasksDialog` 把 workflow、monitor、remote review 放进同一任务浏览面

源码镜像：[`../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx)

这个列表不是只看 agent / bash task。它的 `ListItem` 已经覆盖：

- `local_bash`
- `remote_agent`
- `local_agent`
- `in_process_teammate`
- `local_workflow`
- `monitor_mcp`
- `dream`

再加上动态 require：

- `WorkflowDetailDialog`
- `killWorkflowTask`
- `skipWorkflowAgent`
- `retryWorkflowAgent`
- `MonitorMcpDetailDialog`
- `killMonitorMcp`

说明 workflow 和 monitor 虽然不是每个 build 都启用，但一旦启用，就被正式纳入统一后台任务控制台。

## 12. Background Tasks 的排序和分组已经体现了产品层级

源码镜像：[`../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx)

它不是无脑按启动时间列一个列表，而是：

- 先按 `running` 优先
- 再按开始时间倒序
- 再分成 teammates / bash / monitor / remote / agent / workflow / dream

而且注释直接要求：

- `allSelectableItems` 的顺序必须和 JSX 渲染顺序一致
- 否则上下键移动会和视觉方向不一致

这说明后台任务列表本身就是一个经过精细交互设计的工作面，而不是 debug 面板。

## 13. workflow / monitor 的“工具主体”在当前镜像里仍然不是完全可见

源码镜像：[`../../sources/claude-code/src/components/permissions/PermissionRequest.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx), 源码入口：`packages/claude-code/src/tools/WorkflowTool/WorkflowTool.ts`, `packages/claude-code/src/tools/MonitorTool/MonitorTool.ts`

这里要明确一个边界：当前工作区镜像里，workflow 和 monitor 最完整可见的是：

- permission request 分派接缝
- Background Tasks list/detail/kill/skip/retry surface
- `WorkflowTool/constants.ts`

但完整 tool body 并没有像 `AskUserQuestion` 或 `Glob` 那样完整挂载出来。

所以这篇文档不会声称“workflow/monitor 的工具内部执行细节已完全拆明白”，只会确认：

- 它们确实被当成一等工具类型接进 permission system
- 它们确实会落到后台任务系统与 detail dialog
- 它们确实有 stop / skip / retry 这些 operator surface

这比把它们误写成“已经完整掌握”更准确。

## 14. `PermissionRequest` 证明 workflow 和 monitor 不是脚本私货，而是一等受控工具

源码镜像：[`../../sources/claude-code/src/components/permissions/PermissionRequest.tsx`](../../sources/claude-code/src/components/permissions/PermissionRequest.tsx)

`permissionComponentForTool()` 里直接做了：

- `WorkflowTool -> WorkflowPermissionRequest`
- `MonitorTool -> MonitorPermissionRequest`

这说明从权限治理视角看，workflow 和 monitor 都不是 Bash 的别名，而是单独命名、单独审批的工具类型。

这也解释了为什么它们会在 Background Tasks 里有自己专门的 detail dialog 与 task subtype。

## 15. 这一卷的结论

把这些文件连起来后，可以得到一个更准确的产品判断：

- 远端 review 是“计费门控 + teleport + remote task + async notification”的完整链
- workflow / monitor 是“feature-gated 但已经进入 permission + task + detail UI 体系”的工作面
- Background Tasks 并不是 agent 专用，而是 Claude Code 所有长生命周期执行面的统一控制台

所以这组能力的核心不在某个命令名，而在于 Claude Code 已经把“长任务”做成了一套可以发起、跟踪、恢复、停止、回流结果的运行时工作面。
