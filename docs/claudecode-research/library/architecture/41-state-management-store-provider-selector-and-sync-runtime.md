# State Management / Store / Provider / Selector / Sync Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Context Visualization / MessageSelector / Manual Compact Workbench`](./40-context-visualization-message-selector-and-manual-compact-workbench.md) | [`下一站：Buddy / Companion / Sprite / Footer / Intro Attachment Runtime`](./42-buddy-companion-sprite-footer-and-intro-attachment-runtime.md)

前面的架构卷已经多次碰到 `AppStateStore.ts`、`AppState.tsx`、`selectors.ts`、`onChangeAppState.ts`，但大多只是把它们当作局部场景的背景板。本卷单独把这一层抽出来，因为 Claude Code 的状态管理并不是“React 组件顺手配一个 context”，而是一套把 REPL、任务前台、bridge、settings、权限模式和外部元数据同步串起来的统一运行时骨架。

## 1. 这层解决的是“全局真相源如何维持一致”，不是普通组件状态复用

源码镜像：[`../../src/state/store.ts`](../../src/state/store.ts), [`../../src/state/AppStateStore.ts`](../../src/state/AppStateStore.ts), [`../../src/state/AppState.tsx`](../../src/state/AppState.tsx), [`../../src/state/onChangeAppState.ts`](../../src/state/onChangeAppState.ts)

Claude Code 的状态层同时要回答几类问题：

- 当前任务前台到底归 leader、teammate，还是 named local agent
- footer 当前 focus 的 pill 是谁
- settings 变化后哪些 runtime 要立即热更新
- permission mode 切换后怎样把外部 metadata、SDK 状态流和本地 UI 一起更新
- REPL bridge、remote viewer、plugin、MCP 这些外围状态怎样进入同一个会话真相源

所以这里的 state 不是“React 为了少传 props 的内部技巧”，而是整套 CLI/TUI runtime 的共享事实层。

## 2. `createStore()` 故意保持极薄，把状态引擎和 React 宿主拆开

源码镜像：[`../../src/state/store.ts`](../../src/state/store.ts)

最底层的 `createStore()` 只有三件事：

- `getState()`
- `setState(updater)`
- `subscribe(listener)`

再加一个可选的 `onChange({ newState, oldState })`。

这层设计很关键，因为它说明 Claude Code 先定义的是“外部可订阅 store”，然后才把 React 接上来。`setState()` 里先比较 `Object.is(next, prev)`，再统一触发 `onChange` 和所有 listener。也就是说：

- 状态引擎本身不依赖 React
- 写入后的副作用有统一入口
- React、headless、bridge、SDK 都可以复用同一套更新语义

这也是为什么后面的 `AppStateProvider` 更像一个宿主适配器，而不是状态本体。

## 3. `AppState` 不是“小而美”的 UI state，而是把 CLI/TUI 会话事实全部提升成一个统一对象

源码镜像：[`../../src/state/AppStateStore.ts`](../../src/state/AppStateStore.ts)

`AppState` 里同时存在几层完全不同的状态：

- 会话与模型层：`settings`、`mainLoopModel`、`toolPermissionContext`
- 任务前台层：`expandedView`、`footerSelection`、`selectedIPAgentIndex`、`coordinatorTaskIndex`、`viewingAgentTaskId`
- 任务与代理层：`tasks`、`agentNameRegistry`、`foregroundedTaskId`
- 远端与 bridge 层：`remoteConnectionStatus`、`replBridge*`
- 能力装配层：`mcp.clients/tools/commands/resources`、`plugins.*`、`agentDefinitions`
- 会话辅助层：`todos`、`notifications`、`elicitation.queue`、`sessionHooks`
- 产品表面层：`companionReaction`、`companionPetAt`

这里最值得注意的不是字段多，而是它们被有意识地放在同一张状态图里。Claude Code 明确把“输入路由、任务前台、bridge 状态、settings 热更新、产品装饰表面”都视为同一个 REPL runtime 的共享事实，而不是分散在几十个组件私有 state 里。

## 4. `getDefaultAppState()` 把默认值、feature gate 和 teammate 启动语义一起固化成会话初始协议

源码镜像：[`../../src/state/AppStateStore.ts`](../../src/state/AppStateStore.ts)

`getDefaultAppState()` 不只是给字段填空值，它还在启动时做了几件很像 runtime policy 的事：

- 如果当前进程是 teammate 且要求 `plan_mode_required`，初始权限模式直接设成 `plan`
- `expandedView = 'none'`、`footerSelection = null`、`selectedIPAgentIndex = -1`、`coordinatorTaskIndex = -1` 这类 sentinel 值被统一规范
- `agentNameRegistry` 用 `Map()` 初始化，说明 name-based agent routing 是正式的一等能力
- `mcp`、`plugins`、`notifications`、`elicitation`、`todos` 这些外围运行面都在会话启动时一起建模

也就是说，默认状态不是“组件初始 UI 长什么样”，而是“这个会话一启动，整套运行时有哪些正式的空态和哨兵语义”。

## 5. `AppStateProvider` 不是普通 context wrapper，而是 store 宿主、settings bridge 和 side-provider 装配点

源码镜像：[`../../src/state/AppState.tsx`](../../src/state/AppState.tsx)

`AppStateProvider` 有几个很明确的架构信号：

- 禁止嵌套 provider，保证整场会话只有一个 store 真相源
- 用 `useState(() => createStore(...))` 固化 store 实例，避免重渲染时重建
- mount 时处理 bypass-permissions 的远端设置 race
- 通过 `useSettingsChange(onSettingsChange)` 把 settings 事件总线接进 store
- 同时把 `MailboxProvider`、`VoiceProvider` 包进来，让这些 side channel 跟随同一个会话状态树

这说明 `AppStateProvider` 扮演的是“状态宿主装配层”，而不是只负责把一个对象塞进 React Context。

## 6. `useAppState()` / `useSetAppState()` 把“读取”和“写入”故意拆开，避免整树被全局状态拖着重渲染

源码镜像：[`../../src/state/AppState.tsx`](../../src/state/AppState.tsx)

这层对性能和约束都做得很明确：

- `useAppState(selector)` 通过 `useSyncExternalStore` 订阅切片
- 注释明确要求 selector 不要返回新对象
- `useSetAppState()` 单独暴露稳定的写入引用
- `useAppStateStore()` 给非 React 代码直接传 `getState/setState`
- `useAppStateMaybeOutsideOfProvider()` 给可选宿主保留容错入口

它的真正意图是：

- 读状态时只订阅你真正关心的那一小块
- 写状态时不要强迫组件先订阅整份全局状态
- 非 React 代码也能直接复用同一份 store

这让 `AppState` 更像一套外部 store 协议，而不是 React 局部实现细节。

## 7. `selectors.ts` 说明这层不只存原始字段，还负责把原始字段提升成输入路由语义

源码镜像：[`../../src/state/selectors.ts`](../../src/state/selectors.ts)

`selectors.ts` 很短，但架构意义很重。

`getViewedTeammateTask()` 和 `getActiveAgentForInput()` 做的事情不是简单查询，而是把：

- `viewingAgentTaskId`
- `tasks`

翻译成：

- `{ type: 'leader' }`
- `{ type: 'viewed', task }`
- `{ type: 'named_agent', task }`

也就是说，状态层并没有停在“存了一个 taskId”。它还负责把这个 taskId 变成“用户输入此刻应该发给谁”的正式判决。这一步把原始状态对象提升成了真正的会话路由协议。

## 8. `onChangeAppState()` 是写侧同步 choke point，把本地状态差分投射到外部系统与持久层

源码镜像：[`../../src/state/onChangeAppState.ts`](../../src/state/onChangeAppState.ts)

这份文件是整套架构最关键的写侧入口之一，因为它集中处理了几类同步：

- `toolPermissionContext.mode` 变化后，统一通知 CCR external metadata 和 SDK 状态流
- `mainLoopModel` 变化后，统一回写 user settings 与 bootstrap override
- `expandedView` 变化后，向后兼容持久化成 `showExpandedTodos/showSpinnerTree`
- `verbose`、`tungstenPanelVisible` 这类 UI/runtime 开关同步到全局配置
- `settings` 变化后，统一清理 auth cache，并在 `env` 变化时重放环境变量

这层的价值在于，它把本来可能散落在 UI、slash command、bridge handler、remote control handler 各处的同步逻辑收口成一个统一的 diff-based choke point。Claude Code 不是要求每个调用方都记得“改完状态顺手通知外部”，而是要求“所有正式状态修改最后都经过同一条写侧桥”。

## 9. `applySettingsChange()` 和 `useSettingsChange()` 把外部配置变化闭合回 store，形成真正的双向环

源码镜像：[`../../src/state/AppState.tsx`](../../src/state/onChangeAppState.ts), [`../../src/state/AppStateStore.ts`](../../src/state/AppStateStore.ts)

这一层最容易被忽视的点是：状态系统不是单向的。

除了 `setAppState -> onChangeAppState -> 外部系统` 这条写出链，还有：

- `useSettingsChange(...)`
- `applySettingsChange(source, store.setState)`

把外部 settings 变化重新喂回 AppState。

这样一来，Claude Code 的状态层形成了闭环：

- 外部配置变化可以进入 store
- store 变化又能回写外部 metadata、config 和缓存

这比单纯的 React state 要强得多，因为它已经具备了“会话 runtime 和配置/runtime 外围系统双向同步”的能力。

## 10. 这套架构真正建立的是“四层分工”：引擎、宿主、派生、同步

源码镜像：[`../../src/state/store.ts`](../../src/state/store.ts), [`../../src/state/AppStateStore.ts`](../../src/state/AppStateStore.ts), [`../../src/state/AppState.tsx`](../../src/state/AppState.tsx), [`../../src/state/selectors.ts`](../../src/state/selectors.ts), [`../../src/state/onChangeAppState.ts`](../../src/state/onChangeAppState.ts)

如果把这一层压缩成结构图，可以分成四层：

- `store.ts`
  - 纯状态引擎
- `AppStateStore.ts`
  - 会话真相源 schema 与默认协议
- `AppState.tsx` / `useAppState()`
  - React 宿主与订阅/写入接口
- `selectors.ts` + `onChangeAppState.ts`
  - 一边做读侧派生，一边做写侧同步

真正重要的结论不是“Claude Code 有个 AppState”，而是它已经把状态管理做成了一个独立架构层：既服务 REPL 前台，又服务 bridge、settings、权限模式、agent routing 和产品表面同步。F 这一缺口补上后，前面很多关于 task frontend、teammate transcript、footer focus、settings hot reload 的文档终于有了统一基座。
