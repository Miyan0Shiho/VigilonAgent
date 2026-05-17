# Memory、Skills、Tasks 与 Bridge Operator Dialogs

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Theme Tokens 与 Render Surfaces`](./14-theme-tokens-and-render-surfaces.md) | [`下一站：GitHub Install 与 Review Gates`](./16-github-install-and-review-gates.md)

这一卷不再讲命令本身，而是讲命令背后的前台工作面。`/memory`、`/skills`、`/tasks`、`/remote-control` 在命令层看起来只是四个入口，但真正决定用户如何操作的，是 `MemoryFileSelector`、`SkillsMenu`、`BackgroundTasksDialog` 和 `BridgeDisconnectDialog` 这四个 UI/runtime 面。它们共同说明 Claude Code 的很多 slash command 不是“执行一个动作”，而是“打开一个有状态的 operator surface”。

## 1. 这组前台工作面解决的是“命令进入后怎么继续操作”

源码镜像：[`../../sources/claude-code/src/components/memory/MemoryFileSelector.tsx`](../../sources/claude-code/src/components/memory/MemoryFileSelector.tsx), [`../../sources/claude-code/src/components/skills/SkillsMenu.tsx`](../../sources/claude-code/src/components/skills/SkillsMenu.tsx), [`../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx), [`../../sources/claude-code/src/commands/bridge/bridge.tsx`](../../sources/claude-code/src/commands/bridge/bridge.tsx)

这几块 UI 覆盖的是四种完全不同的 operator 问题：

- `/memory`：应该编辑哪个记忆命名空间，还要不要顺手切 auto-memory / auto-dream
- `/skills`：当前会话到底加载了哪些能力，它们来自哪里，description token 成本大概多高
- `/tasks`：有哪些后台执行单元正在跑，能不能停、能不能切回前台、能不能钻详情
- `/remote-control`：bridge 已连接时是断开、展示二维码，还是继续沿用当前会话

因此它们不是普通弹窗，而是 Claude Code 把“运行时控制面”产品化后的终端工作台。

## 2. `MemoryFileSelector` 不是文件选择器，而是 memory topology operator

源码镜像：[`../../sources/claude-code/src/components/memory/MemoryFileSelector.tsx`](../../sources/claude-code/src/components/memory/MemoryFileSelector.tsx)

这块组件先做的不是渲染，而是把当前可操作的 memory 空间整理成一个拓扑：

- 已存在的 user/project memory 文件
- 缺失但允许新建的 `~/.claude/CLAUDE.md` 和 `./CLAUDE.md`
- nested `@` import 带进来的 memory 文件
- auto-memory、team memory、agent memory 对应的目录入口

这意味着 `/memory` 的核心不是 “open CLAUDE.md”，而是 “在多个记忆命名空间之间做选择或跳转”。

## 3. `MemoryFileSelector` 会显式制造“可新建目标”，而不是只列真实文件

源码镜像：[`../../sources/claude-code/src/components/memory/MemoryFileSelector.tsx`](../../sources/claude-code/src/components/memory/MemoryFileSelector.tsx)

它会检查：

- `hasUserMemory`
- `hasProjectMemory`

如果缺失，就把对应路径补成 `exists: false` 的候选项，并在 label 上标 `(new)`。这很重要，因为它说明 memory surface 的语义是：

- 既能选择现有记忆
- 也能把一个还不存在的记忆空间当成合法目标

也就是说，这里不是纯 browse，而是 browse + create-on-open。

## 4. nested memory 的缩进和描述说明它在渲染一棵导入树

源码镜像：[`../../sources/claude-code/src/components/memory/MemoryFileSelector.tsx`](../../sources/claude-code/src/components/memory/MemoryFileSelector.tsx)

`depths`、`parent`、`isNested`、`"@-imported"` 这些字段组合起来，说明这不是平铺列表。它会：

- 根据 parent 关系计算 depth
- 对 nested 节点加缩进
- 用 `@-imported` 和 `dynamically loaded` 区分导入来源

所以用户看到的不是“若干 CLAUDE.md 文件”，而是一棵当前指令系统的 memory/import 树。

## 5. `MemoryFileSelector` 把 auto-memory 和 auto-dream 直接内嵌成可切换运行时开关

源码镜像：[`../../sources/claude-code/src/components/memory/MemoryFileSelector.tsx`](../../sources/claude-code/src/components/memory/MemoryFileSelector.tsx)

它在文件选择列表上方额外渲染两条 toggle：

- `Auto-memory: on/off`
- `Auto-dream: on/off`

并通过 `updateSettingsForSource("userSettings", ...)` 立即改用户配置，再上报：

- `tengu_auto_memory_toggled`
- `tengu_auto_dream_toggled`

这说明 `/memory` 在产品定义上已经不只是“挑一个记忆文件”，而是记忆系统的即时控制台。

## 6. dream 状态行说明 memory 面板已经接到后台 consolidation runtime

源码镜像：[`../../sources/claude-code/src/components/memory/MemoryFileSelector.tsx`](../../sources/claude-code/src/components/memory/MemoryFileSelector.tsx)

`MemoryFileSelector` 还会从两条运行时信号读状态：

- `tasks` 里是否有 `dream` 正在 `running`
- `readLastConsolidatedAt()` 返回的上次 consolidation 时间

然后把状态渲染成：

- `running`
- `never`
- `last ran ... ago`
- `/dream to run`

所以这个面板已经不是静态配置页，而是能看见 session-memory consolidation 活动的观测面。

## 7. `MemoryFileSelector` 的键位设计是“双焦点模式机”，不是单一列表

源码镜像：[`../../sources/claude-code/src/components/memory/MemoryFileSelector.tsx`](../../sources/claude-code/src/components/memory/MemoryFileSelector.tsx), [`../../sources/claude-code/src/components/CustomSelect/index.ts`](../../sources/claude-code/src/components/CustomSelect/index.ts)

它内部显式维护 `focusedToggle`，把交互拆成两层：

- toggle 焦点层：`confirm:yes` 切开关，`select:next/previous` 在开关行之间移动
- Select 焦点层：真正选择 memory path

并通过：

- `isDisabled={toggleFocused}`
- `onUpFromFirstItem={() => setFocusedToggle(lastToggleIndex)}`

在 toggle 区和 path 列表之间切换焦点。也就是说，这里不是“一个列表里混几项特殊行”，而是两个交互子系统拼成一个 operator panel。

## 8. open-folder 选项说明 memory 面板同时承担“目录探针”角色

源码镜像：[`../../sources/claude-code/src/components/memory/MemoryFileSelector.tsx`](../../sources/claude-code/src/components/memory/MemoryFileSelector.tsx)

当 auto-memory 打开时，它会追加：

- `Open auto-memory folder`
- `Open team memory folder`
- `Open <agent> agent memory`

这些项不是普通 path 选择，而是用 `OPEN_FOLDER_PREFIX` 编码后，在选择时：

- `mkdir(..., { recursive: true })`
- `openPath(folderPath)`

这说明 memory surface 同时覆盖了“编辑指令文件”和“直接巡航后台记忆目录”两种操作。

## 9. `SkillsMenu` 不是技能文件浏览器，而是当前会话 capability registry

源码镜像：[`../../sources/claude-code/src/components/skills/SkillsMenu.tsx`](../../sources/claude-code/src/components/skills/SkillsMenu.tsx)

`SkillsMenu` 一上来就过滤命令集合，只保留：

- `type === 'prompt'`
- `loadedFrom === 'skills' | 'commands_DEPRECATED' | 'plugin' | 'mcp'`

这说明它展示的不是磁盘上所有 skill 文件，而是当前会话真正生效的 prompt-capability surface。

所以 `/skills` 的问题不是“有哪些文件”，而是“这个 session 现在可调哪些 prompt skills”。

## 10. `SkillsMenu` 的分组模型直接暴露了 Claude Code 的 skill 来源分层

源码镜像：[`../../sources/claude-code/src/components/skills/SkillsMenu.tsx`](../../sources/claude-code/src/components/skills/SkillsMenu.tsx)

它按 source 分成：

- `projectSettings`
- `userSettings`
- `policySettings`
- `plugin`
- `mcp`

并且标题不是通用文案，而是：

- file-based source 显示实际 skills 目录路径
- MCP source 显示 server names

这说明 skills menu 在做的不是列表美化，而是把 Claude Code 的能力来源层级显式摊给用户看。

## 11. `SkillsMenu` 把 description token 预算做成了一等信息

源码镜像：[`../../sources/claude-code/src/components/skills/SkillsMenu.tsx`](../../sources/claude-code/src/components/skills/SkillsMenu.tsx), [`../../sources/claude-code/src/skills/loadSkillsDir.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts)

每条 skill 旁边都会显示：

- `estimateSkillFrontmatterTokens(skill)`
- `~N description tokens`

这说明 Claude Code 对 skill 的理解不是“有就行”，而是默认把 prompt cost 当成真实治理问题。`/skills` 因而也是一个成本观察面，帮助用户理解：

- 哪些能力在当前会话里被引入
- 这些能力描述大概会消耗多少上下文预算

## 12. `SkillsMenu` 的 empty state 也在强化“应该去哪个目录加能力”

源码镜像：[`../../sources/claude-code/src/components/skills/SkillsMenu.tsx`](../../sources/claude-code/src/components/skills/SkillsMenu.tsx)

当没有 skills 时，它不会报错，而是明确提示：

- `Create skills in .claude/skills/ or ~/.claude/skills/`

这说明这个对话框同时承担了 discoverability 角色：不仅展示已加载能力，还教育用户应当把新能力放在哪里。

## 13. `BackgroundTasksDialog` 是 Claude Code 的后台任务总控台，不是简单列表

源码镜像：[`../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx)

这块组件做的第一件大事，是把所有 background task 归并成可操作项目：

- `local_bash`
- `remote_agent`
- `local_agent`
- `in_process_teammate`
- `local_workflow`
- `monitor_mcp`
- `dream`
- synthetic `leader`

而且排序逻辑同时看：

- `running` 优先级
- `startTime`

因此 `/tasks` 不是“查看任务数组”，而是把多种异构后台执行单元统一成一个 operator console。

## 14. `BackgroundTasksDialog` 的 list/detail 双模式说明它本质是控制台，而不是 drawer

源码镜像：[`../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx)

它显式维护：

- `mode: 'list'`
- `mode: 'detail'`

并支持：

- 初次打开若只有一个任务，直接跳 detail
- 若 detail 中任务消失，按当前上下文决定回 list 还是直接关闭
- `goBackToList()` 根据 “是否 mount 时跳过 list” 和 “现在还有几个任务” 决定返回行为

这说明它已经是一个带导航状态的终端控制台，而不是普通模态层。

## 15. `BackgroundTasksDialog` 其实在编排七类任务分区和一个团队视角

源码镜像：[`../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx)

列表模式下它固定按视觉顺序组织成：

- teammates
- shells
- monitors
- remote agents
- local agents
- workflows
- dreams

还会在 teammate 存在时插入 synthetic `leader` 项，并在 spinner-tree 模式下隐藏 teammate 列表，把这部分职责让给主视图树。也就是说，这个组件既是任务总控台，也是 swarm 视角和普通后台视角之间的协调器。

## 16. `BackgroundTasksDialog` 的键位设计是“按任务类型动态暴露动作”

源码镜像：[`../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx)

标准动作是：

- `↑/↓` 选中
- `Enter` 进入详情
- `←/Esc` 关闭

但其他动作是条件化暴露的：

- `x` 只在当前任务可停止且仍在 running 时出现
- `f` 只对 running teammate 或 synthetic leader 出现
- `stop all agents` 只在存在 running local agents 时出现

这说明 `/tasks` 并不是统一命令板，而是根据 task capability 动态生成 operator affordance。

## 17. detail dispatch 说明它真正在统一多个子系统，而不是伪统一

源码镜像：[`../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx)

进入 detail 后，它会按 task type 分发到完全不同的子对话框：

- `ShellDetailDialog`
- `AsyncAgentDetailDialog`
- `RemoteSessionDetailDialog`
- `InProcessTeammateDetailDialog`
- `WorkflowDetailDialog`
- `MonitorMcpDetailDialog`
- `DreamDetailDialog`

这说明 `BackgroundTasksDialog` 的“统一”不是把一切压平，而是：

- list 层统一任务目录
- detail 层再下钻回各自专用运行时

这是一个典型的 federation console 结构。

## 18. `BridgeDisconnectDialog` 揭示 `/remote-control` 已连接后的真实 operator 语义

源码镜像：[`../../sources/claude-code/src/commands/bridge/bridge.tsx`](../../sources/claude-code/src/commands/bridge/bridge.tsx)

当 `/remote-control` 已连接时，`BridgeToggle` 不会继续 connect，而是切到 `BridgeDisconnectDialog`。这个对话框的焦点不是“告诉你已连上”，而是给三种后续动作：

- `Disconnect this session`
- `Show QR code` / `Hide QR code`
- `Continue`

所以 `/remote-control` 的前台工作面不是状态页，而是对现有 bridge session 的续用/断开/分享控制面。

## 19. `BridgeDisconnectDialog` 自己就是一个小型 select-mode 状态机

源码镜像：[`../../sources/claude-code/src/commands/bridge/bridge.tsx`](../../sources/claude-code/src/commands/bridge/bridge.tsx)

它内部维护：

- `focusIndex`
- `showQR`
- `qrText`

并通过 `useKeybindings(..., { context: 'Select' })` 把：

- `select:next`
- `select:previous`
- `select:accept`

映射成三项 operator choice。这说明 bridge 管理面并不是临时硬编码，而是正式接入了全局键位系统里的 select context。

## 20. 二维码逻辑说明这不是本机专属 UI，而是跨设备 handoff surface

源码镜像：[`../../sources/claude-code/src/commands/bridge/bridge.tsx`](../../sources/claude-code/src/commands/bridge/bridge.tsx)

`BridgeDisconnectDialog` 会根据：

- `replBridgeSessionUrl`
- `replBridgeConnectUrl`
- `replBridgeSessionActive`

决定当前显示哪个 URL；开启 QR 时，再用 `qrcode.toString(..., { type: 'utf8', small: true })` 生成终端里的 ASCII 二维码。

这说明 bridge UI 的一个正式职责是把终端会话 handoff 给另一端设备或浏览器，而不只是管理本地状态布尔值。

## 21. `checkBridgePrerequisites()` 说明 bridge operator surface 前面还有一整条 gate pipeline

源码镜像：[`../../sources/claude-code/src/commands/bridge/bridge.tsx`](../../sources/claude-code/src/commands/bridge/bridge.tsx)

真正 connect 之前，bridge.tsx 还会跑一遍前置检查：

- 等 policy limits 加载完成
- 检查 `allow_remote_control`
- 检查 `getBridgeDisabledReason()`
- 按 env-less / v1 bridge 分叉检查 min version
- 在 `KAIROS` assistant mode 下强制回 v1 语义
- 检查 access token，否则返回 `BRIDGE_LOGIN_INSTRUCTION`

也就是说，`BridgeToggle` 不是 UI 自己改一个开关，而是 UI 驱动的 preflight gate + app-state mutation pipeline。

## 22. 这一卷和前几卷的分工边界

这篇不替代前面的几卷，而是把之前还混在命令总述和任务总述里的前台面单独拆出来：

- [`commands/07-memory-skills-plan-tasks-and-compact.md`](../commands/07-memory-skills-plan-tasks-and-compact.md)
  讲命令入口和产品语义。
- [`commands/08-bootstrap-remote-control-and-web-planning.md`](../commands/08-bootstrap-remote-control-and-web-planning.md)
  讲 `/remote-control` 作为命令入口的桥接逻辑。
- [`architecture/08-tasks-remote-and-agent-detail-ui.md`](./08-tasks-remote-and-agent-detail-ui.md)
  讲任务详情和远端/agent UI 总体结构。
- 本文
  专门讲 memory、skills、tasks、bridge 这四个 operator dialog 如何把命令转成可持续操作的前台工作面。

## 23. 这一层为什么必须单独成卷

如果只看命令层，会误以为：

- `/memory` 只是打开一个文件
- `/skills` 只是列出技能
- `/tasks` 只是看后台列表
- `/remote-control` 只是连接桥

但源码显示并不是这样。Claude Code 已经把它们做成了四个不同风格的 operator surface：

- memory topology + runtime toggles
- capability registry + token budget view
- federated background task console
- bridge session continuation/share/disconnect console

这正是一个成熟终端产品的特征：命令只是入口，真正的复杂度在命令后面的工作面。
