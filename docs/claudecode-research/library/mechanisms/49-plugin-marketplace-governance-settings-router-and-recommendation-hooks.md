# Plugin Marketplace Governance / Settings Router / Recommendation Hooks

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Plugin Discovery / Install Management / Background Reconcile Surfaces`](./48-plugin-discovery-install-management-and-background-reconcile-surfaces.md) | [`下一站：FileRead / Grep / WebSearch Runtime`](./32-file-read-grep-and-websearch-runtime.md)

这一卷补的是插件系统里最后一圈“治理与导流面”：

- `/plugin marketplace` 和 `/plugin errors` 为什么不是独立命令堆，而是 `PluginSettings` 里的路由器
- `ManageMarketplaces` 怎样把 update/remove/auto-update 做成 marketplace 级状态机
- `marketplaceHelpers` 怎样把 source policy、失败降级、trust message 这些产品语义集中起来
- `LSP` 和 `<claude-code-hint />` 两条推荐安装链怎样复用统一状态机，但又保留各自的 show-once 语义

对应源码主链是：`commands/plugin/ManageMarketplaces.tsx + commands/plugin/PluginSettings.tsx + utils/plugins/marketplaceHelpers.ts + hooks/usePluginRecommendationBase.tsx + hooks/useLspPluginRecommendation.tsx + hooks/useClaudeCodeHintRecommendation.tsx`。

## 1. `PluginSettings` 不是一个页面，而是插件命令树的前台路由器

源码镜像：[`../../sources/claude-code/src/commands/plugin/PluginSettings.tsx`](../../sources/claude-code/src/commands/plugin/PluginSettings.tsx), [`../../sources/claude-code/src/commands/plugin/parseArgs.ts`](../../sources/claude-code/src/commands/plugin/parseArgs.ts)

这层真正做的第一件事不是 render tabs，而是：

- `parsePluginArgs(args)`
- `getInitialViewState(parsedCommand)`
- `getInitialTab(viewState)`

它把很多 slash 语义收束成一个前台 state router：

- `install`
- `manage`
- `uninstall`
- `enable`
- `disable`
- `marketplace add/remove/update/list`
- `validate`
- 默认 discover

所以 `/plugin` 相关命令在 REPL 里并不是“一条命令一个页面”，而是：

- parse once
- route to a typed sub-view

## 2. `PluginSettings` 里的 tab 不是导航装饰，而是和 deep-link action 绑死的恢复点

源码镜像：[`../../sources/claude-code/src/commands/plugin/PluginSettings.tsx`](../../sources/claude-code/src/commands/plugin/PluginSettings.tsx)

`TabId` 只有四个：

- `discover`
- `installed`
- `marketplaces`
- `errors`

但 `getInitialTab(viewState)` 会根据 routed sub-view 自动选中：

- `manage-plugins -> installed`
- `manage-marketplaces -> marketplaces`
- 其他默认 `discover`

也就是说 tab bar 并不是独立导航层，而是 command deep link 的可见“当前位置”。

## 3. `ErrorsTabContent` 的职责不是展示日志，而是把错误变成可执行修复动作

源码镜像：[`../../sources/claude-code/src/commands/plugin/PluginSettings.tsx`](../../sources/claude-code/src/commands/plugin/PluginSettings.tsx), [`../../sources/claude-code/src/commands/plugin/PluginErrors.tsx`](../../sources/claude-code/src/commands/plugin/PluginErrors.tsx)

这块最关键的是：

- `buildErrorRows(...)`
- `ErrorRowAction`

error row 不只包含：

- label
- message
- guidance

还包含 action：

- `navigate`
- `remove-extra-marketplace`
- `remove-installed-marketplace`
- `managed-only`
- `none`

这说明 `/plugin errors` 不是被动读错误，而是：

- 一张“错误 -> 修复路由”表

## 4. marketplace 错误会优先回写 settings，而不是直接删磁盘

源码镜像：[`../../sources/claude-code/src/commands/plugin/PluginSettings.tsx`](../../sources/claude-code/src/utils/settings/settings.ts)

`buildMarketplaceAction(name)` 的决策顺序非常明确：

- 如果 `extraKnownMarketplaces` 出现在 editable source
  - action = `remove-extra-marketplace`
- 如果只在 policy 里
  - action = `managed-only`
- 否则
  - action = navigate 到 `ManageMarketplaces` 做 `remove`

也就是说错误修复的优先级是：

- 先删 declaration / enabledPlugins intent
- 再考虑删 materialized marketplace

这和前面几卷一直强调的 settings-first 语义完全一致。

## 5. `removeExtraMarketplace()` 顺手清同源 enabled plugins，说明 marketplace declaration 和 plugin intent 是耦合治理的

源码镜像：[`../../sources/claude-code/src/commands/plugin/PluginSettings.tsx`](../../sources/claude-code/src/utils/settings/settings.ts)

这个 helper 不是只把：

- `extraKnownMarketplaces[name] = undefined`

它还会扫：

- `enabledPlugins` 里所有 `@${name}` 尾缀

一起设成 `undefined`。

所以在 Claude Code 的治理模型里：

- marketplace 被移除
- 依附在该 marketplace 上的 plugin intent 也必须一起被移除

不允许留下“source 已删，但 plugin 还在请求这个 source”的半残状态。

## 6. `ManageMarketplaces` 是 marketplace 级状态机，不是 marketplace 列表页

源码镜像：[`../../sources/claude-code/src/commands/plugin/ManageMarketplaces.tsx`](../../sources/claude-code/src/commands/plugin/ManageMarketplaces.tsx)

它维护的核心状态不是简单 selected row，而是：

- `pendingUpdate`
- `pendingRemove`
- `autoUpdate`
- `internalView = list | details | confirm-remove`
- `progressMessage`
- `successMessage`

也就是说这页真正表达的是：

- marketplace operation queue + details console

而不是：

- “有哪些 marketplace”

## 7. `ManageMarketplaces` 同时支持 staged apply 和 direct action，两套路径并存

源码镜像：[`../../sources/claude-code/src/commands/plugin/ManageMarketplaces.tsx`](../../sources/claude-code/src/commands/plugin/ManageMarketplaces.tsx)

list view 里有两条操作风格：

- `u/r` 先把 row 标成 `pendingUpdate/pendingRemove`
- 回车统一 `applyChanges()`

但 details view 里又支持：

- 直接 `Update marketplace`
- 直接 `Remove marketplace`
- 直接 `Browse plugins`
- 直接 `toggle auto-update`

所以这不是单一的 staged UI。它同时提供：

- bulk-like pending queue
- focused single-market action panel

## 8. auto-update toggle 不是临时 session bit，而是 marketplace config 的真实持久化字段

源码镜像：[`../../sources/claude-code/src/commands/plugin/ManageMarketplaces.tsx`](../../sources/claude-code/src/utils/plugins/marketplaceManager.ts)

`handleToggleAutoUpdate()` 调的是：

- `setMarketplaceAutoUpdate(marketplace.name, newAutoUpdate)`

然后再把本地 state 和 selected marketplace 镜像一起更新。

这说明 auto-update 并不是前台记忆，而是已经进入：

- marketplace persistent config

同时页面底部还会在开启时补一段说明文案，表示这不是单次操作，而是后续后台更新策略。

## 9. marketplace update 不是只 refresh clone，还会尝试把已装插件 bump 到新版本指针

源码镜像：[`../../sources/claude-code/src/commands/plugin/ManageMarketplaces.tsx`](../../sources/claude-code/src/utils/plugins/pluginAutoupdate.ts)

`applyChanges()` 在 refresh 完 marketplace 之后，还会：

- `updatePluginsForMarketplaces(refreshedMarketplaces)`

目的不是多余优化，而是修这个语义缝：

- marketplace clone 已更新
- 但 `installed_plugins.json` 还指向旧 version path

所以这里明确把：

- marketplace source update
- installed plugin pointer bump

连成一个用户看得见的管理事务。

## 10. `marketplaceHelpers` 是 policy/trust/降级语义的集中层，不是杂项 util

源码镜像：[`../../sources/claude-code/src/utils/plugins/marketplaceHelpers.ts`](../../sources/claude-code/src/utils/plugins/marketplaceHelpers.ts)

这个文件里至少集中了承载三类产品语义：

- 展示层：
  - `getMarketplaceSourceDisplay()`
  - `formatFailureDetails()`
  - `formatMarketplaceLoadingErrors()`

- policy/trust 层：
  - `getStrictKnownMarketplaces()`
  - `getBlockedMarketplaces()`
  - `getPluginTrustMessage()`
  - `isSourceAllowedByPolicy(...)`

- source matching 层：
  - `areSourcesEqual(...)`
  - host/path pattern 匹配

所以它的真实地位更像：

- marketplace product semantics adapter

而不是纯 helper bucket。

## 11. graceful degradation 的 contract 是“部分 marketplace 坏了也继续出可用 catalog”

源码镜像：[`../../sources/claude-code/src/utils/plugins/marketplaceHelpers.ts`](../../sources/claude-code/src/utils/plugins/marketplaceManager.ts)

`loadMarketplacesWithGracefulDegradation()` 的协议是：

- blocked marketplace 直接跳过
- 单个 marketplace 拉取失败只记到 `failures`
- 其他 marketplace 继续正常返回

再由 `formatMarketplaceLoadingErrors()` 决定：

- 有成功项：warning
- 全失败：error

这就是为什么前面的 `BrowseMarketplace`、`DiscoverPlugins`、`ManageMarketplaces` 都可以在 marketplace 部分损坏时继续工作，而不会整页崩掉。

## 12. `usePluginRecommendationBase()` 不是 recommendation source，而是统一 show-one async gate

源码镜像：[`../../sources/claude-code/src/hooks/usePluginRecommendationBase.tsx`](../../sources/claude-code/src/hooks/usePluginRecommendationBase.tsx)

这个 hook 本身不懂 LSP，也不懂 hint。它只统一三件事：

- remote mode 直接跳过
- 已经有 recommendation 时不再重复 surface
- `isCheckingRef` 防止并发 resolve

并提供：

- `tryResolve(resolveFn)`
- `clearRecommendation()`

所以它是：

- shared recommendation state machine

不是：

- 某条推荐源的业务逻辑

## 13. LSP recommendation 的 show-once 语义是 “每 session 一次 + timeout 算 ignored”

源码镜像：[`../../sources/claude-code/src/hooks/useLspPluginRecommendation.tsx`](../../sources/claude-code/src/utils/plugins/lspRecommendation.ts)

这条链的关键 gate 包括：

- `trackedFiles` 新文件集
- `hasShownLspRecommendationThisSession()`
- `getMatchingLspPlugins(filePath)`

响应分支里又细分成：

- `yes`：直接 `cacheAndRegisterPlugin + enabledPlugins[user]=true`
- `no`：如果超 28s，当作 timeout，`incrementIgnoredCount()`
- `never`：`addToNeverSuggest(pluginId)`
- `disable`：全局 `lspRecommendationDisabled=true`

所以 LSP 推荐面不是简单 yes/no，而是显式维护：

- per-session suppression
- per-plugin never suggest
- global disable
- timeout vs explicit dismiss

## 14. hint recommendation 的 show-once 语义是 “每 plugin 一生一次”，不是每 session 一次

源码镜像：[`../../sources/claude-code/src/hooks/useClaudeCodeHintRecommendation.tsx`](../../sources/claude-code/src/utils/claudeCodeHints.ts)

这条链和 LSP 最大的不同是：

- 它的输入不是 tracked file，而是 stderr `<claude-code-hint />`
- `markHintPluginShown(pluginId)` 在响应时记录
- no/yes 都会占掉“这个 plugin 的提示机会”

它还会：

- `clearPendingHint()` 但只在 snapshot 仍是同一个 hint 时
- 防止异步 resolve 期间把 newer hint 覆盖掉

所以 hint recommendation 是：

- plugin-lifetime show-once

而不是：

- session-scoped show-once

## 15. 两条推荐安装链都故意不直接走 `/plugin` UI，而是直接调安装 core

源码镜像：[`../../sources/claude-code/src/hooks/usePluginRecommendationBase.tsx`](../../sources/claude-code/src/hooks/useLspPluginRecommendation.tsx), [`../../sources/claude-code/src/hooks/useClaudeCodeHintRecommendation.tsx`](../../sources/claude-code/src/utils/plugins/pluginInstallationHelpers.ts)

两条推荐源最后都汇到：

- `installPluginAndNotify(...)`

LSP 分支内部做：

- `cacheAndRegisterPlugin(...)`
- `enabledPlugins[user][pluginId]=true`

hint 分支内部做：

- `installPluginFromMarketplace(... trigger:'hint')`

它们都不是“打开插件页让用户再选一次”，而是：

- recommendation -> direct install side effect -> notification

这说明 recommendation hook 在产品上被定义成快速确认流，不是导航流。

## 16. 这条链的总装配关系

源码镜像：[`../../sources/claude-code/src/commands/plugin/ManageMarketplaces.tsx`](../../sources/claude-code/src/commands/plugin/ManageMarketplaces.tsx), [`../../sources/claude-code/src/commands/plugin/PluginSettings.tsx`](../../sources/claude-code/src/commands/plugin/PluginSettings.tsx), [`../../sources/claude-code/src/utils/plugins/marketplaceHelpers.ts`](../../sources/claude-code/src/utils/plugins/marketplaceHelpers.ts), [`../../sources/claude-code/src/hooks/usePluginRecommendationBase.tsx`](../../sources/claude-code/src/hooks/usePluginRecommendationBase.tsx), [`../../sources/claude-code/src/hooks/useLspPluginRecommendation.tsx`](../../sources/claude-code/src/hooks/useLspPluginRecommendation.tsx), [`../../sources/claude-code/src/hooks/useClaudeCodeHintRecommendation.tsx`](../../sources/claude-code/src/hooks/useClaudeCodeHintRecommendation.tsx)

可以把这一圈治理/导流层收成 6 层：

1. `PluginSettings.tsx`
作用：把 `/plugin` 各类子命令解析成统一前台路由，并通过 tabs 暴露当前位置。

2. `ErrorsTabContent`
作用：把 plugin/marketplace 错误变成可执行修复动作，而不是只显示堆栈。

3. `ManageMarketplaces.tsx`
作用：提供 marketplace 级 staging、details、auto-update、remove、browse、plugin bump 管理面。

4. `marketplaceHelpers.ts`
作用：集中定义 source 展示、failure degradation、policy gate、host/path/source matching 这些 marketplace 产品语义。

5. `usePluginRecommendationBase.tsx`
作用：给 recommendation 源提供统一的 remote/in-flight/already-showing gate。

6. `useLspPluginRecommendation.tsx` + `useClaudeCodeHintRecommendation.tsx`
作用：把 file-edit / stderr-hint 两种触发源分别翻译成 direct install recommendation，并保留各自的 show-once 语义。

到这里，插件体系已经至少拆成了：

- `45` 依赖 / refresh / active runtime
- `46` reconcile / materialization / startup install
- `47` startup detection / headless / CLI control
- `48` discovery / install / manage / background reconcile
- `49` marketplace governance / settings router / recommendation hooks

插件线基本已经从运行时、交互面、治理面都拆到了实现级百科。
