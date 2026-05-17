# Navigation、Help 与 Search Dialogs

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Settings / Config / Permission Rules`](./09-settings-config-and-permission-rules.md) | [`下一站：命令注册表`](../commands/01-command-registry-and-dispatch.md)

本文把 `HelpV2`、`QuickOpenDialog`、`GlobalSearchDialog`、`LogSelector`、`SearchBox` 以及 `PromptInput` 里的调起逻辑拆成一卷，说明 Claude Code 的“导航”和“搜索”不是几个孤立弹窗，而是一套 overlay、keybinding、fuzzy picking 与 preview 协调系统。

## 1. `PromptInput` 是导航入口总控，不只是文本输入

源码镜像：[`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/PromptInput/PromptInput.tsx)

这条链最重要的事实是：Help、Quick Open、Global Search、History Picker 都不是从 REPL 外壳任意弹出的，而是由 `PromptInput` 统一调度。

在这里能看到几组状态：

- `showQuickOpen`
- `showGlobalSearch`
- `showHistoryPicker`
- `helpOpen`

以及一组全局键绑定：

- `app:quickOpen`
- `app:globalSearch`
- `history:search`
- `help:dismiss`

这说明 Claude Code 的输入层本身就是导航控制面，键盘驱动的二级界面都从这里分流。

## 2. overlay 不是普通弹窗，而是 REPL 输入面的模式切换

源码镜像：[`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/QuickOpenDialog.tsx), [`../../src/components/GlobalSearchDialog.tsx`](../../src/components/HelpV2/HelpV2.tsx)

`PromptInput` 在早返回分支里直接切换渲染目标：

- `QuickOpenDialog`
- `GlobalSearchDialog`
- `HistorySearchDialog`
- `HelpV2`

同时 `useInput()` 里还专门做了保护：当这些 full-screen dialog 打开时，底层 ESC 与普通输入逻辑不应继续泄漏。

所以这些搜索/帮助面板不是普通组件树上的浮层，而是“当前输入模式被一个 overlay 接管”。

## 3. `QuickOpenDialog` 是文件导航器，不是全文搜索器

源码镜像：[`../../src/components/QuickOpenDialog.tsx`](../../src/components/QuickOpenDialog.tsx)

它的职责边界很干净：

- 用 `generateFileSuggestions()` 做 fuzzy file suggestions
- 过滤目录项，只保留文件
- 焦点移动时用 `readFileInRange()` 异步拉 preview
- `Enter` 直接外部编辑器打开
- `Tab` 插入 `@path`
- `Shift+Tab` 插入原始路径

这说明 Quick Open 的目标是“快速把文件带入当前工作流”，而不是在终端内浏览全文。

## 4. Quick Open 的细节是“读少量、看一段、避免阻塞”

源码镜像：[`../../src/components/QuickOpenDialog.tsx`](../../src/components/QuickOpenDialog.tsx), [`../../src/utils/readFileInRange.ts`](../../src/utils/readFileInRange.ts)

这里有三层很明显的交互优化：

- `queryGenRef` 丢弃过时 query 的结果
- `AbortController` 在焦点切换时取消上一份 preview 读取
- 预览只读前 `20` 行左右，而不是整文件

因此 Quick Open 的实现重点不是“结果尽量全”，而是“列表滚动时不要卡住终端”。

## 5. `GlobalSearchDialog` 走的是 ripgrep 流，不是复用文件 suggestion

源码镜像：[`../../src/components/GlobalSearchDialog.tsx`](../../src/components/GlobalSearchDialog.tsx), [`../../src/utils/ripgrep.ts`](../../src/utils/ripgrep.ts)

Global Search 和 Quick Open 看起来相似，但底层完全不同：

- Quick Open 按文件名找文件
- Global Search 用 `ripGrepStream()` 按内容找匹配行

它还有明确的搜索预算：

- `DEBOUNCE_MS = 100`
- `MAX_MATCHES_PER_FILE = 10`
- `MAX_TOTAL_MATCHES = 500`
- `PREVIEW_CONTEXT_LINES = 4`

这说明全文搜索层默认把“终端交互稳定性”放在“无限结果覆盖”前面。

## 6. Global Search 的真正结果对象是“文件 + 行号 + 命中文本”

源码镜像：[`../../src/components/GlobalSearchDialog.tsx`](../../src/components/GlobalSearchDialog.tsx)

`Match` 结构直接固定成：

- `file`
- `line`
- `text`

对应的后续动作也围绕这个结构展开：

- `Enter` 打开外部编辑器并跳到行号
- `Tab` 插入 `@file#Lline`
- `Shift+Tab` 插入 `file:line`
- preview 读取命中行附近上下文

也就是说，它输出的不是“一个搜索结果项”，而是可以立刻反向喂给对话输入和编辑器的定位锚点。

## 7. `SearchBox` 是统一的终端搜索输入基元

源码镜像：[`../../src/components/SearchBox.tsx`](../../src/components/SearchBox.tsx)

`SearchBox` 自己很小，但它的重要性在于复用面很广：

- `LogSelector`
- `Settings/Config`
- `PermissionRuleList`
- `FuzzyPicker`

它统一了几件事：

- 终端焦点在不在时，cursor 如何显示
- placeholder 如何反显
- focused / unfocused 时的边框和前缀
- borderless 与固定宽度模式

所以 Claude Code 的很多“搜索栏”不是各自实现，而是复用同一个终端输入视觉协议。

## 8. `FuzzyPicker` 是 Quick Open 和 Global Search 的公共壳

源码镜像：[`../../src/components/design-system/FuzzyPicker.tsx`](../../src/components/design-system/FuzzyPicker.tsx), [`../../src/components/QuickOpenDialog.tsx`](../../src/components/QuickOpenDialog.tsx), [`../../src/components/GlobalSearchDialog.tsx`](../../src/components/GlobalSearchDialog.tsx)

两类搜索对话框虽然查的对象不同，但都复用 `FuzzyPicker`：

- title / placeholder
- items 与 `getKey`
- previewPosition
- `onTab` / `onShiftTab`
- `renderItem`
- `renderPreview`

这说明 Claude Code 对“终端内选择器”的抽象已经不是某一份业务组件，而是通用的 design-system 容器。

## 9. `HelpV2` 是命令目录和快捷键目录的统一入口

源码镜像：[`../../src/components/HelpV2/HelpV2.tsx`](../../src/components/HelpV2/General.tsx), [`../../src/components/PromptInput/PromptInputHelpMenu.tsx`](../../src/components/PromptInput/PromptInputHelpMenu.tsx)

`HelpV2` 并不是一页静态帮助文本，而是一个 tabs 化目录：

- `general`
- `commands`
- `custom-commands`

这里面又把两类资产拼在一起：

- `PromptInputHelpMenu` 提供快捷键与输入模式提示
- `Commands` tab 提供 slash command 目录

因此 `/help` 实际上是“终端交互指南 + 命令索引”的统一前台。

## 10. `PromptInputHelpMenu` 说明帮助内容本身也是动态运行时视图

源码镜像：[`../../src/components/PromptInput/PromptInputHelpMenu.tsx`](../../src/components/PromptInput/PromptInputHelpMenu.tsx)

这个组件最值得注意的是它并不硬编码快捷键文本，而是通过 `useShortcutDisplay()` 读运行时绑定结果。

它展示的也不只是快捷键，还有输入模式语义：

- `!` for bash mode
- `/` for commands
- `@` for file paths
- `&` for background
- `/btw` for side question

这意味着帮助菜单本身是当前输入协议的可视化镜像，不只是说明书。

## 11. `LogSelector` 不是简单 session picker，而是恢复/漫游入口

源码镜像：[`../../src/components/LogSelector.tsx`](../../src/components/LogSelector.tsx), [`../../src/screens/ResumeConversation.tsx`](../../src/screens/ResumeConversation.tsx)

`LogSelector` 的复杂度明显高于普通列表：

- branch/worktree 过滤
- group expansion
- session preview
- rename support
- search mode / list mode 切换
- all projects 开关

再加上它被 `ResumeConversation` 直接消费，说明它扮演的是“历史会话入口”而不是一个普通弹窗组件。

## 12. 这套系统的核心不是弹窗数量，而是“定位结果可直接转成下一步动作”

把几份源码连起来看，可以发现所有导航 dialog 都围绕同一个目标设计：

- 查到文件后能 `@mention` 或直接打开编辑器
- 查到文本后能插入 `file:line` 或 `@file#Lline`
- 看到历史会话后能恢复、重命名、过滤
- 看到帮助后能立刻映射到快捷键和命令

所以 Claude Code 的导航系统不是浏览型 UI，而是“搜索即跳转，结果即工作上下文”的终端操作层。

## 13. 为什么这一卷必须独立

如果只把这些组件归到 `PromptInput` 或 `REPL runtime` 总述里，会丢掉一个很重要的产品事实：Claude Code 已经有了一套相当完整的终端导航子系统。

它至少由四层组成：

- `PromptInput` 负责模式切换和键绑定入口
- `SearchBox` / `FuzzyPicker` 负责共用交互基元
- `QuickOpen` / `GlobalSearch` / `LogSelector` 负责不同对象域的检索
- `HelpV2` 负责把命令与快捷键汇成可漫游目录

这已经不是“若干辅助对话框”，而是一套终端内的 discoverability runtime。
