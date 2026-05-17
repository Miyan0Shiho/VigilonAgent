# Task Visibility / Footer / Spinner Cross-Layer Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Message Selector / Idle Return / Recommendation Dialogs`](./27-message-selector-idle-return-and-recommendation-dialogs.md) | [`下一站：TaskListV2 / Priority / Blockers / Rendering Protocol`](./29-tasklistv2-priority-blockers-and-rendering-protocol.md)

本文不再拆某一个独立组件，而是把任务可见性这条横跨 `AppState -> shared task store -> REPL slotting -> spinner/footer/panel` 的链收束成一篇。要回答的不是“任务列表在哪里渲染”，而是：

- 什么状态决定任务应该显示在 `spinner tree`、`expanded todos`、`footer pill`、`coordinator panel` 哪一面
- 为什么 `useTasksV2` 和 `AppState.tasks` 会并存，而不是单一任务源
- 为什么 `REPL` 必须独占 collapse effect，而 `Spinner` 与 `PromptInputFooterLeftSide` 只能消费它

## 1. 这条链的核心不是 task execution，而是 task visibility ownership

源码镜像：[`../../src/main.tsx`](../../src/main.tsx), [`../../src/state/onChangeAppState.ts`](../../src/state/onChangeAppState.ts), [`../../src/hooks/useGlobalKeybindings.tsx`](../../src/hooks/useGlobalKeybindings.tsx), [`../../src/hooks/useTasksV2.ts`](../../src/hooks/useTasksV2.ts), [`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx), [`../../src/components/Spinner.tsx`](../../src/components/Spinner.tsx), [`../../src/components/PromptInput/PromptInputFooterLeftSide.tsx`](../../src/components/PromptInput/PromptInputFooterLeftSide.tsx), [`../../src/components/tasks/BackgroundTaskStatus.tsx`](../../src/components/tasks/BackgroundTaskStatus.tsx), [`../../src/components/CoordinatorAgentStatus.tsx`](../../src/components/CoordinatorAgentStatus.tsx), [`../../src/components/tasks/taskStatusUtils.tsx`](../../src/components/tasks/taskStatusUtils.tsx), [`../../src/hooks/useBackgroundTaskNavigation.ts`](../../src/hooks/useBackgroundTaskNavigation.ts), [`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/PromptInput/PromptInput.tsx)

Claude Code 这里至少有四种“任务看得见”的表面：

- `Spinner.tsx` 里的 `expanded todos`
- `Spinner.tsx` 里的 `TeammateSpinnerTree`
- `PromptInputFooterLeftSide.tsx` 里的 `BackgroundTaskStatus`
- `CoordinatorTaskPanel`

它们看起来都像“任务 UI”，但所有权其实不同：

- `expandedView` 决定哪种展开面被激活
- `useTasksV2` 决定 TodoV2 任务板是否存在以及是否已经自动隐藏
- `AppState.tasks` 决定后台任务、teammate、local_agent 是否还活着
- `shouldHideTasksFooter()` 决定 footer 是否应该把空间让给 spinner tree

所以这篇本质上是在讲 Claude Code 的 task visibility protocol。

## 2. `expandedView` 是唯一的全局显示模式位，决定“展开任务”还是“展开 teammates”

源码镜像：[`../../src/main.tsx`](../../src/main.tsx), [`../../src/hooks/useGlobalKeybindings.tsx`](../../src/hooks/useGlobalKeybindings.tsx), [`../../src/state/onChangeAppState.ts`](../../src/state/onChangeAppState.ts)

这条状态链很明确：

- `main.tsx` 初始化 `expandedView`
- 值来源不是单一字段，而是兼容旧配置：
  - `showSpinnerTree -> 'teammates'`
  - `showExpandedTodos -> 'tasks'`
  - 否则 `'none'`
- `useGlobalKeybindings.tsx` 的 `ctrl+t` 负责循环切换

切换规则不是固定二态，而是动态三态：

- 如果有 running teammates：`none -> tasks -> teammates -> none`
- 如果没有 teammates：`none <-> tasks`

`onChangeAppState.ts` 又把这个新状态反向持久化回：

- `showExpandedTodos`
- `showSpinnerTree`

也就是说，`expandedView` 才是运行时真相，而 `showExpandedTodos/showSpinnerTree` 只是向后兼容的 config 镜像。

## 3. `useTasksV2` 不是普通 hook，而是任务可见性的共享背板

源码镜像：[`../../src/hooks/useTasksV2.ts`](../../src/hooks/useTasksV2.ts)

`useTasksV2` 这一层的重要性不在“返回任务列表”，而在它把多个 UI 面统一绑到一个 store：

- 单例 `TasksV2Store`
- 共享 `fs.watch`
- 共享 debounce
- 共享 fallback poll
- 共享 `hidden` 语义

这直接解决了一个运行时问题：`Spinner` 会频繁 mount/unmount，如果每个消费者都自己 watch tasks 目录，会产生持续的 watch churn。

更关键的是它把可见性编码进 snapshot 协议：

- 有任务且未隐藏：返回 `Task[]`
- 列表为空，或 hide timer 生效：返回 `undefined`

这里的 `undefined` 不是“还没加载完”，而是“当前任务板不该显示”。

## 4. `useTasksV2WithCollapseEffect()` 说明 REPL 才是可见性收口点

源码镜像：[`../../src/hooks/useTasksV2.ts`](../../src/hooks/useTasksV2.ts), [`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx)

`useTasksV2WithCollapseEffect()` 只多做了一件事：

- 当 `tasks === undefined`
- 且 `expandedView === 'tasks'`
- 把 `expandedView` 收回到 `'none'`

源码注释已经把约束写死了：

- 这个 effect 只能由一个“永远挂着”的组件调用
- 也就是 `REPL`

原因很硬：

- `Spinner`
- `PromptInputFooterLeftSide`
- 其他 consumers

都只是展示面，不能各自擅自 collapse 全局显示模式。否则多个消费者会同时写 `expandedView`，造成竞争。

所以任务可见性真正的收口点在 `REPL`，不是在 spinner 或 footer。

## 5. `REPL` 同时拥有两种任务展开槽位，但它们被 `showSpinner` 分成上下文不同的两条路径

源码镜像：[`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx), [`../../src/components/Spinner.tsx`](../../src/components/Spinner.tsx)

任务展开并不总在一个地方：

- 正在 loading 时，任务展开由 `SpinnerWithVerb` 内部负责
- 没在 loading 时，`REPL` bottom 区自己渲染 `TaskListV2 isStandalone`

具体 gate 是：

- `showSpinner` 时：进入 `SpinnerWithVerb`
- `!showSpinner && showExpandedTodos && tasksV2?.length > 0` 时：REPL 直接渲染 standalone `TaskListV2`

这意味着 Claude Code 明确区分了两种语境：

- “模型正在工作时”的任务展开，是 spinner 语义的一部分
- “模型空闲时”的任务展开，是 bottom workbench 的一部分

所以 `expandedView === 'tasks'` 只是选择权，不决定最终由谁画。

## 6. `Spinner.tsx` 是运行中任务展开的主调度器，而不是纯动画组件

源码镜像：[`../../src/components/Spinner.tsx`](../../src/components/Spinner.tsx)

`SpinnerWithVerbInner()` 里，任务分流非常明确：

- `showSpinnerTree && hasRunningTeammates`
  - 渲染 `TeammateSpinnerTree`
- 否则如果 `showExpandedTodos && tasksV2?.length > 0`
  - 渲染 `TaskListV2`
- 否则
  - 渲染 `next task / tip / budget`

这说明 spinner 自己就是一个 task-aware scheduler：

- teammate tree 优先级最高
- expanded todos 次之
- 普通工作提示最低

同时它还在数据层做了分流：

- `useTasksV2()` 取 TodoV2 列表
- `AppState.tasks` 聚合 running teammates
- 当 `showSpinnerTree` 生效时，teammate token aggregation 会被跳过，因为每个 teammate 已经有自己的一行

所以 Spinner 不是“显示一条动效文案”，而是 loading state 下的任务总控台。

## 7. Footer 不是任务列表的缩略图，而是任务拥有权和导航权的压缩面

源码镜像：[`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/PromptInput/PromptInputFooterLeftSide.tsx)

`PromptInput.tsx` 先决定 footer 里“tasks”这一项是否存在：

- `runningTaskCount > 0`
- 或 ant 模式下 `coordinatorTaskCount > 0`
- 且 `!shouldHideTasksFooter(tasks, showSpinnerTree)`

然后 `PromptInputFooterLeftSide.tsx` 再决定这项具体长什么样：

- 普通 `BackgroundTaskStatus` summary pill
- teammate pills
- 或完全隐藏

这说明 footer 的角色不是“再显示一遍任务”，而是：

- 在空间极小的场景下压缩出一个可导航入口
- 把 `tasks / teams / tmux / bridge / companion` 放进同一条 footer selection order

所以 footer 处理的是 ownership and navigation，不是 full task detail。

## 8. `BackgroundTaskStatus` 真正决定了 footer 是 summary pill 还是 teammate pills

源码镜像：[`../../src/components/tasks/BackgroundTaskStatus.tsx`](../../src/components/tasks/BackgroundTaskStatus.tsx), [`../../src/components/tasks/taskStatusUtils.tsx`](../../src/components/tasks/taskStatusUtils.tsx)

`BackgroundTaskStatus` 自己内部有两套完全不同的输出协议。

第一套是 teammate 模式：

- 条件：`allTeammates`
- 或 `!showSpinnerTree && isViewingTeammate`
- 输出：`main + teammate pills + horizontal scroll window + shift+↓ expand hint`

第二套是 generic summary 模式：

- 条件：存在 background tasks，且 `shouldHideTasksFooter(...)` 不要求隐藏
- 输出：`SummaryPill + optional CTA`

`shouldHideTasksFooter()` 的规则非常关键：

- 只有在 `showSpinnerTree === true`
- 且所有可见 background task 都是 `in_process_teammate`

时才隐藏 footer 任务面。

也就是说，spinner tree 一旦接管了 teammate 展开，footer 必须退后，避免同一批 teammate 同时占用 tree 和 pill 两个表面。

## 9. `CoordinatorTaskPanel` 证明“可见任务”并不都来自 `useTasksV2`

源码镜像：[`../../src/components/CoordinatorAgentStatus.tsx`](../../src/components/PromptInput/PromptInput.tsx)

这里有一个容易误判的点：Claude Code 的任务 UI 不是单一数据源。

`CoordinatorTaskPanel` 读的是：

- `AppState.tasks`
- 过滤 `isPanelAgentTask`
- 再按 `evictAfter !== 0` 取可见行

它完全不依赖 `useTasksV2`。

这意味着：

- TodoV2 任务板走 `useTasksV2`
- panel-managed `local_agent` 走 `AppState.tasks`

所以 `PromptInput.tsx` 才需要区分：

- `hasBgTaskPill`
- `coordinatorTaskCount`
- `minCoordinatorIndex`

因为只有 `local_agent` 时，footer 上可能根本没有 generic tasks pill，但 panel 仍然必须可选、可进入、可清理。

## 10. `useBackgroundTaskNavigation()` 只负责 teammate tree 交互，不负责 generic task list

源码镜像：[`../../src/hooks/useBackgroundTaskNavigation.ts`](../../src/hooks/useBackgroundTaskNavigation.ts)

这条 hook 处理的是：

- `shift+↑/↓`
- `enter`
- `f`
- `k`
- `esc`

但它的核心对象是：

- leader
- in-process teammates
- hide row

如果没有 teammates，而只有普通 background tasks，它只会：

- 调 `onOpenBackgroundTasks`

这说明 generic tasks list 的打开是 dialog/workbench 语义，而 teammate tree 是专门的 inline navigation protocol。两者不能混成同一套键盘模型。

## 11. 这整条链最终形成了“两种任务数据面 + 一个显示模式位 + 四种前台表面”

从上到下收束，可以把 Claude Code 的任务可见性理解成：

- 数据面 A：`useTasksV2`
  - TodoV2 任务板
  - 受 `hidden` / 5s auto-hide / resetTaskList 影响
- 数据面 B：`AppState.tasks`
  - background task、teammate、local_agent、remote task
  - 受任务生命周期和 UI retain/evict 策略影响
- 模式位：`expandedView`
  - `none`
  - `tasks`
  - `teammates`
- 表面：
  - `Spinner` 内联展开
  - `REPL` bottom standalone `TaskListV2`
  - `BackgroundTaskStatus` footer 压缩面
  - `CoordinatorTaskPanel` 面板式 agent 列表

这也是为什么这套系统看起来分散，但不会真的互相打架：每一层都只拥有自己的那部分可见性权。

## 12. 结论：Claude Code 把“任务显示”做成了跨层协议，而不是某个组件的本地 if/else

最重要的几个结论是：

- `expandedView` 是运行时真相，旧 config 只是镜像
- `useTasksV2` 负责 TodoV2 任务板是否存在，不负责所有后台任务
- `REPL` 独占 collapse effect，防止多个消费者竞争写状态
- `Spinner` 和 `PromptInputFooterLeftSide` 只是两个不同密度的消费面
- `BackgroundTaskStatus` 决定 footer 是 teammate pills 还是 summary pill
- `CoordinatorTaskPanel` 证明 local_agent 面板是独立数据面，不该被误归类成 TodoV2

所以如果要继续往下拆，这条链下一站最自然的不是再看一个单组件，而是补：

- `TaskListV2` 自身的渲染协议
- `PromptInputFooter` 的 pill selection state machine
- 或把 `expandedView / footerSelection / teammate view` 三者合成一篇更纯状态机卷册
