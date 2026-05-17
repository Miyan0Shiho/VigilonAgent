# Policy Settings Governance Across Command Discovery / Marketplaces / Recommendation Surfaces

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Policy Settings Governance Across Agents / Skills / Output Styles / Tips`](./41-policy-settings-governance-across-agents-skills-output-styles-and-tips.md) | [`下一站：Prompt Command Loading / Selection / Execution Runtime`](./43-prompt-command-loading-selection-and-execution-runtime.md)

上一卷补的是 `policySettings` 怎样渗透到 agents、skills、output styles、tips。这一卷继续补它在命令发现、插件市场、安装推荐这些更靠 operator surface 的 consumer 上的治理链，重点是：

- managed prompt commands 怎样进入 slash catalog，而不是只存在于配置文件里
- marketplace allowlist / blocklist / trust message 怎样真正改写插件市场加载与错误语义
- policy-blocked plugins 怎样从 Discover/Manage surface 被裁掉
- LSP / `<claude-code-hint />` 这两条推荐安装链怎样经过统一 gate，再落到 user-scope install

对应源码主链是：`utils/suggestions/commandSuggestions.ts + utils/plugins/marketplaceHelpers.ts + utils/plugins/pluginPolicy.ts + commands/plugin/DiscoverPlugins.tsx + commands/plugin/ManagePlugins.tsx + commands/plugin/PluginSettings.tsx + commands/plugin/PluginErrors.tsx + hooks/usePluginRecommendationBase.tsx + hooks/useLspPluginRecommendation.tsx + hooks/useClaudeCodeHintRecommendation.tsx`。

## 1. managed prompt commands 不是“配置里的一行字符串”，而是 slash catalog 的正式 source 组

源码镜像：[`../../src/utils/suggestions/commandSuggestions.ts`](../../src/utils/suggestions/commandSuggestions.ts)

`commandSuggestions.ts` 在给可见命令分组时，不只区分：

- built-in
- user
- project

还显式拆了：

- `policyCommands`

而且判定条件就是：

- `cmd.type === 'prompt'`
- `cmd.source === 'policySettings'`

这意味着 managed prompt commands 在运行时不是被 merge 成普通 prompt command，而是以独立 source 层进入 slash catalog。

## 2. 这条分组链说明 `policySettings` 已经进入“命令发现”而不只是“命令执行”

源码镜像：[`../../src/utils/suggestions/commandSuggestions.ts`](../../src/utils/suggestions/commandSuggestions.ts)

`policyCommands` 会被：

- 单独收集
- 单独按名字排序
- 与 built-in / user / project 分组一起装回 suggestion list

所以 `policySettings` 在命令面上的作用不只是“执行时多了几条命令”，而是直接改写 slash menu 的 discoverability 结构。

## 3. marketplace policy 的真实入口不是某个 UI 组件，而是 `marketplaceHelpers` 里的 source policy contract

源码镜像：[`../../src/utils/plugins/marketplaceHelpers.ts`](../../src/utils/plugins/marketplaceHelpers.ts)

这组 helper 明确暴露了三条 managed contract：

- `getStrictKnownMarketplaces()`
- `getBlockedMarketplaces()`
- `getPluginTrustMessage()`

它们都直接从 `getSettingsForSource('policySettings')` 取值，说明 marketplace allowlist、blocklist、trust 文案的 authoritative source 都是 managed settings。

## 4. `loadMarketplacesWithGracefulDegradation()` 会在真正加载前先做 policy 裁剪

源码镜像：[`../../src/utils/plugins/marketplaceHelpers.ts`](../../src/utils/plugins/marketplaceHelpers.ts)

`loadMarketplacesWithGracefulDegradation()` 的主循环不是盲目遍历全部 marketplace config。它先做：

- `isSourceAllowedByPolicy(marketplaceConfig.source)`

不通过就直接 `continue`。

这说明 enterprise marketplace policy 的真实语义是：

- 被 block 的 source 连失败都不会按普通 marketplace failure 继续装载
- 它们在数据平面一开始就被裁掉

也就是说，policy 不是 UI 层“把按钮灰掉”，而是 marketplace loader 的前置输入过滤器。

## 5. allowlist / blocklist 是两层约束，不是一组简单字符串

源码镜像：[`../../src/utils/plugins/marketplaceHelpers.ts`](../../src/utils/plugins/marketplaceHelpers.ts)

helper 注释已经把优先级写得很清楚：

1. `blockedMarketplaces`
2. `strictKnownMarketplaces`

因此语义是：

- 先看 blocklist，命中就直接封禁
- 再看 allowlist，存在时 source 必须命中其中某条 pattern

这解释了为什么 plugin marketplace policy 既能做“只允许这几类源”，也能做“即使在 allowlist 里，某条源仍然强制禁用”。

## 6. `PluginErrors` 把 marketplace policy failure 单独编进错误分类，而不是复用 generic load error

源码镜像：[`../../src/commands/plugin/PluginErrors.tsx`](../../src/commands/plugin/PluginErrors.tsx)

`marketplace-blocked-by-policy` 在错误格式化里有两种专门文案：

- `blocked by enterprise policy`
- `not in the allowed marketplace list`

在 guidance 里也继续分岔：

- 如果是 blocklist 命中，提示“this marketplace source is explicitly blocked”
- 如果是 allowlist 不匹配，提示 allowed sources 或联系管理员

所以 policy 不只是改变能不能加载 marketplace，还会改写 operator 能看到的失败解释模型。

## 7. `PluginSettings` 会把 policy-owned marketplace 和 user/project/local marketplace 区分成不同可操作性

源码镜像：[`../../src/commands/plugin/PluginSettings.tsx`](../../src/commands/plugin/PluginSettings.tsx)

`getExtraMarketplaceSourceInfo()` 会返回两类信息：

- `editableSources`
- `isInPolicy`

后续 `buildMarketplaceAction()` 再据此分流：

- editable source 存在：允许删 `extraKnownMarketplaces`
- 只有 policy source：动作变成 `managed-only`
- 都不是：跳到 `ManageMarketplaces`

这说明同样是“有问题的 marketplace”，UI 不会给统一按钮，而是按 managed ownership 区分“可自修”与“只能联系管理员”。

## 8. `ErrorsTabContent` 也把 policy marketplace 当成单独的 operator row 语义

源码镜像：[`../../src/commands/plugin/PluginSettings.tsx`](../../src/commands/plugin/PluginSettings.tsx)

`ErrorsTabContent` 在拼 errors 时会显式把：

- `marketplace-not-found`
- `marketplace-load-failed`
- `marketplace-blocked-by-policy`

并入 marketplace error 支路。

而且对 `managed-only` action 还会补：

- `Managed by your organization — contact your admin`

这说明 policy failure 在 `/plugin` 的错误面板里是 first-class operator surface，不是埋在 log 里的底层异常。

## 9. `DiscoverPlugins` 不只受 marketplace policy 影响，还会再经过 plugin-level policy 过滤

源码镜像：[`../../src/commands/plugin/DiscoverPlugins.tsx`](../../src/utils/plugins/pluginPolicy.ts)

`DiscoverPlugins` 在收集完所有 marketplace plugins 之后，不是只过滤：

- 已安装插件

还会过滤：

- `isPluginBlockedByPolicy(p.pluginId)`

这意味着即使 marketplace source 本身允许，某个具体 plugin 仍可被 org policy force-disable，并在 Discover surface 直接消失。

## 10. 这条 plugin-level gate 的真相源是 `policySettings.enabledPlugins[pluginId] === false`

源码镜像：[`../../src/utils/plugins/pluginPolicy.ts`](../../src/utils/plugins/pluginPolicy.ts)

`isPluginBlockedByPolicy()` 不是看安装 scope，也不是看本地缓存，而是直接查：

- `getSettingsForSource('policySettings')?.enabledPlugins`

然后把：

- `pluginId: false`

解释成 force-disabled。

所以插件治理真正的 authoritative source 仍然是 managed settings，不是插件命令自己的本地状态。

## 11. `ManagePlugins` 会把这类 force-disabled plugin 从已装插件管理面直接剔除

源码镜像：[`../../src/commands/plugin/ManagePlugins.tsx`](../../src/utils/plugins/pluginPolicy.ts)

`filterManagedDisabledPlugins()` 的注释已经写明：

- 这是在过滤被 org policy force-disabled 的插件

而它调用的仍然是 `isPluginBlockedByPolicy()`。

结果就是：

- Discover surface 不会展示这些 plugin
- Manage surface 也不会把它们当成普通可操作 plugin 暴露给用户

这说明 plugin policy 是跨“安装前发现”和“安装后管理”两块 surface 一起生效的。

## 12. `DiscoverPlugins` 的 empty state 也会显式暴露 marketplace policy 的存在

源码镜像：[`../../src/commands/plugin/DiscoverPlugins.tsx`](../../src/commands/plugin/DiscoverPlugins.tsx)

当没有可展示插件时，empty state 不是一律说“没有插件”。其中一条分支会明确提示：

- 组织限制了可添加的 marketplaces
- 去 Marketplaces tab 查看 allowed sources

这说明 policy 不只影响后端过滤，还改写了前台空状态解释，让用户知道“库是空的”不一定是网络或数据问题，也可能是组织治理导致。

## 13. 推荐安装链先走统一 gate，再落到各自的解析器

源码镜像：[`../../src/hooks/usePluginRecommendationBase.tsx`](../../src/hooks/useLspPluginRecommendation.tsx), [`../../src/hooks/useClaudeCodeHintRecommendation.tsx`](../../src/hooks/useClaudeCodeHintRecommendation.tsx)

`usePluginRecommendationBase()` 提供统一状态机：

- remote mode 直接不跑
- 已有 recommendation 不重复展示
- `isCheckingRef` 防重入
- `installPluginAndNotify()` 统一安装成功/失败通知

所以 LSP recommendation 和 hint recommendation 虽然来源不同，但共享的是同一条“能否 surface / 如何 install / 如何通知”的运行时骨架。

## 14. `useLspPluginRecommendation` 把推荐安装固定落到 user scope，并会直接写 user settings

源码镜像：[`../../src/hooks/useLspPluginRecommendation.tsx`](../../src/utils/settings/settings.ts)

LSP recommendation 在用户同意后会：

- `cacheAndRegisterPlugin(..., 'user', ...)`
- `updateSettingsForSource('userSettings', { enabledPlugins: ... })`

这说明它不是临时 session capability，而是显式把推荐结果沉淀进 user-scope plugin state。

也因此，如果某个 plugin 已被 policy force-disable，那么推荐链最终就不应把它带到一个可持久启用的状态。

## 15. `useClaudeCodeHintRecommendation` 也是 user-scope install，但前置来源是 stderr 协议而不是文件编辑检测

源码镜像：[`../../src/hooks/useClaudeCodeHintRecommendation.tsx`](../../src/hooks/usePluginRecommendationBase.tsx)

这条链的来源是：

- `<claude-code-hint />` stderr tag

而不是 LSP 的：

- tracked file + local binary match

但同意安装后仍然走：

- marketplace lookup
- user-scope install
- notification

这说明推荐 surface 的来源可以很多样，但最终都试图写入同一套 plugin capability state。

## 16. 为什么这条推荐链也该被放进 policy 治理卷，而不是只写在“增长 UI”里

源码镜像：[`../../src/hooks/usePluginRecommendationBase.tsx`](../../src/hooks/useLspPluginRecommendation.tsx), [`../../src/hooks/useClaudeCodeHintRecommendation.tsx`](../../src/utils/plugins/pluginPolicy.ts)

表面上看，LSP / hint recommendation 像是增长功能。但它们真正触碰的是：

- marketplace lookup
- plugin install
- user settings enablement

而这些正好都处在 policySettings 已经改写过的能力面里。

所以它们不是独立于治理的增长弹窗，而是受治理边界约束的 capability suggestion surface。

## 17. 这组 consumer 共同说明：`policySettings` 正在重写“用户看到什么插件、能从哪装、为什么装不上”

源码镜像：[`../../src/utils/suggestions/commandSuggestions.ts`](../../src/utils/suggestions/commandSuggestions.ts), [`../../src/utils/plugins/marketplaceHelpers.ts`](../../src/utils/plugins/pluginPolicy.ts), [`../../src/commands/plugin/DiscoverPlugins.tsx`](../../src/commands/plugin/DiscoverPlugins.tsx), [`../../src/commands/plugin/ManagePlugins.tsx`](../../src/commands/plugin/ManagePlugins.tsx), [`../../src/commands/plugin/PluginSettings.tsx`](../../src/commands/plugin/PluginSettings.tsx), [`../../src/commands/plugin/PluginErrors.tsx`](../../src/commands/plugin/PluginErrors.tsx), [`../../src/hooks/usePluginRecommendationBase.tsx`](../../src/hooks/usePluginRecommendationBase.tsx), [`../../src/hooks/useLspPluginRecommendation.tsx`](../../src/hooks/useLspPluginRecommendation.tsx), [`../../src/hooks/useClaudeCodeHintRecommendation.tsx`](../../src/hooks/useClaudeCodeHintRecommendation.tsx)

和前两卷相比，这一组 consumer 更靠“发现与安装”：

- commandSuggestions：决定 managed prompt commands 能否被用户看见
- marketplaceHelpers：决定哪些 marketplace source 会进入加载面
- PluginErrors / PluginSettings：决定 policy failure 怎样被解释和处理
- Discover / Manage：决定哪些 plugin 会出现在安装面和管理面
- recommendation hooks：决定增长型 install suggestion 何时被 surface，以及最终往哪里写

所以 `policySettings` 在这里不只是后台治理数据，而是在直接定义：

- 命令目录里看得到什么
- 插件市场里逛得到什么
- 推荐弹窗能推什么
- 失败时用户会被告知是网络问题、配置问题，还是组织策略问题

## 18. 为什么这条链值得单独成卷

如果只看前两卷，会以为 `policySettings` 主要控制：

- 安全边界
- 扩展装配
- 能力来源优先级

但这一卷补出来的事实是：它同样深度控制 capability discovery。

具体来说：

- managed prompt commands 会以独立 source 组进入 slash catalog
- marketplace allowlist / blocklist 会在 loader 前置层裁 source
- plugin-level policy 会同时改 Discover 和 Manage surface
- policy failure 会被翻译成专门的 operator guidance
- recommendation installs 虽然看起来是增长 UI，但最终仍落在被 policy 重写过的 plugin capability plane 上

因此 `policySettings` 的真实影响已经覆盖到 Claude Code 的“发现什么、推荐什么、允许从哪里装什么”。
