# Permission Request Queue / Dialog Surfaces

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Swarm Banner / Direct Messages / Mailbox Surfaces`](./24-swarm-banner-direct-messages-and-mailbox-surfaces.md) | [`下一站：Prompt Queue / Elicitation / Input Surfaces`](./26-prompt-queue-and-elicitation-input-surfaces.md)

本文不再讲 permission runtime 的 allow/deny/ask 装配，而是专门拆 ask 已经进入前台之后，Claude Code 怎样把它变成一套真实的 REPL 工作面：`toolUseConfirmQueue` 怎样被 REPL 排队、`focusedInputDialog` 怎样在多种对话框之间选优先级、`PermissionRequest.tsx` 怎样把 tool 映射到专用审批组件、`PermissionPrompt`/`PermissionDialog` 怎样形成共用交互骨架，以及文件类、计划类、sandbox 类请求为什么又各自长出不同表面。

## 1. 这层解决的是 ask 怎样被产品化成“一个当前焦点对话框”，而不是如何算出 ask

源码镜像：[`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx), [`../../sources/claude-code/src/components/permissions/PermissionRequest.tsx`](../../sources/claude-code/src/components/permissions/PermissionRequest.tsx), [`../../sources/claude-code/src/components/permissions/PermissionPrompt.tsx`](../../sources/claude-code/src/components/permissions/PermissionPrompt.tsx), [`../../sources/claude-code/src/components/permissions/PermissionDialog.tsx`](../../sources/claude-code/src/components/permissions/PermissionDialog.tsx), [`../../sources/claude-code/src/components/permissions/FilePermissionDialog/FilePermissionDialog.tsx`](../../sources/claude-code/src/components/permissions/FilePermissionDialog/FilePermissionDialog.tsx), [`../../sources/claude-code/src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx`](../../sources/claude-code/src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx), [`../../sources/claude-code/src/components/permissions/SandboxPermissionRequest.tsx`](../../sources/claude-code/src/components/permissions/SandboxPermissionRequest.tsx), [`../../sources/claude-code/src/components/Messages.tsx`](../../sources/claude-code/src/components/Messages.tsx)

前几卷已经把这些讲清了：

- `useCanUseTool()` 如何把 ask 分流给 coordinator、swarm worker、interactive handler
- worker permission 与 sandbox permission 怎样通过 mailbox 和 queue 回执

这一卷继续回答更靠 UI 的问题：

- REPL 同时有 tool permission、prompt、sandbox、worker sandbox、elicitation 时谁先显示
- 为什么 tool permission 不是一个巨型组件，而是 `PermissionRequest -> specialized component`
- 为什么文件类请求和计划类请求会有自己的二级框架
- 为什么 `Messages` 会因为 permission queue 非空而停掉动画

所以这篇是 permission front-end orchestration layer。

## 2. `REPL` 真正管理的不是一个权限弹窗，而是多条并行等待队列

源码镜像：[`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx)

前台至少同时维护这些等待源：

- `toolUseConfirmQueue`
- `promptQueue`
- `sandboxPermissionRequestQueue`
- `workerSandboxPermissions.queue`
- `elicitation.queue`
- `pendingWorkerRequest`
- `pendingSandboxRequest`

这说明 Claude Code 的前台并不把 permission 简化成“有无弹窗”布尔值，而是把不同 ask 来源保留成不同语义队列，再由 REPL 统一仲裁当前焦点表面。

## 3. `isWaitingForApproval` 和 `waitingFor` 说明 ask 会直接改写整场会话的顶层状态

源码镜像：[`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx)

REPL 把下面这些都视为 waiting：

- `toolUseConfirmQueue.length > 0`
- `promptQueue.length > 0`
- `pendingWorkerRequest`
- `pendingSandboxRequest`

并且会派生出：

- `sessionStatus = 'waiting'`
- `waitingFor = approve <tool> / worker request / sandbox request / dialog open / input needed`

这说明 permission dialog 不是 transcript 里的局部浮层，而是会把整个 session 从 busy/idle 切换成 waiting。

## 4. `getFocusedInputDialog()` 说明真正的前台协议是“多类对话框优先级排序”，不是谁先入队谁先显示

源码镜像：[`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx)

这条优先级链至少显式区分了：

- message selector
- sandbox permission
- tool permission
- prompt
- worker sandbox permission
- elicitation
- cost / idle-return / ultraplan / onboarding / callout / recommendation

还有两条关键门控：

- `isPromptInputActive` 时 suppress 部分 dialog
- `allowDialogsWithAnimation = !toolJSX || toolJSX.shouldContinueAnimation`

所以 REPL 不是“谁请求就立刻抢屏”，而是一个 dialog scheduler。

## 5. `PermissionRequest.tsx` 只是入口路由器，不是审批逻辑本体

源码镜像：[`../../sources/claude-code/src/components/permissions/PermissionRequest.tsx`](../../sources/claude-code/src/components/permissions/PermissionRequest.tsx)

它主要干三件事：

- 把 `Ctrl+C` 绑定成 reject/abort
- 在超时后触发 attention notification
- 根据 `tool` 选择真正的专用 permission component

核心分发表是：

- `FileEditTool -> FileEditPermissionRequest`
- `FileWriteTool -> FileWritePermissionRequest`
- `BashTool -> BashPermissionRequest`
- `PowerShellTool -> PowerShellPermissionRequest`
- `WebFetchTool -> WebFetchPermissionRequest`
- `NotebookEditTool -> NotebookEditPermissionRequest`
- `ExitPlanModeV2Tool -> ExitPlanModePermissionRequest`
- `EnterPlanModeTool -> EnterPlanModePermissionRequest`
- `SkillTool -> SkillPermissionRequest`
- `AskUserQuestionTool -> AskUserQuestionPermissionRequest`
- `Glob/Grep/FileRead -> FilesystemPermissionRequest`
- feature-gated `ReviewArtifact / Workflow / Monitor`
- 其余一律落到 `FallbackPermissionRequest`

源码里还留着一句重要注释：

- `TODO: Move this to Tool.renderPermissionRequest`

这说明当前架构仍然是中心路由表，而不是每个 Tool 自带 renderer。

## 6. `ToolUseConfirm` 才是 tool permission queue 的真正协议对象

源码镜像：[`../../sources/claude-code/src/components/permissions/PermissionRequest.tsx`](../../sources/claude-code/src/components/permissions/PermissionRequest.tsx)

这份对象同时承载：

- 展示数据：`assistantMessage`、`description`、`input`、`toolUseID`
- 决策结果：`permissionResult`
- 生命周期：`permissionPromptStartTimeMs`
- classifier UI 状态：`classifierCheckInProgress`、`classifierAutoApproved`、`classifierMatchedRule`
- swarm 标识：`workerBadge`
- 前台回调：`onUserInteraction / onAbort / onDismissCheckmark / onAllow / onReject / recheckPermission`

这说明 REPL 队列里排队的并不是“待确认工具名”，而是一份把运行时和前台彻底绑在一起的 dialog session object。

## 7. `Messages` 会在 `toolUseConfirmQueue` 非空时停掉动画，说明权限等待会反向约束 transcript 表现

源码镜像：[`../../sources/claude-code/src/components/Messages.tsx`](../../sources/claude-code/src/components/Messages.tsx)

`Messages` 里的 `canAnimate` 条件明确要求：

- 没有 `toolUseConfirmQueue`
- 没有 message selector
- `toolJSX` 允许继续动画

这说明 permission prompt 不是只影响 overlay 本身，它还会反向要求 transcript 停住，避免在用户决策时继续做前台动画。

## 8. `PermissionDialog`、`PermissionRequestTitle`、`WorkerBadge` 组成了权限 UI 的共用 chrome

源码镜像：[`../../sources/claude-code/src/components/permissions/PermissionDialog.tsx`](../../sources/claude-code/src/components/permissions/PermissionDialog.tsx), [`../../sources/claude-code/src/components/permissions/PermissionRequestTitle.tsx`](../../sources/claude-code/src/components/permissions/PermissionRequestTitle.tsx), [`../../sources/claude-code/src/components/permissions/WorkerBadge.tsx`](../../sources/claude-code/src/components/permissions/WorkerBadge.tsx)

它们分工很明确：

- `PermissionDialog`：上边框、标题行、内容区 padding、`titleRight`
- `PermissionRequestTitle`：标题、副标题、worker 名字的轻量呈现
- `WorkerBadge`：彩色 `@worker` 身份徽章

这里有个细节值得单独记住：

- 标题处只显示 dim 的 `@worker.name`
- 真正彩色 badge 多数出现在更具体的专用 permission surface 里

所以 swarm worker 的身份展示也分了“标题压缩态”和“详细内容态”两层。

## 9. `PermissionPrompt` 是通用选择器骨架，不只是 Yes/No 列表

源码镜像：[`../../sources/claude-code/src/components/permissions/PermissionPrompt.tsx`](../../sources/claude-code/src/components/permissions/PermissionPrompt.tsx)

它统一处理了：

- question 文本
- Select 选项渲染
- `feedbackConfig` 驱动的 accept/reject 输入模式
- `Tab` 进入或折叠反馈输入
- `Esc` 取消
- option-level keybinding
- analytics 事件
- attribution 的 `escapeCount`

最关键的协议是：

- 某个选项可以声明 `feedbackConfig.type = accept/reject`
- 然后 `Select` 在 input mode 下不再只是普通 option，而会变成 inline input row

这说明 Claude Code 的权限 prompt 并不是后面随便拼一个输入框，而是把“附带给 Claude 的修正反馈”建模成了选项状态机的一部分。

## 10. `usePermissionRequestLogging()` 说明每个权限 surface 在挂载时都会统一做 attribution 和 unary logging

源码镜像：[`../../sources/claude-code/src/components/permissions/hooks.ts`](../../sources/claude-code/src/components/permissions/hooks.ts)

这条 hook 至少做三件事：

- `permissionPromptCount + 1`
- 记录 `tengu_tool_use_show_permission_request`
- 发送 unary `response` 事件

并且它特地用 `loggedToolUseID` 防止同一 dialog 生命周期里重复触发 effect。

这说明 permission UI 在 Claude Code 里不是无状态展示层，而是 analytics/attribution 的一等写点。

## 11. `FallbackPermissionRequest` 说明 generic tool ask 仍然支持反馈、always allow、worker badge 和 rule explanation

源码镜像：[`../../sources/claude-code/src/components/permissions/FallbackPermissionRequest.tsx`](../../sources/claude-code/src/components/permissions/FallbackPermissionRequest.tsx)

它不是一个最简兜底壳，而是完整具备：

- `Yes`
- `Yes, and don't ask again`
- `No`
- accept/reject feedback
- `PermissionRuleExplanation`
- tool analytics context

而 “don’t ask again” 最终会被编码成：

- `addRules`
- `behavior: 'allow'`
- `destination: 'localSettings'`

这说明 generic path 也不是纯展示 fallback，而是完整的本地权限规则写入入口。

## 12. `FilePermissionDialog` 是文件类权限族的共享宿主，不只是一个样式组件

源码镜像：[`../../sources/claude-code/src/components/permissions/FilePermissionDialog/FilePermissionDialog.tsx`](../../sources/claude-code/src/components/permissions/FilePermissionDialog/FilePermissionDialog.tsx)

它把多类文件相关工具统一到了同一套宿主协议里：

- language name / completion type logging
- symlink target 警告
- `useFilePermissionDialog(...)` 产出的 options / feedback / focus state
- IDE diff 模式与 `ShowInIDEPrompt`
- 共享 `PermissionDialog` chrome

这说明 `FileEditPermissionRequest`、`FileWritePermissionRequest`、`NotebookEditPermissionRequest` 等工具，并不是各写一整套审批 UI，而是共享了一个专门面向 file-operation 的中层框架。

## 13. `ExitPlanModePermissionRequest` 说明有些权限 surface 已经超出“确认一次工具调用”，变成完整工作流对话框

源码镜像：[`../../sources/claude-code/src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx`](../../sources/claude-code/src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx), [`../../sources/claude-code/src/components/FullscreenLayout.tsx`](../../sources/claude-code/src/components/FullscreenLayout.tsx)

这块最特别的地方有三层：

- 它可能展示当前 plan、上下文占用、allowed prompts、auto-mode 选项、Ultraplan 分流
- 支持 `Ctrl+G` 外部编辑器修改 plan
- 支持 `setStickyFooter(...)` 把操作选项固定在 fullscreen 底部

所以它已经不是普通 permission card，而是一个 permission-gated workflow console。

这也解释了为什么 `PermissionRequestProps` 里会特地多出：

- `setStickyFooter?: (jsx | null) => void`

这个能力不是给所有工具用的，而是为 plan approval 这种“正文很长但选项必须常驻”场景保留的 fullscreen 接缝。

## 14. `SandboxPermissionRequest` 故意不走 `ToolUseConfirm`，说明网络 host 审批在前台也被视为另一种协议

源码镜像：[`../../sources/claude-code/src/components/permissions/SandboxPermissionRequest.tsx`](../../sources/claude-code/src/components/permissions/SandboxPermissionRequest.tsx), [`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx)

它直接接收的是：

- `hostPattern`
- `onUserResponse({ allow, persistToSettings })`

而不是 `toolUseConfirm`.

REPL 里也专门有两类 sandbox dialog：

- `sandbox-permission`
- `worker-sandbox-permission`

这说明网络 host approval 在前台不是普通 tool permission 的变体，而是另一条独立的 ask surface，只是复用了 `PermissionDialog + Select` 这种低层视觉骨架。

## 15. `toolPermissionOverlay` 说明 fullscreen 下 tool permission 是 overlay，而 pending worker/sandbox waiting card 仍在 bottom surface

源码镜像：[`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx)

REPL 在 fullscreen 下会把：

- 当前 `PermissionRequest`

装进 `FullscreenLayout.overlay`。

但下面这些等待态仍然走 bottom 区域：

- `WorkerPendingPermission`
- worker-side pending sandbox wait
- `SandboxPermissionRequest`
- `PromptDialog`

这说明 Claude Code 没把所有“需要批准”的 UI 统一塞进一个 modal slot，而是按照交互语义继续分层：

- 当前可操作的 tool permission -> overlay
- worker 自己的等待卡片 -> bottom
- 某些 network/prompt surface -> bottom dialog band

## 16. 这条架构最终说明 permission front-end 真正由六段拼起来

源码镜像：[`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx), [`../../sources/claude-code/src/components/permissions/PermissionRequest.tsx`](../../sources/claude-code/src/components/permissions/PermissionRequest.tsx), [`../../sources/claude-code/src/components/permissions/PermissionPrompt.tsx`](../../sources/claude-code/src/components/permissions/PermissionPrompt.tsx), [`../../sources/claude-code/src/components/permissions/PermissionDialog.tsx`](../../sources/claude-code/src/components/permissions/PermissionDialog.tsx), [`../../sources/claude-code/src/components/permissions/FilePermissionDialog/FilePermissionDialog.tsx`](../../sources/claude-code/src/components/permissions/FilePermissionDialog/FilePermissionDialog.tsx), [`../../sources/claude-code/src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx`](../../sources/claude-code/src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx), [`../../sources/claude-code/src/components/permissions/SandboxPermissionRequest.tsx`](../../sources/claude-code/src/components/permissions/SandboxPermissionRequest.tsx), [`../../sources/claude-code/src/components/Messages.tsx`](../../sources/claude-code/src/components/Messages.tsx)

真正叠在一起工作的是：

- 队列/优先级宿主：`REPL`
- tool 路由器：`PermissionRequest`
- 共用交互骨架：`PermissionPrompt`
- 共用视觉 chrome：`PermissionDialog` + `PermissionRequestTitle`
- 文件族中层宿主：`FilePermissionDialog`
- 工作流级特化 surface：`ExitPlanModePermissionRequest`

因此 Claude Code 的权限前台并不是“一个弹窗配一堆 if”，而是由 REPL 统一调度、由 `ToolUseConfirm` 传递生命周期、再由不同中层宿主和专用组件落地成多种 ask surface 的分层系统。
