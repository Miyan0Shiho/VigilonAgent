# Task Watcher / Claiming / Team Status Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：TaskCreate / TaskList / TaskGet / TaskUpdate Runtime`](./33-task-create-list-get-update-runtime.md) | [`下一站：Workflow / Monitor Console And Task Framework Runtime`](./35-workflow-monitor-console-and-task-framework-runtime.md)

本文继续顺着任务系统往下拆，但不再讲 Task 工具本身，而是讲它们背后的自动调度链：`useTaskListWatcher.ts + useTasksV2.ts + claimTask() + getAgentStatuses() + teammate mailbox task_assignment + inProcessRunner`。这一层真正解决的是“谁来捡下一项工作、前台怎么知道任务状态变了、队友退出后任务怎么回收”。

## 1. 任务系统不只有 CRUD，还有一条正式的自动调度回路

源码镜像：[`../../src/hooks/useTaskListWatcher.ts`](../../src/hooks/useTaskListWatcher.ts), [`../../src/hooks/useTasksV2.ts`](../../src/hooks/useTasksV2.ts), [`../../src/utils/tasks.ts`](../../src/utils/tasks.ts)

从调用关系看，任务系统至少有三层：

- 工具层：创建、列出、读取、更新
- 文件协议层：锁、高水位、claim、unassign、team status
- 调度层：watcher、共享订阅、mailbox 派发、teammate 自领取

所以 Claude Code 的任务体系已经不是“工具 + 文件”，而是一套最小 work scheduler。

## 2. `useTaskListWatcher` 的目标不是看目录变化，而是“目录变化 -> 自动认领 -> prompt 注入”

源码镜像：[`../../src/hooks/useTaskListWatcher.ts`](../../src/hooks/useTaskListWatcher.ts)

它的主循环很清楚：

1. `listTasks()`
2. 若当前任务已完成，清空 `currentTaskRef`
3. `findAvailableTask()`
4. `claimTask()`
5. `formatTaskAsPrompt()`
6. `onSubmitTask(prompt)`
7. 若提交失败，再 `updateTask(owner: undefined)` 释放认领

也就是说 watcher 本质上不是观察器，而是一个最小的任务拉取执行器。

## 3. watcher 刻意把 `isLoading` 和 `onSubmitTask` 收进 ref，说明它首先在规避宿主级 watcher 抖动与死锁

源码镜像：[`../../src/hooks/useTaskListWatcher.ts`](../../src/hooks/useTaskListWatcher.ts)

代码注释已经说明原因：如果 effect 依赖这些不稳定值，就会每回合反复 `watcher.close() + watch()`，而 Bun 的 `PathWatcherManager` 会被这种模式拖进死锁窗口。  
所以这层不是普通 React hook，而是专门为终端宿主的 fs.watch 不稳定性做过防抖设计。

## 4. `DEBOUNCE_MS = 1000` 暴露出 tasks mode 的取舍: 宁可慢 1 秒，也不要被频繁文件写抖成风暴

源码镜像：[`../../src/hooks/useTaskListWatcher.ts`](../../src/hooks/useTaskListWatcher.ts)

这说明任务自动拾取的产品优先级不是“毫秒级实时”，而是“避免重复提交、重复认领和 watcher 风暴”。

## 5. `findAvailableTask()` 不是任意挑 pending，而是硬编码了一个最小可执行判定

源码镜像：[`../../src/hooks/useTaskListWatcher.ts`](../../src/hooks/useTaskListWatcher.ts)

可认领条件是：

- `status === 'pending'`
- `owner` 为空
- `blockedBy` 里的任务都已完成

这说明 tasks mode 的“下一件事”判定不是 prompt 自由发挥，而是底层协议给出的确定性筛选。

## 6. `formatTaskAsPrompt()` 说明自动调度链最终仍回到自然语言 prompt，而不是直接把 task object 塞给 query loop

源码镜像：[`../../src/hooks/useTaskListWatcher.ts`](../../src/hooks/useTaskListWatcher.ts)

watcher 最后会构造：

- `Complete all open tasks. Start with task #...`

再把 subject/description 拼进去。也就是说，任务系统的执行边界仍然是“把结构化任务翻译回语言输入，再走正常 REPL/query loop”。

## 7. `claimTask()` 才是真正的认领协议中心，watcher 只是它的一个消费者

源码镜像：[`../../src/utils/tasks.ts`](../../src/utils/tasks.ts)

认领返回值不是布尔值，而是结构化：

- `success`
- `reason`
- `task`
- `busyWithTasks`
- `blockedByTasks`

这说明 Claude Code 早就把“为什么没认领成功”做成了正式协议，而不是日志文字。

## 8. 普通 claim 路径走 task-level lock，`checkAgentBusy` 路径升级成 task-list-level lock

源码镜像：[`../../src/utils/tasks.ts`](../../src/utils/tasks.ts)

这里的并发策略很关键：

- 普通 claim: 只锁单 task 文件
- busy-check claim: 锁整个 task list

原因是后者要原子地检查“这个 agent 是否已经有别的未完成任务”，否则会有 TOCTOU race。

## 9. `agent_busy` 暴露出任务系统不是只关心任务是否空闲，还关心 agent 负载是否已经占满

源码镜像：[`../../src/utils/tasks.ts`](../../src/utils/tasks.ts)

`claimTaskWithBusyCheck()` 会显式拒绝那些已经持有别的 unresolved tasks 的 agent，并返回：

- `reason: 'agent_busy'`
- `busyWithTasks`

这说明 Claude Code 的任务协议已经在做 very lightweight load balancing。

## 10. `blockedByTasks` 结构化返回说明 dependency failure 被视为一等调度信息，而不是错误文案

源码镜像：[`../../src/utils/tasks.ts`](../../src/utils/tasks.ts)

当任务仍被未完成项阻塞时，claim 结果会带：

- `reason: 'blocked'`
- `blockedByTasks`

这意味着上层调用者可以明确知道下一步该去解什么 blocker，而不是只看到一句“blocked”。

## 11. `notifyTasksUpdated()` 和 `onTasksUpdated` 说明同进程 UI 刷新并不依赖文件 watcher

源码镜像：[`../../src/utils/tasks.ts`](../../src/utils/tasks.ts)

每次 `create/update/delete/reset` 后都会发本进程 signal。这样：

- 同进程写操作能立即刷新 UI
- 不必等 fs.watch 或 fallback poll

说明 Claude Code 在任务系统里明确区分了：

- 同进程即时信号
- 跨进程文件事件

## 12. `useTasksV2` 是 persistent task board 的共享 store，不是每个组件各开一个 watcher

源码镜像：[`../../src/hooks/useTasksV2.ts`](../../src/hooks/useTasksV2.ts)

这个文件的核心不是 fetch，而是 singleton `TasksV2Store`：

- 共享 `#watcher`
- 共享 `#tasks`
- 共享 hide/debounce/poll timers
- `useSyncExternalStore` 暴露稳定快照

这说明任务 UI 面板是 deliberately centralized 的，不让 `REPL / Spinner / Footer` 各自起 watcher。

## 13. `useTasksV2` 的设计目标之一就是避免 Spinner 每回合挂载卸载带来的 watch churn

源码镜像：[`../../src/hooks/useTasksV2.ts`](../../src/hooks/useTasksV2.ts)

注释已经把历史问题写透了：Spinner 会每回合 mount/unmount，如果每个 hook 实例都 watch 同一路径，就会持续抖动。因此任务可视化层不是“谁要看谁去拉”，而是单 store 统一供给。

## 14. 任务列表“自动消失”不是 UI 幻术，而是 store 真会在 5 秒后 `resetTaskList()`

源码镜像：[`../../src/hooks/useTasksV2.ts`](../../src/hooks/useTasksV2.ts), [`../../src/utils/tasks.ts`](../../src/utils/tasks.ts)

当所有任务都 completed 且持续 5 秒：

- 先触发 hide timer
- 再次确认仍全完成
- 真的 `resetTaskList(currentId)`
- 然后 `#tasks = []`，`#hidden = true`

所以“完成后面板消失”其实对应着一次真实的任务板清空，不只是前端隐藏。

## 15. fallback poll 只在仍有未完成任务时开启，说明 store 在文件事件与轮询之间做了节流分工

源码镜像：[`../../src/hooks/useTasksV2.ts`](../../src/hooks/useTasksV2.ts)

策略是：

- 有未完成任务: `FALLBACK_POLL_MS = 5000`
- 全完成或空列表: 不再轮询

这说明轮询只是“防 fs.watch 漏事件”的兜底，不是默认实时通道。

## 16. `useTasksV2` 还会根据当前 `taskListId` 动态 `#rewatch()`，说明 team 创建/删除会改变整块任务板命名空间

源码镜像：[`../../src/hooks/useTasksV2.ts`](../../src/hooks/useTasksV2.ts)

这个行为和 `getTaskListId()` 是呼应的：队伍一旦建立，前台 watcher 必须切到新的目录，不然 UI 和底层任务板就会脱节。

## 17. `getAgentStatuses()` 把 task ownership 直接翻译成 `idle / busy`，说明 teammate status 其实是任务图的投影

源码镜像：[`../../src/utils/tasks.ts`](../../src/utils/tasks.ts)

它会：

- 读 team file
- 读 task list
- 统计 unresolved tasks by owner
- 生成每个成员的 `status` 与 `currentTasks`

所以 team status 不是另外一套心跳协议，而是由任务所有权反推出来的轻量状态面。

## 18. `readTeamMembers()` 和 name/id 双兼容，说明 agent status 计算还承担向后兼容旧 owner 编码

源码镜像：[`../../src/utils/tasks.ts`](../../src/utils/tasks.ts)

`getAgentStatuses()` 会同时按：

- `member.name`
- `member.agentId`

去查 owner。这说明任务协议在演化过程中换过 owner 身份编码，但当前 runtime 仍兼容旧板子。

## 19. `unassignTeammateTasks()` 说明 teammate 退出不是简单“人没了”，而是伴随任务回收与通知重分配

源码镜像：[`../../src/utils/tasks.ts`](../../src/utils/tasks.ts)

当队友 `terminated/shutdown`：

- 所有 unresolved assigned tasks 被改成 `owner: undefined`
- `status` 重置成 `pending`
- 生成面向 leader 的 notification message

这说明 Claude Code 没把 teammate 退出留给人工善后，而是正式提供任务回收语义。

## 20. `task_assignment` mailbox 说明“显式派活”是任务调度链的第一等消息类型

源码镜像：[`../../src/utils/teammateMailbox.ts`](../../src/utils/teammateMailbox.ts), [`../../src/tools/TaskUpdateTool/TaskUpdateTool.ts`](../../src/tools/TaskUpdateTool/TaskUpdateTool.ts)

这条消息是结构化的：

- `type: 'task_assignment'`
- `taskId`
- `subject`
- `description`
- `assignedBy`
- `timestamp`

它不是普通聊天文本，而是任务 runtime 自己定义的 mailbox protocol object。

## 21. `AttachmentMessage` 会把 `task_assignment` 专门渲染成 transcript 行，说明指派不是隐式 side effect，而是用户可见事件

源码镜像：[`../../src/components/messages/AttachmentMessage.tsx`](../../src/components/messages/AttachmentMessage.tsx)

渲染时会特判 JSON 并显示：

- `Task assigned: #id - subject`
- `from assignedBy`

这表明任务派发既是内部协议，也被设计成前台可审计的工作事件。

## 22. in-process teammate 还有一条独立的自领取路径，不完全依赖 leader mailbox 派活

源码镜像：[`../../src/utils/swarm/inProcessRunner.ts`](../../src/utils/swarm/inProcessRunner.ts)

`tryClaimNextTask()` 会：

1. `listTasks()`
2. `findAvailableTask()`
3. `claimTask(taskListId, availableTask.id, agentName)`
4. `updateTask(status: 'in_progress')`
5. `formatTaskAsPrompt()`

所以 in-process teammate 既能被 leader 指派，也能在空闲时自主拉下一件工作。

## 23. 这条自领取路径还会立即改成 `in_progress`，说明它更强调 UI 实时反馈而不是等模型自己再更新

源码镜像：[`../../src/utils/swarm/inProcessRunner.ts`](../../src/utils/swarm/inProcessRunner.ts)

这和普通 watcher 只 claim 不改 status 不同。说明 in-process runner 更希望 front-end 立刻看到“这名 teammate 已经在做事了”。

## 24. 从整体看，Claude Code 的任务调度链是一套混合模型: watcher 拉活 + mailbox 派活 + store 订阅 + claim 锁协议

综合起来，实际存在四种协同机制：

- `useTaskListWatcher`: 目录变化触发自动拉活
- `task_assignment` mailbox: leader 显式派活
- `useTasksV2`: 前台共享订阅与任务板显隐
- `claimTask()/getAgentStatuses()/unassignTeammateTasks()`: 底层并发、安全与队伍状态协议

这说明任务系统已经从“Todo 工具”进化成一个小型多 agent 工作分配运行时。

## 交叉参考

- 任务文件协议与自动拾取总述：[`./10-task-list-and-ownership.md`](./10-task-list-and-ownership.md)
- Task 工具四分面：[`./33-task-create-list-get-update-runtime.md`](./33-task-create-list-get-update-runtime.md)
- Swarm mailbox 与 direct messages：[`./21-swarm-inbox-routing-and-approval-protocols.md`](./21-swarm-inbox-routing-and-approval-protocols.md)
- Swarm teammate runtime：[`./16-swarm-teammates-and-permission-bridges.md`](./16-swarm-teammates-and-permission-bridges.md)
