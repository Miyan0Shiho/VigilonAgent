# Account Auth、Upgrade 与 Release Info 命令链

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Local Review / Security Review / PR Comments`](./09-local-review-security-and-pr-comment-workflows.md) | [`下一站：Workflow Command Sources / Permission Surfaces`](./11-workflow-command-sources-and-permission-surfaces.md)

本文补的是另一组很容易被低估的命令与支撑链：

- `/login`
- `/upgrade`
- `/release-notes`

它们表面上都像“外围功能”，但实际上在承接 Claude Code 的账号切换、OAuth 登录、订阅升级、发行说明缓存与版本提示。

## 1. 这三条链共同管理的不是代码能力，而是“谁在用、用的是什么身份、最近更新了什么”

源码镜像：[`../../sources/claude-code/src/commands/login/index.ts`](../../sources/claude-code/src/commands/login/index.ts), [`../../sources/claude-code/src/commands/login/login.tsx`](../../sources/claude-code/src/commands/login/login.tsx), [`../../sources/claude-code/src/commands/upgrade/upgrade.tsx`](../../sources/claude-code/src/commands/upgrade/upgrade.tsx), [`../../sources/claude-code/src/commands/release-notes/release-notes.ts`](../../sources/claude-code/src/commands/release-notes/release-notes.ts)

它们分别覆盖三种不同产品面：

- `/login`：建立或切换当前 Claude 身份
- `/upgrade`：把当前订阅升级路径和登录刷新串起来
- `/release-notes`：把 changelog 变成低延迟、可缓存的本地信息面

所以这一卷的核心不是“命令怎么调”，而是 Claude Code 如何处理账号、订阅、更新信息这几个非代码工作面。

## 2. `/login` 在命令注册层就是一个受环境控制的本地 JSX 工作面

源码镜像：[`../../sources/claude-code/src/commands/login/index.ts`](../../sources/claude-code/src/commands/login/index.ts), [`../../sources/claude-code/src/utils/auth.ts`](../../sources/claude-code/src/utils/auth.ts)

`login/index.ts` 很薄，但已经暴露出两条关键产品语义：

- `type: 'local-jsx'`
- `isEnabled: () => !DISABLE_LOGIN_COMMAND`

描述文案还会根据 `hasAnthropicApiKeyAuth()` 切换：

- 有 Anthropic API key auth 时：`Switch Anthropic accounts`
- 否则：`Sign in with your Anthropic account`

这说明 `/login` 不是固定“登录页”，而是会根据当前 auth source 把自己表现成：

- 首次登录入口
- 或账号切换入口

## 3. `/login` 命令真正重的地方不在 OAuth，而在登录成功后的 runtime reset

源码镜像：[`../../sources/claude-code/src/commands/login/login.tsx`](../../sources/claude-code/src/commands/login/login.tsx)

`call()` 在成功后不是只 `onDone("Login successful")`，而是串了一整套登录后刷新逻辑：

- `context.onChangeAPIKey()`
- `context.setMessages(stripSignatureBlocks)`
- `resetCostState()`
- `refreshRemoteManagedSettings()`
- `refreshPolicyLimits()`
- `resetUserCache()`
- `refreshGrowthBookAfterAuthChange()`
- `clearTrustedDeviceToken()`
- `enrollTrustedDevice()`
- reset bypass/auto-mode killswitch checks
- `authVersion + 1`

这说明 `/login` 在 Claude Code 里不是“得到 token 就结束”，而是一个会重置会话身份、重新拉 feature flag、权限限制、remote settings、trusted-device 状态的 runtime mutation 点。

## 4. `stripSignatureBlocks` 暴露了一个很关键的身份切换约束

源码镜像：[`../../sources/claude-code/src/commands/login/login.tsx`](../../sources/claude-code/src/commands/login/login.tsx)

登录后立即执行：

- `context.setMessages(stripSignatureBlocks)`

源码注释已经讲明白原因：

- `thinking`、`connector_text` 这类 signature-bearing blocks 绑定到旧 API key
- 新 key 继续带着旧签名发请求，会被服务端拒绝

所以登录切换在 Claude Code 里不仅影响未来请求，也会 retroactively 影响当前 transcript 里哪些消息还能合法重用。

## 5. `Login` 组件本身不是浏览器跳转壳，而是一个标准 dialog shell

源码镜像：[`../../sources/claude-code/src/commands/login/login.tsx`](../../sources/claude-code/src/commands/login/login.tsx), [`../../sources/claude-code/src/components/ConsoleOAuthFlow.tsx`](../../sources/claude-code/src/components/ConsoleOAuthFlow.tsx)

`Login` 组件做了三件明确的 UI 组织工作：

- 用 `Dialog` 装载登录流程
- 通过 `useMainLoopModel()` 把当前主模型回传给上层 `onDone`
- 用 `ConfigurableShortcutHint` 和 `Esc` 退出提示把登录流程做成标准 confirmation surface

也就是说，登录不是零散地插进 REPL，而是被做成一个正式的 modal flow。

## 6. `ConsoleOAuthFlow` 是真正的登录状态机，不是普通“打开浏览器然后等”

源码镜像：[`../../sources/claude-code/src/components/ConsoleOAuthFlow.tsx`](../../sources/claude-code/src/components/ConsoleOAuthFlow.tsx)

它自己维护了一整套 OAuthStatus：

- `idle`
- `platform_setup`
- `ready_to_start`
- `waiting_for_login`
- `creating_api_key`
- `about_to_retry`
- `success`
- `error`

而且支持多种进入方式：

- 普通 login
- `setup-token` 模式
- `forceLoginMethod = claudeai | console`

这说明 Claude Code 的登录流不是单一订阅体系，而是在同时支持：

- Claude Pro/Max 订阅型登录
- Console API usage billing 型登录
- 长期 inference-only token 生成

## 7. `ConsoleOAuthFlow` 里真正被产品化的是“自动浏览器 + 手动粘贴码”双通道

源码镜像：[`../../sources/claude-code/src/components/ConsoleOAuthFlow.tsx`](../../sources/claude-code/src/components/ConsoleOAuthFlow.tsx), [`../../sources/claude-code/src/services/oauth/client.ts`](../../sources/claude-code/src/services/oauth/client.ts)

这条流不是假设浏览器总能自动完成，而是显式支持双通道：

- 正常路径：打开浏览器，等待 OAuth 回调
- 退化路径：3 秒后显示 `Paste code here if prompted >`

它还支持：

- 输入 `authorizationCode#state`
- 按 `c` 复制登录 URL
- token exchange 失败后 retry
- SSL 拦截场景下显示 `getSSLErrorHint()`

所以这里被设计出来的不是“网页登录”，而是“终端内可恢复 OAuth workflow”。

## 8. `services/oauth/client.ts` 说明登录并不只绑定 Claude.ai，也能在 authorize URL 层分流

源码镜像：[`../../sources/claude-code/src/services/oauth/client.ts`](../../sources/claude-code/src/services/oauth/client.ts)

`buildAuthUrl()` 会根据参数分流：

- `loginWithClaudeAi` 决定 `CLAUDE_AI_AUTHORIZE_URL` 还是 `CONSOLE_AUTHORIZE_URL`
- `inferenceOnly` 决定 scope 是 `CLAUDE_AI_INFERENCE_SCOPE` 还是 `ALL_OAUTH_SCOPES`
- `isManual` 决定 redirect URI 是手动回调页还是本地 listener
- `orgUUID / loginHint / loginMethod` 继续影响登录体验

这说明 Claude Code 的登录体系从 URL 构造层就已经是“多 auth surface”而不是单一账号入口。

## 9. `/upgrade` 不是独立工作面，而是“升级后立刻重进登录”

源码镜像：[`../../sources/claude-code/src/commands/upgrade/upgrade.tsx`](../../sources/claude-code/src/commands/upgrade/upgrade.tsx), [`../../sources/claude-code/src/services/oauth/getOauthProfile.ts`](../../sources/claude-code/src/services/oauth/getOauthProfile.ts)

`/upgrade` 的关键不是打开 `https://claude.ai/upgrade/max`，而是它怎么处理升级前后的身份状态：

- 若当前已经是最高 `Max 20x`，直接短路并建议改用 `/login` 切到 API usage-billed account
- 若本地 token 带了 `subscriptionType / rateLimitTier`，直接本地判断
- 否则再用 `getOauthProfileFromOauthToken()` 去补 profile 判断
- 浏览器打开升级页后，马上渲染新的 `Login`
- 成功后再 `context.onChangeAPIKey()`

所以 `/upgrade` 的真实语义不是“去付费”，而是“把升级漏斗和 CLI 身份刷新接成一条连续链路”。

## 10. `/release-notes` 真正重要的不是 500ms，而是“文件缓存 + 下次启动即读”

源码镜像：[`../../sources/claude-code/src/commands/release-notes/release-notes.ts`](../../sources/claude-code/src/commands/release-notes/release-notes.ts), [`../../sources/claude-code/src/utils/releaseNotes.ts`](../../sources/claude-code/src/utils/releaseNotes.ts)

`release-notes.ts` 本身只暴露了表层策略：

- 500ms 内拿到新 changelog 就用新的
- 否则用缓存
- 缓存也没有就给 URL

但 `utils/releaseNotes.ts` 才说明产品设计的重点：

- changelog 不随 build bundling
- 后台从 GitHub raw URL 拉取
- 写到 `~/.claude/cache/changelog.md`
- 用内存缓存支撑同步渲染路径
- 在 startup 迁移旧 config-based cache 到 file-based cache

这意味着 `/release-notes` 不是“发个网络请求看看”，而是依赖一条“后台抓取 -> 文件缓存 -> 下次启动即时显示”的更新信息通道。

## 11. `parseChangelog()` 和 `getRecentReleaseNotes()` 把 changelog 变成了版本感知的数据层

源码镜像：[`../../sources/claude-code/src/utils/releaseNotes.ts`](../../sources/claude-code/src/utils/releaseNotes.ts)

这套工具链不只是缓存原文，还会：

- 解析 `## x.y.z` sections
- 提取 bullet notes
- 比较当前版本和上次已见版本
- 最多只展示 `MAX_RELEASE_NOTES_SHOWN = 5`

所以 Claude Code 的 release info 不是“全文展示 CHANGELOG”，而是按版本差异做裁剪后的产品提示层。

## 12. 这一卷的结论

Claude Code 在账号与发布信息面至少已经形成三条明确工作流：

- `/login`：终端内 OAuth 登录状态机 + 登录后 runtime refresh
- `/upgrade`：订阅升级漏斗 + 重新登录接力
- `/release-notes`：GitHub changelog 后台抓取 + 文件缓存 + 版本差异展示

这三条链共同说明：Claude Code 的命令层不仅是在调模型和工具，也在直接管理“当前身份是谁、是否需要升级、最近这个产品更新了什么”。
