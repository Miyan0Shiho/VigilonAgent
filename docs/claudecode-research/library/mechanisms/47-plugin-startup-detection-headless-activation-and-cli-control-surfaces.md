# Plugin Startup Detection / Headless Activation / CLI Control Surfaces

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Plugin Reconciliation / Install Paths / Startup Materialization`](./46-plugin-reconciliation-install-paths-and-startup-materialization.md) | [`下一站：Plugin Discovery / Install Management / Background Reconcile Surfaces`](./48-plugin-discovery-install-management-and-background-reconcile-surfaces.md)

这一卷补的是插件系统里最后一段很容易被混成“一次加载”的操作面：

- 启动时到底用什么规则判断哪些插件是 enabled、哪些只是 installed
- headless / REPL 为什么都能看到插件，但刷新语义不一样
- 为什么后台插件变化只提示 `/reload-plugins`，而不是自动热切换
- CLI `claude plugin ...` 为什么只是 core op 的有副作用包装层

对应源码主链是：`utils/plugins/pluginStartupCheck.ts + hooks/useManagePlugins.ts + hooks/useOfficialMarketplaceNotification.tsx + hooks/notifs/useStartupNotification.ts + services/plugins/pluginCliCommands.ts + cli/print.ts`。

## 1. `checkEnabledPlugins()` 的真相源是 merged settings，不是 installed registry

源码镜像：[`../../src/utils/plugins/pluginStartupCheck.ts`](../../src/utils/plugins/pluginStartupCheck.ts)

`checkEnabledPlugins()` 做的第一件事不是读 `installed_plugins.json`，而是：

- `getInitialSettings()`

再叠加：

- `getAddDirEnabledPlugins()`

它的优先级是：

- 先把 `--add-dir` 当成最低优先级 session source 放进去
- 再用 merged settings 把它覆盖或显式删掉

所以这条函数回答的是：

- “当前会话理论上应该启用哪些 `plugin@marketplace`”

而不是：

- “磁盘上有哪些插件目录”

## 2. `getPluginEditableScopes()` 解决的是“回写到哪里”，不是“是否真的生效”

源码镜像：[`../../src/utils/plugins/pluginStartupCheck.ts`](../../src/utils/plugins/pluginStartupCheck.ts)

同文件里最容易被误用的是 `getPluginEditableScopes()`。注释已经点得很明白：

- 它不是 authoritative enabled check
- 它服务的是 scope tracking / write-back ownership

它按这套顺序覆写：

- `addDir`
- `managed`
- `user`
- `project`
- `local`
- `flag`

也就是说它回答的是：

- “如果用户现在要 enable/disable 这个插件，应该默认写回哪个可编辑 source”

而不是：

- “这个插件最终是否被 policy 压掉了”

这条区分很关键，因为 `checkEnabledPlugins()` 用的是 merged truth，而这里故意把 managed 放成最低用户可编辑基线。

## 3. startup check 里 “enabled” 和 “installed” 是两张不同表

源码镜像：[`../../src/utils/plugins/pluginStartupCheck.ts`](../../src/utils/plugins/installedPluginsManager.ts)

`getInstalledPlugins()` 走的是：

- `migrateFromEnabledPlugins()` 异步触发老格式迁移
- `getInMemoryInstalledPlugins()` 读 V2 registry

而 `checkEnabledPlugins()` 走的是 settings merge。

所以 Claude Code 在启动期有意维护两种 truth：

- settings truth：哪些插件应当存在
- installation truth：哪些插件已经注册过 installPath

后面 `findMissingPlugins()` 做的就是这两张表的差集。

## 4. `findMissingPlugins()` 不是“全部未安装都报缺失”，而是“未安装且 marketplace 中仍存在”

源码镜像：[`../../src/utils/plugins/pluginStartupCheck.ts`](../../src/utils/plugins/marketplaceManager.ts)

实现顺序是：

- 先从 enabled set 里扣掉 installed set
- 再对剩下的 `pluginId` 并发 `getPluginById(pluginId)`
- 只有 marketplace lookup 成功的，才算真正 `missing`

这条过滤很重要，因为它把两类情况分开了：

- 插件只是没装到磁盘：可自动补装
- 插件根本不在任何 marketplace：这不是 startup bootstrap 能修的缺失

所以 startup install path 不会盲目尝试恢复一个已经从 catalog 消失的 plugin id。

## 5. `installSelectedPlugins()` 是一条旧式 bootstrap path，不是完整 dependency-aware install core

源码镜像：[`../../src/utils/plugins/pluginStartupCheck.ts`](../../src/utils/plugins/pluginInstallationHelpers.ts)

这条路径非常值得单独看，因为它和 `installResolvedPlugin()` 不一样。

它做的是：

- 对每个 `pluginId` 直接 `getPluginById()`
- external source 直接 `cacheAndRegisterPlugin(...)`
- local source 直接 `registerPluginInstallation(...)`
- 最后统一 `updateSettingsForSource(... enabledPlugins ...)`

它没有自己调用：

- `resolveDependencyClosure()`
- `installResolvedPlugin()`

所以这条路径的定位更像：

- “把已经确定应该存在的插件补到账上和磁盘”

而不是：

- “执行一次面向用户的新插件安装事务”

这也解释了为什么它主要被：

- `BrowseMarketplace`
- `DiscoverPlugins`
- `thinkback`

这类补装/快捷安装路径复用。

## 6. REPL 的 `useManagePlugins()` 是会话启动时的 Layer-3 初始装配，不是 refresh 通道

源码镜像：[`../../src/hooks/useManagePlugins.ts`](../../src/utils/plugins/pluginLoader.ts)

`useManagePlugins()` 在 mount 时做的是：

- `loadAllPlugins()`
- `detectAndUninstallDelistedPlugins()`
- flagged plugin notification
- `getPluginCommands()`
- `loadPluginAgents()`
- `loadPluginHooks()`
- `loadPluginMcpServers()`
- `loadPluginLspServers()`
- `reinitializeLspServerManager()`
- `setAppState.plugins`

它是：

- 首次 Layer-3 runtime assembly

不是：

- 日常刷新 API

注释也明确写了：

- post-mount refresh 全都走 `/reload-plugins -> refreshActivePlugins()`

## 7. `useManagePlugins()` 故意把首次装配和后续刷新拆开，是为了避免半刷新

源码镜像：[`../../src/hooks/useManagePlugins.ts`](../../src/utils/plugins/refresh.ts)

这条拆分不是架构洁癖，而是修一个真实坑：

- 以前自动 refresh 只清了 `loadAllPlugins` 一层缓存
- 但 downstream memoized loaders 还会吐旧 commands / agents / MCP state

所以现在：

- mount 时用 `useManagePlugins()` 做一次完整初始装配
- 磁盘状态变化后只 raise `needsRefresh`
- 真正换活跃 runtime 只让 `/reload-plugins` 做

这样用户 mental model 只有一套：

- “插件变了，但当前前台能力面还没切过去；跑 `/reload-plugins` 才会切”

## 8. `needsRefresh` 的处理策略是“提醒，不自动切换”

源码镜像：[`../../src/hooks/useManagePlugins.ts`](../../src/hooks/useManagePlugins.ts)

第二个 `useEffect` 的行为很克制：

- 如果 `needsRefresh`
- 只发一条 low-priority notification
- 内容是 `Plugins changed. Run /reload-plugins to activate.`

它不会：

- auto-refresh
- reset `needsRefresh`

因为消费这个 bit 的唯一合法路径就是：

- `/reload-plugins`

这让后台 marketplace reconcile、UI 安装、外部 settings 编辑都统一收束到同一条显式激活命令。

## 9. headless 路径和 REPL 路径共享“刷新核心”，但不共享状态宿主

源码镜像：[`../../src/cli/print.ts`](../../src/utils/plugins/refresh.ts)

`print.ts` 里的 headless path 也会跑 plugin 安装，但它的激活方式不一样：

- 后台先 `installPluginsForHeadless()`
- 如果有变化，`applyPluginMcpDiff()`
- 同步模式下再 `refreshPluginState()`

而 `refreshPluginState()` 内部又复用了：

- `refreshActivePlugins(setAppState)`

差异在于：

- REPL 直接靠 AppState 驱动前台
- headless 还维护 `currentCommands/currentAgents` 这类 query-loop 本地可变引用

所以共享的是 Layer-3 refresh 核心，不共享最终消费状态的宿主。

## 10. headless `refreshPluginState()` 还专门处理了 SDK-injected agents 的保留

源码镜像：[`../../src/cli/print.ts`](../../src/utils/processUserInput/processUserInput.ts)

`print.ts` 刷新完插件代理后，并不会直接把 `freshAgentDefs` 全量拿来替代当前 agent 列表，而是还会：

- 保留 `source === 'flagSettings'` 的 SDK-provided agents

原因是：

- 这些 agent 不是磁盘上的 plugin/markdown artifact
- 它们来自 SDK initialize control path

所以 headless refresh 的真实语义是：

- 用插件刷新覆盖 disk-loadable agents
- 但不冲掉宿主注入的 transient agents

## 11. `useOfficialMarketplaceNotification()` 是 startup sidecar 的 UI 包装，不是安装逻辑本体

源码镜像：[`../../src/hooks/useOfficialMarketplaceNotification.tsx`](../../src/hooks/useOfficialMarketplaceNotification.tsx), [`../../src/utils/plugins/officialMarketplaceStartupCheck.ts`](../../src/utils/plugins/officialMarketplaceStartupCheck.ts)

这个 hook 自己不决定是否安装 marketplace。它只是：

- 在 startup notification 机制里调用 `checkAndInstallOfficialMarketplace()`
- 然后把结果翻译成 bottom-right REPL 通知

只会显式通知三类东西：

- config save failed
- install success
- skipped + `reason === 'unknown'`

而不会提示：

- already installed
- policy blocked
- git unavailable

这说明它的目标不是完整解释启动状态，而是：

- 只把值得打扰用户的那几类 startup side effect 可视化

## 12. `useStartupNotification()` 把一大类 startup sidecar 统一成“只在本地 REPL 首次 mount 运行一次”

源码镜像：[`../../src/hooks/notifs/useStartupNotification.ts`](../../src/hooks/notifs/useStartupNotification.ts)

这个底座很小，但对行为约束非常关键：

- remote mode 直接跳过
- `hasRunRef` 保证一 session 只跑一次
- `compute()` 可以 sync 或 async
- 返回 `null / one / many notifications`
- rejection 统一走 `logError`

所以 `useOfficialMarketplaceNotification()` 真正继承到的是：

- local-only
- once-per-session
- startup sidecar queue

而不是随便一个 hook 就能在任何宿主里乱发通知。

## 13. CLI plugin commands 不是核心逻辑，它们主要负责 console + telemetry + exit semantics

源码镜像：[`../../src/services/plugins/pluginCliCommands.ts`](../../src/services/plugins/pluginOperations.ts)

`pluginCliCommands.ts` 的工作非常纯：

- 调 `installPluginOp / uninstallPluginOp / enablePluginOp / disablePluginOp / updatePluginOp`
- 打 console 文案
- 发 CLI 专用 telemetry
- 成功后 `process.exit(0)` 或 `gracefulShutdown(0)`
- 失败走统一 `handlePluginCommandError(...)`

也就是说 CLI 这层自己不发明任何插件状态机。它只是把 core result 变成：

- shell 友好的输出
- shell 友好的退出码

## 14. `handlePluginCommandError()` 把错误分类面也 CLI 化了

源码镜像：[`../../src/services/plugins/pluginCliCommands.ts`](../../src/utils/telemetry/pluginTelemetry.ts)

统一错误处理器会：

- `logError(error)`
- 打一条 `✗ Failed to ...`
- 用 `classifyPluginCommandError(error)` 发 `tengu_plugin_command_failed`
- 然后 `process.exit(1)`

所以 CLI 的错误 contract 不是“抛异常让外层兜底”，而是：

- 用户文案
- telemetry category
- process exit

三者捆成一个原子面。

## 15. update CLI 特意用 `gracefulShutdown(0)`，而不是裸 `process.exit(0)`

源码镜像：[`../../src/services/plugins/pluginCliCommands.ts`](../../src/utils/gracefulShutdown.ts)

前面的 install/uninstall/enable/disable 都是直接：

- `process.exit(0)`

但 `updatePluginCli()` 成功后走的是：

- `await gracefulShutdown(0)`

这说明 update path 默认更可能处在：

- 需要把尾部异步资源、安全清理、stdout flush 做完

的命令场景里，而不是一个最小副作用的同步结束点。

## 16. 这条链的总装配关系

源码镜像：[`../../src/utils/plugins/pluginStartupCheck.ts`](../../src/utils/plugins/pluginStartupCheck.ts), [`../../src/hooks/useManagePlugins.ts`](../../src/hooks/useManagePlugins.ts), [`../../src/hooks/useOfficialMarketplaceNotification.tsx`](../../src/hooks/useOfficialMarketplaceNotification.tsx), [`../../src/hooks/notifs/useStartupNotification.ts`](../../src/hooks/notifs/useStartupNotification.ts), [`../../src/services/plugins/pluginCliCommands.ts`](../../src/services/plugins/pluginCliCommands.ts), [`../../src/cli/print.ts`](../../src/cli/print.ts)

可以把这套操作面收成 6 层：

1. `pluginStartupCheck.ts`
作用：回答 enabled truth、editable scope、installed truth、missing truth，并提供一条轻量 bootstrap install path。

2. `useManagePlugins.ts`
作用：在 REPL mount 时把插件真正装配成 Layer-3 runtime，并把“磁盘已变、前台未激活”固化成 `needsRefresh` 通知协议。

3. `print.ts`
作用：在 headless 宿主里复用 refresh 核心，但把结果写回 query-loop 可变引用而不是 REPL 前台组件树。

4. `useStartupNotification.ts`
作用：给 startup sidecar 一套 local-only、once-per-session 的通知调度底座。

5. `useOfficialMarketplaceNotification.tsx`
作用：把 official marketplace startup materializer 的少数值得打扰用户的结果翻译成 REPL 通知。

6. `pluginCliCommands.ts`
作用：把 core plugin ops 变成 shell-facing command surface，补上 console、telemetry、exit semantics。

所以 `mechanisms/45`、`46`、`47` 三篇现在分别覆盖：

- `45`：依赖、refresh、active runtime
- `46`：reconcile、install path、startup materialization
- `47`：startup detection、REPL/headless activation、CLI control surface

到这里，插件体系已经基本从“总述”拆到了可操作的实现级百科。
