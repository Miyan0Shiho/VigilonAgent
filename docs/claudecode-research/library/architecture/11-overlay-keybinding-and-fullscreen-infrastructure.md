# Overlay、Keybinding 与 Fullscreen Infrastructure

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Navigation / Help / Search Dialogs`](./10-navigation-and-search-dialogs.md) | [`下一站：命令注册表`](../commands/01-command-registry-and-dispatch.md)

本文把 `overlayContext`、`promptOverlayContext`、`modalContext`、`KeybindingContext`、`useKeybinding`、`FullscreenLayout` 这组基础设施拆成一卷，说明 Claude Code 的前台交互不是“PromptInput + 几个弹窗”，而是一个把模式切换、键位解析、浮层逃逸、全屏滚动和新消息提示统一起来的底座系统。

## 1. 这不是业务 UI，而是所有业务 UI 共享的交互地基

源码镜像：[`../../src/context/overlayContext.tsx`](../../src/context/overlayContext.tsx), [`../../src/context/modalContext.tsx`](../../src/context/modalContext.tsx), [`../../src/context/promptOverlayContext.tsx`](../../src/context/promptOverlayContext.tsx), [`../../src/keybindings/KeybindingContext.tsx`](../../src/keybindings/KeybindingContext.tsx), [`../../src/keybindings/useKeybinding.ts`](../../src/keybindings/useKeybinding.ts), [`../../src/components/FullscreenLayout.tsx`](../../src/components/FullscreenLayout.tsx)

这一层不直接对应某一个功能按钮，而是给多个子系统同时供血：

- `QuickOpenDialog`
- `GlobalSearchDialog`
- `HistorySearchDialog`
- `BackgroundTasksDialog`
- `ElicitationDialog`
- `PromptInput` footer suggestion
- transcript / scroll / new message pill

因此这一卷的重点不是“某个弹窗做了什么”，而是“这些弹窗为什么能在同一套 REPL 里不打架”。

## 2. `overlayContext` 解决的是 Escape 所有权，不只是登记弹窗

源码镜像：[`../../src/context/overlayContext.tsx`](../../src/context/overlayContext.tsx), [`../../src/hooks/useCancelRequest.ts`](../../src/hooks/useCancelRequest.ts)

`useRegisterOverlay(id, enabled)` 会在挂载时把 overlay id 写入 `AppState.activeOverlays`，卸载时自动移除。

表面上看这像一个简单 registry，但它真正解决的是输入优先级问题：

- overlay 打开时，`CancelRequestHandler` 不该把 `Escape` 解释成“取消 Claude 当前请求”
- overlay 关闭时，底层输入框应该重新获得所有权
- autocomplete 这种非模态层不能和全屏选择器一样处理

因此这里又分成两个判定：

- `useIsOverlayActive()`：只要有 overlay，就阻止全局 cancel handler 抢键
- `useIsModalOverlayActive()`：只要存在非 `autocomplete` 的 overlay，就让文本输入失焦

也就是说，Claude Code 已经把“有没有浮层”和“这个浮层是不是模态”拆成两层协议，而不是一个布尔值。

## 3. overlay registry 还顺手修复了 Ink 的残影问题

源码镜像：[`../../src/context/overlayContext.tsx`](../../src/context/overlayContext.tsx)

`useRegisterOverlay()` 里还有一段更底层的 `useLayoutEffect` cleanup：overlay 卸载时调用 `instances.get(process.stdout)?.invalidatePrevFrame()`。

这说明它不只是为了业务态同步，还在修终端渲染问题：

- 大型 overlay 卸载时，Ink 的 blit fast-path 可能把旧帧残影复制到缩短后的布局里
- 全屏 fuzzy picker、preview 面板这类高 overlay 容易留下 ghost title / divider
- 因为需要抢在微任务渲染之前失效旧帧，所以这里用的是 `useLayoutEffect` 而不是普通 `useEffect`

因此 overlay 系统兼有“输入协调器”和“渲染修复器”双重角色。

## 4. `promptOverlayContext` 解决的是“浮层不能被底部 slot 裁掉”

源码镜像：[`../../src/context/promptOverlayContext.tsx`](../../src/components/FullscreenLayout.tsx)

`FullscreenLayout` 的 bottom slot 有 `overflowY:hidden`，这个裁剪本身是负载关键路径，因为 tall paste 会压缩 `ScrollBox`。

问题是：

- slash suggestion 需要浮在 prompt 上方
- 某些 dialog 也要从 prompt 上方冒出来
- 如果直接挂在 bottom slot 里，会被 clip stack 裁成约一行

所以这里单独做了 portal 风格的上下文：

- `useSetPromptOverlay()`：写结构化 suggestion 数据
- `useSetPromptOverlayDialog()`：写任意 dialog node
- `PromptOverlayProvider`：在 `FullscreenLayout` 里统一消费并重渲染到 clip 之外

这说明 Claude Code 的 prompt 上浮层不是普通 children，而是专门设计过的“逃逸通道”。

## 5. `modalContext` 解决的是 slash dialog 的内部尺寸协议

源码镜像：[`../../src/context/modalContext.tsx`](../../src/components/FullscreenLayout.tsx)

`FullscreenLayout` 的 `modal` slot 不是全终端尺寸，而是一个底部锚定 pane：

- 顶部保留 `MODAL_TRANSCRIPT_PEEK = 2` 行 transcript
- 画一条 `▔` 分隔线
- 再给 modal 内容 `paddingX=2`

因此 modal 内部组件如果还按全终端尺寸工作，就会溢出或重复画框。`ModalContext` 正是为了解这个问题，给内部组件提供：

- `rows`
- `columns`
- `scrollRef`

对应能力是：

- `Pane` 可以跳过自己的全屏 divider
- `Select` / `Tabs` 可以按 modal 内部可用行数分页
- tab 切换时可以通过 `scrollRef` 重置自己的滚动盒

所以这里不是“弹个框”，而是为 modal 子树单独建了一套局部终端坐标系。

## 6. `KeybindingContext` 是动作解析器，不是快捷键常量表

源码镜像：[`../../src/keybindings/KeybindingContext.tsx`](../../src/keybindings/KeybindingContext.tsx), [`../../src/keybindings/resolver.ts`](../../src/keybindings/resolver.ts), [`../../src/keybindings/defaultBindings.ts`](../../src/keybindings/defaultBindings.ts)

这条链至少有四层：

- `DEFAULT_BINDINGS` 提供平台感知默认键位
- `resolver.ts` 负责把输入解析成 action 或 chord 状态
- `KeybindingProvider` 维护 pending chord、active contexts、handler registry
- `useKeybinding()` / `useKeybindings()` 在组件侧挂载 action handler

这里的关键不是“按下什么键”，而是“按键先被解析成 action，再按当前上下文决定谁有资格处理”。

这比传统组件直接 `useInput()` 监听更像一个前台 action bus。

## 7. 默认键位本身已经是平台与功能旗标耦合的

源码镜像：[`../../src/keybindings/defaultBindings.ts`](../../src/keybindings/defaultBindings.ts)

`DEFAULT_BINDINGS` 不是静态 JSON，而是带条件逻辑：

- Windows 上 image paste 用 `alt+v`，其他平台用 `ctrl+v`
- 不支持 terminal VT mode 的 Windows，用 `meta+m` 代替 `shift+tab`
- `QUICK_SEARCH`、`VOICE_MODE`、`TERMINAL_PANEL`、`KAIROS` 会打开额外 binding
- transcript、settings、tabs、scroll、footer、attachments、message selector 都有独立 context

这说明 Claude Code 的键位系统是产品状态的一部分，而不是文档里写死的附录。

## 8. chord 不是附加功能，而是解析链的一等状态

源码镜像：[`../../src/keybindings/resolver.ts`](../../src/keybindings/resolver.ts), [`../../src/keybindings/KeybindingContext.tsx`](../../src/keybindings/KeybindingContext.tsx)

`resolveKeyWithChordState()` 明确把结果拆成五类：

- `match`
- `none`
- `unbound`
- `chord_started`
- `chord_cancelled`

而且它不是“先找精确匹配，不行再看 chord”，而是反过来：

- 如果当前按键能成为更长 chord 的前缀，就优先进入 chord waiting
- `null` override 会遮蔽默认 chord，避免前缀键被错误吞掉
- `escape` 或无效键会主动取消 pending chord
- alt/meta 被折叠成一个逻辑 modifier，super 单独保留

这说明 chord 在 Claude Code 里不是语法糖，而是键位状态机的一等公民。

## 9. handler registry 把“谁来执行 action”从解析层里剥离出来

源码镜像：[`../../src/keybindings/KeybindingContext.tsx`](../../src/keybindings/KeybindingContext.tsx), [`../../src/keybindings/useKeybinding.ts`](../../src/keybindings/useKeybinding.ts)

`KeybindingProvider` 内部有一个 `handlerRegistryRef: Map<string, Set<HandlerRegistration>>`，注册项至少包含：

- `action`
- `context`
- `handler`

调用链是：

1. `useKeybinding()` 注册 handler
2. `useInput()` 拿到真实按键
3. `resolve()` 先把按键映射成 action / chord 结果
4. `invokeAction()` 只在当前 active context 命中时执行 handler

这使得同一个 action 可以被不同上下文重载，而不用让 resolver 知道业务组件细节。

## 10. `useRegisterKeybindingContext()` 是上下文抢占机制

源码镜像：[`../../src/keybindings/KeybindingContext.tsx`](../../src/keybindings/KeybindingContext.tsx), [`../../src/hooks/useTypeahead.tsx`](../../src/hooks/useTypeahead.tsx), [`../../src/components/ThemePicker.tsx`](../../src/components/ThemePicker.tsx)

这个 hook 会在组件挂载时把自己的 context 加入 active set，卸载时移除。

效果是：

- `ThemePicker` 可以让自己的 `ctrl+t` 覆盖 global todo toggle
- autocomplete 打开时，自己的上下文优先于普通 chat 输入
- 组件不需要自己手写“如果我开着就屏蔽全局 handler”的分支

所以 Claude Code 的局部交互接管，并不是通过层层 `if (open)` 实现，而是通过 active context 优先级完成。

## 11. `useKeybinding()` 不是简单语法糖，它封装了传播控制

源码镜像：[`../../src/keybindings/useKeybinding.ts`](../../src/keybindings/useKeybinding.ts)

这个 hook 干了四件很关键的事：

- 自动拼出 `registered active contexts + local context + Global`
- 去重并保持优先级顺序
- 在 `match` / `chord_started` / `unbound` 时调用 `stopImmediatePropagation()`
- 允许 sync `false` 返回值触发 fallthrough

这里最重要的是最后一点：不是所有命中都必须吞键。

比如 scroll 类 handler 在“滚不动”时可以返回 `false`，把 wheel 事件继续让给子组件做列表导航。这使得 Claude Code 的前台输入能形成“多层协商”而不是“谁先注册谁赢”。

## 12. `useCancelRequest` 说明 overlay 和 keybinding 底座已经接到 agent 控制面

源码镜像：[`../../src/hooks/useCancelRequest.ts`](../../src/hooks/useCancelRequest.ts)

这份文件把前台交互底座和后台 agent 控制直接接起来了。

它会综合判断：

- `abortSignal` 是否可取消
- command queue 是否有待弹出项
- 当前是不是 transcript / history search / help / message selector
- 当前是不是 overlay active
- 当前是不是 special input mode with empty input
- 当前是不是 teammate view

然后分别决定：

- `Escape` 是否绑定到 `chat:cancel`
- `Ctrl+C` 是否绑定到 `app:interrupt`
- `ctrl+x ctrl+k` 是否进入两段式 kill agents 流程

也就是说，overlay registry 并不是 UI 自娱自乐，它决定了“Esc 到底是关浮层、退出模式、取消当前请求，还是杀后台 agent”。

## 13. `FullscreenLayout` 是 Claude Code 前台的真正装配器

源码镜像：[`../../src/components/FullscreenLayout.tsx`](../../src/components/FullscreenLayout.tsx)

如果说 `PromptInput` 是输入面总控，那么 `FullscreenLayout` 就是显示面总控。

它把界面拆成几个 slot：

- `scrollable`
- `bottom`
- `overlay`
- `bottomFloat`
- `modal`

全屏模式下的结构不是简单上下堆叠，而是：

- `ScrollBox` 承载 transcript 和 overlay
- 底部 slot 固定 prompt / spinner / permission area
- `SuggestionsOverlay` 和 `DialogOverlay` 从 bottom slot 逃逸到外层
- modal 绝对定位在底部，再通过 `ModalContext` 给内部降尺寸

这就是为什么 Claude Code 能同时显示聊天滚动区、底部 prompt、浮动建议、slash dialog，而不互相裁剪。

## 14. `ScrollChromeContext`、`useUnseenDivider()` 和 pill 组成了滚动态的副控制面

源码镜像：[`../../src/components/FullscreenLayout.tsx`](../../src/components/FullscreenLayout.tsx)

这条链单独值得注意，因为它不属于消息内容本身，而属于“消息阅读状态”：

- `ScrollChromeContext` 让 `VirtualMessageList` 写入 sticky prompt
- `useUnseenDivider()` 在第一次 scroll-away 时快照 divider index 和 `scrollHeight`
- `useSyncExternalStore()` 直接订阅 `ScrollBox`，用 `dividerYRef` 计算 pill 是否可见
- `countUnseenAssistantTurns()` / `computeUnseenDivider()` 把底层 message entries 折算成用户视角的“几条新消息”

这说明 Claude Code 的“Jump to bottom / N new messages”不是简单看底部偏移，而是专门维护了一套滚动语义层。

## 15. `FullscreenLayout` 还负责把终端超链接接回本机动作

源码镜像：[`../../src/components/FullscreenLayout.tsx`](../../src/components/FullscreenLayout.tsx)

在全屏环境里，它会把 Ink instance 的 `onHyperlinkClick` 接管掉：

- `file:` URL 走 `openPath(fileURLToPath(url))`
- 其他 URL 走 `openBrowser(url)`

所以这层不仅管布局，也管终端里“点击链接之后系统怎么响应”。这和你之前遇到的“文档点击漫游问题”其实属于同一大类：前台运行时必须明确跳转所有权。

## 16. 为什么这一卷必须独立

如果只在 `REPL runtime` 或 `PromptInput` 文档里顺带提这一层，会漏掉一个很重要的事实：Claude Code 已经有一套独立的交互基础设施内核。

它至少包含五个子问题：

- overlay 是否接管输入
- prompt 上浮层如何逃离 clip
- modal 如何获得局部终端尺寸
- keybinding 如何做 context resolution 和 chord state
- fullscreen transcript 如何维持 sticky / unseen / pill / hyperlink 行为

这五件事都不是某个业务功能的附庸，而是 Claude Code 能把大量前台子系统塞进同一个终端里的前提条件。
