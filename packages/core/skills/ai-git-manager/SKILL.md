# Skill: ai-git-manager

**Description**: 专门用于 AI Agent 的版本管理助手，确保 Git 操作符合《Vigilon Git 协作规则》。它能够自动生成带有结构化 Trailer 的提交信息，并辅助进行 Checkpoint 管理。

## Capabilities

### 1. 结构化提交 (Structured Commit)
自动分析代码 Diff，并引导 Agent 填写决策意图，生成符合规范的 Commit Message。
- **Inputs**: `diff`, `task_id`, `decision_reason`, `is_wip`.
- **Logic**:
    - 如果 `is_wip=true`，前缀加 `[WIP]`。
    - 否则，根据 Diff 自动识别 `type` (feat/fix/...)。
    - 强制注入 `Agent-Task`, `Agent-Decision`, `Agent-Model` trailers。

### 2. 检查点存档 (Checkpointing)
在长任务的关键节点快速执行 [WIP] 提交。
- **Command**: `ai-git-manager save-checkpoint --task <id> --reason <reason>`

### 3. 历史压缩 (Atomic Squash)
辅助执行交互式 Rebase，将所有 [WIP] 提交压缩为正式的原子提交。
- **Logic**: 查找当前分支所有以 `[WIP]` 开头的提交，合并为一个语义完整的正式提交。

### 4. 环境隔离校验 (Worktree Isolation Check)
校验当前操作是否在独立的 Git Worktree 中进行，防止污染主工作区。

## Implementation Note (Mockup)
该技能应调用底层 `git` 命令，并结合 `git interpret-trailers` 工具来操作 Commit Message。
