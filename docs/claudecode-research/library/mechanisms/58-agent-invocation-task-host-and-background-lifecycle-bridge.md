# Agent Invocation / Task Host / Background Lifecycle Bridge

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Agent Tool UI / Progress Grouping / Result Surfaces`](./57-agent-tool-ui-progress-grouping-and-result-surfaces.md) | [`下一站：Agent Remote Launch / Remote Task Runtime Bridge`](./59-agent-remote-launch-and-remote-task-runtime-bridge.md)

前面的 agent 卷册已经把几层东西分别拆开了：

- `51` 讲 definition / spawn / handoff
- `57` 讲一次 `AgentTool` 调用在 transcript 里怎么显示
- `53/54` 讲 `LocalAgentTask` 和 `main-session` task host 的长期生存期

但中间还有一层关键桥没有独立成卷：一次 agent invocation 是怎样从“前台 tool result”升级成“真正的 task host 和后台生命周期”的。

这一卷只讲这条跨层桥：

- `tools/AgentTool/AgentTool.tsx`
- `tools/AgentTool/agentToolUtils.ts`
- `tasks/LocalAgentTask/LocalAgentTask.tsx`
- `tasks/LocalMainSessionTask.ts`

重点不是再讲 UI，也不是再讲 task host 细节，而是讲 host registration、background signal、retain-aware append、以及 foreground/background 两套 agent 生命周期怎样在中间接起来。

## 1. `AgentTool.tsx` 先决定“这次调用属于哪种宿主”，然后才决定结果面

源码镜像：[`../../src/tools/AgentTool/AgentTool.tsx`](../../src/tools/AgentTool/AgentTool.tsx)

`AgentTool` 本体不只是挑 agent definition。它还要在调用期决定这次工作最终落到哪种宿主：

- 同步完成：直接回 `status='completed'`
- async 本地 agent：注册 `LocalAgentTask`
- remote agent：注册 `RemoteAgentTask`
- teammate spawn：走 swarm teammate runtime
- foreground local agent：先注册可 background 的 foreground host

也就是说，`AgentTool/UI.tsx` 最后看到的 `completed / async_launched / remote_launched / teammate_spawned`，本质上是 `AgentTool.tsx` 在调用期先分配好的 host family。

## 2. foreground agent 不是“普通同步调用”，而是先注册成可被打断升级的 host

源码镜像：[`../../src/tasks/LocalAgentTask/LocalAgentTask.tsx`](../../src/tasks/LocalAgentTask/LocalAgentTask.tsx)

`registerAgentForeground(...)` 很重要。它创建的不是纯临时状态，而是一份正式 `LocalAgentTaskState`：

- `status: 'running'`
- `isBackgrounded: false`
- `retain: false`
- `pendingMessages: []`
- `diskLoaded: false`

同时还生成两样关键控制面：

- `backgroundSignal: Promise<void>`
- 可选 `cancelAutoBackground()`

所以“前台 agent 正在跑”从一开始就不是无宿主状态，而是一个已经登记进 task framework、只是尚未 background 的 local-agent host。

## 3. `backgroundSignal` 才是 foreground -> background 的真正切换闸门

源码镜像：[`../../src/tasks/LocalAgentTask/LocalAgentTask.tsx`](../../src/tasks/LocalAgentTask/LocalAgentTask.tsx)

`registerAgentForeground()` 会把 resolver 存进：

- `backgroundSignalResolvers: Map<taskId, () => void>`

后面两条路径都能触发这根信号：

- 用户显式 `backgroundAgentTask(taskId, ...)`
- auto-background timer 到期

两者都会做两件事：

1. 把 task 的 `isBackgrounded` 置成 `true`
2. resolve `backgroundSignal`

这说明 foreground agent 不靠轮询知道自己被后台化，而是靠一根单次 promise 闸门把“宿主切换”推送回执行流。

## 4. `AgentTool` 从一开始就给 foreground agent 准备了“后面可能变后台”的控制面

源码镜像：[`../../src/tools/AgentTool/AgentTool.tsx`](../../src/tools/AgentTool/AgentTool.tsx)

从 imports 和装配关系可以看出，`AgentTool` 本体同时依赖：

- `registerAgentForeground`
- `registerAsyncAgent`
- `unregisterAgentForeground`
- `completeAgentTask / failAgentTask / killAsyncAgent`
- `runAsyncAgentLifecycle`

这不是重复实现，而是说明它把一次调用拆成了两个阶段：

- 前半段：决定是 foreground host、background host、还是 remote host
- 后半段：把真正的流式执行挂到对应 lifecycle driver 上

所以“运行很久后出现 background hint”不是 UI 小补丁，而是前面已经存在的 host registration 终于被暴露给用户。

## 5. async-from-start 和 foreground-later-background 共享同一条 `runAsyncAgentLifecycle()` 主链

源码镜像：[`../../src/tools/AgentTool/agentToolUtils.ts`](../../src/tools/AgentTool/agentToolUtils.ts)

`runAsyncAgentLifecycle()` 的注释直接写明：

- shared between AgentTool's async-from-start path and resumeAgentBackground

这意味着 Claude Code 没给“从一开始就后台运行”和“先前台跑、再 background”维护两套不同收尾逻辑。它们共享：

- stream iteration
- progress tracker
- retain-aware transcript append
- complete/fail/kill 状态切换
- notification
- cleanup

区别只在于最初是怎样进入这条链，而不在于这条链本身做什么。

## 6. retain-aware append 说明 task host 和 transcript 结果面在执行中持续耦合

源码镜像：[`../../src/tools/AgentTool/agentToolUtils.ts`](../../src/tools/AgentTool/agentToolUtils.ts)

`runAsyncAgentLifecycle()` 每收一条 message，都会先看一次 root app state：

- 如果 `task.retain !== true`，不往 `task.messages` 追加
- 如果 `retain === true`，立刻把 message append 到 `task.messages`

这说明 agent invocation 一旦被 panel/viewing 系统持有，就会从“纯 tool result surface”升级成“流式 transcript host”。也就是说：

- 未 retain：主要靠 tool result / output file / notifications
- 已 retain：变成实时可见的 viewed transcript

中间的桥就是这条 append 逻辑。

## 7. `completeAsyncAgent()` 先切状态，再补 handoff/worktree/notification，是为了和 `TaskOutput` / panel 宿主解耦

源码镜像：[`../../src/tools/AgentTool/agentToolUtils.ts`](../../src/tools/AgentTool/agentToolUtils.ts)

异步生命周期的顺序是故意设计过的：

1. `finalizeAgentTool(...)`
2. `completeAsyncAgent(agentResult, rootSetAppState)`
3. 再跑 classifier / worktree / notification embellishment

注释写得很直接：

- 先标记 completed，保证 `TaskOutput(block=true)` 立刻解锁
- 慢的 embellishment 不能阻塞状态切换

所以 invocation 到 task host 的桥接不是“等所有收尾都做完再宣布完成”，而是先把 host 状态推进到 terminal，再慢慢补外围信息。

## 8. `LocalAgentTask` 的 foreground host 和 async host 共享同一 shape，只在启动语义上分叉

源码镜像：[`../../src/tasks/LocalAgentTask/LocalAgentTask.tsx`](../../src/tasks/LocalAgentTask/LocalAgentTask.tsx)

对比：

- `registerAgentForeground(...)`
- `registerAsyncAgent(...)`

可以看到两者都创建 `LocalAgentTaskState`，只是：

- foreground：`isBackgrounded: false`
- async：`isBackgrounded: true`

因此 Claude Code 并没有把“后台 agent”建成另一种 task type，而是把它视为 local-agent host 的另一种初始条件。这样 `53` 里那套 panel、retain、eviction、notification 逻辑才能统一复用。

## 9. `unregisterAgentForeground()` 说明“没被后台化就正常结束”的前台 host 会被完全回收

源码镜像：[`../../src/tasks/LocalAgentTask/LocalAgentTask.tsx`](../../src/tasks/LocalAgentTask/LocalAgentTask.tsx)

如果一个 foreground agent 顺利完成且没有 background，它不会继续留在 task host 生态里。`unregisterAgentForeground()` 会：

- 清理 `backgroundSignalResolvers`
- 只在 `!task.isBackgrounded` 时真正移除 task
- 调用原先登记的 cleanup

这说明 foreground host 的意义主要是：

- 让长任务有机会平滑升级成后台任务
- 而不是把所有同步 agent 调用都永久登记进任务系统

## 10. 背景主会话复用的不是 panel 语义，而是“agent-style task host + isolated transcript”语义

源码镜像：[`../../src/tasks/LocalMainSessionTask.ts`](../../src/tasks/LocalMainSessionTask.ts)

`startBackgroundSession(...)` 进一步证明，这套桥不仅服务 subagent，也服务主会话 background：

- `registerMainSessionTask(...)`
- `recordSidechainTranscript(messages, taskId)`
- `runWithAgentContext(...)`
- 增量写 isolated transcript

也就是说，主会话 background 没有复用 `AgentTool/UI.tsx` 那层结果面，但它复用了同一类 task-host thinking：

- 用 `local_agent` 风格 state 托管执行
- 用 isolated transcript 文件对外暴露结果
- 用 task framework 管 foreground/background 切换和通知

这说明 agent invocation 到 task host 的桥，其实已经扩展成了 Claude Code 的通用“长执行单元托管协议”。

## 11. 这条桥解释了为什么 `57` 和 `53/54` 必须分成两卷

如果只看前台，你会以为 agent 只有：

- `completed`
- `async_launched`
- `remote_launched`

但中间实际上还发生了：

- host registration
- backgroundSignal 切换
- retain-aware message append
- state-first terminal transition
- foreground host 回收或后台 host 留存

所以：

- `57` 讲的是调用结果怎么被看见
- `53/54` 讲的是 task host 后续怎么活着
- 这一卷讲的是两者之间怎么连起来

## 12. 当前边界

这一卷不重复展开：

- grouped multi-agent 结果面的 UI 细节
- `LocalAgentTask` 的 panel / evict / notification 细节
- `LocalMainSessionTask` 的 `foregroundedTaskId` 与主会话恢复细节

这些分别已经由：

- [`./57-agent-tool-ui-progress-grouping-and-result-surfaces.md`](./57-agent-tool-ui-progress-grouping-and-result-surfaces.md)
- [`./53-local-agent-task-retention-panel-and-notification-runtime.md`](./53-local-agent-task-retention-panel-and-notification-runtime.md)
- [`./54-main-session-backgrounding-and-task-output-retrieval-runtime.md`](./54-main-session-backgrounding-and-task-output-retrieval-runtime.md)

继续承接。
