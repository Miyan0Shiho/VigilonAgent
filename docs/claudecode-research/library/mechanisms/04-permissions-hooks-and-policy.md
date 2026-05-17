# 权限、Hooks 与 Policy

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：文件编辑与 Shell`](./03-file-editing-and-shell-execution.md) | [`下一站：MCP`](./05-mcp-integration.md)

本文聚焦 Claude Code 如何把权限、hooks 和策略限制编进运行时，而不是把它们留在 UI 边缘。

## 1. 权限上下文是会话状态，不是弹窗状态

源码入口：[`../../src/Tool.ts`](../../src/Tool.ts)

`ToolPermissionContext` 包含：

- 当前 mode
- always allow / deny / ask 规则
- additional working directories
- bypass / auto mode 可用性
- plan mode 进入前的 `prePlanMode`
- 是否应避免 permission prompts

这说明权限模型贯穿整个会话，不是临时 UI 选择。

## 2. hooks 可以在多个阶段改变执行语义

源码入口：[`../../src/types/hooks.ts`](../../src/types/hooks.ts), [`../../src/utils/processUserInput/processUserInput.ts`](../../src/utils/processUserInput/processUserInput.ts)

从当前已读代码可以确认两点：

- 输入阶段 hooks 可以阻断 prompt 继续进入模型
- 工具与 stop 阶段 hooks 通过 query loop 与工具调用链进一步介入

因此 hooks 的作用不是“记录发生了什么”，而是“改变接下来允许发生什么”。

## 3. Policy limits 为什么必须在 fast-path 就介入

在 `cli.tsx` 的 bridge 路径里，进入 `bridgeMain()` 前就要检查 `allow_remote_control` policy。

这体现了一个很重要的工程原则：

- 有些能力是否允许，应该在进入昂贵 runtime 之前就决定
- 否则即使最终被拒，系统已经做了多余初始化，甚至泄露了不该启动的能力面

## 4. Plan mode 与 permission mode 的关系

`ToolPermissionContext` 里的 `prePlanMode` 表明：

- 进入 plan mode 会切换权限语义
- 退出 plan mode 需要恢复原本的 mode

因此 plan mode 不是独立产品壳，而是权限系统的一个特殊运行态。
