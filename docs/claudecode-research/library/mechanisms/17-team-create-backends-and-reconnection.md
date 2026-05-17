# TeamCreate、Backends 与 Reconnection

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Swarm / Teammates / Permission Bridges`](./16-swarm-teammates-and-permission-bridges.md) | [`下一站：产品卷`](../product/01-positioning-and-surface.md)

本文继续下钻 Claude Code 的 swarm 子系统，但不再讲 teammate 运行时本身，而是专门讲“队伍如何创建、backend 如何选择、pane 如何生成、队伍如何在恢复时重新挂回上下文”。这条链把 `TeamCreateTool`、backend registry、tmux / iTerm2 / in-process executor，以及 resumed session 的 team reattachment 串成了一个完整的生成与恢复子系统。

## 1. swarm 不是先 spawn teammate，再补 team；而是先建 team namespace

源码镜像：[`../../sources/claude-code/src/tools/TeamCreateTool/TeamCreateTool.ts`](../../sources/claude-code/src/tools/TeamCreateTool/TeamCreateTool.ts), [`../../sources/claude-code/src/utils/swarm/teamHelpers.ts`](../../sources/claude-code/src/utils/swarm/teamHelpers.ts)

`TeamCreateTool` 的职责不是“生成第一个 worker”，而是先建立整个 swarm 的命名空间：

- 生成唯一 `team_name`
- 生成 deterministic `lead_agent_id`
- 写入 team file
- 初始化对应 task list 目录
- 把 leader team name 注册到任务系统
- 把 teamContext 注入 AppState

这意味着 Claude Code 的 swarm 不是临时并发分支，而是先建立一个持久的 team root，再让后续 teammates 挂进来。

## 2. `TeamCreateTool` 明确把 team、task list 和 leader context 绑成同一个单位

源码镜像：[`../../sources/claude-code/src/tools/TeamCreateTool/TeamCreateTool.ts`](../../sources/claude-code/src/tools/TeamCreateTool/TeamCreateTool.ts)

`call()` 里有三步很关键：

- `resetTaskList(taskListId)` + `ensureTasksDir(taskListId)`
- `setLeaderTeamName(sanitizeName(finalTeamName))`
- `setAppState(... teamContext ...)`

这说明在 Claude Code 里：

- Team = Project = TaskList 命名空间
- leader 不能继续写回 sessionId-based task list
- swarm 一建立，任务、UI、spawn backend 都要共同切到这套 team namespace

所以 TeamCreate 不是元数据工具，而是运行时切换点。

## 3. leader 也会被写进 team file，但不会被当成 teammate

源码镜像：[`../../sources/claude-code/src/tools/TeamCreateTool/TeamCreateTool.ts`](../../sources/claude-code/src/utils/swarm/teamHelpers.ts)

`teamFile.members` 会先写入一个 leader 记录，但注释也明确强调：

- 不设置 `CLAUDE_CODE_AGENT_ID` 给 leader
- `isTeammate()` 不应对 leader 成立

这说明 team file 是“团队成员名册”，不是“teammate 判定来源”。leader 会被记录进 team state，但在行为语义上仍然保持普通主会话身份。

## 4. team file 不是轻量配置，而是 swarm 的中心状态文件

源码镜像：[`../../sources/claude-code/src/utils/swarm/teamHelpers.ts`](../../sources/claude-code/src/utils/swarm/teamHelpers.ts)

`TeamFile` 里已经包含了多类运行时状态：

- `leadAgentId`
- `leadSessionId`
- `hiddenPaneIds`
- `teamAllowedPaths`
- `members[]`

每个 member 下面还带：

- `agentId`
- `name`
- `agentType`
- `model`
- `prompt`
- `color`
- `planModeRequired`
- `tmuxPaneId`
- `cwd`
- `worktreePath`
- `sessionId`
- `subscriptions`
- `backendType`
- `isActive`
- `mode`

这说明 team file 不是“创建时写一下”的配置文件，而是 team discovery、恢复、pane 管理和权限共享共同依赖的中心状态。

## 5. backend registry 不是简单 factory，而是“执行模式仲裁器”

源码镜像：[`../../sources/claude-code/src/utils/swarm/backends/registry.ts`](../../sources/claude-code/src/utils/swarm/backends/registry.ts)

registry 做的事情比创建实例多得多：

- 动态注册 `TmuxBackend` / `ITermBackend`
- 缓存检测结果
- 维护 pane backend executor 与 in-process backend 的缓存实例
- 记录 `inProcessFallbackActive`
- 根据环境和 snapshot 解析最终 teammate mode

所以这层并不是普通 DI 容器，而是 swarm 执行模式的集中仲裁点。

## 6. backend detection 的优先级是产品策略，不是环境探测附带品

源码镜像：[`../../sources/claude-code/src/utils/swarm/backends/registry.ts`](../../sources/claude-code/src/utils/swarm/backends/registry.ts), [`../../sources/claude-code/src/utils/swarm/backends/detection.ts`](../../sources/claude-code/src/utils/swarm/backends/detection.ts)

`detectAndGetBackend()` 的优先级非常明确：

1. 如果当前就在 tmux 里，永远用 tmux
2. 否则如果在 iTerm2 且 it2 CLI 可用，用 iTerm2 native panes
3. 如果在 iTerm2 但没有 it2，尝试 tmux fallback
4. 否则只要系统有 tmux，就开 external tmux session
5. 再不行才报错

这不是“能用哪个用哪个”，而是对用户空间连续性的明确选择：

- 已经在 tmux 里就不要跳出 tmux
- 在 iTerm2 且原生支持可用时优先 native panes
- 没有 native pane 能力时再回退到 tmux

## 7. detection 模块刻意区分“当前进程在 tmux 内”和“系统上安装了 tmux”

源码镜像：[`../../sources/claude-code/src/utils/swarm/backends/detection.ts`](../../sources/claude-code/src/utils/swarm/backends/detection.ts)

这点很重要。`isInsideTmux()` 只看模块加载时捕获的原始 `TMUX` env，不会拿 `tmux display-message` 之类命令做兜底。源码注释直接解释了原因：

- 只要系统上任何 tmux server 在跑，兜底命令就可能成功
- 但那并不代表“当前 Claude 进程就在 tmux 里”

也就是说 Claude Code 明确避免把“系统可用性”和“当前会话归属”混为一谈。

## 8. iTerm2 backend 并不依赖 GUI 自动化，而是依赖 `it2` Python API CLI

源码镜像：[`../../sources/claude-code/src/utils/swarm/backends/detection.ts`](../../sources/claude-code/src/utils/swarm/backends/detection.ts), [`../../sources/claude-code/src/utils/swarm/backends/ITermBackend.ts`](../../sources/claude-code/src/utils/swarm/backends/ITermBackend.ts)

这里探测的不是 AppleScript 能不能跑，而是：

- 当前终端是否真的是 iTerm2
- `it2 session list` 能不能通到 iTerm2 Python API

而且特意不用 `it2 --version`，因为那种探测会产生“CLI 在，但 API 不通”的假阳性。说明 Claude Code 对 iTerm2 backend 的判断标准是“能不能真的 split / run / target session”，不是“命令是否安装”。

## 9. `PaneBackendExecutor` 把 pane backend 统一适配成 teammate executor

源码镜像：[`../../sources/claude-code/src/utils/swarm/backends/PaneBackendExecutor.ts`](../../sources/claude-code/src/utils/swarm/backends/PaneBackendExecutor.ts)

这层适配器做了一个关键抽象：把 pane backend 变成和 in-process backend 同级的 `TeammateExecutor`。它统一暴露：

- `spawn()`
- `sendMessage()`
- `terminate()`
- `kill()`
- `isActive()`

这样上层逻辑就不需要知道“这个 teammate 是 pane-based 还是 in-process”，而只需要面对统一执行器。

## 10. pane-based spawn 的本质是“创建 pane + 注入身份 CLI + 首条 prompt 走 mailbox”

源码镜像：[`../../sources/claude-code/src/utils/swarm/backends/PaneBackendExecutor.ts`](../../sources/claude-code/src/utils/swarm/backends/PaneBackendExecutor.ts)

`spawn()` 的真实动作链是：

1. backend 创建 pane
2. 构造 `--agent-id --agent-name --team-name --agent-color --parent-session-id`
3. 继承 leader 的 CLI flags 和 env vars
4. `cd cwd && env ... claude ...` 发到 pane
5. 再用 mailbox 写入第一条任务 prompt

这说明 pane teammate 启动并不是靠 stdin 直接塞 prompt，而是：

- 身份靠 CLI flags 固化
- 任务靠 mailbox 消息进入

也就是“启动协议”和“对话协议”被显式拆开了。

## 11. in-process backend 是“总能工作”的兜底执行器

源码镜像：[`../../sources/claude-code/src/utils/swarm/backends/InProcessBackend.ts`](../../sources/claude-code/src/utils/swarm/backends/InProcessBackend.ts)

`InProcessBackend` 的特征是：

- `isAvailable()` 永远是 true
- spawn 走 `spawnInProcessTeammate()` + `startInProcessTeammate()`
- 消息依旧走同一个 file-based mailbox
- terminate 走 shutdown request，不是 kill-pane

所以它不是实验路径，而是 Claude Code 在 pane backend 不可用、不可达或主动 fallback 时的正式执行模式。

## 12. tmux backend 区分“用户本来就在 tmux”与“外部 swarm session”

源码镜像：[`../../sources/claude-code/src/utils/swarm/backends/TmuxBackend.ts`](../../sources/claude-code/src/utils/swarm/backends/TmuxBackend.ts)

tmux backend 至少有两种运行形态：

- inside tmux：和 leader 同窗拆 pane
- outside tmux：创建独立 `claude-swarm` session / swarm-view window

而且它还维护：

- `firstPaneUsedForExternal`
- `cachedLeaderWindowTarget`
- pane creation lock

这说明 tmux backend 不只是“split-pane 一下”，而是在维护一套 swarm 专用窗口拓扑。

## 13. iTerm2 backend 的布局策略和 tmux backend 不同，而且明确针对 leader pane 稳定性

源码镜像：[`../../sources/claude-code/src/utils/swarm/backends/ITermBackend.ts`](../../sources/claude-code/src/utils/swarm/backends/ITermBackend.ts)

iTerm2 backend 的布局策略是：

- 第一个 teammate：从 leader session 做 vertical split
- 后续 teammates：从最后一个 teammate session 继续 split

它还专门记录 teammate session IDs，并在 split 失败时检查目标 session 是否已经死掉，如果死了就 prune 再重试。说明这条实现已经在处理真实世界里“用户手动关 pane / 会话掉了”的 at-fault recovery，而不是理想化顺序执行。

## 14. backend 层的 lock 说明 pane creation 默认面向并发 teammate spawn

源码镜像：[`../../sources/claude-code/src/utils/swarm/backends/TmuxBackend.ts`](../../sources/claude-code/src/utils/swarm/backends/TmuxBackend.ts), [`../../sources/claude-code/src/utils/swarm/backends/ITermBackend.ts`](../../sources/claude-code/src/utils/swarm/backends/ITermBackend.ts)

tmux 和 iTerm2 backend 都有 pane creation lock。这个信号很明确：

- teammate spawn 可以并发触发
- pane backend 本身不是天然并发安全
- Claude Code 需要在 backend 层序列化 pane creation，避免竞争条件

因此“多代理生成”不是单线程假设下的简化实现，而是专门为并发做过防护。

## 15. reconnection 不是 UI 补丁，而是 resumed session 恢复 swarm 身份的同步初始化步骤

源码镜像：[`../../sources/claude-code/src/utils/swarm/reconnection.ts`](../../sources/claude-code/src/utils/swarm/reconnection.ts)

`computeInitialTeamContext()` 解决的是 fresh spawn 路径：

- 从 `dynamicTeamContext` 读取 teammate CLI 身份
- 读取 team file
- 在首次 render 前同步计算 `teamContext`

`initializeTeammateContextFromSession()` 解决的是 resumed session 路径：

- 从 transcript 恢复出来的 `teamName/agentName` 再查 team file
- 找 member 对应的 `agentId`
- 回填 AppState.teamContext

也就是说 swarm reconnection 已经被正式纳入 state bootstrap，而不是页面挂载后慢慢修。

## 16. team 恢复依赖 team file，而不是 transcript 自己足够闭环

源码镜像：[`../../sources/claude-code/src/utils/swarm/reconnection.ts`](../../sources/claude-code/src/utils/swarm/teamHelpers.ts)

恢复时 transcript 里只提供：

- `teamName`
- `agentName`

真正要恢复：

- `leadAgentId`
- `teamFilePath`
- `selfAgentId`
- `isLeader`

仍然需要去 team file 读。这说明 swarm session 的 durable truth 不是 transcript 单体，而是 transcript + team file 的组合。

## 17. 这条生成与恢复子系统的真实闭环应该这样理解

源码镜像：[`../../sources/claude-code/src/tools/TeamCreateTool/TeamCreateTool.ts`](../../sources/claude-code/src/tools/TeamCreateTool/TeamCreateTool.ts), [`../../sources/claude-code/src/utils/swarm/teamHelpers.ts`](../../sources/claude-code/src/utils/swarm/teamHelpers.ts), [`../../sources/claude-code/src/utils/swarm/backends/registry.ts`](../../sources/claude-code/src/utils/swarm/backends/registry.ts), [`../../sources/claude-code/src/utils/swarm/backends/detection.ts`](../../sources/claude-code/src/utils/swarm/backends/detection.ts), [`../../sources/claude-code/src/utils/swarm/backends/PaneBackendExecutor.ts`](../../sources/claude-code/src/utils/swarm/backends/PaneBackendExecutor.ts), [`../../sources/claude-code/src/utils/swarm/backends/InProcessBackend.ts`](../../sources/claude-code/src/utils/swarm/backends/InProcessBackend.ts), [`../../sources/claude-code/src/utils/swarm/backends/TmuxBackend.ts`](../../sources/claude-code/src/utils/swarm/backends/TmuxBackend.ts), [`../../sources/claude-code/src/utils/swarm/backends/ITermBackend.ts`](../../sources/claude-code/src/utils/swarm/backends/ITermBackend.ts), [`../../sources/claude-code/src/utils/swarm/reconnection.ts`](../../sources/claude-code/src/utils/swarm/reconnection.ts)

可以压成七步：

1. `TeamCreateTool` 建立 team namespace 和 leader context
2. `teamHelpers` 把 team 写成共享状态文件
3. registry/detection 决定这次 swarm 用哪种 backend
4. pane backend 或 in-process backend 生成 teammate 执行器
5. `PaneBackendExecutor` / `InProcessBackend` 统一出同一套 spawn/send/terminate 接口
6. teammate 运行时接着走 mailbox、permission、task、spinner 那套子系统
7. session 恢复时 `reconnection` 再把 team context 同步挂回 AppState

这条链说明 Claude Code 的 swarm 不是“瞬时并发”，而是有 team lifecycle 的。

## 18. 为什么这块值得单独成卷

如果只看 teammate runtime，很容易忽略另一个事实：Claude Code 的 swarm 能成立，不只是因为 worker 会跑，还因为它把这些东西单独实现了：

- team namespace 初始化
- team file 共享状态
- backend 仲裁与 fallback
- pane / in-process 执行统一抽象
- fresh spawn 和 resumed session 两套 team reattachment

所以 `TeamCreate + Backend + Reconnection` 已经是一条独立功能链，不该再被埋在 swarm 总述里。
