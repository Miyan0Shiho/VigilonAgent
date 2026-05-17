# Command Availability / Sources / Display Contracts

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Workflow Command Sources / Permission Surfaces`](./11-workflow-command-sources-and-permission-surfaces.md) | [`下一站：机制卷`](../mechanisms/01-07.md)

本文继续拆命令系统，但不再讲某个具体业务命令，而是讲 slash command catalog 自身的元协议：命令从哪里来、哪些用户能看见、哪些环境要隐藏、命令名如何显示、描述如何标注来源，以及为什么 `/login` 之后命令目录会变。核心源码是 `commands.ts`、`types/command.ts`、`utils/settings/constants.ts`、`utils/auth.ts`。

## 1. Claude Code 的命令目录不是静态表，而是“静态内建命令 + 动态来源 + 可用性裁剪”三段装配

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts), [`../../sources/claude-code/src/types/command.ts`](../../sources/claude-code/src/types/command.ts)

`commands.ts` 里至少有三层来源：

- 静态 builtin/local/local-jsx commands：`COMMANDS()`
- 动态 command source：skills、plugins、workflows
- 运行时裁剪：`meetsAvailabilityRequirement()` + `isCommandEnabled()`

因此用户在 REPL 里看到的 slash 目录，不是“仓库里有哪些命令文件”的直接反映，而是一个实时装配后的结果。

## 2. `Command` 协议的核心分裂不是业务语义，而是执行宿主：`prompt` / `local` / `local-jsx`

源码镜像：[`../../sources/claude-code/src/types/command.ts`](../../sources/claude-code/src/types/command.ts)

命令协议分成三类：

- `type: 'prompt'`
- `type: 'local'`
- `type: 'local-jsx'`

这三类分别代表：

- prompt command：返回 prompt/content blocks，继续进入模型与 agent loop
- local command：返回本地结果对象，不走 React 前台
- local-jsx command：懒加载一个本地 JSX 流程，直接挂到 REPL UI

所以命令系统从协议层就不是“统一的 slash handler”，而是一个宿主分发器。

## 3. `CommandBase` 里的元字段说明命令目录本身就带着治理语义，而不只是 name/description

源码镜像：[`../../sources/claude-code/src/types/command.ts`](../../sources/claude-code/src/types/command.ts)

`CommandBase` 里几组特别关键的字段是：

- 可见性/可用性：`availability`、`isEnabled`、`isHidden`
- 来源与身份：`loadedFrom`、`isMcp`、`version`
- 展示语义：`aliases`、`argumentHint`、`userFacingName`
- 安全/调度语义：`disableModelInvocation`、`immediate`、`isSensitive`
- 命令族标记：`kind`

这说明一个 command 对象不仅描述“做什么”，还描述：

- 谁能看到
- 在哪显示
- 是否能被模型直接调用
- 输入是否应脱敏
- 是否跳过普通 stop-point 队列

命令协议本身就是一层产品治理 DSL。

## 4. `availability` 与 `isEnabled()` 是两套不同的 gate，前者回答“你有没有资格看见”，后者回答“当前 build 是否打开”

源码镜像：[`../../sources/claude-code/src/types/command.ts`](../../sources/claude-code/src/types/command.ts), [`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts)

注释已经写得很清楚：

- `availability` = auth/provider requirement
- `isEnabled()` = feature flag / platform / env state

`CommandAvailability` 当前只定义两类：

- `claude-ai`
- `console`

也就是说，这套系统先按账号/提供方做资格裁剪，再按 feature gate 或环境判断是否启用。二者不是同义词，也不能互相替代。

## 5. `meetsAvailabilityRequirement()` 说明 provider/auth gating 是每次 `getCommands()` 时重新计算的，不吃 memoized catalog 的旧结果

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/utils/auth.ts)

`loadAllCommands(cwd)` 会 memoize，但 `meetsAvailabilityRequirement(cmd)` 不会。

这是因为它依赖会变化的 auth state：

- `isClaudeAISubscriber()`
- `isUsing3PServices()`
- `isFirstPartyAnthropicBaseUrl()`

所以 `getCommands(cwd)` 的真实流程是：

1. 取 memoized command catalog
2. 每次重新跑 `availability` 检查
3. 每次重新跑 `isCommandEnabled()`

这就是为什么 `/login`、provider 切换或 base URL 变化后，命令目录能立刻变化，而不需要重启进程。

## 6. `console` 资格不是“有 API key 就算”，而是严格指向 direct 1P API 用户

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/utils/auth.ts)

`meetsAvailabilityRequirement()` 对 `console` 的判断非常明确：

- 不是 claude.ai subscriber
- 不是 3P service user
- base URL 必须是 first-party Anthropic

这意味着：

- Bedrock/Vertex/Foundry 用户不会被当成 `console`
- 自定义 gateway/base URL 用户也不会被当成 `console`

因此命令目录里的某些命令不是按“是否有 token”开放，而是按“所处商业/接入形态”开放。

## 7. `COMMANDS()` 里 `...(!isUsing3PServices() ? [logout, login()] : [])` 说明最直观的 provider gate 就发生在 slash 目录本身

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/utils/auth.ts)

`login/logout` 并不是总被注册。只有：

- `!isUsing3PServices()`

时才会进入 builtin command 表。

这说明有些命令甚至不会进入第一层静态目录，而不是等后面再被 availability 过滤掉。也就是说命令 gating 至少有两种形式：

- 生成 catalog 前就不注册
- 注册后再做 availability/isEnabled 过滤

## 8. `INTERNAL_ONLY_COMMANDS` 说明还有第三类 gate：构建/用户类型级的“根本不该出现在外部产品里”的命令簇

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/types/command.ts)

`INTERNAL_ONLY_COMMANDS` 里包括：

- `backfillSessions`
- `bridgeKick`
- `bughunter`
- `ctx_viz`
- `oauthRefresh`
- `debugToolCall`
- `autofixPr`
- `ultraplan` 等

它们只有在：

- `process.env.USER_TYPE === 'ant'`
- `!process.env.IS_DEMO`

时才会被拼进 `COMMANDS()`

所以命令目录至少有三层 gating：

- build / user-type gate
- provider / auth gate
- feature / env enable gate

## 9. `builtInCommandNames` 把 alias 一起进 Set，说明 builtin identity 是“名字空间占用”而不是仅主名占用

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/types/command.ts)

`builtInCommandNames` 不是只收 `_.name`，而是：

- `[_.name, ...(_.aliases ?? [])]`

一起进 Set。

这意味着 builtin command 的身份冲突处理是按完整别名空间来的。别的动态来源如果撞上 builtin alias，也会被看作冲突风险，而不是只看主命令名。

## 10. `loadedFrom` 与 `source` 分属两层：一个回答“命令从哪类目录发现”，一个回答“prompt command 的配置来源”

源码镜像：[`../../sources/claude-code/src/types/command.ts`](../../sources/claude-code/src/utils/settings/constants.ts)

这里很容易混：

- `loadedFrom`: `commands_DEPRECATED | skills | plugin | managed | bundled | mcp`
- `PromptCommand.source`: `SettingSource | builtin | mcp | plugin | bundled`

二者不是同一个字段，也不解决同一个问题：

- `loadedFrom` 更偏 catalog/discovery provenance
- `source` 更偏 prompt/skill 命令在 UI 中应怎样标注来源

这说明 Claude Code 的命令系统把“被谁发现”和“对用户该怎么显示出处”分成了两层元数据。

## 11. `getSettingSourceName()` 决定了很多命令描述里为什么会出现 `user / project / managed / cli flag`

源码镜像：[`../../sources/claude-code/src/utils/settings/constants.ts`](../../sources/claude-code/src/commands.ts)

`getSettingSourceName()` 把 setting source 翻译成用户可读文本：

- `userSettings -> user`
- `projectSettings -> project`
- `localSettings -> project, gitignored`
- `flagSettings -> cli flag`
- `policySettings -> managed`

`formatDescriptionWithSource(cmd)` 在处理普通 prompt command 时，会用这个函数把来源挂到 description 后面。

因此用户在 typeahead/help 里看到的来源标注，不是散落在各个命令里的手写文案，而是命令系统统一格式化出来的。

## 12. `formatDescriptionWithSource()` 说明命令目录的描述不是纯原文复用，而是会按来源类型做统一重写

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/types/command.ts)

它的策略很明确：

- 非 `prompt`：直接返回原 description
- `kind === 'workflow'`：追加 `(workflow)`
- `source === 'plugin'`：优先展示插件名
- `source === 'builtin' || source === 'mcp'`：不追加来源
- `source === 'bundled'`：追加 `(bundled)`
- 其余 setting-source：走 `getSettingSourceName(source)`

这意味着 slash 目录里的描述文本，本质上是一个“来源解释器”的产物，而不是简单的 `cmd.description`。

## 13. `userFacingName()` 说明命令显示名和实际内部 name 可以分离，目录系统默认允许重命名壳层

源码镜像：[`../../sources/claude-code/src/types/command.ts`](../../sources/claude-code/src/commands.ts)

`getCommandName(cmd)` 的实现是：

- `cmd.userFacingName?.() ?? cmd.name`

注释也直接写明：

- 只有 displayed name 与内部 name 不同时才 override

这说明命令目录对“内部稳定标识”和“给用户看的名字”做了明确分离，特别适合：

- plugin prefix stripping
- 面向用户的别名/品牌化展示
- 兼容旧 name 但显示新 name

## 14. `dynamicSkills` 的二次注入说明命令目录在 build 完基础 catalog 后，还会被运行时文件操作反向污染

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/skills/loadSkillsDir.ts)

`getCommands(cwd)` 在拿到 `allCommands` 后，还会：

1. 读取 `getDynamicSkills()`
2. 用 `baseCommandNames` 去重
3. 再次跑 `meetsAvailabilityRequirement()` 和 `isCommandEnabled()`

这说明命令目录不是单向构建的。文件操作、repo 触摸、skill surfacing 这些运行时事件，也会把新的 prompt command 再塞回 catalog。

所以从系统结构上看，command catalog 不是静态注册表，而是“静态装配 + 动态回灌”的混合体。

## 15. 这条链补上的，是命令系统的“谁能看见什么”层，而不是某个业务命令的实现层

这篇最重要的收获不是又多了一个命令，而是把此前命令卷里隐含但没拆开的元协议单独讲清楚了：

- command catalog 怎样构建
- auth/provider 怎样影响目录
- source/loadedFrom 怎样影响展示
- builtin/internal/3P/feature gate 怎样叠加
- 为什么同一份代码在不同用户、不同 provider、不同登录状态下看到的 slash 目录会不同

如果不把这层独立出来，后面很多业务命令卷册都会把“命令为什么能出现/不能出现”误写成各自的局部逻辑。

## 交叉参考

- 命令注册与分发总述：[`./01-command-registry-and-dispatch.md`](./01-command-registry-and-dispatch.md)
- workflow 命令来源与权限表面：[`./11-workflow-command-sources-and-permission-surfaces.md`](./11-workflow-command-sources-and-permission-surfaces.md)
- 工作区 / 配置 / 权限治理 UI：[`../architecture/09-settings-config-and-permission-rules.md`](../architecture/09-settings-config-and-permission-rules.md)
- 命令目录在输入 UI 里的消费：[`../architecture/07-prompt-input-and-search-ui.md`](../architecture/07-prompt-input-and-search-ui.md)
