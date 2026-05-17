# Settings Change Detection / Hot Reload Consumers

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Remote Managed Settings Loading / Polling / Hot Reload`](./38-remote-managed-settings-loading-polling-and-hot-reload.md) | [`下一站：Policy Settings Runtime Governance`](./40-policy-settings-runtime-governance-across-env-hooks-permissions-mcp-and-plugins.md)

本文不再讲 settings 文件长什么样，而是讲 Claude Code 怎样把“设置变了”这件事变成一条统一运行时链。主问题是：

- 哪些变更源会进入同一个 settings event bus
- 为什么 `changeDetector` 必须负责单点 cache reset
- React/TUI、headless、sandbox、plugin hooks 怎样消费同一条变更
- 哪些 consumer 会做差分热更新，哪些只做全量重读

对应源码主链是：`utils/settings/changeDetector.ts + hooks/useSettingsChange.ts + state/AppState.tsx + utils/settings/applySettingsChange.ts + cli/print.ts + utils/sandbox/sandbox-adapter.ts + utils/plugins/loadPluginHooks.ts`，以及几个轻量 UI consumer。

## 1. `changeDetector` 不是文件 watcher，而是 settings runtime 的统一变更总线

源码镜像：[`../../sources/claude-code/src/utils/settings/changeDetector.ts`](../../sources/claude-code/src/utils/settings/changeDetector.ts)

它统一接了四类来源：

- 普通 settings 文件的 `change/add/unlink`
- `managed-settings.d/` drop-in JSON 目录
- MDM/HKCU 这种不能直接 watch 的轮询来源
- `notifyChange(source)` 触发的程序内变更

所以这层的真实定位不是 I/O 辅助，而是“把多宿主、多来源 settings 变化收敛成 `SettingSource -> listeners` 的总线”。

## 2. watcher 只盯“可能成为 settings truth 的路径”，不是盲扫目录

源码镜像：[`../../sources/claude-code/src/utils/settings/changeDetector.ts`](../../sources/claude-code/src/utils/settings/changeDetector.ts)

`getWatchTargets()` 会：

- 先按 `SETTING_SOURCES` 收集潜在 settings 文件
- 只 watch 当前至少已有一个真实 settings 文件的目录
- 额外挂 `managed-settings.d/` 目录，允许其中任意 `.json` 片段映射到 `policySettings`
- 跳过 `flagSettings`，因为 CLI temp path 不属于会话内可变配置

这说明 Claude Code 的设置探测不是“目录里任何文件都算配置”，而是严格按 settings topology 选 watch target。

## 3. delete-and-recreate 被当成一等写入模式处理，不会被误判成两次独立变化

源码镜像：[`../../sources/claude-code/src/utils/settings/changeDetector.ts`](../../sources/claude-code/src/utils/settings/changeDetector.ts)

`handleDelete()` 不会立刻广播，而是进一个 `DELETION_GRACE_MS` 窗口。若随后出现 `add/change`：

- 取消 pending deletion
- 把这次操作当普通 change 处理

这是在适配原子写、auto-updater、另一 session 重建 settings 文件这类常见模式，避免会话先“吃到删除”再“吃到重建”。

## 4. internal write suppression 说明它既监听外部改动，也监听自己写出的文件

源码镜像：[`../../sources/claude-code/src/utils/settings/changeDetector.ts`](../../sources/claude-code/src/utils/settings/changeDetector.ts)

`consumeInternalWrite(path, INTERNAL_WRITE_WINDOW_MS)` 这层非常关键。Claude Code 不是假设“所有文件变化都来自别人”，而是承认：

- 自己改配置也会回打 watcher
- 但这类变化不应再次触发一轮完整 runtime 热更新

所以它显式维护 internal-write 窗口，避免自写自触发形成反馈回路。

## 5. ConfigChange hooks 在 event bus 前面，不在 consumer 后面

源码镜像：[`../../sources/claude-code/src/utils/settings/changeDetector.ts`](../../sources/claude-code/src/utils/settings/changeDetector.ts)

无论是 change 还是 delete，流程都会先：

- 把 `SettingSource` 映成 `ConfigChangeSource`
- 跑 `executeConfigChangeHooks(...)`
- 若 hook 返回 block，则不广播

所以 settings 变更不是“先应用再让 hook 补救”，而是先经过 hook gate，再决定这次变更能不能进入 session truth。

## 6. `fanOut()` 里的单点 `resetSettingsCache()` 是这条链的核心收口

源码镜像：[`../../sources/claude-code/src/utils/settings/changeDetector.ts`](../../sources/claude-code/src/utils/settings/changeDetector.ts)

这条注释写得很直：cache reset 必须在 producer 端完成，而不能交给 N 个 listener 各自做。否则会变成：

1. listener A 清 cache，重读磁盘
2. listener B 再清 cache，再重读磁盘
3. 同一轮通知造成 N 次磁盘重装

所以 `fanOut(source)` 的真实职责不是“emit 一下”，而是：

- 先让 merged settings cache 全局失效
- 再保证所有 consumer 都读到同一轮 fresh state

## 7. `useSettingsChange()` 是 React 宿主的薄适配层，不再自己做 cache 管理

源码镜像：[`../../sources/claude-code/src/hooks/useSettingsChange.ts`](../../sources/claude-code/src/hooks/useSettingsChange.ts)

这个 hook 现在只做两件事：

- 订阅 `settingsChangeDetector`
- 在回调里 `getSettings_DEPRECATED()` 后把 fresh settings 交给上层

它不再 reset cache，因为 cache 已由 `fanOut()` 集中失效。也就是说，React consumer 被刻意压成“只读总线结果”的薄层。

## 8. `AppStateProvider` 才是 TUI 侧真正把 settings 变化转成运行态的地方

源码镜像：[`../../sources/claude-code/src/state/AppState.tsx`](../../sources/claude-code/src/state/AppState.tsx), [`../../sources/claude-code/src/utils/settings/applySettingsChange.ts`](../../sources/claude-code/src/utils/settings/applySettingsChange.ts)

TUI 路径不是每个组件各自读磁盘。真正的主链是：

1. `useSettingsChange(onSettingsChange)`
2. `onSettingsChange -> applySettingsChange(source, store.setState)`
3. `AppState.settings + toolPermissionContext` 一起更新
4. 所有 React consumer 改为读 `AppState`

这意味着 TUI 里 settings hot reload 的标准入口不是组件级 `getSettings_DEPRECATED()`，而是 store 级 state transition。

## 9. `applySettingsChange()` 不只是换一份 settings，还会重建权限与 hooks 运行态

源码镜像：[`../../sources/claude-code/src/utils/settings/applySettingsChange.ts`](../../sources/claude-code/src/utils/settings/applySettingsChange.ts)

这个函数会同步做几件事：

- `getInitialSettings()` 重读 merged settings
- `loadAllPermissionRulesFromDisk()` 重建规则集
- `updateHooksConfigSnapshot()` 刷新 hooks snapshot
- `syncPermissionRulesFromDisk(...)` 回写 tool permission context
- 在 ant 路径重新剥离 overly broad bash allow rules
- 必要时禁用 bypass permissions
- `transitionPlanAutoMode(...)`

所以 settings change 在 Claude Code 里不是“换配置对象”，而是触发一轮 permission/hooks/policy runtime 重装。

## 10. `AppStateProvider` 还有一条 mount-time race 修补，只为处理“settings 先到、React 后挂”

源码镜像：[`../../sources/claude-code/src/state/AppState.tsx`](../../sources/claude-code/src/state/AppState.tsx)

它在 mount 时会额外检查：

- `toolPermissionContext.isBypassPermissionsModeAvailable`
- `isBypassPermissionsModeDisabled()`

如果 remote managed settings 在 React tree 挂载前就已经到了，初次通知可能没有 listener；这段 mount-only effect 会把 bypass mode 的禁用状态补进当前 store。说明这条热更新链明确处理了“早到的 policySettings”竞态。

## 11. `useSettings()` 说明 React 侧推荐读法已经切到 AppState，而不是直接打 settings loader

源码镜像：[`../../sources/claude-code/src/hooks/useSettings.ts`](../../sources/claude-code/src/hooks/useSettings.ts)

`useSettings()` 只是：

- `return useAppState(s => s.settings)`

这很简单，但含义很重要：在 React 宿主里，settings 真相已经被定义成 AppState slice，而不是随处直接 `getSettings_DEPRECATED()`。

## 12. headless `print.ts` 走的是同一条总线，但必须自己订阅

源码镜像：[`../../sources/claude-code/src/cli/print.ts`](../../sources/claude-code/src/cli/print.ts), [`../../sources/claude-code/src/utils/settings/applySettingsChange.ts`](../../sources/claude-code/src/utils/settings/applySettingsChange.ts)

因为 headless 模式没有 React tree，也就没有 `useSettingsChange()`。所以它直接：

- `settingsChangeDetector.subscribe(source => { ... })`
- 调 `applySettingsChange(source, setAppState)`
- 额外同步 denormalized `fastMode` 顶层字段

也就是说，headless 和 TUI 共享的是 `applySettingsChange()` 这层状态装配逻辑，但订阅宿主不同。

## 13. sandbox 是“全量热更新 consumer”，不做字段级差分

源码镜像：[`../../sources/claude-code/src/utils/sandbox/sandbox-adapter.ts`](../../sources/claude-code/src/utils/sandbox/sandbox-adapter.ts)

初始化完成后，sandbox 会订阅 settings 变化，并在每次通知时：

- `getSettings_DEPRECATED()`
- `convertToSandboxRuntimeConfig(settings)`
- `BaseSandboxManager.updateConfig(newConfig)`

它不关心是 `policySettings` 还是 `userSettings`，也不关心是不是只有 plugin 政策变了。它的策略是收到 settings 事件就整份重算 sandbox runtime config。

## 14. plugin hooks 是“差分热更新 consumer”，只盯 plugin-affecting settings

源码镜像：[`../../sources/claude-code/src/utils/plugins/loadPluginHooks.ts`](../../sources/claude-code/src/utils/plugins/loadPluginHooks.ts)

`setupPluginHookHotReload()` 不会看到任何 `policySettings` 变化就 reload。它会先做 snapshot：

- `enabledPlugins`
- `extraKnownMarketplaces`
- `strictKnownMarketplaces`
- `blockedMarketplaces`

只有新旧 snapshot 真变了，才：

- `clearPluginCache(...)`
- `clearPluginHookCache()`
- `loadPluginHooks()`

所以 plugin 子系统不是粗暴订阅 settings 总线，而是在总线之上再做一层“只对 plugin-affecting policy 敏感”的二级差分。

## 15. 轻量 UI consumer 走的是同一条反应式链，但只消费局部副作用

源码镜像：[`../../sources/claude-code/src/components/hooks/HooksConfigMenu.tsx`](../../sources/claude-code/src/components/hooks/HooksConfigMenu.tsx), [`../../sources/claude-code/src/hooks/notifs/useSettingsErrors.tsx`](../../sources/claude-code/src/hooks/notifs/useSettingsErrors.tsx)

这类 consumer 不重装 whole runtime，只做局部反馈：

- `HooksConfigMenu` 只在 `policySettings` 变动时刷新 `disableAllHooks / allowManagedHooksOnly`
- `useSettingsErrors()` 重新收集 validation errors，并决定是否推 `/doctor` 通知

这说明同一条 settings 总线上既挂大 consumer，也挂小 consumer；前者重装运行态，后者只刷新可视反馈。

## 16. 为什么这条链值得单独成卷

如果只看前几卷，很容易把 settings 热更新理解成：

- 远端策略层负责拉配置
- React hook 负责“感知一下变化”

但真正的实现分层更严格：

- `changeDetector` 负责统一探测、hook gate、单点 cache reset、事件广播
- `applySettingsChange` 负责把 fresh settings 变成 permission/hooks/store 运行态
- TUI / headless / sandbox / plugin hooks / 局部 UI 各自作为不同粒度的 consumer 挂到同一条总线

因此 Claude Code 的 settings hot reload 不是“文件改了就重渲染”，而是一套跨宿主、跨运行时层级的变更传播协议。
