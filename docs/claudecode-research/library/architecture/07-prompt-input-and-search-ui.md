# PromptInput 与搜索输入子系统

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Permission / MCP UI`](./06-permission-and-mcp-ui-systems.md) | [`下一站：Tasks / Remote / Agent UI`](./08-tasks-remote-and-agent-detail-ui.md)

本文把 `PromptInput.tsx` 以及它周围的 `useSearchInput`、`useHistorySearch`、`usePromptSuggestion`、`PromptInputFooter*`、`PromptInputQueuedCommands` 拆成一卷，说明 Claude Code 的输入区为什么本质上是一个交互 runtime，而不是单个文本框。

## 1. `PromptInput.tsx` 是前台控制塔，不是输入组件

源码镜像：[`../../sources/claude-code/src/components/PromptInput/PromptInput.tsx`](../../sources/claude-code/src/components/PromptInput/PromptInput.tsx)

从 import 面可以直接看出它在协调的系统远超“编辑文本”：

- 命令队列与即时命令对话框
- IDE at-mention、global search、quick open、teams、background tasks
- history search、typeahead、prompt suggestion、input buffer
- image paste、voice、buddy、thinking、fast mode、permission mode
- remote teammate view、agent 任务、mailbox、swarm banner

所以 `PromptInput` 的真实角色是：把“当前用户在底部输入区能做什么”统一编排出来。

## 2. 它维护的是一台模式机

源码镜像：[`../../sources/claude-code/src/components/PromptInput/inputModes.ts`](../../sources/claude-code/src/components/PromptInput/inputModes.ts), [`../../sources/claude-code/src/utils/processUserInput/processUserInput.ts`](../../sources/claude-code/src/utils/processUserInput/processUserInput.ts)

这套输入系统并不把内容当纯字符串，而是持续维护：

- `PromptInputMode`
- 当前光标位置
- stashed prompt
- pasted contents
- vim mode
- history search 状态
- 是否有 modal overlay 正在抢占输入

这意味着输入区并不是“打完再解析”，而是从键入阶段就已经进入模式化状态机。

## 3. `useSearchInput` 是整个库的搜索编辑内核

源码镜像：[`../../sources/claude-code/src/hooks/useSearchInput.ts`](../../sources/claude-code/src/hooks/useSearchInput.ts)

这个 hook 的价值在于，它不是只服务 PromptInput，而是被多个界面复用的轻量编辑器：

- 自己维护 `query` 与 `cursorOffset`
- 处理 `Esc`、`Enter`、上下方向、backspace on empty 等退出语义
- 支持 `Ctrl+A/E/B/F/D/H/K/U/W/Y`
- 使用 kill ring / yank / word jump 这些接近 shell 的编辑语义
- 允许 `passthroughCtrlKeys` 和 `backspaceExitsOnEmpty` 这类场景化开关

因此 Claude Code 的很多“搜索框”其实共享一套终端编辑协议，而不是各写一份键盘逻辑。

## 4. `useHistorySearch` 不是 UI 点缀，而是输入回滚系统

源码镜像：[`../../sources/claude-code/src/hooks/useHistorySearch.ts`](../../sources/claude-code/src/hooks/useHistorySearch.ts)

这条链做了几件非常关键的事：

- 进入搜索前保存 `originalInput`、`originalCursorOffset`、`originalMode`、`originalPastedContents`
- 使用 `makeHistoryReader()` 倒序读历史
- 对搜索结果恢复 mode 与 pasted contents，而不只替换文本
- 显式调用 generator 的 `.return()`，避免历史文件句柄泄漏

这说明 ctrl+r 历史搜索在 Claude Code 里不是“找一条文本”，而是恢复一整个输入上下文快照。

## 5. `usePromptSuggestion` 把“空输入建议”做成了状态对象

源码镜像：[`../../sources/claude-code/src/hooks/usePromptSuggestion.ts`](../../sources/claude-code/src/hooks/usePromptSuggestion.ts)

这个 hook 暴露了 prompt suggestion 的真实机制：

- suggestion 来自 `AppState.promptSuggestion`
- 输入非空或 assistant 正在响应时，suggestion 自动失效
- 区分 `shownAt`、`acceptedAt`、`generationRequestId`
- 记录 first keystroke、focus 状态、accept method、ignore timing
- 提交时统一打 telemetry，并可 reset suggestion

所以提示建议不是“灰字补全”，而是一套完整的产品实验对象。

## 6. `PromptInputQueuedCommands` 说明底部区域还是命令回流面板

源码镜像：[`../../sources/claude-code/src/components/PromptInput/PromptInputQueuedCommands.tsx`](../../sources/claude-code/src/components/PromptInput/PromptInputQueuedCommands.tsx), [`../../sources/claude-code/src/hooks/useCommandQueue.ts`](../../sources/claude-code/src/hooks/useCommandQueue.ts)

这里能看到三个重要设计：

- 命令队列来自 `useSyncExternalStore`，只有队列快照变更才重渲染
- `task-notification` 会做条数裁剪与 overflow summary
- idle notification 会被静默过滤

这说明输入区上方那块并不是普通消息列表，而是“尚未正式进入 transcript 的用户动作回流层”。

## 7. Footer 左侧其实在展示系统状态，而不是提示文案

源码镜像：[`../../sources/claude-code/src/components/PromptInput/PromptInputFooterLeftSide.tsx`](../../sources/claude-code/src/components/PromptInput/PromptInputFooterLeftSide.tsx)

`PromptInputFooterLeftSide` 会在不同条件下切换显示：

- exit 二次确认
- pasting 状态
- HistorySearchInput
- vim insert 标记
- permission mode / task status / team status / PR status / remote session URL 等模式指示

也就是说，footer 左侧本质上是一个状态仪表盘，而不是一行辅助说明。

## 8. 为什么这一卷必须单独存在

如果只从 `processUserInput.ts` 往前看，很容易把前台输入理解成“字符串预处理”。但拆开以后能看到：

- `PromptInput` 负责模式机和对话框路由
- `useSearchInput` 负责终端搜索编辑协议
- `useHistorySearch` 负责输入快照恢复
- `usePromptSuggestion` 负责空态建议实验
- `PromptInputQueuedCommands` 负责前台命令回流
- `PromptInputFooterLeftSide` 负责实时状态呈现

这已经是一个输入操作系统，而不是单个输入框。
