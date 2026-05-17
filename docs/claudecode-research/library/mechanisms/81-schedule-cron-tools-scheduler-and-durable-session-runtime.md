# ScheduleCron Tools / Scheduler / Durable-Session Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：LSPTool / Initialization / Deferred Loading / Diagnostic Attachment Runtime`](./80-lsp-tool-initialization-deferred-loading-and-diagnostic-attachment-runtime.md) | [`下一站：SleepTool / Proactive Tick / Interruptible Wait Runtime`](./82-sleep-tool-proactive-tick-and-interruptible-wait-runtime.md)

本文把 `CronCreateTool`、`CronDeleteTool`、`CronListTool` 和它们背后的 scheduler/runtime 单独拆出来。重点不是“Claude Code 支持定时任务”，而是它怎样把一套看似简单的 cron 能力收束成：

- tool-layer intent contract
- session-only vs durable dual store
- scheduler lease lock
- idle-only fire policy
- teammate-aware routing
- missed-task catch-up
- jitter and recurring auto-expiry

这条链本质上是“把 REPL 内的未来触发 prompt 做成一套可持久化、可多会话去重、可 team-route 的后台执行 runtime”，而不是普通提醒器。

## 1. 三把工具只是 operator surface，真正的执行宿主在 scheduler 和 storage 层

源码镜像：[`../../sources/claude-code/src/tools/ScheduleCronTool/CronCreateTool.ts`](../../sources/claude-code/src/tools/ScheduleCronTool/CronCreateTool.ts), [`../../sources/claude-code/src/tools/ScheduleCronTool/CronDeleteTool.ts`](../../sources/claude-code/src/tools/ScheduleCronTool/CronDeleteTool.ts), [`../../sources/claude-code/src/tools/ScheduleCronTool/CronListTool.ts`](../../sources/claude-code/src/tools/ScheduleCronTool/CronListTool.ts), [`../../sources/claude-code/src/utils/cronScheduler.ts`](../../sources/claude-code/src/utils/cronScheduler.ts), [`../../sources/claude-code/src/utils/cronTasks.ts`](../../sources/claude-code/src/utils/cronTasks.ts)

`CronCreate/CronDelete/CronList` 做的主要是：

- validate 用户意图
- 把可见 contract 编进 prompt/schema
- 调 storage helper
- 必要时翻起 scheduler

真正的运行时主链在：

- `cronTasks.ts`
- `cronScheduler.ts`
- `useScheduledTasks.ts`
- `cronTasksLock.ts`

所以 cron 在 Claude Code 里不是“工具 body 自己 setTimeout”，而是一套独立后台子系统。

## 2. 整套能力先过一层总 gate：`isKairosCronEnabled()`

源码镜像：[`../../sources/claude-code/src/tools/ScheduleCronTool/prompt.ts`](../../sources/claude-code/src/tools/ScheduleCronTool/prompt.ts)

所有 cron tools 的 `isEnabled()` 都走：

- `feature('AGENT_TRIGGERS')`
- GrowthBook `tengu_kairos_cron`
- 本地 env killswitch `CLAUDE_CODE_DISABLE_CRON`

这说明 cron 不是纯本地功能，而是一个可被 fleet-wide 关停的后台执行面。更关键的是，`useScheduledTasks` 还会在每个 tick 上再 poll `isKilled`，所以关掉 gate 不只是“新建不了”，而是已经运行的 scheduler 也会停火。

## 3. durable 还有一层更窄的 gate，和 cron 总开关故意分开

源码镜像：[`../../sources/claude-code/src/tools/ScheduleCronTool/prompt.ts`](../../sources/claude-code/src/tools/ScheduleCronTool/prompt.ts), [`../../sources/claude-code/src/tools/ScheduleCronTool/CronCreateTool.ts`](../../sources/claude-code/src/tools/ScheduleCronTool/CronCreateTool.ts)

`durable` 走的是：

- `isDurableCronEnabled()`

而不是复用 `isKairosCronEnabled()`。

`CronCreateTool.call()` 会把：

- `durable && isDurableCronEnabled()`

算成 `effectiveDurable`。也就是说，当 durable gate mid-session 关闭时：

- 工具 schema 不变
- 模型不会因为传了 `durable: true` 直接报错
- 只是实际被强制降成 session-only

这是一种非常刻意的“功能降级而不是工具失效”策略。

## 4. `CronCreate` 的 validate 不只是校验 cron 字符串，还在防 orphaned teammate durability

源码镜像：[`../../sources/claude-code/src/tools/ScheduleCronTool/CronCreateTool.ts`](../../sources/claude-code/src/tools/ScheduleCronTool/CronCreateTool.ts)

它会校验：

- `parseCronExpression(...)` 必须成功
- `nextCronRunMs(...)` 在未来一年内必须有匹配
- 当前总 job 数不能超过 `MAX_JOBS = 50`
- teammate 不能创建 durable cron

最后这条尤其关键：teammate 是 session-local host，不会跨重启存在，所以 durable teammate cron 会在磁盘里留下一个 `agentId` 指向不存在 agent 的 orphan。Claude Code 在工具入口就把这条路封死了。

## 5. `CronCreate` 真正落地时并不直接碰文件，而是先走统一 `addCronTask(...)`

源码镜像：[`../../sources/claude-code/src/tools/ScheduleCronTool/CronCreateTool.ts`](../../sources/claude-code/src/utils/cronTasks.ts), [`../../sources/claude-code/src/utils/cronTasks.ts`](../../sources/claude-code/src/utils/cronTasks.ts)

`addCronTask(...)` 根据 `durable` 分成两路：

- `durable: false`
  - `addSessionCronTask(...)`
  - 只进 bootstrap state
- `durable: true`
  - `readCronTasks() -> push -> writeCronTasks()`
  - 落盘到 `.claude/scheduled_tasks.json`

所以创建 cron 的真分界不是 REPL vs daemon，而是：

- 进内存 session store
- 还是进项目磁盘 store

## 6. session-only cron 不是临时 hack，它在 bootstrap state 里有正式宿主

源码镜像：[`../../sources/claude-code/src/bootstrap/state.ts`](../../sources/claude-code/src/bootstrap/state.ts)

bootstrap state 里明确保留了两块 cron 状态：

- `scheduledTasksEnabled`
- `sessionCronTasks`

其中 `SessionCronTask` 的字段就是：

- `id`
- `cron`
- `prompt`
- `createdAt`
- `recurring?`
- `agentId?`

这说明 session-only cron 在 Claude Code 里不是“create 后顺手塞个数组”，而是 REPL 全局状态的一等成员。

## 7. durable cron 的磁盘真相源非常明确：`<project>/.claude/scheduled_tasks.json`

源码镜像：[`../../sources/claude-code/src/utils/cronTasks.ts`](../../sources/claude-code/src/utils/cronTasks.ts)

`getCronFilePath()` 固定返回：

- `<projectRoot>/.claude/scheduled_tasks.json`

磁盘任务字段包括：

- `id`
- `cron`
- `prompt`
- `createdAt`
- `lastFiredAt?`
- `recurring?`
- `permanent?`

而 runtime-only 字段：

- `durable`
- `agentId`

会在写盘时被剥掉。也就是说，磁盘文件只承载 durable schedule truth，不承载本次进程的宿主细节。

## 8. `CronList` 其实就是这两套 store 的统一视图

源码镜像：[`../../sources/claude-code/src/tools/ScheduleCronTool/CronListTool.ts`](../../sources/claude-code/src/utils/cronTasks.ts)

`listAllCronTasks()` 会在 REPL 路径下合并：

- `readCronTasks()`
- `getSessionCronTasks()`

并把 session-only 项显式标成：

- `durable: false`

所以 `CronListTool` 展示的不是单一文件，而是 “disk-backed tasks + process-local tasks” 的联合 catalog。teammate 再在此基础上只过滤出自己的 `agentId`。

## 9. `CronDelete` 也故意走统一删除器，因为调用方并不知道 id 属于哪套 store

源码镜像：[`../../sources/claude-code/src/tools/ScheduleCronTool/CronDeleteTool.ts`](../../sources/claude-code/src/utils/cronTasks.ts)

`removeCronTasks(ids)` 的顺序是：

- 先扫 `sessionCronTasks`
- 如果全部命中，直接返回
- 否则再读磁盘文件并写回剩余项

所以 delete path 的核心目标不是“删文件行”，而是“无论这个 id 来自 session 还是 durable，都能用一个 operator action 干净消掉”。

## 10. scheduler 并不是默认常驻，它先看 `scheduledTasksEnabled`

源码镜像：[`../../sources/claude-code/src/utils/cronScheduler.ts`](../../sources/claude-code/src/bootstrap/state.ts), [`../../sources/claude-code/src/tools/ScheduleCronTool/CronCreateTool.ts`](../../sources/claude-code/src/tools/ScheduleCronTool/CronCreateTool.ts)

REPL path 下，`createCronScheduler().start()` 的逻辑是：

- 如果已有磁盘任务，自动 `setScheduledTasksEnabled(true)`
- assistant mode 也可直接 auto-enable
- 否则先 poll `getScheduledTasksEnabled()`

而 `CronCreateTool.call()` 会在创建成功后立刻：

- `setScheduledTasksEnabled(true)`

这说明 scheduler 的启动真开关不是文件 watcher 本身，而是 bootstrap 里的 session flag。

## 11. 这个 flag 很关键，因为 session-only cron 根本不会触发任何文件变更

源码镜像：[`../../sources/claude-code/src/tools/ScheduleCronTool/CronCreateTool.ts`](../../sources/claude-code/src/utils/cronScheduler.ts)

`CronCreateTool` 的注释已经把原因说穿了：

- `durable: false` 不写磁盘
- 但 scheduler tick loop 仍必须启动

所以 `scheduledTasksEnabled` 的职责是：

- 把 scheduler 从“睡眠”翻成“开始跑 check()”

而不是简单代表“磁盘上有没有 cron 文件”。

## 12. file-backed cron 和 session-only cron 共用一个 scheduler，但读入方式故意不同

源码镜像：[`../../sources/claude-code/src/utils/cronScheduler.ts`](../../sources/claude-code/src/bootstrap/state.ts)

在 `check()` 中：

- file-backed tasks 来自 `load()` 后缓存的 `tasks`
- session-only tasks 每个 tick 现读 `getSessionCronTasks()`

原因很直接：

- durable tasks 可以靠 chokidar file event 触发 reload
- session tasks 中途增删不会产生文件事件

因此 scheduler 对这两套 store 采取了：

- 磁盘任务：watch + cached array
- session 任务：tick-time fresh read

## 13. 多 Claude session 共享同一个项目目录时，不是大家都驱动 scheduler，而是抢一个 lease lock

源码镜像：[`../../sources/claude-code/src/utils/cronTasksLock.ts`](../../sources/claude-code/src/utils/cronScheduler.ts)

`tryAcquireSchedulerLock()` 使用：

- `.claude/scheduled_tasks.lock`
- `writeFile(..., { flag: 'wx' })`

锁文件内容包括：

- `sessionId`
- `pid`
- `acquiredAt`

如果锁已存在：

- 同 session、不同 PID 会重写，处理 resume/new process
- live PID 持锁则当前会话被动等待
- dead PID / corrupt lock 则 unlink 后重抢

这条链的目的非常明确：防止多个 Claude 进程对同一份 durable cron double-fire。

## 14. 没抢到锁的会话不是彻底放弃，而是低频 probe takeover

源码镜像：[`../../sources/claude-code/src/utils/cronScheduler.ts`](../../sources/claude-code/src/utils/cronTasksLock.ts)

非 owner session 会每：

- `LOCK_PROBE_INTERVAL_MS = 5000`

重新 probe 一次 lock。

这样做的语义是：

- 正常情况下只有一个 owner 驱动磁盘 cron
- owner crash 后，其他会话能在粗粒度时间内接手

所以 cron 在多会话场景里不是强一致 leader election，而是足够便宜的单 driver lease。

## 15. 但这个 lock 只保护 file-backed cron，session-only cron 故意不受它约束

源码镜像：[`../../sources/claude-code/src/utils/cronScheduler.ts`](../../sources/claude-code/src/bootstrap/state.ts)

`check()` 里可以看到：

- 只有 `isOwner` 才处理 file-backed tasks
- 只要 `dir === undefined`，session cron 每 tick 都会处理

原因也很明确：

- session-only cron 是 process-private
- 其他 Claude session 根本看不见
- 不存在 double-fire 风险

这是一条很重要的设计边界：lease lock 是为 durable/shared state 服务的，不是全局禁止一切 cron fire。

## 16. fire 也不是“时间到了立即执行”，而是明确受 `isLoading()` 约束

源码镜像：[`../../sources/claude-code/src/utils/cronScheduler.ts`](../../sources/claude-code/src/hooks/useScheduledTasks.ts)

`check()` 的前几个 gate 包括：

- `isKilled?.()`
- `isLoading() && !assistantMode`

也就是说，普通 REPL 里 cron 只会在 idle 时 fire，不会 mid-query 把 prompt 塞进同一个活跃 turn。`useScheduledTasks` 也把 fired prompt 送到：

- `enqueuePendingNotification(... priority: 'later')`

所以 cron 在产品语义上更像“between-turn background enqueue”，不是异步强插消息。

## 17. assistant mode 不是另一套 scheduler，只是放宽了 loading gate

源码镜像：[`../../sources/claude-code/src/hooks/useScheduledTasks.ts`](../../sources/claude-code/src/utils/cronScheduler.ts)

assistant mode 做的是：

- `assistantMode: true`
- bypass `isLoading` defer

但仍然复用同一个 scheduler core。也就是说，assistant mode 只是把“什么时候能 enqueue”调整成更积极，而不是另写一套 cron runtime。

## 18. recurring 与 one-shot 的 next-fire 计算也故意分成两种 jitter 语义

源码镜像：[`../../sources/claude-code/src/utils/cronTasks.ts`](../../sources/claude-code/src/utils/cronJitterConfig.ts)

recurring 走：

- `jitteredNextCronRunMs(...)`

特点是：

- 基于两次 fire 间隔做比例延后
- 默认 `recurringFrac = 0.1`
- `recurringCapMs = 15min`

one-shot 走：

- `oneShotJitteredNextCronRunMs(...)`

特点是：

- 对 `:00` / `:30` 这种热点分钟做提前抖动
- 默认 `oneShotMaxMs = 90s`
- `oneShotMinuteMod = 30`

这说明 Claude Code 对 recurring 和 reminder 型任务的 herd-risk 模型完全不同。

## 19. jitter config 还是 live-tunable 的 incident lever，而不是写死常量

源码镜像：[`../../sources/claude-code/src/utils/cronJitterConfig.ts`](../../sources/claude-code/src/utils/cronTasks.ts)

REPL path 给 scheduler 注入的是：

- `getCronJitterConfig()`

它每 60s 从 GrowthBook 读一次 `tengu_kairos_cron_config`，Zod 校验失败则整包回退到：

- `DEFAULT_CRON_JITTER_CONFIG`

所以 cron jitter 在 Claude Code 里不是算法细节，而是 ops 可实时调的 fleet lever。

## 20. recurring task 不是永生的，它有明确的 auto-expiry contract

源码镜像：[`../../sources/claude-code/src/utils/cronScheduler.ts`](../../sources/claude-code/src/utils/cronTasks.ts), [`../../sources/claude-code/src/tools/ScheduleCronTool/prompt.ts`](../../sources/claude-code/src/tools/ScheduleCronTool/prompt.ts)

`isRecurringTaskAged(...)` 的判定是：

- `recurring`
- 非 `permanent`
- 距 `createdAt` 超过 `recurringMaxAgeMs`

默认上限是：

- 7 天

aged recurring task 的语义不是立即静默删除，而是：

- 再 fire 最后一次
- 之后走 one-shot delete path

这让 Claude Code 可以既支持“这周每天提醒我”，又避免 cron 成为无限期会话续命器。

## 21. `permanent` 是系统逃生口，不是普通用户经由 `CronCreate` 可写的字段

源码镜像：[`../../sources/claude-code/src/utils/cronTasks.ts`](../../sources/claude-code/src/tools/ScheduleCronTool/CronCreateTool.ts)

`CronTask.permanent` 的注释写得很清楚：

- 只给 assistant mode 内建任务
- 用户态 `CronCreateTool` 不能设置

也就是说，普通用户 cron 必须接受 auto-expiry；只有系统写入的 built-in tasks 才能绕过这条寿命边界。

## 22. missed-task catch-up 只针对 initial load，而且只问 one-shot durable tasks

源码镜像：[`../../sources/claude-code/src/utils/cronScheduler.ts`](../../sources/claude-code/src/utils/cronTasks.ts)

`load(initial: true)` 时会：

- `findMissedTasks(next, now)`
- 只保留 `!recurring`
- 标记 `missedAsked`
- 先从 JSON 删除
- 再 surface 给用户

而且提示词明确要求：

- 先用 `AskUserQuestion`
- 不要直接执行 prompt

这说明 missed-task 不是“后台补跑”，而是一种人工 catch-up operator loop。

## 23. recurring missed task 不走这条 catch-up surface，而是留给正常 `check()` 首 tick 处理

源码镜像：[`../../sources/claude-code/src/utils/cronScheduler.ts`](../../sources/claude-code/src/utils/cronTasks.ts)

注释写得非常明确：

- recurring missed tasks 不在 startup prompt 中 surface
- 留给 `check()` 去 fire/reschedule

原因是 recurring 的正确语义不是 “Claude 不在时你 missed 了一次提醒”，而是“恢复运行后继续进入周期”。

## 24. teammate cron 不是回主 REPL，而是路由回对应 teammate 的 pending user queue

源码镜像：[`../../sources/claude-code/src/hooks/useScheduledTasks.ts`](../../sources/claude-code/src/tools/ScheduleCronTool/CronCreateTool.ts), [`../../sources/claude-code/src/bootstrap/state.ts`](../../sources/claude-code/src/bootstrap/state.ts)

当 `CronCreate` 在 teammate context 下创建 session-only cron 时，会把：

- `agentId`

记进 task。

之后 `useScheduledTasks.onFireTask` 会：

- `findTeammateTaskByAgentId(...)`
- 如果 teammate 还活着，`injectUserMessageToTeammate(...)`
- 如果 teammate 已终止，删除 orphaned cron

所以 teammate cron 本质上不是团队广播，而是“把未来某条用户消息定向投递给这个 in-process teammate host”。

## 25. team lead 的普通 cron fire 会先插一条系统消息，再排队真正 prompt

源码镜像：[`../../sources/claude-code/src/hooks/useScheduledTasks.ts`](../../sources/claude-code/src/utils/messages.ts)

对非 teammate 任务，REPL path 会：

- `createScheduledTaskFireMessage("Running scheduled task (...)")`
- append 到 messages
- 再 `enqueuePendingNotification(prompt, priority: 'later', isMeta: true, workload: WORKLOAD_CRON)`

这说明 cron fire 不只是后台做事，还会在 transcript/command queue 里留下明确的 operator-visible start marker。

## 26. daemon/SDK path 复用同一 scheduler core，但故意绕开 bootstrap state

源码镜像：[`../../sources/claude-code/src/utils/cronScheduler.ts`](../../sources/claude-code/src/utils/cronTasksLock.ts)

当 `createCronScheduler({ dir, lockIdentity, ... })` 显式传 `dir` 时：

- `start()` 不再看 `getScheduledTasksEnabled()`
- 直接 `enable()`
- 不会读写 session cron store

也就是说 scheduler core 同时服务：

- REPL
- SDK / daemon

但 daemon 只处理 file-backed shared state，不碰 bootstrap/session-only 分支。

## 27. `CronList` / `CronDelete` 的 teammate scope 说明 cron 已经进入 team ownership 模型

源码镜像：[`../../sources/claude-code/src/tools/ScheduleCronTool/CronListTool.ts`](../../sources/claude-code/src/tools/ScheduleCronTool/CronDeleteTool.ts)

teammate 看到的不是全局任务表，而是：

- list 只列自己 `agentId`
- delete 也只能删自己

这说明一旦 cron 被用来驱动 teammate，Claude Code 就把它纳入了和 task ownership 类似的局部控制边界。

## 28. 前台 UI 故意极简，真正重要的是 runtime contract，不是 cron transcript 花样

源码镜像：[`../../sources/claude-code/src/tools/ScheduleCronTool/UI.tsx`](../../sources/claude-code/src/tools/ScheduleCronTool/UI.tsx)

三把工具的 UI 都只给非常薄的 receipt：

- create：`Scheduled <id> (humanSchedule)`
- delete：`Cancelled <id>`
- list：只列 `id + humanSchedule`

这说明 cron 产品面被故意设计成“配置/控制界面很薄，核心复杂性沉到底层 runtime”。

## 29. `CronCreate` 的提示词还把负载管理规则直接暴露给模型

源码镜像：[`../../sources/claude-code/src/tools/ScheduleCronTool/prompt.ts`](../../sources/claude-code/src/tools/ScheduleCronTool/prompt.ts)

prompt 明确教模型：

- 尽量别选 `:00` 和 `:30`
- approximate request 应该偏到 off-minute
- recurring 会自动过期
- durable 只在用户明确要求跨 session 时才用

也就是说，Claude Code 不是只在 runtime 做负载治理；它还把这套 operational policy 直接前置成 tool prompt contract。

## 30. 整条 cron 主链的真实分层可以压成这 5 层

1. tool layer
   - `CronCreateTool`
   - `CronDeleteTool`
   - `CronListTool`
2. storage layer
   - `sessionCronTasks` in bootstrap state
   - `.claude/scheduled_tasks.json`
3. scheduling layer
   - `createCronScheduler`
   - `nextFireAt`
   - missed/inFlight/aged logic
4. ownership layer
   - scheduler lock for durable tasks
   - teammate `agentId` routing
5. operator layer
   - queue fire between turns
   - AskUserQuestion catch-up
   - minimal receipts in transcript

所以 `ScheduleCronTool` 在 Claude Code 里真正值得记录的不是“有个 cron 功能”，而是它已经形成了一套：

- REPL-idle-safe
- multi-session lease-safe
- teammate-aware
- durable/session dual-store
- ops-tunable

的后台 prompt orchestration runtime。
