# TaskCreate / TaskList / TaskGet / TaskUpdate Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：FileRead / Grep / WebSearch Runtime`](./32-file-read-grep-and-websearch-runtime.md) | [`下一站：Task Watcher / Claiming / Team Status Runtime`](./34-task-watcher-claiming-and-team-status-runtime.md)

本文把 `TaskCreateTool + TaskListTool + TaskGetTool + TaskUpdateTool + utils/tasks.ts` 从旧的任务总述里再往下拆一层。重点不是“任务文件怎么存”，而是任务工具怎样把文件协议、hook、所有权、依赖关系和 teammate workflow 暴露成一套可被模型直接驱动的 runtime。

## 1. 这四个工具不是对 `utils/tasks.ts` 的薄包装，而是四种不同的任务控制面

源码镜像：[`../../sources/claude-code/src/tools/TaskCreateTool/TaskCreateTool.ts`](../../sources/claude-code/src/tools/TaskCreateTool/TaskCreateTool.ts), [`../../sources/claude-code/src/tools/TaskListTool/TaskListTool.ts`](../../sources/claude-code/src/tools/TaskListTool/TaskListTool.ts), [`../../sources/claude-code/src/tools/TaskGetTool/TaskGetTool.ts`](../../sources/claude-code/src/tools/TaskGetTool/TaskGetTool.ts), [`../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts`](../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts)

它们各自控制的是不同粒度：

- `TaskCreateTool`: 创建新 work item
- `TaskListTool`: 暴露整个 task board 的摘要面
- `TaskGetTool`: 打开单任务详情
- `TaskUpdateTool`: 推进生命周期、依赖和所有权

因此任务工具族不是一个 CRUD 包，而是一套面向 agent workflow 的四分面。

## 2. 四个工具都挂 `shouldDefer`，说明任务面被当成可按需发现的工作流能力，而不是永远常驻的小工具

源码镜像：[`../../sources/claude-code/src/tools/TaskCreateTool/TaskCreateTool.ts`](../../sources/claude-code/src/tools/TaskCreateTool/TaskCreateTool.ts), [`../../sources/claude-code/src/tools/TaskListTool/TaskListTool.ts`](../../sources/claude-code/src/tools/TaskListTool/TaskListTool.ts), [`../../sources/claude-code/src/tools/TaskGetTool/TaskGetTool.ts`](../../sources/claude-code/src/tools/TaskGetTool/TaskGetTool.ts), [`../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts`](../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts)

这说明 Claude Code 没把任务系统降格成永远裸露的“todo helper”。它把任务能力视为需要时再暴露的 higher-level workflow surface。

## 3. `isTodoV2Enabled()` 揭示了任务工具的宿主边界: 交互式 CLI 默认开，非交互模式默认关，除非显式环境变量强开

源码镜像：[`../../sources/claude-code/src/utils/tasks.ts`](../../sources/claude-code/src/utils/tasks.ts)

真实 gate 很简单：

- `CLAUDE_CODE_ENABLE_TASKS=true` 强开
- 否则只在 interactive session 打开

这表明任务工具首先服务于 Claude Code 的交互式工作流，不是假定所有 SDK/print 场景都该自动带上任务系统。

## 4. `TaskCreateTool` 真正创建的不是 todo 文本，而是一个带默认生命周期语义的 task object

源码镜像：[`../../sources/claude-code/src/tools/TaskCreateTool/TaskCreateTool.ts`](../../sources/claude-code/src/tools/TaskCreateTool/TaskCreateTool.ts)

创建时直接固化：

- `status: 'pending'`
- `owner: undefined`
- `blocks: []`
- `blockedBy: []`

这意味着新任务从一开始就被放进统一协议，而不是先建个草稿对象，后面再补字段。

## 5. `TaskCreateTool` 的 prompt 说明它的定位不是记事本，而是“复杂任务的结构化计划器”

源码镜像：[`../../sources/claude-code/src/tools/TaskCreateTool/prompt.ts`](../../sources/claude-code/src/tools/TaskCreateTool/prompt.ts)

prompt 里明确规定：

- 复杂多步任务主动建 task list
- plan mode 建 task list
- 用户给多项要求时立即 capture 成任务
- 开工前标 `in_progress`
- 完成后标 `completed`

这说明 TaskCreate 不是单纯给用户看进度条，而是 Claude Code 自己的计划执行协议入口。

## 6. teammate 模式下，TaskCreate 的 prompt 已经假设任务会跨 agent 流转

源码镜像：[`../../sources/claude-code/src/tools/TaskCreateTool/prompt.ts`](../../sources/claude-code/src/tools/TaskCreateTool/prompt.ts)

当 swarm 打开后，prompt 会额外强调：

- 描述要足够详细，能交给另一个 agent
- 新任务默认无 owner
- 若要指派给 teammate，用 `TaskUpdate.owner`

也就是说，任务创建阶段就已经带上了多人协作约束，而不是单 agent 心智模型。

## 7. `executeTaskCreatedHooks()` 说明任务创建不是本地落盘即成功，而是先过 hook gate

源码镜像：[`../../sources/claude-code/src/tools/TaskCreateTool/TaskCreateTool.ts`](../../sources/claude-code/src/tools/TaskCreateTool/TaskCreateTool.ts)

创建流程是：

1. 先 `createTask()`
2. 跑 `executeTaskCreatedHooks()`
3. 若出现 blocking error，立刻 `deleteTask()`

这说明 TaskCreateTool 的成功语义不是“文件写成了”，而是“写成后也通过了创建时约束”。

## 8. 创建后强制展开 `expandedView = tasks`，说明任务工具不是后台静默协议，而是会主动改前台 operator surface

源码镜像：[`../../sources/claude-code/src/tools/TaskCreateTool/TaskCreateTool.ts`](../../sources/claude-code/src/tools/TaskCreateTool/TaskCreateTool.ts)

只要创建或更新任务，Claude Code 就倾向把任务面板抬到前台。任务 runtime 因而同时影响：

- model state
- file state
- UI focus state

## 9. `TaskListTool` 不是把目录全量 dump 出来，而是返回一个专门为调度决策整形过的摘要板

源码镜像：[`../../sources/claude-code/src/tools/TaskListTool/TaskListTool.ts`](../../sources/claude-code/src/tools/TaskListTool/TaskListTool.ts)

它返回的不是完整 task schema，而只保留：

- `id`
- `subject`
- `status`
- `owner`
- `blockedBy`

说明 List 面的目标是帮助模型判断“下一步做什么”，而不是替代 `TaskGet`。

## 10. `_internal` metadata 过滤说明 task 文件可以承载系统态，但 TaskList 不把内部实现细节暴露给模型

源码镜像：[`../../sources/claude-code/src/tools/TaskListTool/TaskListTool.ts`](../../sources/claude-code/src/tools/TaskListTool/TaskListTool.ts)

List 阶段会直接过滤：

- `t.metadata?._internal`

这体现了任务系统的一个重要分层：文件协议可以带内部控制信息，但摘要控制面不会把这些实现细节回灌给模型。

## 11. `resolvedTaskIds` 过滤暴露出一个细粒度设计: List 面只暴露“仍然有效的 blocker”

源码镜像：[`../../sources/claude-code/src/tools/TaskListTool/TaskListTool.ts`](../../sources/claude-code/src/tools/TaskListTool/TaskListTool.ts)

`blockedBy` 并不是原样返回，而是先剔除已经 `completed` 的任务 ID。也就是说，TaskList 给模型的不是原始图结构，而是“当前仍然生效的依赖图”。

## 12. `TaskListTool` 的 prompt 已经内置 teammate 调度策略，而不是只告诉模型“把列表列出来”

源码镜像：[`../../sources/claude-code/src/tools/TaskListTool/prompt.ts`](../../sources/claude-code/src/tools/TaskListTool/prompt.ts)

尤其在 teammate 模式下，它明确写了：

- 先找 `pending + no owner + empty blockedBy`
- 多个可选任务优先按 ID 顺序
- 完成当前任务后先 `TaskList`

这说明 TaskList 在产品上承担了一个 lightweight scheduler 的角色。

## 13. `TaskGetTool` 的定位是详情拉取器，不是通用读接口

源码镜像：[`../../sources/claude-code/src/tools/TaskGetTool/TaskGetTool.ts`](../../sources/claude-code/src/tools/TaskGetTool/TaskGetTool.ts), [`../../sources/claude-code/src/tools/TaskGetTool/prompt.ts`](../../sources/claude-code/src/tools/TaskGetTool/prompt.ts)

它刻意只暴露：

- `subject`
- `description`
- `status`
- `blocks`
- `blockedBy`

这说明 Get 面服务的是“开工前拿完整要求、看依赖、理解上下文”，不是为了替代底层 JSON。

## 14. `task: null` 和 `Task not found` 被当作正常 tool_result，而不是异常

源码镜像：[`../../sources/claude-code/src/tools/TaskGetTool/TaskGetTool.ts`](../../sources/claude-code/src/tools/TaskGetTool/TaskGetTool.ts)

这和 TaskUpdate 的 benign failure 语义是一致的：任务列表是并发变化的，所以“没找到”被视为模型可恢复条件，不应该把整个工具执行流炸掉。

## 15. `TaskUpdateTool` 才是任务家族真正复杂的中枢

源码镜像：[`../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts`](../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts)

它不仅改字段，还同时负责：

- 生命周期推进
- owner 自动填充
- metadata merge/delete
- 依赖边更新
- completed hook gate
- teammate mailbox 通知
- verification nudge

所以 TaskUpdate 的真实语义是“推进任务 runtime”，不是 patch JSON。

## 16. `deleted` 被编码成 status 的扩展动作，而不是单独的删除工具

源码镜像：[`../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts`](../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts)

输入 schema 允许：

- `TaskStatusSchema().or(z.literal('deleted'))`

这说明删除在产品上被当作生命周期里的特例分支，而不是另一套完全独立的 control plane。

## 17. metadata merge 语义不是替换，而是 key-level overlay，`null` 代表删除

源码镜像：[`../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts`](../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts)

这说明 metadata 被当成长期挂在任务上的增量上下文容器，而不是一次性 payload。模型可以逐步丰富，也可以局部擦除。

## 18. swarm 模式下，`in_progress` 且未显式 owner 时会自动填 owner，说明 UI activity 和任务所有权被正式绑定

源码镜像：[`../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts`](../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts)

这条自动补 owner 的逻辑不是锦上添花，而是为了让任务列表能够可靠映射：

- 谁在做哪件事
- spinner 上该显示谁的 activity

即任务所有权协议直接喂给前台 teammate status surface。

## 19. 完成任务前要过 `executeTaskCompletedHooks()`，所以“完成”是被审查的状态跃迁

源码镜像：[`../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts`](../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts)

`status === 'completed'` 时不会直接写盘，而是：

1. 跑 completed hooks
2. 收集 blocking errors
3. 有阻断则拒绝完成

这说明 completed 并不是 agent 自说自话的标记，而是一个带 gate 的受控跃迁。

## 20. owner 变化后写 teammate mailbox，说明任务指派不是被动轮询，而是带显式通知通道

源码镜像：[`../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts`](../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts)

当 owner 变化时，会发一条 `task_assignment` mailbox message。也就是说，任务系统不仅靠别人 `TaskList` 发现工作，也支持 leader 显式派发。

## 21. `addBlocks` 和 `addBlockedBy` 说明依赖图在工具层就是一等能力

源码镜像：[`../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts`](../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts), [`../../sources/claude-code/src/utils/tasks.ts`](../../sources/claude-code/src/utils/tasks.ts)

这两组字段都会落到 `blockTask()`，而 `blockTask()` 会双向维护：

- source 的 `blocks`
- target 的 `blockedBy`

所以任务依赖不是显示层推导，而是底层持久关系。

## 22. `verificationNudgeNeeded` 说明 TaskUpdate 还承担 loop-exit 级的行为矫正

源码镜像：[`../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts`](../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts)

当主线程刚关闭一个 3+ 任务列表、又没有任何 verification task 时，它会把 verifier 提醒直接拼到 tool_result 里。说明任务工具不只是记状态，还在约束“收尾时别漏验证”。

## 23. `TaskUpdate` 的 benign failure 设计是为了避免 sibling tool cancellation

源码镜像：[`../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts`](../../sources/claude-code/src/tools/TaskUpdateTool/TaskUpdateTool.ts)

即使失败，它也尽量返回正常 `tool_result` 而不是抛硬错。源码注释已经写明原因：不要触发 `StreamingToolExecutor` 里的兄弟工具取消。

## 24. `getTaskListId()` 解释了为什么这些工具首先是“命名空间工具”，其次才是任务工具

源码镜像：[`../../sources/claude-code/src/utils/tasks.ts`](../../sources/claude-code/src/utils/tasks.ts)

优先级是：

1. `CLAUDE_CODE_TASK_LIST_ID`
2. in-process teammate context 的 `teamName`
3. process teammate 的 `getTeamName()`
4. leader 侧 `leaderTeamName`
5. 最后退回 `sessionId`

所以所有 Task*Tool 首先先决定“我们在改哪块共享任务板”，再谈具体操作。

## 25. `createTask()` 和 `resetTaskList()` 说明 TaskCreate 背后不是 append-only，而是带高水位和锁的 durable allocator

源码镜像：[`../../sources/claude-code/src/utils/tasks.ts`](../../sources/claude-code/src/utils/tasks.ts)

关键点包括：

- `.lock`
- `.highwatermark`
- `findHighestTaskId()`
- `LOCK_OPTIONS`

这意味着 TaskCreateTool 的“生成新 ID”不是轻量自增变量，而是多进程并发下仍要稳定的持久分配器。

## 26. `deleteTask()` 不是删文件即完，而是要级联清理其他任务里的依赖引用

源码镜像：[`../../sources/claude-code/src/utils/tasks.ts`](../../sources/claude-code/src/utils/tasks.ts)

删除后还会遍历所有任务，把这个 task 从：

- `blocks`
- `blockedBy`

里一并摘掉。这说明删除语义是“维护任务图一致性”，不是单点物理删除。

## 27. `claimTask()` 说明真正的“领取下一件工作”协议主要在底层，而不是只在 TaskUpdate prompt 里

源码镜像：[`../../sources/claude-code/src/utils/tasks.ts`](../../sources/claude-code/src/utils/tasks.ts)

它会结构化拒绝：

- `task_not_found`
- `already_claimed`
- `already_resolved`
- `blocked`
- `agent_busy`

而且 `checkAgentBusy` 会升级成 task-list-level 锁，避免 TOCTOU race。说明任务领取在 Claude Code 里是正式的并发协议。

## 28. 从产品角度看，这四个工具共同组成了一套最小调度回路

实际闭环是：

1. `TaskCreateTool` 建立工作项
2. `TaskListTool` 暴露当前可做工作
3. `TaskGetTool` 拉完整上下文
4. `TaskUpdateTool` 标 in-progress / completed / owner / dependencies

底下再由 `utils/tasks.ts` 保证持久性和并发安全。也就是说，Claude Code 已经把任务系统做成了一个可被模型直接操控的小型工作流引擎。

## 交叉参考

- 任务文件协议与自动拾取：[`./10-task-list-and-ownership.md`](./10-task-list-and-ownership.md)
- 子代理与后台任务：[`./06-tasks-subagents-and-background.md`](./06-tasks-subagents-and-background.md)
- Workflow / Monitor 外围任务契约：[`./24-workflow-monitor-gates-task-types-and-surface-contracts.md`](./24-workflow-monitor-gates-task-types-and-surface-contracts.md)
- 旧的工具总述：[`./08-read-search-web-and-task-tools.md`](./08-read-search-web-and-task-tools.md)
