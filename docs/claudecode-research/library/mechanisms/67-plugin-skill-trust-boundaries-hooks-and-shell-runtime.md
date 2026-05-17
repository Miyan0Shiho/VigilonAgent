# Plugin Skill Trust Boundaries / Hooks / Shell Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Bundled Skill File Extraction / Base Dir / Memory Review Runtime`](./66-bundled-skill-file-extraction-base-dir-and-memory-review-runtime.md) | [`下一站：AskUserQuestion Schema / Preview / Operator Loop Runtime`](./68-ask-user-question-schema-preview-and-operator-loop-runtime.md)

`66` 已经把 bundled/disk/plugin skill 共用的 `Base directory for this skill` 契约拆开了，但这三类 skill 在真正运行时并不完全对等。尤其是 plugin skill，还多了三层只有它才有的东西：

- plugin root / plugin data / userConfig 变量注入
- `strictPluginOnlyCustomization` 下的 admin-trusted 信任边界
- 仍允许 prompt-time shell execution，但要服从 plugin-sourced trust model

这一卷只讲这些“plugin skill 相比普通 skill 多出来的运行时语义”。

## 1. plugin skill 的命令对象虽然长得像普通 skill，但 source/loadedFrom 明确不同

源码镜像：[`../../src/utils/plugins/loadPluginCommands.ts`](../../src/utils/plugins/loadPluginCommands.ts)

plugin markdown 被编译成 `Command` 时，会明确写成：

- `source: 'plugin'`
- `loadedFrom: isSkill || config.isSkillMode ? 'plugin' : undefined`

这和 disk skill 的：

- `source: userSettings/projectSettings/...`
- `loadedFrom: 'skills'`

是不同的。因此后面所有关于 policy、hooks、trust boundary 的 gate，都可以靠这两个字段分流。

## 2. plugin skill 仍复用 `Base directory for this skill`，但它的目录语义是“插件子树中的 skill 子目录”

源码镜像：[`../../src/utils/plugins/loadPluginCommands.ts`](../../src/utils/plugins/loadPluginCommands.ts)

当 `config.isSkillMode` 时，plugin skill 会在 prompt 前补：

- `Base directory for this skill: ${dirname(file.filePath)}`

这不是整个 plugin root，而是这个具体 skill 所在的子目录。注释也写得很清楚：

- 一个 plugin 可以包含多个 skills
- `CLAUDE_PLUGIN_ROOT` 指向插件根
- `CLAUDE_SKILL_DIR` 指向单个 skill 子目录

所以 plugin skill 的文件寻址模型是“双根”的，而不是普通 disk skill 那种单根。

## 3. plugin skill 比普通 skill 多了一组插件级变量注入

源码镜像：[`../../src/utils/plugins/loadPluginCommands.ts`](../../src/utils/plugins/loadPluginCommands.ts), [`../../src/utils/plugins/pluginOptionsStorage.ts`](../../src/utils/plugins/pluginOptionsStorage.ts)

在参数替换之后，plugin command loader 还会做：

- `substitutePluginVariables(finalContent, { path: pluginPath, source: sourceName })`

这至少会给 prompt 引入两类 plugin-only 路径语义：

- `CLAUDE_PLUGIN_ROOT`
- plugin data 路径相关变量

也就是说，plugin skill 拿到的不只是“skill 自己的目录”，而是“整个插件运行环境”的文件坐标系。

## 4. `userConfig` 替换说明 plugin skill 还能把已保存配置值注入 prompt，但会主动屏蔽 secret

源码镜像：[`../../src/utils/plugins/loadPluginCommands.ts`](../../src/utils/plugins/pluginOptionsStorage.ts)

如果 `pluginManifest.userConfig` 存在，plugin skill 还会走：

- `loadPluginOptions(sourceName)`
- `substituteUserConfigInContent(...)`

但注释里强调了一个非常关键的边界：

- sensitive keys 会变成 descriptive placeholder
- 不会把 secrets 直接注入模型 prompt

这意味着 plugin skill 能消费 plugin 的持久化用户配置，但这条能力被明确做成了“可见配置值进入 prompt，敏感值止步于 secure storage”的半开放模型。

## 5. plugin option 存储本身就是双层的，这直接影响 plugin skill 看到什么

源码镜像：[`../../src/utils/plugins/pluginOptionsStorage.ts`](../../src/utils/plugins/pluginOptionsStorage.ts)

`loadPluginOptions()` 会合并：

- 非敏感项：`settings.pluginConfigs[pluginId].options`
- 敏感项：`secureStorage.pluginSecrets[pluginId]`

但 `substituteUserConfigInContent(...)` 在 prompt 层会再做筛选，因此 plugin skill 实际看到的是：

- 同一份 schema 管理下的统一配置视图
- 但对敏感项只保留说明性占位

这和普通 disk skill 完全不同，后者没有一套 plugin-scoped persisted option plane 可用。

## 6. plugin skill 也会执行 inline shell，但它走的是 plugin-scoped 变量和 skill-scoped 允许列表

源码镜像：[`../../src/utils/plugins/loadPluginCommands.ts`](../../src/utils/promptShellExecution.ts)

plugin skill 在完成：

- argument substitution
- plugin variable substitution
- userConfig substitution
- `CLAUDE_SKILL_DIR` 替换
- `CLAUDE_SESSION_ID` 替换

之后，仍然会进入：

- `executeShellCommandsInPrompt(...)`

而且和 disk skill 一样，会把：

- `toolPermissionContext.alwaysAllowRules.command = allowedTools`

临时塞进局部 `getAppState()`。说明 plugin skill 的 inline shell 不是旁路能力，而是沿用同一条 “frontmatter `allowed-tools` 控制 prompt-time shell execution” 的机制。

## 7. 但 plugin skill 的 shell 前置上下文比普通 skill 更强，因为它已经先拿到了 plugin root 和配置视图

源码镜像：[`../../src/utils/plugins/loadPluginCommands.ts`](../../src/utils/promptShellExecution.ts)

disk skill 进入 shell execution 前，通常只有：

- `Base directory for this skill`
- `CLAUDE_SKILL_DIR`
- `CLAUDE_SESSION_ID`

plugin skill 额外还有：

- plugin root / data dir
- userConfig placeholder-substituted config values

所以同样是 `!\`...\``，plugin skill 的 shell snippet 能调用的上下文其实更富，因此也更需要后面的 trust gate。

## 8. `strictPluginOnlyCustomization` 不是在 loader 里把 plugin skill 关掉，而是在别的 surface 上把非 admin-trusted source 挡掉

源码镜像：[`../../src/utils/settings/pluginOnlyPolicy.ts`](../../src/utils/processUserInput/processSlashCommand.tsx), [`../../src/skills/loadSkillsDir.ts`](../../src/skills/loadSkillsDir.ts)

`isRestrictedToPluginOnly(surface)` 的注释写得很明确：

- 锁住的是 user/project/local 等用户控制来源
- plugin / policySettings / built-in / bundled 视为 admin-trusted

因此 plugin skill 在 `strictPluginOnlyCustomization` 语义下不是“被额外限制”，而是“成为被保留的一侧”。这解释了为什么 enterprise/policy 模式下，plugin skill 反而是更优先的 customization source。

## 9. `isSourceAdminTrusted('plugin')` 是 plugin skill hooks 能穿透 `pluginOnly` 锁的核心依据

源码镜像：[`../../src/utils/settings/pluginOnlyPolicy.ts`](../../src/utils/processUserInput/processSlashCommand.tsx)

`ADMIN_TRUSTED_SOURCES` 明确包含：

- `plugin`
- `policySettings`
- `built-in`
- `builtin`
- `bundled`

随后 `processSlashCommand.tsx` 会在真正 skill invocation 时判断：

- `!isRestrictedToPluginOnly('hooks') || isSourceAdminTrusted(command.source)`

也就是说，哪怕 user/project skills 仍然能被加载并执行，只要 hooks surface 被锁成 plugin-only，只有 plugin/bundled/policy/builtin 这些 admin-trusted source 的 hooks 才能真正注册。

## 10. 这让 plugin skill 比普通 disk skill 多了一层“执行可见、hook 可能被阉割”的 source-sensitive 行为

源码镜像：[`../../src/utils/processUserInput/processSlashCommand.tsx`](../../src/utils/settings/pluginOnlyPolicy.ts)

在 `strictPluginOnlyCustomization(['hooks'])` 这种配置下：

- 普通 user/project skill 仍可能运行 prompt 内容
- 但其 `command.hooks` 不会被 `registerSkillHooks(...)`

plugin skill 则因为 `source === 'plugin'` 会穿过这层 gate。结果就是：

- prompt surface 可能看起来相似
- 真正的 hook side effects 只保留 admin-trusted skill

这是一条很关键的 trust boundary。

## 11. plugin skill 没有 MCP 那样的 shell 禁令，这说明 Claude Code 把 plugin marketplace 当作“受治理的本地资产”

源码镜像：[`../../src/skills/loadSkillsDir.ts`](../../src/utils/plugins/loadPluginCommands.ts)

disk skill 侧有：

- `if (loadedFrom !== 'mcp') { executeShellCommandsInPrompt(...) }`

plugin loader 则没有对应的 “if plugin then deny shell” 分支，而是直接执行 shell injection。说明 Claude Code 的信任模型是：

- MCP skill：remote/untrusted，shell 全禁
- plugin skill：可治理、可安装、可 allowlist 的本地资产，允许 shell，但通过 marketplace/policy/source gate 约束

这和 `strictKnownMarketplaces`、plugin policy、admin-trusted source 一起，构成了 plugin skill 的整体安全故事。

## 12. plugin skill 的命名空间也更复杂，这会反过来影响 discoverability 和 skill-dir 语义

源码镜像：[`../../src/utils/plugins/loadPluginCommands.ts`](../../src/utils/suggestions/commandSuggestions.ts)

plugin skill 的名字来自：

- `pluginName`
- plugin 内部相对目录 namespace
- skill 目录名

最终长成：

- `plugin:namespace:skill`

因此 plugin skill 的 discoverability 和运行时寻址，天然带着 source namespace，不像 repo skill 通常只是 `/skill-name`。这也解释了为什么 plugin skill 更需要 `userFacingName()` 和 plugin metadata surface 来做消歧。

## 13. 这篇和 `66`、`42`、`40` 的边界

[`./66-bundled-skill-file-extraction-base-dir-and-memory-review-runtime.md`](./66-bundled-skill-file-extraction-base-dir-and-memory-review-runtime.md) 讲的是：

- bundled/disk/plugin skill 共同的 base-dir 和文件抽取契约

这一篇讲的是：

- plugin skill 相比其他 skill 多出来的变量注入、userConfig、trust gate、hook gate、shell 信任边界

[`./42-policy-settings-governance-across-command-discovery-marketplaces-and-recommendation-surfaces.md`](./42-policy-settings-governance-across-command-discovery-marketplaces-and-recommendation-surfaces.md) 讲 marketplace/policy/discovery；[`./40-policy-settings-runtime-governance-across-env-hooks-permissions-mcp-and-plugins.md`](./40-policy-settings-runtime-governance-across-env-hooks-permissions-mcp-and-plugins.md) 讲 plugin policy 的更广治理面。本篇只抓 plugin skill 自己的执行运行时。

## 14. 一句话结论

plugin skill 在 Claude Code 里不是“普通 skill 换个来源标签”这么简单。它实际多了：

- plugin root / data / userConfig 注入
- 受 marketplace 与 admin-trusted source 管控的信任边界
- 在 plugin-only hook policy 下仍能保留 hooks 的特权地位
- 以及比 disk skill 更丰富、因此也更需要治理的 prompt-time shell execution 环境

这也是为什么 plugin skill 应该被当成独立功能族看，而不是塞进一般 skills 总述里。
