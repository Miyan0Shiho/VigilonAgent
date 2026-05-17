# Swarm Discovery、Layout 与 Spawn Inheritance

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：TeamCreate / Backends / Reconnection`](./17-team-create-backends-and-reconnection.md) | [`下一站：Bridge Runtime / Polling / Message Routing`](./19-bridge-runtime-polling-and-message-routing.md)

本文继续下钻 swarm，但不再关注 team root 或 backend 仲裁，而是专门讲那些看起来像“辅助文件”、实际上把 swarm 做成产品功能的协议层：团队可发现性、teammate 颜色与布局分配、spawn 继承的 CLI/env 注入、teammate 的 Stop-hook 初始化，以及这些能力如何被 `useSwarmInitialization` 和 `TeamsDialog` 接到真实 UI 和启动路径里。

## 1. 这层不是核心执行环，但决定了 swarm 能不能成为可用产品

源码镜像：[`../../src/utils/teamDiscovery.ts`](../../src/utils/teamDiscovery.ts), [`../../src/utils/swarm/teammateLayoutManager.ts`](../../src/utils/swarm/teammateLayoutManager.ts), [`../../src/utils/swarm/spawnUtils.ts`](../../src/utils/swarm/spawnUtils.ts), [`../../src/utils/swarm/teammateInit.ts`](../../src/utils/swarm/teammateInit.ts)

这些文件表面上不像 `runAgent()`、`QueryEngine` 那样显眼，但它们分别解决了四个产品级问题：

- 用户怎么“看见”自己的团队状态
- 每个 teammate 在 UI 里如何稳定有颜色、有 pane 身份
- 新生成 teammate 怎样继承 leader 的关键 CLI 和 env 语义
- teammate 在启动后怎样立刻接入 idle notification 和 team permission

如果没有这层，swarm 就只是底层能跑，不会成为一个可持续操作的系统。

## 2. `teamDiscovery.ts` 说明团队状态展示依赖 team file，而不是实时 RPC

源码镜像：[`../../src/utils/teamDiscovery.ts`](../../src/utils/teamDiscovery.ts)

`getTeammateStatuses(teamName)` 做的事情很朴素，但非常关键：

- 读 team file
- 排除 `team-lead`
- 读取 `isActive`
- 结合 `hiddenPaneIds`
- 还原 `backendType`、`mode`、`worktreePath` 等状态

这意味着 Teams UI 不需要对每个 teammate 做实时握手才能显示状态。Claude Code 选择的是真正轻量的产品协议：

- 持久事实来自 team file
- UI 定时刷新这个共享状态

所以 swarm 的可发现性依赖的是文件级共享状态，而不是额外 RPC 层。

## 3. `TeammateStatus` 已经是 Teams UI 的完整产品视图模型

源码镜像：[`../../src/utils/teamDiscovery.ts`](../../src/utils/teamDiscovery.ts), [`../../src/components/teams/TeamsDialog.tsx`](../../src/components/teams/TeamsDialog.tsx)

`TeammateStatus` 里不只放最小状态，还直接带了：

- `agentType`
- `model`
- `prompt`
- `status`
- `color`
- `idleSince`
- `tmuxPaneId`
- `cwd`
- `worktreePath`
- `isHidden`
- `backendType`
- `mode`

这说明 team discovery 不是给后台逻辑用的简化 DTO，而是直接为 TeamsDialog、权限模式切换、hide/show、kill/shutdown 等操作面提供完整数据模型。

## 4. `teammateLayoutManager` 做的不只是颜色分配，而是 session 内的稳定身份视觉协议

源码镜像：[`../../src/utils/swarm/teammateLayoutManager.ts`](../../src/utils/swarm/teammateLayoutManager.ts)

这层最显眼的是 `assignTeammateColor()`，但意义不只在颜色本身：

- 按 `teammateId` 稳定缓存
- round-robin 使用 `AGENT_COLORS`
- 支持 `getTeammateColor()`
- 在 cleanup 时可整体 `clearTeammateColors()`

也就是说 teammate color 不是某次 render 随机抽样，而是 session 范围内的稳定身份信号。它会渗透到：

- pane border / pane title
- worker badge
- spinner tree
- TeamsDialog

所以这是一条身份视觉协议，不只是样式细节。

## 5. `teammateLayoutManager` 还把 pane 操作包成了 backend 无关入口

源码镜像：[`../../src/utils/swarm/teammateLayoutManager.ts`](../../src/utils/swarm/teammateLayoutManager.ts)

这层还代理了：

- `createTeammatePaneInSwarmView()`
- `enablePaneBorderStatus()`
- `sendCommandToPane()`

看起来只是转发，但它的实际作用是把“teammate 布局/外观动作”从 backend 细节中抽出来，给上层一个更接近产品语义的入口。

## 6. `spawnUtils.ts` 是 teammate 启动协议的继承规范

源码镜像：[`../../src/utils/swarm/spawnUtils.ts`](../../src/utils/swarm/spawnUtils.ts)

如果 `PaneBackendExecutor` 是“怎么启动一个 teammate 进程”，那 `spawnUtils` 回答的是“启动时要继承 leader 的哪些语义”。

它至少定义了三件事：

- 用哪个可执行文件启动 teammate
- 哪些 CLI flag 必须继承
- 哪些 env var 必须显式转发

这说明 Claude Code 已经把 teammate spawn 当成一个协议问题，而不是直接把当前命令复制一份。

## 7. `getTeammateCommand()` 明确区分 bundled mode 和脚本入口

源码镜像：[`../../src/utils/swarm/spawnUtils.ts`](../../src/utils/swarm/spawnUtils.ts)

这层会先看 `TEAMMATE_COMMAND_ENV_VAR`，否则：

- bundled mode 用 `process.execPath`
- 否则回退到 `process.argv[1]`

这意味着 teammate 启动命令不是硬编码 `claude`，而是跟随当前构建形态和宿主环境。它避免了“主进程怎么起来的”和“teammate 应该怎么再起一个自己”之间的漂移。

## 8. `buildInheritedCliFlags()` 体现了“哪些 leader 语义必须跨 agent 继承”

源码镜像：[`../../src/utils/swarm/spawnUtils.ts`](../../src/utils/swarm/spawnUtils.ts)

当前会继承的关键 flag 包括：

- permission mode
- `--dangerously-skip-permissions`
- `--model`
- `--settings`
- `--plugin-dir`
- `--teammate-mode`
- `--chrome` / `--no-chrome`

但也有明确的优先级规则，例如：

- `planModeRequired` 时不要继承 bypass permissions

这说明 teammate 继承不是简单“照抄父命令”，而是受安全和产品规则约束的 selective inheritance。

## 9. `buildInheritedEnvVars()` 是 tmux spawn 的语义补丁层

源码镜像：[`../../src/utils/swarm/spawnUtils.ts`](../../src/utils/swarm/spawnUtils.ts)

它显式转发的 env 包括：

- provider 选择相关
- custom API endpoint
- config dir override
- remote / remote memory
- proxy 与证书相关变量

源码注释已经点明原因：tmux 可能启动全新 login shell，不会天然继承当前进程语义。所以这不是锦上添花，而是保证 teammate 和 leader 处在同一 provider/network/config 宇宙里的必要补丁层。

## 10. `teammateInit.ts` 把“启动后要立刻接入团队治理”做成了正式初始化步骤

源码镜像：[`../../src/utils/swarm/teammateInit.ts`](../../src/utils/swarm/teammateInit.ts)

`initializeTeammateHooks()` 至少做两类事情：

- 读取 team-wide allowed paths，并把它们转成 session-level permission rules
- 注册 Stop hook，在 teammate 空闲时给 leader 发 idle notification

这说明 teammate 一旦启动，不是等到第一次工具调用时才接入团队规则，而是会立即把 team governance 注入自己的会话。

## 11. team-wide allowed paths 说明 team 权限共享已经超出单 agent session

源码镜像：[`../../src/utils/swarm/teammateInit.ts`](../../src/utils/swarm/teamHelpers.ts)

`teamAllowedPaths` 会被翻译成：

- 指定 `toolName`
- 指定 path glob
- `destination: 'session'`

这意味着 leader 可以通过 team file 把某些路径的写权限作为“团队公共规则”下发给新 teammate。它不是单个会话临时批准，而是 team 级别的权限模板下推。

## 12. idle notification 不是 UI 文案，而是 hook + mailbox 的正式协议信号

源码镜像：[`../../src/utils/swarm/teammateInit.ts`](../../src/utils/swarm/teammateInit.ts), [`../../src/utils/teammateMailbox.ts`](../../src/utils/teammateMailbox.ts)

Stop hook 触发时，teammate 会：

- `setMemberActive(..., false)`
- 生成 `createIdleNotification(...)`
- 带着 `summary: getLastPeerDmSummary(messages)` 写给 leader mailbox

这说明“某 teammate 空闲了”在 Claude Code 里不是推断状态，而是一条显式事件消息。leader 看到的 idle 既有 team file 状态更新，也有 mailbox 侧的摘要通知。

## 13. `useSwarmInitialization` 是这些协议进入前台会话的真正挂载点

源码镜像：[`../../src/hooks/useSwarmInitialization.ts`](../../src/hooks/useSwarmInitialization.ts)

这个 hook 把前面那几条能力接到了真实会话生命周期里：

- resumed session：从首条 transcript message 读 `teamName/agentName`
- fresh spawn：从 `dynamicTeamContext` 读 teammate 身份
- 两种路径最终都会调用 `initializeTeammateHooks()`

这说明 swarm 初始化没有散在 `main.tsx`、`PromptInput`、`TeamsDialog` 里各做一半，而是有明确的 React-side initialization 接缝。

## 14. `TeamsDialog` 证明 discovery/status 模型已经进入完整 operator UI

源码镜像：[`../../src/components/teams/TeamsDialog.tsx`](../../src/components/teams/TeamsDialog.tsx), [`../../src/utils/teamDiscovery.ts`](../../src/utils/teamDiscovery.ts)

`TeamsDialog` 不是静态列表，它直接围绕 `TeammateStatus[]` 提供了：

- detail drill-down
- 周期性 refresh
- permission mode cycling
- kill / shutdown
- hide / show
- prune idle teammates
- view output / jump pane

这意味着 `teamDiscovery.ts` 输出的数据结构已经不是给一个 footer badge 用的，而是给完整 team operator surface 用的。

## 15. `TeamsDialog` 还说明 hidden/show、mode 切换和 pane 控制都以 team file 为控制面

源码镜像：[`../../src/components/teams/TeamsDialog.tsx`](../../src/utils/swarm/teamHelpers.ts)

它大量调用：

- `addHiddenPaneId`
- `removeHiddenPaneId`
- `setMemberMode`
- `setMultipleMemberModes`
- `removeMemberFromTeam`

所以 TeamsDialog 不是直接操作 UI 本地状态，而是通过 team file 和 backend 共同维护 swarm 控制面。也就是说 team file 不只是状态记录，也是 operator action 的持久落点。

## 16. 这条“辅助协议链”为什么不只是杂项

源码镜像：[`../../src/utils/teamDiscovery.ts`](../../src/utils/teamDiscovery.ts), [`../../src/utils/swarm/teammateLayoutManager.ts`](../../src/utils/swarm/teammateLayoutManager.ts), [`../../src/utils/swarm/spawnUtils.ts`](../../src/utils/swarm/spawnUtils.ts), [`../../src/utils/swarm/teammateInit.ts`](../../src/utils/swarm/teammateInit.ts), [`../../src/hooks/useSwarmInitialization.ts`](../../src/hooks/useSwarmInitialization.ts), [`../../src/components/teams/TeamsDialog.tsx`](../../src/components/teams/TeamsDialog.tsx)

可以压成六步：

1. team file 提供可发现状态
2. layout manager 提供稳定颜色和 pane 操作入口
3. spawn utils 继承 leader 的关键 CLI/env 语义
4. teammate init 把共享权限和 idle hook 注入新 teammate
5. useSwarmInitialization 把这些初始化逻辑挂进真实会话生命周期
6. TeamsDialog 把整个状态和控制面呈现给 leader

所以这不是“边角辅助代码”，而是把 swarm 从底层能力变成可操作产品的协议层。

## 17. 为什么这块值得单独成卷

如果只拆主链而不拆这层，就会遗漏几个真实产品事实：

- teammate 的颜色、pane、身份不是随意的
- spawned agent 会继承大量隐性 leader 语义
- team-wide permissions 会在启动时自动注入
- idle 和可发现状态并不是 UI 推测，而是显式协议
- TeamsDialog 背后是一套 file-backed operator surface

因此 `Discovery / Layout / Spawn Inheritance` 已经是一条独立的 swarm 子专题，不该继续埋在 TeamCreate 或 teammate runtime 总述里。
