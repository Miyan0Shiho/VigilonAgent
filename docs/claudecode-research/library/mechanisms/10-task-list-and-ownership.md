# TaskList、TaskUpdate 与任务所有权协议

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Plugin Runtime / Marketplace`](./09-plugin-runtime-and-marketplace.md) | [`下一站：Skills Runtime`](./11-skills-runtime-and-loading.md)

本文把 `TaskListTool`、`TaskGetTool`、`TaskUpdateTool`、`useTaskListWatcher`、`utils/tasks.ts` 拆成一卷，说明 Claude Code 的任务体系并不是提示词约定，而是一套真实的文件存储、锁、认领和自动拾取协议。

## 1. `TaskListTool` 只是入口，真正的状态在 `utils/tasks.ts`

源码镜像：[`../../src/tools/TaskListTool/TaskListTool.ts`](../../src/tools/TaskListTool/TaskListTool.ts), [`../../src/utils/tasks.ts`](../../src/utils/tasks.ts)

`TaskListTool.call()` 自己做的事情很少：

- 先通过 `getTaskListId()` 决定当前任务列表命名空间
- 调 `listTasks(taskListId)`
- 过滤 `_internal` metadata
- 把已完成任务从 `blockedBy` 中剔除后再返回

这说明工具层只是“把任务文件系统翻译成模型可读列表”，真正的任务真相并不在 tool 本身。

## 2. `getTaskListId()` 决定谁在共享同一套任务

源码镜像：[`../../src/utils/tasks.ts`](../../src/utils/tasks.ts)

这个函数的优先级很重要：

- `CLAUDE_CODE_TASK_LIST_ID`
- teammate context 的 `teamName`
- `getTeamName()`
- leader 设置的 `leaderTeamName`
- 最后才退回 session ID

所以“任务列表”不是固定绑在某个会话上，而是会随着 swarm / team / env 映射到共享命名空间。

## 3. 任务存储就是文件系统协议

`utils/tasks.ts` 明确采用文件作为存储单元：

- 每个 task 是一个 `TaskSchema`
- 任务目录在 `~/.claude/tasks/<sanitized taskListId>/`
- task 文件名是 `<taskId>.json`
- 另有 `.highwatermark` 与 `.lock`

这意味着任务系统从一开始就是可并发访问、可被外部进程观察的文件协议，而不是内存里的轻量数据结构。

## 4. 高水位与锁机制说明它默认面向并发 swarm

源码镜像：[`../../src/utils/tasks.ts`](../../src/utils/tasks.ts)

这里至少有三层并发设计：

- `createTask()` 在锁内读取最高 ID 再分配新 ID
- `resetTaskList()` 会把当前最高 ID 写到 `.highwatermark`，避免重置后复用旧 ID
- `LOCK_OPTIONS` 为 10+ 并发 swarm 预设了重试预算

因此任务编号与状态更新并不是“单机无竞争”假设，而是为多 agent 并发写入设计的。

## 5. `TaskGetTool` 与 `TaskUpdateTool` 分别扮演读路径和写路径

源码镜像：[`../../src/tools/TaskGetTool/TaskGetTool.ts`](../../src/tools/TaskGetTool/TaskGetTool.ts), [`../../src/tools/TaskUpdateTool/TaskUpdateTool.ts`](../../src/tools/TaskUpdateTool/TaskUpdateTool.ts)

`TaskGetTool` 的职责很纯：

- 按 `taskId` 取回单个任务
- 展开 description、blocks、blockedBy
- 把 task 渲染成适合模型读的文本块

`TaskUpdateTool` 则是任务系统真正复杂的写入口：

- 支持改 `subject / description / activeForm / status / owner / metadata`
- `status = deleted` 时走删除路径
- 完成任务时会触发 `executeTaskCompletedHooks()`
- teammate / swarm 模式下会自动补 owner 或写 mailbox 通知
- 一旦更新任务，会强制展开 `expandedView = tasks`

所以 `TaskUpdateTool` 的真实语义不是“改字段”，而是推进任务生命周期。

## 6. `claimTask()` 暴露了所有权协议

源码镜像：[`../../src/utils/tasks.ts`](../../src/utils/tasks.ts)

任务认领时至少会判断：

- task 是否存在
- 是否已被其他 agent 认领
- 是否已经 resolved
- 是否仍被未完成 blocker 卡住
- 在 `checkAgentBusy` 模式下，认领者是否已经有别的未完成任务

对应的失败原因也是结构化的：

- `task_not_found`
- `already_claimed`
- `already_resolved`
- `blocked`
- `agent_busy`

这说明所有权不是模型口头约定，而是任务系统的硬协议。

## 7. `useTaskListWatcher` 让“任务模式”变成自动拾取器

源码镜像：[`../../src/hooks/useTaskListWatcher.ts`](../../src/hooks/useTaskListWatcher.ts)

这个 hook 做的不是简单文件监听，而是一个最小调度器：

- `fs.watch()` 监听任务目录
- 用 debounce 合并频繁事件
- 当前会话空闲时，找 `pending + no owner + not blocked` 的任务
- 调 `claimTask()` 先抢占，再把任务格式化成 prompt 提交
- 如果提交失败，再释放 owner

因此 tasks mode 的核心不是“有人写了文件我就看见”，而是“文件变化 -> 自动认领 -> prompt 注入”的闭环。

## 8. 为什么这一卷必须独立

如果只看 UI，很容易把任务体系理解成一个背景面板；如果只看 tool 名称，又会以为只是 Todo 类工具。真实结构其实是：

- tool 层负责把任务暴露给模型
- `utils/tasks.ts` 负责文件协议、锁、高水位和所有权
- `useTaskListWatcher` 负责把目录变化转成自动执行

这已经是一套小型任务调度系统，而不是单个工具族。
