# 工具池与 ToolUseContext

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Session Storage`](../implementation/04-session-storage-and-resume.md) | [`下一站：文件编辑与 Shell`](./03-file-editing-and-shell-execution.md)

本文聚焦 Claude Code 的工具抽象、工具池组装，以及为什么 `ToolUseContext` 是整个运行时的横切中枢。

## 1. `ToolUseContext` 不是普通依赖注入

源码镜像：[`../../src/Tool.ts`](../../src/Tool.ts)

`ToolUseContext` 同时携带：

- `options.tools`、`commands`、`mcpClients`
- permission context
- app state 的读写入口
- read file cache
- task 注册相关能力
- hook / prompt / notification / compact / SDK status 相关能力
- 当前 `messages`

这说明工具不是在一个极小的 sandbox 接口里运行，而是在一个完整会话上下文里运行。

## 2. 为什么工具需要知道这么多

因为 Claude Code 里的工具不是“纯函数 RPC”：

- BashTool 会创建任务、修改 cwd、更新 UI 进度
- AgentTool 会生成子代理、注册后台任务、写 metadata
- MCP tool 会触发 auth / elicitation / reconnect
- SkillTool 会牵涉到技能目录与 prompt 注入

如果没有 `ToolUseContext`，这些工具会散落依赖在各处，无法共享一致的权限与状态语义。

## 3. 工具池是如何组装的

源码镜像：[`../../src/tools.ts`](../../src/tools.ts)

工具池至少有三层：

- `getAllBaseTools()`：定义完整 built-in 集合
- `getTools(permissionContext)`：按权限和特殊情况做过滤
- `assembleToolPool(permissionContext, mcpTools)`：把 built-in 与 MCP tools 合并

这几个层次对应三个不同问题：

- 系统理论上有哪些工具
- 这次会话当前允许哪些工具
- 当前 session 最终暴露给模型的完整工具面是什么

## 4. 为什么内置工具要保持前缀稳定

`assembleToolPool()` 的注释和排序逻辑说明，built-in tools 作为 contiguous prefix 是有意设计。

这背后有两个直接目标：

- 避免 MCP 动态工具破坏基础工具的可见顺序
- 保持 prompt cache / tool schema 稳定性

因此工具池顺序本身也是 runtime 行为的一部分，而不是无关紧要的列表细节。
