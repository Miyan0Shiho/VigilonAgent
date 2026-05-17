# REPL 与 UI 运行时

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：CLI 分发`](./02-cli-and-bootstrap.md) | [`下一站：Bridge / Remote / Daemon`](./04-bridge-remote-and-daemon.md)

本文聚焦 `REPL.tsx`、Ink、权限对话框、消息列表和后台任务列表如何把底层 runtime 暴露成一个可交互工作台。

## 1. `REPL.tsx` 不是单纯渲染层

源码镜像：[`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx)

这个文件非常大，原因不是“UI 写得散”，而是它本身就在承担多种控制面职责：

- prompt 输入与历史
- query 生命周期驱动
- permission dialogs
- MCP elicitation dialogs
- session restore
- task / background session / teammate / swarm 视图
- IDE、SSH、remote session、scheduled task 等外围接入

所以 REPL 更像“交互式会话编排器”，而不是一个纯展示组件。

## 2. 核心合流点

从 imports 就能看出几个关键合流点：

- `query`：真正驱动模型与工具循环
- `processUserInput`：进入 query 前的输入治理
- `assembleToolPool` / `getTools`：工具池构造
- `useMergedClients` / `useMergedTools` / `useMergedCommands`：把动态来源合流成当前会话可见能力
- `useLogMessages` / `sessionStorage` / `sessionRestore`：把 transcript、恢复与 UI 滚动视图绑在一起

这意味着 REPL 并不是消费一个已经整理好的“最终状态”，而是在参与状态构造和状态变更。

## 3. 会话 UI 的实际组成

从组件与 hooks 可以把 REPL 拆成几个功能面：

- 输入面：`PromptInput`、queued commands、search input、command keybindings
- 消息面：`Messages`、`MessageSelector`、transcript modal、搜索高亮
- 权限与治理面：`PermissionRequest`、`SandboxPermissionRequest`、`ExitPlanModePermissionRequest`
- MCP 面：`ElicitationDialog`、`MCPConnectionManager`
- 任务面：`TaskListV2`、background navigation、remote agent restore
- 团队/多代理面：teammate、swarm、leader permission bridge

这也是为什么“Claude Code 的 UI”不能只用一个 `Messages` 组件来理解。

## 4. 为什么它必须知道这么多底层状态

REPL 需要读取和更新：

- 当前工具权限模式
- 当前可见工具池和命令池
- 当前 session transcript
- 当前 foreground / background tasks
- 当前 MCP 连接和授权状态
- 当前 remote / IDE / SSH / direct connect 状态

如果这些状态都被完全藏到下层，UI 就只能变成被动展示器，无法实现交互式审批、会话恢复、任务切换和系统级提示。

## 5. 对文档库的意义

REPL 层不能只用一句“REPL 负责展示消息”概括。更准确的拆法应该是：

- REPL 负责交互式 session orchestration
- QueryEngine / query 负责模型与工具主循环
- Tool / Task / MCP / SessionStorage 提供底层机制

这也是主馆藏为什么要把 UI 层单独拆出来。
