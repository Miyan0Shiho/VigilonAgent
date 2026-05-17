# Memory、Skills、Plan、Tasks 与 Compact 命令链

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：GitHub Workflow Installation / Setup`](./06-github-workflow-installation-and-setup.md) | [`下一站：技能与记忆机制`](../mechanisms/07-skills-and-memory.md)

本文拆的是另一组很容易被低估的命令：`/memory`、`/skills`、`/plan`、`/tasks`、`/compact`，以及当前镜像里只剩 stub 的 `/summary`。它们看上去都很“本地”，但实际上分别在操作长期记忆、技能目录、权限模式、后台任务总控和会话压缩协议。

## 1. 这组命令不能放在一个“集成工作流总览”里糊过去

源码镜像：[`../../sources/claude-code/src/commands/memory/memory.tsx`](../../sources/claude-code/src/commands/memory/memory.tsx), [`../../sources/claude-code/src/commands/skills/skills.tsx`](../../sources/claude-code/src/commands/skills/skills.tsx), [`../../sources/claude-code/src/commands/plan/plan.tsx`](../../sources/claude-code/src/commands/plan/plan.tsx), [`../../sources/claude-code/src/commands/tasks/tasks.tsx`](../../sources/claude-code/src/commands/tasks/tasks.tsx), [`../../sources/claude-code/src/commands/compact/compact.ts`](../../sources/claude-code/src/commands/compact/compact.ts)

它们虽然都挂在 slash command 层，但工程角色完全不同：

- `/memory`：打开和创建 Claude memory 文件
- `/skills`：列出当前会话真正可用的 skill surfaces
- `/plan`：切换 permission mode，并把计划文件接进会话
- `/tasks`：打开后台任务总控台
- `/compact`：直接改写当前会话消息与摘要边界

这不是一组“类似命令”，而是一组共享入口层、但操作对象完全不同的产品控制面。

## 2. `/memory` 不是只读查看器，而是“文件创建 + 编辑器跳转”命令

源码镜像：[`../../sources/claude-code/src/commands/memory/memory.tsx`](../../sources/claude-code/src/commands/memory/memory.tsx), [`../../sources/claude-code/src/components/memory/MemoryFileSelector.tsx`](../../sources/claude-code/src/components/memory/MemoryFileSelector.tsx)

`/memory` 的关键行为不是展示列表，而是：

- 清空并预热 memory 文件缓存
- 通过 `MemoryFileSelector` 列出 user/project/nested/auto-memory/team memory 路径
- 如目标文件不存在，先创建目录和文件
- 再调用 `editFileInEditor(memoryPath)`

也就是说，它不是“在 TUI 里编辑记忆”，而是把 Claude 的多层 memory namespace 暴露出来，并把真正编辑动作交给外部编辑器。

## 3. `MemoryFileSelector` 暴露的是 memory namespace，而不是两个固定文件

源码镜像：[`../../sources/claude-code/src/components/memory/MemoryFileSelector.tsx`](../../sources/claude-code/src/components/memory/MemoryFileSelector.tsx)

这个选择器至少会汇总：

- `~/.claude/CLAUDE.md`
- 当前项目 `./CLAUDE.md`
- `@-imported` 的 nested memory
- auto-memory folder
- team memory folder
- active agents 的 memory 目录

同时它还会显示：

- 文件是否是新建候选
- 是 user/project/dynamically loaded 哪一类
- auto-dream 是否开启、最近一次 consolidation 时间

所以 `/memory` 真正打开的是 Claude Code 的 memory topology，而不是单一的 “CLAUDE.md editor”。

## 4. `/memory` 在命令层就承担了 editor 协议解释责任

源码镜像：[`../../sources/claude-code/src/commands/memory/memory.tsx`](../../sources/claude-code/src/commands/memory/memory.tsx)

命令完成后，它不会只说“已打开文件”，还会补：

- 当前由 `$VISUAL` 还是 `$EDITOR` 控制
- 如果没有设置，如何更换编辑器
- 相对 memory 路径，而不是裸绝对路径

这说明 `/memory` 的职责不只是发起编辑动作，而是解释 Claude memory 编辑环境当前由谁控制。

## 5. `/skills` 是一个“当前会话技能能力图”，不是文件浏览器

源码镜像：[`../../sources/claude-code/src/commands/skills/skills.tsx`](../../sources/claude-code/src/commands/skills/skills.tsx), [`../../sources/claude-code/src/components/skills/SkillsMenu.tsx`](../../sources/claude-code/src/components/skills/SkillsMenu.tsx)

`/skills` 自己很薄，只把 `context.options.commands` 交给 `SkillsMenu`。但这不意味着它简单，因为真正的逻辑在 `SkillsMenu`：

- 从当前已加载 commands 中筛出 `prompt` 类型 skill commands
- 只保留 `skills`、legacy `commands_DEPRECATED`、`plugin`、`mcp` 这些来源
- 按 source 分组展示
- 显示每个 skill 的 description token 估计

所以 `/skills` 不是读磁盘目录，而是在显示“这一轮会话里真正有效的 skill surface”。

## 6. `SkillsMenu` 证明 skill 已经不只是本地文件能力

源码镜像：[`../../sources/claude-code/src/components/skills/SkillsMenu.tsx`](../../sources/claude-code/src/components/skills/SkillsMenu.tsx)

这个菜单显式区分：

- `projectSettings`
- `userSettings`
- `policySettings`
- `plugin`
- `mcp`

并且：

- MCP skills 用 server name 作为副标题
- file-based skills 用实际 filesystem path
- plugin skills 还能显示 plugin manifest name

这说明 Claude Code 的 skill 体系已经不只是 `.claude/skills` 下的 prompt 文件，而是把 plugin/MCP 注入的 prompt capabilities 一起纳入统一 skills surface。

## 7. `/plan` 的第一职责不是展示计划，而是切换 permission mode

源码镜像：[`../../sources/claude-code/src/commands/plan/plan.tsx`](../../sources/claude-code/src/commands/plan/plan.tsx)

`/plan` 最关键的行为是：

- 检查当前 `toolPermissionContext.mode`
- 如果还不是 `plan`，调用 `handlePlanModeTransition()`
- 再通过 `applyPermissionUpdate(prepareContextForPlanMode(...))` 把 session 模式切到 `plan`

这说明 `/plan` 不是单纯“显示某个计划文件”，而是一个显式的会话治理动作，会改变后续权限与交互模式。

## 8. `/plan` 在 plan mode 前后，其实是两条完全不同的命令语义

源码镜像：[`../../sources/claude-code/src/commands/plan/plan.tsx`](../../sources/claude-code/src/commands/plan/plan.tsx)

当当前不在 plan mode 时：

- `/plan <description>` 先开 mode
- 并在有 description 时回到主 query 流，继续生成计划

当已经在 plan mode 时：

- `/plan` 显示当前计划内容
- `/plan open` 用外部编辑器打开计划文件
- 如果还没有计划，明确返回 “No plan written yet.”

所以 `/plan` 不是一个固定动作，而是“进入计划模式”和“查看/编辑当前计划”两个阶段性命令。

## 9. `/tasks` 本身很薄，但它把后台任务系统提升成了显式 operator surface

源码镜像：[`../../sources/claude-code/src/commands/tasks/tasks.tsx`](../../sources/claude-code/src/commands/tasks/tasks.tsx), [`../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx)

`/tasks` 自己只做一件事：

- 打开 `BackgroundTasksDialog`

但这个薄入口很重要，因为它意味着后台任务不是“隐式跑着的系统状态”，而是一个用户可随时拉起的控制台。

## 10. `BackgroundTasksDialog` 不是列表框，而是后台执行统一总控台

源码镜像：[`../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx)

它会把后台执行分成多类：

- `local_bash`
- `remote_agent`
- `local_agent`
- `in_process_teammate`
- `local_workflow`
- `monitor_mcp`
- `dream`

同时还支持：

- 只有一个任务时直接跳 detail
- `x` 停止不同类型任务
- `f` foreground teammate / leader
- detail 与 list 两态切换

因此 `/tasks` 的真实语义是“统一后台任务控制面”，而不只是 “show me tasks”。

## 11. `/compact` 是这组命令里最像真正 runtime mutation 的一条

源码镜像：[`../../sources/claude-code/src/commands/compact/compact.ts`](../../sources/claude-code/src/commands/compact/compact.ts)

和其他本地 JSX 控制台不同，`/compact` 是一个 `local` 命令，而且支持 non-interactive。它会：

- 先拿 `getMessagesAfterCompactBoundary()`，避免把 UI scrollback 里已剪掉的消息重新纳入摘要
- 读取可选自定义摘要指令
- 按多级策略决定走哪条 compact 路径

所以 `/compact` 是直接操作当前会话消息结构的命令，不是 UI 面。

## 12. `/compact` 实际上有三条压缩路径，而不是一种摘要算法

源码镜像：[`../../sources/claude-code/src/commands/compact/compact.ts`](../../sources/claude-code/src/commands/compact/compact.ts)

它的优先级是：

1. 无自定义指令时，优先尝试 `trySessionMemoryCompaction()`
2. 如果开启 `REACTIVE_COMPACT` 且处于 reactive-only mode，走 `compactViaReactive()`
3. 否则回退到传统 `microcompactMessages() -> compactConversation()`

这说明 `/compact` 并不是一个固定实现，而是一个“压缩策略路由器”。

## 13. `/compact` 的成功路径不只是返回摘要，还会重置多处运行时状态

源码镜像：[`../../sources/claude-code/src/commands/compact/compact.ts`](../../sources/claude-code/src/commands/compact/compact.ts)

成功后它会组合做这些事：

- `markPostCompaction()`
- `suppressCompactWarning()`
- `runPostCompactCleanup()`
- 清理 user context cache
- 在 legacy/reactive 路径下重置 `lastSummarizedMessageId`
- 某些路径下补 `notifyCompaction()`

这说明 compact 在 Claude Code 里不是“生成一段 summary 文本”，而是完整的会话状态迁移协议。

## 14. `compactViaReactive()` 证明 reactive compact 还接了 hooks 和 cache-sharing 参数

源码镜像：[`../../sources/claude-code/src/commands/compact/compact.ts`](../../sources/claude-code/src/commands/compact/compact.ts)

reactive 路径里还会：

- 先并发执行 `executePreCompactHooks()` 和 `getCacheSharingParams()`
- 合并 hook 生成的新 custom instructions
- 调 `reactiveCompactOnPromptTooLong()`
- 把 pre-hook 和 post-compact 的 user display message 合并

因此 reactive compact 不是传统 compact 的小改版，而是把 hook 系统、tool graph、system prompt 构造一起纳入压缩协议。

## 15. `/summary` 在当前镜像里不是功能命令，而是显式隐藏的 stub

源码镜像：[`../../sources/claude-code/src/commands/summary/index.js`](../../sources/claude-code/src/commands/summary/index.js)

当前工作区里 `/summary` 只剩：

- `isEnabled: () => false`
- `isHidden: true`
- `name: 'stub'`

所以在当前可见源码里，不能把 `/summary` 当成已实现命令族来写。它更像历史残留或 feature-gated 占位符，当前证据只足以说明：

- 命令位还在
- 但当前镜像下不可用，也不该伪装成完整功能

## 16. 这一页的结论

这组命令展示了 Claude Code 命令层的四种完全不同角色：

- `/memory`：memory namespace editor launcher
- `/skills`：当前会话有效 skill capability registry
- `/plan`：permission mode switcher + plan viewer/editor
- `/tasks`：后台执行总控台入口
- `/compact`：会话压缩与状态迁移路由器

也正因为它们差异这么大，文档库必须把它们从 `commands/03` 这类总述里拆出来。否则读者只会看到“有一些命令”，看不到每条命令到底在改什么系统状态、暴露什么控制面。
