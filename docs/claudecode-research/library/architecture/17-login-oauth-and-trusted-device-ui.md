# Login、OAuth 与 Trusted Device UI

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：GitHub Install 与 Review Gates`](./16-github-install-and-review-gates.md) | [`下一站：Bridge Dialogs / Teleport Repo Handoff`](./18-bridge-dialogs-and-teleport-repo-handoff.md)

这一卷不再讲命令语义，而是单独拆 Claude Code 的账号前台子系统：

- `Login` dialog shell
- `ConsoleOAuthFlow` 终端内 OAuth 状态机
- `trustedDevice` 与 `/login` 后置桥接安全刷新

它们共同组成了一条比较特殊的 UI/runtime 链：用户看见的是登录对话框，但真实效果会一路改写 auth、feature gate、policy limits、remote control bridge 凭证。

## 1. 这条链不是普通设置页，而是“会重写当前会话身份”的前台系统

源码镜像：[`../../src/commands/login/login.tsx`](../../src/commands/login/login.tsx), [`../../src/components/ConsoleOAuthFlow.tsx`](../../src/components/ConsoleOAuthFlow.tsx), [`../../src/bridge/trustedDevice.ts`](../../src/bridge/trustedDevice.ts)

它和一般 dialog 最大的区别是：

- 前台交互发生在 dialog 里
- 真实副作用落在 auth state、transcript、GrowthBook、policy limits、remote managed settings、trusted device token

所以这不是“登录窗口”那么简单，而是一个横跨 UI、认证、bridge 安全和会话状态的 operator subsystem。

## 2. `Login` 组件本身非常薄，它的职责是把登录流壳化成标准 dialog

源码镜像：[`../../src/commands/login/login.tsx`](../../src/commands/login/login.tsx), [`../../src/components/design-system/Dialog.tsx`](../../src/components/design-system/Dialog.tsx)

`Login` 组件本身只做三件事：

- 用 `Dialog title="Login"` 包住内容
- 通过 `useMainLoopModel()` 把当前主模型回传给上层
- 用 `ConfigurableShortcutHint` 和二次 `Esc` 提示统一退出交互

真正的登录复杂度不在这个壳，而在它里面装的 `ConsoleOAuthFlow`，以及成功后的 post-login refresh。

## 3. `call()` 的关键不在渲染，而在登录成功后的 runtime refresh protocol

源码镜像：[`../../src/commands/login/login.tsx`](../../src/commands/login/login.tsx)

`call()` 成功后会立刻串起一条后置刷新链：

- `context.onChangeAPIKey()`
- `context.setMessages(stripSignatureBlocks)`
- `resetCostState()`
- `refreshRemoteManagedSettings()`
- `refreshPolicyLimits()`
- `resetUserCache()`
- `refreshGrowthBookAfterAuthChange()`
- `clearTrustedDeviceToken()`
- `enrollTrustedDevice()`
- reset bypass/auto-mode gate checks
- `authVersion + 1`

这意味着 `Login` UI 并不是一个 isolated modal。它是一个“交互式入口 + 大量异步刷新钩子”的装配点。

## 4. `stripSignatureBlocks` 说明身份切换会 retroactively 改写 transcript 可复用性

源码镜像：[`../../src/commands/login/login.tsx`](../../src/commands/login/login.tsx)

这里最容易被忽略的一行是：

- `context.setMessages(stripSignatureBlocks)`

原因不是视觉问题，而是协议问题：

- `thinking`、`connector_text` 等 signature-bearing blocks 绑定旧 API key
- 如果换了 key 还保留旧签名，服务端会拒绝这些历史消息

因此登录成功不仅影响未来请求，也会修改当前 transcript 能否继续合法提交。

## 5. `ConsoleOAuthFlow` 才是这条子系统真正的状态机核心

源码镜像：[`../../src/components/ConsoleOAuthFlow.tsx`](../../src/components/ConsoleOAuthFlow.tsx)

它显式维护了一套 `OAuthStatus`：

- `idle`
- `platform_setup`
- `ready_to_start`
- `waiting_for_login`
- `creating_api_key`
- `about_to_retry`
- `success`
- `error`

这里已经不是普通表单流，而是一个终端里的 mini app。

## 6. 这套 OAuth flow 从一开始就是多登录面、多模式，不是单一 Claude.ai 登录

源码镜像：[`../../src/components/ConsoleOAuthFlow.tsx`](../../src/components/ConsoleOAuthFlow.tsx), [`../../src/services/oauth/client.ts`](../../src/services/oauth/client.ts)

从 props 和 URL 构造就能看出它在同时支持：

- `mode = login`
- `mode = setup-token`
- `forceLoginMethod = claudeai | console`
- `loginWithClaudeAi`
- `inferenceOnly`
- `orgUUID / loginHint / loginMethod`

所以它不是“调用一个网页登录接口”，而是为不同计费/组织/用途路径组装不同 OAuth 形态。

## 7. `ConsoleOAuthFlow` 里被产品化得最彻底的是“自动浏览器 + 手工粘贴码”双通道

源码镜像：[`../../src/components/ConsoleOAuthFlow.tsx`](../../src/components/ConsoleOAuthFlow.tsx)

这条流不是把浏览器当成唯一 happy path，而是内建了两套并行交互：

- 自动打开浏览器后等待回调
- 3 秒后出现 `Paste code here if prompted >`

同时还支持：

- `authorizationCode#state` 手工输入
- 输入 `c` 复制 URL
- token exchange 失败后 retry
- TLS/SSL 代理错误时显示 `getSSLErrorHint()`

这说明 Claude Code 对登录流的设计目标不是“最简”，而是“终端环境里尽量可恢复”。

## 8. `useKeybinding` 在这里不是辅助，而是 OAuth UI 的一等控制面

源码镜像：[`../../src/components/ConsoleOAuthFlow.tsx`](../../src/components/ConsoleOAuthFlow.tsx)

这份组件里至少有三组确认键绑定：

- success 状态下 `confirm:yes` 继续
- `platform_setup` 状态下 `confirm:yes` 退回 idle
- error + retry 可用时 `confirm:yes` 进入 `about_to_retry`

这意味着这套 UI 并不依赖鼠标或表单按钮，而是完全按 Claude Code 现有 keybinding context 来运作。

## 9. `useTerminalSize`、`useTerminalNotification` 和 `setClipboard` 让这条登录流变成“真正的终端原生 UI”

源码镜像：[`../../src/components/ConsoleOAuthFlow.tsx`](../../src/components/ConsoleOAuthFlow.tsx), [`../../src/hooks/useTerminalSize.ts`](../../src/hooks/useTerminalSize.ts), [`../../src/ink/useTerminalNotification.ts`](../../src/ink/useTerminalNotification.ts)

几个看起来零碎的 hook/utility，合在一起其实很关键：

- `useTerminalSize()` 用来给 paste input 计算列宽
- `setClipboard()` 负责把 URL 直接写进终端剪贴板协议
- `useTerminalNotification()` 让登录成功时走终端原生通知

这条流因此不是“把网页交互塞进终端”，而是利用终端原生能力把 OAuth 补成完整工作面。

## 10. `trustedDevice` 不是附属细节，而是 `/login` 后置安全链的一部分

源码镜像：[`../../src/bridge/trustedDevice.ts`](../../src/bridge/trustedDevice.ts)

这个模块的语义很明确：

- trusted device token 只服务于 bridge / remote-control elevated auth
- 是否发送 `X-Trusted-Device-Token` 由 `tengu_sessions_elevated_auth_enforcement` gate 控制
- enrollment 必须发生在 fresh `/login` 后的 10 分钟窗口内
- token 写入 secure storage，并有 memoized read cache

所以 trusted device 不是 bridge 的次要优化，而是登录子系统向 remote-control 安全面提供的凭证后置步骤。

## 11. `clearTrustedDeviceToken()` 和 `enrollTrustedDevice()` 说明账号切换时必须清旧 token 再补新 token

源码镜像：[`../../src/bridge/trustedDevice.ts`](../../src/bridge/trustedDevice.ts), [`../../src/commands/login/login.tsx`](../../src/commands/login/login.tsx)

这条链做得非常谨慎：

- 先 `clearTrustedDeviceToken()`
- 再异步 `enrollTrustedDevice()`

原因也在注释里写透了：

- 如果用户是 account-switch，而不是完全 logout
- 那旧 trusted device token 可能属于前一个账号
- enrollment 还没完成前，bridge heartbeat/poll 仍可能读取到缓存 token

所以这里的顺序不是随手写的，而是“先断旧账户 bridge 身份，再注册新账户 bridge 身份”的安全协议。

## 12. `trustedDevice` 的实现重点是 best-effort，不阻塞登录主链

源码镜像：[`../../src/bridge/trustedDevice.ts`](../../src/bridge/trustedDevice.ts)

这个模块到处都是“失败就记日志并返回”的设计：

- GrowthBook gate 关了直接跳过
- env token 存在就跳过 enrollment
- 没 OAuth token 跳过
- essential traffic only 跳过
- HTTP 失败、storage 读写失败都只记日志

这说明 bridge 安全凭证虽然重要，但它被设计成 post-login best-effort sidecar，而不是阻塞登录的同步前提。

## 13. 这一卷的结论

Claude Code 的登录前台子系统至少分成三层：

- `Login`：标准 dialog 壳与 post-login refresh 装配点
- `ConsoleOAuthFlow`：终端原生 OAuth 状态机
- `trustedDevice`：登录后桥接安全凭证 sidecar

把这条链看成“打开浏览器然后获得 token”会严重低估它。真实情况是：一次 `/login` 成功，实际上会同时重写 transcript 可提交性、feature gates、policy limits、remote settings 和 bridge trusted-device 身份。
