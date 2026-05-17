# Permission 与 MCP UI 系统

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Components / Hooks / Ink`](./05-components-hooks-and-ink.md) | [`下一站：命令体系`](../commands/01-command-registry-and-dispatch.md)

本文把 `components/permissions/**`、`components/mcp/**`、`hooks/toolPermission/**` 以及相关服务层拆成一卷，说明 Claude Code 如何把“是否允许继续执行”与“MCP 连接是否可信可用”做成交互系统。

## 1. 权限系统的入口不是单个弹窗，而是一套分派器

源码镜像：[`../../src/components/permissions/PermissionRequest.tsx`](../../src/components/permissions/PermissionRequest.tsx)

`PermissionRequest.tsx` 做的第一件事不是渲染 UI，而是做工具到权限组件的映射：

- `BashTool` -> `BashPermissionRequest`
- `FileEditTool` / `FileWriteTool` -> 对应 diff 型权限请求
- `SkillTool` -> `SkillPermissionRequest`
- `AskUserQuestionTool` -> `AskUserQuestionPermissionRequest`
- `GlobTool` / `GrepTool` / `FileReadTool` -> `FilesystemPermissionRequest`

这说明“权限请求”在 Claude Code 里不是统一文案框，而是按工具家族分流的 UI 协议层。

## 2. `PermissionPrompt` 不是按钮组，而是“带反馈的决策界面”

源码镜像：[`../../src/components/permissions/PermissionPrompt.tsx`](../../src/components/permissions/PermissionPrompt.tsx)

这个组件揭示了权限系统的一个关键产品选择：用户不只是在选 `yes/no`，还可以给出下一步指令。

它至少承担：

- accept / reject 双通道的反馈输入
- Tab 进入输入模式
- 针对 accept/reject 的独立 analytics 事件
- keybinding 与 select 交互合流
- escape / cancel 回调

因此 permission prompt 的真实语义是“把审批结果反馈回 agent loop”，而不是简单确认框。

## 3. `PermissionContext.ts` 才是权限系统的调度中枢

源码镜像：[`../../src/hooks/toolPermission/PermissionContext.ts`](../../src/hooks/toolPermission/PermissionContext.ts)

这里可以看到权限判定的完整链路：

- 为每次 tool use 构造包含 `tool`、`input`、`assistantMessage`、`toolUseID` 的上下文
- 先尝试 `executePermissionRequestHooks()`
- 对 Bash 场景尝试 classifier auto approval
- 必要时持久化 permission updates
- 构造 reject / abort / deny 消息，并在需要时打断整个 loop

也就是说，UI 层看到的是弹窗，但运行时真正处理的是“hook、classifier、user、subagent、abort controller”共同参与的决策流水线。

## 4. `PermissionDialog` 只是视觉骨架

源码镜像：[`../../src/components/permissions/PermissionDialog.tsx`](../../src/components/permissions/PermissionDialog.tsx)

它提供的能力很朴素：

- 标题、副标题、worker badge
- 统一 border / color / padding
- 权限请求内容区与标题区分层

这恰好说明架构是反过来的：复杂度不在容器，而在不同 permission request 的内容和调度逻辑。

## 5. MCP UI 不是“设置表单”，而是一套状态浏览器

源码镜像：[`../../src/components/mcp/MCPSettings.tsx`](../../src/components/mcp/MCPSettings.tsx), [`../../src/components/mcp/ElicitationDialog.tsx`](../../src/components/mcp/ElicitationDialog.tsx)

MCP UI 至少分成三类界面：

- `MCPSettings` 这种 server / tools / auth 状态浏览器
- `MCPServerApprovalDialog` 这种 project-level trust 决策框
- `ElicitationDialog` 这种由 MCP server 主动发起的数据采集表单

其中 `ElicitationDialog` 很关键，因为它说明 MCP server 不只是“提供工具”，还可以在执行中反向要求用户补数据、点确认、打开 URL、填表单。

这让 MCP UI 成为能力协商层，而不只是配置页面。

## 6. `.mcp.json` 新 server 的批准链路是独立系统

源码镜像：[`../../src/services/mcpServerApproval.tsx`](../../src/services/mcpServerApproval.tsx), [`../../src/components/MCPServerApprovalDialog.tsx`](../../src/components/MCPServerApprovalDialog.tsx)

这条链清楚地展示了“发现新 server”如何转成用户决策：

- 服务层先找出 project scope 下 `pending` 的 server
- 单个时弹 `MCPServerApprovalDialog`
- 多个时弹 `MCPServerMultiselectDialog`
- 用户可选择仅启用当前 server、启用当前及未来 server，或禁用
- 决策最终写回 `enabledMcpjsonServers` / `disabledMcpjsonServers` / `enableAllProjectMcpServers`

这说明 `.mcp.json` 不是只要落盘就自动生效，而是受显式信任闸门约束。

## 7. MCP 连接异常还会被提升成全局通知

源码镜像：[`../../src/hooks/notifs/useMcpConnectivityStatus.tsx`](../../src/hooks/notifs/useMcpConnectivityStatus.tsx)

这个 hook 会把几类状态主动抬升出来：

- 本地 MCP server failed
- claude.ai connector unavailable
- 本地 server needs auth
- claude.ai connector needs auth

而且它排除了 remote mode，并把通知都引回 `/mcp`。这说明 MCP UI 不只在用户主动打开 `/mcp` 时存在，还是全局状态告警系统的一部分。

## 8. 为什么这一卷必要

如果只看 `REPL.tsx`，很容易误以为这些都是“弹窗细节”。但拆开以后能看到两条清晰主线：

- 权限 UI 负责把 tool execution 的不确定性转成可恢复、可反馈、可持久化的决策
- MCP UI 负责把 server、auth、tool exposure、trust 和 elicitation 变成一个可浏览、可批准、可诊断的运行时表面

所以这不是“UI 零件”，而是 Claude Code 交互治理能力最密集的一层。
