# ExitPlanMode / Partially Visible ReviewArtifact Operator Loops

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：AskUserQuestion Schema / Preview / Operator Loop Runtime`](./68-ask-user-question-schema-preview-and-operator-loop-runtime.md) | [`下一站：Permission Runtime / Hooks / Classifier / Dialog Pipeline`](./23-permission-runtime-hooks-classifier-and-dialog-pipeline.md)

[`68`](./68-ask-user-question-schema-preview-and-operator-loop-runtime.md) 已经把 `AskUserQuestion` 拆成了一条完整的 `requiresUserInteraction()` operator loop。本篇继续把同类工具里证据最完整的一条 `ExitPlanMode` 单独讲开，同时把当前镜像里只能看到接缝、看不到主体的 `ReviewArtifact` 明确降级处理。

这一卷只讲两件事：

- `ExitPlanMode` 为什么不是普通“确认退出”按钮，而是 plan-mode 到 execution-mode 的运行时切换器
- `ReviewArtifact` 当前到底能证实到哪一层，哪些部分不能硬写

## 1. `ExitPlanMode` 的产品定位不是“确认一下”，而是把整个会话从 planning 切到 execution

源码镜像：[`../../src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`](../../src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts)

这条工具最关键的定义不是 prompt 文案，而是这些运行时声明：

- `shouldDefer: true`
- `requiresUserInteraction()` 对非 teammate 返回 `true`
- `validateInput()` 强制 `mode === 'plan'`
- `checkPermissions()` 对非 teammate 返回 `ask`

这说明它不是普通工具族里的一个“ask once and continue”节点，而是：

- 只允许在 plan mode 出现
- 一定会中断自动推进
- 必须拿到用户或 leader 的明确确认
- 确认之后会改写 permission mode / context-clear 路径 / 后续 initial message

所以它本质上是一个 phase transition operator。

## 2. 这条工具从一开始就被设计成“宿主敏感”的 operator loop

源码镜像：[`../../src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`](../../src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts)

`isEnabled()` 里有 channels gate：

- `KAIROS` / `KAIROS_CHANNELS` 开启
- 且 `getAllowedChannels().length > 0`

时直接禁用。注释解释得很清楚：

- 用户可能在 Telegram/Discord，不在 TUI 前
- plan approval dialog 会挂住

这和 `AskUserQuestion` 的 host 假设一致：它要求“此刻有人能真正参与确认”。因此 `ExitPlanMode` 不是 headless-safe 控制面，而是现场 operator surface。

## 3. `requiresUserInteraction()` 在这里不是简单布尔值，而是 leader-approval / local-confirmation 的分叉开关

源码镜像：[`../../src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`](../../src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts)

它的规则是：

- `isTeammate() === true` 时返回 `false`
- 其他情况返回 `true`

但这不代表 teammate 不需要审批。真正含义是：

- 非 teammate：本地用户在 permission queue 中审批
- teammate：不走本地 dialog，而是由 `call()` 内部决定是否转成 `plan_approval_request` 发给 team lead

所以这里的 `requiresUserInteraction()` 更像“本地宿主需不需要开 dialog”，而不是“这件事是否需要人类批准”。

## 4. teammate 分支的真实宿主不是 permission dialog，而是 mailbox-based leader approval

源码镜像：[`../../src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`](../../src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts)

当同时满足：

- `isTeammate()`
- `isPlanModeRequired()`

时，`call()` 不会直接退出 plan mode，而是：

- 生成 `requestId`
- 构造 `plan_approval_request`
- 通过 `writeToMailbox('team-lead', ...)` 发给 leader
- 对 in-process teammate 调 `setAwaitingPlanApproval(...)`
- 返回 `awaitingLeaderApproval: true`

也就是说，teammate 的 `ExitPlanMode` 不是“请求本地用户同意”，而是“把计划提交给 leader，自己进入 waiting 状态”。

## 5. `mapToolResultToToolResultBlockParam()` 暴露了这条工具的三种完全不同 continuation 语义

源码镜像：[`../../src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`](../../src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts)

它至少分出四类结果：

- `awaitingLeaderApproval`
- `isAgent`
- empty plan
- normal approved plan

含义完全不同：

- `awaitingLeaderApproval`：明确要求 worker 不要继续，实现上是“停机等待 leader inbox 回复”
- `isAgent`：给出极短 `"ok"` continuation，表示子 agent 本轮工作结束
- empty plan：只表示用户允许退出 plan mode
- normal approved plan：把 plan 重新塞回 tool_result，让后续 execution 明确以这份 plan 为依据

这说明 `ExitPlanMode` 不是单一 bool 审批，而是一个多分支 continuation protocol。

## 6. 本地结果 UI 也不是一个模板，而是显式区分 empty / awaiting-leader / approved / rejected

源码镜像：[`../../src/tools/ExitPlanModeTool/UI.tsx`](../../src/tools/ExitPlanModeTool/UI.tsx)

`renderToolResultMessage(...)` 和 `renderToolUseRejectedMessage(...)` 清楚分出：

- `Exited plan mode`
- `Plan submitted for team lead approval`
- `User approved Claude's plan`
- `RejectedPlanMessage`

其中 `awaitingLeaderApproval` 还会额外显示：

- `Plan file: ...`
- `Waiting for team lead to review and approve...`

所以 `tool_result` 的逻辑分叉在前台是可见的，不只是内部状态。

## 7. 本地 permission dialog 不是单个 yes/no 选择，而是一整套 plan handoff 控制台

源码镜像：[`../../src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx`](../../src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx)

这条 dialog 真正管理的是：

- `planFeedback`
- pasted image attachments
- clear-context 与 keep-context 分支
- auto / bypass / accept-edits / default mode 选择
- `ultraplan` handoff
- external editor handoff
- sticky footer / non-sticky footer 两套布局

因此它不是“批准计划”的小组件，而是一个 execution handoff console。

## 8. `Ctrl+G` 外部编辑不是附加功能，而是这条 operator loop 的正式输入通道

源码镜像：[`../../src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx`](../../src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx), [`../../src/utils/promptEditor.ts`](../../src/utils/promptEditor.ts)

`handleKeyDown(...)` 里，`Ctrl+G` 会走两条不同路径：

- V2 且有 `planFilePath`：`editFileInEditor(planFilePath)`
- 否则：`editPromptInEditor(currentPlan)`

编辑后会：

- 更新 `currentPlan`
- 标记 `planEditedLocally`
- 显示 `Plan saved!`

这说明 dialog 不是只消费 plan，而是允许用户在审批边界上直接重写它。

## 9. `Shift+Tab` 和 `No + feedback` 让它具备了“快速放行”与“计划返工”两条并列反馈路径

源码镜像：[`../../src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx`](../../src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx)

这里至少有两种典型操作：

- `Shift+Tab`：直接用当前 feedback 走 accept 路线
- `No, keep planning`：把文字反馈和图片反馈退回模型

所以这不是死板审批，而是把“计划编辑意见”直接装配进 tool-result continuation / reject path。

## 10. `ultraplan` 不是普通 option，而是一个“本地 reject + 远端 refinement launch”的旁路

源码镜像：[`../../src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx`](../../src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx), [`../../src/commands/ultraplan.tsx`](../../src/commands/ultraplan.tsx)

当用户选 `ultraplan`：

- 先 `onDone()`
- 再 `onReject()`
- 再 `toolUseConfirm.onReject(...)`
- 然后异步 `launchUltraplan({ seedPlan: currentPlan, ... })`

这个顺序很关键。它说明：

- 本地 query loop 先解阻塞
- 本地这次 `ExitPlanMode` 记为未通过
- 真正的 refinement 在远端 CCR session 继续

所以 `ultraplan` 不是 plan approval 的变体，而是 operator handoff 到另一宿主。

## 11. clear-context acceptance 与 keep-context acceptance 是两条不同执行协议

源码镜像：[`../../src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx`](../../src/bootstrap/state.ts)

`handleResponse(...)` 里，最关键的分叉不是按钮文案，而是：

- `isKeepContextOption`

如果是 clear-context：

- 写 `initialMessage`
- 带上 `planContent`
- 记录 `allowedPrompts`
- `toolUseConfirm.onReject()` 解除当前 query loop
- 让 REPL 在清上下文后启动 fresh query

如果是 keep-context：

- 直接 `toolUseConfirm.onAllow(...)`
- 可附带 `buildPermissionUpdates(...)`
- 当前上下文继续推进

这说明 `ExitPlanMode` 其实是在决定“下一轮 execution 是续在原会话，还是通过 session handoff 重启一轮”。

## 12. `buildPermissionUpdates(...)` 说明这条工具还承担 classifier permission rule materialization

源码镜像：[`../../src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx`](../../src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx), [`../../src/utils/permissions/bashClassifier.ts`](../../src/utils/permissions/bashClassifier.ts)

如果 classifier permission 开启，且 plan 带了 `allowedPrompts`：

- `buildPermissionUpdates(...)` 会生成 `addRules`
- 把 semantic prompt rule 变成 session permission update

也就是说，plan approval 不只是在说“允许开始实现”，还可能顺便把实现期的一部分 Bash 权限规则落到 session policy 里。

## 13. empty-plan 分支是特判，不共享完整版 plan approval console

源码镜像：[`../../src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx`](../../src/tools/ExitPlanModeTool/UI.tsx)

当 plan 为空时：

- 权限面只显示简化版 `Yes / No`
- allow 直接发 `setMode(default)`
- result UI 也只显示 `Exited plan mode`

这说明实现里已经明确承认“没有 plan 也能退出”，但它不走完整批准协议。

## 14. `ReviewArtifact` 在当前镜像里只能确认到 permission 接缝，不能伪装成完整实现

源码镜像：[`../../src/components/permissions/PermissionRequest.tsx`](../../src/components/permissions/PermissionRequest.tsx), [`../../src/hooks/toolPermission/handlers/interactiveHandler.ts`](../../src/hooks/toolPermission/handlers/interactiveHandler.ts)

当前镜像里，`ReviewArtifact` 可见的事实只有：

- `PermissionRequest.tsx` 懒加载 `ReviewArtifactTool`
- 同时懒加载 `ReviewArtifactPermissionRequest`
- 专门的通知文案：`Claude needs your approval for a review artifact`
- `interactiveHandler.ts` 明确提到：
  - 本地 dialog 会注入字段
  - 远端 generic approval 可能拿不到这些字段
  - 工具必须容忍字段缺失、优雅退化

但这些文件当前看不到：

- `tools/ReviewArtifactTool/ReviewArtifactTool`
- `components/permissions/ReviewArtifactPermissionRequest/ReviewArtifactPermissionRequest`

因此这条链现在只能写成“部分可见 sibling operator loop”，不能写成主体已拆明白。

## 15. `interactiveHandler` 明确把 `ExitPlanMode / AskUserQuestion / ReviewArtifact` 视为同一类工具

源码镜像：[`../../src/hooks/toolPermission/handlers/interactiveHandler.ts`](../../src/hooks/toolPermission/handlers/interactiveHandler.ts)

注释里有一条很关键的说明：

- today 的 `requiresUserInteraction` 工具共有三类：
  - `ExitPlanMode`
  - `AskUserQuestion`
  - `ReviewArtifact`

这让我们可以比较精确地给它们分层：

- `AskUserQuestion`：主体完整可见
- `ExitPlanMode`：主体完整可见
- `ReviewArtifact`：只有 permission 接缝与降级语义可见

这也是本篇采用“完整实现 + 部分可见 sibling”写法的依据。

## 16. 本篇和 `25`、`23`、`68` 的边界

[`../architecture/25-permission-request-queue-and-dialog-surfaces.md`](../architecture/25-permission-request-queue-and-dialog-surfaces.md) 讲的是：

- permission queue 外壳
- 各类 dialog 的共用壳体

[`./23-permission-runtime-hooks-classifier-and-dialog-pipeline.md`](./23-permission-runtime-hooks-classifier-and-dialog-pipeline.md) 讲的是：

- hook / classifier / dialog 的总装配线

[`./68-ask-user-question-schema-preview-and-operator-loop-runtime.md`](./68-ask-user-question-schema-preview-and-operator-loop-runtime.md) 讲的是：

- AskUserQuestion 这一类工具中的完整 schema/preview/operator loop

本篇只聚焦：

- `ExitPlanMode` 这条最复杂的 plan-to-execution operator loop
- `ReviewArtifact` 在当前镜像里到底能看到什么、看不到什么

## 17. 一句话结论

`ExitPlanMode` 在 Claude Code 里不是“计划写完了吗”的确认框，而是一个完整的 execution handoff runtime：

- 非 teammate 走本地 plan approval console
- teammate 走 mailbox-based leader approval
- clear-context / keep-context / auto / bypass / ultraplan 是不同 continuation protocol
- 它还顺带承接了 plan edit、semantic permission rule materialization、fresh-query handoff

而 `ReviewArtifact` 当前只能确认到：它属于同一个 `requiresUserInteraction` 家族，拥有专用 permission surface 和远端降级语义，但主体工具实现不在当前源码镜像里，不能被写成已完全拆明白。
