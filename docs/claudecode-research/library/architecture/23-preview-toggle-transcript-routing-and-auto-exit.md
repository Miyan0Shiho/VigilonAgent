# Preview Toggle / Transcript Routing / Auto-Exit

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Teammate Selection / Preview / Expanded View Protocol`](./22-teammate-selection-preview-and-expanded-view-protocol.md) | [`下一站：Swarm Banner / Direct Messages / Mailbox Surfaces`](./24-swarm-banner-direct-messages-and-mailbox-surfaces.md)

本文继续下钻 swarm 前台，但不再讲展开模式机，而是专门拆“preview 怎么被全局开关、`viewingAgentTaskId` 如何决定输入投递目标、前台 transcript 在什么条件下自动退出”这条行为链：`useGlobalKeybindings.tsx`、`TeammateSpinnerTree.tsx`、`state/selectors.ts`、`PromptInput.tsx`、`InProcessTeammateTask.tsx`、`LocalAgentTask.tsx`、`useTeammateViewAutoExit.ts`、`REPL.tsx`。

## 1. 这层解决的是“当前正在看的 agent 到底接不接输入、preview 到底显不显示”，不是选择树怎么移动

源码镜像：[`../../src/hooks/useGlobalKeybindings.tsx`](../../src/hooks/useGlobalKeybindings.tsx), [`../../src/components/Spinner/TeammateSpinnerTree.tsx`](../../src/components/Spinner/TeammateSpinnerTree.tsx), [`../../src/state/selectors.ts`](../../src/state/selectors.ts), [`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/PromptInput/PromptInput.tsx), [`../../src/tasks/InProcessTeammateTask/InProcessTeammateTask.tsx`](../../src/tasks/InProcessTeammateTask/InProcessTeammateTask.tsx), [`../../src/tasks/LocalAgentTask/LocalAgentTask.tsx`](../../src/tasks/LocalAgentTask/LocalAgentTask.tsx), [`../../src/hooks/useTeammateViewAutoExit.ts`](../../src/hooks/useTeammateViewAutoExit.ts), [`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx)

前一卷已经把这些讲清了：

- `selectedIPAgentIndex` 如何锚定 running teammate 数组
- `expandedView` 如何在 `none/tasks/teammates` 之间循环

这一卷继续回答更行为化的问题：

- `showTeammateMessagePreview` 怎样影响 spinner tree
- 当前 `viewingAgentTaskId` 怎样决定输入发给 leader、in-process teammate、还是 local agent
- 为什么 prompt suggestion、brief view、mode cycle 会在 teammate view 下改行为
- 什么时候前台 transcript 应该自动退回 leader

所以它是 swarm 前台的 routing / lifecycle 协议层。

## 2. `showTeammateMessagePreview` 说明 teammate preview 是 REPL 级 capability toggle，不是某棵树自己的局部状态

源码镜像：[`../../src/state/AppStateStore.ts`](../../src/state/AppStateStore.ts), [`../../src/hooks/useGlobalKeybindings.tsx`](../../src/hooks/useGlobalKeybindings.tsx)

`showTeammateMessagePreview` 直接挂在 `AppState`，默认值是 `false`。它的切换也不是组件内按钮，而是全局 keybinding：

- `app:toggleTeammatePreview`

对应逻辑只是翻转：

- `showTeammateMessagePreview: !prev.showTeammateMessagePreview`

这说明 preview 被设计成一个全局前台偏好，而不是“某一次展开树时临时点开”。

## 3. `TeammateSpinnerTree -> TeammateSpinnerLine` 说明 preview toggle 的消费端只有一层，但影响的是整棵树的阅读密度

源码镜像：[`../../src/components/Spinner/TeammateSpinnerTree.tsx`](../../src/components/Spinner/TeammateSpinnerTree.tsx), [`../../src/components/Spinner/TeammateSpinnerLine.tsx`](../../src/components/Spinner/TeammateSpinnerLine.tsx)

消费链很直接：

- tree 从 `AppState` 读 `showTeammateMessagePreview`
- map 每个 teammate row 时把它传成 `showPreview`
- line 再决定是否调用 `getMessagePreview(...)`

所以 preview toggle 的真正作用不是改变选择逻辑，而是改变整棵 running teammate tree 的信息密度。

## 4. `getViewedTeammateTask()` 说明 `viewingAgentTaskId` 不是“任何被看的 agent”，而是“如果能窄化成 teammate 才算 viewed teammate”

源码镜像：[`../../src/state/selectors.ts`](../../src/state/selectors.ts)

这个 selector 的返回条件很严格：

- 必须有 `viewingAgentTaskId`
- `tasks[id]` 必须存在
- 且必须 `isInProcessTeammateTask(task)`

否则返回 `undefined`。

这说明系统显式区分了两层概念：

- 正在看某个 agent：`viewingAgentTaskId`
- 正在看一个 in-process teammate：`getViewedTeammateTask(...)`

后者是前者的类型收窄版本。

## 5. `getActiveAgentForInput()` 说明输入路由不是靠 UI 分支猜，而是靠一个纯 selector 判决

源码镜像：[`../../src/state/selectors.ts`](../../src/state/selectors.ts)

它返回三态判决：

- `{ type: "leader" }`
- `{ type: "viewed", task }`：当前 viewed task 是 in-process teammate
- `{ type: "named_agent", task }`：当前 `viewingAgentTaskId` 指向的是 `local_agent`

这说明“输入该发给谁”已经被抽象成一个纯数据选择器，而不是 scattered if/else。

## 6. `PromptInput.onSubmit` 说明真正的输入投递分叉发生在提交时，而不是输入时

源码镜像：[`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/PromptInput/PromptInput.tsx), [`../../src/state/selectors.ts`](../../src/state/selectors.ts)

`onSubmit` 的主分叉是：

- 先算 `activeAgent = getActiveAgentForInput(store.getState())`
- 如果不是 `leader` 且存在 `onAgentSubmit`
  - 记一条 `tengu_transcript_input_to_teammate`
  - 走 `onAgentSubmit(input, activeAgent.task, helpers)`
- 否则走普通 `onSubmitProp(...)`

这说明 teammate/local-agent transcript 前台并不会在输入过程中改变编辑器，而是在提交瞬间把同一条 prompt 路由到不同后端。

## 7. `PromptInput` 还会用 `viewingAgentTaskId` 抑制多种 leader-only 能力，说明 transcript 路由会反向影响前台功能

源码镜像：[`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/PromptInput/PromptInput.tsx)

当前源码里至少有三类 leader-only gate：

- prompt suggestion 只在 `!viewingAgentTaskId` 时显示和接受
- brief view 只在 `!viewingAgentTaskId` 时生效
- 某些第一次进入 auto mode 的引导也只对 leader 显示

所以 `viewingAgentTaskId` 不只是“输入发给谁”，还会改变整条 prompt-input enhancement 链。

## 8. `handleCycleMode` 说明 mode cycle 在 teammate transcript 前台时会改写被看 teammate 的权限模式，而不是 leader 的

源码镜像：[`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/PromptInput/PromptInput.tsx)

逻辑是：

- 如果 `viewedTeammate && viewingAgentTaskId`
  - 取 teammate 当前 `permissionMode`
  - 算 `nextMode`
  - 直接改写 `tasks[teammateTaskId].permissionMode`

否则才走 leader 的 mode cycle。也就是说，一旦 transcript foreground 到 teammate，mode cycle 这类控制操作也会被重新路由。

## 9. in-process teammate 的输入语义是“消息注入 + transcript 立即可见”，而不是同步 RPC

源码镜像：[`../../src/tasks/InProcessTeammateTask/InProcessTeammateTask.tsx`](../../src/tasks/InProcessTeammateTask/InProcessTeammateTask.tsx), [`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx)

`injectUserMessageToTeammate(...)` 会：

- 只拒绝 terminal teammate
- 把输入 append 到 `pendingUserMessages`
- 同时把 `createUserMessage({ content: message })` append 到 `messages`

REPL 侧在某些支路直接调用它。这说明 viewed teammate 的 transcript 输入不是“发请求等回显”，而是：

- 先把用户消息写入显示历史
- 再排进 teammate 的待处理队列

所以前台会立刻看到消息。

## 10. local agent 的输入语义和 in-process teammate 不同，说明 `named_agent` 只是路由归一，不代表执行语义一致

源码镜像：[`../../src/tasks/LocalAgentTask/LocalAgentTask.tsx`](../../src/tasks/LocalAgentTask/LocalAgentTask.tsx)

本地 agent 这边拆成两步：

- `queuePendingMessage(...)`：只进 `pendingMessages`
- `appendMessageToLocalAgent(...)`：只改 transcript 显示

源码注释写得很明确：

- `queuePendingMessage` / `resumeAgentBackground` 负责把 prompt 送进 agent API 输入
- 但不碰 display

这说明 `named_agent` 和 in-process teammate 虽然都属于 “activeAgent != leader” 分支，但底层消息投递语义并不相同。

## 11. `useTeammateViewAutoExit()` 说明前台 transcript 不会因为任何终态都被强制踢掉，而是显式保留“可回看 completed”这个窗口

源码镜像：[`../../src/hooks/useTeammateViewAutoExit.ts`](../../src/hooks/useTeammateViewAutoExit.ts)

它的策略是：

- 如果 `viewingAgentTaskId` 不存在：不做事
- 如果 task 已经从 map 里消失：`exitTeammateView`
- 如果 viewed task 不是 teammate：不处理
- 如果 teammate 被 kill / failed / 有 error / 进入异常非运行态：退出
- 但 `completed` 和 `pending` 是允许继续留在前台的

源码注释直接说明了设计意图：completed teammate 允许用户继续查看完整 transcript。

## 12. `taskExists` 和 teammate narrowing 分离，说明 auto-exit 逻辑刻意避免误伤 local agent 视图

源码镜像：[`../../src/hooks/useTeammateViewAutoExit.ts`](../../src/hooks/useTeammateViewAutoExit.ts)

这里有个很关键的小心思：

- “task 是否存在”用原始 `task`
- “是否按 teammate 状态规则判断”用 narrowed `viewedTask`

源码注释还特别强调：`local_agent` 会 narrow 成 `undefined`，如果直接拿 narrowed 值做存在判断，会把 local agent 视图错误踢出。

这说明 auto-exit 这条链并不是“只支持 teammate，顺手兼容 local agent”，而是专门规避了这个误伤点。

## 13. `REPL` 的 viewed-local-agent bootstrap 说明 local agent transcript foreground 后并不是天然就有完整历史

源码镜像：[`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx), [`../../src/tasks/LocalAgentTask/LocalAgentTask.tsx`](../../src/tasks/LocalAgentTask/LocalAgentTask.tsx)

REPL 里有一条专门的 bootstrap effect：

- 如果当前 `viewingAgentTaskId` 指向 local agent 且 `needsBootstrap`
  - 去做 sidechain JSONL 读取
  - 合并进 `messages`
  - 再把 `diskLoaded` 置位

而 `LocalAgentTask` 里的注释也解释了：

- `retain` 触发 disk bootstrap
- `diskLoaded` 是一次性标记

这说明 local agent transcript 前台并不是天然内存态，而是“进入视图后再从 sidechain 补历史”。

## 14. 这条链最终说明 Claude Code 的 transcript foreground 不是单一布尔位，而是三条协议叠加

源码镜像：[`../../src/state/selectors.ts`](../../src/state/selectors.ts), [`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/PromptInput/PromptInput.tsx), [`../../src/hooks/useTeammateViewAutoExit.ts`](../../src/hooks/useTeammateViewAutoExit.ts)

真正叠在一起工作的是：

- preview 协议：`showTeammateMessagePreview`
- route 协议：`getActiveAgentForInput(...)`
- lifecycle 协议：`useTeammateViewAutoExit()`

再加上 `viewingAgentTaskId` 这个共享锚点，才能同时回答：

- 树里要不要多给几行 preview
- 当前输入该发给谁
- 当前前台 transcript 该不该自动退出

所以这篇不是 `PromptInput` 的补充，而是 swarm transcript foreground 的行为卷册。
