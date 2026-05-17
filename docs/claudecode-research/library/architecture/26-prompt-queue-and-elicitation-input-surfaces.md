# Prompt Queue / Elicitation / Input Surfaces

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Permission Request Queue / Dialog Surfaces`](./25-permission-request-queue-and-dialog-surfaces.md) | [`下一站：Message Selector / Idle Return / Recommendation Dialogs`](./27-message-selector-idle-return-and-recommendation-dialogs.md)

本文继续沿着 ask 前台往下拆，但不再讲 tool permission，而是专门拆 Claude Code 里另一类“需要用户现在给输入”的表面链：`promptQueue` 怎样把 hook prompt 变成选择对话框，`elicitation.queue` 怎样把 MCP form / URL elicitations 变成两阶段输入工作面，以及 REPL 为什么把这些都归进统一的 `input needed` waiting 状态。

## 1. 这层解决的是“Claude 现在需要你给结构化输入”如何被产品化，而不是 tool allow/deny

源码镜像：[`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx), [`../../src/components/hooks/PromptDialog.tsx`](../../src/components/hooks/PromptDialog.tsx), [`../../src/components/mcp/ElicitationDialog.tsx`](../../src/components/mcp/ElicitationDialog.tsx), [`../../src/services/mcp/client.ts`](../../src/services/mcp/client.ts), [`../../src/services/mcp/elicitationHandler.ts`](../../src/services/mcp/elicitationHandler.ts), [`../../src/utils/mcp/elicitationValidation.ts`](../../src/utils/mcp/elicitationValidation.ts), [`../../src/types/hooks.ts`](../../src/types/hooks.ts)

上一卷已经把 tool permission 讲清了，这一卷回答的是另一组问题：

- hook prompt 为什么不是普通 transcript 消息，而是 `promptQueue -> PromptDialog`
- MCP elicitation 为什么不是一个简单输入框，而是 `form` 和 `url` 两条完全不同的前台协议
- 为什么这些表面都会让 session 进入 `waitingFor = input needed`
- URL elicitation 为什么会出现“phase 1 同意打开浏览器，phase 2 等待服务器确认完成”的双阶段行为

所以这篇是 Claude Code 的 input-needed front-end protocol。

## 2. `promptQueue` 和 `elicitation.queue` 说明 REPL 把“要用户输入”建模成两类显式队列

源码镜像：[`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx)

REPL 里至少有两条和输入需求直接相关的等待源：

- `promptQueue`
- `elicitation.queue`

它们都不和 transcript 混写，也不偷渡进普通 `toolUseConfirmQueue`。前者承载本地 hook prompt，后者承载 MCP 服务器提出的结构化输入请求。

这说明 Claude Code 不把 “需要用户说点什么” 视为单一弹窗，而是先保留来源语义，再由 REPL 决定如何前台化。

## 3. `waitingFor = input needed` 说明这类 ask 会直接抬升成会话级等待态

源码镜像：[`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx)

REPL 里：

- `isWaitingForApproval = toolUseConfirmQueue.length > 0 || promptQueue.length > 0 || pendingWorkerRequest || pendingSandboxRequest`
- `sessionStatus = 'waiting'`
- 当不是 tool / worker / sandbox / local JSX 时，`waitingFor` 会退化成 `input needed`

也就是说，prompt / elicitation 这类输入需求不是普通 UI 边角料，而是会直接改写 `claude ps` 可见的 session 状态。

## 4. `getFocusedInputDialog()` 里 `prompt` 和 `elicitation` 被放在同一条 interactive dialog 优先级带

源码镜像：[`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx)

在 REPL 的 dialog scheduler 里：

- `tool-permission`
- `prompt`
- `worker-sandbox-permission`
- `elicitation`

属于同一段 “allowDialogsWithAnimation” 优先级带。

关键约束有两个：

- `isPromptInputActive` 时直接 suppress 这些 dialog
- `allowDialogsWithAnimation = !toolJSX || toolJSX.shouldContinueAnimation`

这说明 prompt / elicitation 不是随时强抢焦点，而是和 permission dialog 一样，要经过 REPL 的统一焦点仲裁。

## 5. `requestPrompt()` 说明 hook prompt 的运行时协议极轻，但被 REPL 包成了真实队列

源码镜像：[`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx), [`../../src/types/hooks.ts`](../../src/types/hooks.ts)

`requestPrompt()` 的核心只是把一个 `PromptRequest` 压进 `promptQueue`：

- `request`
- `title`
- `toolInputSummary`
- `resolve`
- `reject`

而 `PromptRequest` 自身也很轻：

- `prompt`: request id
- `message`
- `options[] = { key, label, description? }`

返回值 `PromptResponse` 也只有：

- `prompt_response`
- `selected`

所以 hook prompt 的底层协议其实极简，但 REPL 在前台给它补了排队、标题、摘要、键盘中断和 waiting 状态。

## 6. `PromptDialog` 说明 hook prompt 被刻意做成“PermissionDialog 风格的选择面”，而不是独立视觉语言

源码镜像：[`../../src/components/hooks/PromptDialog.tsx`](../../src/components/hooks/PromptDialog.tsx)

`PromptDialog` 几乎没有自己的复杂状态机，它只做几件事：

- 把 `app:interrupt` 绑定到 `onAbort`
- 把 `request.options` 映射成 `Select` 选项
- 把 `toolInputSummary` 挂进 `titleRight`
- 用 `PermissionDialog` 统一外壳承载

这说明 Claude Code 故意让 “hook 需要你选一个选项” 和 “tool 需要你批准一个动作” 共用同一套 dialog chrome，减少前台语义分裂。

## 7. `PromptDialog` 的响应模型是单阶段的：选中即 resolve，取消即 reject

源码镜像：[`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx), [`../../src/components/hooks/PromptDialog.tsx`](../../src/components/hooks/PromptDialog.tsx)

REPL 对 `focusedInputDialog === 'prompt'` 的处理非常直接：

- `onRespond` 时返回 `{ prompt_response, selected }`
- 然后 `setPromptQueue(([, ...tail]) => tail)`
- `onAbort` 时 `reject(new Error('Prompt cancelled by user'))`
- 然后同样出队

这和 URL elicitation 的两阶段协议完全不同。Prompt queue 是一次性、同步、选完即结束的表面。

## 8. `promptQueueUseCount` 说明 prompt queue 还是一个被显式统计的产品行为

源码镜像：[`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx), [`../../src/utils/config.ts`](../../src/utils/config.ts)

REPL 会在 queued commands 从空变非空时做一次：

- `saveGlobalConfig({ promptQueueUseCount: current + 1 })`

源码注释明确说这是为了：

- 只在 transition 上计数
- 避免 render thrash 造成 `~/.claude.json` 写爆和锁竞争

这说明 Claude Code 不只是“有 prompt queue”，还把它当作值得长期度量的交互能力。

## 9. `ElicitationDialog` 先按 `mode` 把请求分裂成 `form` 和 `url` 两套前台协议

源码镜像：[`../../src/components/mcp/ElicitationDialog.tsx`](../../src/components/mcp/ElicitationDialog.tsx), [`../../src/services/mcp/elicitationHandler.ts`](../../src/services/mcp/elicitationHandler.ts)

`ElicitationDialog` 的第一层分流不是字段类型，而是整个交互模式：

- `event.params.mode === 'url' -> ElicitationURLDialog`
- 其他情况 -> `ElicitationFormDialog`

这很重要，因为 MCP elicitation 在 Claude Code 里不是“通用表单 + 特殊字段”，而是至少两类完全不同的人机协议：

- URL 模式：先让用户离开终端去完成外部动作
- Form 模式：直接在 REPL 里完成结构化填写

## 10. `registerElicitationHandler()` 说明 REPL 模式下的 elicitation 本质是服务端请求被排进前台队列

源码镜像：[`../../src/services/mcp/elicitationHandler.ts`](../../src/services/mcp/elicitationHandler.ts)

MCP 客户端注册 `ElicitRequestSchema` 后，REPL 路径会：

- 先跑 elicitation hooks
- hook 没接住时，把事件追加进 `elicitation.queue`
- 给每个事件附上 `respond()`
- URL 模式下还可能附 `waitingState`

队列项 `ElicitationRequestEvent` 至少包含：

- `serverName`
- `requestId`
- `params`
- `signal`
- `respond`
- `waitingState?`
- `onWaitingDismiss?`
- `completed?`

这说明 elicitation 不是组件内私有状态，而是完整的 RPC -> app state -> dialog surface 流水线。

## 11. URL elicitation 是双阶段协议：phase 1 同意打开，phase 2 等服务器确认或用户重试/取消

源码镜像：[`../../src/services/mcp/client.ts`](../../src/services/mcp/client.ts), [`../../src/services/mcp/elicitationHandler.ts`](../../src/services/mcp/elicitationHandler.ts)

URL elicitation 有一条关键特殊逻辑：

- phase 1：用户 `accept` 打开 URL
- 但 `respond({ action: 'accept' })` 可能是 no-op，不立即 resolve
- queue 项保留在前台，进入 waiting state
- phase 2：服务器发 `ElicitationCompleteNotification`
- 或用户主动 `dismiss / retry / cancel`

在 error-retry 场景里，这条 waiting state 还会显式配置：

- `actionLabel: 'Retry now'`
- `showCancel: true`

普通 URL elicitation 则更像：

- `actionLabel: 'Skip confirmation'`

所以 URL elicitation 的核心不是“给个链接”，而是“终端前台和外部浏览器动作之间的两阶段握手”。

## 12. `ElicitationFormDialog` 不是简易表单，而是带 schema-aware 导航、异步解析和 overlay 管理的重型工作面

源码镜像：[`../../src/components/mcp/ElicitationDialog.tsx`](../../src/components/mcp/ElicitationDialog.tsx)

`ElicitationFormDialog` 自己管了大量状态：

- `focusedButton`
- `formValues`
- `validationErrors`
- `currentFieldIndex`
- `textInputValue`
- `textInputCursorOffset`
- `resolvingFields`
- `expandedAccordion`
- `accordionOptionIndex`

并且还接入了：

- `useRegisterOverlay('elicitation')`
- `useNotifyAfterTimeout('Claude Code needs your input', 'elicitation_dialog')`
- `useTerminalSize()`
- `signal.abort -> onResponse('cancel')`

这说明 form elicitation 在 Claude Code 里已经是一个完整终端表单运行时，而不是 MCP 附属小部件。

## 13. schema-aware field runtime 说明 Claude Code 真在 REPL 里实现了一层通用 JSON-schema-ish 表单系统

源码镜像：[`../../src/components/mcp/ElicitationDialog.tsx`](../../src/components/mcp/ElicitationDialog.tsx), [`../../src/utils/mcp/elicitationValidation.ts`](../../src/utils/mcp/elicitationValidation.ts)

当前可见的字段能力至少包括：

- text / number / integer / boolean
- single enum
- multi-select enum
- date / date-time
- default 值预填
- required/min/max/minItems/maxItems 约束

前台不只做同步校验，还做：

- natural language date-time 解析
- debounce 后异步 resolve
- resolving spinner
- enum typeahead
- accordion 式 single/multi select 展开

这说明 elicitation form 不是把 schema 原样打印给用户，而是尽量把终端输入修整成可操作的表单体验。

## 14. `elicitationValidation.ts` 说明 MCP 字段校验不是组件内散逻辑，而是独立验证层

源码镜像：[`../../src/utils/mcp/elicitationValidation.ts`](../../src/utils/mcp/elicitationValidation.ts)

这层至少抽出了：

- `isEnumSchema`
- `isMultiSelectEnumSchema`
- `getEnumValues / getEnumLabel`
- `getMultiSelectValues / getMultiSelectLabel`
- `looksLikeISO8601`
- `parseNaturalLanguageDateTime`
- zod-based primitive validation

也就是说，ElicitationDialog 并不是自己硬编码所有字段规则，而是把一部分 schema 解释器下沉成了可复用验证库。

## 15. `onWaitingDismiss` 和 completion notification 说明 URL elicitation 是“前台 waiting state”和“服务器确认”双边都可结束的协议

源码镜像：[`../../src/services/mcp/elicitationHandler.ts`](../../src/services/mcp/elicitationHandler.ts), [`../../src/components/mcp/ElicitationDialog.tsx`](../../src/components/mcp/ElicitationDialog.tsx), [`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx)

URL 模式里，结束 queue 项至少有三种来源：

- 服务器 completion notification，把 `completed` 标成 true
- 用户在 waiting state 里 `retry / dismiss / cancel`
- 上层 abort signal

REPL 在 `onResponse` 和 `onWaitingDismiss` 两条回调上也明确区分：

- 普通 form / 非 URL：直接出队
- URL accept：先保留在队列
- waiting dismissed：再真正 `slice(1)`

这说明 URL elicitation 是一个真正有 phase transition 的状态机，不是单回调弹窗。

## 16. 这一层和 permission layer 的关系，是“同属 ask front-end，但输入语义不同”

把上一卷和这一卷并起来看，Claude Code 前台至少已经把 ask 分成三类大表面：

- tool permission：要你批准一个动作
- hook prompt：要你从有限选项里选一个响应
- MCP elicitation：要你提供结构化字段，或去外部完成动作再回终端

它们共用的东西是：

- REPL 的 dialog scheduler
- `waiting` session status
- overlay / timeout notification / keyboard interrupt

它们分裂开的东西是：

- queue item 协议
- resolve / retry / waiting phase 行为
- 前台组件复杂度

这也是为什么 Claude Code 没把所有 “需要用户输入” 都塞进 `PermissionPrompt`。
