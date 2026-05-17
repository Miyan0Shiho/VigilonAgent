# Theme Preview 与 Appearance Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Search / Select / Typeahead Primitives`](./12-search-select-and-typeahead-primitives.md) | [`下一站：命令注册表`](../commands/01-command-registry-and-dispatch.md)

本文把 `ThemeProvider`、`ThemePicker`、`systemTheme` / `systemThemeWatcher`、`ink.ts` 包装层，以及 Settings / Onboarding 对主题选择器的接入方式拆成一卷，说明 Claude Code 的主题系统不是“改个配色值”，而是一条带预览态、提交态、auto 解析、快捷键作用域和多入口复用的 appearance runtime。

## 1. 主题系统的核心不是 palette，而是“保存态 / 预览态 / 解析态”三层分离

源码镜像：[`../../sources/claude-code/src/components/design-system/ThemeProvider.tsx`](../../sources/claude-code/src/components/design-system/ThemeProvider.tsx), [`../../sources/claude-code/src/utils/systemTheme.ts`](../../sources/claude-code/src/utils/systemTheme.ts)

`ThemeProvider` 一上来就把主题拆成三层：

- `themeSetting`：用户真实保存的配置，允许是 `auto`
- `previewTheme`：ThemePicker 打开期间的临时预览值
- `currentTheme`：真正拿去渲染的具体主题，永远不会是 `auto`

这意味着 Claude Code 不把“当前正在看到的效果”和“已经落盘的配置”视为同一回事。用户在 picker 里上下移动时，界面可以实时切换主题，但只要还没确认，配置文件就不应该被提交。

## 2. `ThemeProvider` 是一个带提交语义的状态机，不只是 React context

源码镜像：[`../../sources/claude-code/src/components/design-system/ThemeProvider.tsx`](../../sources/claude-code/src/components/design-system/ThemeProvider.tsx)

它暴露出来的接口不是一个简单 `setTheme`，而是一组显式动作：

- `setThemeSetting(setting)`：直接提交主题配置
- `setPreviewTheme(setting)`：只改预览，不落盘
- `savePreview()`：把预览值提升为正式配置
- `cancelPreview()`：丢弃预览，回退到已保存配置
- `useTheme()`：返回渲染用的 resolved theme 与正式 setter
- `useThemeSetting()`：返回原始配置值，保留 `auto`

这套接口设计非常说明问题：Claude Code 把主题切换建模成“可预演的事务”，而不是 UI 直接改全局状态。

## 3. `ink.ts` 把 ThemeProvider 提升成全局渲染外壳

源码镜像：[`../../sources/claude-code/src/ink.ts`](../../sources/claude-code/src/ink.ts)

`ink.ts` 里的 `withTheme(node)` 会把所有 `render()` 和 `createRoot().render()` 调用统一包进 `ThemeProvider`。这样做有两个直接后果：

- `ThemedBox` / `ThemedText` 不需要每个页面自己 mount provider
- 主题不是某个单页功能，而是整套终端 UI 的基础渲染环境

所以主题运行时并不属于 Settings 页面，它在渲染入口层就是一等基础设施。

## 4. `auto` 不是跟随 OS，而是跟随“终端实际背景”

源码镜像：[`../../sources/claude-code/src/utils/systemTheme.ts`](../../sources/claude-code/src/utils/systemTheme.ts), [`../../sources/claude-code/src/components/design-system/ThemeProvider.tsx`](../../sources/claude-code/src/components/design-system/ThemeProvider.tsx)

这条实现链最关键的判断是：`auto` 解析看的是 terminal background，不是操作系统的 light/dark mode。

`systemTheme.ts` 明确做了三件事：

- 先用 `$COLORFGBG` 给出同步初值
- 用模块级 `cachedSystemTheme` 缓存当前终端主题
- 提供 `resolveThemeSetting()` 和 `themeFromOscColor()` 把 `auto` 解析到 `dark/light`

而 `ThemeProvider` 只要发现当前 active setting 是 `auto`，就会把 `currentTheme` 解析成缓存中的 terminal theme。这意味着一个“系统亮色但终端深色”的环境里，Claude Code 会坚持用深色主题，因为它服务的是终端可读性，不是桌面外观一致性。

## 5. live watcher 只在 `auto` 激活时才挂上

源码镜像：[`../../sources/claude-code/src/components/design-system/ThemeProvider.tsx`](../../sources/claude-code/src/components/design-system/ThemeProvider.tsx)

`ThemeProvider` 不会一直监听终端背景变化，而是满足以下条件才动态 import watcher：

- `feature('AUTO_THEME')` 打开
- `activeSetting === 'auto'`
- `useStdin()` 提供了 `internal_querier`

然后它才 `import('../../utils/systemThemeWatcher')` 并调用 `watchSystemTheme(...)`。这条链说明：

- auto theme 是 feature-gated 能力，不是假定所有构建都支持
- watcher 是按需加载的，不给普通固定主题用户增加运行时负担
- 终端主题探测依赖底层 querier，因此它是 terminal protocol 能力，不是纯前端逻辑

## 6. `auto` 的预览和提交都做了“先种缓存再等 watcher”防闪烁

源码镜像：[`../../sources/claude-code/src/components/design-system/ThemeProvider.tsx`](../../sources/claude-code/src/components/design-system/ThemeProvider.tsx), [`../../sources/claude-code/src/utils/systemTheme.ts`](../../sources/claude-code/src/utils/systemTheme.ts)

无论是：

- `setThemeSetting('auto')`
- 还是 `setPreviewTheme('auto')`

`ThemeProvider` 都会立刻调用 `getSystemThemeName()` 先把 `systemTheme` 设成缓存值，再等待 watcher 的首次 OSC 11 轮询结果。源码注释直接点明目标：避免 round-trip 期间闪一下错误 palette。

这说明 Claude Code 的主题系统考虑的是“终端里瞬时视觉稳定性”，不是简单的状态正确性。

## 7. `ThemePicker` 不是静态菜单，而是一个作用域化的 preview controller

源码镜像：[`../../sources/claude-code/src/components/ThemePicker.tsx`](../../sources/claude-code/src/components/ThemePicker.tsx)

`ThemePicker` 的核心动作映射是：

- `onFocus(option)` -> `setPreviewTheme(option)`
- `onChange(option)` -> `savePreview()` 然后回调 `onThemeSelect(option)`
- `onCancel()` -> `cancelPreview()`，再决定是退出还是回调上层

它因此不是“选项列表组件”，而是预览事务的前端控制器。只要焦点还在移动，它就在驱动 preview；一旦确认才真正提交。

## 8. ThemePicker 还有自己独立的 keybinding context

源码镜像：[`../../sources/claude-code/src/components/ThemePicker.tsx`](../../sources/claude-code/src/components/ThemePicker.tsx), [`../../sources/claude-code/src/keybindings/defaultBindings.ts`](../../sources/claude-code/src/keybindings/defaultBindings.ts)

它会：

- `useRegisterKeybindingContext("ThemePicker")`
- `useKeybinding("theme:toggleSyntaxHighlighting", ..., { context: "ThemePicker" })`

这意味着主题选择器不是被动吃默认键位，而是拥有自己的局部键位作用域。`ctrl+t` 在这里不只是“切个布尔值”，而是一个只在 picker 打开时生效的 appearance-side action。

## 9. 主题预览里连 syntax highlighting 都是联动的

源码镜像：[`../../sources/claude-code/src/components/ThemePicker.tsx`](../../sources/claude-code/src/components/ThemePicker.tsx), [`../../sources/claude-code/src/components/StructuredDiff/colorDiff.ts`](../../sources/claude-code/src/components/StructuredDiff/colorDiff.ts)

`ThemePicker` 不是只展示大标题和选项，它还现场渲染一个 `StructuredDiff` demo，并把 syntax highlighting 状态一起卷进来：

- 读取 `getSyntaxTheme(theme)`
- 检查 `getColorModuleUnavailableReason()`
- 允许用 `theme:toggleSyntaxHighlighting` 即时切换
- 通过 `updateSettingsForSource("userSettings", { syntaxHighlightingDisabled })` 持久化这项设置
- 同步 `AppState.settings.syntaxHighlightingDisabled`

这说明在 Claude Code 里，appearance runtime 不只管“主题名字”，而是把 diff 颜色、syntax theme 可用性、用户是否禁用高亮一起纳进同一交互面。

## 10. ThemePicker 的选项集合本身也体现了产品立场

源码镜像：[`../../sources/claude-code/src/components/ThemePicker.tsx`](../../sources/claude-code/src/components/ThemePicker.tsx)

它不是只有 dark / light 两项，而是内建：

- `auto`
- `dark`
- `light`
- `dark-daltonized`
- `light-daltonized`
- `dark-ansi`
- `light-ansi`

这代表主题系统从一开始就把三类需求编进产品表面：

- 跟随终端环境
- 色弱友好
- ANSI-only 降级兼容

所以它不是“后期加皮肤”，而是终端适配策略的一部分。

## 11. Settings 对 ThemePicker 的接法，说明它被当成嵌套事务面板

源码镜像：[`../../sources/claude-code/src/components/Settings/Config.tsx`](../../sources/claude-code/src/components/Settings/Config.tsx)

`Config.tsx` 在 `showSubmenu === 'Theme'` 时挂出 `ThemePicker`，并传入：

- `skipExitHandling={true}`
- `hideEscToCancel`
- `onThemeSelect`：标记 dirty、提交主题、关闭 submenu、恢复 tabs
- `onCancel`：关闭 submenu、恢复 tabs

这说明 Settings 并没有把 ThemePicker 当成普通子组件，而是当成一个“内部自己有 preview 生命周期，但外层退出逻辑仍归 Settings 所有”的嵌套控制面。

## 12. Onboarding 复用同一个 ThemePicker，而不是重写一套新手流程 UI

源码镜像：[`../../sources/claude-code/src/components/Onboarding.tsx`](../../sources/claude-code/src/components/Onboarding.tsx)

Onboarding 里的 theme step 直接复用了同一个 `ThemePicker`，只是换了参数：

- `showIntroText={true}`
- `helpText="To change this later, run /theme"`
- `hideEscToCancel={true}`
- `skipExitHandling={true}`

然后在 `handleThemeSelection()` 里：

- `setTheme(newTheme)`
- `goToNextStep()`

这说明 Claude Code 没有为 onboarding 维护一份单独的主题实现，而是把“主题预览与确认”抽成可插入任意流程的运行时模块。

## 13. 这条链的真实分层应该这样理解

源码镜像：[`../../sources/claude-code/src/ink.ts`](../../sources/claude-code/src/ink.ts), [`../../sources/claude-code/src/components/design-system/ThemeProvider.tsx`](../../sources/claude-code/src/components/design-system/ThemeProvider.tsx), [`../../sources/claude-code/src/components/ThemePicker.tsx`](../../sources/claude-code/src/components/ThemePicker.tsx), [`../../sources/claude-code/src/components/Settings/Config.tsx`](../../sources/claude-code/src/components/Settings/Config.tsx), [`../../sources/claude-code/src/components/Onboarding.tsx`](../../sources/claude-code/src/components/Onboarding.tsx)

如果把它压成结构图，可以分成四层：

1. `ink.ts`
   把主题 provider 装到所有渲染入口上。
2. `ThemeProvider + systemTheme`
   维护 saved / preview / resolved state，并处理 auto 解析与 watcher。
3. `ThemePicker`
   把 preview、confirm、cancel、syntax-toggle 组织成一个局部控制器。
4. `Settings / Onboarding`
   在不同产品流程里复用同一个 appearance runtime。

所以“/theme”背后不是一个小命令，而是一整条全局渲染环境、预览事务和多入口复用链。

## 14. 这套主题系统已经是 Claude Code 的一条完整功能链，而不是配套细节

从源码可以看到，它至少同时满足了五个目标：

- 主题切换实时可预览
- 未确认前不污染持久配置
- `auto` 跟随终端真实背景而不是 OS 外观
- Settings 与 Onboarding 共享同一套 runtime
- syntax highlighting 与 theme selection 共处一个 appearance surface

这也是为什么它值得单独成卷：它不是“设置页里的一项配置”，而是 Claude Code 把 terminal appearance 做成产品级运行时能力的一个清晰样本。
