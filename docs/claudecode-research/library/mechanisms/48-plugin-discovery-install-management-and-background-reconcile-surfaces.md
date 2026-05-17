# Plugin Discovery / Install Management / Background Reconcile Surfaces

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Plugin Startup Detection / Headless Activation / CLI Control Surfaces`](./47-plugin-startup-detection-headless-activation-and-cli-control-surfaces.md) | [`下一站：Plugin Marketplace Governance / Settings Router / Recommendation Hooks`](./49-plugin-marketplace-governance-settings-router-and-recommendation-hooks.md)

这一卷补的是用户真正“看见插件系统”的那层运行时：

- `/plugin browse` 和 `/plugin discover` 到底如何列 market、列 plugin、排序、deep link、批量安装
- 安装后为什么会被带进 `PluginOptionsFlow`，而不是直接结束
- `/plugin manage` 为什么不只是“已安装插件列表”，而是 unified inventory
- 后台 marketplace reconcile 怎样把 pending/installing/installed/failed 状态接进前台，再决定 auto-refresh 还是只 raise `/reload-plugins`

对应源码主链是：`commands/plugin/BrowseMarketplace.tsx + commands/plugin/DiscoverPlugins.tsx + commands/plugin/ManagePlugins.tsx + services/plugins/PluginInstallationManager.ts`。

## 1. `BrowseMarketplace` 和 `DiscoverPlugins` 不是一个页面换个标题，而是两种检索入口

源码镜像：[`../../src/commands/plugin/BrowseMarketplace.tsx`](../../src/commands/plugin/BrowseMarketplace.tsx), [`../../src/commands/plugin/DiscoverPlugins.tsx`](../../src/commands/plugin/DiscoverPlugins.tsx)

两者的第一层差异是数据切片方式：

- `BrowseMarketplace`
  - 先列 marketplace
  - 再在单个 marketplace 里列 plugin
  - 适合 operator 先选源，再挑包

- `DiscoverPlugins`
  - 直接把所有 marketplace 的 plugin 扁平化
  - 再统一搜索、排序、批量选择
  - 适合 user 先想“我要一个能力”，不关心它来自哪个源

所以这是：

- source-first discovery
- capability-first discovery

两条不同交互模型，不是 UI 重复。

## 2. 两个发现面都故意把 “project/local installed” 视为仍可继续安装到 user scope

源码镜像：[`../../src/commands/plugin/BrowseMarketplace.tsx`](../../src/commands/plugin/BrowseMarketplace.tsx), [`../../src/commands/plugin/DiscoverPlugins.tsx`](../../src/commands/plugin/DiscoverPlugins.tsx)

二者判断已安装时都用的是：

- `isPluginGloballyInstalled(pluginId)`

而不是简单的 “任何 scope 已安装就算 installed”。

原因注释写得很明确：

- project/local scope 仍允许用户“提升”为 user scope
- 这样插件可以在别的项目里也可用

所以发现面上的 `isInstalled` 实际语义是：

- “这个 plugin 在全局层面已经没必要再加一份”

而不是：

- “这个 plugin 在任何地方都出现过”

## 3. install count 排序是产品排序层，不是 marketplace catalog 顺序

源码镜像：[`../../src/commands/plugin/BrowseMarketplace.tsx`](../../src/commands/plugin/BrowseMarketplace.tsx), [`../../src/commands/plugin/DiscoverPlugins.tsx`](../../src/commands/plugin/DiscoverPlugins.tsx)

两个发现面都主动拉：

- `getInstallCounts()`

然后做：

- install count 降序
- 再字母序兜底

拉不到 count 时再退回：

- 字母序

这说明 marketplace manifest 自身并不承担最终展示排序，Claude Code 还有一层基于使用热度的产品排序面。

## 4. `targetMarketplace` / `targetPlugin` 让发现面可以当成命令跳转目的地，而不是只能从头浏览

源码镜像：[`../../src/commands/plugin/BrowseMarketplace.tsx`](../../src/commands/plugin/BrowseMarketplace.tsx), [`../../src/commands/plugin/DiscoverPlugins.tsx`](../../src/commands/plugin/DiscoverPlugins.tsx)

这两页都支持：

- `targetMarketplace`
- `targetPlugin`

行为也不是简单定位列表项，而是：

- 直接跳到 plugin details
- 已安装则重定向用户去 `/plugin manage`
- 找不到就直接报错

所以发现面在命令系统里承担的其实是：

- 一个可编程的 deep-link target

这也是为什么其它 slash surface 能把用户直接送到某个 plugin 的详情态，而不是只会打开目录首页。

## 5. 批量安装和单插件安装共用同一个 install core，但收尾导航不同

源码镜像：[`../../src/commands/plugin/BrowseMarketplace.tsx`](../../src/commands/plugin/BrowseMarketplace.tsx), [`../../src/commands/plugin/DiscoverPlugins.tsx`](../../src/commands/plugin/DiscoverPlugins.tsx), [`../../src/utils/plugins/pluginInstallationHelpers.ts`](../../src/utils/plugins/pluginInstallationHelpers.ts)

两条页面都把实际安装委托给：

- `installPluginFromMarketplace(...)`

但上层 orchestration 不一样：

- 批量安装：
  - 循环调 install core
  - 汇总 `successCount/failureCount`
  - 用 `formatFailureDetails(...)` 做 mixed-result 文案
  - 一次性回主菜单

- 单插件安装：
  - 成功后额外尝试 `findPluginOptionsTarget(pluginId)`
  - 如果该 plugin 有待配置项，立刻进入 `PluginOptionsFlow`
  - 没有配置项才直接结束

所以“安装完成”在 Claude Code 里不是一个固定终点，而是：

- materialized
- maybe needs config
- then prompt `/reload-plugins`

三阶段链。

## 6. `PluginOptionsFlow` 是安装事务的尾巴，不是独立设置页

源码镜像：[`../../src/commands/plugin/BrowseMarketplace.tsx`](../../src/commands/plugin/BrowseMarketplace.tsx), [`../../src/commands/plugin/DiscoverPlugins.tsx`](../../src/commands/plugin/DiscoverPlugins.tsx)

在两个发现页里，只要 `findPluginOptionsTarget()` 找到刚安装好的插件，就会：

- `setViewState({ type: 'plugin-options', ... })`

然后按 outcome 分三类收尾：

- `configured`
- `skipped`
- `error`

这说明 options flow 的角色不是“额外功能”，而是安装事务的补全阶段。插件被装到磁盘之后，Claude Code 会马上追问：

- 这个插件是不是还缺用户配置才能真正 usable

## 7. `PluginTrustWarning` 被放在 details view，不是安装时异常弹窗

源码镜像：[`../../src/commands/plugin/BrowseMarketplace.tsx`](../../src/commands/plugin/BrowseMarketplace.tsx), [`../../src/commands/plugin/DiscoverPlugins.tsx`](../../src/commands/plugin/DiscoverPlugins.tsx)

这点很产品化：

- trust warning 在详情页稳定出现
- 而不是在用户按下 install 后临时抛一个阻塞弹窗

这意味着 trust 在 Claude Code 插件 UX 里是：

- selection-time context

不是：

- failure-time exception

用户在决定 scope、看 homepage/GitHub、看 description 的同一视图里就会被提醒。

## 8. `DiscoverPlugins` 把搜索模式做成了 first-class 输入态，不是列表过滤小挂件

源码镜像：[`../../src/commands/plugin/DiscoverPlugins.tsx`](../../src/commands/plugin/DiscoverPlugins.tsx), [`../../src/components/SearchBox.tsx`](../../src/components/SearchBox.tsx)

这页显式维护：

- `isSearchMode`
- `useSearchInput(...)`
- `SearchBox`
- `filteredPlugins`

并约定：

- `/` 或任意 printable char 进入搜索态
- `j/k/i/space` 不触发搜索态
- 搜索态和列表导航态的 keybinding 分开

所以这里不是“有个输入框”，而是：

- list browsing mode
- raw search mode

两套输入协议并存。

## 9. `ManagePlugins` 管的不是纯 plugin list，而是 unified inventory

源码镜像：[`../../src/commands/plugin/ManagePlugins.tsx`](../../src/commands/plugin/ManagePlugins.tsx)

这页的 item 类型至少有：

- `plugin`
- `flagged-plugin`
- `failed-plugin`
- `mcp`

也就是说它不是“已安装 plugin 管理页”，而是把这些东西统一到一个 inventory：

- 正常已装 plugin
- 被 marketplace 移除但仍在用户配置里的 flagged plugin
- 有错误但没法正常 load 的 failed plugin
- 由 plugin 引入的 MCP 连接

所以 `/plugin manage` 的真实职责更接近：

- runtime-integrated plugin + mcp asset console

## 10. `targetPlugin + action` 让 `ManagePlugins` 能被当成操作型 deep link，而不是只会显示详情

源码镜像：[`../../src/commands/plugin/ManagePlugins.tsx`](../../src/commands/plugin/ManagePlugins.tsx)

`ManagePlugins` 不只支持定位某个 plugin，还支持：

- `action?: 'enable' | 'disable' | 'uninstall'`

它会：

- 先在 loaded plugins 里找
- 找不到再在 failed-plugin 区找
- 如果 action 请求存在但找不到目标，就直接给结果文案

所以这是一个：

- open-to-target
- maybe auto-act

的命令执行面，而不是纯可视化页面。

## 11. uninstall 在管理页里不是一个按钮，而是一串保护分支

源码镜像：[`../../src/commands/plugin/ManagePlugins.tsx`](../../src/services/plugins/pluginOperations.ts)

`handleSingleOperation('uninstall')` 至少会检查：

- builtin plugin：禁止
- managed plugin：禁止
- 是否同时 project-enabled：改走 `confirm-project-uninstall`
- 是否是 last scope 且有 data dir：改走 `confirm-data-cleanup`

也就是说前台并没有把 uninstall 简化成“调 op 然后出结果”，而是明确区分：

- shared settings risk
- persistent data cleanup risk

这让管理页承担了 pluginOperations 之上的第二层交互保护。

## 12. `confirm-project-uninstall` 的实质是“用 local disable 覆盖 shared enable”

源码镜像：[`../../src/commands/plugin/ManagePlugins.tsx`](../../src/services/plugins/pluginOperations.ts)

当插件同时在 `.claude/settings.json` 启用时，管理页不会鼓励直接卸载，而是先问：

- 要不要只在 `.claude/settings.local.json` 里 disable

这和 `pluginOperations.ts` 的 scope 覆盖语义完全对齐：

- 更高优先级的 local false 可以遮住 project true

所以这个确认页不是纯 UX 提示，而是把底层 precedence 规则翻译成了人能理解的操作方案。

## 13. `confirm-data-cleanup` 把 plugin data dir 的删除做成显式二选一

源码镜像：[`../../src/commands/plugin/ManagePlugins.tsx`](../../src/utils/plugins/pluginDirectories.ts)

如果插件是 last scope 且有持久化数据，管理页会切到：

- `confirm-data-cleanup`

然后让用户选：

- `y` 删除数据
- `n` 保留数据
- `esc` 取消

这层和 `uninstallPluginOp(..., deleteDataDir)` 组合起来，才形成完整“卸载但保留数据”语义。底层 op 有参数，前台负责把它变成人类能理解的分叉。

## 14. flagged plugin 和 failed plugin 在管理页里是两种不同故障语义

源码镜像：[`../../src/commands/plugin/ManagePlugins.tsx`](../../src/commands/plugin/PluginErrors.tsx)

`flagged-plugin`：

- plugin 已被 marketplace 移除或标记
- 会显示 `reason/text/flaggedAt`
- 允许 `Dismiss`

`failed-plugin`：

- plugin 仍在 inventory 里，但 load 过程出错
- 打开的是错误详情 view
- 依赖 `PluginErrors` 的 guidance 文案

所以管理页并没有把所有“坏插件”压成一个红色条目，而是区分：

- catalog-level removal
- runtime-level load failure

## 15. MCP detail 被直接挂进同一个 inventory，说明插件和 MCP 在操作面上已经是同构资产

源码镜像：[`../../src/commands/plugin/ManagePlugins.tsx`](../../src/components/mcp/MCPToolDetailView.tsx)

`ManagePlugins` 里 MCP 有：

- `mcp-detail`
- `mcp-tools`
- `mcp-tool-detail`

这意味着插件管理页并不只关心“这个 plugin 装了没”，还关心：

- plugin 带来了哪些 MCP server
- server 上有哪些 tool
- tool 级别的细节和可见性

这一步把 plugin system 和 MCP runtime 真正并成了同一张操作表。

## 16. `PluginInstallationManager` 是后台 reconcile 的 UI 桥，不是新的安装引擎

源码镜像：[`../../src/services/plugins/PluginInstallationManager.ts`](../../src/utils/plugins/reconciler.ts)

这个服务自己不发明安装逻辑。它做的是：

- 先 `diffMarketplaces(...)`
- 把 pending marketplace 写到 `AppState.plugins.installationStatus`
- 再调 `reconcileMarketplaces(...)`
- 用 `onProgress` 把 `installing/installed/failed` 映射回 AppState

所以它是：

- reconcile progress -> REPL state bridge

而不是：

- 第三套 plugin installer

## 17. 后台安装对 “new install” 和 “update only” 的处理是两条不同激活策略

源码镜像：[`../../src/services/plugins/PluginInstallationManager.ts`](../../src/utils/plugins/refresh.ts)

这是这条链里最关键的行为分叉：

- 如果 `result.installed.length > 0`
  - 说明有全新 marketplace 被装上
  - 直接 `refreshActivePlugins(setAppState)`
  - 因为不刷新会留下 fresh homespace 上的 `plugin-not-found`

- 如果只有 `result.updated.length > 0`
  - 说明只是现有 marketplace 内容更新
  - 不强推自动切换
  - 只置 `needsRefresh`

这和前面 `useManagePlugins()` 的“磁盘变化只提示 `/reload-plugins`”形成互补：

- 新装 marketplace：自动救急
- 旧 marketplace 更新：用户自己决定何时切

## 18. auto-refresh 失败后会退化成同一条 `/reload-plugins` 协议

源码镜像：[`../../src/services/plugins/PluginInstallationManager.ts`](../../src/utils/plugins/pluginLoader.ts)

`refreshActivePlugins()` 如果失败，后台安装管理器会：

- `clearPluginCache(...)`
- `needsRefresh = true`

也就是说即使自动激活没成功，系统也不会把状态悬空，而是退回到用户熟悉的同一条显式恢复通路：

- `/reload-plugins`

这保证了后台安装的失败恢复路径不会再发明新的 UI/命令。

## 19. 这条链的总装配关系

源码镜像：[`../../src/commands/plugin/BrowseMarketplace.tsx`](../../src/commands/plugin/BrowseMarketplace.tsx), [`../../src/commands/plugin/DiscoverPlugins.tsx`](../../src/commands/plugin/DiscoverPlugins.tsx), [`../../src/commands/plugin/ManagePlugins.tsx`](../../src/commands/plugin/ManagePlugins.tsx), [`../../src/services/plugins/PluginInstallationManager.ts`](../../src/services/plugins/PluginInstallationManager.ts)

可以把用户可见的插件操作面收成 4 层：

1. `BrowseMarketplace.tsx`
作用：source-first discovery，按 marketplace 进入、批量或单个安装、支持 target marketplace / target plugin deep link。

2. `DiscoverPlugins.tsx`
作用：capability-first discovery，跨 marketplace 扁平搜索、install count 排序、批量安装和 search-mode 输入协议。

3. `ManagePlugins.tsx`
作用：统一 inventory console，管理正常/flagged/failed/MCP 四类资产，并把 enable/disable/update/uninstall/options/configure/MCP detail 收到一个状态机里。

4. `PluginInstallationManager.ts`
作用：把后台 reconcile 的 pending/progress/result 映射到 AppState，并决定何时 auto-refresh、何时只提示 `/reload-plugins`。

到这里，插件线已经至少拆成了：

- `45` 依赖与 active runtime
- `46` reconcile 与 materialization
- `47` startup detection / headless / CLI control
- `48` discovery / install / manage / background reconcile surfaces

插件体系基本已经从“概览”压到了实现级操作百科。
