# 产品 04：计划、治理与企业控制面

## 研究问题

- Claude Code 如何把“先计划、再执行、可审批、可回退”做成产品秩序？
- 企业治理为什么不只是 settings 文件，而是贯穿 permission、hooks、MCP、policy 与 session 的控制面？
- 这些治理机制里，哪些是产品层的一等约束？

## 一句话结论

Claude Code 的治理不是附着在 agent 之外的管理后台，而是直接嵌在运行时：permission modes 决定默认动作空间，managed settings 决定组织级边界，hooks 决定确定性控制点，session/transcript/checkpoint 决定可追溯与可恢复。

## 官方主张 -> 用户可见行为 -> 源码实现

| 官方主张 | 用户可见行为 | 源码实现 |
| --- | --- | --- |
| Permission Modes 把 plan mode 定义为“先研究再批准执行” | 用户可以先看方案，再决定进入 auto、acceptEdits 或人工逐步审批 | `packages/claude-code/src/types/permissions.ts` 与 `utils/permissions/PermissionMode.ts` 定义 `plan`，`main.tsx` 暴露 `--permission-mode plan` |
| Settings 把 Managed/User/Project/Local 作为分层配置体系 | 管理员、团队与个人能够在不同 scope 上叠加/覆盖控制项 | `packages/claude-code/src/utils/settings/constants.ts`、`settings.ts`、`types.ts`、`mdm/settings.ts` 处理 managed settings 与多 source 合并 |
| Hooks reference 把 UserPromptSubmit、PreToolUse、PostToolUse、ConfigChange、WorktreeCreate 等视为生命周期控制点 | 团队能在 prompt、tool、config、subagent、worktree 等阶段插入审计或阻断逻辑 | `packages/claude-code/src/utils/hooks/hooksConfigManager.ts` 中列出 hook event metadata 与 matcher；`processUserInput()` 会执行 `UserPromptSubmit` hooks |
| Settings / Sub-agents 文档强调管理员能限制 MCP、hooks、permission rules、auto mode | 企业可把一部分能力收窄到组织许可范围内 | `utils/settings/types.ts` 支持 `allowedMcpServers`、`allowManagedHooksOnly`、`allowManagedPermissionRulesOnly`、`allowManagedMcpServersOnly`、`disableAutoMode`、`disableBypassPermissionsMode` |

## 计划与执行的秩序

### 为什么计划是一等产品机制

- Permission Modes 文档把 plan mode 放在核心控制面，而不是可选命令。
- `tools.ts` 里 `EnterPlanModeTool` / `ExitPlanModeV2Tool` 与常规工具并列，说明“计划”是 runtime 可调用能力，而不是文案层建议。
- `processUserInput()` 还包含 `/ultraplan` 路由和 bridge-safe command 判定，说明计划工作流已进入输入层。

### 产品含义

- Claude Code 把“先想清楚再动手”内建成模式切换，而不是靠用户在自然语言里反复提醒。
- 这直接降低高风险编辑、长任务漂移和权限提示疲劳。

## 治理控制面

### 权限模式

- `default`、`acceptEdits`、`plan`、`dontAsk`、`bypassPermissions` 为外部用户可见模式。
- `auto` 在特定 feature 打开时进入内部模式集合。
- 这意味着 Claude Code 把风险与便利度做成了显式产品拨盘，而不是隐形策略。

### 配置分层

- 官方 Settings 文档的 Managed/User/Project/Local 分层在源码中不是注释，而是完整的 settings source 体系。
- 组织级配置不仅能设默认 mode，还能关闭 bypass/auto、约束 MCP、限制 hooks 与 permission rules 的来源。

### Hooks 作为确定性护栏

- `hooksConfigManager.ts` 中的 event metadata 表明 hooks 能覆盖 SessionStart、UserPromptSubmit、PreToolUse、PermissionRequest、SubagentStart、TaskCreated、ConfigChange、WorktreeCreate 等多阶段。
- 这让团队可以把“必须发生的行为”从模型判断中抽离出来，例如格式化、审计、阻断危险操作、对 config change 进行二次治理。

### 会话与追溯

- `sessionStorage.ts` 明确把 transcript、subagent transcript、remote agent metadata、compact boundary 视作基础设施。
- 这意味着治理不仅是阻止动作，也是让动作可复盘、可恢复、可追责。

## 第一性能力与次级能力

### 第一性治理能力

- permission mode
- managed settings
- hook events
- transcript persistence
- policy limits

### 次级治理能力

- 某个单独审批弹窗样式
- 某个表面专属的 mode selector UI
- 某个入口文案是否强调企业控制

## 官方资料与仓库证据的对照

### 一致之处

- 官方对 settings scopes、hook events、permission modes 的叙述和当前仓库结构高度一致。
- Remote Control 文档里“组织策略可禁用”与 `cli.tsx` 中 `allow_remote_control` 检查完全对上。

### 保留意见

- Auto mode classifier 的全部服务端决策顺序并不都能在本仓本地实现层完全复现，因此正文应区分“客户端 mode 控制”和“服务端 classifier 行为”。
- 企业 admin UI 与后台策略平台本身不在本仓，当前仓更像其本地执行面。

## 对 Vigilon 的启发

- 先设计控制面，再设计 agent 自动化能力；否则权限与恢复只能事后补洞。
- “计划”应该是一种模式，不只是建议话术。
- 如果想做企业可用的 agent，必须把 settings scopes、hooks、transcript 和 policy limit 作为一级模块设计。

## 当前缺口

- 需要补 `services/policyLimits/**` 的更细实现，确认哪些控制来自本地策略，哪些来自远端策略同步。
- 需要补 `utils/settings/types.ts` 的字段级梳理，形成完整的治理项矩阵。
