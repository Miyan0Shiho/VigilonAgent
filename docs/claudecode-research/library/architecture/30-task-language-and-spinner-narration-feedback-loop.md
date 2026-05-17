# Task Language / Spinner Narration / Feedback Loop

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：TaskListV2 / Priority / Blockers / Rendering Protocol`](./29-tasklistv2-priority-blockers-and-rendering-protocol.md) | [`下一站：Task Frontend Selection / View State Machine`](./31-task-frontend-selection-and-view-state-machine.md)

本文继续沿任务前台往下钻，但不再讲“任务如何排序”，而是专门讲任务语言如何反向接管 Claude Code 的主工作叙述：`TaskCreate/TaskUpdate` 为什么要求 `subject + activeForm` 双字段、spinner 为什么优先读 `activeForm`、`findNextPendingTask()` 为什么要给出一个 blocker-aware 的 “Next:” 提示，以及这整条链为什么本质上是“任务系统向主 UI 回灌语言”。

## 1. 任务对象不只是状态容器，它还携带一套面向主 UI 的叙事字段

源码镜像：[`../../src/utils/tasks.ts`](../../src/utils/tasks.ts), [`../../src/tools/TaskCreateTool/TaskCreateTool.ts`](../../src/tools/TaskCreateTool/TaskCreateTool.ts), [`../../src/tools/TaskUpdateTool/TaskUpdateTool.ts`](../../src/tools/TaskUpdateTool/TaskUpdateTool.ts)

`TaskSchema` 里和叙事直接相关的字段其实有两层：

- `subject`
- `activeForm?`

这里最关键的是 `activeForm` 在 schema 注释里就被定义成：

- “present continuous form for spinner”

也就是说，任务板从一开始就不是只给 `TaskListV2` 看。它还预留了一个专门服务主 spinner 文案的字段。

## 2. `TaskCreateTool` 的输入协议已经把“任务语言”建模成 imperative + progressive 双形态

源码镜像：[`../../src/tools/TaskCreateTool/TaskCreateTool.ts`](../../src/tools/TaskCreateTool/TaskCreateTool.ts), [`../../src/tools/TaskCreateTool/prompt.ts`](../../src/tools/TaskCreateTool/prompt.ts)

`TaskCreateTool` 不只是让模型填一条标题，它要求：

- `subject`: brief title
- `description`
- `activeForm?`: spinner 用的进行时

配套 prompt 还把这两个字段的语法差异写死了：

- `subject` 要用 imperative form
- `activeForm` 要用 present continuous form

所以 Claude Code 不是让模型自由发挥任务措辞，而是显式要求同一任务同时拥有：

- 面向任务板的结果式标题
- 面向工作中状态条的进行式文案

## 3. `TaskCreateTool/prompt.ts` 已经把 spinner fallback 规则前置进工具提示词

源码镜像：[`../../src/tools/TaskCreateTool/prompt.ts`](../../src/tools/TaskCreateTool/prompt.ts)

`TaskCreateTool` 的 prompt 里明确告诉模型：

- `activeForm` shown in spinner when the task is `in_progress`
- if omitted, spinner shows `subject`

这意味着 spinner 文案逻辑并不是只埋在 React 组件里。工具 prompt 先把这条运行时规则暴露给模型，要求模型在生成任务时就主动适配 UI 叙事层。

换句话说，这条链不是：

- 模型生成 task
- UI 被动展示 task

而是：

- UI/runtime 规则先进入 tool prompt
- 模型按这个规则生产 task 语言
- spinner 再消费这些字段

## 4. `TaskUpdateTool` 延续了同样的语言协议，说明任务叙事是可演化状态，不是创建时一次性定死

源码镜像：[`../../src/tools/TaskUpdateTool/TaskUpdateTool.ts`](../../src/tools/TaskUpdateTool/TaskUpdateTool.ts), [`../../src/tools/TaskUpdateTool/prompt.ts`](../../src/tools/TaskUpdateTool/prompt.ts)

`TaskUpdateTool` 也允许更新：

- `subject`
- `description`
- `activeForm`
- `status`

而且它的 prompt 继续保留：

- `subject` imperative
- `activeForm` progressive

这说明 Claude Code 认为任务文案不是静态元数据。任务一旦进入真实执行期，模型或 teammate 可能需要重新修正：

- 任务标题
- 当前正在做什么的进行式说法

因此“任务语言”本身也是运行时状态的一部分。

## 5. `TaskUpdateTool` 只有在字段变化时才写回，说明 `activeForm` 被当成真实状态，而不是可随手重刷的 UI 文案

源码镜像：[`../../src/tools/TaskUpdateTool/TaskUpdateTool.ts`](../../src/tools/TaskUpdateTool/TaskUpdateTool.ts)

`TaskUpdateTool` 更新 `activeForm` 的条件很严格：

- `activeForm !== undefined`
- 且 `activeForm !== existingTask.activeForm`

才会写入 `updates.activeForm` 并记录到 `updatedFields`

这意味着：

- `activeForm` 有显式变更语义
- tool result 里会留下“这次修改了 activeForm” 的痕迹

所以它不是每轮都重写的装饰字段，而是一个需要保持稳定、只在必要时演化的叙事状态。

## 6. spinner 主文案优先级明确把 `activeForm` 放在 `subject` 之前

源码镜像：[`../../src/components/Spinner.tsx`](../../src/components/Spinner.tsx)

leader spinner 的核心选择链是：

- `overrideMessage`
- `currentTodo.activeForm`
- `currentTodo.subject`
- `randomVerb`

这条优先级非常关键：

- 如果调用方手动覆盖，用 `overrideMessage`
- 否则只要任务处于进行中，就优先吃任务自己的进行式文案
- 没有进行式文案，才退回任务标题
- 连任务都没有，才退回随机 spinner verb

因此 `activeForm` 不是“可选补充”。它实际上是任务系统接管主 spinner 语言的最高优先级入口。

## 7. `subject` 的作用不是被 `activeForm` 取代，而是承担统一 fallback 和列表主语法

源码镜像：[`../../src/components/Spinner.tsx`](../../src/components/TaskListV2.tsx)

上一卷已经说明：

- `TaskListV2` 主行总是围绕 `subject`

而这一卷补上另一半：

- spinner 在没有 `activeForm` 时，也会退回到 `subject`

所以 `subject` 同时承担两件事：

- 任务板中的稳定任务名
- 主 spinner 的后备叙事词

这正是 imperative form 合理的原因。它既能当任务标题，也能在缺失进行式时勉强充当工作动词。

## 8. `findNextPendingTask()` 不是随便找第一条 pending，而是在做一次 blocker-aware 的“下一步可做项”推断

源码镜像：[`../../src/components/Spinner.tsx`](../../src/utils/tasks.ts)

`findNextPendingTask()` 的逻辑是：

- 先过滤所有 `pending`
- 构造 `unresolvedIds = status !== completed`
- 先找 `blockedBy` 不命中任何 unresolved task 的 pending
- 找不到再退回第一条 pending

所以 `Next:` 提示不是：

- “下一条列表项”

而是：

- “当前最有可能直接开工的 pending task”

这和 `TaskListV2` 的 blocker-aware 排序是一致的，但更进一步，因为它把这个排序结果压缩成了一句主工作面提示。

## 9. spinner 的 `Next:` 提示消费的是 `subject`，说明“下一步”是结果式承诺，不是进行式状态

源码镜像：[`../../src/components/Spinner.tsx`](../../src/tools/TaskCreateTool/prompt.ts)

spinner 里显示的是：

- `Next: ${nextTask.subject}`

而不是 `nextTask.activeForm`

这说明 Claude Code 对两种语言有明确分工：

- `activeForm`: 讲“现在正在做什么”
- `subject`: 讲“接下来要完成什么”

也就是说，当前态和未来态不是同一套词法。一个用进行式，一个用祈使/结果式。

## 10. `TaskCreateTool` 和 `TaskUpdateTool` 都会自动展开任务面板，说明任务语言回灌主 UI 不是隐性副作用，而是产品故意暴露的工作面

源码镜像：[`../../src/tools/TaskCreateTool/TaskCreateTool.ts`](../../src/tools/TaskUpdateTool/TaskUpdateTool.ts)

无论是 create 还是 update，这两个工具都会：

- `context.setAppState(...)`
- 把 `expandedView` 推到 `'tasks'`

这意味着：

- 任务语言一旦变化
- Claude Code 默认认为用户应该立刻看到任务面板

所以 `activeForm/subject` 不是只有 spinner 偷偷消费的内部字段，它们也会驱动一个显式的 UI 聚焦动作。

## 11. `TaskUpdateTool` 的“开始工作”范式与 spinner 叙事强绑定

源码镜像：[`../../src/tools/TaskUpdateTool/prompt.ts`](../../src/tools/TaskUpdateTool/TaskUpdateTool.ts)

`TaskUpdateTool` prompt 里有一条很强的工作流约束：

- starting work 时要 mark `in_progress`

而 spinner 读取 `activeForm/subject` 的前提，正是有一个 `currentTodo`：

- `status !== pending`
- `status !== completed`

也就是说，只有任务真的被推到 `in_progress`，它的 `activeForm` 才能接管 leader spinner。任务状态机和主叙事机在这里是硬耦合的。

## 12. 随机 spinner verb 只是兜底层，Claude Code 的真实方向是让任务系统逐步替代默认泛化文案

源码镜像：[`../../src/components/Spinner.tsx`](../../src/tools/TaskCreateTool/prompt.ts), [`../../src/tools/TaskUpdateTool/prompt.ts`](../../src/tools/TaskUpdateTool/prompt.ts)

spinner 仍然保留：

- `sample(getSpinnerVerbs())`

但这套随机 verb 明显只是最后兜底，因为在更高层已经有三重更具体的来源：

- `overrideMessage`
- `activeForm`
- `subject`

再加上两个 tool prompt 都在主动教育模型填写 `activeForm`，可以看出产品方向并不是继续依赖通用 spinner 文案，而是让任务系统产出的结构化语言逐步成为主叙事来源。

## 13. 这条链的本质不是“任务影响 spinner”，而是 Claude Code 把计划语言、执行语言、下一步语言统一进了同一个 task object

源码镜像：[`../../src/utils/tasks.ts`](../../src/tools/TaskCreateTool/TaskCreateTool.ts), [`../../src/tools/TaskCreateTool/prompt.ts`](../../src/tools/TaskUpdateTool/TaskUpdateTool.ts), [`../../src/components/Spinner.tsx`](../../src/components/TaskListV2.tsx)

这条反馈回路可以压缩成三种语言：

- `subject`: 计划语言 / 结果语言
- `activeForm`: 执行语言 / 进行中语言
- `Next: subject`: 下一步语言

而它们都挂在同一个 `Task` 上。

所以真正值得记住的不是某个小函数，而是 Claude Code 已经把：

- 任务规划
- 任务执行状态
- 主工作面叙事
- 下一步提示

合并进了同一个任务对象协议。任务系统不只是协作板，它已经开始接管整个 REPL 的语言外壳。
