# 用户 02：团队负责人与企业管理员

## 目标

- 在不摧毁开发效率的前提下，为 Claude Code 设定组织级安全边界。
- 把允许的扩展、模式和策略下沉为可维护配置，而不是靠人工口头要求。
- 让团队能共享一套 project-level 的工作方式，同时保留必要的本地个性化空间。

## 主要能力

- 使用 Managed/User/Project/Local settings 分层治理 Claude Code 的默认行为。
- 通过 `defaultMode`、`disableAutoMode`、`disableBypassPermissionsMode`、`allowedMcpServers`、`allowManagedHooksOnly`、`allowManagedPermissionRulesOnly`、`allowManagedMcpServersOnly` 等字段锁定边界。
- 通过 hooks、project settings、subagent/skill/project memory 共享团队共识，并限制某些高风险能力。
- 通过 policy limits 对 Remote Control 等入口做组织级开关。

## 关键摩擦

- 配置层级多，管理员必须同时理解 managed settings、project settings、本地覆盖与 CLI 临时参数的优先级。
- 企业想要的是“明确边界”，而不是“丰富玩法”；若 hooks、MCP、subagents、plugins 同时放开，审计难度会快速上升。
- 组织策略一旦和产品默认路径冲突，用户会感知为“功能忽隐忽现”，需要更强的策略可见性与诊断反馈。
- 企业治理很多时候只能限制，不容易解释“为什么被限制”；这会让一线开发把平台团队视为阻碍者。

## 关键源码支撑

- `packages/claude-code/src/utils/settings/constants.ts` 与 `settings.ts`：设置来源与合并逻辑。
- `packages/claude-code/src/utils/settings/types.ts`：管理字段 schema，包含 mode、MCP、hooks、permission 与 marketplace 约束。
- `packages/claude-code/src/utils/settings/mdm/settings.ts`：组织级 managed settings 装载路径。
- `packages/claude-code/src/utils/hooks/hooksConfigManager.ts`：可治理的 hook 事件面。
- `packages/claude-code/src/entrypoints/cli.tsx`：Remote Control 等入口上的 policy limit 检查。

## 对 Vigilon 的启发

- 企业版不是“把专业版加个 admin 页面”，而是要把策略边界真实嵌入 runtime。
- 设置分层必须配套解释与诊断，否则管理员越能控，开发者越难理解。
- 针对企业用户，应优先做“哪些能力被谁在何处限制”的可见性，而不是继续扩充功能列表。
