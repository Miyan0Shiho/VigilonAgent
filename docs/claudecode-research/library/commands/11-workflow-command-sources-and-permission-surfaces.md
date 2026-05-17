# Workflow Command Sources / Permission Surfaces

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Account Auth / Upgrade / Release Info`](./10-account-auth-upgrade-and-release-info.md) | [`下一站：Command Availability / Sources / Display Contracts`](./12-command-availability-sources-and-display-contracts.md)

本文不伪装成“已经拿到了 workflow command 的完整实现”。当前镜像里真正清晰可见的是 workflow commands 作为独立命令来源怎样被接入 slash command 体系，以及 workflow invocation 怎样在权限 UI 上拥有专用审批表面。重点拆的是 `commands.ts`、`types/command.ts`、`commandSuggestions.ts`、`PermissionRequest.tsx` 这条命令外壳链，而不是当前镜像未挂出的 `commands/workflows/index` 或 `createWorkflowCommand` 主体。

## 1. workflow command 不是普通 builtin command，而是 `skills / plugins / workflows` 三类动态来源之一

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts)

`commands.ts` 里有两层和 workflow 直接相关的 gate：

- `workflowsCmd = feature('WORKFLOW_SCRIPTS') ? require('./commands/workflows/index') : null`
- `getWorkflowCommands = feature('WORKFLOW_SCRIPTS') ? require('./tools/WorkflowTool/createWorkflowCommand').getWorkflowCommands : null`

这两层说明 workflow commands 的产品接入不是单一路径：

- 一条是 `/workflows` 这类显式 command surface
- 一条是从 workflow 定义动态生成的 command catalog

后者再与：

- `skillDirCommands`
- `pluginCommands`
- `pluginSkills`
- `bundledSkills`

一起被 `loadAllCommands()` 合并。因此 workflow command 的真正产品定位更像“动态命令源”，不是单个 builtin slash 命令。

## 2. `loadAllCommands()` 的合并顺序说明 workflow commands 在命令目录里比 plugin commands 更靠前，但比 bundled skill 更晚

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts)

命令合并顺序是：

1. `bundledSkills`
2. `builtinPluginSkills`
3. `skillDirCommands`
4. `workflowCommands`
5. `pluginCommands`
6. `pluginSkills`
7. `COMMANDS()`

这意味着 workflow commands 的 discoverability 位置被明确固定在：

- repo/user skill 之后
- plugin command 之前
- builtin static commands 之前

所以 workflow commands 在 Claude Code 里不是被当成“插件扩展的一部分”，而是更接近 repo-aware / cwd-aware 的本地命令层。

## 3. `loadAllCommands(cwd)` 以 cwd 为 memoization key，说明 workflow command source 至少部分依赖当前工作区

源码镜像：[`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts)

`loadAllCommands` 是 `memoize(async (cwd: string) => ...)`。而 workflow commands 通过：

- `getWorkflowCommands(cwd)`

被加载。

这说明 workflow command catalog 不是纯全局静态表，而是和当前 cwd 绑定的发现逻辑。即使看不到主体实现，也可以确定它至少具备：

- 工作区感知
- 动态发现
- 可被缓存但需按 cwd 隔离

这和 builtin commands 完全不同。

## 4. `CommandBase.kind = 'workflow'` 是 workflow command 在命令系统里的正式类型标记，不是 UI 小技巧

源码镜像：[`../../sources/claude-code/src/types/command.ts`](../../sources/claude-code/src/types/command.ts), [`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts)

`types/command.ts` 把：

- `kind?: 'workflow'`

直接放进了 `CommandBase`，并且注释写明：

- `Distinguishes workflow-backed commands (badged in autocomplete)`

这说明 workflow command 的“身份”不是靠 `name` 前缀推断，而是命令协议里的一等字段。它随后会在至少两个地方被消费：

- `commandSuggestions.ts`
- `formatDescriptionWithSource(cmd)` in `commands.ts`

所以 `kind === 'workflow'` 是跨层协议，不只是 typeahead 视觉标签。

## 5. `commandSuggestions.ts` 说明 workflow command 在 slash 输入里有专门 badge 和描述格式

源码镜像：[`../../sources/claude-code/src/utils/suggestions/commandSuggestions.ts`](../../sources/claude-code/src/utils/suggestions/commandSuggestions.ts), [`../../sources/claude-code/src/commands.ts`](../../sources/claude-code/src/commands.ts)

`createCommandSuggestionItem()` 里如果：

- `cmd.type === 'prompt' && cmd.kind === 'workflow'`

就会：

- `tag: 'workflow'`
- `description` 直接取 workflow 自己的说明

不会像普通 command 那样主要依赖 `formatDescriptionWithSource()` 的 source 注记。

同时 `formatDescriptionWithSource()` 也专门处理：

- `if (cmd.kind === 'workflow') return \`${cmd.description} (workflow)\``

这说明 workflow command 在 UI 层的核心设计不是“告诉用户它来自哪个 source”，而是明确告诉用户“这是 workflow-backed command”。

## 6. workflow command 不是 local-jsx 命令的别名，而是更偏 prompt-command 的产品形态

源码镜像：[`../../sources/claude-code/src/types/command.ts`](../../sources/claude-code/src/types/command.ts), [`../../sources/claude-code/src/utils/suggestions/commandSuggestions.ts`](../../sources/claude-code/src/utils/suggestions/commandSuggestions.ts)

`createCommandSuggestionItem()` 只在：

- `cmd.type === 'prompt'`

时才会把 `kind === 'workflow'` 解释成 workflow badge。

这透露出一个很重要的事实：当前命令协议默认把 workflow commands 当成 prompt-style command，而不是 local/local-jsx command。也就是说它更像：

- 生成 prompt
- 触发某种更高层 orchestration

而不是简单地在本地 UI 里同步执行一段 JSX 流程。

这也和之前看到的 `WorkflowTool` 更像 orchestration shell 的判断一致。

## 7. `PermissionRequest.tsx` 说明 workflow invocation 拥有专用审批表面，不和 generic fallback 混用

源码镜像：[`../../sources/claude-code/src/components/permissions/PermissionRequest.tsx`](../../sources/claude-code/src/tools.ts)

权限表面对 workflow 有两条专门的 conditional require：

- `WorkflowTool = require('../../tools/WorkflowTool/WorkflowTool').WorkflowTool`
- `WorkflowPermissionRequest = require('../../tools/WorkflowTool/WorkflowPermissionRequest').WorkflowPermissionRequest`

然后在 `permissionComponentForTool(tool)` 里：

- `case WorkflowTool: return WorkflowPermissionRequest ?? FallbackPermissionRequest`

这说明 workflow invocation 在 ask-permission 路线里不是 generic file/bash/web-fetch 那类复用审批表，而是保留了专用 request surface。即使当前镜像没给出 `WorkflowPermissionRequest` 主体，仍然可以确认：

- workflow invocation 的审批语义被视为独立产品对象
- 它至少被认为需要和 bash / filesystem / ask-user 区分

## 8. monitor invocation 也走完全对称的专用审批面，说明 workflow / monitor 在权限 UI 上是并列家族

源码镜像：[`../../sources/claude-code/src/components/permissions/PermissionRequest.tsx`](../../sources/claude-code/src/tools.ts)

同样的接线还存在于：

- `MonitorTool`
- `MonitorPermissionRequest`

并在 switch 中：

- `case MonitorTool: return MonitorPermissionRequest ?? FallbackPermissionRequest`

所以 workflow 和 monitor 不只是都被 feature gate 保护，它们在 permission UI 层也是对称接入的专用工具家族。它们和 generic fallback 的关系是：

- 有专用请求组件时走专用
- 当前 build 或镜像缺失时才回退到 generic fallback

这反过来也说明 workflow/monitor 在产品设计里不是“小工具”，而是需要独立审批文案和输入展示的高层动作。

## 9. `commands.ts` 里的 workflow command source 与 `PermissionRequest.tsx` 里的 workflow tool surface 是两层不同的接入，不应该混为一条链

一个容易混淆的点是：

- command 层有 workflow command
- tool 层有 WorkflowTool

它们不是同一个对象。

更准确的分工是：

- workflow command source：决定 slash command 如何出现、如何被发现、如何被标记为 workflow
- WorkflowTool / WorkflowPermissionRequest：决定真正执行 workflow orchestration 时怎样过权限面

也就是说 workflow 在 Claude Code 里至少横跨两层：

- command catalog layer
- tool invocation / permission layer

这也是为什么仅仅看 `commands.ts` 还不够，必须把 `PermissionRequest.tsx` 一起读。

## 10. 当前镜像能确认的边界：workflow command plumbing 已经可拆明白，但 command body、workflow script schema、execution steps 仍未展开

当前明确可见的部分：

- `workflowsCmd` 的 feature gate
- `getWorkflowCommands(cwd)` 的动态发现与缓存边界
- `kind === 'workflow'` 的命令协议字段
- workflow badge / description 的 typeahead 规则
- `WorkflowPermissionRequest` / `MonitorPermissionRequest` 的专用审批接线

当前仍不可见的部分：

- `packages/claude-code/src/commands/workflows/index`
- `packages/claude-code/src/tools/WorkflowTool/createWorkflowCommand`
- `packages/claude-code/src/tools/WorkflowTool/WorkflowTool`
- `packages/claude-code/src/tools/WorkflowTool/WorkflowPermissionRequest`
- `packages/claude-code/src/tools/MonitorTool/MonitorTool`
- `packages/claude-code/src/components/permissions/MonitorPermissionRequest`

所以这篇最准确的定位是：

- 已经把 workflow command 作为独立命令来源的 plumbing 拆出来了
- 但还没有也不应该伪造 workflow command body 的行为细节

## 交叉参考

- workflow/monitor 外围 runtime contract：[`../mechanisms/24-workflow-monitor-gates-task-types-and-surface-contracts.md`](../mechanisms/24-workflow-monitor-gates-task-types-and-surface-contracts.md)
- 命令注册与分发总述：[`./01-command-registry-and-dispatch.md`](./01-command-registry-and-dispatch.md)
- 集成与工作流命令总述：[`./03-integration-and-product-workflow-commands.md`](./03-integration-and-product-workflow-commands.md)
- 权限请求分发表面：[`../architecture/25-permission-request-queue-and-dialog-surfaces.md`](../architecture/25-permission-request-queue-and-dialog-surfaces.md)
