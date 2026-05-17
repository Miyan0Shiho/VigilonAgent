# 文件编辑与 Shell 执行

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：工具池与 ToolUseContext`](./02-tool-pool-and-tool-use-context.md) | [`下一站：权限、Hooks 与 Policy`](./04-permissions-hooks-and-policy.md)

本文聚焦 Claude Code 最核心、也最危险的两类本地能力：Bash / PowerShell 执行和 FileEdit 写入。

## 1. BashTool 不是“执行命令然后回显”

源码镜像：[`../../src/tools/BashTool/BashTool.tsx`](../../src/tools/BashTool/BashTool.tsx)

从文件体量和配套模块可以看到 BashTool 自带一套完整子系统：

- `bashPermissions.ts`
- `bashSecurity.ts`
- `readOnlyValidation.ts`
- `shouldUseSandbox.ts`
- `commandSemantics.ts`
- `destructiveCommandWarning.ts`
- 后台任务注册与输出转储

这说明 BashTool 的核心复杂度不是“shell 命令怎么执行”，而是“在 agent 环境里怎么安全地执行”。

## 2. BashTool 在解决哪些具体问题

从源码可见它至少处理：

- 命令是否是 search / read / list 型，从而决定 UI 折叠行为
- 哪些命令理论上成功时没有 stdout
- 哪些命令允许自动后台化，哪些不允许
- 是否应启用 sandbox
- 是否触犯只读约束或危险语义
- 是否需要 foreground task / background task 机制承接

所以 BashTool 实际上是“shell execution policy engine + task adapter + UI adapter”的组合。

## 3. FileEditTool 的复杂度也不在 diff 算法

源码镜像：[`../../src/tools/FileEditTool/FileEditTool.ts`](../../src/tools/FileEditTool/FileEditTool.ts)

它首先解决的是写文件的前置约束：

- secret guard
- deny rule 匹配
- UNC path 安全处理
- 大文件上限
- 文件不存在时的路径建议与相似文件建议
- 空文件 / 新建文件 / 旧字符串匹配规则
- settings 文件的特殊校验

这意味着 FileEditTool 的真正职责是“可审计、可恢复、可受权限约束的精确文本修改”。

## 4. 为什么这两类工具需要和任务系统耦合

BashTool 会直接使用本地 shell task 机制，原因很直接：

- 长命令需要进度与输出文件
- 阻塞命令可能要后台化
- 任务要可终止、可通知、可恢复查看

文件编辑则需要和：

- file history
- diagnostics / LSP
- MCP 的 IDE 通知

保持一致，否则“文件已经改了”和“系统知道文件改了”会脱节。
