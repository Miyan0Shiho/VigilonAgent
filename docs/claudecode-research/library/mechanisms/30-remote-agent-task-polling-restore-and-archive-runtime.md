# Remote Agent Task Polling / Restore / Archive Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Remote SDK Message Adaptation / WebSocket / Permission Bridges`](./29-remote-sdk-message-adaptation-websocket-and-permission-bridges.md) | [`下一站：Remote Host Modes / History / Command Filtering`](./31-remote-host-modes-history-and-command-filtering.md)

本文拆的是远端后台任务真正的执行内核：`RemoteAgentTask.tsx + teleport/api.ts + teleport.tsx + sessionStorage.ts + task/framework.ts + task/diskOutput.ts`。它处理的不是“开一个 remote review 按钮”，而是 remote session 注册、sidecar 恢复、增量轮询、review/ultraplan 特判、通知入队、kill 后归档这整条后台生命周期。

## 1. `RemoteAgentTask` 不是一个任务类型名，而是 Claude Code 把 claude.ai session 收编进本地任务框架的适配层

源码镜像：[`../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx), [`../../sources/claude-code/src/utils/task/framework.ts`](../../sources/claude-code/src/utils/task/framework.ts)

remote session 原生只知道：

- session id
- events
- session status

本地任务框架却需要：

- task id
- task type/status/title/toolUseId
- notification 生命周期
- output file
- resume/restore 钩子

`RemoteAgentTask` 做的就是把这两套身份体系缝起来。

## 2. `registerRemoteAgentTask()` 不是简单 `registerTask()` 包装，而是一次“本地 task 壳 + 远端 session identity”双写

源码镜像：[`../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx), [`../../sources/claude-code/src/utils/task/framework.ts`](../../sources/claude-code/src/utils/task/framework.ts), [`../../sources/claude-code/src/utils/task/diskOutput.ts`](../../sources/claude-code/src/utils/task/diskOutput.ts)

注册远端任务时会同时发生三件事：

- `generateTaskId('remote_agent')` 生成本地 task identity
- `initTaskOutput(taskId)` 先创建输出文件
- `persistRemoteAgentMetadata(...)` 把远端 session 元数据写进 sidecar

这说明远端任务不是“纯云端对象”。Claude Code 会立刻在本地留下：

- UI 可见的 task 记录
- 可读的 task output path
- 可恢复的 remote-agent metadata

## 3. sidecar 持久化保存的是“如何找回任务”，不是“任务最终状态快照”

源码镜像：[`../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../sources/claude-code/src/utils/sessionStorage.ts), [`../../sources/claude-code/src/utils/sessionStorage.ts`](../../sources/claude-code/src/utils/sessionStorage.ts)

`persistRemoteAgentMetadata()` 存的核心字段是：

- `taskId`
- `remoteTaskType`
- `sessionId`
- `title`
- `command`
- `spawnedAt`
- `toolUseId`
- `isUltraplan / isRemoteReview / isLongRunning`

注释明确说明：状态不存，恢复时重新向 CCR 拉。也就是说 sidecar 的目标不是离线快照，而是：

- 让 `--resume` 知道还要去找哪些远端 session

## 4. `restoreRemoteAgentTasks()` 只在远端还活着时重建本地任务；404 和 archived 会被主动清 sidecar

源码镜像：[`../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../sources/claude-code/src/utils/sessionStorage.ts), [`../../sources/claude-code/src/utils/teleport/api.ts`](../../sources/claude-code/src/utils/teleport/api.ts)

恢复流程不是“看见 sidecar 就复活”：

- 先 `listRemoteAgentMetadata()`
- 再 `fetchSession(meta.sessionId)`
- 若 404：删 metadata
- 若 `session_status === 'archived'`：删 metadata
- 若是 401 或其他可恢复错误：保留 metadata，但这轮先跳过

这说明 Claude Code 的恢复策略很保守：只恢复仍有继续观察意义的远端任务。

## 5. `fetchSession()` 把 404 和 401 语义化成可分支错误，这就是 restore 层能做细判断的基础

源码镜像：[`../../sources/claude-code/src/utils/teleport/api.ts`](../../sources/claude-code/src/utils/teleport/api.ts)

`fetchSession()` 对远端状态读不是一把梭：

- 404 -> `Session not found: ${sessionId}`
- 401 -> `Session expired. Please run /login to sign in again.`
- 其他 4xx/5xx -> 通用错误

这让 `restoreRemoteAgentTasks()` 能区分：

- 任务真的死了
- 只是本地认证暂时失效

## 6. `startRemoteSessionPolling()` 是这套 runtime 的核心，不是普通 setInterval，而是状态机驱动的自调度循环

源码镜像：[`../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../sources/claude-code/src/utils/teleport/api.ts)

poller 的结构是：

- `isRunning` 软开关
- `lastEventId` 增量 cursor
- `accumulatedLog` 本地累积日志
- `cachedReviewContent` review 专用增量缓存
- 末尾 `setTimeout(poll, POLL_INTERVAL_MS)`

这意味着它不是纯 fixed timer，而是每轮完成后再决定下一轮是否继续。这样网络慢时不会把请求堆叠成并发风暴。

## 7. 远端事件轮询依赖 `after_id` 增量翻页，而不是每秒全量扫历史

源码镜像：[`../../sources/claude-code/src/utils/teleport/api.ts`](../../sources/claude-code/src/utils/teleport/api.ts)；相关实现入口：`packages/claude-code/src/utils/teleport.tsx`

`pollRemoteSessionEvents()` 的真实 contract 是：

- 输入 `afterId`
- 请求 `/v1/sessions/{id}/events?after_id=...`
- 需要时翻多页，但有 `MAX_EVENT_PAGES` 上限
- 返回 `newEvents + lastEventId + 可选 metadata`

所以本地 poller 是增量驱动的，不是每次把整条 session transcript 重拉一遍。

## 8. 它会主动过滤 `env_manager_log` 和 `control_response`，说明 remote task log 不等于原始 events feed

源码镜像：[`../../sources/claude-code/src/utils/teleport/api.ts`](../../sources/claude-code/src/utils/teleport/api.ts)；相关实现入口：`packages/claude-code/src/utils/teleport.tsx`

`pollRemoteSessionEvents()` 不是把服务端 events 原样塞给任务。它明确跳过：

- `env_manager_log`
- `control_response`

只把带 `session_id` 的消息当成 SDK log 片段累积。这说明 task log 在设计上就是“用户/agent 可解释事件”的裁剪视图。

## 9. output file 不是附属品，而是 task framework 对 remote task 的正式外显接口

源码镜像：[`../../sources/claude-code/src/utils/task/diskOutput.ts`](../../sources/claude-code/src/utils/task/diskOutput.ts), [`../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx)

每次 log 增长时，poller 会把 delta 文本 append 到 task output file。这样做的目的不是备份，而是让：

- detail dialog
- 通知消息里的 output path
- 其他 task framework 读口

都能统一沿用“任务输出文件”这套协议，而不必理解 remote session API。

## 10. `stable idle` 去抖是 remote task 里最关键的完成判定保护，不然每次 tool turn 间隙都会被误判结束

源码镜像：[`../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx)；相关实现入口：`packages/claude-code/src/utils/teleport.tsx`

远端 session 会在 tool turn 间短暂变成 `idle`。所以这里用了：

- `STABLE_IDLE_POLLS = 5`
- `response.sessionStatus === 'idle' && !logGrew && hasAnyOutput` 才累加

这套去抖不是优化，而是 correctness requirement。没有它，长链 remote review 会被中途 idle 误判成结束。

## 11. remote-review 不能靠普通 `result` 判定完成，因为 bughunter path 可能零 assistant turn，只靠 hook stdout 收尾

源码镜像：[`../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../sources/claude-code/src/utils/task/framework.ts)

remote-review 的完成条件被单独拆出来，是因为它有两条生产路径：

- bughunter mode：主要产物在 `hook_progress/hook_response stdout`
- prompt mode：主要产物在 assistant text

因此 poller 需要：

- `extractReviewTagFromLog(response.newEvents)` 做 delta 扫描
- `extractReviewFromLog(accumulatedLog)` 做全量兜底
- `reviewTimedOut` 做 30 分钟超时兜底

这也是为什么旧的统一任务框架逻辑不能直接覆盖它。

## 12. review 进度条不是从 task status 推出来的，而是从 hook stdout 里解析 `<remote-review-progress>` 标签

源码镜像：[`../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx)

`reviewProgress` 的来源很具体：

- 只看 `hook_progress / hook_response`
- 取最后一个 `<remote-review-progress>` 块
- 解析成 `stage / bugsFound / bugsVerified / bugsRefuted`

这说明远端 review 的 UI 进度并不是“前台猜测”，而是 orchestrator 用 hook echo 主动喂给本地的。

## 13. `isUltraplan` 和 `isLongRunning` 都会阻止普通 `result` 直接宣告任务结束

源码镜像：[`../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx)

这里有个很重要的分流：

- 普通远端任务：`result` 可作为完成信号
- `isUltraplan`：真正生命周期由独立 scanner 决定
- `isLongRunning`：会反复发 result，不能一看到就结束

所以 `RemoteAgentTask` 本质上已经内建了“不同 remote task family 完成语义不同”的模型。

## 14. task 完成时，本地先更新 AppState，再决定走哪种 notification path

源码镜像：[`../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../sources/claude-code/src/utils/messageQueueManager.ts), [`../../sources/claude-code/src/utils/task/framework.ts`](../../sources/claude-code/src/utils/task/framework.ts)

完成后并不是统一发一句消息：

- 普通 remote task -> `enqueueRemoteNotification()`
- remote-review success -> 直接把 review findings 注入 notification body
- remote-review failure -> 专用失败文案
- ultraplan failure -> 专用失败文案，避免让模型去读无意义 JSONL

这说明远端任务通知层不是 generic task framework 文案，而是按任务语义做的二次协议层。

## 15. `markTaskNotified()` 是原子门闩，防止 poll loop 和 stop/kill 路径重复发通知

源码镜像：[`../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../sources/claude-code/src/utils/task/framework.ts)

通知函数都会先过 `markTaskNotified()`。它的作用是：

- 原子翻转 `notified`
- 谁先翻成功，谁负责 enqueue

这对于 remote task 很关键，因为：

- poll 完成路径
- timeout 路径
- kill 路径

都可能竞争收尾。

## 16. kill 不是只改本地状态，还会补 `task_terminated` SDK bookend 并尝试 archive 远端 session

源码镜像：[`../../sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../sources/claude-code/src/utils/sdkEventQueue.ts)

`RemoteAgentTask.kill()` 做了三件正式收尾动作：

- 本地 task 状态改成 `killed`
- `emitTaskTerminatedSdk(...)` 补完 SDK 事件书挡
- `archiveRemoteSession(sessionId)` 尝试让远端停掉

这说明 kill 并不是“只是别再看这个任务”，而是明确尝试释放云端资源。

## 17. 归档用的是 best-effort `POST /archive`，因为它比 delete 更适合 mid-run 停止

源码镜像：[`../../sources/claude-code/src/utils/teleport/api.ts`](../../sources/claude-code/src/utils/teleport/api.ts)；相关实现入口：`packages/claude-code/src/utils/teleport.tsx`

`archiveRemoteSession()` 的注释已经把设计原因说透了：

- `POST /archive` 不要求任务先进入非 running
- 已 archived 的 409 也算成功
- 远端会在下一次 write 时拒绝新事件

所以 archive 在这里扮演的是“温和但可用的远端 stop lever”，而不是彻底删除对象。

## 18. 这套 runtime 真正提供的是“本地可恢复的远端后台任务壳”，不是单纯对 claude.ai 的轮询器

把这些文件放在一起看，实际形成的是一整套后台生命周期：

- `registerRemoteAgentTask()`：生成本地 task 壳与 sidecar 记录
- `restoreRemoteAgentTasks()`：按 live session status 恢复
- `pollRemoteSessionEvents()`：增量取流
- `startRemoteSessionPolling()`：做状态机、特判和通知
- `archiveRemoteSession()`：kill 后 best-effort 释放远端资源

所以 `RemoteAgentTask` 应该被理解成 Claude Code 的“remote job runtime adapter”，而不是一个只给 `/ultrareview` 用的小工具。

## 交叉参考

- 远端 viewer 适配链：[`./29-remote-sdk-message-adaptation-websocket-and-permission-bridges.md`](./29-remote-sdk-message-adaptation-websocket-and-permission-bridges.md)
- 远端 review / workflow 工作面：[`./14-remote-review-workflow-and-monitor-surfaces.md`](./14-remote-review-workflow-and-monitor-surfaces.md)
- 任务前台聚合面：[`../architecture/19-background-task-aggregation-and-list-runtime.md`](../architecture/19-background-task-aggregation-and-list-runtime.md)
- 任务状态显示面：[`../architecture/20-task-status-and-footer-surfaces.md`](../architecture/20-task-status-and-footer-surfaces.md)
