# Plugin Dependency / Marketplace Refresh / Active Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Dynamic Skills / Model-Only Skills / Host-Safe Command Gates`](./44-dynamic-skills-model-only-skills-and-host-safe-command-gates.md) | [`下一站：Plugin Reconciliation / Install Paths / Startup Materialization`](./46-plugin-reconciliation-install-paths-and-startup-materialization.md)

这一卷补的是插件系统里最容易被误读成“只是 UI 操作”的那条真运行时链：

- 插件依赖到底怎么解析、什么时候只是告警、什么时候会被降级
- marketplace 刷新到底更新了什么，没更新什么
- `/reload-plugins` 真正会清哪些缓存、重载哪些活动组件
- 后台安装、自动更新、手工 marketplace update 这三条路径怎样汇到同一条 active runtime

对应源码主链是：`utils/plugins/dependencyResolver.ts + utils/plugins/marketplaceManager.ts + utils/plugins/pluginLoader.ts + utils/plugins/refresh.ts + utils/plugins/pluginAutoupdate.ts + services/plugins/PluginInstallationManager.ts + commands/plugin/ManageMarketplaces.tsx + commands/plugin/PluginErrors.tsx`。

## 1. 插件依赖语义不是 JS module graph，而是“能力存在保证”

源码镜像：[`../../sources/claude-code/src/utils/plugins/dependencyResolver.ts`](../../sources/claude-code/src/utils/plugins/dependencyResolver.ts)

文件开头已经把语义写死了：

- 插件依赖是 `apt`-style presence guarantee
- A 依赖 B 的意思不是“import B 的代码”
- 而是“B 提供的 MCP/commands/agents 等 namespaced components 必须可用”

所以插件依赖系统并不做源码拓扑排序，它只做：

- 安装期 closure 解析
- 加载期 fixed-point 校验

## 2. 安装期和加载期是两套不同的依赖算法

源码镜像：[`../../sources/claude-code/src/utils/plugins/dependencyResolver.ts`](../../sources/claude-code/src/utils/plugins/dependencyResolver.ts)

这里有两个入口：

- `resolveDependencyClosure()`
- `verifyAndDemote()`

前者是安装期：

- DFS 走 transitive closure
- 检查 cycle / not-found / cross-marketplace
- 返回应该一起安装的插件集合

后者是加载期：

- 对当前 enabled set 做 fixed-point 校验
- 发现依赖不满足就 demote
- 不写 settings，只影响当前 session 的 active runtime

所以“依赖装不全”和“加载时依赖后来坏掉”在 Claude Code 里是两条不同恢复路径。

## 3. bare dependency 不是全局裸名，而是默认继承声明插件的 marketplace

源码镜像：[`../../sources/claude-code/src/utils/plugins/dependencyResolver.ts`](../../sources/claude-code/src/utils/plugins/dependencyResolver.ts)

`qualifyDependency(dep, declaringPluginId)` 的规则是：

- 如果依赖已经带 `@marketplace`，保持原样
- 如果没带，就继承声明者的 marketplace
- 但如果声明者来自 `@inline`，就保留裸名

`inline` 在这里是特殊哨兵，不是真 marketplace。这样做是为了：

- 普通 marketplace 内部依赖不用一直手写 `@foo`
- `--plugin-dir` 载入的 inline plugin 又不会被伪造出根本不存在的 `dep@inline`

## 4. cross-marketplace dependency 默认是安全边界，不是便利特性

源码镜像：[`../../sources/claude-code/src/utils/plugins/dependencyResolver.ts`](../../sources/claude-code/src/utils/plugins/dependencyResolver.ts)

`resolveDependencyClosure()` 默认阻止：

- marketplace A 自动安装 marketplace B 的依赖

只有两种例外：

- 用户自己已经提前装好了那个 cross-marketplace 依赖
- root marketplace 的 `allowCrossMarketplaceDependenciesOn` allowlist 显式允许

而且这里是 root-only trust：

- A 允许 B，不代表 B 再依赖 C 就自动被信任

这说明插件依赖解析本身就是安全策略执行面，不是单纯为了“尽量帮你装全”。

## 5. `verifyAndDemote()` 是加载期的会话内保险丝，不是持久化修复器

源码镜像：[`../../sources/claude-code/src/utils/plugins/dependencyResolver.ts`](../../sources/claude-code/src/utils/plugins/dependencyResolver.ts), [`../../sources/claude-code/src/utils/plugins/pluginLoader.ts`](../../sources/claude-code/src/utils/plugins/pluginLoader.ts)

`verifyAndDemote()` 的输入是：

- 当前所有 loaded plugins

它做的事是：

- 先建 `known`、`enabled`、`knownByName`、`enabledByName`
- 在 while-loop 里不断检查 enabled 插件的每个依赖
- 某个依赖不满足，就把当前插件从 `enabled` 集合里踢掉
- 继续循环，直到不再发生新的级联失效

返回的是：

- `demoted`
- `errors`

`pluginLoader.ts` 会把这些 `demoted` 插件直接标成 `enabled = false`，然后继续构造本轮加载结果。

但它不会回写用户 settings。这就是为什么文档里一直强调：

- demotion 是 session-local
- 真正修 intent 要靠 `/doctor` 或用户手改配置

## 6. 插件加载器故意分成 full-load 和 cache-only 两条路径

源码镜像：[`../../sources/claude-code/src/utils/plugins/pluginLoader.ts`](../../sources/claude-code/src/utils/plugins/pluginLoader.ts)

这里最关键的是：

- `loadAllPlugins()`
- `loadAllPluginsCacheOnly()`

`loadAllPlugins()`：

- 可以 hit source
- 会触发 clone/cache/materialization
- 完成后还会主动 warm `loadAllPluginsCacheOnly` 的 memo

`loadAllPluginsCacheOnly()`：

- 只读现有 installPath / installed cache
- 不碰网络
- cache miss 时直接报 `plugin-cache-miss`

用途分得很明确：

- startup consumer 用 cache-only，避免启动阻塞在 git clone
- 显式 refresh path 用 full-load，用户已经明确要新鲜结果

所以插件系统不是单一 loader，而是“冷启动低阻塞路径”和“显式刷新路径”并存。

## 7. `assemblePluginLoadResult()` 说明真正的插件装配顺序是“并行发现，串行验依赖，最后缓存设置”

源码镜像：[`../../sources/claude-code/src/utils/plugins/pluginLoader.ts`](../../sources/claude-code/src/utils/plugins/pluginLoader.ts)

共享装配体做的是：

1. 并行加载 marketplace plugins 和 session-only plugins
2. 叠加 builtin plugins
3. `mergePluginSources(...)`
4. `verifyAndDemote(allPlugins)`
5. `cachePluginSettings(enabledPlugins)`

这说明插件设置进入主 settings cascade 的前提是：

- merge 完成
- 依赖校验完成
- 只剩 enabled plugins

所以一个依赖坏掉后被 demote 的插件，不只是“命令消失”，连 plugin settings 也不会继续注入到运行态。

## 8. marketplace refresh 更新的是“marketplace clone/cache”，不是“已安装插件指针”

源码镜像：[`../../sources/claude-code/src/utils/plugins/marketplaceManager.ts`](../../sources/claude-code/src/utils/plugins/marketplaceManager.ts), [`../../sources/claude-code/src/utils/plugins/pluginAutoupdate.ts`](../../sources/claude-code/src/utils/plugins/pluginAutoupdate.ts)

`refreshMarketplace(name)` 做的是：

- 清掉 `getMarketplace(name)` 的 memo
- 按 source 类型更新 installLocation 指向的 marketplace clone/cache
- 成功后更新 `lastUpdated`

但它并不直接改：

- `installed_plugins.json`

这就是为什么 `pluginAutoupdate.ts` 和 `ManageMarketplaces.tsx` 都要在 refresh 之后再做一轮：

- `updatePluginsForMarketplaces(refreshedMarketplaces)`

否则会出现经典错位：

- marketplace clone 已经更新到新版本
- 已安装插件记录仍指向旧版本目录
- 下次 loader 再按 cache-on-miss 补目录时，新目录反而会被 orphan GC 标脏

## 9. official marketplace 是一条特判链，不是普通 github marketplace

源码镜像：[`../../sources/claude-code/src/utils/plugins/marketplaceManager.ts`](../../sources/claude-code/src/utils/plugins/officialMarketplaceGcs.ts)

对 `OFFICIAL_MARKETPLACE_NAME`，refresh 逻辑会先走：

- `fetchOfficialMarketplaceFromGcs(...)`

只有 GCS 失败且 feature flag 允许时，才回退到 git。

而 bulk refresh 里也有同样的分支：

- 先 GCS
- 失败时按 flag 决定是否允许 git fallback

这说明官方 marketplace 在实现上已经被当成：

- 名义上仍是 `source:'github'`
- 但运行时传输层优先走 GCS mirror

所以“官方 marketplace 是 GitHub 仓库”在产品上成立，在 transport 上已经不成立。

## 10. settings-sourced 和 seed-managed marketplace 根本不是 refresh 的目标

源码镜像：[`../../sources/claude-code/src/utils/plugins/marketplaceManager.ts`](../../sources/claude-code/src/utils/plugins/marketplaceManager.ts)

`refreshAllMarketplaces()` 和 `refreshMarketplace()` 都明确跳过两类对象：

- `entry.source.source === 'settings'`
- `seed-managed marketplace`

原因不同：

- settings-sourced marketplace 没有 upstream，真正的变更入口是 reconciler
- seed-managed marketplace 由 seed image 控制，手工 refresh 也会在下次启动被覆盖

所以 `/plugin marketplace update` 并不是“对所有 marketplace 都有意义”的统一操作。

## 11. `refreshActivePlugins()` 是 Layer-3 runtime swap，不是重新安装插件

源码镜像：[`../../sources/claude-code/src/utils/plugins/refresh.ts`](../../sources/claude-code/src/utils/plugins/refresh.ts), [`../../sources/claude-code/src/utils/plugins/pluginLoader.ts`](../../sources/claude-code/src/utils/plugins/pluginLoader.ts)

文件开头已经把层级写得很清楚：

- Layer 1: intent
- Layer 2: materialization
- Layer 3: active components

`refreshActivePlugins(setAppState)` 做的是 Layer-3：

- `clearAllCaches()`
- `clearPluginCacheExclusions()`
- `loadAllPlugins()`
- `getPluginCommands()`
- `getAgentDefinitionsWithOverrides()`
- 惰性补齐 MCP/LSP slots
- `setAppState(...)`
- bump `pluginReconnectKey`
- `reinitializeLspServerManager()`
- `loadPluginHooks()`

也就是说 `/reload-plugins` 并不负责把插件拉到磁盘，而是负责：

- 把当前磁盘上的 plugin materialization 全量重新挂进活跃会话

## 12. `refreshActivePlugins()` 必须先 full-load，再让下游 cache-only consumer 读结果

源码镜像：[`../../sources/claude-code/src/utils/plugins/refresh.ts`](../../sources/claude-code/src/utils/plugins/refresh.ts), [`../../sources/claude-code/src/utils/plugins/pluginLoader.ts`](../../sources/claude-code/src/utils/plugins/pluginLoader.ts)

这段实现非常关键：

- 先 `const pluginResult = await loadAllPlugins()`
- 再 `Promise.all([getPluginCommands(), getAgentDefinitionsWithOverrides(...)])`

原因在注释里写得很直白：

- 之前这些 consumer 共享同一个 memo promise，race 问题不明显
- 现在 `getPluginCommands/getAgentDefinitions...` 走的是 cache-only 路径
- 如果它们和 full-load 并发跑，会先读到旧的 `installed_plugins.json`
- 结果就是新 clone 的插件还没来得及 warm cache-only memo，就被判成 cache miss

所以 active refresh 的关键不是“并发更快”，而是先把 full-load 的新鲜结果灌进 cache-only memo，再放下游读取。

## 13. 新 marketplace 安装和已有 marketplace 更新，active refresh 策略并不相同

源码镜像：[`../../sources/claude-code/src/services/plugins/PluginInstallationManager.ts`](../../sources/claude-code/src/services/plugins/PluginInstallationManager.ts), [`../../sources/claude-code/src/utils/plugins/refresh.ts`](../../sources/claude-code/src/utils/plugins/refresh.ts)

`PluginInstallationManager` 的后台安装逻辑分两类：

- `result.installed.length > 0`
- `result.updated.length > 0`

如果是新安装 marketplace：

- 立即 `refreshActivePlugins(setAppState)`
- 因为不 refresh 会出现 “plugin not found in marketplace” 这种首轮 cache-only 假 miss

如果只是已有 marketplace 更新：

- 不强行 hot swap
- 只设 `plugins.needsRefresh = true`
- 让用户自己决定何时 `/reload-plugins`

这说明插件系统把“新东西根本不可见”视为急需修复，
把“已有东西有更新”视为用户可控的活跃态切换。

## 14. 用户手工 `/plugin marketplace update` 其实是“refresh clone + bump installed plugin pointers + clear caches”

源码镜像：[`../../sources/claude-code/src/commands/plugin/ManageMarketplaces.tsx`](../../sources/claude-code/src/commands/plugin/ManageMarketplaces.tsx), [`../../sources/claude-code/src/utils/plugins/pluginAutoupdate.ts`](../../sources/claude-code/src/utils/plugins/pluginAutoupdate.ts)

`ManageMarketplaces.tsx` 的 applyChanges 路径里，更新一个 marketplace 之后会：

- `refreshMarketplace(state.name, onProgress)`
- 把名字放进 `refreshedMarketplaces`

批量完成后，再做：

- `updatePluginsForMarketplaces(refreshedMarketplaces)`
- `clearAllCaches()`
- `loadKnownMarketplacesConfig()`
- `loadAllPlugins()`

这条链和 autoupdate 的核心修复是一致的：

- 先更新 marketplace clone
- 再更新已安装插件记录
- 最后清缓存重读

所以 marketplace update 真正的“完成”标准不是 git pull 成功，而是 installed plugin pointers 也被对齐到新版本。

## 15. 错误表面也区分了“依赖没找到”和“依赖存在但没启用”

源码镜像：[`../../sources/claude-code/src/utils/plugins/dependencyResolver.ts`](../../sources/claude-code/src/utils/plugins/dependencyResolver.ts), [`../../sources/claude-code/src/commands/plugin/PluginErrors.tsx`](../../sources/claude-code/src/commands/plugin/PluginErrors.tsx)

`verifyAndDemote()` 产出的 `dependency-unsatisfied` 会附带：

- `reason: 'not-enabled' | 'not-found'`

`PluginErrors.tsx` 再把这两类错误翻成不同 guidance：

- disabled：提示启用依赖
- not installed：提示安装依赖

这说明插件错误页不是只显示一条 generic dependency failure，而是保留了依赖失效的具体语义来源。

## 16. 这一整条链共同说明：插件系统的“刷新”其实分成三层，而不是一个按钮

源码镜像：[`../../sources/claude-code/src/utils/plugins/dependencyResolver.ts`](../../sources/claude-code/src/utils/plugins/dependencyResolver.ts), [`../../sources/claude-code/src/utils/plugins/marketplaceManager.ts`](../../sources/claude-code/src/utils/plugins/marketplaceManager.ts), [`../../sources/claude-code/src/utils/plugins/pluginLoader.ts`](../../sources/claude-code/src/utils/plugins/pluginLoader.ts), [`../../sources/claude-code/src/utils/plugins/refresh.ts`](../../sources/claude-code/src/utils/plugins/refresh.ts), [`../../sources/claude-code/src/utils/plugins/pluginAutoupdate.ts`](../../sources/claude-code/src/utils/plugins/pluginAutoupdate.ts), [`../../sources/claude-code/src/services/plugins/PluginInstallationManager.ts`](../../sources/claude-code/src/services/plugins/PluginInstallationManager.ts), [`../../sources/claude-code/src/commands/plugin/ManageMarketplaces.tsx`](../../sources/claude-code/src/commands/plugin/ManageMarketplaces.tsx)

真实链路分三层：

- 依赖层：决定一个插件在逻辑上是否允许存在
- marketplace 层：决定源缓存是否已经更新到新版本
- active runtime 层：决定当前会话里 commands/agents/hooks/MCP/LSP 是否已经切换

所以用户看到的“插件更新”至少可能意味着三件完全不同的事：

- 依赖 closure 解析成功
- marketplace clone 已更新
- 当前会话组件已经 hot swapped

这也是为什么这条链必须单独成卷。否则把 `/plugin marketplace update`、`/reload-plugins`、后台安装通知混成一个概念，会永远解释不清插件系统的真实状态机。
