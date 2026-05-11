# Claude Code: QueryEngine 像素级重构与解析

> **核心目标**：理解 Agent 如何管理会话生命周期、Turn 循环以及工具编排。

## 1. 核心定义：什么是 QueryEngine？

`QueryEngine` 是 Claude Code 的“大脑中枢”。它不负责具体的 UI 渲染，而是管理：
- **会话状态**：`mutableMessages` (消息历史)。
- **Turn 循环**：`submitMessage` -> `processUserInput` -> `query` (LLM 调用) -> `Tool Execution`。
- **秩序约束**：`canUseTool` (权限审批)、`maxBudgetUsd` (预算控制)、`maxTurns` (死循环防护)。

## 2. 核心流程拆解：`submitMessage` 的像素级链路

当用户输入一个 Prompt 时，`QueryEngine` 经历了以下关键步骤：

### A. 环境准备 (Init & Context)
1. **CWD 设置**：同步当前工作目录。
2. **权限包装**：对 `canUseTool` 进行包装，拦截并记录所有的 `Permission Denial` (权限拒绝)，用于后续审计。
3. **系统提示词 (System Prompt) 组装**：
    - 加载默认 Prompt。
    - 注入 `Memory Mechanics` (如果开启了内存机制)。
    - 注入 `customSystemPrompt` 和 `appendSystemPrompt`。

### B. 输入预处理 (`processUserInput`)
- 这是 Claude Code 的一个精妙设计。它不仅仅是把 Prompt 发给模型，而是先过一遍 `Slash Commands` (如 `/explain`, `/compact`)。
- **逻辑分支**：如果输入是斜杠命令且不需要查询模型 (`shouldQuery=false`)，直接返回本地执行结果。

### C. 核心循环 (`query` Generator)
- 调用底层 `query` 函数（这是一个异步生成器）。
- **消息处理流**：
    - `assistant`: 记录模型思考和输出。
    - `progress`: 实时上报工具执行进度。
    - `user`: 记录工具执行的结果回填。
    - `system`: 处理 `compact_boundary` (上下文压缩) 和 `api_retry`。

### D. 终止条件与审计
- **预算检查**：实时监控 `getTotalCost()`，超过 `maxBudgetUsd` 立即熔断。
- **Turn 限制**：防止 Agent 陷入死循环。
- **持久化**：在关键节点调用 `recordTranscript` 将历史写入磁盘，确保 Crash 后可恢复。

## 3. 对 Vigilon Agent 的启示

1. **状态持久化优先**：Claude Code 在 `submitMessage` 一开始就记录 Transcript，而不是等模型回复，这保证了“任务存证”的绝对可靠。
2. **权限是头等公民**：`PermissionDenial` 被结构化追踪，而不仅仅是简单的 Log。
3. **Monorepo 的必要性**：`QueryEngine` 依赖于大量的 `src/utils` 和 `src/services`，这证明了核心逻辑需要一个深度的工程支撑层。
