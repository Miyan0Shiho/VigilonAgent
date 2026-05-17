# Dynamic Skills / Model-Only Skills / Host-Safe Command Gates

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Prompt Command Loading / Selection / Execution Runtime`](./43-prompt-command-loading-selection-and-execution-runtime.md) | [`下一站：Agent Definitions / Selection / Spawn / Handoff Runtime`](./51-agent-definitions-selection-spawn-and-handoff-runtime.md)

前一卷已经把 `prompt command` 当成统一 capability runtime 拆开了。这一卷继续往下钻一层，不再讲“命令怎么执行”，而是讲：

- 技能什么时候会出现在命令表里
- 哪些技能只允许模型调用，哪些允许用户手敲 `/skill`
- dynamic skills / conditional skills 怎样被激活并怎样清缓存
- remote mode 和 bridge mode 怎样裁掉不安全命令
- `system/init`、SkillTool、REPL、CCR viewer 为什么看到的命令面并不完全一样

对应源码主链是：`skills/loadSkillsDir.ts + commands.ts + utils/processUserInput/processSlashCommand.tsx + utils/processUserInput/processUserInput.ts + hooks/useReplBridge.tsx + utils/messages/systemInit.ts + hooks/useSkillsChange.ts + utils/skills/skillChangeDetector.ts + main.tsx + screens/REPL.tsx`。

## 1. 技能 frontmatter 在进入运行时之前，就已经决定了三种不同“可见性”

源码镜像：[`../../sources/claude-code/src/skills/loadSkillsDir.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts), [`../../sources/claude-code/src/types/command.ts`](../../sources/claude-code/src/types/command.ts)

`parseSkillFrontmatterFields()` 和 `createSkillCommand()` 共同决定的，不只是 skill 内容本身，还包括：

- `disableModelInvocation`
- `userInvocable`
- `paths`
- `context`
- `hooks`
- `allowedTools`

它们分别对应三种不同表面：

- 模型能不能通过 SkillTool 调它
- 用户能不能直接输入 `/skill-name`
- 它是否需要等到某些文件路径被碰到之后才进入动态命令表

所以一个 skill 并不是“加载即全局可用”，而是被 frontmatter 切成多层 gate。

## 2. `userInvocable` 控制的是“用户入口”，不是 skill 是否存在

源码镜像：[`../../sources/claude-code/src/skills/loadSkillsDir.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts), [`../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx`](../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx)

`createSkillCommand()` 会把：

- `isHidden: !userInvocable`

直接写进 command 对象。

但真正的硬 gate 在 `getMessagesForSlashCommand()`：

- `command.userInvocable !== false` 时才记录用户 skill usage
- `command.userInvocable === false` 时直接返回一段“只能由 Claude 调用”的拒绝消息

这说明 model-only skill 不是“看不见所以调不到”，而是：

- 命令对象依然存在
- SkillTool 仍然可能使用它
- 只是用户 slash path 会被显式拒绝

## 3. `disableModelInvocation` 控制的是“模型入口”，不是用户 slash 能力

源码镜像：[`../../sources/claude-code/src/skills/loadSkillsDir.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts), [`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts)

`disableModelInvocation` 进入 command 对象后，主要影响的是两个投影：

- `getSkillToolCommands()`
- `getMcpSkillCommands()`

这两个入口都会过滤掉：

- `disableModelInvocation === true`

但它不会自动阻止用户手敲 `/skill`。如果某个 skill：

- `userInvocable: true`
- `disableModelInvocation: true`

那么它仍然是用户可见 skill，只是模型不会在 SkillTool 的能力列表里看到它。

所以 `userInvocable` 和 `disableModelInvocation` 是两根正交轴，不是一根开关。

## 4. dynamic skills 不是全量重扫命令树，而是会话内增量插片

源码镜像：[`../../sources/claude-code/src/skills/loadSkillsDir.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts), [`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts)

`loadSkillsDir.ts` 里维护了三组状态：

- `dynamicSkillDirs`
- `dynamicSkills`
- `conditionalSkills`

`discoverSkillDirsForPaths()` 的策略是：

- 从文件路径的父目录往上走
- 只走到 `cwd` 之下，不包含 `cwd`
- 命中 `.claude/skills` 才加入候选
- gitignored 目录直接跳过

`addSkillDirectories()` 则把这些目录里的 skills 载入 `dynamicSkills`，最后通过 `skillsLoaded.emit()` 通知外界。

这说明 dynamic skills 的目标不是“重新生成全世界 skill 表”，而是：

- 文件操作触发
- 会话内发现
- 增量并入现有命令表

## 5. conditional skills 不是 discovery 的别名，而是另一条延迟激活链

源码镜像：[`../../sources/claude-code/src/skills/loadSkillsDir.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts)

带 `paths` frontmatter 的 skill 不会直接进 `dynamicSkills`，而是先留在：

- `conditionalSkills`

直到 `activateConditionalSkillsForPaths(filePaths, cwd)` 发现当前文件路径匹配了 gitignore-style pattern，才会：

- `dynamicSkills.set(name, skill)`
- `conditionalSkills.delete(name)`
- `activatedConditionalSkillNames.add(name)`
- `skillsLoaded.emit()`

这说明 `paths` 技能不是“仅用于搜索提示”，而是一个真正的 lazy activation runtime。

## 6. 命令缓存和技能缓存被故意拆成两层，不然动态技能会把自己清掉

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts), [`../../sources/claude-code/src/utils/skills/skillChangeDetector.ts`](../../sources/claude-code/src/utils/skills/skillChangeDetector.ts), [`../../sources/claude-code/src/hooks/useSkillsChange.ts`](../../sources/claude-code/src/hooks/useSkillsChange.ts)

这里有两种清缓存：

- `clearCommandMemoizationCaches()`
- `clearCommandsCache()`

区别是：

- 前者只清 `loadAllCommands/getSkillToolCommands/getSlashCommandToolSkills` 等 memo 层
- 后者还会继续清 plugin command cache、plugin skills cache、skill caches

`skillChangeDetector` 对 `onDynamicSkillsLoaded()` 的回调明确只用：

- `clearCommandMemoizationCaches()`

因为如果用 `clearCommandsCache()`，就会把刚放进 `dynamicSkills` 的那批技能一起擦掉。

这说明动态技能的缓存策略不是普通“文件改了就全清”，而是刻意避免自毁的两层失效协议。

## 7. `useSkillsChange()` 说明“命令表刷新”有两个触发源，不只是技能文件改动

源码镜像：[`../../sources/claude-code/src/hooks/useSkillsChange.ts`](../../sources/claude-code/src/hooks/useSkillsChange.ts), [`../../sources/claude-code/src/utils/skills/skillChangeDetector.ts`](../../sources/claude-code/src/utils/skills/skillChangeDetector.ts)

`useSkillsChange()` 监听两类变化：

- `skillChangeDetector.subscribe(handleChange)`：磁盘上的技能文件变化
- `onGrowthBookRefresh(handleGrowthBookRefresh)`：feature gate 刷新

前者会：

- `clearCommandsCache()`
- 重新 `getCommands(cwd)`

后者只会：

- `clearCommandMemoizationCaches()`
- 再次 `getCommands(cwd)`

原因很明确：

- 技能文件改了，要重新读盘
- 但 GrowthBook 刷新只会影响 `isEnabled()` 这类运行时 gate，不需要重扫技能文件

所以 command visibility 不是纯静态内容，也受远端 feature refresh 影响。

## 8. `getSkillToolCommands()`、`getSlashCommandToolSkills()`、`buildSystemInitMessage()` 看的不是同一张命令脸

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts), [`../../sources/claude-code/src/tools/SkillTool/prompt.ts`](../../sources/claude-code/src/tools/SkillTool/prompt.ts), [`../../sources/claude-code/src/utils/messages/systemInit.ts`](../../sources/claude-code/src/utils/messages/systemInit.ts)

三条投影链分别是：

- `getSkillToolCommands()`：给模型看的 prompt-capability 列表
- `getSlashCommandToolSkills()`：给 bridge / REPL system-init / 技能目录类表面看的 skill 投影
- `buildSystemInitMessage()`：给 remote client 的 `slash_commands` 和 `skills` 列表

它们的筛选规则不一样：

- SkillTool 过滤 `disableModelInvocation`
- system/init 过滤 `userInvocable === false`
- slash skill 投影更偏 skill-like source 与描述完备度

这就是为什么：

- 某个 skill 可能出现在 SkillTool prompt 里，但不出现在用户 slash 列表
- 也可能被远端 client 隐掉，但模型内部仍然可以调用

## 9. subagent turn-0 的技能面还会再被缩一层，只留 bundled + MCP

源码镜像：[`../../sources/claude-code/src/utils/attachments.ts`](../../sources/claude-code/src/utils/attachments.ts), [`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts)

`getSkillListingAttachments()` 在 `EXPERIMENTAL_SKILL_SEARCH` 打开时，不会把全量 `getSkillToolCommands()` 都塞给 agent，而会走：

- `filterToBundledAndMcp()`

规则是：

- 优先保留 `loadedFrom === 'bundled' || 'mcp'`
- 如果仍超预算，再退化成 bundled-only

这说明子代理的技能面不是“主线程看到啥它就看到啥”，而是：

- turn-0 强预算
- 只保留高信号、低体积、强意图来源
- 其余 user/project/plugin skills 留给后续 discovery

## 10. remote mode 的命令裁剪是静态白名单，不靠运行时报错兜底

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts), [`../../sources/claude-code/src/main.tsx`](../../sources/claude-code/src/main.tsx), [`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx)

`commands.ts` 维护了：

- `REMOTE_SAFE_COMMANDS`
- `filterCommandsForRemoteMode(commands)`

`main.tsx` 在 `--remote` 和 assistant-session attach 路径里，会先把：

- `const remoteCommands = filterCommandsForRemoteMode(commands)`

再把这组命令交给 REPL。

随后 `REPL.tsx` 在收到远端 `system/init` 时，又会根据：

- `remoteSlashCommands`
- 本地 `REMOTE_SAFE_COMMANDS`

再二次过滤一次 `localCommands`。

这说明 remote mode 不是单次裁剪，而是：

- 启动前先按本地保守白名单裁一刀
- 连接后再按远端 session 的真实能力表细裁一刀

## 11. bridge mode 的 gate 更细，因为它允许一部分 slash 指令穿透本地 REPL

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts), [`../../sources/claude-code/src/utils/processUserInput/processUserInput.ts`](../../sources/claude-code/src/utils/processUserInput/processUserInput.ts), [`../../sources/claude-code/src/hooks/useReplBridge.tsx`](../../sources/claude-code/src/hooks/useReplBridge.tsx), [`../../sources/claude-code/src/utils/messages/systemInit.ts`](../../sources/claude-code/src/utils/messages/systemInit.ts)

bridge 侧有三层筛选：

- `isBridgeSafeCommand(cmd)`
- `useReplBridge()` 发给远端 client 的 `system/init`
- `processUserInput()` 收到 inbound slash 时的 override

`isBridgeSafeCommand()` 的规则是：

- `local-jsx` 永远不 safe
- `prompt` 默认 safe
- `local` 只有进 `BRIDGE_SAFE_COMMANDS` allowlist 才 safe

`useReplBridge()` 在发 `system/init` 时还会主动做：

- `commands: commandsRef.current.filter(isBridgeSafeCommand)`

也就是说 mobile/web 根本不会被告知那些本地 UI 型 slash commands 的存在。

## 12. bridge inbound slash 的 `skipSlashCommands` 并不真的跳过 slash，只是先走一层宿主安全仲裁

源码镜像：[`../../sources/claude-code/src/utils/processUserInput/processUserInput.ts`](../../sources/claude-code/src/utils/processUserInput/processUserInput.ts), [`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts)

bridge 注入消息时会保留：

- `skipSlashCommands: true`
- `bridgeOrigin: true`

但 `processUserInput()` 看见：

- `bridgeOrigin`
- 输入以 `/` 开头

就会自己再 parse 一次命令名，然后：

- 如果 `isBridgeSafeCommand(cmd)` 为真，清掉 `effectiveSkipSlash`
- 如果命令已知但不安全，直接返回一条 `<local-command-stdout>` 说明
- 如果命令未知，就退回普通文本

这说明 `skipSlashCommands` 在 bridge 里不是绝对禁用，而是“默认禁，白名单复活”。

## 13. `system/init` 还会继续过滤 `userInvocable === false`，所以 model-only skills 不会泄露到远端 pickers

源码镜像：[`../../sources/claude-code/src/utils/messages/systemInit.ts`](../../sources/claude-code/src/utils/messages/systemInit.ts), [`../../sources/claude-code/src/hooks/useReplBridge.tsx`](../../sources/claude-code/src/hooks/useReplBridge.tsx)

`buildSystemInitMessage()` 组装：

- `slash_commands`
- `skills`

时都显式做了：

- `.filter(c => c.userInvocable !== false)`

所以即便某个 model-only skill 已经存在于本地命令表里、也可能被 SkillTool 调用，它仍然不会出现在：

- remote client 的 slash picker
- remote client 的 skills 列表

这条策略把“模型内部能力”与“用户远端可见能力”明确切开了。

## 14. `command_permissions` 这类 attachment 在 transcript 里故意不渲染，避免把运行时 gate 误显示成用户消息

源码镜像：[`../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx`](../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx), [`../../sources/claude-code/src/components/messages/AttachmentMessage.tsx`](../../sources/claude-code/src/components/messages/AttachmentMessage.tsx)

`getMessagesForPromptSlashCommand()` 会把 skill 的额外工具权限装进：

- `createAttachmentMessage({ type: 'command_permissions', ... })`

但 `AttachmentMessage.tsx` 对 `command_permissions` 的渲染是：

- `return null`

原因很直接：

- SkillTool 自己已经负责成功消息
- 这类 attachment 主要是运行时语义，不该再被前台重复翻译成自然语言泡泡

所以“命令权限已注入”是真实发生的，但它被刻意保持为内部 attachment 协议，而不是 transcript 噪音。

## 15. 这一整组 gate 共同说明：Claude Code 的 skill/command 面从来不是单一真相源

源码镜像：[`../../sources/claude-code/src/skills/loadSkillsDir.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts), [`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts), [`../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx`](../../sources/claude-code/src/utils/processUserInput/processSlashCommand.tsx), [`../../sources/claude-code/src/utils/processUserInput/processUserInput.ts`](../../sources/claude-code/src/utils/processUserInput/processUserInput.ts), [`../../sources/claude-code/src/hooks/useReplBridge.tsx`](../../sources/claude-code/src/hooks/useReplBridge.tsx), [`../../sources/claude-code/src/utils/messages/systemInit.ts`](../../sources/claude-code/src/utils/messages/systemInit.ts), [`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx), [`../../sources/claude-code/src/main.tsx`](../../sources/claude-code/src/main.tsx)

同一个 skill/command 会同时经过：

- 发现层：静态加载、dynamic discovery、conditional activation
- 投影层：SkillTool、slash catalog、system/init、subagent skill listing
- 宿主层：local REPL、remote mode、bridge mode
- 入口层：用户可调、模型可调、仅 worker 可调

所以如果只看某一个表面，比如：

- `Slash commands` 菜单
- SkillTool prompt
- remote client 的 picker

都会误以为“系统只有这一组技能”。真实情况是 Claude Code 一直在做：

- source-aware 装配
- budget-aware 投影
- host-aware 裁剪
- user/model 分流

这就是为什么这块必须独立成卷，而不能只塞在 `commands.ts` 或 `skills` 总述里。
