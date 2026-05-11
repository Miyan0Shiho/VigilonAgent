# AI 时代的 Git 版本管理指南

> 基于 TRAE.ai 《AI 时代的 Git 版本管理》深度解析

## 1. 核心挑战：Agent 引入的新范式

在 AI 参与开发的模式下，Git 的传统假设（单人、有意图、低频决策）被打破：
- **决策黑盒**：Agent 的推理过程（Thought）不直接体现在代码 Diff 中。
- **粒度失衡**：容易产生“巨型单体提交”或“无意义碎片提交”。
- **语义冲突**：文本层面的无冲突合并（Merge）不代表语义层面的逻辑正确。

## 2. 核心策略：Agent-Aware Git Workflow

### 2.1 结构化提交信息 (Commit Trailer)
强制在 Commit Message 末尾使用 Git Trailer 记录元数据：
- `Agent-Task`: 关联的原始任务描述或 ID。
- `Agent-Model`: 执行该任务的具体模型版本（如 DeepSeek-V4）。
- `Agent-Decision`: 本次变更背后的核心设计决策与理由。
- `Agent-Limitation`: 已知局限或遗留 TODO。

### 2.2 提交分层：Checkpoint -> Atomic
- **Checkpoint Commit**: 长任务中的阶段性存档（前缀为 `[WIP]`），用于灾备与分段 Review。
- **Atomic Commit**: 最终合并前，必须通过 `interactive rebase` 将 [WIP] 整理为原子提交：一个提交只做一件事，且代码可编译、可测试。

### 2.3 环境隔离与保护
- **Git Worktree**: 并发任务必须在独立的 Worktree 中执行，物理隔离脏工作区。
- **Feature Branch**: 严禁 Agent 直接推送 `main` 分支，必须通过 PR 流程，并由人工触发 Merge。

## 3. 协作界面：PR 叙事化
PR 不再只是 Diff 的集合，而是 **Agent 设计意图的交付物**。模板应包含：
- **核心变更摘要**（做了什么，而非改了什么文件）。
- **考虑过的替代方案**（Alternatives Considered）。
- **测试覆盖情况**（Unit/Integration/Manual）。
