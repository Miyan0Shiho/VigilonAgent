# Policy Settings Runtime Governance Across Env / Hooks / Permissions / MCP / Plugins

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Settings Change Detection / Hot Reload Consumers`](./39-settings-change-detection-and-hot-reload-consumers.md) | [`下一站：Policy Settings Governance Across Agents / Skills / Output Styles / Tips`](./41-policy-settings-governance-across-agents-skills-output-styles-and-tips.md)

上一卷讲的是 settings 变化如何被广播，这一卷讲的是 `policySettings` 一旦进入 merged settings 之后，究竟怎样改写 Claude Code 的真实运行时装配。重点不是“管理员能配什么字段”，而是这些字段如何分别劫持：

- env 注入
- hooks 装配与执行
- permission rules 的读取与持久化
- MCP allow/deny 策略
- plugin surface 的来源限制与 force-disable

对应源码主链是：`utils/managedEnv.ts + utils/hooks/hooksConfigSnapshot.ts + utils/sessionStart.ts + utils/permissions/permissionsLoader.ts + services/mcp/config.ts + utils/settings/pluginOnlyPolicy.ts + utils/plugins/pluginPolicy.ts + state/onChangeAppState.ts`。

## 1. `policySettings` 不是普通高优先级 source，而是多条 runtime gate 的专用开关面

源码镜像：[`../../sources/claude-code/src/utils/managedEnv.ts`](../../sources/claude-code/src/utils/managedEnv.ts), [`../../sources/claude-code/src/utils/hooks/hooksConfigSnapshot.ts`](../../sources/claude-code/src/utils/hooks/hooksConfigSnapshot.ts), [`../../sources/claude-code/src/utils/permissions/permissionsLoader.ts`](../../sources/claude-code/src/utils/permissions/permissionsLoader.ts), [`../../sources/claude-code/src/services/mcp/config.ts`](../../sources/claude-code/src/services/mcp/config.ts), [`../../sources/claude-code/src/utils/settings/pluginOnlyPolicy.ts`](../../sources/claude-code/src/utils/settings/pluginOnlyPolicy.ts)

这几条链共同说明一个事实：`policySettings` 在 Claude Code 里不只是 merge-order 最后生效，而是被很多子系统显式单独读取，用来决定：

- 是否只信任 managed env
- 是否只运行 managed hooks
- 是否只尊重 managed permission rules
- 是否只从 managed settings 读取 MCP allowlist
- 是否把 hooks/prompts/agents/MCP 这类 surface 锁成 plugin-only

也就是说，它不是“最后覆盖一下值”，而是“决定哪些 source 连进入运行时的资格都没有”。

## 2. `applySafeConfigEnvironmentVariables()` 先应用 trusted env，再单独延后 `policySettings.env`

源码镜像：[`../../sources/claude-code/src/utils/managedEnv.ts`](../../sources/claude-code/src/utils/managedEnv.ts)

这里最关键的顺序不是 merge，而是两段式装配：

1. 先应用 `globalConfig`
2. 再应用 trusted source 中的非 `policySettings` 部分
3. 立刻计算 `isRemoteManagedSettingsEligible()`
4. 最后才应用 `policySettings.env`

这说明 `policySettings.env` 不是和 user/local/project env 混在一起一锅端，而是被故意放在“eligibility 已经确定”之后单独注入。目的就是让 remote managed settings 自己的存在判断，先由用户/flag 环境决定，再把 managed env 作为最后的 policy layer 覆盖进来。

## 3. `policySettings.env` 在 safe-path 里拥有“最后写入权”，但 project source 只保留 allowlist

源码镜像：[`../../sources/claude-code/src/utils/managedEnv.ts`](../../sources/claude-code/src/utils/managedEnv.ts), [`../../sources/claude-code/src/utils/managedEnvConstants.ts`](../../sources/claude-code/src/utils/managedEnvConstants.ts)

`applySafeConfigEnvironmentVariables()` 的策略是：

- `userSettings / flagSettings / policySettings` 可以整组 env 进入 trusted path
- `projectSettings / localSettings` 只能通过 `SAFE_ENV_VARS` 白名单回灌

这意味着 project-scoped 设置默认不能改危险 env，例如流量重定向、代理、TLS 信任边界；而 `policySettings` 作为 admin-controlled source，会在 trusted path 中最后写入，因此在 safe env 这一层天然拥有最高优先级。

## 4. host-managed provider strip 说明 managed env 也不能越过宿主控制面

源码镜像：[`../../sources/claude-code/src/utils/managedEnv.ts`](../../sources/claude-code/src/utils/managedEnv.ts), [`../../sources/claude-code/src/utils/managedEnvConstants.ts`](../../sources/claude-code/src/utils/managedEnvConstants.ts)

即使是 settings-sourced env，也都会经过：

- `withoutSSHTunnelVars(...)`
- `withoutHostManagedProviderVars(...)`
- `withoutCcdSpawnEnvKeys(...)`

特别是 `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` 打开时，诸如：

- `ANTHROPIC_BASE_URL`
- `CLAUDE_CODE_USE_BEDROCK`
- `ANTHROPIC_MODEL`
- `CLAUDE_CODE_SUBAGENT_MODEL`

这类 provider-routing 变量会从所有 settings-sourced env 中被剥掉。说明 `policySettings` 虽然强，但仍然不能突破“宿主拥有最终 provider 路由权”的更高层治理边界。

## 5. `onChangeAppState` 把 settings.env 的变化真正落实成进程级 env 重装

源码镜像：[`../../sources/claude-code/src/state/onChangeAppState.ts`](../../sources/claude-code/src/state/onChangeAppState.ts)

当 settings 热更新完成后，不会只停留在 AppState 对象里。`onChangeAppState` 会在：

- `newState.settings !== oldState.settings`
- 且 `newState.settings.env !== oldState.settings.env`

时调用 `applyConfigEnvironmentVariables()`。这意味着 `policySettings` 改 env 不只是“下次启动生效”，而是会通过 settings hot reload 进入当前进程环境，并清掉 auth/proxy/证书相关缓存。

## 6. `hooksConfigSnapshot` 明确把 `policySettings` 当成 hooks 运行资格的仲裁者

源码镜像：[`../../sources/claude-code/src/utils/hooks/hooksConfigSnapshot.ts`](../../sources/claude-code/src/utils/hooks/hooksConfigSnapshot.ts)

这个文件不是简单 `mergedSettings.hooks ?? {}`。它先看三层 gate：

- `policySettings.disableAllHooks === true`：直接全部空
- `policySettings.allowManagedHooksOnly === true`：只返回 `policySettings.hooks`
- `strictPluginOnlyCustomization` 命中 `hooks` surface：也只返回 managed hooks

然后才会退到 merged hooks。

所以 hooks 运行时不是“谁配置了就跑”，而是先通过 policy gate 决定哪些 source 连进入 hook snapshot 的资格都没有。

## 7. non-managed `disableAllHooks` 并不能杀掉 managed hooks，它只会把系统推到“managed-only”

源码镜像：[`../../sources/claude-code/src/utils/hooks/hooksConfigSnapshot.ts`](../../sources/claude-code/src/utils/hooks/hooksConfigSnapshot.ts)

这里有个很细但非常重要的分义：

- 如果 `disableAllHooks` 来自 `policySettings`，所有 hooks 都停
- 如果 `disableAllHooks` 只出现在 non-managed merged settings，结果不是全停，而是只保留 managed hooks

这说明 user/project/local source 没有权力关闭 managed hooks；它们最多只能关闭“自己这边的 hooks”，把系统推进到 managed-only 模式。

## 8. `sessionStart` 和 `setup` 的 plugin hook 跳过逻辑直接复用了 managed-hooks gate

源码镜像：[`../../sources/claude-code/src/utils/sessionStart.ts`](../../sources/claude-code/src/utils/sessionStart.ts)

`processSessionStartHooks()` 和 `processSetupHooks()` 在加载 plugin hooks 之前都会先看：

- `shouldAllowManagedHooksOnly()`

如果为真，就直接跳过 `loadPluginHooks()`。这说明 managed hook policy 不只是影响最终执行集，还会改变启动阶段是否去加载外部 plugin hook 代码。也就是说，`policySettings` 在这里切断的是“插件 hook 进入系统”的入口，而不只是执行时过滤。

## 9. permission rules loader 的 managed-only 模式会同时影响“读取”和“提示用户持久化”

源码镜像：[`../../sources/claude-code/src/utils/permissions/permissionsLoader.ts`](../../sources/claude-code/src/utils/permissions/permissionsLoader.ts)

`allowManagedPermissionRulesOnly` 命中后会触发两件事：

- `loadAllPermissionRulesFromDisk()` 只返回 `policySettings` 的规则
- `shouldShowAlwaysAllowOptions()` 变成 false
- `addPermissionRulesToSettings(...)` 直接拒绝写入

所以这不是单纯的读取过滤。它会连带改变 permission prompt UI、持久化入口和 `/permissions` 侧“还能不能追加 allow rule”的产品行为。

## 10. MCP allowlist 是 managed-only 可切换，denylist 则始终允许用户叠加

源码镜像：[`../../sources/claude-code/src/services/mcp/config.ts`](../../sources/claude-code/src/services/mcp/config.ts)

MCP 这里的政策分层很明确：

- `allowManagedMcpServersOnly === true` 时，allowlist 只从 `policySettings` 读
- denylist 永远从 merged settings 读

结果是：

- 管理员可以决定“哪些 MCP server 有资格被允许”
- 用户仍然可以为自己继续 deny 某些 server

因此这条链不是完全剥夺用户控制，而是把 allow authority 收归 managed source，同时保留用户的自我保护 deny 权。

## 11. `strictPluginOnlyCustomization` 不是 plugin 开关，而是“surface 级来源封锁器”

源码镜像：[`../../sources/claude-code/src/utils/settings/pluginOnlyPolicy.ts`](../../sources/claude-code/src/utils/settings/pluginOnlyPolicy.ts)

它不是简单 `enabledPlugins` 的延伸，而是一个 surface gate：

- `true`：锁全部 surface
- `string[]`：只锁列出的 surface

并且它显式把以下 source 视为 admin-trusted：

- `plugin`
- `policySettings`
- `built-in / builtin / bundled`

其它如 `userSettings / projectSettings / localSettings / flagSettings / mcp` 都会在对应 surface 被锁时失去资格。所以这是“来源治理”机制，而不是“插件是否已安装”的状态位。

## 12. plugin policy 还有一条更硬的 force-disable 线：`enabledPlugins[pluginId] === false`

源码镜像：[`../../sources/claude-code/src/utils/plugins/pluginPolicy.ts`](../../sources/claude-code/src/utils/plugins/pluginPolicy.ts)

`isPluginBlockedByPolicy(pluginId)` 的规则非常直接：

- 只看 `policySettings.enabledPlugins?.[pluginId] === false`

一旦命中，就意味着这个 plugin 不只是默认关闭，而是被视为 policy-blocked，不能由用户在其它 scope 重新启用。也就是说：

- `strictPluginOnlyCustomization` 管的是“哪些来源能定制 surface”
- `enabledPlugins === false` 管的是“某个 plugin 自身能不能存在”

两者不是一回事。

## 13. 这几条 gate 组合起来，`policySettings` 实际上在重写“加载图”

源码镜像：[`../../sources/claude-code/src/utils/managedEnv.ts`](../../sources/claude-code/src/utils/managedEnv.ts), [`../../sources/claude-code/src/utils/hooks/hooksConfigSnapshot.ts`](../../sources/claude-code/src/utils/hooks/hooksConfigSnapshot.ts), [`../../sources/claude-code/src/utils/permissions/permissionsLoader.ts`](../../sources/claude-code/src/utils/permissions/permissionsLoader.ts), [`../../sources/claude-code/src/services/mcp/config.ts`](../../sources/claude-code/src/services/mcp/config.ts), [`../../sources/claude-code/src/utils/settings/pluginOnlyPolicy.ts`](../../sources/claude-code/src/utils/settings/pluginOnlyPolicy.ts)

这几条线放在一起看，Claude Code 对 `policySettings` 的处理方式其实是：

- env：谁能把变量打进进程
- hooks：谁能进入 hooks snapshot，plugin hook 是否还值得加载
- permissions：谁的规则还会被读，用户是否还允许写 persistent allow
- MCP：谁能定义 allowlist truth
- customization surface：哪些 source 还能提供 hooks/prompts/agents/MCP 之类的扩展

换句话说，`policySettings` 不只是覆盖数据，而是在 runtime 装配前就重写了“哪些 source 还算合法输入”的加载图。

## 14. 为什么这条链值得单独成卷

如果只把 `policySettings` 理解成“enterprise managed settings”，会漏掉最关键的一层：它在 Claude Code 里不是一个配置包，而是一组 runtime governance gates。

真正的实现特点是：

- 有些字段是值覆盖，例如 env 最后写入
- 有些字段是读取裁剪，例如 managed-only permission/MCP allowlist
- 有些字段是装配级禁入，例如 plugin hooks 跳过加载
- 有些字段是 surface 级来源隔离，例如 strictPluginOnlyCustomization

因此 `policySettings` 的真实作用不是“给默认值”，而是按功能面分别定义谁还能参与 Claude Code 的运行时组装。
