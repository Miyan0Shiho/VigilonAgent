# Agent Remote Launch / Remote Task Runtime Bridge

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Agent Invocation / Task Host / Background Lifecycle Bridge`](./58-agent-invocation-task-host-and-background-lifecycle-bridge.md) | [`下一站：Remote Agent Task Polling / Restore / Archive Runtime`](./30-remote-agent-task-polling-restore-and-archive-runtime.md)

`58` 已经把 agent 调用怎样升级成 task host 讲清了，但其中还有一条专门的远端分支没有独立成卷：`AgentTool` 并不会把 remote agent 当成 “async local agent 的另一种 UI 文案”，而是会在调用期直接切换到 `RemoteAgentTask` 这套云端宿主。

这一卷只讲这条桥：

- `tools/AgentTool/AgentTool.tsx`
- `tools/AgentTool/UI.tsx`
- `tasks/RemoteAgentTask/RemoteAgentTask.tsx`
- `utils/task/framework.ts`
- `utils/task/diskOutput.ts`
- `utils/sessionStorage.ts`

重点不是重讲远端轮询细节，而是讲 `remote_launched` 结果面、`registerRemoteAgentTask()` 注册边界、sidecar/output 物化，以及为什么 agent invocation 到 remote task runtime 的切换在产品上是“一跳换宿主”。

## 1. `AgentTool` 的 remote isolation 不是 background 变体，而是直接切到另一条宿主分支

源码镜像：[`../../src/tools/AgentTool/AgentTool.tsx`](../../src/tools/AgentTool/AgentTool.tsx)

`AgentTool.tsx` 在决定 effective isolation 后，遇到 `effectiveIsolation === 'remote'` 会直接走独立分支：

- 先 `checkRemoteAgentEligibility()`
- 再 `teleportToRemote(...)`
- 成功后立刻 `registerRemoteAgentTask(...)`
- 最后返回 `status: 'remote_launched'`

也就是说 remote agent 不是：

- 先注册 `LocalAgentTask`
- 再把它迁到远端

而是一开始就不进入本地 async-agent host。

## 2. `remote_launched` 本身就是一条宿主切换完成信号

源码镜像：[`../../src/tools/AgentTool/AgentTool.tsx`](../../src/tools/AgentTool/AgentTool.tsx), [`../../src/tools/AgentTool/UI.tsx`](../../src/tools/AgentTool/UI.tsx)

`AgentTool` 返回的 remote result 只带几件东西：

- `taskId`
- `sessionUrl`
- `description`
- `prompt`
- `outputFile`

`UI.tsx` 看到 `status === 'remote_launched'` 时也只渲染：

- `Remote agent launched`
- `taskId`
- `sessionUrl`

这说明 transcript 里的这一跳不是远端执行 transcript，而是“本地已经把工作交接给 remote task runtime”的 receipt。

## 3. remote 分支的本地锚点不是 transcript，而是 `taskId + outputFile + sidecar`

源码镜像：[`../../src/tools/AgentTool/AgentTool.tsx`](../../src/tools/AgentTool/AgentTool.tsx), [`../../src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../src/tasks/RemoteAgentTask/RemoteAgentTask.tsx), [`../../src/utils/task/diskOutput.ts`](../../src/utils/task/diskOutput.ts), [`../../src/utils/sessionStorage.ts`](../../src/utils/sessionStorage.ts)

`registerRemoteAgentTask()` 被调用后，本地立刻物化三样东西：

- task framework 里的 `remote_agent` state
- 预先创建的 task output file
- session sidecar 里的 remote-agent metadata

所以 remote agent 调用虽然执行体不在本地，但 Claude Code 仍会马上留下：

- 可管理的后台任务 ID
- 可读的输出文件路径
- 可恢复的 session identity

这就是为什么 `remote_launched` 可以像正常后台任务一样进入 `BackgroundTasksDialog` 和通知链。

## 4. `registerRemoteAgentTask()` 不是 UI 辅助函数，而是 remote host 的正式出生点

源码镜像：[`../../src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../src/tasks/RemoteAgentTask/RemoteAgentTask.tsx), [`../../src/utils/task/framework.ts`](../../src/utils/task/framework.ts)

这个注册函数一次完成了四件正式动作：

- `generateTaskId('remote_agent')`
- `initTaskOutput(taskId)`
- `registerTask(taskState, setAppState)`
- `persistRemoteAgentMetadata(...)`

然后才启动 `startRemoteSessionPolling(...)`。

这说明 remote agent 的真正出生顺序是：

1. 先在本地任务框架落壳
2. 再启动远端观察循环

不是先让轮询跑起来，再慢慢把任务补进 UI。

## 5. remote agent 和 `ultrareview/ultraplan` 共用同一个 task family，只是 `remoteTaskType` 不同

源码镜像：[`../../src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../src/tasks/RemoteAgentTask/RemoteAgentTask.tsx)

`RemoteAgentTaskState` 的正式类型是：

- `type: 'remote_agent'`
- `remoteTaskType: 'remote-agent' | 'ultraplan' | 'ultrareview' | ...`

所以 `AgentTool` 触发的 remote agent 在运行时并不是另一种 task framework 类型，而是：

- 和 remote review 共用同一个远端宿主
- 只是 completion 语义与 UI 文案不同

这也是为什么 `30` 能把它们统一写成 “remote job runtime adapter”。

## 6. `toolUseId` 会被一路带进 remote task state，保证之后还能回挂到原始 tool call

源码镜像：[`../../src/tools/AgentTool/AgentTool.tsx`](../../src/tools/AgentTool/AgentTool.tsx), [`../../src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../src/tasks/RemoteAgentTask/RemoteAgentTask.tsx)

`AgentTool` 在注册时把 `toolUseContext.toolUseId` 传给了 `registerRemoteAgentTask(...)`。后者会把它写进：

- `createTaskStateBase(..., toolUseId)`
- persisted metadata
- 后续 notification XML

这意味着 remote launch 虽然立刻脱离了前台 transcript，但并没有失去和原始 agent tool invocation 的身份关联。

## 7. `outputFile` 被提前放进 `remote_launched` result，是为了让本地调用面立刻有稳定读口

源码镜像：[`../../src/tools/AgentTool/AgentTool.tsx`](../../src/tools/AgentTool/AgentTool.tsx), [`../../src/utils/task/diskOutput.ts`](../../src/utils/task/diskOutput.ts)

`AgentTool` 在 remote result 里直接返回：

- `outputFile: getTaskOutputPath(taskId)`

而这时远端消息可能还一条都没 poll 回来。

这说明 `outputFile` 的角色不是“执行完后的附件”，而是 remote host 一创建就对外承诺的稳定接口。后续无论是：

- detail dialog
- `TaskOutputTool`
- notification handoff

都可以立刻用同一条文件路径对接。

## 8. 本地把 remote agent 交出去之后，`UI.tsx` 故意不显示远端 transcript，避免宿主语义混乱

源码镜像：[`../../src/tools/AgentTool/UI.tsx`](../../src/tools/AgentTool/UI.tsx)

和 `completed` 或 `async_launched` 不同，`remote_launched` 结果面不会展开：

- prompt transcript
- progress transcript
- final assistant message

原因不是信息不够，而是宿主已经变了。真正的后续显示面应该走：

- `RemoteAgentTask`
- task list / detail dialog
- notification / output file

而不是继续挤在原来的 `tool_result` block 里。

## 9. `cleanup` 返回值说明 remote host 从一开始就被视为可独立停机的后台单元

源码镜像：[`../../src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../src/tasks/RemoteAgentTask/RemoteAgentTask.tsx)

`registerRemoteAgentTask()` 返回：

- `taskId`
- `sessionId`
- `cleanup`

其中 `cleanup` 就是 `startRemoteSessionPolling()` 的 stop handle。

这进一步说明 remote agent 一旦 launch，就已经被收编成 task runtime owned object，不再是某次 `AgentTool` 调用里的临时分支。

## 10. 这条桥解释了为什么 `58` 和 `30` 必须分开

`58` 讲的是：

- `AgentTool` 如何把一次调用分到 local foreground/background/main-session host

`30` 讲的是：

- `RemoteAgentTask` 一旦出生后，如何轮询、恢复、归档、通知

而这一卷补的是中间缺掉的一跳：

- `AgentTool` 什么时候决定放弃本地 host
- 怎样把 invocation identity 压缩成 `remote_launched`
- 如何同步落下 `taskId/outputFile/sidecar`
- 为什么 UI 从这一刻开始就应该切去 task-oriented 工作面

## 11. 这条桥也解释了 `remote_launched` 为什么和 `async_launched` 不能共用同一个结果面

表面上两者都像“后台化”。

但本质不同：

- `async_launched`：执行体还在本地 agent runtime，后续能 retain、append、panel-view
- `remote_launched`：执行体已经换成 CCR session，本地只保留 task shell、poller、output file 和 sidecar

所以 UI 才会对它们采用两种完全不同的 disclosure contract。

## 12. 当前边界

这一卷不重复展开：

- 远端轮询、stable-idle、review/ultraplan 特判细节
- remote detail dialog、task list、footer status 的展示面
- direct-connect / SSH viewer 与 remote-agent task 的差别

这些分别继续由：

- [`./30-remote-agent-task-polling-restore-and-archive-runtime.md`](./30-remote-agent-task-polling-restore-and-archive-runtime.md)
- [`../architecture/19-background-task-aggregation-and-list-runtime.md`](../architecture/19-background-task-aggregation-and-list-runtime.md)
- [`../architecture/20-task-status-and-footer-surfaces.md`](../architecture/20-task-status-and-footer-surfaces.md)
- [`./36-remote-interactive-host-adapters-and-failure-semantics.md`](./36-remote-interactive-host-adapters-and-failure-semantics.md)

承接。
