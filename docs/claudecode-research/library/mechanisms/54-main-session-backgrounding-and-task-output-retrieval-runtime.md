# Main Session Backgrounding / Task Output Retrieval Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：LocalAgentTask / Retention / Panel / Notification Runtime`](./53-local-agent-task-retention-panel-and-notification-runtime.md) | [`下一站：Plugin Dependency / Marketplace Refresh / Active Runtime`](./45-plugin-dependency-marketplace-refresh-and-active-runtime.md)

前一卷把 `LocalAgentTask` 这类本地 agent host 拆开了，但 Claude Code 还有一条很容易被忽略的 sibling 运行时：主会话本身也能被后台化，而且它复用了同一套 `local_agent` 结构。与此同时，`TaskOutputTool` 又提供了把这些后台任务结果重新喂回模型的旧式回读协议。

这一卷专门拆两条链：

- `tasks/LocalMainSessionTask.ts`
- `tools/TaskOutputTool/TaskOutputTool.tsx`
- `utils/task/outputFormatting.ts`
- `utils/task/diskOutput.ts`

它回答的是两个问题：

- 用户把当前主会话后台化后，Claude Code 到底创造了什么运行时对象？
- 模型后来再去读这个后台任务输出时，读到的是 transcript、最终答案，还是裁剪后的 tail？

## 1. 背景化主会话不是 shell trick，而是把主线程 query 变成 `local_agent(agentType='main-session')`

源码镜像：[`../../src/tasks/LocalMainSessionTask.ts`](../../src/tasks/LocalMainSessionTask.ts)

`LocalMainSessionTaskState` 没有发明新的 task shape，而是直接复用：

- `LocalAgentTaskState`

唯一额外约束是：

- `agentType: 'main-session'`

这说明 Claude Code 不把“后台主会话”当成独立任务种类，而是明确把它视为 local agent 家族里的一个特殊分支。也因此它天然继承：

- task output file
- transcript sidechain
- progress/messages/result 宿主字段
- notified / abort / cleanup 协议

## 2. `main-session` 是 `local_agent` 家族里的例外成员：共享 host，但刻意不进 panel

源码镜像：[`../../src/tasks/LocalAgentTask/LocalAgentTask.tsx`](../../src/tasks/LocalAgentTask/LocalAgentTask.tsx), [`../../src/tasks/LocalMainSessionTask.ts`](../../src/tasks/LocalMainSessionTask.ts)

上一卷已经确认：

- `isPanelAgentTask()` 只接受 `agentType !== 'main-session'`

而这一卷看到：

- `LocalMainSessionTask` 明确把后台主会话写成 `agentType='main-session'`

所以 Claude Code 的真实产品分层是：

- 子代理：`local_agent`，且可进入 coordinator panel
- 主会话后台副本：也是 `local_agent`，但被 panel gate 排除

也就是说主会话背景化和子代理运行时高度同构，但前台操作面被故意切开了。

## 3. 背景化主会话用 `s` 前缀 task ID，说明它和普通 agent sidechain transcript 共享协议但保留独立身份空间

源码镜像：[`../../src/tasks/LocalMainSessionTask.ts`](../../src/tasks/LocalMainSessionTask.ts)

`generateMainSessionTaskId()` 生成：

- `sxxxxxxxx`

而普通 agent 走的是 `a...` 体系。注释直接点明：

- `s` prefix 专门用于 main session task

这说明 Claude Code 虽然复用了 `LocalAgentTaskState`，但没有把主会话后台副本和普通 agent sidechain 混进一个不透明 ID 空间。

## 4. 后台主会话的输出文件不是主 transcript，而是隔离 sidechain transcript

源码镜像：[`../../src/tasks/LocalMainSessionTask.ts`](../../src/tasks/LocalMainSessionTask.ts)

`registerMainSessionTask()` 在注册时会：

- `initTaskOutputAsSymlink(taskId, getAgentTranscriptPath(asAgentId(taskId)))`

注释强调得很重：

- 绝不能直接用 `getTranscriptPath()`
- 否则 `/clear` 后会污染新的主会话 transcript

所以“后台主会话”虽然逻辑上来自主线程，但一旦后台化，就必须切到隔离 transcript 文件。这让它能：

- 跨 `/clear` 存活
- 继续被 `TaskOutput` 或通知系统引用
- 不反向破坏新会话的 transcript 真相源

## 5. `startBackgroundSession()` 会先把“后台化之前的上下文”整包写进 sidechain，再开始增量 query

源码镜像：[`../../src/tasks/LocalMainSessionTask.ts`](../../src/tasks/LocalMainSessionTask.ts)

后台主会话启动顺序是：

1. `registerMainSessionTask(...)`
2. `recordSidechainTranscript(messages, taskId)`
3. 再 `query({ messages, ...queryParams })`

这说明后台主会话不是只记“从后台化那一刻开始的新消息”，而是先把 pre-background conversation 作为初始 transcript seed 写进去。结果是：

- `TaskOutput` 立刻就能读到上下文
- 后续增量消息继续 append
- 从磁盘视角看，这是一条完整 sidechain session，而不是孤立尾巴

## 6. 后台主会话也跑在独立 agent context 里，这样 skill/memory/cleanup 都能按 taskId 隔离

源码镜像：[`../../src/tasks/LocalMainSessionTask.ts`](../../src/tasks/LocalMainSessionTask.ts)

`startBackgroundSession()` 会用：

- `runWithAgentContext(...)`

并显式设置：

- `agentId = taskId`
- `agentType = 'subagent'`
- `subagentName = 'main-session'`
- `isBuiltIn = true`

注释解释了真正目的：

- skill invocation 要 scope 到这个 task 的 agentId
- `/clear` 才能按 preservedAgentIds 有选择地保留它的技能状态

所以后台主会话虽然是“主线程的分叉”，在运行时隔离上却更像一个 built-in subagent。

## 7. `foregroundedTaskId` 说明后台主会话有自己的一套“重新前台化”协议，不走 teammate retain/view 体系

源码镜像：[`../../src/tasks/LocalMainSessionTask.ts`](../../src/tasks/LocalMainSessionTask.ts), [`../architecture/19-background-task-aggregation-and-list-runtime.md`](../architecture/19-background-task-aggregation-and-list-runtime.md)

`foregroundMainSessionTask()` 做的不是 `retain/viewingAgentTaskId`，而是：

- `foregroundedTaskId = taskId`
- 当前任务 `isBackgrounded = false`
- 之前 foregrounded 的旧任务恢复 `isBackgrounded = true`

这说明后台主会话的“回到前台”语义，不属于上一卷那套 teammate transcript host，而是另一条 main-session-specific steering 协议：

- 它是 query continuation 的前台宿主切换
- 不是 local agent viewed transcript 的 retain/release 模型

## 8. 主会话后台任务完成时会裁成“只保留最后一条消息”，说明它的 messages 宿主目标是摘要式回看，不是完整 sidechain 常驻

源码镜像：[`../../src/tasks/LocalMainSessionTask.ts`](../../src/tasks/LocalMainSessionTask.ts)

`completeMainSessionTask()` 在成功/失败时会把：

- `messages: task.messages?.length ? [task.messages.at(-1)!] : undefined`

也就是只保留最后一条消息。

这和 `LocalAgentTask` viewed retain host 很不一样。这里说明后台主会话在常驻内存层的设计目标是：

- 让前台能知道最终结果
- 避免整条 sidechain transcript 长期占住内存

完整 transcript 仍然在 task output file 里，不靠 `messages` 常驻。

## 9. 后台主会话通知也走 XML task-notification，但只有“仍在后台”时才发

源码镜像：[`../../src/tasks/LocalMainSessionTask.ts`](../../src/tasks/LocalMainSessionTask.ts)

`completeMainSessionTask()` 会先看：

- `wasBackgrounded`

如果任务还在后台：

- 发 XML task-notification

如果已经被 foreground：

- 不发 TUI XML 通知
- 但仍然 `emitTaskTerminatedSdk(...)`
- 并补 `notified: true`

这说明后台主会话的通知协议分成两面：

- TUI 用户已经在看，就不再用 transcript 通知打扰
- SDK consumer 仍然要看到 bookend close

## 10. `TaskOutputTool` 虽然标记 deprecated，但仍然是后台任务向模型暴露输出的兼容协议

源码镜像：[`../../src/tools/TaskOutputTool/TaskOutputTool.tsx`](../../src/tools/TaskOutputTool/TaskOutputTool.tsx)

它的 prompt 和 description 都明确写着：

- 优先建议直接 `Read` 输出文件
- 这是 deprecated tool

但实现上它仍然完整支持：

- `local_bash`
- `local_agent`
- `remote_agent`

并且有：

- `block=true/false`
- wait with timeout
- progress event
- tool_result XML-like block serialization

所以它不是“死工具”，而是被降级为兼容桥。

## 11. `TaskOutputTool` 对 agent task 不返回原始 JSONL transcript，而优先返回 clean final answer

源码镜像：[`../../src/tools/TaskOutputTool/TaskOutputTool.tsx`](../../src/tools/TaskOutputTool/TaskOutputTool.tsx)

对 `local_agent`，它明确优先：

- 从 `agentTask.result.content` 提取 clean final answer

只有没有 in-memory result 时，才退回磁盘 output。

注释解释得很清楚：

- task output file 是完整 session transcript
- 不是只包含 subagent 最终回答

因此 `TaskOutputTool` 的真实作用不是“把文件原样读回来”，而是把 task host 的结构化终态重新投影成更干净的模型输入。

## 12. `TaskOutputTool` 的 wait 协议是 polling，不是订阅；因此它只保证 eventually-read，不保证流式 tail

源码镜像：[`../../src/tools/TaskOutputTool/TaskOutputTool.tsx`](../../src/tools/TaskOutputTool/TaskOutputTool.tsx)

`waitForTaskCompletion()` 做的是：

- 100ms poll
- 看 `status !== running/pending`
- 超时就返回当前状态

所以它不是一个 stream 订阅器，而是：

- 非流式 completion waiter
- 以最终任务态为界决定成功/timeout/not_ready

这和 `getTaskOutputDelta()` 那条更适合增量 tail 的磁盘协议不是一回事。

## 13. 输出格式化协议故意只保留尾部，并把完整文件路径塞进 header

源码镜像：[`../../src/utils/task/outputFormatting.ts`](../../src/utils/task/outputFormatting.ts)

`formatTaskOutput()` 的规则非常明确：

- 超过 `TASK_MAX_OUTPUT_LENGTH` 就截断
- 不是保留开头，而是保留最后 N 个字符
- 前面加：
  - `[Truncated. Full output: <path>]`

这说明后台任务输出在模型消费面优先保留：

- 最近上下文
- 并显式告诉模型去哪里用 `Read` 看全量

不是把大日志一股脑塞进 tool result。

## 14. `diskOutput.getTaskOutput()` 也是 tail 语义，不是 full-file 语义

源码镜像：[`../../src/utils/task/diskOutput.ts`](../../src/utils/task/diskOutput.ts)

`getTaskOutput()` 用的是：

- `tailFile(...)`

如果文件太大，会返回：

- `[xxxKB of earlier output omitted]`
- 再跟当前尾部内容

所以磁盘读取层本身就不是“完整日志读取”，而是默认 tail-oriented。这和 `TaskOutputTool` 的 tail+truncate 设计是一致的。

## 15. `TaskOutputResultDisplay` 说明前台对 agent/bsh/remote task 的读取结果刻意做了类型分化

源码镜像：[`../../src/tools/TaskOutputTool/TaskOutputTool.tsx`](../../src/tools/TaskOutputTool/TaskOutputTool.tsx)

前台渲染分三路：

- `local_bash`
  - 走 `BashToolResultMessage`
- `local_agent`
  - verbose 时用 `AgentPromptDisplay + AgentResponseDisplay`
  - 非 verbose 时只显示 “Read output (ctrl+o to expand)”
- `remote_agent`
  - 显示简化状态文本

这意味着 `TaskOutputTool` 在 UI 层并不是统一 dump string，而是把 task family 的原生阅读方式部分复用了回来。

## 16. 这条链真正补上的，是“主线程后台化”和“模型侧结果回读”之间的闭环

如果把现有几篇文档连起来看，这块现在可以更清楚地分成：

- `mechanisms/53`
  - local subagent host、retain/panel/notification
- `mechanisms/54`
  - main-session backgrounding、foreground switching、TaskOutput compatibility retrieval

也就是说 Claude Code 的后台任务不是一个单一概念：

- 子代理更偏 transcript host 和 panel operator surface
- 主会话后台副本更偏 detached query host
- `TaskOutputTool` 再把这两类 host 的结果压缩回模型可消费的兼容 surface

这就是“后台执行”在 Claude Code 里从运行时分叉，到结果重新回灌模型的完整闭环。
