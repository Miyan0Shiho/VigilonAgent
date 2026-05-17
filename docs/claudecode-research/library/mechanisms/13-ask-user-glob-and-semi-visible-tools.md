# AskUserQuestion、Glob 与半显式工具链接缝

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Memdir / Session Memory`](./12-memdir-and-session-memory.md) | [`下一站：产品卷`](../product/01-positioning-and-surface.md)

本文补两类此前还没独立成卷的工具层：

- 已有完整源码主链的 `AskUserQuestion`、`Glob`
- 在当前镜像里只看到权限接缝、后台任务引用、常量暴露的 `WorkflowTool`、`MonitorTool`

这里的目标不是把所有名字都硬写成完整能力，而是把“已经看清的实现”和“目前只能确认的接缝”分开。

## 1. `AskUserQuestion` 不是普通文本提问，而是结构化用户分支器

源码镜像：[`../../src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx`](../../src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx), [`../../src/tools/AskUserQuestionTool/prompt.ts`](../../src/tools/AskUserQuestionTool/prompt.ts)

这条工具链的核心不是“帮模型问一句话”，而是把用户交互收敛成结构化 schema：

- `questions` 最多 1-4 题
- 每题 `options` 最多 2-4 个
- `header` 用作短标签
- `multiSelect`
- `annotations`
- `metadata.source`

这意味着 AskUserQuestion 的本质是一个受约束的交互协议，而不是自由问答。

## 2. 它在 tool 定义层就已经把交互边界写死了

源码镜像：[`../../src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx`](../../src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx)

`buildTool()` 这一层已经明确了几个行为：

- `shouldDefer = true`
- `requiresUserInteraction() = true`
- `checkPermissions()` 永远走 `ask`
- `isReadOnly() = true`
- `isConcurrencySafe() = true`

也就是说，这不是模型可以偷偷执行完再汇报的工具，而是运行时必须暂停并等用户选择的硬交互点。

## 3. AskUserQuestion 的 prompt 本身就是“何时必须停下来问人”的规范

源码镜像：[`../../src/tools/AskUserQuestionTool/prompt.ts`](../../src/tools/AskUserQuestionTool/prompt.ts)

提示文本里有两个关键约束：

- 当实现中出现歧义、方向分叉、偏好选择时，用它来问
- plan mode 下不要拿它做“计划批准”，批准要走 `ExitPlanMode`

所以 AskUserQuestion 在产品上承担的是“把 agent loop 的不确定处变成显式人工决策点”。

## 4. `preview` 说明它不是单纯单选题，而是可视化比较器

源码镜像：[`../../src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx`](../../src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx), [`../../src/tools/AskUserQuestionTool/prompt.ts`](../../src/tools/AskUserQuestionTool/prompt.ts)

工具定义和 prompt 一起暴露出一个更强的交互能力：

- option 可以带 `preview`
- preview 可以是 markdown 或 html fragment
- html preview 要避开 `<script>`、`<style>`、`<html>`、`<body>`

这意味着它不只是“让用户选 A/B”，而是可以让用户在实现方案、UI mock、代码片段之间做可视比较。

## 5. 真正复杂的部分在 permission request UI，不在 tool 本体

源码镜像：[`../../src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx`](../../src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx)

工具本体只负责 schema、权限决策和结果映射；真正的交互复杂度在 permission request 层：

- `QuestionView`
- `PreviewQuestionView`
- `SubmitQuestionsView`
- `use-multiple-choice-state`
- pasted image / preview sizing / syntax highlighting

这说明 AskUserQuestion 不是“工具调 UI”，而是“工具协议 + 专用审批界面”共同构成的交互子系统。

## 6. AskUserQuestion 的结果不是给人读的，而是回写给模型继续推理

源码镜像：[`../../src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx`](../../src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx)

`mapToolResultToToolResultBlockParam()` 会把结果重写成：

- 每个问题的答案
- 选中的 preview
- 用户补充 notes

然后以 tool result block 形式回灌给模型。也就是说，这个工具的闭环是：

- 模型提出问题
- 用户做结构化选择
- 结果再回到模型推理上下文

它是 Claude Code 人机共决策链的标准接口。

## 7. `Glob` 不是简化版 `Grep`，而是“路径空间探索器”

源码镜像：[`../../src/tools/GlobTool/GlobTool.ts`](../../src/tools/GlobTool/GlobTool.ts), [`../../src/tools/GlobTool/prompt.ts`](../../src/tools/GlobTool/prompt.ts)

`Glob` 的职责非常清晰：

- 按 pattern 找文件名
- 可选 `path`
- 返回文件列表而不是内容命中
- 结果默认上限 `100`

它和 `Grep` 的角色不同：

- `Glob` 决定“去哪些文件”
- `Grep` 决定“在这些文件里搜什么内容”

所以它更像文件空间的候选集生成器。

## 8. `Glob` 在权限和路径治理上比表面看起来更严

源码镜像：[`../../src/tools/GlobTool/GlobTool.ts`](../../src/tools/GlobTool/GlobTool.ts)

这里至少有三层治理：

- `path` 如果提供，必须存在且是目录
- UNC path 特殊跳过 stat，避免 Windows 凭据泄漏类问题
- `checkReadPermissionForTool()` 走文件系统读权限链

这说明就算只是“找文件名”，Claude Code 也把它当成受权限约束的文件系统访问，而不是零成本元数据操作。

## 9. `Glob` 的 UI 其实复用了搜索权限 UI，而不是自建界面

源码镜像：[`../../src/components/permissions/PermissionRequest.tsx`](../../src/components/permissions/FilesystemPermissionRequest/FilesystemPermissionRequest.tsx), [`../../src/tools/GlobTool/UI.tsx`](../../src/tools/GlobTool/UI.tsx)

在权限分发里，`GlobTool` 和 `GrepTool`、`FileReadTool` 一起走 `FilesystemPermissionRequest`。

这意味着运行时把它们归到同一类：

- 都是文件系统读面
- 都需要路径级授权
- 都可以复用 `FilePermissionDialog`

所以 `Glob` 在产品上不是“特殊工具”，而是文件读取治理体系的一部分。

## 10. `Glob` 的结果设计目标是省 token，而不是把所有路径全堆出来

源码镜像：[`../../src/tools/GlobTool/GlobTool.ts`](../../src/tools/GlobTool/GlobTool.ts)

实现里有几处很说明问题：

- 路径会 `toRelativePath()`，尽量相对化
- 结果默认截断
- truncation 时会显式提醒“缩小 pattern 或 path”

这说明它承担的是“下一步搜索导航的前置采样”，不是完整文件清单导出器。

## 11. `WorkflowTool` 与 `MonitorTool` 在当前镜像里还不是完整可见工具链

源码入口：`packages/claude-code/src/tools/WorkflowTool/constants.ts`, [`../../src/components/permissions/PermissionRequest.tsx`](../../src/components/permissions/PermissionRequest.tsx), [`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx)

当前工作区镜像里，我能确认的只有这些事实：

- `WORKFLOW_TOOL_NAME = 'WorkflowTool'`
- `PermissionRequest.tsx` 会在 feature 开启时动态 require `WorkflowTool` / `MonitorTool`
- 它们各自有 permission request 组件
- `BackgroundTasksDialog` 确认存在 `local_workflow`、`monitor_mcp` 两类后台任务和详情页

但当前源码镜像里没有把 `WorkflowTool/WorkflowTool.tsx`、`MonitorTool/MonitorTool.tsx` 主体暴露出来，所以还不能像 `Glob`、`AskUserQuestion` 那样完整追到 tool 定义、schema、call 流程。

## 12. 即便工具主体不在当前镜像里，仍能确认它们是“后台可管理任务”而不是普通一次性 tool

源码镜像：[`../../src/components/tasks/BackgroundTasksDialog.tsx`](../../src/components/tasks/BackgroundTasksDialog.tsx), [`../../src/tasks/pillLabel.ts`](../../src/tasks/pillLabel.ts)

当前能确认的实现特征包括：

- workflow 与 monitor 都进入 Background Tasks 列表
- 它们有运行中状态、停止动作、详情页
- workflow 还暴露了 `skip agent`、`retry agent` 这种多步控制面

这说明这两类工具即便现在源码不全，也不是普通单步 tool call，而是和后台任务系统深度耦合的长生命周期能力。

## 13. 为什么这一卷要把“完整工具”和“半显式工具”放在一起

如果只写完整部分，会遗漏当前库里还存在的关键能力接缝；如果把缺主体源码的能力硬写成完整实现，又会降低文档可信度。

所以这一卷的正确做法是：

- 对 `AskUserQuestion`、`Glob` 给出完整实现级拆解
- 对 `Workflow/Monitor` 明确标记“当前镜像仅能确认到权限与后台任务接缝”

这比把一切都写成“已拆明白”更适合作为给人和大模型用的图书馆。
