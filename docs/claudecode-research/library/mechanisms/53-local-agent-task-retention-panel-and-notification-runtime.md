# LocalAgentTask / Retention / Panel / Notification Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Agent Invocation / Task Host / Background Lifecycle Bridge`](./58-agent-invocation-task-host-and-background-lifecycle-bridge.md) | [`下一站：Main Session Backgrounding / Task Output Retrieval Runtime`](./54-main-session-backgrounding-and-task-output-retrieval-runtime.md)

前两卷已经把 `AgentTool` 的 spawn/runtime 和 agent memory 拆开了，但还有一层关键桥接层没有独立成册：agent 真正跑起来以后，Claude Code 怎么把它变成一个“可保留、可前台查看、可进入 coordinator panel、可发通知、可自动驱逐”的本地任务对象。

这一卷只讲这条桥：

- `tasks/LocalAgentTask/LocalAgentTask.tsx`
- `state/teammateViewHelpers.ts`
- `components/CoordinatorAgentStatus.tsx`
- `tools/AgentTool/agentToolUtils.ts`
- `tools/AgentTool/AgentTool.tsx`
- `state/AppStateStore.ts`
- `state/selectors.ts`
- `tools/AgentTool/agentColorManager.ts`
- `screens/REPL.tsx`

## 1. `LocalAgentTaskState` 不是普通后台任务，而是 agent transcript 的本地宿主对象

源码镜像：[`../../sources/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx`](../../sources/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx)

`LocalAgentTaskState` 除了常见 task 字段，还额外挂了一组只属于 agent 的运行时状态：

- `agentId`
- `prompt`
- `selectedAgent`
- `agentType`
- `progress`
- `result`
- `messages`
- `pendingMessages`
- `retain`
- `diskLoaded`
- `evictAfter`
- `isBackgrounded`

这说明它不是“agent 跑完以后顺便登记一下”的薄包装，而是：

- agent transcript 的本地副本宿主
- foreground/background 切换的真实状态载体
- panel / footer / viewed transcript / notification 这几条前台线的共享数据面

## 2. `local_agent` 被故意切成两类：`main-session` 之外的才进入 panel 生态

源码镜像：[`../../sources/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx`](../../sources/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx)

`isPanelAgentTask()` 的定义非常硬：

- 必须是 `local_agent`
- 并且 `agentType !== 'main-session'`

这意味着 Claude Code 没把所有 agent task 都塞进统一“后台任务”概念里，而是单独拉出一类 panel-managed local agents。

## 3. `retain` 不是“正在看”，而是“UI 正在持有这个 task”

源码镜像：[`../../sources/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx`](../../sources/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx), [`../../sources/claude-code/src/state/teammateViewHelpers.ts`](../../sources/claude-code/src/state/teammateViewHelpers.ts)

注释直接区分了两件事：

- `viewingAgentTaskId` 是 “what am I LOOKING at”
- `retain` 是 “what am I HOLDING”

`enterTeammateView()` 会把 `local_agent` 设成：

- `retain: true`
- `evictAfter: undefined`

`exitTeammateView()` / switch-away 则把它 release 回 stub：

- `retain: false`
- `messages: undefined`
- `diskLoaded: false`
- terminal task 才补 `evictAfter = now + PANEL_GRACE_MS`

所以 retain 的真实职责是：

- 阻止驱逐
- 允许流式 append
- 触发 REPL 去磁盘 bootstrap transcript

## 4. transcript 保留协议是 “disk prefix + live suffix” 的双源拼接

源码镜像：[`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx), [`../../sources/claude-code/src/tools/AgentTool/agentToolUtils.ts`](../../sources/claude-code/src/tools/AgentTool/agentToolUtils.ts)

保留后的 viewed transcript 不是每次整盘重读，而是：

- `runAsyncAgentLifecycle()` 在 `retain === true` 时立刻把新 message append 到 `task.messages`
- REPL 发现 `retain && !diskLoaded` 时再异步读 sidechain transcript
- 按 `uuid` 去重，把 disk-only messages 拼到 live messages 前面

这套协议的关键假设是：

- disk 写入先于 yield
- live stream 总是 disk transcript 的 suffix
- bootstrap 只补前缀，不覆盖 live

## 5. `pendingMessages` 和 `appendMessageToLocalAgent()` 被故意拆成“输入投递”和“显示投递”两条线

源码镜像：[`../../sources/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx`](../../sources/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx), [`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx)

两条路径职责不同：

- `queuePendingMessage()` / `drainPendingMessages()`：
  - 进入 agent 下一轮 API 输入
  - 不直接改 transcript 显示
- `appendMessageToLocalAgent()`：
  - 立刻把 `Message` 插进 `task.messages`
  - 只负责前台 viewed transcript 回显

因此 local agent 能同时做到“继续执行”和“立即可见”。

## 6. `evictAfter` 才是 panel row 生命周期的真时钟

源码镜像：[`../../sources/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx`](../../sources/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx), [`../../sources/claude-code/src/components/CoordinatorAgentStatus.tsx`](../../sources/claude-code/src/components/CoordinatorAgentStatus.tsx)

`evictAfter` 有三种关键语义：

- `undefined`：运行中或 retained，不应被驱逐
- `timestamp`：terminal 后 linger，过期后删
- `0`：立即 dismiss

`CoordinatorTaskPanel` 每秒 tick 一次：

- 重算 elapsed
- 驱逐 `(evictAfter ?? Infinity) <= now` 的 panel task

所以已结束 agent 不会立刻消失，而是有明确 grace period。

## 7. `x` 键的语义是状态敏感的：running 是 stop，terminal 是 clear

源码镜像：[`../../sources/claude-code/src/state/teammateViewHelpers.ts`](../../sources/claude-code/src/state/teammateViewHelpers.ts)

`stopOrDismissAgent()` 的分支是：

- `running`：`abortController.abort()`
- terminal：`release(task)` 后强制 `evictAfter = 0`
- 若当前正 viewing 该 agent，则同步退回 leader

所以 panel 文案里的 `x to stop` / `x to clear` 是真实状态机，不是纯展示层差异。

## 8. `agentNameRegistry` 是 direct-message 和 panel 命名共用的身份表

源码镜像：[`../../sources/claude-code/src/tools/AgentTool/AgentTool.tsx`](../../sources/claude-code/src/tools/AgentTool/AgentTool.tsx), [`../../sources/claude-code/src/state/AppStateStore.ts`](../../sources/claude-code/src/state/AppStateStore.ts), [`../../sources/claude-code/src/components/CoordinatorAgentStatus.tsx`](../../sources/claude-code/src/components/CoordinatorAgentStatus.tsx)

async agent spawn 成功后，如果提供了 `name`，`AgentTool.tsx` 会登记：

- `name -> agentId`

这张表被多处复用：

- `SendMessageTool` 做 name-based routing
- `CoordinatorTaskPanel` 反转成 `agentId -> name`
- 其他 swarm/typeahead 前台也能共享这份身份语义

## 9. `getActiveAgentForInput()` 正式把 local agent 纳入输入路由

源码镜像：[`../../sources/claude-code/src/state/selectors.ts`](../../sources/claude-code/src/state/selectors.ts)

输入路由不是二元的，而是三态：

- `leader`
- `viewed`
- `named_agent`

其中 `named_agent` 就是：

- 当前 `viewingAgentTaskId` 指向一个 `local_agent`

所以 viewed local agent 不是只读日志，而是真正可继续对话的子线程。

## 10. `isBackgrounded` 管执行宿主，`retain` 管 transcript host

源码镜像：[`../../sources/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx`](../../sources/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx)

注册时刻就故意分成两类：

- `registerAgentForeground()`：`isBackgrounded: false`
- `registerAsyncAgent()`：`isBackgrounded: true`

前者还会拿到 `backgroundSignal` 和可选 `autoBackgroundMs`。

因此：

- `isBackgrounded` 解决执行路径和 hint/auto-background
- `retain` 解决 viewed transcript、bootstrap、eviction

两者是正交维度。

## 11. 通知协议不是自然语言 toast，而是 XML task-notification 契约

源码镜像：[`../../sources/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx`](../../sources/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx)

`enqueueAgentNotification()` 发出去的是结构化 XML，包含：

- `task_id`
- `tool_use_id`
- `output_file`
- `status`
- `summary`
- optional `result`
- optional `usage`
- optional `worktree`

而且它先原子地把 `notified` 置真，防止重复通知。

## 12. 本地 agent 生命周期被故意拆成“先切 status，再慢补通知”

源码镜像：[`../../sources/claude-code/src/tools/AgentTool/agentToolUtils.ts`](../../sources/claude-code/src/tools/AgentTool/agentToolUtils.ts), [`../../sources/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx`](../../sources/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx)

`runAsyncAgentLifecycle()` 的顺序是：

- 先 `completeAsyncAgent()` / `failAsyncAgent()` / `killAsyncAgent()`
- 再做 handoff/worktree/partial-result/notification

核心目的很明确：

- 先解除 `TaskOutput(block=true)` 等待
- 再补慢收尾信息

所以 Claude Code 把“状态切换”和“通知装饰”设计成了两阶段协议。

## 13. panel row 的叙述依赖 agent 自己的活动语义，而不是 generic task status

源码镜像：[`../../sources/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx`](../../sources/claude-code/src/components/CoordinatorAgentStatus.tsx)

`AgentProgress` 记录的不只是百分比，而是：

- `toolUseCount`
- `tokenCount`
- `lastActivity`
- `recentActivities`
- optional `summary`

`CoordinatorTaskPanel` 优先显示：

- `task.progress.summary`
- 否则退回 `task.description`

这意味着 panel row 的主叙述会被 agent 自己的活动摘要反向塑形。

## 14. `agentColorManager` 给 specialist agent 稳定身份色，但默认 general-purpose 故意无色

源码镜像：[`../../sources/claude-code/src/tools/AgentTool/agentColorManager.ts`](../../sources/claude-code/src/tools/AgentTool/agentColorManager.ts)

这层只做一件事：

- `agentType -> stable color`

并且：

- `general-purpose` 返回 `undefined`
- 颜色落在 bootstrap-level `agentColorMap`

这说明默认子代理不被强制标成某种角色色，而 specialist agent 才有持续身份色。

## 15. 这条链真正补上的是 “spawn runtime -> task host -> panel surface -> notification protocol” 中间层

如果把几篇 agent 文档合起来看：

- `mechanisms/51`
  - agent definitions、spawn host、runAgent、handoff
- `mechanisms/52`
  - agent memory、snapshot、builtin specialist prompt
- `mechanisms/53`
  - LocalAgentTask 作为本地宿主、retain/bootstrap/eviction、panel 和通知协议

也就是说，Claude Code 的 agent 并不是 spawn 之后自然变成“后台任务”，而是先经过一层 `LocalAgentTask` host，才真正变成：

- 可被看见
- 可被继续对话
- 可被 coordinator panel 操作
- 可被结构化通知
- 可被 grace-period 驱逐
