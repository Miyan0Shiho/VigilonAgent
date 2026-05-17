# Search、Select 与 Typeahead Primitives

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Overlay / Keybinding / Fullscreen Infrastructure`](./11-overlay-keybinding-and-fullscreen-infrastructure.md) | [`下一站：命令注册表`](../commands/01-command-registry-and-dispatch.md)

本文把 `SearchBox`、`useSearchInput`、`FuzzyPicker`、`useTypeahead`、`CustomSelect` 以及 `use-select-navigation` / `use-select-input` / `use-multi-select-state` 这条共享输入原语链拆成一卷，说明 Claude Code 的“搜索框”“选择器”“补全”并不是各写各的组件，而是一套被 PromptInput、Quick Open、Global Search、Settings、MCP 对话框、权限对话框反复复用的终端交互基底。

## 1. 这层不是功能面，而是“功能面之下的交互发动机”

源码镜像：[`../../sources/claude-code/src/components/SearchBox.tsx`](../../sources/claude-code/src/components/SearchBox.tsx), [`../../sources/claude-code/src/hooks/useSearchInput.ts`](../../sources/claude-code/src/hooks/useSearchInput.ts), [`../../sources/claude-code/src/components/design-system/FuzzyPicker.tsx`](../../sources/claude-code/src/components/design-system/FuzzyPicker.tsx), [`../../sources/claude-code/src/hooks/useTypeahead.tsx`](../../sources/claude-code/src/hooks/useTypeahead.tsx), [`../../sources/claude-code/src/components/CustomSelect/select.tsx`](../../sources/claude-code/src/components/CustomSelect/select.tsx)

如果上一卷解决的是 overlay、fullscreen、keybinding 这些“容器级底座”，那么这一卷解决的是更贴近输入本身的五个问题：

- 搜索输入框如何在终端里显示光标与 placeholder
- 搜索编辑语义如何模拟 readline / less / vim 风格
- fuzzy picker 如何统一标题、列表、preview、hint、上下翻页
- PromptInput 的补全如何把 command / path / shell / session / slack 等异质建议合流
- 选择器如何同时支持 single-select、multi-select、input-option、image attachment 模式

这层已经不是普通 UI 组件，而是 Claude Code 的终端输入协议实现层。

## 2. `SearchBox` 是最小视觉协议，不是“一个输入框组件”

源码镜像：[`../../sources/claude-code/src/components/SearchBox.tsx`](../../sources/claude-code/src/components/SearchBox.tsx)

`SearchBox` 的职责很小，但非常基础。它不处理任何输入事件，只负责把下面几种状态转成终端可视表现：

- `query`
- `placeholder`
- `isFocused`
- `isTerminalFocused`
- `cursorOffset`
- `borderless`
- `prefix`

它的关键行为是：

- 有焦点且终端焦点在当前窗口时，用 `inverse` 反显当前 cursor 所在字符
- query 为空时，placeholder 首字符可以被反显，模拟真实光标落点
- `borderless` 模式去掉 `round` 边框与 padding，供更紧凑场景复用
- prefix 默认是 `⌕`，但可以替换成别的前缀语义

所以它本质上不是文本状态机，而是一个“终端输入可视化器”。

## 3. `useSearchInput` 才是真正的搜索编辑内核

源码镜像：[`../../sources/claude-code/src/hooks/useSearchInput.ts`](../../sources/claude-code/src/hooks/useSearchInput.ts)

搜索栏的编辑逻辑并不写在 `SearchBox` 里，而是全部收在 `useSearchInput()`：

- `query`
- `cursorOffset`
- `handleKeyDown`
- `setQuery`

这个 hook 的设计点非常明确：它不是浏览器 `<input>` 的简化版，而是在终端里模拟经典命令行编辑体验。

它至少实现了三类语义：

- 导航语义：`left/right/home/end`、`ctrl+a/e/b/f`、`prevWord/nextWord`
- kill/yank 语义：`ctrl+k/u/w`、`meta+backspace`、kill ring、yank / yank-pop
- 退出语义：`Enter` 提交、`Escape` 取消或清空、`Backspace`/`ctrl+h` 在空 query 时可直接退出

因此 Quick Open、Global Search、Settings 搜索、LogSelector 搜索这些 UI 看起来不同，但共享的是同一套终端搜索编辑协议。

## 4. `useSearchInput` 明确区分了 `onExit` 和 `onCancel`

源码镜像：[`../../sources/claude-code/src/hooks/useSearchInput.ts`](../../sources/claude-code/src/hooks/useSearchInput.ts)

这个点很关键，因为很多终端搜索 UI 会把两者混在一起。这里则明确拆分：

- `onExit`：通常对应 Enter 提交或向下切回列表
- `onCancel`：通常对应 Escape / Ctrl+C 放弃搜索

而且当 `onCancel` 缺席时，它才会退回到：

- 非空 query 先清空
- 空 query 再退出

这意味着 Claude Code 没把“退出搜索模式”和“放弃当前搜索字符串”视为同一件事，而是允许每个 dialog 精确指定。

## 5. `FuzzyPicker` 不是业务对话框，而是“搜索+列表+preview”的通用骨架

源码镜像：[`../../sources/claude-code/src/components/design-system/FuzzyPicker.tsx`](../../sources/claude-code/src/components/design-system/FuzzyPicker.tsx)

`FuzzyPicker` 统一了大多数终端选择器的共同骨架：

- title
- searchBox
- visible list window
- optional preview
- bottom byline hints
- `Enter` / `Tab` / `Shift+Tab` / `Esc`

它有几个重要的设计选择：

- 过滤逻辑不内置，调用方自己 `onQueryChange(query)` 后重新传 `items`
- `onFocus(item)` 单独暴露，用于异步 preview 读取，避免 I/O 混进 render
- `previewPosition` 支持 `bottom` 和 `right`
- `direction='up'` 时，列表视觉方向反转，但上下键依然遵循屏幕方向

这说明它不是“做一次 Quick Open”，而是 Claude Code 对终端 picker 的抽象模板。

## 6. `FuzzyPicker` 的高度、hint 和布局稳定性是第一原则

源码镜像：[`../../sources/claude-code/src/components/design-system/FuzzyPicker.tsx`](../../sources/claude-code/src/components/design-system/FuzzyPicker.tsx)

这份实现里最值得注意的不是列表本身，而是为了防止终端抖动做的大量稳定化处理：

- `visibleCount` 会被 `rows - CHROME_ROWS` 截断，避免 picker 超出终端高度
- `compact` 模式在窄终端下缩短 hint，避免 byline 自动换行
- preview 缺失时也保持 `Box` 结构不变，避免 gap 数变化造成 searchBox 上下跳
- `windowStart` 与 `visible` 分离，保证 focused item 在固定可视窗里滚动

这些处理都指向同一目标：终端交互稳定优先于组件树“写得优雅”。

## 7. `FuzzyPicker` 把选择器操作分成 primary action 和 alternate actions

源码镜像：[`../../sources/claude-code/src/components/design-system/FuzzyPicker.tsx`](../../sources/claude-code/src/components/design-system/FuzzyPicker.tsx)

它不是只支持一个“选中”动作，而是天然支持：

- `Enter` → `onSelect`
- `Tab` → `onTab`
- `Shift+Tab` → `onShiftTab`

这恰好对应 Claude Code 里常见的三分操作：

- 直接打开
- 插入 `@path`
- 插入原始路径或行号锚点

因此 FuzzyPicker 不是普通 list picker，而是把“一个结果能触发多种工作流动作”内建进组件协议里。

## 8. `useTypeahead` 是 PromptInput 的异构建议汇流器

源码镜像：[`../../sources/claude-code/src/hooks/useTypeahead.tsx`](../../sources/claude-code/src/hooks/useTypeahead.tsx), [`../../sources/claude-code/src/components/PromptInput/PromptInput.tsx`](../../sources/claude-code/src/components/PromptInput/PromptInput.tsx)

如果说 `FuzzyPicker` 处理的是“进入一个搜索对话框之后”，那么 `useTypeahead` 处理的是“用户还没离开 PromptInput，本地补全已经开始工作”。

它接受的不是一个单一 suggestion source，而是一整组异质上下文：

- 当前 input / mode / cursorOffset
- commands
- agents
- 当前 suggestionsState
- prompt mode 切换回调

输出的是：

- `suggestions`
- `selectedSuggestion`
- `suggestionType`
- `maxColumnWidth`
- `commandArgumentHint`
- `inlineGhostText`
- `handleKeyDown`

所以 `useTypeahead` 本质上是 PromptInput 的“局部智能前端 runtime”。

## 9. `useTypeahead` 不是单一补全器，而是一个 suggestion router

源码镜像：[`../../sources/claude-code/src/hooks/useTypeahead.tsx`](../../sources/claude-code/src/hooks/useTypeahead.tsx)

从 imports 就能看出它在汇流很多类型的建议：

- command suggestions
- directory / file path completions
- shell history completion
- shell completions
- slack channel suggestions
- session resume suggestions
- agents / swarm suggestions
- unified suggestions

它还负责多种 suggestion 的落地动作：

- `applyCommandSuggestion`
- `applyFileSuggestion`
- `applyShellSuggestion`
- `applyDirectorySuggestion`
- `applyTriggerSuggestion`
- `buildResumeInputFromSuggestion`

这说明 Claude Code 的 prompt 补全不是“列个候选词”，而是“每类建议都有自己的替换语义、触发语法和插入格式”。

## 10. path / mention completion 已经做到了 Unicode 与 quoted token 级别

源码镜像：[`../../sources/claude-code/src/hooks/useTypeahead.tsx`](../../sources/claude-code/src/hooks/useTypeahead.tsx)

这里不是简单 `\w+` 正则，而是显式考虑：

- `\p{L}` / `\p{N}` / `\p{M}` 的 Unicode token
- `@"quoted path"` 这类带空格路径
- `@` mention token 与普通 path token 的不同提取逻辑
- `#channel` 风格 slack 触发

再加上：

- `extractCompletionToken`
- `extractSearchToken`
- `formatReplacementValue`

可以看出它已经把路径、mention、带空格引用、shell/bare path 的替换格式都独立编码了，而不是一个字符串 replace。

## 11. `useTypeahead` 同时接了 overlay 与 keybinding context

源码镜像：[`../../sources/claude-code/src/hooks/useTypeahead.tsx`](../../sources/claude-code/src/hooks/useTypeahead.tsx), [`../../sources/claude-code/src/context/overlayContext.tsx`](../../sources/claude-code/src/context/overlayContext.tsx), [`../../sources/claude-code/src/keybindings/KeybindingContext.tsx`](../../sources/claude-code/src/keybindings/KeybindingContext.tsx)

它会在 autocomplete 活跃时：

- `useRegisterOverlay('autocomplete', isAutocompleteActive)`
- `useRegisterKeybindingContext('Autocomplete', isAutocompleteActive)`

这就把上一卷的两条底座链接了进来：

- overlay 层告诉 cancel handler “现在 Esc 优先关补全，不是取消 Claude”
- keybinding context 层让 autocomplete 的上下键 / 接受键优先于普通 chat 输入

所以 autocomplete 不是 PromptInput 里的 if 分支，而是被正式接进前台输入治理系统的一等模式。

## 12. `CustomSelect` 不是一个组件，而是一套状态机族谱

源码镜像：[`../../sources/claude-code/src/components/CustomSelect/select.tsx`](../../sources/claude-code/src/components/CustomSelect/select.tsx), [`../../sources/claude-code/src/components/CustomSelect/use-select-navigation.ts`](../../sources/claude-code/src/components/CustomSelect/use-select-navigation.ts), [`../../sources/claude-code/src/components/CustomSelect/use-select-input.ts`](../../sources/claude-code/src/components/CustomSelect/use-select-input.ts), [`../../sources/claude-code/src/components/CustomSelect/use-multi-select-state.ts`](../../sources/claude-code/src/components/CustomSelect/use-multi-select-state.ts)

这套系统至少拆成四层：

- `Select`：渲染层与组合层
- `useSelectNavigation`：焦点与视窗滚动状态机
- `useSelectInput`：single-select 键盘输入控制
- `useMultiSelectState`：multi-select 选中态与输入态管理

这意味着 Claude Code 的“选择器”不是单个组件文件，而是按职责拆开的可复用交互框架。

## 13. `useSelectNavigation` 维护的是 viewport-aware 焦点，不只是 index++

源码镜像：[`../../sources/claude-code/src/components/CustomSelect/use-select-navigation.ts`](../../sources/claude-code/src/components/CustomSelect/use-select-navigation.ts)

这份 reducer 不是简单的“上一个 / 下一个”，而是同步维护：

- `focusedValue`
- `visibleFromIndex`
- `visibleToIndex`
- `optionMap`

它显式处理：

- 首尾 wrap
- wrap 时重置 viewport 到首屏或尾屏
- `pageUp/pageDown` 按可见页长跳跃
- options 深变化时 reset

因此选择器焦点不是数组下标，而是“当前聚焦项 + 当前可视窗”的联动状态。

## 14. `useSelectInput` 把 single-select 拆成 keybinding 层和 raw input 层

源码镜像：[`../../sources/claude-code/src/components/CustomSelect/use-select-input.ts`](../../sources/claude-code/src/components/CustomSelect/use-select-input.ts)

它的策略非常明确：

- 核心导航动作交给 `useKeybindings`：`select:next` / `select:previous` / `select:accept` / `select:cancel`
- 剩余特殊键继续走 `useInput`：数字索引、PageUp/PageDown、Tab、Space、input-mode 下的箭头行为

之所以不把一切都塞进 keybinding，是因为它还要处理一些必须看当前 option 类型的语义：

- focused option 是 `input` 时，绝大多数字符输入要放行给 TextInput
- image selection mode 激活时，连箭头都要让给 attachment navigation
- `Tab` 进入或退出 input mode
- multi-select 的空格切换

所以 `useSelectInput` 的本质是“键位系统”和“输入控件局部语义”之间的桥接器。

## 15. `Select` 已经不是纯文本列表，而是支持 input option / pasted image / editor hook 的复合控件

源码镜像：[`../../sources/claude-code/src/components/CustomSelect/select.tsx`](../../sources/claude-code/src/components/CustomSelect/select.tsx)

`OptionWithDescription` 这套类型已经暴露出很多非普通列表特性：

- `type: 'input'`
- `onChange`
- `placeholder`
- `initialValue`
- `allowEmptySubmitToCancel`
- `showLabelWithValue`
- `resetCursorOnUpdate`
- `onOpenEditor`
- `onImagePaste`
- `pastedContents`
- `onRemoveImage`

这说明 Claude Code 的 select 并不只服务“选一项”，而是已经扩展成“带输入字段、带图片 attachment、可开外部编辑器”的复合对话面。

## 16. `useMultiSelectState` 说明 multi-select 不是 single-select 的微调版

源码镜像：[`../../sources/claude-code/src/components/CustomSelect/use-multi-select-state.ts`](../../sources/claude-code/src/components/CustomSelect/use-multi-select-state.ts)

这份状态机要额外维护：

- `selectedValues`
- `inputValues`
- `isSubmitFocused`
- submit button 的焦点切换

它还处理了两个复杂点：

- options 深变化后重置 selectedValues，避免异步加载结果沿用旧选中态
- input-type option 的值变化要自动把该 option 纳入或移出 selectedValues

因此 multi-select 已经不是“数组版单选”，而是另一套更复杂的状态模型。

## 17. 这条链把很多产品表面统一成了同一种内部语法

把这些文件连起来看，会发现很多看起来不同的产品表面，其实在内部共用同一种交互语法：

- Quick Open / Global Search / 历史搜索：`useSearchInput + SearchBox + FuzzyPicker`
- PromptInput autocomplete：`useTypeahead + overlay/keybinding context`
- 设置面板、权限规则、MCP 导入、团队选择、普通确认框：`CustomSelect` 族谱

所以 Claude Code 的很多“新界面”并不是从零写一套交互，而是在已有原语上组合。

## 18. 为什么这一卷必须独立

如果只在前面的 `PromptInput`、`Navigation Dialogs`、`Permission/MCP UI` 文章里顺带提这些文件，会看不出一个关键事实：Claude Code 已经有一套自己的终端输入原语层。

这层至少包含三大系统：

- 搜索编辑协议：`SearchBox + useSearchInput`
- 搜索/preview 选择器协议：`FuzzyPicker`
- 补全与选择状态机协议：`useTypeahead + CustomSelect family`

这不是“几个工具组件”，而是 Claude Code 之所以能在终端里稳定承载搜索、补全、选择、preview、quoted path、multi-select、input option、image attachment 的真正实现底座。
