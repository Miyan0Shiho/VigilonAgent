# Footer Steering / Pill Navigation Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Task Frontend Selection / View State Machine`](./31-task-frontend-selection-and-view-state-machine.md) | [`下一站：产品卷`](../product/01-positioning-and-surface.md)

本文继续沿任务前台往下钻，但不再讲全局状态字段，而是专门讲底栏如何真正变成一个 steering console：`tasksFooterVisible`、`footerItems`、`selectFooterItem()`、`navigateFooter()`、`teammateFooterIndex`、`footer:openSelected`、`footer:close` 共同定义了 Claude Code 底栏里“选哪个 pill、按 Enter 会发生什么、按 x 到底是关闭任务还是往 steering input 里打字”这条细粒度运行时协议。

## 1. 底栏不是装饰性状态条，而是一套可操作的工作面

源码镜像：[`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/PromptInput/PromptInput.tsx), [`../../src/components/PromptInput/PromptInputFooterLeftSide.tsx`](../../src/components/PromptInput/PromptInputFooterLeftSide.tsx), [`../../src/components/tasks/BackgroundTaskStatus.tsx`](../../src/components/tasks/BackgroundTaskStatus.tsx), [`../../src/components/CoordinatorAgentStatus.tsx`](../../src/components/CoordinatorAgentStatus.tsx), [`../../src/state/teammateViewHelpers.ts`](../../src/state/teammateViewHelpers.ts)

前一卷已经说明：

- `footerSelection` 是全局状态
- `coordinatorTaskIndex` 和 `selectedIPAgentIndex` 是两套不同游标

这一卷继续回答更具体的问题：

- `tasks` pill 什么时候出现
- teammate pill 和 summary pill 什么时候互斥
- `Enter` 为什么在不同模式下会打开 dialog、切到 transcript、或回到 leader
- `x` 为什么有时是 dismiss，有时又只是往输入框写一个字符

所以这里讨论的不是 footer 怎么画，而是 footer 如何接管局部操控权。

## 2. `footerItems` 是真实的导航目录，不是渲染时顺手拼出来的一排标签

源码镜像：[`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/PromptInput/PromptInput.tsx)

`PromptInput.tsx` 里显式构造了：

- `tasks`
- `tmux`
- `bagel`
- `teams`
- `bridge`
- `companion`

并且注释写得很清楚：

- order here IS the nav order

因此这排 pill 不是视觉顺序碰巧等于键盘顺序，而是一个真实的可导航目录。

## 3. `tasksFooterVisible` 不是“有运行任务就显示”，而是把多个任务数据面合并后的 steering gate

源码镜像：[`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/PromptInput/PromptInput.tsx), [`../../src/components/tasks/taskStatusUtils.tsx`](../../src/components/tasks/taskStatusUtils.tsx), [`../../src/components/CoordinatorAgentStatus.tsx`](../../src/components/CoordinatorAgentStatus.tsx)

`tasksFooterVisible` 的条件实际是：

- `runningTaskCount > 0`
- 或 ant 模式下 `coordinatorTaskCount > 0`
- 且 `!shouldHideTasksFooter(tasks, showSpinnerTree)`

所以它同时吸收了三种现实：

- 普通 background tasks
- panel-managed local_agent rows
- teammate tree 接管时的 footer 隐藏策略

这说明 `tasks` pill 不是某一类任务的别名，而是底栏里的统一 task steering 入口。

## 4. `hasBgTaskPill` 说明 `tasks` pill 和 coordinator panel 不是一回事

源码镜像：[`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/PromptInput/PromptInput.tsx)

`hasBgTaskPill` 的判定只看：

- `isBackgroundTask(t)`
- 且 ant 模式下排除 `isPanelAgentTask(t)`

这意味着：

- panel-managed `local_agent` 可以存在
- 但并不自动等于“有一个 generic background-task pill”

所以底栏里“tasks”这一项，本身还要再细分：

- generic summary pill
- teammate pill strip
- coordinator-only rows but no generic pill

## 5. `selectFooterItem('tasks')` 会同时重置两条子状态机，说明 tasks pill 是多个 steering surface 的统一入口

源码镜像：[`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/PromptInput/PromptInput.tsx)

`selectFooterItem(item)` 并不只是改 `footerSelection`。

当 `item === 'tasks'` 时，它还会：

- `setTeammateFooterIndex(0)`
- `setCoordinatorTaskIndex(minCoordinatorIndex)`

也就是说，一旦焦点切到 `tasks` pill，Claude Code 会同步把：

- teammate footer 子光标
- coordinator panel 子光标

都重置到它们各自的起点。

所以 `tasks` pill 不只是一个条目名，而是一个复合 steering namespace。

## 6. `navigateFooter()` 把 pill 导航建成了可复用 primitive，而不是把方向键逻辑散在事件处理里

源码镜像：[`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/PromptInput/PromptInput.tsx)

`navigateFooter(delta, exitAtStart)` 的协议很简洁：

- 找当前选中项的索引
- 取 `footerItems[idx + delta]`
- 有下一项就切过去
- 如果往回走且 `exitAtStart = true`
  - 允许直接 clear selection

这说明 footer nav 不是 ad hoc 事件逻辑，而是一层复用型操作原语，后面的 `footer:up/down/next/previous` 都是在调用它。

## 7. `footer:up/down` 的第一优先级不是切 pill，而是先在 coordinator panel 内部消化移动

源码镜像：[`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/PromptInput/PromptInput.tsx)

在 `tasksSelected && ant && coordinatorTaskCount > 0` 时：

- `footer:up`
  - 先尝试 `coordinatorTaskIndex - 1`
- `footer:down`
  - 先尝试 `coordinatorTaskIndex + 1`

只有不在 coordinator panel 可滚动区时，才退回到 `navigateFooter()`

这说明一旦 `tasks` pill 接上了 coordinator rows，方向键就不再主要服务 pill 之间切换，而是先服务 panel 内部导航。

## 8. `footer:down` 里“tasksSelected 且非 teammate mode”直接开 tasks dialog，说明底栏任务入口默认指向的是任务控制台，而不是 summary pill 本身

源码镜像：[`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/PromptInput/PromptInput.tsx)

这里有个很强的分叉：

- `tasksSelected && !isTeammateMode`
  - `setShowBashesDialog(true)`
  - `selectFooterItem(null)`

也就是说，在 generic task mode 下，继续向下并不是“选中 pill 内部某一行”，而是直接打开后台任务工作面。

这说明 summary pill 只是压缩入口，真正的细节工作面仍然是 dialog。

## 9. `footer:next/previous` 在 teammate mode 下不走 pill 导航，而是切换 `teammateFooterIndex`

源码镜像：[`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/tasks/BackgroundTaskStatus.tsx)

当 `tasksSelected && isTeammateMode` 时：

- `footer:next`
  - `(prev + 1) % totalAgents`
- `footer:previous`
  - `(prev - 1 + totalAgents) % totalAgents`

其中 `totalAgents = 1 + inProcessTeammates.length`，多出来的那个 `1` 就是 leader。

所以 teammate footer strip 不是简单的 pill 高亮，而是一套独立于 `footerItems` 的二级环形导航。

## 10. `BackgroundTaskStatus` 真正把 `teammateFooterIndex` 解释成了“leader + teammates”的 pill 级游标

源码镜像：[`../../src/components/tasks/BackgroundTaskStatus.tsx`](../../src/components/tasks/BackgroundTaskStatus.tsx)

在 teammate mode 下，它会先构造：

- `mainPill`
- alphabetically sorted `teammateEntries`

再合成：

- `allPills = [mainPill, ...teammatePills]`

最后把：

- `selectedIdx = tasksSelected ? teammateFooterIndex : -1`

映射到这些 pill 上。

因此 `teammateFooterIndex = 0` 的真实语义不是“第一个 teammate”，而是“leader pill”。

## 11. teammate footer strip 还有一层视窗协议，说明这不是纯逻辑状态，而是可横向滚动的真实 surface

源码镜像：[`../../src/components/tasks/BackgroundTaskStatus.tsx`](../../src/components/tasks/BackgroundTaskStatus.tsx)

它不会盲目把所有 teammate pill 全塞出来，而是会：

- 计算每个 pill 的 `stringWidth`
- 用 `calculateHorizontalScrollWindow(...)`
- 得到 `startIndex/endIndex/showLeftArrow/showRightArrow`

也就是说，`teammateFooterIndex` 不只是逻辑选中项，它还驱动一个横向滚动窗口，确保被选中的 pill 始终落在可见区域里。

## 12. `footer:openSelected` 把 tasks item 分成三套不同 steering 语义

源码镜像：[`../../src/components/PromptInput/PromptInput.tsx`](../../src/state/teammateViewHelpers.ts), [`../../src/components/CoordinatorAgentStatus.tsx`](../../src/components/CoordinatorAgentStatus.tsx)

当 `footerItemSelected === 'tasks'` 时，`Enter` 会走三种分支：

- teammate mode
  - `teammateFooterIndex === 0` -> `exitTeammateView()`
  - 否则 -> `enterTeammateView(teammate.id)`
- coordinator mode
  - `coordinatorTaskIndex === 0` -> `exitTeammateView()`
  - `>= 1` -> `enterTeammateView(selectedTaskId)`
- generic mode
  - 打开任务 dialog

所以同一个 `tasks` item，在运行时其实会被动态解释成：

- leader/team steering bar
- local-agent panel selector
- generic task console launcher

## 13. `footer:close` 说明 `x` 不是固定的“关闭任务”，而是上下文相关的 steering 指令

源码镜像：[`../../src/components/PromptInput/PromptInput.tsx`](../../src/state/teammateViewHelpers.ts)

当 `tasksSelected && coordinatorTaskIndex >= 1` 时：

- 如果当前 row 正是 `viewingAgentTaskId`
  - 不会 dismiss
  - 而是向输入框插入 `'x'`
- 否则
  - `stopOrDismissAgent(task.id, setAppState)`

这说明对“正在前台查看的 local agent”来说，`x` 被当成 steering input；对其他已选 agent row，`x` 才是 stop/dismiss 动作。

所以底栏这里已经不是简单快捷键，而是一个 context-sensitive control surface。

## 14. `stopOrDismissAgent()` 把 footer 的 `x` 分成 running 和 terminal 两条任务生命周期路径

源码镜像：[`../../src/state/teammateViewHelpers.ts`](../../src/state/teammateViewHelpers.ts)

`stopOrDismissAgent(taskId, setAppState)` 的语义是：

- `running`
  - `abortController?.abort()`
- terminal
  - `release(task)`
  - `evictAfter = 0`
  - 如果正看着它，还要退回 leader

所以 footer 上这个 close 动作并不是单一的 UI 删除，而是直接映射到：

- 停止当前执行
- 或立即驱逐终态 panel row

## 15. `PromptInputFooterLeftSide` 证明 summary pill 和 teammate pills 是互斥的两种底栏工作面

源码镜像：[`../../src/components/PromptInput/PromptInputFooterLeftSide.tsx`](../../src/components/tasks/BackgroundTaskStatus.tsx)

这层的核心分叉是：

- `hasTeammatePills`
  - `BackgroundTaskStatus` 单独占一行
  - 其他 parts 放到第二行
- 否则
  - `tasksPart` 作为单个 summary pill 并入正常 byline

这说明底栏任务区不是一套组件换皮，而是两套不同密度的工作面：

- teammate strip：可横向导航、可直接切 transcript
- summary pill：压缩入口、再通向 dialog

## 16. `tasksPart` 被刻意做成 Box sibling，而不是内联文本，说明 footer steering 已经影响到渲染树结构

源码镜像：[`../../src/components/PromptInput/PromptInputFooterLeftSide.tsx`](../../src/components/PromptInput/PromptInputFooterLeftSide.tsx)

源码里有一条很实的注释：

- `BackgroundTaskStatus` 不能嵌进 `<Text wrap="truncate">`
- 否则会触发 `Box-in-Text` 的 reconciler 错误

所以 `tasksPart` 被特地提升成外层 `Box` sibling。

这说明 footer steering 不只是状态协议，它已经反向约束了底栏的实际树结构和可点击区域组织方式。

## 17. `getSpinnerHintParts()` 和 manage hint 说明底栏会持续把 steering 协议显式教给用户

源码镜像：[`../../src/components/PromptInput/PromptInputFooterLeftSide.tsx`](../../src/components/PromptInput/PromptInputFooterLeftSide.tsx)

这里有两类 hint：

- `ctrl+t`
  - `show tasks / show teammates / hide`
- tasks 管理 hint
  - 未选中时：`↓ to manage`
  - 选中时：`Enter to view tasks`

因此 Claude Code 并没有把底栏 steering 协议藏在实现细节里，而是持续把下一步可做动作反射到 footer 文案中。

## 18. 这条链的真正结构，是“一个 footer 目录 + 三套 tasks 子解释器 + 一个上下文相关的 close/open 协议”

源码镜像：[`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/PromptInput/PromptInputFooterLeftSide.tsx), [`../../src/components/tasks/BackgroundTaskStatus.tsx`](../../src/state/teammateViewHelpers.ts)

从上到下可以把底栏任务 steering 压成四层：

- `footerItems`
  - 底栏主目录
- `tasks` item
  - generic summary pill
  - teammate pill strip
  - coordinator panel proxy
- `footer:openSelected`
  - leader/teammate/local_agent/dialog 四路分发
- `footer:close`
  - steering input / abort / dismiss 三路分发

真正值得记住的不是某个键位，而是 Claude Code 已经把底栏做成了一个可操作的 steering runtime，而不是只读状态栏。
