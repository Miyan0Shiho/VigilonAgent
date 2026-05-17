# Message Selector / Idle Return / Recommendation Dialogs

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Prompt Queue / Elicitation / Input Surfaces`](./26-prompt-queue-and-elicitation-input-surfaces.md) | [`下一站：Task Visibility / Footer / Spinner Cross-Layer Runtime`](./28-task-visibility-footer-and-spinner-cross-layer-runtime.md)

本文继续沿着 `REPL.getFocusedInputDialog()` 往下拆，但不再讲 ask/permission/input-needed，而是专门拆剩余那一带“非核心执行、但会抢当前焦点”的工作面：`message-selector`、`idle-return`、`ide-onboarding`、`effort-callout`、`remote-callout`、`lsp-recommendation`、`plugin-hint`、`desktop-upsell`，以及当前镜像里只有挂点可见的 `ultraplan-choice / ultraplan-launch`。

## 1. 这一层解决的是“对话生命周期与产品引导面”，不是工具执行或权限决策

源码镜像：[`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx), [`../../sources/claude-code/src/components/MessageSelector.tsx`](../../sources/claude-code/src/components/MessageSelector.tsx), [`../../sources/claude-code/src/components/IdleReturnDialog.tsx`](../../sources/claude-code/src/components/IdleReturnDialog.tsx), [`../../sources/claude-code/src/components/LspRecommendation/LspRecommendationMenu.tsx`](../../sources/claude-code/src/components/LspRecommendation/LspRecommendationMenu.tsx), [`../../sources/claude-code/src/components/ClaudeCodeHint/PluginHintMenu.tsx`](../../sources/claude-code/src/components/ClaudeCodeHint/PluginHintMenu.tsx), [`../../sources/claude-code/src/components/EffortCallout.tsx`](../../sources/claude-code/src/components/EffortCallout.tsx), [`../../sources/claude-code/src/components/RemoteCallout.tsx`](../../sources/claude-code/src/components/RemoteCallout.tsx), [`../../sources/claude-code/src/components/IdeOnboardingDialog.tsx`](../../sources/claude-code/src/components/IdeOnboardingDialog.tsx), [`../../sources/claude-code/src/components/DesktopUpsell/DesktopUpsellStartup.tsx`](../../sources/claude-code/src/components/DesktopUpsell/DesktopUpsellStartup.tsx), [`../../sources/claude-code/src/components/DesktopHandoff.tsx`](../../sources/claude-code/src/components/DesktopHandoff.tsx), [`../../sources/claude-code/src/hooks/useLspPluginRecommendation.tsx`](../../sources/claude-code/src/hooks/useLspPluginRecommendation.tsx), [`../../sources/claude-code/src/hooks/useClaudeCodeHintRecommendation.tsx`](../../sources/claude-code/src/hooks/useClaudeCodeHintRecommendation.tsx), [`../../sources/claude-code/src/hooks/usePluginRecommendationBase.tsx`](../../sources/claude-code/src/hooks/usePluginRecommendationBase.tsx), [`../../sources/claude-code/src/projectOnboardingState.ts`](../../sources/claude-code/src/projectOnboardingState.ts)

这些表面共同回答的是：

- 如何把“回到旧消息”“你已经 idle 太久”“建议装个插件”“建议切去桌面端”做成 REPL 里的可中断工作面
- 为什么它们和 permission/prompt 一起挂在同一个 dialog scheduler 上
- 它们各自的 show-once / auto-dismiss / config gate / side-effect 写点在哪里

所以这篇更像 Claude Code 的 lifecycle-and-growth surface layer。

## 2. `getFocusedInputDialog()` 把这些表面放在 permission/prompt 之后，说明它们是次级交互带

源码镜像：[`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx)

在当前可见顺序里，这些分支出现在：

- `message-selector`
- `idle-return`
- `ide-onboarding`
- `model-switch`
- `undercover-callout`
- `effort-callout`
- `remote-callout`
- `lsp-recommendation`
- `plugin-hint`
- `desktop-upsell`
- `ultraplan-choice`
- `ultraplan-launch`

而且它们仍受两条总门控影响：

- `isPromptInputActive` 时 suppress
- `allowDialogsWithAnimation = !toolJSX || toolJSX.shouldContinueAnimation`

这说明它们虽然不直接改变工具权限，却仍然是 REPL 一级焦点资源，而不是普通通知。

## 3. `message-selector` 不是简单历史列表，而是“恢复、回滚、局部总结”的多动作恢复控制台

源码镜像：[`../../sources/claude-code/src/components/MessageSelector.tsx`](../../sources/claude-code/src/components/MessageSelector.tsx), [`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx)

`MessageSelector` 至少做四件事：

- 把历史 `UserMessage` 过滤成可选项，并额外注入当前 prompt 的虚拟消息
- 根据 file history 能力决定是“直接恢复对话”还是先进入 restore-confirm 流
- 在 confirm 流里提供 `restore conversation / restore code / both`
- 额外提供 `summarize from here`，在 ant 构建里还有 `summarize up to here`

这说明 message selector 不是单一 “history recall”，而是：

- context rewind
- code rewind
- partial compact trigger

三种能力的汇流面。

## 4. `MessageSelector` 明确把 file history 作为代码恢复后端，而把 compact pipeline 作为总结后端

源码镜像：[`../../sources/claude-code/src/components/MessageSelector.tsx`](../../sources/claude-code/src/screens/REPL.tsx)

两条最关键的后端支路是：

- `onRestoreCode -> fileHistoryRewind(...)`
- `onSummarize -> partialCompactConversation(...)`

其中 summarize 还显式处理了：

- compact boundary 之后才允许总结
- “被 snip 或 pre-compact 的消息”给 warning，而不是 silent no-op
- fullscreen `from` 和 `up_to` 两种不同的 transcript 替换策略

所以 message selector 实际上是 REPL 最复杂的“历史控制面”之一。

## 5. `preselectedMessage` 说明 message selector 还承担了“直接落到确认页”的次级协议

源码镜像：[`../../sources/claude-code/src/components/MessageSelector.tsx`](../../sources/claude-code/src/screens/REPL.tsx)

它支持：

- 普通打开：先看消息列表
- `preselectedMessage`：跳过 pick-list，直接落到 restore confirm

同时 `Esc` 的行为也变成两级：

- 如果当前在 restore confirm，先回列表
- 如果是 preselected flow，直接关闭

这说明它本身也是一个小状态机，而不是单屏 Select。

## 6. `IdleReturnDialog` 把“长对话 + 长时间 idle”重写成新会话建议，而不是只发一条提示

源码镜像：[`../../sources/claude-code/src/components/IdleReturnDialog.tsx`](../../sources/claude-code/src/screens/REPL.tsx)

`IdleReturnDialog` 的输入只有：

- `idleMinutes`
- `totalInputTokens`
- `onDone(action)`

但它把这组状态重写成很明确的用户决策：

- `continue`
- `clear`
- `never`
- cancel -> `dismiss`

文案的核心不是“你 idle 了”，而是：

- 如果这是个新任务，清空上下文会更快、更省 usage

这说明 idle-return 不是单纯提醒，而是一次显式的 context reset persuader。

## 7. idle-return 在 REPL 里有“hint 通知”和“dialog 决策”两层，而不是只有一个弹框

源码镜像：[`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/components/IdleReturnDialog.tsx)

当前能看到两层面：

- 后台 timer 到阈值后，先发 `idle-return-hint` notification
- 真正的 `IdleReturnDialog` 则在 `focusedInputDialog === 'idle-return'` 时出现

hint 层还有这些 gate：

- `tengu_willow_mode` 必须是 `hint` 或 `hint_v2`
- `idleReturnDismissed` 不能已经关闭
- `getTotalInputTokens()` 必须过 token threshold
- `lastQueryCompletionTime` 之后用户没再互动

所以 idle-return 是一条从 passive hint 到 active decision dialog 的升级链。

## 8. recommendation hooks 不是组件里的本地判断，而是共享的“候选生成 -> 前台占位 -> 安装/禁用”状态机

源码镜像：[`../../sources/claude-code/src/hooks/usePluginRecommendationBase.tsx`](../../sources/claude-code/src/hooks/useLspPluginRecommendation.tsx), [`../../sources/claude-code/src/hooks/useClaudeCodeHintRecommendation.tsx`](../../sources/claude-code/src/hooks/useClaudeCodeHintRecommendation.tsx)

`usePluginRecommendationBase()` 统一抽出了：

- remote mode 下不弹
- 当前已有 recommendation 不重入
- in-flight resolve 不重入
- `clearRecommendation()`
- 标准安装成功/失败 notification

这意味着 LSP 推荐和 `<claude-code-hint />` 推荐共享同一套 recommendation runtime，而不是两份各写各的逻辑。

## 9. LSP recommendation 是“文件编辑驱动的能力补全”，不是静态提示

源码镜像：[`../../sources/claude-code/src/hooks/useLspPluginRecommendation.tsx`](../../sources/claude-code/src/components/LspRecommendation/LspRecommendationMenu.tsx)

它的来源链是：

- `fileHistory.trackedFiles`
- 只检查当前 session 新出现的文件
- `getMatchingLspPlugins(filePath)`
- 每 session 最多 show 一次

前台响应语义是：

- `yes`: 安装并启用插件
- `no`: 如果接近 30s auto-dismiss，当成 ignored count
- `never`: 进入 never-suggest 列表
- `disable`: 全局关闭 LSP recommendations

所以这条链不是 marketing upsell，而是“基于真实编辑轨迹的能力差缺口提示”。

## 10. `LspRecommendationMenu` 和 `PluginHintMenu` 都复用 PermissionDialog，但语义不同

源码镜像：[`../../sources/claude-code/src/components/LspRecommendation/LspRecommendationMenu.tsx`](../../sources/claude-code/src/components/ClaudeCodeHint/PluginHintMenu.tsx)

共同点：

- 都用 `PermissionDialog`
- 都有 30s auto-dismiss
- `onCancel` 都映射成 `no`

差异：

- LSP recommendation 强调 `pluginName + fileExtension + code intelligence`
- Plugin hint 强调 `sourceCommand + marketplaceName`
- LSP 有 `never` 和 `disable all`
- hint 只有 `disable hints`

这说明 Claude Code 把“内部推断出的能力建议”和“外部 CLI/SDK 发来的 hint”放在同一交互语法里，但没有混淆来源语义。

## 11. plugin-hint 是 stderr 协议驱动的前台，而不是文件编辑驱动

源码镜像：[`../../sources/claude-code/src/hooks/useClaudeCodeHintRecommendation.tsx`](../../sources/claude-code/src/components/ClaudeCodeHint/PluginHintMenu.tsx)

这条链的触发源是：

- `subscribeToPendingHint`
- `getPendingHintSnapshot`
- `resolvePluginHint(pendingHint)`

并且它显式处理：

- slot 可能在异步 resolve 期间被更新，不能盲目 clear
- 每个 plugin 只提示一次
- user response 后再 mark shown，而不是 resolve 时就算显示过

这说明 hint recommendation 的核心不是 UI，而是对“外部提示流进入前台”的严格 show-once 管理。

## 12. `EffortCallout` 是订阅与模型切换共同驱动的设置迁移面

源码镜像：[`../../sources/claude-code/src/components/EffortCallout.tsx`](../../sources/claude-code/src/screens/REPL.tsx)

它不是通用设置页，而是专门围绕：

- Opus 4.6
- Pro / Max / Team 订阅分层
- 默认 effort 迁移

来做一次定向引导。

关键行为：

- mount 时就 `markV2Dismissed()`
- 30s auto-dismiss
- `medium/high/low` 选项不是简单保存，而是按 `defaultLevel` 计算是否写成 explicit user override
- 成功后还会把 `AppState.effortValue` 更新到当前 session

所以它更像一个“默认策略迁移弹层”，不是普通 preference picker。

## 13. `RemoteCallout` 是 bridge enable 之前的一次性安全 handoff，而不是 remote-control 主控制面

源码镜像：[`../../sources/claude-code/src/components/RemoteCallout.tsx`](../../sources/claude-code/src/screens/REPL.tsx)

`shouldShowRemoteCallout()` 要求：

- `remoteDialogSeen` 还没看过
- `isBridgeEnabled()`
- 已有 Claude.ai OAuth token

而用户选项只有：

- `enable`
- `dismiss`

REPL 对 `enable` 的后续效果是直接改 AppState：

- `replBridgeEnabled: true`
- `replBridgeExplicit: true`
- `replBridgeOutboundOnly: false`

这说明它是 bridge operator surface 之前的一次性“是否把本会话暴露给 remote”确认门，而不是后续管理台。

## 14. `IdeOnboardingDialog` 和 `projectOnboardingState` 说明 onboarding 在 Claude Code 里并不只是一种表面

源码镜像：[`../../sources/claude-code/src/components/IdeOnboardingDialog.tsx`](../../sources/claude-code/src/projectOnboardingState.ts)

当前至少能看到两种 onboarding：

- IDE onboarding dialog：基于 terminal IDE 类型与 extension 安装状态，做一次会话内欢迎说明
- project onboarding state：基于 `CLAUDE.md` / 空工作区等条件，维护项目级 checklist 和 seen count

而 `getFocusedInputDialog()` 当前只显式渲染了 `ide-onboarding`，没有看到 `init-onboarding` 对应主体。

所以这里要明确分级：

- `ide-onboarding`: 当前源码主体可见
- `init-onboarding`: 当前镜像里只有类型占位和 project-onboarding 相关侧证，不能硬写成完整 REPL dialog

## 15. `ClaudeInChromeOnboarding` 是另一条独立 onboarding 支线，不属于当前 REPL scheduler 主带

源码镜像：[`../../sources/claude-code/src/components/ClaudeInChromeOnboarding.tsx`](../../sources/claude-code/src/components/ClaudeInChromeOnboarding.tsx)

这条组件做的是：

- 检查 Chrome extension 是否安装
- 落 `hasCompletedClaudeInChromeOnboarding`
- 给 `/chrome`、扩展安装与 permission docs 做引导

但它不在当前 `focusedInputDialog` 分支里出现，所以更适合被看成产品 onboarding sidecar，而不是本文主线 scheduler 的一部分。

## 16. `DesktopUpsellStartup -> DesktopHandoff` 是一条真正有后续执行流的增长面，不只是广告弹层

源码镜像：[`../../sources/claude-code/src/components/DesktopUpsell/DesktopUpsellStartup.tsx`](../../sources/claude-code/src/components/DesktopHandoff.tsx)

`DesktopUpsellStartup` 的 gate 很明确：

- 仅支持平台
- growthbook `enable_startup_dialog`
- 未 dismissed
- seenCount < 3

它的用户选择不是结束点：

- `try` -> 进入 `DesktopHandoff`
- `not-now`
- `never`

而 `DesktopHandoff` 本身是一条多阶段运行流：

- `checking`
- `prompt-download`
- `flushing`
- `opening`
- `success`
- `error`

成功路径还会：

- `flushSessionStorage()`
- `openCurrentSessionInDesktop()`
- `gracefulShutdown(0, 'other')`

所以 desktop upsell 不是纯引导，它最终会把当前 CLI 会话转交给桌面端。

## 17. `ultraplan-choice / ultraplan-launch` 当前只有挂点和状态协议可见，属于“部分可见工作面”

源码镜像：[`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx), [`../../sources/claude-code/src/commands/ultraplan.tsx`](../../sources/claude-code/src/commands/ultraplan.tsx), [`../../sources/claude-code/src/state/AppStateStore.ts`](../../sources/claude-code/src/state/AppStateStore.ts)

当前镜像里可以确认：

- `ultraplanPendingChoice` 由 remote poll approval 设置
- `ultraplanLaunchPending` 由 `/ultraplan` 预启动 permission 流设置
- REPL 确实会在 `focusedInputDialog` 上挂 `UltraplanChoiceDialog / UltraplanLaunchDialog`

还能确认一些行为：

- remote 执行目标会跳过 choice dialog
- teleport 执行目标会把 choice 交给前台 dialog
- task 状态要保持 `running`，直到 dialog 真正完成用户选择

但当前镜像里看不到两个 dialog 组件主体定义，所以这里最多能写成：

- REPL 挂载点可见
- 状态协议可见
- 组件内部细节不可见

不能把它们写成像 `MessageSelector` 或 `IdleReturnDialog` 那样的完整实现卷。

## 18. 这条子带的共同模式，是“show-once / auto-dismiss / config gate / handoff side-effect”

把这篇和前两篇 permission/prompt/elicitation 并起来看，会发现这批非核心执行表面有几个共同结构：

- 几乎都有 config gate 或 feature gate
- 很多都有 show-once 或 seen-count 语义
- 多数都用 `PermissionDialog` / `Dialog` + `Select`
- 很多都有 auto-dismiss 或 delayed prompt 机制
- 选项往往不是纯 UI，而会落到真实 side effect

比如：

- 恢复历史
- 安装插件
- 开 bridge
- 写全局设置
- 桌面端 handoff

这说明 Claude Code 的 dialog scheduler 不只是“弹窗系统”，而是产品生命周期控制面总线。
