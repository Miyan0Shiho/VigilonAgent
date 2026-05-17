# Teammate Selection / Preview / Expanded View Protocol

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Coordinator / Spinner Tree / Teammate View Runtime`](./21-coordinator-spinner-tree-and-teammate-view-runtime.md) | [`下一站：Preview Toggle / Transcript Routing / Auto-Exit`](./23-preview-toggle-transcript-routing-and-auto-exit.md)

本文继续下钻 swarm 前台，但不再讲 panel 和 spinner tree 的职责分工，而是专门拆“被选中的 teammate 是谁、预览行怎么生成、`ctrl+t` 和 `shift+↑/↓` 如何驱动展开模式机、这些状态怎样写进全局配置”这条更细的交互协议：`TeammateSpinnerLine.tsx`、`useBackgroundTaskNavigation.ts`、`useGlobalKeybindings.tsx`、`AppStateStore.ts`、`onChangeAppState.ts`、`PromptInput.tsx`、`PromptInputFooterLeftSide.tsx`、`InProcessTeammateTask.tsx`。

## 1. 这层解决的是“多 teammate 交互协议怎么保持一致”，不是单个组件怎么画

源码镜像：[`../../sources/claude-code/src/components/Spinner/TeammateSpinnerLine.tsx`](../../sources/claude-code/src/components/Spinner/TeammateSpinnerLine.tsx), [`../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts`](../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts), [`../../sources/claude-code/src/hooks/useGlobalKeybindings.tsx`](../../sources/claude-code/src/hooks/useGlobalKeybindings.tsx), [`../../sources/claude-code/src/state/AppStateStore.ts`](../../sources/claude-code/src/state/AppStateStore.ts), [`../../sources/claude-code/src/state/onChangeAppState.ts`](../../sources/claude-code/src/state/onChangeAppState.ts), [`../../sources/claude-code/src/components/PromptInput/PromptInput.tsx`](../../sources/claude-code/src/components/PromptInput/PromptInput.tsx), [`../../sources/claude-code/src/components/PromptInput/PromptInputFooterLeftSide.tsx`](../../sources/claude-code/src/components/PromptInput/PromptInputFooterLeftSide.tsx), [`../../sources/claude-code/src/tasks/InProcessTeammateTask/InProcessTeammateTask.tsx`](../../sources/claude-code/src/tasks/InProcessTeammateTask/InProcessTeammateTask.tsx)

前一卷已经说明：

- footer pills、spinner tree、coordinator panel 是三套协同 surface
- `viewingAgentTaskId` 与 `viewSelectionMode` 决定 transcript 前台

这一卷继续解决更细的问题：

- `selectedIPAgentIndex` 究竟映射到哪一个 teammate
- teammate 行是按什么布局规则显示状态、统计和 preview
- `ctrl+t`、`shift+↑/↓`、`enter`、`f`、`k`、`esc` 如何共同操作这套 surface
- `expandedView` 为什么要被兼容写回老的 `showExpandedTodos/showSpinnerTree`

所以它是 swarm 前台的交互协议层。

## 2. `AppStateStore` 说明这套协议一开始就是全局状态，而不是 spinner 本地 state

源码镜像：[`../../sources/claude-code/src/state/AppStateStore.ts`](../../sources/claude-code/src/state/AppStateStore.ts)

关键字段直接挂在 `AppState`：

- `expandedView: "none" | "tasks" | "teammates"`
- `selectedIPAgentIndex: number`
- `coordinatorTaskIndex: number`
- `viewSelectionMode: "none" | "selecting-agent" | "viewing-agent"`
- `showTeammateMessagePreview?`

默认值则是：

- `expandedView = "none"`
- `selectedIPAgentIndex = -1`
- `coordinatorTaskIndex = -1`
- `viewSelectionMode = "none"`

这说明 teammate 展开、选择、前台查看这些交互不是某个局部组件记着就行，而是 REPL 全局工作面的一部分。

## 3. `main.tsx` 和 `onChangeAppState.ts` 说明新三态协议仍然要兼容旧的两组配置位

源码镜像：[`../../sources/claude-code/src/main.tsx`](../../sources/claude-code/src/main.tsx), [`../../sources/claude-code/src/state/onChangeAppState.ts`](../../sources/claude-code/src/state/onChangeAppState.ts)

启动时：

- `showSpinnerTree -> expandedView = "teammates"`
- `showExpandedTodos -> expandedView = "tasks"`
- 否则 `expandedView = "none"`

状态变更时又反向写回：

- `expandedView === "tasks" -> showExpandedTodos = true`
- `expandedView === "teammates" -> showSpinnerTree = true`

源码注释写得很直接，这是“for backwards compat”。这说明 `expandedView` 已经是正式统一协议，但外部配置层还保留着旧布尔位。

## 4. `getRunningTeammatesSorted()` 说明所有 teammate 选择都锚定同一排序数组，不能各自算各自的

源码镜像：[`../../sources/claude-code/src/tasks/InProcessTeammateTask/InProcessTeammateTask.tsx`](../../sources/claude-code/src/tasks/InProcessTeammateTask/InProcessTeammateTask.tsx)

这个 helper 的注释就是协议声明：

- `TeammateSpinnerTree` 显示用它
- `PromptInput` footer selector 用它
- `useBackgroundTaskNavigation` 也用它
- `selectedIPAgentIndex` 映射到的就是这条数组

并且排序规则固定成：

- 只取 `status === "running"` 的 in-process teammates
- 按 `identity.agentName.localeCompare(...)` 排序

这说明 `selectedIPAgentIndex` 不是 task id，而是一个依赖共享排序协议的游标。

## 5. `selectedIPAgentIndex` 的语义不是单纯“第几个 teammate”，而是带哨兵位的树游标

源码镜像：[`../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts`](../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts), [`../../sources/claude-code/src/components/Spinner/TeammateSpinnerTree.tsx`](../../sources/claude-code/src/components/Spinner/TeammateSpinnerTree.tsx)

这里的索引被明确扩展成：

- `-1`：leader
- `0..n-1`：running teammates
- `n`：hide row

所以 `selectedIPAgentIndex` 代表的是 spinner tree 光标，而不是 teammate 数组下标本身。

## 6. `stepTeammateSelection()` 说明 `shift+↑/↓` 的第一步不是移动，而是把压缩 surface 展开成树

源码镜像：[`../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts`](../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts)

当当前不是 `expandedView === "teammates"` 时，第一次步进会直接把状态改成：

- `expandedView = "teammates"`
- `viewSelectionMode = "selecting-agent"`
- `selectedIPAgentIndex = -1`

也就是先把树展开，并把焦点停在 leader。只有已经展开后，后续 `delta` 才在 `-1..n` 之间循环。这说明“进入 teammate 选择模式”本身就是一个显式状态跃迁。

## 7. `useBackgroundTaskNavigation` 说明 teammate 键盘协议是独立于普通 prompt submit 的一套前置层

源码镜像：[`../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts`](../../sources/claude-code/src/components/PromptInput/PromptInput.tsx)

这套 hook 接管了：

- `shift+up/down`
- `enter`
- `f`
- `k`
- `escape`

而 `PromptInput.tsx` 的 `onSubmit` 明确又加了一层保护：

- 如果 `viewSelectionMode === "selecting-agent"`，直接 return

源码注释解释得很清楚：否则 `Enter` 会先确认 teammate 选择，又顺手把 suggestion 提交掉。这说明 teammate 选择模式被当成 prompt submit 之前的一层高优先级键盘协议。

## 8. `esc` 的语义被拆成两层，说明 selecting 与 viewing 是不同模式，不是同一个 flag

源码镜像：[`../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts`](../../sources/claude-code/src/state/teammateViewHelpers.ts)

`esc` 在两种模式下行为不同：

- `viewing-agent`：如果 teammate 正在跑，只 abort 当前工作；否则退出回 leader
- `selecting-agent`：只是退出选择，清空 `selectedIPAgentIndex`

所以 `viewSelectionMode` 用联合类型而不是布尔值是必要的，因为“正在看 teammate transcript”和“只是在树上选中某个 teammate”是两种完全不同的交互态。

## 9. `enter`、`f`、`k` 三个键说明 spinner tree 不只是看状态，而是直接承载操作语义

源码镜像：[`../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts`](../../sources/claude-code/src/tasks/InProcessTeammateTask/InProcessTeammateTask.tsx)

在 `selecting-agent` 模式下：

- `enter`
  - `-1` -> 回 leader
  - `n` -> 折叠 tree
  - `0..n-1` -> `enterTeammateView(...)`
- `f`
  - 对选中的 teammate 直接前台查看 transcript
- `k`
  - 对选中的 running teammate 执行 `InProcessTeammateTask.kill(...)`

这说明 spinner tree 不是只读树，而是带操作命令的 steering console。

## 10. teammate 数量变化时的 clamp/reset 逻辑说明游标稳定性是被显式维护的

源码镜像：[`../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts`](../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts)

这个 hook 还专门维护了：

- `prevTeammateCountRef`
- teammate 被移除时的 reset
- 索引越界时的 clamp

尤其是这里有一个细节：

- 如果当前正在 `viewing-agent`，teammate 数量归零时不要把 viewing 模式硬砸掉，只把 `selectedIPAgentIndex` 清回 `-1`

这说明“前台正在看一个刚完成的 teammate transcript”被认为是合法状态，不能因为运行队列清空就直接打断。

## 11. `useGlobalKeybindings` 说明 `ctrl+t` 在有 teammate 时不是二态切换，而是三段循环

源码镜像：[`../../sources/claude-code/src/hooks/useGlobalKeybindings.tsx`](../../sources/claude-code/src/hooks/useGlobalKeybindings.tsx)

如果当前存在 running teammates：

- `none -> tasks`
- `tasks -> teammates`
- `teammates -> none`

如果没有 teammates，则退化成：

- `none <-> tasks`

这说明 `ctrl+t` 不是“toggle todo list”那么简单，实际上已经升级成“任务/teammate 多 surface 循环键”。

## 12. `PromptInputFooterLeftSide` 的 hint 文案也跟着三态协议变化，说明这不是内部状态，是真实可发现性协议

源码镜像：[`../../sources/claude-code/src/components/PromptInput/PromptInputFooterLeftSide.tsx`](../../sources/claude-code/src/components/PromptInput/PromptInputFooterLeftSide.tsx)

`getSpinnerHintParts(...)` 会根据 `expandedView` 生成不同文案：

- `none -> show tasks`
- `tasks -> show teammates`
- `teammates -> hide`

这说明三态循环不只是内部实现，用户在 footer hint 里就能看到下一步会发生什么。

## 13. `TeammateSpinnerLine` 说明单行 teammate surface 是响应式摘要卡，不是固定模板

源码镜像：[`../../sources/claude-code/src/components/Spinner/TeammateSpinnerLine.tsx`](../../sources/claude-code/src/components/Spinner/TeammateSpinnerLine.tsx)

这行的布局先算：

- `basePrefix`
- `@agentName` 宽度
- stats 宽度
- select/view hint 宽度
- `activityMaxWidth`

然后分三挡：

- 宽屏：名字 + 活动 + stats + hint
- 中屏：名字 + 活动
- 窄屏：隐藏名字，只保留活动

这说明 teammate 行不是简单 `<name>: <status>`，而是按终端宽度动态退化的摘要 surface。

## 14. `getMessagePreview()` 说明 preview 不是 transcript 末尾硬切三行，而是带 block 类型意识的抽样

源码镜像：[`../../sources/claude-code/src/components/Spinner/TeammateSpinnerLine.tsx`](../../sources/claude-code/src/components/Spinner/TeammateSpinnerLine.tsx)

这个 helper 会：

- 从消息尾部往前扫
- 只取 user/assistant 且有 content 的消息
- `tool_use` block 尝试从 `description/prompt/command/query/pattern` 里提取描述
- `text` block 取尾部非空行
- 最多 3 行，再 reverse 回正常阅读顺序

这说明 preview 的目标不是忠实复刻 transcript，而是把最近有用动作压成 3 条可扫读线。

## 15. active / idle / all-idle 三种 teammate 状态说明 `TeammateSpinnerLine` 自己也有一套时间语义

源码镜像：[`../../sources/claude-code/src/components/Spinner/TeammateSpinnerLine.tsx`](../../sources/claude-code/src/components/Spinner/TeammateSpinnerLine.tsx), [`../../sources/claude-code/src/hooks/useElapsedTime.ts`](../../sources/claude-code/src/hooks/useElapsedTime.ts)

单行状态分三种：

- active：显示最近 activity 或 fallback verb
- idle：显示 `Idle for X`
- all idle：冻结成 `pastTenseVerb for X`

这里还用：

- `idleStartRef`
- `frozenDurationRef`

说明“所有 teammate 都 idle 之后，用过去式固定显示工作时长”是独立设计的，不是顺手复用 spinner 主行。

## 16. `isSelected`、`isForegrounded`、`showPreview` 三个维度说明单行 teammate 同时承担导航、前台归属和窥视三种职责

源码镜像：[`../../sources/claude-code/src/components/Spinner/TeammateSpinnerLine.tsx`](../../sources/claude-code/src/components/Spinner/TeammateSpinnerTree.tsx)

这些 flag 分别控制：

- `isSelected`：指针、高亮、`enter to view`
- `isForegrounded`：当前 transcript 前台归属
- `showPreview`：是否展开最近三行 preview

所以一条 teammate row 并不是“某个 agent 的状态”，而是“这个 agent 在当前 swarm 操作面里的角色”。

## 17. `PromptInput` 的 footer 导航分支说明 teammate pills 与 coordinator rows 共享入口键，但走不同对象模型

源码镜像：[`../../sources/claude-code/src/components/PromptInput/PromptInput.tsx`](../../sources/claude-code/src/components/PromptInput/PromptInput.tsx), [`../../sources/claude-code/src/components/CoordinatorAgentStatus.tsx`](../../sources/claude-code/src/components/CoordinatorAgentStatus.tsx)

`footer:openSelected` 对 `tasks` 会再分叉：

- teammate pills 模式：`teammateFooterIndex`
- coordinator panel 模式：`coordinatorTaskIndex`
- 普通后台任务模式：开 `BackgroundTasksDialog`

这说明对用户来说都是“footer 上的 tasks 入口”，但内部已经按三种不同对象模型分流：

- leader/main + in-process teammates
- main + local agents
- generic background tasks

## 18. 这一层最终说明 Claude Code 的 swarm 前台靠的是“共享协议”，不是“共享组件”

源码镜像：[`../../sources/claude-code/src/state/AppStateStore.ts`](../../sources/claude-code/src/state/AppStateStore.ts), [`../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts`](../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts), [`../../sources/claude-code/src/hooks/useGlobalKeybindings.tsx`](../../sources/claude-code/src/hooks/useGlobalKeybindings.tsx), [`../../sources/claude-code/src/components/Spinner/TeammateSpinnerLine.tsx`](../../sources/claude-code/src/components/Spinner/TeammateSpinnerLine.tsx)

真正被共享的是：

- `expandedView`
- `selectedIPAgentIndex`
- `viewSelectionMode`
- `getRunningTeammatesSorted(...)`

而不是某个单一 UI 组件。不同 surface 只是在消费这条协议：

- global keybindings 负责进入/切换展开模式
- background navigation 负责树内移动与操作
- spinner line 负责把协议投影成可读行
- prompt input 负责阻止 submit 冲撞、把 footer 操作接回 transcript 切换

所以这篇不是一个组件说明书，而是 swarm 前台的 selection protocol 卷册。
