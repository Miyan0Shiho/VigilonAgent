# TodoWriteTool / Session Checklist / Verification Nudge Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：BriefTool / Activation / Visibility / Attachment Runtime`](./71-brief-tool-activation-visibility-and-attachment-runtime.md) | [`下一站：TaskCreate / TaskList / TaskGet / TaskUpdate Runtime`](./33-task-create-list-get-update-runtime.md)

本文把 `TodoWriteTool` 从旧的任务总述里单独拆出来。重点不是“它能写一个 todo list”，而是它如何作为 Claude Code 的 V1 session checklist runtime 挂进 transcript、resume、remote task 摘要、gentle reminder、以及 verifier 收尾约束链。

## 1. `TodoWriteTool` 不是任务系统的同义词，而是 `Task*Tool` 出现前的 session-scoped checklist runtime

源码镜像：[`../../src/tools/TodoWriteTool/TodoWriteTool.ts`](../../src/tools/TodoWriteTool/TodoWriteTool.ts), [`../../src/utils/tasks.ts`](../../src/utils/tasks.ts)

它的最关键 gate 是：

- `isEnabled() { return !isTodoV2Enabled() }`
- `isTodoV2Enabled()` 默认在 interactive session 为 `true`
- 只有非交互模式，或者显式没走 TodoV2 的宿主，`TodoWriteTool` 才是主任务面

所以 `TodoWriteTool` 不是“Task 工具的简化版 UI”，而是 Claude Code 在 V1/V2 双任务体系并存期保留的旧 checklist runtime。

## 2. 它的状态宿主不是文件任务板，而是 `AppState.todos[todoKey]`

源码镜像：[`../../src/tools/TodoWriteTool/TodoWriteTool.ts`](../../src/tools/TodoWriteTool/TodoWriteTool.ts)

真正的写入目标是：

- `const todoKey = context.agentId ?? getSessionId()`
- `appState.todos[todoKey]`

这说明它的隔离域天然是：

- 主会话：按 `sessionId`
- 子 agent：按 `agentId`

也就是说，`TodoWriteTool` 从一开始就是 per-session / per-agent 的内存态 checklist，不依赖 file-backed task namespace。

## 3. `shouldDefer: true` 说明它被当成按需发现的工作流工具，而不是永远裸露的小部件

源码镜像：[`../../src/tools/TodoWriteTool/TodoWriteTool.ts`](../../src/tools/TodoWriteTool/TodoWriteTool.ts)

这点和 `Task*Tool` 一样，表明产品并不想让模型每轮都默认看到一个 checklist writer，而是把它视为“复杂任务时再暴露”的 higher-level control surface。

## 4. prompt 真正在教模型维护一套严格的一阶任务语法，而不是自由文本列表

源码镜像：[`../../src/tools/TodoWriteTool/prompt.ts`](../../src/tools/TodoWriteTool/prompt.ts)

prompt 里约束非常重：

- 复杂多步任务要主动建表
- 新指令进来后要立刻 capture 成 todos
- 开始工作前要先把某一项置成 `in_progress`
- 完成后要立即标 `completed`
- 恰好一项 `in_progress`
- 每项都要同时提供：
  - `content`: imperative
  - `activeForm`: present continuous

所以它不是“备忘录工具”，而是一套结构化任务语法训练器。

## 5. `activeForm` 出现在 `TodoWriteTool` prompt 里，说明 spinner 叙事回灌链最早就是从 TodoWrite 开始的

源码镜像：[`../../src/tools/TodoWriteTool/prompt.ts`](../../src/tools/TodoWriteTool/prompt.ts), [`../../src/utils/todo/types.ts`](../../src/utils/todo/types.ts)

`activeForm` 的约束并不是后来 `TaskCreate/TaskUpdate` 才引入的。`TodoWriteTool` 已经把：

- imperative `content`
- progressive `activeForm`

作为强 schema 写死了。也就是说，后来的 `Task*Tool` 任务语言，其实是在继承 TodoWrite 时期已经成型的“主任务语言反哺 spinner 文案”协议。

## 6. `allDone -> []` 揭示了 V1 checklist 的终态不是“全勾完”，而是“直接清空状态宿主”

源码镜像：[`../../src/tools/TodoWriteTool/TodoWriteTool.ts`](../../src/tools/TodoWriteTool/TodoWriteTool.ts)

关键逻辑：

- `const allDone = todos.every(_ => _.status === 'completed')`
- `const newTodos = allDone ? [] : todos`

这意味着 TodoWrite 不保留 completed archive。所有项一旦都结束，运行时语义就是：

- 当前会话 checklist 已经结束
- 前台状态宿主应恢复为空

所以它更像“当前工作清单”，而不是长期任务记录。

## 7. `newTodos` 写进 AppState，但 tool result 返回的却是原始 `todos`，说明“闭环完成”与“工具回执”被故意分离

源码镜像：[`../../src/tools/TodoWriteTool/TodoWriteTool.ts`](../../src/tools/TodoWriteTool/TodoWriteTool.ts)

返回体里：

- `oldTodos`
- `newTodos: todos`

而不是实际写入的 `newTodos`

这暴露了一个细节：tool result 想让模型看到“我这次提交了什么 checklist 结构”，哪怕运行时真正存储时已经因为 `allDone` 被清成空数组。换句话说，工具回执服务于模型 continuation，宿主状态服务于前台 runtime。

## 8. verifier nudge 不是通用 tips，而是精确绑在“最后一项刚关掉”的 loop-exit 时刻

源码镜像：[`../../src/tools/TodoWriteTool/TodoWriteTool.ts`](../../src/tools/TodoWriteTool/TodoWriteTool.ts)

触发条件非常具体：

- `feature('VERIFICATION_AGENT')`
- `growthbook('tengu_hive_evidence')`
- `!context.agentId`，只限主线程
- `allDone`
- `todos.length >= 3`
- `!todos.some(t => /verif/i.test(t.content))`

这说明 verifier nudge 不是“任务多了就提醒一下”，而是故意卡在最容易偷跳 final summary 的那个收尾瞬间。

## 9. 这条 verifier nudge 是通过 `tool_result` 直接回灌给模型的，而不是前台弹窗

源码镜像：[`../../src/tools/TodoWriteTool/TodoWriteTool.ts`](../../src/tools/TodoWriteTool/TodoWriteTool.ts), [`../../src/tools/AgentTool/constants.ts`](../../src/tools/AgentTool/constants.ts)

`mapToolResultToToolResultBlockParam(...)` 会把提醒直接拼进 tool result：

- 先给出通用成功语义
- 再追加 “spawn the verification agent”
- 明确禁止靠 self-summary 发 `PARTIAL`

这说明 Claude Code 把 verifier discipline 编进了任务闭环协议，而不是交给 prompt 自觉。

## 10. `renderToolUseMessage() => null` 说明 TodoWrite 不想在 transcript 上占普通工具调用位

源码镜像：[`../../src/tools/TodoWriteTool/TodoWriteTool.ts`](../../src/Tool.ts)

它和 `BriefTool` 一样，显式把普通 tool-use transcript chrome 关掉了。原因很直白：

- 它的主要消费面不是“用户逐条看这个工具怎么执行”
- 而是 checklist state、reminder attachment、remote task todo summary

所以 TodoWrite 的前台存在感更多来自状态投影，而不是单次 tool bubble。

## 11. transcript 仍然保留真实 `tool_use`，因为 resume 要靠它反向恢复 checklist

源码镜像：[`../../src/utils/sessionRestore.ts`](../../src/utils/sessionRestore.ts)

`restoreSessionStateFromLog()` 在 `!isTodoV2Enabled()` 时会：

1. 从历史消息倒着找最后一个 `TodoWrite` `tool_use`
2. 解析其中的 `todos`
3. 回填到 `AppState.todos[getSessionId()]`

也就是说，虽然前台不渲染普通 tool bubble，但 transcript 仍然是 TodoWrite 的 durable source of truth。

## 12. 这条 transcript-restore 只在 V1 宿主启用，说明 TodoWrite 的持久化策略是“日志回放”，不是独立存储

源码镜像：[`../../src/utils/sessionRestore.ts`](../../src/utils/tasks.ts)

代码注释已经说得很直接：

- interactive mode 用 file-backed V2 tasks
- SDK / non-interactive 仍靠 TodoWrite transcript 恢复

所以 TodoWrite 的 durability model 是：

- 不另存文件
- 只依赖 transcript 里最后一次合法 `tool_use`

## 13. `RemoteAgentTask` 也会反扫 TodoWrite transcript，说明它还是远端任务摘要的兼容来源

源码镜像：[`../../src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`](../../src/tasks/RemoteAgentTask/RemoteAgentTask.tsx)

`extractTodoListFromLog(log)` 做的事情和 resume 几乎同构：

- 找最后一个 assistant message 里的 `TodoWrite`
- 用 `TodoWriteTool.inputSchema` 反解析
- 产出 `todoList`

这说明 remote task 详情页仍然把 TodoWrite 当成一种可消费的任务摘要协议，而不要求所有远端任务都必须升级到 TodoV2。

## 14. gentle reminder 也分 V1/V2 两条链，TodoWrite 拥有自己的 reminder attachment 协议

源码镜像：[`../../src/utils/messages.ts`](../../src/utils/attachments.ts)

`messages.ts` 里专门有：

- `todo_reminder`
- `task_reminder`

并且 `task_reminder` 明确受 `isTodoV2Enabled()` gate 控制。说明产品没有把 TodoWrite reminder 混进新任务体系，而是长期保留了两套提醒协议。

## 15. TodoWrite 的 reminder 不是强制指令，而是一个 system reminder sidecar

源码镜像：[`../../src/utils/messages.ts`](../../src/utils/messages.ts)

它会构造一条 meta user message，核心语义是：

- 你最近没用 TodoWrite
- 如果当前工作适合追踪，就考虑用
- 如果列表已经 stale，就清理
- 不要把这条提醒告诉用户

这说明 TodoWrite 的日常激活更多靠轻量 sidecar nudging，而不是强制工具 policy。

## 16. `searchHint: manage the session task checklist` 说明它的产品定位从来就是“会话清单”，不是工程级任务板

源码镜像：[`../../src/tools/TodoWriteTool/TodoWriteTool.ts`](../../src/tools/TodoWriteTool/TodoWriteTool.ts)

它和 `Task*Tool` 的差异可以压成一句话：

- `TodoWrite`: session checklist
- `Task*Tool`: file-backed shared task board

这个边界也解释了为什么两套系统会长期共存。

## 17. `TodoWriteTool` 与 `Task*Tool` 的关系不是替换完成，而是双轨兼容

源码镜像：[`../../src/tools.ts`](../../src/utils/tasks.ts), [`../../src/utils/sessionRestore.ts`](../../src/tasks/RemoteAgentTask/RemoteAgentTask.tsx)

现在真实状态是：

- interactive mode 默认走 TodoV2
- non-interactive / 某些 remote transcript 消费面仍读 TodoWrite
- reminder、resume、remote task summary 都保留了 V1 分支

所以 `TodoWriteTool` 不该被理解成“历史遗留还没删”，而是 Claude Code 任务迁移期仍在承担兼容层职责的正式 runtime。

## 18. 结论：TodoWrite 是 Claude Code 旧任务体系的 transcript-backed control plane

把整条链收起来，TodoWrite 的真实角色是：

- 用严格 schema 训练模型维护会话级 checklist
- 用 `AppState.todos` 提供轻量前台状态宿主
- 用 transcript `tool_use` 充当 durable source of truth
- 用 reminder attachment 持续 nudging
- 用 verifier nudge 把“别跳过验证”钉在 loop exit
- 用 remote/session restore sidechain 继续服务旧宿主

因此它不是一个小型 todo helper，而是一套仍然活跃的 V1 task-control runtime。
