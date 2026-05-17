# Components、Hooks 与 Ink 承载层

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Bridge / Remote / Daemon`](./04-bridge-remote-and-daemon.md) | [`下一站：命令体系`](../commands/01-command-registry-and-dispatch.md)

本文聚焦 `components/**`、`hooks/**`、`ink/**` 这些目录为什么不是“UI 杂项”，而是 Claude Code 交互式运行时的基础设施。

## 1. 目录规模本身就是信号

从目录树可以看出：

- `components/**` 覆盖消息、权限、MCP、PromptInput、TaskList、Settings、agents、diff、design-system 等多个系统
- `hooks/**` 覆盖工具权限、IDE、remote session、queue processor、keybindings、scheduled tasks、survey、notifications 等
- `ink/**` 提供事件、布局、terminal IO、组件适配和键盘输入能力

这说明 REPL 并不是单体文件独自完成工作，而是站在一个很厚的交互基础设施上。

## 2. hooks 在这里的含义不是“React 小工具”

在这个代码库里，很多 hooks 实际上是运行时适配层：

- 把远端会话状态接回 REPL
- 把工具权限请求接成可交互 UI
- 把 command queue、mailbox、IDE、SSH、scheduled task 接入会话
- 把通知、feedback、survey、LSP 提示等旁路系统挂到主界面

也就是说，hooks 目录里有相当一部分不是“视图层复用逻辑”，而是交互式 runtime 的桥接层。

## 3. design-system 与 feature component 的分工

`components/design-system/**` 承担的是：

- 基础 Dialog / Pane / Tabs / ThemedText / KeyboardShortcutHint 等 UI 基元

而其他目录承担的是：

- 权限系统的具体对话框
- MCP 配置与授权界面
- agents / tasks / prompt input / diff / feedback 等功能视图

这让 Claude Code 的 TUI 有了分层，不至于所有交互都硬写在 `REPL.tsx`。

## 4. Ink 为什么还是关键

虽然 `REPL.tsx` 很大，但没有 `ink/**` 这层，Claude Code 不能稳定处理：

- 键盘事件和搜索输入
- terminal focus / title / tab status
- viewport、布局和虚拟消息列表
- 多种对话框和滚动交互

所以 Ink 在这里不是外壳库，而是整个交互面得以存在的终端适配基础。
