# TaskStopTool / stopTask / Shared Kill Path / SDK Bookend Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：EnterWorktree / ExitWorktree / Session Switching / Cleanup Runtime`](./78-enter-exit-worktree-session-switching-and-cleanup-runtime.md) | [`下一站：LSPTool / Initialization / Deferred Loading / Diagnostic Attachment Runtime`](./80-lsp-tool-initialization-deferred-loading-and-diagnostic-attachment-runtime.md)

本文把 `TaskStopTool` 从旧的 tasks/background 总述里单独拆出来。重点不是“有个停止任务的工具”，而是 Claude Code 怎样把一次 stop 操作收束成一条共享 kill path：

- `TaskStopTool`
- `stopTask(...)`
- `getTaskByType(...).kill(...)`
- `task-specific kill semantics`
- `XML notification suppression`
- `SDK task_notification bookend`

这条链本质上是“让 LLM 工具调用”和 “SDK control request” 共用同一条后台任务终止运行时，而不是各自随便改状态”。

## 1. `TaskStopTool` 自己很薄，真正的实现故意下沉到共享 helper

源码镜像：[`../../sources/claude-code/src/tools/TaskStopTool/TaskStopTool.ts`](../../sources/claude-code/src/tools/TaskStopTool/TaskStopTool.ts), [`../../sources/claude-code/src/tasks/stopTask.ts`](../../sources/claude-code/src/tasks/stopTask.ts)

`TaskStopTool.call()` 只做三件事：

- 兼容 `task_id` 和 legacy `shell_id`
- 从 `getAppState()` 做一次本地 validate
- 调 `stopTask(id, { getAppState, setAppState })`

也就是说，工具层没有私有 kill 逻辑。Claude Code 明确把“停止后台任务”的真相源放进了 `tasks/stopTask.ts`。

## 2. prompt contract 也很克制：它不是通用“取消一切”，只承认 running background task

源码镜像：[`../../sources/claude-code/src/tools/TaskStopTool/prompt.ts`](../../sources/claude-code/src/tools/TaskStopTool/prompt.ts)

提示词只承诺：

- stop a running background task
- 参数是 `task_id`
- 返回 success/failure status

没有扩展成：

- stop current turn
- interrupt foreground REPL
- 批量 kill

这说明 `TaskStop` 的作用域被刻意限制在 `AppState.tasks` 这张后台任务表。

## 3. validate 阶段先在工具入口挡掉最常见错误：缺参、找不到、不是 running

源码镜像：[`../../sources/claude-code/src/tools/TaskStopTool/TaskStopTool.ts`](../../sources/claude-code/src/tools/TaskStopTool/TaskStopTool.ts)

`validateInput()` 在真正调用前就会检查：

- `task_id ?? shell_id` 是否存在
- `appState.tasks[id]` 是否存在
- `task.status === 'running'`

所以模型侧首先看到的是：

- `Missing required parameter: task_id`
- `No task found with ID: ...`
- `Task ... is not running (status: ...)`

而不是 tool body 里再抛异常。

## 4. 但共享 helper 仍然重复做一次同类检查，因为 SDK control request 也复用它

源码镜像：[`../../sources/claude-code/src/tasks/stopTask.ts`](../../sources/claude-code/src/tasks/stopTask.ts), [`../../sources/claude-code/src/cli/print.ts`](../../sources/claude-code/src/cli/print.ts)

`stopTask(...)` 自己还会再校验一次：

- `not_found`
- `not_running`
- `unsupported_type`

原因很直接：这条 helper 不只被 `TaskStopTool` 调，还被 `print.ts` 里的 SDK `stop_task` control request 复用。工具层的 validate 不能替代共享运行时的安全检查。

## 5. 所谓“停止任务”不是统一写死状态，而是先按 `task.type` 找到真正的 task host

源码镜像：[`../../sources/claude-code/src/tasks.ts`](../../sources/claude-code/src/tasks.ts), [`../../sources/claude-code/src/tasks/stopTask.ts`](../../sources/claude-code/src/tasks/stopTask.ts)

`stopTask(...)` 的核心分派是：

- `const taskImpl = getTaskByType(task.type)`
- `await taskImpl.kill(taskId, setAppState)`

而 `getTaskByType(...)` 来源于统一 task registry：

- `LocalShellTask`
- `LocalAgentTask`
- `RemoteAgentTask`
- `DreamTask`
- feature-gated `LocalWorkflowTask`
- feature-gated `MonitorMcpTask`

所以 `TaskStop` 真正做的是“把 stop 请求路由给正确宿主”，不是直接改 `task.status`。

## 6. 本地 shell 的 kill 语义最特殊：要 suppress 噪音型 “137 exited” 通知

源码镜像：[`../../sources/claude-code/src/tasks/stopTask.ts`](../../sources/claude-code/src/tasks/stopTask.ts), [`../../sources/claude-code/src/tasks/LocalShellTask/guards.ts`](../../sources/claude-code/src/tasks/LocalShellTask/guards.ts), [`../../sources/claude-code/src/tasks/LocalShellTask/LocalShellTask.tsx`](../../sources/claude-code/src/tasks/LocalShellTask/LocalShellTask.tsx)

`stopTask(...)` 对 `local_bash` 有一段专门逻辑：

- 如果是 `LocalShellTask`
- 并且还没 `notified`
- 就先把 `notified: true` 写回状态

注释把原因写得很明确：

- Bash kill 后的 “exit code 137” 是噪音
- agent task 的 abort notification 则是有价值的 partial result

这就是为什么 shell stop 和 agent stop 不能共享完全一致的通知策略。

## 7. suppress XML 通知以后，还要手动补一条 SDK bookend，不然 headless 客户端会丢结束事件

源码镜像：[`../../sources/claude-code/src/tasks/stopTask.ts`](../../sources/claude-code/src/tasks/stopTask.ts), [`../../sources/claude-code/src/utils/sdkEventQueue.ts`](../../sources/claude-code/src/utils/sdkEventQueue.ts)

当本地 bash 被标记成 `notified: true` 以后，标准 XML `<task_notification>` 路径就被压掉了。于是 `stopTask(...)` 会直接调用：

- `emitTaskTerminatedSdk(taskId, 'stopped', { toolUseId, summary })`

`sdkEventQueue.ts` 把这条事件定义成：

- `type: 'system'`
- `subtype: 'task_notification'`

所以 suppress XML 不是 suppress 终态，而是把“面向 REPL transcript 的通知”换成“面向 SDK 消费者的直接 bookend”。

## 8. 这条 bookend 语义很关键，因为 `registerTask()` 总会发 `task_started`

源码镜像：[`../../sources/claude-code/src/utils/sdkEventQueue.ts`](../../sources/claude-code/src/utils/sdkEventQueue.ts)

`emitTaskTerminatedSdk(...)` 的注释把 contract 说得很清楚：

- `registerTask()` 总会发 `task_started`
- terminal path 必须补 closing bookend
- 但如果 XML 已经会被 `print.ts` 解析成同一个事件，就不能双发

所以 stop runtime 的一大责任，其实是避免：

- SDK panel 没收到 “结束”
- 或同一个任务收到两次 “结束”

## 9. `LocalShellTask.kill()` 本身很薄，说明 shell 终止的真内核在 `killTask(...)`

源码镜像：[`../../sources/claude-code/src/tasks/LocalShellTask/LocalShellTask.tsx`](../../sources/claude-code/src/tasks/LocalShellTask/LocalShellTask.tsx)

`LocalShellTask.kill()` 几乎只做：

- `killTask(taskId, setAppState)`

这说明 `TaskStopTool` 不持有 shell process 终止细节，`LocalShellTask` 也不持有完整 stop policy；真正的 shell terminate + output cleanup 仍在更下层的 shell host 实现里。

## 10. `LocalAgentTask.kill()` 和 shell 完全不同：它要保留 transcript，并进入 panel linger

源码镜像：[`../../sources/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx`](../../sources/claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx)

`killAsyncAgent(...)` 会：

- `abortController.abort()`
- `unregisterCleanup?.()`
- 状态改成 `killed`
- `endTime = Date.now()`
- `evictAfter = retain ? undefined : Date.now() + PANEL_GRACE_MS`
- 清掉 `selectedAgent`
- 然后 `evictTaskOutput(taskId)`

这说明 local agent stop 不是立即把任务从前台蒸发掉，而是保留一段 panel grace period，给 operator 看见这次 kill 的收尾状态。

## 11. remote agent 的 kill 又是第三种语义：本地先封账，再异步 archive 云端 session

源码镜像：[`../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx)

`RemoteAgentTask.kill()` 会：

- 把本地状态改成 `killed`
- 直接 `notified: true`
- `emitTaskTerminatedSdk(taskId, 'stopped', ...)`
- 如果有 `sessionId`，异步 `archiveRemoteSession(sessionId)`
- `evictTaskOutput(taskId)`
- `removeRemoteAgentMetadata(taskId)`

也就是说 remote stop 的真相不是“让远端自己回来报 terminated”，而是本地先收束状态，再 fire-and-forget 清理云端资源。

## 12. 这也解释了为什么 `stopTask(...)` 要按宿主分派，而不能自己统一改状态

同样叫 stop，不同 host 的后果差异很大：

- `local_bash`
  - suppress XML 噪音通知
  - 直接补 SDK bookend
- `local_agent`
  - abort controller
  - 保留 transcript + linger panel
- `remote_agent`
  - 先本地封账
  - 再 archive cloud session

所以 `stopTask(...)` 的价值不在于“少写几行代码”，而在于把“同一 stop 意图”正确落到三种宿主语义上。

## 13. `TaskStopTool` 的前台表面也很克制：tool-use 静默，tool-result 只回一行 “command stopped”

源码镜像：[`../../sources/claude-code/src/tools/TaskStopTool/UI.tsx`](../../sources/claude-code/src/tools/TaskStopTool/UI.tsx)

UI 层有两个明显选择：

- `renderToolUseMessage()` 直接返回空串
- `renderToolResultMessage()` 只显示截断后的 `command + " · stopped"`

并且默认最多：

- 2 行
- 160 字符

所以这把工具的 UI 目标不是解释 stop 过程，而是把 transcript 噪音压到最低。

## 14. `task_id` 与 legacy `shell_id` 双字段不是偶然，而是 KillShell 的兼容壳

源码镜像：[`../../sources/claude-code/src/tools/TaskStopTool/TaskStopTool.ts`](../../sources/claude-code/src/tools/TaskStopTool/TaskStopTool.ts)

工具定义里显式保留了：

- alias: `KillShell`
- 输入参数兼容 `shell_id`

所以 `TaskStopTool` 不是全新 surface，而是 “background task stop” 对旧 shell-only kill surface 的升级兼容层。

## 15. 它还被刻意允许出现在简化工具池里，说明这是 coordinator/brief 模式保留的最小操作能力之一

源码镜像：[`../../sources/claude-code/src/tools.ts`](../../sources/claude-code/src/tools.ts)

`tools.ts` 里可以看到：

- 基础工具池注册 `TaskStopTool`
- simple/coordinator 路径也会保留它

这说明在 Claude Code 的产品分层里，“停止一个已经在后台跑的东西” 被认为是低上下文、高必要性的核心控制能力。

## 16. SDK control request 明确复用同一 helper，避免 CLI/SDK/LLM 三套 stop 语义分叉

源码镜像：[`../../sources/claude-code/src/cli/print.ts`](../../sources/claude-code/src/cli/print.ts)

`print.ts` 处理 `message.request.subtype === 'stop_task'` 时，直接复用：

- `await stopTask(taskId, { getAppState, setAppState })`

这让三类入口共享了同一条终止链：

- LLM `TaskStopTool`
- SDK `stop_task`
- task host `kill(...)`

Claude Code 在这里明显优先“共享 kill runtime”，而不是“每个入口各自封装一份停止逻辑”。

## 17. 它和 `TaskOutput` / task output 宿主是配对关系：stop 负责封账，结果读取走另一条链

源码镜像：[`../../sources/claude-code/src/tasks/LocalShellTask/LocalShellTask.tsx`](../../sources/claude-code/src/tasks/LocalShellTask/LocalShellTask.tsx)

`LocalShellTask` 注释里写得很直白：

- `TaskOutput owns the data — use its taskId so disk writes are consistent`

所以 `TaskStopTool` 不负责给你任务内容，它只负责：

- 定位 task
- 终止 task
- 做对通知与 SDK 书挡

后续“看输出”仍然是另一条 runtime。

## 18. 结论：`TaskStopTool` 真正统一的不是 kill implementation，而是 stop policy

这条链统一了几件事：

- 哪些入口可以发 stop
- stop 前要做哪些状态校验
- 如何分派到正确 task host
- 哪些宿主要 suppress transcript notification
- 哪些路径必须手动补 SDK bookend

而 kill 的底层动作仍然留给：

- shell host
- local agent host
- remote session host

所以 `TaskStopTool` 在 Claude Code 里不是 “一个停止命令”，而是后台任务体系的统一终止策略层。
