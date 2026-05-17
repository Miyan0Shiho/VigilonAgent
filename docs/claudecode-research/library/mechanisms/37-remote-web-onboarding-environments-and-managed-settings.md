# Remote Web Onboarding / Environments / Managed Settings

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Remote Interactive Host Adapters / Failure Semantics`](./36-remote-interactive-host-adapters-and-failure-semantics.md) | [`下一站：Scheduled Remote Agent Triggers / Bundled Skill / OAuth Tool Runtime`](./50-scheduled-remote-agent-triggers-bundled-skill-and-oauth-tool-runtime.md)

本文拆的不是 remote session transport，而是 Claude Code 把用户接入 claude.ai/code 远端环境时，如何完成：

- `/web-setup` 的 GitHub 凭据导入
- `/remote-env` 的默认环境选择
- remote managed settings 的 eligibility / cache / polling / security gate
- scheduled remote agent 管理入口（详细实现见 [`./50-scheduled-remote-agent-triggers-bundled-skill-and-oauth-tool-runtime.md`](./50-scheduled-remote-agent-triggers-bundled-skill-and-oauth-tool-runtime.md)）

对应源码主链是：`commands/remote-setup/** + commands/remote-env/** + RemoteEnvironmentDialog.tsx + remoteManagedSettings/** + utils/teleport/environmentSelection.ts`。`RemoteTriggerTool` 的独立实现链在新卷册里单拆。

## 1. `/web-setup` 不是“开个网页”，而是一条本地凭据搬运链

源码镜像：[`../../src/commands/remote-setup/remote-setup.tsx`](../../src/commands/remote-setup/remote-setup.tsx), [`../../src/commands/remote-setup/api.ts`](../../src/commands/remote-setup/api.ts)

`/web-setup` 的真正职责不是简单跳到 claude.ai/code，而是：

- 检查本地 Claude OAuth 是否已登录
- 检查 `gh` CLI 是否存在、是否已认证
- 从本地 `gh auth token` 读取 GitHub token
- 把 token 以 API 方式导入 CCR 后端
- 最后 best-effort 创建一个默认 cloud environment

也就是说，它是“把本地 GitHub 身份桥接到 claude.ai/code”的 onboarding command，而不是普通外链按钮。

## 2. `checkLoginState()` 把 `/web-setup` 分成四类前置状态，而不是一刀切失败

源码镜像：[`../../src/commands/remote-setup/remote-setup.tsx`](../../src/commands/remote-setup/remote-setup.tsx)

这个命令在真正显示确认框前，先把用户分到四类：

- `not_signed_in`
- `gh_not_installed`
- `gh_not_authenticated`
- `has_gh_token`

这里最关键的是：它没有把 “Claude 没登录” 和 “GitHub CLI 不可用” 混成一个错误。说明 Claude Code 把 remote onboarding 视为双身份链：

- Claude OAuth 身份
- GitHub CLI 身份

只有两者都具备，才进入真正的 token import 阶段。

## 3. `gh auth token` 被单独再 spawn 一次，是 telemetry-safe 设计，不是重复劳动

源码镜像：[`../../src/commands/remote-setup/remote-setup.tsx`](../../src/commands/remote-setup/remote-setup.tsx)

代码先调用 `getGhAuthStatus()`，再单独执行：

- `execa('gh', ['auth', 'token'], { stdout: 'pipe', stderr: 'ignore', ... })`

原因不是粗心，而是 deliberate split：

- `getGhAuthStatus()` 用 `stdout:'ignore'`，保证 telemetry-safe
- 真正需要 token 时才再开一次子进程，把 stdout 接出来

这说明 `/web-setup` 明确把“判断认证状态”和“提取敏感凭据”拆成两步，避免在普通状态检测路径里无意间暴露 token。

## 4. `RedactedGithubToken` 不是装饰类，而是防日志泄露的安全边界

源码镜像：[`../../src/commands/remote-setup/api.ts`](../../src/commands/remote-setup/api.ts)

`RedactedGithubToken` 做了几件很关键的事：

- `String(token)` 返回 `[REDACTED:gh-token]`
- `JSON.stringify(token)` 也返回 redacted 文本
- `inspect.custom` 同样被覆盖
- 只有 `.reveal()` 才能拿到原始 token

这意味着 Claude Code 在 `/web-setup` 这条链上没有依赖“调用方小心不要打印”，而是把 token 默认变成不可序列化泄露的值对象。

## 5. token import 和环境创建是两段不同成功标准

源码镜像：[`../../src/commands/remote-setup/api.ts`](../../src/commands/remote-setup/remote-setup.tsx)

`handleConfirm()` 的成功链是：

1. `importGithubToken(token)`
2. `createDefaultEnvironment()` best-effort
3. `openBrowser(getCodeWebUrl())`

这里第二步特意写成 best-effort，原因是：

- token import 才是真正的 hard requirement
- default environment 只是为了让首次落地不掉进 env-setup
- 即便创建失败，web 侧状态机仍能回退到环境设置流程

所以 `/web-setup` 的成功条件不是“本地把所有远端状态配齐”，而是“最小可进入远端 web composer”。

## 6. `importGithubToken()` 的后端语义是“把本地 GitHub token 存进 CCR token store”

源码镜像：[`../../src/commands/remote-setup/api.ts`](../../src/commands/remote-setup/api.ts)

这条 API call：

- 走 `prepareApiRequest()`，拿 Claude OAuth 和 org UUID
- POST 到 `/v1/code/github/import-token`
- 带 `anthropic-beta: ccr-byoc-2025-07-29`
- body 里只在最后一跳才 `.reveal()` token

正文注释已经给出真实后端意图：CCR 会验证 GitHub token，并把它 Fernet-encrypted 存进 `sync_user_tokens`。所以这不是“临时拿 token 开一次网页”，而是正式把 GitHub 凭据接进 claude.ai/code 的长期读路径。

## 7. 默认环境创建的目标不是 BYOC，而是先给每个新用户一个可落地的 `anthropic_cloud`

源码镜像：[`../../src/commands/remote-setup/api.ts`](../../src/utils/teleport/environments.ts)

默认环境创建固定写死了一套最小配置：

- `kind: 'anthropic_cloud'`
- `cwd: '/home/user'`
- `python 3.11`
- `node 20`
- `allow_default_hosts: true`

这说明 Claude Code 远端 onboarding 的默认目标不是精细化 infra 配置，而是“先让用户能进一个 trusted network access 的 Anthropic cloud workspace”。

## 8. `/remote-env` 只是薄命令壳，真正的环境选择逻辑都在 `RemoteEnvironmentDialog`

源码镜像：[`../../src/commands/remote-env/remote-env.tsx`](../../src/components/RemoteEnvironmentDialog.tsx)

`/remote-env` 本身只做：

- `return <RemoteEnvironmentDialog onDone={onDone} />`

真正的实现重心在 dialog：

- 拉取可用环境
- 解析当前会使用哪一个环境
- 找出该选择来自哪个 settings source
- 在本地 `localSettings` 写入新的 `remote.defaultEnvironmentId`

所以 `/remote-env` 是典型的 local-jsx command shell，业务主体是前台组件而不是命令文件。

## 9. `getEnvironmentSelectionInfo()` 说明“当前远端环境”是 settings merge 的产物，不是单独 remote state

源码镜像：[`../../src/utils/teleport/environmentSelection.ts`](../../src/utils/teleport/environmentSelection.ts)

环境选择逻辑不是“API 返回一个 current environment”，而是本地自己推导：

- 先 `fetchEnvironments()`
- 再读 `getSettings_DEPRECATED()`
- 看 `remote.defaultEnvironmentId`
- 若存在，则回到 `SETTING_SOURCES` 里倒序找出哪个 source 提供了这个值

这说明远端环境选择被建模成本地 settings 系统的一部分，而不是远端 session 自己维护的独立指针。

## 10. 默认环境选择有一个很具体的产品偏置：优先非 `bridge`

源码镜像：[`../../src/utils/teleport/environmentSelection.ts`](../../src/utils/teleport/environmentSelection.ts)

当没有显式 `defaultEnvironmentId` 时，默认选的是：

- 第一个 `kind !== 'bridge'` 的环境
- 如果全是 bridge，再退到第一项

这说明 Claude Code 的默认远端环境语义不是“任意可用都一样”，而是显式把 bridge 环境降为次选。

## 11. `RemoteEnvironmentDialog` 的多环境模式其实是在做本地 settings source 的可解释切换

源码镜像：[`../../src/components/RemoteEnvironmentDialog.tsx`](../../src/components/RemoteEnvironmentDialog.tsx)

这个 dialog 不只显示 environment list，还会把当前选中来源显示出来：

- 如果来源不是 `localSettings`
- 会拼出 `from ${getSettingSourceName(source)} settings`

同时用户一旦重新选择，写入路径固定是：

- `updateSettingsForSource('localSettings', { remote: { defaultEnvironmentId } })`

也就是说，它不是直接修改“最终生效值”，而是在更高优先级 source 上覆写，借此完成 settings source 层面的解释性控制。

## 12. remote environments API 明确只接受 Claude.ai OAuth，不接受 API key

源码镜像：[`../../src/utils/teleport/environments.ts`](../../src/utils/teleport/environments.ts)

`fetchEnvironments()` 的前置判断非常硬：

- 没有 `getClaudeAIOAuthTokens()?.accessToken` 就直接报错
- 错误信息里明确说 API key authentication is not sufficient

所以 environment selection 不是所有 CLI 模式通用能力，而是 claude.ai/code 远端 surface 的专属能力。

## 13. remote managed settings 的 eligibility 不只是“是否登录”，还会排除 provider/base-url/entrypoint

源码镜像：[`../../src/services/remoteManagedSettings/syncCache.ts`](../../src/services/remoteManagedSettings/syncCache.ts)

`isRemoteManagedSettingsEligible()` 的 gate 很细：

- provider 必须是 `firstParty`
- base URL 必须是 first-party Anthropic
- `CLAUDE_CODE_ENTRYPOINT !== 'local-agent'`
- OAuth enterprise/team 用户允许
- externally injected OAuth token `subscriptionType === null` 也允许
- 或者存在真实 API key

这说明 remote managed settings 的真实边界不是“能不能请求 settings API”，而是“当前宿主是否属于 Anthropic 自身 CLI/CCD 管理平面”。

## 14. `syncCacheState.ts` 的 leaf split 是为了解循环依赖，不是代码洁癖

源码镜像：[`../../src/services/remoteManagedSettings/syncCacheState.ts`](../../src/services/remoteManagedSettings/syncCacheState.ts)

这个文件被刻意拆成 leaf module，原因写得很直白：

- 避免 `settings.ts -> syncCache.ts -> auth.ts -> settings.ts` 的大 SCC

所以 remote managed settings 的 cache 设计不仅是运行时优化，也是在主动控制 settings 子系统的初始化依赖图。

## 15. 远端 managed settings 缓存有两层：session cache + disk cache

源码镜像：[`../../src/services/remoteManagedSettings/syncCacheState.ts`](../../src/services/remoteManagedSettings/syncCacheState.ts)

这里有两层缓存：

- 进程内 `sessionCache`
- 磁盘上的 `remote-settings.json`

`getRemoteManagedSettingsSyncFromCache()` 的读取顺序是：

1. eligibility 不为 `true` 直接返回 `null`
2. 先看 `sessionCache`
3. 再从磁盘同步读
4. 若首次把 remote settings 拉进来，还会 `resetSettingsCache()`

最后这一步尤其关键，说明 remote managed settings 是 merged settings pipeline 的一层，如果它在稍晚时刻才出现，之前缓存的 merged result 必须失效。

## 16. checksum 语义是和 Python 服务端强对齐的，不是前端随便 hash 一下

源码镜像：[`../../src/services/remoteManagedSettings/index.ts`](../../src/services/remoteManagedSettings/index.ts)

`computeChecksumFromSettings()` 明确模拟服务端：

- `sortKeysDeep()`
- `json.dumps(sort_keys=True, separators=(",", ":"))`
- `sha256:...`

这意味着客户端对 remote managed settings 的缓存协商不是弱一致“近似相同”，而是要求和 Python 服务端 checksum 完全可复现对齐。

## 17. remote managed settings API 是 fail-open，而安全检查是 fail-closed

源码镜像：[`../../src/services/remoteManagedSettings/index.ts`](../../src/services/remoteManagedSettings/securityCheck.tsx)

这是整条链最重要的治理结论：

- settings fetch 失败：
  - 整体 fail-open
  - CLI 继续跑，只是没有 remote managed settings
- 新拉到的 settings 含危险字段并被用户拒绝：
  - `handleSecurityCheckResult('rejected')`
  - `gracefulShutdownSync(1)`

所以 Claude Code 区分得很清楚：

- “服务不可达” 不应阻断用户
- “管理面想下发危险设置” 必须显式审批，否则直接停机

## 18. 危险设置审批不是 toast，而是阻塞式前台安全对话框

源码镜像：[`../../src/services/remoteManagedSettings/securityCheck.tsx`](../../src/services/remoteManagedSettings/securityCheck.tsx)

安全检查链会：

- 先 `extractDangerousSettings()`
- 若 `hasDangerousSettingsChanged()` 为真
- 且当前是 interactive mode
- 就 `render(<ManagedSettingsSecurityDialog ... />)`

也就是说，这里不是后台日志确认，而是专门拉起一个阻塞式 dialog，并把 accept/reject 写入 analytics。remote managed settings 的 trust model 已经被接进了正式交互面。

## 19. `RemoteTriggerTool` 把 scheduled remote agents 接成了一个 first-party OAuth tool，而不是 shell wrapper

源码镜像：[`../../src/tools/RemoteTriggerTool/RemoteTriggerTool.ts`](../../src/tools/RemoteTriggerTool/RemoteTriggerTool.ts)

`RemoteTriggerTool` 支持：

- `list`
- `get`
- `create`
- `update`
- `run`

关键点不是动作列表，而是它的执行模型：

- 先 `checkAndRefreshOAuthTokenIfNeeded()`
- 必须有 claude.ai access token
- 必须拿到 org UUID
- 直接走 `/v1/code/triggers`
- `shouldDefer: true`
- `isEnabled()` 同时受 feature flag 和 policy limit 控制

这说明远端 triggers 在 Claude Code 里被当成正式 first-party remote capability，而不是让模型自己写 `curl`。

## 20. `RemoteTriggerTool` 的 UI 也故意保持原始 HTTP surface

源码镜像：[`../../src/tools/RemoteTriggerTool/UI.tsx`](../../src/tools/RemoteTriggerTool/UI.tsx)

它的渲染层非常克制：

- tool use 只显示 `action + trigger_id`
- tool result 只显示 `HTTP <status> (<N lines>)`
- 原始 JSON 全放在 tool result block

这意味着 Claude Code 对这类 operator tool 的态度不是“替用户美化成业务摘要”，而是保留接近原始 API 的控制面，让模型或人都能继续沿原始响应工作。

## 21. 这整条链的本质不是 remote session，而是 remote governance plane

把这些模块放在一起看，会看到一条和会话传输完全不同的 remote 主线：

- `/web-setup`
  - 搬运本地 GitHub 身份到 claude.ai/code
- `/remote-env`
  - 管远端默认执行环境
- `remoteManagedSettings`
  - 管企业/团队远端策略层
- `RemoteTriggerTool`
  - 管 scheduled remote agents

所以这条链的本质不是“怎么连上远端”，而是“怎么让远端工作面可被接入、治理、配置和调度”。

## 交叉参考

- 远端 UI 工作面：[`../architecture/08-tasks-remote-and-agent-detail-ui.md`](../architecture/08-tasks-remote-and-agent-detail-ui.md)
- remote 多宿主交互适配：[`./36-remote-interactive-host-adapters-and-failure-semantics.md`](./36-remote-interactive-host-adapters-and-failure-semantics.md)
- workflow/monitor 工作面：[`./35-workflow-monitor-console-and-task-framework-runtime.md`](./35-workflow-monitor-console-and-task-framework-runtime.md)
- 命令侧 `/web-setup` 总述：[`../commands/08-bootstrap-remote-control-and-web-planning.md`](../commands/08-bootstrap-remote-control-and-web-planning.md)
