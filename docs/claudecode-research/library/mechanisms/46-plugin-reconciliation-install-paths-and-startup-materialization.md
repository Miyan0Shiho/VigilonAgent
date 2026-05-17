# Plugin Reconciliation / Install Paths / Startup Materialization

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Plugin Dependency / Marketplace Refresh / Active Runtime`](./45-plugin-dependency-marketplace-refresh-and-active-runtime.md) | [`下一站：Plugin Startup Detection / Headless Activation / CLI Control Surfaces`](./47-plugin-startup-detection-headless-activation-and-cli-control-surfaces.md)

这一卷补的是插件系统里另一半真正决定“东西有没有被装到磁盘、什么时候会自动补齐、什么时候只写 intent 不动 active runtime”的链：

- marketplace reconcile 怎么把 settings intent 变成 materialized source
- plugin install core 怎么把 dependency closure 一次性写进 settings 再落盘
- CLI/UI/headless/startup 这几条安装路径到底共享哪些核心逻辑
- versioned cache / zip cache / orphan 标记 / seed marketplace 怎样拼成真实启动物化链

对应源码主链是：`utils/plugins/reconciler.ts + utils/plugins/pluginInstallationHelpers.ts + services/plugins/pluginOperations.ts + utils/plugins/headlessPluginInstall.ts + utils/plugins/officialMarketplaceStartupCheck.ts`。

## 1. marketplace reconciler 不是 refresh，而是“声明意图到账面状态”的对账器

源码镜像：[`../../src/utils/plugins/reconciler.ts`](../../src/utils/plugins/reconciler.ts)

`reconciler.ts` 一开头就把职责切成两层：

- `diffMarketplaces()`：只做 declared intent 和 materialized JSON 的比较
- `reconcileMarketplaces()`：把 diff 结果真正变成安装/更新动作

它不碰 AppState，也不直接参与 `/reload-plugins`。所以这层属于：

- Layer 1.5：settings intent 到 marketplace materialization 的桥

而不是 Layer-3 active plugin runtime。

## 2. `diffMarketplaces()` 比的是“声明源”和“已物化源”，不是是否能联网

源码镜像：[`../../src/utils/plugins/reconciler.ts`](../../src/utils/plugins/reconciler.ts)

`MarketplaceDiff` 只分三类：

- `missing`
- `sourceChanged`
- `upToDate`

也就是说它关心的是：

- `known_marketplaces.json` 里有没有这条 entry
- materialized `source` 和 settings 里的 declared `source` 是否还是同一个

它不在这一层测试 git clone、plugin 可读性、下游插件版本是否需要更新。那些都属于更后面的 materialization 或 active-load 阶段。

## 3. fallback marketplace 的语义是“存在即可”，不是“必须和当前 declared source 一致”

源码镜像：[`../../src/utils/plugins/reconciler.ts`](../../src/utils/plugins/reconciler.ts)

`intent.sourceIsFallback` 这一分支很关键：

- 如果 marketplace 只是 fallback source
- 那么 materialized 后只要存在就算 `upToDate`
- 不再继续比 declared source 和 current source

这个设计避免了一个很实际的问题：

- seed image、mirror、之前的 clone 都可能已经把 marketplace 物化好了
- 如果还硬比 source，就会把“可用的现成物化结果”误判成 `sourceChanged`
- 然后重新 clone，反而踩坏 seed / mirror 的节流价值

## 4. `normalizeSource()` 的工作重点是 worktree canonicalization，不只是补绝对路径

源码镜像：[`../../src/utils/plugins/reconciler.ts`](../../src/utils/plugins/reconciler.ts)

这里不是简单 `resolve("./foo")`，而是：

- 对 `directory/file` 源做绝对路径化
- 并且优先解析到 canonical git root，而不是当前 worktree cwd

原因是：

- project settings 会被提交进 repo
- `known_marketplaces.json` 却是 user-global
- 如果每个 worktree 都把 `./marketplace` 写成自己当前 worktree 的绝对路径
- 共享 JSON 就会不断被不同 checkout 覆盖

所以 reconcile 层其实顺手修掉了多 worktree 下 marketplace source 漂移的问题。

## 5. `reconcileMarketplaces()` 是 additive-only，对账成功不代表会做删除

源码镜像：[`../../src/utils/plugins/reconciler.ts`](../../src/utils/plugins/reconciler.ts)

`reconcileMarketplaces()` 的 contract 写得很死：

- idempotent
- additive only
- never deletes

具体动作只有：

- 对 `missing` 做 `install`
- 对 `sourceChanged` 做 `update`
- 对 `upToDate` 不动

所以把一个 marketplace 从 settings 删掉，并不会靠这层自动删磁盘；这层只负责“把声明过的变成真实存在”，不负责垃圾回收。

## 6. sourceChanged 的本地路径更新还有一层“死路径保护”

源码镜像：[`../../src/utils/plugins/reconciler.ts`](../../src/utils/plugins/reconciler.ts)

`toProcess` 过滤时有个很重要的 guard：

- 仅当 `action === 'update'`
- 且 source 是 local path
- 且 declared path 当前不存在

这时不会报 failed，而是：

- 直接 `skipped`
- 保留当前 materialized entry

这解决的是多 checkout / worktree 里最容易出现的误伤：

- 新 session 计算出的 declared path 临时不可达
- 但用户原来 materialized 的 marketplace 其实还是好好的

reconciler 选择“保工作条目，不制造噪音失败”。

## 7. plugin install core 是严格的 settings-first，不是先下载再写 intent

源码镜像：[`../../src/utils/plugins/pluginInstallationHelpers.ts`](../../src/utils/plugins/pluginInstallationHelpers.ts)

`installResolvedPlugin()` 的顺序非常明确：

1. policy guard
2. dependency closure resolve
3. transitive dependency policy guard
4. 一次性把整个 closure 写进 `enabledPlugins`
5. 再逐个 materialize/cache closure 成员
6. `clearAllCaches()`

也就是说插件安装的“动作真相”是：

- settings 写入先发生
- 磁盘缓存是随后的物化步骤

所以 Claude Code 的插件安装语义和 task/command 一样，都是：

- settings / intent 优先
- materialization 尽量追上

## 8. 本地源插件如果拿不到 marketplace install location，会被 install core 直接拒绝

源码镜像：[`../../src/utils/plugins/pluginInstallationHelpers.ts`](../../src/utils/plugins/pluginInstallationHelpers.ts)

这条 guard 不是多余防御，而是在补一个真实 silent-noop 坑：

- local-source root plugin 如果没有 marketplace install location
- `depInfo` 就无法 seed
- 后面 materialize loop 会因为 `if (!info) continue` 跳过 root
- 用户看到的是“install success”，但磁盘上其实什么都没缓存

所以现在 install core 直接返回：

- `local-source-no-location`

把这个坑在共享核心层封死，CLI 和 UI 都一起受益。

## 9. dependency closure 的解析和落盘是“整包原子写意图，逐个物化文件”

源码镜像：[`../../src/utils/plugins/pluginInstallationHelpers.ts`](../../src/utils/plugins/pluginInstallationHelpers.ts), [`../../src/utils/plugins/dependencyResolver.ts`](../../src/utils/plugins/dependencyResolver.ts)

`installResolvedPlugin()` 先构造：

- `closureEnabled: Record<string, true>`

然后一次 `updateSettingsForSource(...)` 把整个 closure 写进去。后面才是：

- 对每个 `id` 找 `depInfo`
- local source 先 `validatePathWithinBase(...)`
- `cacheAndRegisterPlugin(...)`

这意味着它保证的是：

- intent 层原子

但不保证：

- closure 每个成员的物化层原子提交

如果中途 materialize 某个成员失败，settings 已经表达了“应该启用整组插件”，后续 loader/reconcile/refresh 会继续尝试把磁盘状态追平。

## 10. `cacheAndRegisterPlugin()` 真正做的是“算版本号 -> 搬到 versioned path -> 选配 zip 化 -> 记双注册表”

源码镜像：[`../../src/utils/plugins/pluginInstallationHelpers.ts`](../../src/utils/plugins/pluginInstallationHelpers.ts), [`../../src/utils/plugins/pluginLoader.ts`](../../src/utils/plugins/pluginLoader.ts)

这不是单纯的“复制到 cache 目录”。真实链条是：

- `cachePlugin(source, {manifest})`
- 拿 `gitCommitSha`
- `calculatePluginVersion(...)`
- 算 `getVersionedCachePath(pluginId, version)`
- 必要时把临时 cache 路径 `rename` 到 versioned path
- 开启 zip cache 时再 `convertDirectoryToZipInPlace(...)`
- 最后 `addInstalledPlugin(...)`

这里有两个很重要的实现点：

- versioned path 才是稳定 installPath，临时 cache 路径不是
- `installed_plugins` 记录的是 versioned directory 或 zip file，不是 source repo 位置

## 11. versioned move 里专门处理了“目标路径是源路径子目录”的自嵌套坑

源码镜像：[`../../src/utils/plugins/pluginInstallationHelpers.ts`](../../src/utils/plugins/pluginInstallationHelpers.ts), [`../../src/utils/plugins/pluginLoader.ts`](../../src/utils/plugins/pluginLoader.ts)

注释里点名了这种情况：

- marketplace 名和 plugin 名相同
- `versionedPath` 可能变成 `cacheResult.path` 的子目录

这时不能直接 `rename(dir, dir/subdir)`，所以实现改成：

- 先挪到同文件系统里的 tempPath
- 再从 tempPath 挪到 versionedPath

这个细节说明插件 materialization 处理的不是“逻辑正确就行”，而是已经处理到实际 filesystem move 语义了。

## 12. CLI/UI 只是 wrapper，真正的安装/启停/卸载语义都汇到 `pluginOperations.ts`

源码镜像：[`../../src/services/plugins/pluginOperations.ts`](../../src/services/plugins/pluginOperations.ts), [`../../src/utils/plugins/pluginInstallationHelpers.ts`](../../src/utils/plugins/pluginInstallationHelpers.ts)

`pluginOperations.ts` 的角色不是另起一套逻辑，而是：

- `installPluginOp()`：负责 marketplace search 和用户向错误文案
- `uninstallPluginOp()`：负责 scope、delisted fallback、orphan 标记、data/pluginOptions 清理
- `setPluginEnabledOp()`：负责 scope 解析、override 语义、policy block、idempotency

但真正的共享 install core 仍然是：

- `installResolvedPlugin()`

所以这层更像：

- UX shell + scope/persistence rules

而不是 plugin install engine 本身。

## 13. 卸载不是简单删 settings，它还要处理 orphan version、plugin options 和 data dir

源码镜像：[`../../src/services/plugins/pluginOperations.ts`](../../src/services/plugins/pluginOperations.ts)

`uninstallPluginOp()` 做完 settings 删除和 `removePluginInstallation(...)` 之后，还会：

- 判断这是不是该 plugin 的最后一个 scope installation
- 如果是，`markPluginVersionOrphaned(installPath)`
- `deletePluginOptions(pluginId)`
- 可选 `deletePluginDataDir(pluginId)`

所以 Claude Code 的卸载语义其实分三层：

- intent：从 enabledPlugins 里删
- installation registry：从 installed_plugins_v2 里删
- residual runtime data：标 orphan、清 options、清 data

这也是为什么它不会被写成 settings merge 的小 helper。

## 14. enable/disable 也是 settings-first，而且允许“高优先级 scope 覆盖低优先级 scope”

源码镜像：[`../../src/services/plugins/pluginOperations.ts`](../../src/services/plugins/pluginOperations.ts), [`../../src/utils/settings/settings.ts`](../../src/utils/settings/settings.ts)

`setPluginEnabledOp()` 有两个容易被误读的设计：

- 它不要求先在 installed_plugins 里找得到才允许 enable
- 它允许在更高优先级 scope 写一个显式布尔值去覆盖更低 scope

所以：

- `disable --scope local` 可以用来遮住 project scope 的启用
- 这不是“插件已安装在 local scope”，而是“local settings 获得了更高优先级的 intent”

这和 plugin runtime 的 precedence 设计是对齐的。

## 15. headless 安装路径的核心不是“自己再装插件”，而是“先 reconcile marketplace，再让后续 loader 发现插件”

源码镜像：[`../../src/utils/plugins/headlessPluginInstall.ts`](../../src/utils/plugins/headlessPluginInstall.ts), [`../../src/utils/plugins/reconciler.ts`](../../src/utils/plugins/reconciler.ts)

`installPluginsForHeadless()` 这条链刻意没有直接 materialize 每个 plugin，而是：

- 先 `registerSeedMarketplaces()`
- 再 `reconcileMarketplaces(...)`
- 新 marketplace 落地后清 `clearMarketplacesCache()` / `clearPluginCache(...)`
- 然后依赖后续 `refreshPluginState() -> loadAllPlugins()` 去发现并缓存插件

这说明 headless 模式下的“安装插件”其实主要是：

- 保证 marketplace state 和 seed/zip cache 同步

而不是马上做完整 active runtime swap。

## 16. seed marketplace 在 headless 里是第一公民，不是 reconcile 前的小优化

源码镜像：[`../../src/utils/plugins/headlessPluginInstall.ts`](../../src/utils/plugins/headlessPluginInstall.ts), [`../../src/utils/plugins/marketplaceManager.ts`](../../src/utils/plugins/marketplaceManager.ts)

`registerSeedMarketplaces()` 发生在 reconcile 之前，而且一旦 `seedChanged`：

- 清 market cache
- 清 plugin cache
- 把 `pluginsChanged = true`

原因很直接：

- CLI startup 早期可能已经跑过一遍 plugin load
- 如果 seed 这时才注册进去，不清缓存，后面的 init message 仍会看到“0 commands/agents/skills”

所以 seed 不是加速层，而是会影响当前进程 capability truth 的 source。

## 17. headless zip-cache 模式下，reconcile 还带 source-type 过滤

源码镜像：[`../../src/utils/plugins/headlessPluginInstall.ts`](../../src/utils/plugins/headlessPluginInstall.ts), [`../../src/utils/plugins/zipCache.ts`](../../src/utils/plugins/zipCache.ts)

zip cache 模式传给 `reconcileMarketplaces()` 一个 `skip(...)`：

- 不支持 zip cache 的 marketplace source 直接 skip

这说明 “declared marketplace” 和 “headless 宿主可物化 marketplace” 不是同义词。某些 source 在交互式环境可行，但在 CCR/zip-cache runtime 里不是合法 materialization target。

## 18. `officialMarketplaceStartupCheck` 的重点是 retryable materialization，而不是 UI 推荐

源码镜像：[`../../src/utils/plugins/officialMarketplaceStartupCheck.ts`](../../src/utils/plugins/officialMarketplaceStartupCheck.ts), [`../../src/utils/plugins/marketplaceManager.ts`](../../src/utils/plugins/marketplaceManager.ts)

这条启动链做的是：

- 看 global config 是否已尝试/已成功/是否到下次重试时间
- 看 env kill-switch
- 看 policy allow
- 先试 GCS mirror
- 再按 flag 决定是否 git fallback
- 记录 retry metadata / backoff

所以它更像：

- startup-time managed materializer

而不是产品层的“推荐装官方 marketplace”。

## 19. 官方 marketplace auto-install 的状态语义是“尝试历史 + 回退计划”，不只是成功/失败布尔值

源码镜像：[`../../src/utils/plugins/officialMarketplaceStartupCheck.ts`](../../src/utils/plugins/officialMarketplaceStartupCheck.ts), [`../../src/utils/plugins/officialMarketplaceGcs.ts`](../../src/utils/plugins/officialMarketplaceGcs.ts)

`GlobalConfig` 里存的不只是：

- attempted
- installed

还有：

- `officialMarketplaceAutoInstallFailReason`
- `officialMarketplaceAutoInstallRetryCount`
- `officialMarketplaceAutoInstallLastAttemptTime`
- `officialMarketplaceAutoInstallNextRetryTime`

这说明官方 marketplace 的 install path 已经是个小型状态机：

- 临时失败会指数退避
- policy block 是永久失败
- git/GCS 不可用是可恢复失败

## 20. macOS `xcrun` 假 git 被当成“git_unavailable”，而不是普通 install error

源码镜像：[`../../src/utils/plugins/officialMarketplaceStartupCheck.ts`](../../src/utils/plugins/officialMarketplaceStartupCheck.ts), [`../../src/utils/plugins/gitAvailability.ts`](../../src/utils/plugins/gitAvailability.ts)

这里专门捕了：

- `xcrun: error: ...`

然后：

- `markGitUnavailable()`
- 不把它算一般 clone failure
- 直接当 `git_unavailable`

这是一个很产品化的错误语义修正：

- `/usr/bin/git` 在 macOS 上可能只是 shim
- `which git` 通过，不代表真的能 clone

官方 marketplace 启动安装链把这个宿主级假阳性单独矫正掉了。

## 21. 这条链的总装配关系

源码镜像：[`../../src/utils/plugins/reconciler.ts`](../../src/utils/plugins/reconciler.ts), [`../../src/utils/plugins/pluginInstallationHelpers.ts`](../../src/utils/plugins/pluginInstallationHelpers.ts), [`../../src/services/plugins/pluginOperations.ts`](../../src/services/plugins/pluginOperations.ts), [`../../src/utils/plugins/headlessPluginInstall.ts`](../../src/utils/plugins/headlessPluginInstall.ts), [`../../src/utils/plugins/officialMarketplaceStartupCheck.ts`](../../src/utils/plugins/officialMarketplaceStartupCheck.ts)

可以把这半套插件系统收成 5 层：

1. `reconciler.ts`
作用：把 declared marketplace intent 追到账面 materialization

2. `pluginInstallationHelpers.ts`
作用：把 resolved plugin closure 写入 settings 并落成 versioned install

3. `pluginOperations.ts`
作用：把 CLI/UI scope、卸载、enable/disable、delisted fallback 包成用户可操作语义

4. `headlessPluginInstall.ts`
作用：在无 UI 宿主里先同步 marketplace/seed/zip-cache 状态，再让后续 loader 接管插件发现

5. `officialMarketplaceStartupCheck.ts`
作用：把官方 marketplace 的首次引导物化做成带 retry/backoff/policy/GCS fallback 的启动期 sidecar

所以 `mechanisms/45` 讲的是：

- marketplace refresh 和 active runtime swap

而这一卷补上的是：

- startup / install / reconcile / uninstall 这条 materialization 主链

两篇合起来，插件系统才算真正闭环。
