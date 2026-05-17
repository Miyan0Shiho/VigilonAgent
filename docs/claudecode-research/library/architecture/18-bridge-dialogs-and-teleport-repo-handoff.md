# Bridge Dialogs 与 Teleport Repo Handoff

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Login / OAuth / Trusted Device UI`](./17-login-oauth-and-trusted-device-ui.md) | [`下一站：Background Task Aggregation / List Runtime`](./19-background-task-aggregation-and-list-runtime.md)

这一卷继续补 bridge 前台系统，但不再讲 `remote-control` 命令入口，而是单独讲三块真正和用户交互的 operator surface：

- `BridgeDialog`
- `BridgeDisconnectDialog`
- `TeleportRepoMismatchDialog`

它们共同解决的不是“怎么建 bridge”，而是“bridge 建好以后怎么继续用、怎么断开、remote teleport 目标仓库不匹配时怎么回到正确 checkout”。

## 1. 这三块 UI 共同管理的是 remote-control 会话的可视化控制面

源码镜像：[`../../sources/claude-code/src/components/BridgeDialog.tsx`](../../sources/claude-code/src/components/BridgeDialog.tsx), [`../../sources/claude-code/src/components/TeleportRepoMismatchDialog.tsx`](../../sources/claude-code/src/components/TeleportRepoMismatchDialog.tsx), [`../../sources/claude-code/src/commands/bridge/bridge.tsx`](../../sources/claude-code/src/commands/bridge/bridge.tsx)

它们分别处在 bridge 生命周期的不同位置：

- `BridgeDialog`：连接已建立后的总览面板
- `BridgeDisconnectDialog`：重复执行 `/remote-control` 时的二次决策面
- `TeleportRepoMismatchDialog`：remote session 要求的 repo 与本地 checkout 不匹配时的修正面

所以这不是“又几个弹窗”，而是一组围绕 remote-control / teleport 体验的前台治理面。

## 2. `BridgeDialog` 不是静态状态页，而是一个持续反映 bridge 会话健康度的 operator 面板

源码镜像：[`../../sources/claude-code/src/components/BridgeDialog.tsx`](../../sources/claude-code/src/components/BridgeDialog.tsx)

这份组件会直接读取多项 AppState：

- `replBridgeConnected`
- `replBridgeSessionActive`
- `replBridgeReconnecting`
- `replBridgeConnectUrl`
- `replBridgeSessionUrl`
- `replBridgeError`
- `replBridgeExplicit`
- `replBridgeEnvironmentId`
- `replBridgeSessionId`
- `verbose`

然后再通过 `getBridgeStatus()`、`buildIdleFooterText()`、`buildActiveFooterText()`、`FAILED_FOOTER_TEXT` 重新组装成当前可读的状态面。也就是说，`BridgeDialog` 并不拥有状态；它是 bridge runtime 的可视化投影层。

## 3. `BridgeDialog` 的一层重要信息是“当前远端会话到底绑定的是哪个 repo/branch/session”

源码镜像：[`../../sources/claude-code/src/components/BridgeDialog.tsx`](../../sources/claude-code/src/components/BridgeDialog.tsx)

这个面板不会只显示“connected”：

- repo 名来自 `basename(getOriginalCwd())`
- branch 来自异步 `getBranch()`
- verbose 模式下还会显示 `environmentId` 和 `sessionId`

这说明它的目标不是只证明 bridge 在线，而是让操作者确认：

- 这个 remote-control 会话到底连的是哪个 checkout
- 绑定的是哪个 branch
- 当前是否还停留在同一个 environment/session

## 4. `BridgeDialog` 把 QR code 当成一等 handoff surface，而不是附属工具

源码镜像：[`../../sources/claude-code/src/components/BridgeDialog.tsx`](../../sources/claude-code/src/components/BridgeDialog.tsx)

这份组件会在：

- `showQR = true`
- 且 `displayUrl` 存在

时用 `qrcode.toString(..., { type: 'utf8' })` 直接生成终端内 ASCII QR。也就是说，它不是只给一个 URL，而是明确支持“跨设备扫码继续会话”的 handoff 方式。

这和普通 CLI 面板差别很大，说明 bridge UI 天生就是为“终端 <-> web / mobile handoff”设计的。

## 5. `BridgeDialog` 的输入模型也是 operator-first，而不是表单式

源码镜像：[`../../sources/claude-code/src/components/BridgeDialog.tsx`](../../sources/claude-code/src/components/BridgeDialog.tsx)

它同时用了两套输入体系：

- `useKeybindings()` 绑定 `confirm:yes` 和 `confirm:toggle`
- `useInput()` 直接截获原始 `d` 键作为 disconnect 热键

这里有个产品取舍很明显：

- toggle 走可配置 action
- disconnect 保留一个原始、极短路径的 hotkey

这说明 bridge 面板更像一个运维控制台，而不是标准确认框。

## 6. `BridgeDialog` 里的 disconnect 不是局部 UI 状态，而是会直接改写全局 bridge 配置

源码镜像：[`../../sources/claude-code/src/components/BridgeDialog.tsx`](../../sources/claude-code/src/components/BridgeDialog.tsx)

当用户按 `d`：

- 如果 `replBridgeExplicit` 为真，会先 `saveGlobalConfig()` 去掉显式 remote-control 配置
- 再 `setAppState()` 把 bridge 相关状态切回断开态
- 最后 `onDone()`

所以 disconnect 在这里不是关闭弹窗，而是一个全局 remote-control 状态切换。

## 7. `/remote-control` 已连接时真正落地的不是 `BridgeDialog`，而是更窄的 `BridgeDisconnectDialog`

源码镜像：[`../../sources/claude-code/src/commands/bridge/bridge.tsx`](../../sources/claude-code/src/commands/bridge/bridge.tsx)

`BridgeToggle` 的逻辑很清楚：

- 如果 `(replBridgeConnected || replBridgeEnabled) && !replBridgeOutboundOnly`
- 就不再走 connect preflight
- 而是直接 `setShowDisconnectDialog(true)`

这说明 Claude Code 把“已连状态下再次执行命令”的语义定义成：

- 不重复连接
- 先进入一个显式的 continue / show QR / disconnect 决策面

## 8. `BridgeDisconnectDialog` 是“重复调用 remote-control”时的最小 operator 决策面

源码镜像：[`../../sources/claude-code/src/commands/bridge/bridge.tsx`](../../sources/claude-code/src/commands/bridge/bridge.tsx)

这份 dialog 提供三条路径：

- `Disconnect`
- `Show QR`
- `Continue`

并且有自己的 focus 状态机：

- `focusIndex`
- `select:next`
- `select:previous`
- `select:accept`

所以这不是普通 modal 文案，而是一个很小但完整的选择器式 operator panel。

## 9. `BridgeDisconnectDialog` 的 continue 分支非常克制，它明确选择“不向 transcript 注入说明文字”

源码镜像：[`../../sources/claude-code/src/commands/bridge/bridge.tsx`](../../sources/claude-code/src/commands/bridge/bridge.tsx)

`handleContinue()` 会：

- `onDone(undefined, { display: 'skip' })`

这表示继续使用现有 remote-control 会话时，系统明确不想向 transcript 多写一句“已继续连接”。这是一种很典型的低噪声 operator-first 设计。

## 10. `TeleportRepoMismatchDialog` 解决的是另一类 bridge/remote 问题：本地 checkout 不再匹配远端目标 repo

源码镜像：[`../../sources/claude-code/src/components/TeleportRepoMismatchDialog.tsx`](../../sources/claude-code/src/components/TeleportRepoMismatchDialog.tsx)

这份组件的核心语义不是登录或连接，而是 repo path remapping：

- 已知 `targetRepo`
- 有一组历史 `initialPaths`
- 用户要从这些候选 checkout 中选一个
- 系统还要再次验证这个路径现在是否仍然对应目标 repo

也就是说，它是 teleport “落到正确工作区”的前台恢复面。

## 11. `TeleportRepoMismatchDialog` 的关键不是列表，而是“边选边清理失效 repo-path 映射”

源码镜像：[`../../sources/claude-code/src/components/TeleportRepoMismatchDialog.tsx`](../../sources/claude-code/src/components/TeleportRepoMismatchDialog.tsx)

选择某个 path 后，它会：

- `validateRepoAtPath(value, targetRepo)`
- 若成功，`onSelectPath(value)`
- 若失败，`removePathFromRepo(targetRepo, value)`
- 并从本地可选列表里删掉这个 path

因此它不是单纯让用户“再选一个目录”，而是在运行时修剪已经失效的 repo 映射知识。

## 12. `TeleportRepoMismatchDialog` 的空态语义也很明确：不是卡死，而是指导用户从正确 checkout 重启 teleport

源码镜像：[`../../sources/claude-code/src/components/TeleportRepoMismatchDialog.tsx`](../../sources/claude-code/src/components/TeleportRepoMismatchDialog.tsx)

当 `availablePaths.length === 0` 时，它不会留下一个空选择器，而是直接提示：

- `Run claude --teleport from a checkout of {targetRepo}`

也就是说，这个 dialog 已经把“自动映射失败后的人工恢复路径”产品化了。

## 13. 这一卷的结论

bridge 前台系统至少已经分成三层：

- `BridgeDialog`：持续状态与 handoff 总览面
- `BridgeDisconnectDialog`：已连接状态下的最小 operator 决策面
- `TeleportRepoMismatchDialog`：repo checkout 错位时的恢复与映射修剪面

这说明 Claude Code 对 bridge/teleport 的处理并不只停留在“能连上”。它已经把连接后运维、继续/断开决策、以及 repo 目标纠偏，全部做成了正式的前台工作面。
