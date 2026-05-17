# Task Frontend Selection / View State Machine

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Task Language / Spinner Narration / Feedback Loop`](./30-task-language-and-spinner-narration-feedback-loop.md) | [`下一站：Footer Steering / Pill Navigation Runtime`](./32-footer-steering-and-pill-navigation-runtime.md)

本文继续沿任务前台往下钻，但不再讲任务文案或排序，而是专门讲“当前到底选中了什么、正在看谁、哪些键会改变前台所有权”这条状态机：`expandedView`、`footerSelection`、`coordinatorTaskIndex`、`selectedIPAgentIndex`、`viewSelectionMode`、`viewingAgentTaskId` 不是几个零散字段，而是一套把 `spinner tree / task pill / coordinator panel / transcript foreground` 串起来的全局前台协议。

## 1. 这层解决的是“前台焦点归谁”，不是任务怎么执行

源码镜像：[`../../sources/claude-code/src/state/AppStateStore.ts`](../../sources/claude-code/src/state/AppStateStore.ts), [`../../sources/claude-code/src/state/onChangeAppState.ts`](../../sources/claude-code/src/state/onChangeAppState.ts), [`../../sources/claude-code/src/hooks/useGlobalKeybindings.tsx`](../../sources/claude-code/src/hooks/useGlobalKeybindings.tsx), [`../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts`](../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts), [`../../sources/claude-code/src/components/PromptInput/PromptInput.tsx`](../../sources/claude-code/src/components/PromptInput/PromptInput.tsx), [`../../sources/claude-code/src/components/PromptInput/PromptInputFooterLeftSide.tsx`](../../sources/claude-code/src/components/PromptInput/PromptInputFooterLeftSide.tsx), [`../../sources/claude-code/src/components/CoordinatorAgentStatus.tsx`](../../sources/claude-code/src/components/CoordinatorAgentStatus.tsx), [`../../sources/claude-code/src/state/selectors.ts`](../../sources/claude-code/src/state/selectors.ts)

前几卷已经拆开了：

- 任务在哪些 surface 上可见
- teammate tree 如何展开
- coordinator panel 如何保活 local agent

这一卷继续回答更细的问题：

- 当前是 `tasks` 展开还是 `teammates` 展开
- footer pill 是否被 focus
- coordinator panel 的光标落在哪一行
- 当前 transcript 前台到底是 leader、in-process teammate，还是 named local agent

所以它本质上是 Claude Code 的 task frontend state machine。

## 2. `AppState` 直接把这套协议提升成全局状态，而不是让每个组件各记一份局部 state

源码镜像：[`../../sources/claude-code/src/state/AppStateStore.ts`](../../sources/claude-code/src/state/AppStateStore.ts), [`../../sources/claude-code/src/main.tsx`](../../sources/claude-code/src/main.tsx)

关键字段全部直接挂在 `AppState`：

- `expandedView: 'none' | 'tasks' | 'teammates'`
- `selectedIPAgentIndex: number`
- `coordinatorTaskIndex: number`
- `viewSelectionMode: 'none' | 'selecting-agent' | 'viewing-agent'`
- `footerSelection: FooterItem | null`
- `viewingAgentTaskId?: string`

默认值也都是显式初始化的：

- `expandedView = 'none'`
- `selectedIPAgentIndex = -1`
- `coordinatorTaskIndex = -1`
- `viewSelectionMode = 'none'`
- `footerSelection = null`

这说明 Claude Code 从设计上就认为“当前选中谁、当前看谁”是 REPL 全局事实，不是 spinner、footer、panel 各自局部保存的 UI 细节。

## 3. `expandedView` 是最外层模式位，决定当前前台主 surface 是 tasks、teammates 还是都不展开

源码镜像：[`../../sources/claude-code/src/main.tsx`](../../sources/claude-code/src/main.tsx), [`../../sources/claude-code/src/state/onChangeAppState.ts`](../../sources/claude-code/src/state/onChangeAppState.ts), [`../../sources/claude-code/src/hooks/useGlobalKeybindings.tsx`](../../sources/claude-code/src/hooks/useGlobalKeybindings.tsx)

运行时真相已经不是旧的两个布尔位，而是：

- `'none'`
- `'tasks'`
- `'teammates'`

启动时 `main.tsx` 仍兼容老配置：

- `showSpinnerTree -> 'teammates'`
- `showExpandedTodos -> 'tasks'`

状态变更后，`onChangeAppState.ts` 又把它回写成：

- `showExpandedTodos`
- `showSpinnerTree`

因此：

- `expandedView` 是统一状态机
- 老布尔位只是向后兼容镜像

## 4. `ctrl+t` 不是简单 toggle，而是整个前台状态机的最外层循环驱动器

源码镜像：[`../../sources/claude-code/src/hooks/useGlobalKeybindings.tsx`](../../sources/claude-code/src/hooks/useGlobalKeybindings.tsx)

`handleToggleTodos()` 的行为不是固定二态，而是取决于是否有 running teammates：

- 有 teammates：`none -> tasks -> teammates -> none`
- 没 teammates：`none <-> tasks`

所以 `ctrl+t` 在 Claude Code 里已经不是“切 todo list”，而是“切前台任务工作面”。

## 5. `footerSelection` 不是 PromptInput 私有状态，因为被 focus 的 pill 可能根本不在 PromptInput 组件里

源码镜像：[`../../sources/claude-code/src/state/AppStateStore.ts`](../../sources/claude-code/src/components/PromptInput/PromptInput.tsx)

`footerSelection` 的注释写得很明确：

- 它活在 `AppState`
- 因为 pill 组件可能渲染在 `PromptInput` 外面

也就是说，Claude Code 这里的 footer focus 不是“输入框内部的一个 cursor”，而是一个全局可观察状态，供：

- `PromptInput`
- `CompanionSprite`
- `CoordinatorTaskPanel`
- `BackgroundTaskStatus`

这类跨组件表面共同消费。

## 6. footer 选中项本身还要经过一次“仍然存在吗”的派生裁剪，防止幽灵焦点复活

源码镜像：[`../../sources/claude-code/src/components/PromptInput/PromptInput.tsx`](../../sources/claude-code/src/components/PromptInput/PromptInput.tsx)

`PromptInput` 里不是直接信任 `rawFooterSelection`，而是先算：

- `footerItems`
- 再判断 `rawFooterSelection` 是否仍在其中

如果某个 pill 消失了：

- 派生视图会立即把它视作 `null`
- 后续 `useEffect` 再把 `AppState.footerSelection` 真正清掉

这层设计很关键，因为它避免了一个坏情况：

- 某个 task/bridge pill 消失
- 原 focus 状态悄悄留在 store 里
- 未来同类 pill 重新出现时焦点被“复活抢走”

## 7. `coordinatorTaskIndex` 不是普通数组下标，它带一个 `-1` sentinel 用来表示“停在 tasks pill 上，还没进 panel 行”

源码镜像：[`../../sources/claude-code/src/state/AppStateStore.ts`](../../sources/claude-code/src/components/PromptInput/PromptInput.tsx)

这里有一个很容易被忽略的协议：

- `coordinatorTaskIndex = -1`
  - 表示 tasks pill 已被选中
  - 但还没有选中任何 coordinator row
- `0`
  - 表示 main line
- `1..N`
  - 表示 panel 里的 agent rows

`PromptInput.tsx` 甚至专门有注释解释这个 sentinel 的目的：

- 避免 pill 和 row 在第一次进入时双重选中

所以 `coordinatorTaskIndex` 不是“第几个任务”，而是一个跨 `pill -> main -> rows` 的复合游标。

## 8. 但 `-1` 也不是永远合法；当 tasks pill 根本不存在时，最小索引要提升成 `0`

源码镜像：[`../../sources/claude-code/src/components/PromptInput/PromptInput.tsx`](../../sources/claude-code/src/components/CoordinatorAgentStatus.tsx)

`minCoordinatorIndex` 的计算是：

- 有普通 background task pill：`-1`
- 只有 panel-managed local_agent，没有 pill：`0`

原因也很实际：

- 如果 tasks pill 根本不渲染
- 还允许 `-1`
- 用户就会落在一个视觉上不存在的选中位

因此 coordinator 子状态机不是固定从 `-1` 开始，而是会根据“tasks pill 是否真实存在”动态改写最小边界。

## 9. `coordinatorTaskIndex` 会在任务数量变化时被自动 clamp，保证光标永远不指向已经消失的 panel 行

源码镜像：[`../../sources/claude-code/src/components/PromptInput/PromptInput.tsx`](../../sources/claude-code/src/components/CoordinatorAgentStatus.tsx)

`PromptInput.tsx` 有一段专门的 clamp effect：

- 如果 `coordinatorTaskIndex >= coordinatorTaskCount`
- 下压到 `max(minCoordinatorIndex, coordinatorTaskCount - 1)`
- 如果小于 `minCoordinatorIndex`
- 拉回 `minCoordinatorIndex`

与此同时，`CoordinatorTaskPanel` 还会每秒 tick 一次，把过期的 `evictAfter` panel rows 真正从 `tasks` 里剔掉。

这两层配合的结果是：

- panel 行先失效
- selection 再自动回到合法区间

所以 footer/panel 光标不会悬挂在已经被驱逐的 local agent 上。

## 10. `selectedIPAgentIndex` 是 teammate spinner tree 的游标，不是 coordinator panel 的游标

源码镜像：[`../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts`](../../sources/claude-code/src/components/Spinner/TeammateSpinnerTree.tsx)

和 `coordinatorTaskIndex` 并列存在的另一套游标是：

- `selectedIPAgentIndex`

但它只服务 teammate tree，并且语义不同：

- `-1`：leader
- `0..n-1`：running teammates
- `n`：hide row

所以 Claude Code 前台有两套不同的 selection index：

- 一套管 footer/panel
- 一套管 teammate tree

它们不能混用。

## 11. `viewSelectionMode` 把“正在选 teammate”和“已经切到某个 transcript 前台”明确分成两种状态

源码镜像：[`../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts`](../../sources/claude-code/src/state/AppStateStore.ts)

`viewSelectionMode` 有三态：

- `'none'`
- `'selecting-agent'`
- `'viewing-agent'`

这不是装饰性的枚举，因为 `escape`、`enter`、`f`、`k` 在这两种模式下的行为完全不同：

- `selecting-agent`
  - `enter` 确认 tree 选中
  - `f` 查看 transcript
  - `k` kill teammate
  - `esc` 仅退出选择
- `viewing-agent`
  - `esc` 先尝试 abort 当前 teammate 工作
  - 否则退回 leader

也就是说，Claude Code 把“选中谁”和“当前看谁”建成了两个不同层次，而不是一枚布尔值。

## 12. `viewingAgentTaskId` 才是真正决定 transcript foreground ownership 的字段

源码镜像：[`../../sources/claude-code/src/state/selectors.ts`](../../sources/claude-code/src/state/selectors.ts), [`../../sources/claude-code/src/components/PromptInput/PromptInput.tsx`](../../sources/claude-code/src/components/CoordinatorAgentStatus.tsx)

`viewingAgentTaskId` 的职责非常直接：

- 未定义：leader 仍是前台
- 指向 `in_process_teammate`：正在看 teammate transcript
- 指向 `local_agent`：正在看 named local agent transcript

`selectors.ts` 把它正式提升成 `getActiveAgentForInput()`：

- `{ type: 'leader' }`
- `{ type: 'viewed', task }`
- `{ type: 'named_agent', task }`

所以真正决定输入路由和 transcript foreground 的不是 `expandedView`，而是 `viewingAgentTaskId`。

## 13. `expandedView` 和 `viewingAgentTaskId` 是正交状态：可以不展开 tree，但仍然前台查看某个 agent transcript

源码镜像：[`../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts`](../../sources/claude-code/src/state/selectors.ts), [`../../sources/claude-code/src/components/PromptInput/PromptInputFooterLeftSide.tsx`](../../sources/claude-code/src/components/PromptInput/PromptInput.tsx)

这套状态机里一个关键点是：

- `expandedView` 决定展示哪一类展开 surface
- `viewingAgentTaskId` 决定当前 transcript 前台是谁

它们不是同一件事。

典型例子：

- 某个 teammate 已经被前台查看
- tree 里的 running teammate 可能已经清空
- `selectedIPAgentIndex` 会被 reset
- 但 `viewSelectionMode === 'viewing-agent'` 和 `viewingAgentTaskId` 仍然保留

因此“在看某个 agent”不依赖于 tree 仍然展开着。

## 14. `useBackgroundTaskNavigation()` 说明 teammate 状态机的第一步常常不是移动，而是先把 `expandedView` 从别的模式切到 `teammates`

源码镜像：[`../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts`](../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts)

`stepTeammateSelection()` 的第一分支就是：

- 如果 `expandedView !== 'teammates'`
  - 直接切到 `'teammates'`
  - `viewSelectionMode = 'selecting-agent'`
  - `selectedIPAgentIndex = -1`

所以 teammate 选择模式是一个显式状态跃迁，不是简单在当前表面上移动光标。

## 15. footer 键位和 teammate 键位是两套并行协议，分别操纵两组状态字段

源码镜像：[`../../sources/claude-code/src/components/PromptInput/PromptInput.tsx`](../../sources/claude-code/src/components/PromptInput/PromptInput.tsx), [`../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts`](../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts)

两条键位链路分工非常明确：

- `useBackgroundTaskNavigation()`
  - 管 `selectedIPAgentIndex`
  - 管 `viewSelectionMode`
  - 管 `expandedView='teammates'`
- `PromptInput` footer keybindings
  - 管 `footerSelection`
  - 管 `coordinatorTaskIndex`
  - 管打开 dialog 或切到 selected local agent

这说明 Claude Code 不是“一套统一的任务光标”，而是：

- teammate tree 有自己的导航协议
- footer/panel 有自己的导航协议

## 16. `footer:openSelected` 把 tasks pill 分裂成了三种完全不同的语义分支

源码镜像：[`../../sources/claude-code/src/components/PromptInput/PromptInput.tsx`](../../sources/claude-code/src/components/CoordinatorAgentStatus.tsx)

当当前选中 `tasks` pill 时，`Enter` 的行为不是固定打开一个对话框，而是分三种：

- teammate mode：
  - `teammateFooterIndex === 0` -> 回 leader
  - 否则 -> `enterTeammateView(teammate.id)`
- coordinator mode：
  - `coordinatorTaskIndex === 0` -> 回 main
  - `>= 1` -> 进入对应 local agent transcript
- 普通 background tasks：
  - 打开 tasks dialog

所以同一个 `tasks` pill 在不同子状态机下代表的是完全不同的控制面。

## 17. `footer:close` 说明关闭动作也不是统一的“dismiss task”，而要看当前选中的行是否正是 foreground transcript

源码镜像：[`../../sources/claude-code/src/components/PromptInput/PromptInput.tsx`](../../sources/claude-code/src/state/teammateViewHelpers.ts)

`footer:close` 在 coordinator rows 上有一个很关键的分叉：

- 如果当前 row 就是正在前台看的 viewed agent
  - `'x'` 不是 dismiss
  - 而是被写进 steering input
- 否则
  - `stopOrDismissAgent(task.id, setAppState)`

这意味着“正在看它”和“只是选中了它”会改变同一个 `x` 键的语义。前台所有权在这里直接改写了关闭协议。

## 18. `PromptInput` 的 `onSubmit` 还要反向尊重这套状态机，避免 `Enter` 一边确认选择一边误提交 prompt

源码镜像：[`../../sources/claude-code/src/components/PromptInput/PromptInput.tsx`](../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts)

`onSubmit()` 在真正发 prompt 前会先读 store：

- 如果 `footerSelection` 仍然有效 -> 直接 return
- 如果 `viewSelectionMode === 'selecting-agent'` -> 直接 return

原因很明确：

- footer 正在被操作时，Enter 不该顺手发 prompt
- teammate tree 正在选中模式时，Enter 应该先确认 selection，而不是把 suggestion 一起提交

也就是说，输入提交层本身也服从这套前台状态机。

## 19. 这套前台状态机的真正结构，可以压缩成“外层展开模式 + 中层选择模式 + 内层前台所有权”

源码镜像：[`../../sources/claude-code/src/state/AppStateStore.ts`](../../sources/claude-code/src/hooks/useGlobalKeybindings.tsx), [`../../sources/claude-code/src/hooks/useBackgroundTaskNavigation.ts`](../../sources/claude-code/src/components/PromptInput/PromptInput.tsx), [`../../sources/claude-code/src/state/selectors.ts`](../../sources/claude-code/src/state/selectors.ts)

从上到下看，可以把它压成三层：

- 外层：`expandedView`
  - 当前展开的是 `tasks / teammates / none`
- 中层：`footerSelection`、`coordinatorTaskIndex`、`selectedIPAgentIndex`、`viewSelectionMode`
  - 当前在展开 surface 上选中了什么
- 内层：`viewingAgentTaskId`
  - 当前 transcript 前台到底归谁

真正重要的结论不是某个键位，而是 Claude Code 已经把任务前台从“几个零散 hover/selected 布尔值”升级成了一个跨 spinner、footer、panel、input routing 的统一状态机。
