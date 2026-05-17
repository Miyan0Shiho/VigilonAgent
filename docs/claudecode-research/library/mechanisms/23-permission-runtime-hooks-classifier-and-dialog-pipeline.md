# Permission Runtime / Hooks / Classifier / Dialog Pipeline

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Swarm Worker Permission Origin / Wait State`](./22-swarm-worker-permission-origin-and-wait-state.md) | [`下一站：Workflow / Monitor Gates / Task Types / Surface Contracts`](./24-workflow-monitor-gates-task-types-and-surface-contracts.md)

本文把前几篇已经拆开的权限碎片重新装回一条总运行时链，但只讲 ask-permission 真正进入运行时之后的装配层：`useCanUseTool.tsx`、`PermissionContext.ts`、`coordinatorHandler.ts`、`interactiveHandler.ts`，外加 `runAgent.ts` 里的策略开关和 `print.ts` 里的非交互分支。目标不是再讲 policy rule 本身，而是讲清楚 Claude Code 怎样把 hooks、classifier、bridge/channel reply、user dialog、abort race 串成一个不会双重 resolve 的权限状态机。

## 1. 这层解决的是“同一个 ask”为什么会长成三条运行时路径，而不是“哪些规则允许某个工具”

源码镜像：[`../../src/hooks/useCanUseTool.tsx`](../../src/hooks/useCanUseTool.tsx), [`../../src/hooks/toolPermission/PermissionContext.ts`](../../src/hooks/toolPermission/PermissionContext.ts), [`../../src/hooks/toolPermission/handlers/coordinatorHandler.ts`](../../src/hooks/toolPermission/handlers/coordinatorHandler.ts), [`../../src/hooks/toolPermission/handlers/interactiveHandler.ts`](../../src/hooks/toolPermission/handlers/interactiveHandler.ts), [`../../src/tools/AgentTool/runAgent.ts`](../../src/tools/AgentTool/runAgent.ts), [`../../src/cli/print.ts`](../../src/cli/print.ts)

前几卷已经分别讲过：

- 权限规则、hooks、policy limits 在哪定义
- swarm worker ask 从哪里起、等待态怎样写回 REPL
- leader 怎样通过 mailbox 或 queue 给 worker 回执

这一卷继续回答更总装配的问题：

- ask-permission 的统一入口在哪
- 哪些共享原语负责避免 hook、classifier、user、bridge 同时 resolve
- `awaitAutomatedChecksBeforeDialog` 为什么会把 ask 分流成 coordinator 路或 interactive 路
- 为什么 `print.ts` 明明也有 permission mode，却不能复用 REPL dialog 路线

所以这篇是 permission runtime assembly layer。

## 2. `useCanUseTool()` 是权限运行时的总闸，不是单纯的“弹窗前检查”

源码镜像：[`../../src/hooks/useCanUseTool.tsx`](../../src/hooks/useCanUseTool.tsx)

它先统一做四件事：

- 创建 `PermissionContext`
- 处理已经 abort 的请求
- 跑 `hasPermissionsToUseTool(...)`
- 根据 `allow / deny / ask` 三种结果进入不同运行时分支

真正关键的是 ask 分支的顺序：

1. `handleCoordinatorPermission(...)`
2. `handleSwarmWorkerPermission(...)`
3. speculative bash classifier 2s grace period
4. `handleInteractivePermission(...)`

这说明 Claude Code 的 ask-permission 不是“总会弹一个统一框”，而是先走一套角色化 dispatcher，再决定是否需要真正的交互表面。

## 3. `PermissionContext` 不是工具函数集合，而是整条权限流水线共享的运行时契约

源码镜像：[`../../src/hooks/toolPermission/PermissionContext.ts`](../../src/hooks/toolPermission/PermissionContext.ts)

它统一封装了几类核心能力：

- 决策记录：`logDecision()`、`logCancelled()`
- 状态写回：`persistPermissions()`、`pushToQueue()`、`removeFromQueue()`、`updateQueueItem()`
- 决策构造：`buildAllow()`、`buildDeny()`、`cancelAndAbort()`
- 自动化检查：`runHooks()`、`tryClassifier()`
- 用户/Hook 放行收尾：`handleUserAllow()`、`handleHookAllow()`
- 生命周期控制：`resolveIfAborted()`

这说明 coordinator、swarm worker、interactive dialog 虽然是三条分支，但它们不是各自维护一套 permission semantics，而是共享同一个 runtime contract。

## 4. `createResolveOnce()` 说明权限流水线真正先防的不是 UI 复杂，而是多异步来源的双重 resolve

源码镜像：[`../../src/hooks/toolPermission/PermissionContext.ts`](../../src/hooks/toolPermission/PermissionContext.ts)

这层暴露三个动作：

- `resolve(value)`
- `isResolved()`
- `claim()`

其中真正关键的是 `claim()`。源码注释已经写明，它是为了关闭这样一类时间窗：

- 先检查 `isResolved()`
- 再 `await`
- 另一路在你 `await` 时已经抢先 resolve

所以 Claude Code 的 permission runtime 从原语层就假设这些竞争同时存在：

- hook allow/deny
- classifier allow
- 本地用户 allow/reject/abort
- bridge reply
- channel reply
- recheck after mode switch
- abort signal

这条链真正的硬点不在“有没有弹窗”，而在“谁先赢得 resolve 所有权”。

## 5. `runHooks()` 说明 hook 在运行时里不是附属建议，而是 ask 流水线的第一类正式裁决者

源码镜像：[`../../src/hooks/toolPermission/PermissionContext.ts`](../../src/hooks/toolPermission/PermissionContext.ts)

`runHooks()` 会流式消费 `executePermissionRequestHooks(...)` 的结果，并把 hook 结果分成两类：

- `allow`：走 `handleHookAllow(...)`
- `deny`：走 `buildDeny(...)`

如果 hook deny 且 `interrupt` 为真，还会直接 `abortController.abort()`。

这说明 hook 在 Claude Code 里不是“帮用户预填建议”，而是和用户、classifier 并列的一等 permission authority。

## 6. `handleHookAllow()` 和 `handleUserAllow()` 的分离，说明“谁批准的”会改变持久化与审计语义

源码镜像：[`../../src/hooks/toolPermission/PermissionContext.ts`](../../src/hooks/toolPermission/PermissionContext.ts)

两条路径都会：

- `persistPermissions(...)`
- `logDecision(...)`
- 返回 `buildAllow(...)`

但语义不同：

- `handleUserAllow()` 会计算 `userModified`
- `handleUserAllow()` 会保留 `acceptFeedback` 与 `contentBlocks`
- `handleHookAllow()` 固定把 `decisionReason` 标成 hook

所以 permission runtime 里不只关心结果，还关心批准来源，因为来源会影响后续：

- 是否可解释成用户修改过输入
- 审计日志如何记录
- 结果内容能不能带交互反馈

## 7. `handleCoordinatorPermission()` 不是第二套权限系统，而是“先等自动化检查”的 ask 子路径

源码镜像：[`../../src/hooks/toolPermission/handlers/coordinatorHandler.ts`](../../src/hooks/toolPermission/handlers/coordinatorHandler.ts)

这条路径非常克制，只做两件事：

1. `await ctx.runHooks(...)`
2. `await ctx.tryClassifier(...)`

如果都没 resolve，返回 `null` 让外层继续掉到 dialog。

它的含义不是“协调器专用权限规则”，而是：

- 背景 agent 可以等
- 用户不该被可自动解决的 ask 打断

所以 coordinator path 的本质是 automated-check-first，不是 alternate policy。

## 8. `awaitAutomatedChecksBeforeDialog` 才是 ask 是否走 coordinator 路的真正策略开关

源码镜像：[`../../src/hooks/useCanUseTool.tsx`](../../src/hooks/useCanUseTool.tsx), [`../../src/tools/AgentTool/runAgent.ts`](../../src/tools/AgentTool/runAgent.ts)

`useCanUseTool()` 里只有当：

- `appState.toolPermissionContext.awaitAutomatedChecksBeforeDialog`

为真时，才会先走 `handleCoordinatorPermission(...)`。

而 `runAgent.ts` 会在一个非常明确的条件下打开它：

- `isAsync && !shouldAvoidPrompts`

源码注释也写明了原因：

- 对能显示 prompt 的后台 agent，先等 classifier 和 hooks
- 只有自动化检查解决不了时，才打断用户

这说明同一个 ask 行为并不只由 tool 或 rule 决定，还由 agent 执行拓扑决定。

## 9. `handleInteractivePermission()` 说明主 REPL 权限表面本质上是一个多路竞争协调器

源码镜像：[`../../src/hooks/toolPermission/handlers/interactiveHandler.ts`](../../src/hooks/toolPermission/handlers/interactiveHandler.ts)

这层先做的是：

- `createResolveOnce(resolve)`
- 把一条 `ToolUseConfirm` 推进队列
- 给队列项挂上 `onAllow / onReject / onAbort / recheckPermission / onUserInteraction / onDismissCheckmark`

之后真正的复杂度不在 UI 绘制，而在这些竞争面：

- 本地用户操作
- bridge CCR reply
- channel yes/no reply
- async hooks
- async classifier
- permission recheck
- abort signal

所以它的本质不是“展示 dialog”，而是把多路响应编排成一个只允许单次决议的 race coordinator。

## 10. `onUserInteraction()` 的 200ms grace period，说明 classifier 并不是一碰键盘就立即失效

源码镜像：[`../../src/hooks/toolPermission/handlers/interactiveHandler.ts`](../../src/hooks/toolPermission/handlers/interactiveHandler.ts)

用户一开始交互时，它不会立刻把 classifier 自动批准资格清掉，而是：

- 先看 permission dialog 打开后是否已过 `200ms`
- 过了才把 `userInteracted = true`
- 然后清掉 classifier checking state

这说明 runtime 已经考虑到终端里很常见的误触问题：

- 一个残留按键
- 焦点切换时的输入
- dialog 刚出现的瞬时导航键

如果没有这个 grace period，classifier 会被无意义地过早取消。

## 11. interactive path 里 bridge 与 channel 不是后处理，而是和本地对话框并列竞速的远端审批面

源码镜像：[`../../src/hooks/toolPermission/handlers/interactiveHandler.ts`](../../src/hooks/toolPermission/handlers/interactiveHandler.ts)

当 bridge 可用时，handler 会：

- `sendRequest(...)`
- `onResponse(...)`
- 远端 allow/reject 也走 `claim()`

当 channel relay 可用且工具不要求 richer user interaction 时，还会：

- 给多个 channel client 发 structured permission request
- 等远端 yes/no 文本 reply 被通知层拦截并回接

这说明本地 permission dialog 不是唯一审批面，而是：

- local REPL
- CCR / claude.ai
- channel relay

三块表面共享同一个决议竞争池。

## 12. `recheckPermission()` 说明 dialog 不是静态快照，而是会在运行中响应 permission mode 变化

源码镜像：[`../../src/hooks/toolPermission/handlers/interactiveHandler.ts`](../../src/hooks/useCanUseTool.tsx)

这条回调会重新跑：

- `hasPermissionsToUseTool(...)`

如果结果变成 allow，就会：

- `claim()`
- 取消 bridge request
- 从队列移除 dialog
- 直接 `buildAllow(...)`

这说明权限弹窗在 Claude Code 里不是“弹出来就只能手动点掉”，而是会对运行中配置变化、mode switch、外部授权结果做动态收敛。

## 13. speculative bash classifier 2 秒宽限，说明主 REPL ask 路还有一层“尽量不弹”的前置缓冲

源码镜像：[`../../src/hooks/useCanUseTool.tsx`](../../src/hooks/useCanUseTool.tsx)

在普通 interactive path 里，如果：

- 有 `pendingClassifierCheck`
- 当前工具是 bash
- 没开 `awaitAutomatedChecksBeforeDialog`

系统还会在真正进入 dialog 前：

- 看 `peekSpeculativeClassifierCheck(...)`
- 最多等 2 秒
- 高置信命中则直接 allow

这说明 main-agent ask 并不是“要么同步自动批准，要么立刻弹框”，中间还插着一层面向体验的 speculative buffer。

## 14. `resolveIfAborted()` 说明 abort 检查不是异常处理尾声，而是每个关键阶段之间都要重做的硬边界

源码镜像：[`../../src/hooks/toolPermission/PermissionContext.ts`](../../src/hooks/useCanUseTool.tsx)

这条 helper 会：

- 检查 `abortController.signal.aborted`
- 记录 cancellation
- 返回 `cancelAndAbort(...)`

而 `useCanUseTool()` 会在多个阶段后重复调用它：

- 创建上下文后
- 拿到 allow 结果后
- 生成 description 后
- coordinator checks 后
- speculative classifier race 后

这说明 permission runtime 把“请求是否已经失效”当成阶段边界条件，而不是最后 catch 一次异常就算了。

## 15. `print.ts` 明确说明 SDK/print 路不走 `handleInteractivePermission()`，所以交互 REPL 不是权限系统的唯一宿主

源码镜像：[`../../src/cli/print.ts`](../../src/cli/print.ts)

`handleChannelEnable(...)` 里的注释把这个边界说得很直白：

- `print.ts` never calls `handleInteractivePermission`
- SDK permission 落到 `ask` 时，会走 consumer 的 `canUseTool` callback over stdio
- CLI 侧没有一个本地 dialog 可以让远端 `"yes tbxkq"` 回来 resolve

这说明 Claude Code 的权限系统实际上有两层：

- 共享的 permission decision / policy / runtime primitives
- REPL 专属的 interactive dialog orchestration

后者不能直接套到 print/SDK 路，因为那条链没有同构的前台队列和远端 reply plumbing。

## 16. `runAgent.ts` 和 `print.ts` 合起来说明 permission runtime 不是“一个 handler 到处复用”，而是“共享内核 + 宿主特化”

源码镜像：[`../../src/tools/AgentTool/runAgent.ts`](../../src/tools/AgentTool/runAgent.ts), [`../../src/cli/print.ts`](../../src/cli/print.ts), [`../../src/hooks/useCanUseTool.tsx`](../../src/hooks/useCanUseTool.tsx)

`runAgent.ts` 做的是：

- 根据 agent 是否 async、能否显示 prompt，改写 permission context 行为

`print.ts` 做的是：

- 明确切断 REPL dialog 和 channel approval 的耦合假设

`useCanUseTool()` 做的是：

- 保持共享的 allow/deny/ask 总入口

所以 Claude Code 的权限架构不是“一条通用 UI handler”，而是：

- 共用 permission core
- 针对宿主环境选择不同 ask runtime

## 17. 这条机制最终说明 ask-permission 真正由六段拼起来

源码镜像：[`../../src/hooks/useCanUseTool.tsx`](../../src/hooks/useCanUseTool.tsx), [`../../src/hooks/toolPermission/PermissionContext.ts`](../../src/hooks/toolPermission/PermissionContext.ts), [`../../src/hooks/toolPermission/handlers/coordinatorHandler.ts`](../../src/hooks/toolPermission/handlers/coordinatorHandler.ts), [`../../src/hooks/toolPermission/handlers/interactiveHandler.ts`](../../src/hooks/toolPermission/handlers/interactiveHandler.ts), [`../../src/tools/AgentTool/runAgent.ts`](../../src/tools/AgentTool/runAgent.ts), [`../../src/cli/print.ts`](../../src/cli/print.ts)

真正叠在一起工作的是：

- 总入口：`useCanUseTool()`
- 共享契约：`PermissionContext`
- 自动化优先子路径：`handleCoordinatorPermission()`
- 主 REPL 竞速器：`handleInteractivePermission()`
- agent 宿主策略开关：`awaitAutomatedChecksBeforeDialog`
- 非 REPL 宿主边界：`print.ts` / SDK callback 路

因此 Claude Code 的 permission runtime 并不是“policy + 一个弹窗”，而是把 hook、classifier、bridge、channel、user、abort、agent 宿主差异都塞进了同一条 ask-decision 装配线上，再用 `claim()` 和共享 context 把它收敛成一次且仅一次的决议。
