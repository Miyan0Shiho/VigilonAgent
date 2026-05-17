# Prompt Command Loading / Selection / Execution Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Policy Settings Governance Across Command Discovery / Marketplaces / Recommendation Surfaces`](./42-policy-settings-governance-across-command-discovery-marketplaces-and-recommendation-surfaces.md) | [`下一站：Dynamic Skills / Model-Only Skills / Host-Safe Command Gates`](./44-dynamic-skills-model-only-skills-and-host-safe-command-gates.md)

前一卷补的是 `policySettings` 如何改写命令发现、插件市场和推荐安装。这一卷继续往下钻 `prompt commands` 自身的运行时，不再停留在“它们在列表里怎么显示”，而是讲：

- `PromptCommand` 这个协议到底承诺了什么
- `commands.ts` 怎样把 skills / workflows / plugin commands / built-ins 合成一张命令表
- slash 输入怎样被解析、选命令、分流到 `local` / `local-jsx` / `prompt`
- `prompt` 类型命令怎样展开成 meta user message、attachments、`command_permissions`
- `fork`、coordinator mode、SkillTool 这几条特殊执行路径怎样嵌在同一条链里

对应源码主链是：`types/command.ts + commands.ts + utils/slashCommandParsing.ts + utils/processUserInput/processSlashCommand.tsx + utils/handlePromptSubmit.ts + tools/SkillTool/prompt.ts + tools/SkillTool/SkillTool.ts`。

## 1. `PromptCommand` 不是“命令名字加一段 prompt”，而是一套可执行协议

源码镜像：[`../../sources/claude-code/src/types/command.ts`](../../sources/claude-code/src/types/command.ts)

`PromptCommand` 真正定义的字段包括：

- `progressMessage`
- `contentLength`
- `argNames`
- `allowedTools`
- `model`
- `source`
- `pluginInfo`
- `hooks`
- `skillRoot`
- `context`
- `agent`
- `effort`
- `paths`
- `getPromptForCommand(args, context)`

也就是说，prompt command 在 Claude Code 里不是静态模板，而是：

- 可声明额外工具权限
- 可切换模型/effort
- 可注册 hooks
- 可声明只在某些路径下可见
- 可决定 inline 还是 fork 执行

## 2. `CommandBase` 里那组字段决定的是“命令怎样被系统装配”，不是单纯 UI metadata

源码镜像：[`../../sources/claude-code/src/types/command.ts`](../../sources/claude-code/src/types/command.ts)

`CommandBase` 里的关键字段有：

- `availability`
- `isEnabled`
- `isHidden`
- `loadedFrom`
- `kind`
- `immediate`
- `disableModelInvocation`
- `userInvocable`
- `userFacingName`

这说明命令协议从一开始就把下面这些问题编码进结构体：

- 谁能看到它
- 现在能不能用
- 它来自哪类 source
- 它是不是 workflow-backed prompt command
- 它是不是需要立即执行的本地 JSX 命令
- 它能不能被模型通过 SkillTool 调用

## 3. `commands.ts` 的主装配逻辑不是“读一个 commands 目录”，而是并行汇总多来源命令面

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts)

`loadAllCommands(cwd)` 会并行拉三大块：

- `getSkills(cwd)`
- `getPluginCommands()`
- `getWorkflowCommands(cwd)`，仅在 feature gate 开启时

然后再拼上同步内建 `COMMANDS()`。

这说明运行时命令表不是单源 registry，而是：

- skill 目录命令
- plugin skills
- bundled skills
- builtin plugin skills
- workflow scripts
- plugin local/prompt commands
- built-in commands

一起汇总成一张总表。

## 4. `getSkills(cwd)` 已经把 “skill” 细分成 4 个来源层

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts)

`getSkills()` 返回的不是一个数组，而是四段：

- `skillDirCommands`
- `pluginSkills`
- `bundledSkills`
- `builtinPluginSkills`

这说明对 Claude Code 来说，“skills” 不是单个目录概念，而是多来源 prompt capability family。`commands.ts` 只是把这些来源统一投射进 slash-command runtime。

## 5. `getCommands()` 在装配完成后还要再跑一层动态 gate，而不是直接返回 memoized 结果

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts)

`loadAllCommands(cwd)` 是 memoized 的，但 `getCommands(cwd)` 仍然每次都会重新跑：

- `meetsAvailabilityRequirement(cmd)`
- `isCommandEnabled(cmd)`

原因很明确：

- auth/provider 状态会 mid-session 改变，例如 `/login`
- feature flags / env checks 也可能变化

所以命令加载可以缓存，命令可见性不能完全缓存。

## 6. `availability` 这层不是 feature flag，而是 auth/provider contract

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts)

`meetsAvailabilityRequirement()` 只看：

- `claude-ai`
- `console`

并按当前用户是：

- claude.ai subscriber
- direct 1P Console API key user

来决定命令是否可见。

这意味着某些命令在系统里是“已加载但不对当前 auth surface 暴露”，而不是根本没注册。

## 7. dynamic skills 不会重建整张命令表，而是以插片方式插进已装配好的 base commands

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts)

`getCommands()` 在拿到 `allCommands` 之后，还会读：

- `getDynamicSkills()`

然后只做：

- 名字级去重
- `availability/isEnabled` 再过滤
- 插到 built-in commands 之前

这说明动态发现 skill 不是独立 registry 重构，而是对运行时总表的一次稳定插片。

## 8. `getSkillToolCommands()` 和 `getSlashCommandToolSkills()` 是两种不同投影，不要混成一回事

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts)

`getSkillToolCommands()` 取的是：

- 所有 `type === 'prompt'`
- `disableModelInvocation !== true`
- `source !== 'builtin'`
- 并且 description/whenToUse 足够可列出

`getSlashCommandToolSkills()` 则更偏“技能感”筛选：

- `loadedFrom === 'skills' | 'plugin' | 'bundled'`
- 或 `disableModelInvocation`

因此：

- 前者是 SkillTool 给模型看的可调用 prompt capability 列表
- 后者更像“技能目录”的投影

两者都来自同一套命令表，但面向的运行时用途不同。

## 9. `parseSlashCommand()` 的协议很窄，只负责把输入切成 `commandName/args/isMcp`

源码镜像：[`../../sources/claude-code/src/utils/slashCommandParsing.ts`](../../sources/claude-code/src/utils/slashCommandParsing.ts)

这层只做三件事：

- 去掉前导 `/`
- 拆第一个 token 作为命令名
- 当第二个 token 是 `(MCP)` 时把它并回命令名并标记 `isMcp`

这说明 slash parser 自身不做 lookup、不做权限、不做 prompt 展开，它只是中央协议化 tokenizer。

## 10. `handlePromptSubmit()` 先抢走的是 `immediate local-jsx`，不是所有 slash commands

源码镜像：[`../../sources/claude-code/src/utils/handlePromptSubmit.ts`](../../sources/claude-code/src/utils/handlePromptSubmit.ts)

输入提交流程里，系统会先看：

- 输入是否以 `/` 开头
- 是否命中 `cmd.immediate`
- 是否是 `local-jsx`
- 当前是否正在 query / external loading

只有满足这些条件，才会走“立即本地弹 UI”的短路路径。

这说明“slash command”在前台层并不是统一处理的：

- `immediate local-jsx` 会抢占当前运行中的 turn
- 普通 prompt/local 命令则继续走排队或标准 slash dispatch

## 11. `processSlashCommand()` 是 slash runtime 的主分流器，真正决定 local / local-jsx / prompt 三路

源码镜像：[`../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx`](../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx)

核心流程是：

1. `getMessagesForSlashCommand(commandName, args, ...)`
2. 里面 `getCommand(commandName, context.options.commands)`
3. 根据 `command.type` 分三路：
   - `local-jsx`
   - `local`
   - `prompt`

所以 slash runtime 的主干不是靠文件目录区分，而是最终靠 `Command` 协议上的 discriminated union 来分流执行。

## 12. `local-jsx` 命令本质上是“返回一个 Ink subtree + onDone 协议”的交互式命令

源码镜像：[`../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx`](../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx), [`../../sources/claude-code/src/utils/handlePromptSubmit.ts`](../../sources/claude-code/src/utils/handlePromptSubmit.ts)

`local-jsx` 路径里，系统会：

- `command.load()`
- 调 `mod.call(onDone, context, args)`
- 如果返回 JSX，就 `setToolJSX(...)`
- 等 `onDone()` 回来再决定是否产生日志/消息/nextInput

也就是说 `local-jsx` 不是“返回文本的命令”，而是一个会接管当前 TUI 某个区域、最终通过 `onDone` 回传结果的交互协议。

## 13. `local` 命令的 transcript 契约也不是普通 assistant text，而是 `local-command-stdout/stderr`

源码镜像：[`../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx`](../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx), [`../../sources/claude-code/src/entrypoints/sdk/coreSchemas.ts`](../../sources/claude-code/src/entrypoints/sdk/coreSchemas.ts)

`local` 命令执行后会被包装成：

- `<local-command-stdout>...</local-command-stdout>`
- 或 `<local-command-stderr>...</local-command-stderr>`

因此本地命令结果在 transcript 里是被系统标记过的 command-output block，不是任意自由文本。

## 14. `prompt` 命令的真正执行核心是 `getMessagesForPromptSlashCommand()`

源码镜像：[`../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx`](../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx)

这条链不是直接把 `getPromptForCommand()` 的返回值扔给模型，而是进一步做：

- loading metadata
- hook registration
- compaction-preserved invoked skill recording
- attachment extraction
- `command_permissions` attachment 注入

所以 prompt command 在 Claude Code 里是“结构化消息生成器”，不是字符串模板展开器。

## 15. coordinator mode 下，prompt command 不会加载完整 skill 内容，而会降级成“给主协调器看的 delegation summary”

源码镜像：[`../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx`](../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx), [`../../sources/claude-code/src/tools/AgentTool/runAgent.ts`](../../sources/claude-code/src/tools/AgentTool/runAgent.ts)

在：

- `COORDINATOR_MODE`
- 且当前不是 subagent

的情况下，`getMessagesForPromptSlashCommand()` 不会真正执行 `command.getPromptForCommand()`，而是返回一段 summary，告诉 coordinator：

- 这个 skill 的描述
- 何时该用
- 它会给 worker 额外哪些工具权限
- 应该如何在 Agent prompt 中指示 worker 使用它

这说明 prompt command runtime 不是单一路径，主协调器拿到的是“委派摘要”，worker 才拿完整技能内容。

## 16. 普通 prompt command 执行后，真实落进消息流的是 `metadata + meta content + attachments + command_permissions`

源码镜像：[`../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx`](../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx), [`../../sources/claude-code/src/utils/attachments.ts`](../../sources/claude-code/src/utils/attachments.ts)

标准路径会构造：

- 第一条 user message：command loading metadata
- 第二条 user message：`isMeta: true` 的主 skill 内容
- 由 skill 内容派生出的 attachment messages
- 一个 `command_permissions` attachment

所以模型看到的不是“用户又说了一段普通话”，而是带有强结构语义的命令展开消息包。

## 17. `allowedTools` 不是只存在于 frontmatter；它会被 parse 成真正的 attachment 权限载荷

源码镜像：[`../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx`](../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx), [`../../sources/claude-code/src/utils/permissions/permissionSetup.ts`](../../sources/claude-code/src/utils/permissions/permissionSetup.ts)

执行时会把：

- `command.allowedTools`

喂给：

- `parseToolListFromCLI(...)`

然后生成：

- `createAttachmentMessage({ type: 'command_permissions', allowedTools, model })`

这说明 prompt command 的额外工具权限不是“只给人看的提示”，而是进入模型上下文与权限系统的显式 attachment protocol。

## 18. skill hooks 的注册位置不在 loader，而在真正执行 prompt command 的时刻

源码镜像：[`../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx`](../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx), [`../../sources/claude-code/src/utils/hooks/registerSkillHooks.ts`](../../sources/claude-code/src/utils/hooks/registerSkillHooks.ts)

`command.hooks` 存在时，系统不是在命令加载时注册，而是在真正执行时才：

- 取当前 `sessionId`
- 调 `registerSkillHooks(...)`

同时还会再过一层：

- `!isRestrictedToPluginOnly('hooks') || isSourceAdminTrusted(command.source)`

这说明 hooks 是否生效，取决于执行时的 source trust 和当前策略，而不是命令被发现时就固定。

## 19. `fork` 对 prompt command 来说不是附加选项，而是执行路径级别的分叉

源码镜像：[`../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx`](../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx), [`../../sources/claude-code/src/utils/forkedAgent.ts`](../../sources/claude-code/src/utils/forkedAgent.ts)

当 `command.context === 'fork'` 时，系统不会走 inline expansion，而是直接跳：

- `executeForkedSlashCommand(...)`

这里会：

- 创建 `agentId`
- 组装 forked context
- 合并 skill-specific effort 到 agent definition
- 在后台或当前运行 subagent

所以 forked prompt command 在语义上不是“同一 skill 多个模式”，而是另一条子代理运行时。

## 20. `SkillTool` 并不是独立于 slash runtime 的第二套世界，而是复用 prompt command 主链

源码镜像：[`../../sources/claude-code/src/tools/SkillTool/SkillTool.ts`](../../sources/claude-code/src/tools/SkillTool/SkillTool.ts)

`SkillTool.call()` 在拿到 skill 名后会：

- 找命令对象
- 记录 skill usage
- 若 `context === 'fork'` 则走 `executeForkedSkill(...)`
- 否则直接 `import processSlashCommand` 并调用 `processPromptSlashCommand(...)`

所以模型通过 SkillTool 调用技能时，并没有一套平行的 prompt expansion 逻辑，而是复用了 slash runtime 的 prompt-command path。

## 21. `SkillTool` 和用户 slash command 的差异主要在“谁能调用、怎么列出、怎样做权限建议”

源码镜像：[`../../sources/claude-code/src/tools/SkillTool/prompt.ts`](../../sources/claude-code/src/tools/SkillTool/prompt.ts)

两条链的主要差异是：

- SkillTool 只列 model-invocable prompt commands
- 它会给模型一个受字符预算约束的 skill listing
- validate 阶段会根据 skill 属性是否“只含 safe properties”来 auto-allow 或 ask
- user slash path 会检查 `userInvocable === false` 并拒绝用户直接调用

这说明 slash runtime 和 SkillTool runtime 共用一条执行主链，但前置筛选与权限 UX 是两层不同外壳。

## 22. `formatCommandLoadingMetadata()` 解释了为什么 transcript 里 slash 与 skill 看起来不一样

源码镜像：[`../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx`](../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx), [`../../sources/claude-code/src/constants/xml.ts`](../../sources/claude-code/src/constants/xml.ts)

这层会按两类格式生成 loading metadata：

- 用户可直接调用的命令：`/command-name`
- `userInvocable === false` 的 model-only skill：skill-style metadata

所以 transcript / progress view 的差异，不是前台单独写死，而是 prompt-command runtime 在元数据层就已经分义。

## 23. remote / bridge 安全语义在命令层也有专门裁剪，不是所有 slash command 都能跨宿主执行

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts), [`../../sources/claude-code/src/utils/processUserInput/processUserInput.ts`](../../sources/claude-code/src/utils/processUserInput/processUserInput.ts)

`commands.ts` 明确区分：

- `REMOTE_SAFE_COMMANDS`
- `BRIDGE_SAFE_COMMANDS`
- `isBridgeSafeCommand(cmd)`

语义是：

- `prompt` commands 默认 bridge-safe
- `local` commands 只有显式在 allowlist 才 safe
- `local-jsx` 一律不 safe

这说明命令 runtime 从一开始就把“宿主是否能安全执行”编进协议层，而不是等远端 UI 报错后再兜底。

## 24. 这组 consumer 共同说明：Claude Code 的 prompt command 其实是统一 capability runtime 的中心协议

源码镜像：[`../../sources/claude-code/src/types/command.ts`](../../sources/claude-code/src/types/command.ts), [`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts), [`../../sources/claude-code/src/utils/slashCommandParsing.ts`](../../sources/claude-code/src/utils/slashCommandParsing.ts), [`../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx`](../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx), [`../../sources/claude-code/src/utils/handlePromptSubmit.ts`](../../sources/claude-code/src/utils/handlePromptSubmit.ts), [`../../sources/claude-code/src/tools/SkillTool/prompt.ts`](../../sources/claude-code/src/tools/SkillTool/prompt.ts), [`../../sources/claude-code/src/tools/SkillTool/SkillTool.ts`](../../sources/claude-code/src/tools/SkillTool/SkillTool.ts), [`../../sources/claude-code/src/utils/forkedAgent.ts`](../../sources/claude-code/src/utils/forkedAgent.ts)

这条链把几件看似分散的事情统一起来了：

- slash catalog 里的一条命令
- 模型可调用的一项 skill
- 一个会扩展 meta user message 的 prompt 模板
- 一个会附带额外工具权限和 hooks 的 capability
- 一个可能 fork 成 subagent 的委派入口
- 一个在 remote/bridge/coordinator mode 下需要特殊裁剪的宿主敏感能力

所以 `prompt command` 在 Claude Code 里不是小功能，而是：

- 命令系统
- skills 系统
- 子代理委派
- 权限扩展
- 宿主安全

这些机制汇流后的中心协议。

## 25. 为什么这条链值得单独成卷

如果只看命令目录和 SkillsMenu，会以为 slash commands 与 skills 是两套相邻功能。但这一卷补出来的事实是：

- 用户输入 `/foo`
- 模型通过 SkillTool 请求 `foo`
- `foo` 再决定 inline 还是 fork
- `foo` 再把 hooks / allowedTools / attachments 注入上下文

这些最终都走回同一条 prompt-command runtime。

因此把它单独成卷是必要的。否则文档库会一直停在“命令有哪些”和“技能怎么显示”，却讲不清 Claude Code 最核心的一层：能力是如何被统一编码、加载、筛选、并最终执行的。
