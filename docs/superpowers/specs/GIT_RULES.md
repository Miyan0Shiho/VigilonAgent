# Vigilon Agent Git 协作规则 (RULES.md)

> 本文件定义了 Agent 在本仓库中进行 Git 操作的硬约束。

## 1. 分支管理 (Branching)
- **命名规范**: `agent/<task-id>-<brief-description>`。
- **基准分支**: 始终从最新的 `main` 分支切出。
- **推送限制**: 严禁直接推送 `main` 分支。

## 2. 提交规范 (Commitment)
- **类型系统**: 遵循 Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`)。
- **强制 Trailer**: 每一个非 [WIP] 提交必须包含以下 Trailer：
    - `Agent-Task:`
    - `Agent-Decision:`
- **原子性**: 一个 Commit 仅限一个逻辑变更，且必须通过本地 Lint/Build。

## 3. 工作流秩序 (Workflow Order)
1. **任务启动**: 创建并切换至 Feature Branch。
2. **阶段存档**: 关键逻辑完成后提交 `[WIP]` Checkpoint。
3. **历史整理**: 任务结束前执行 `git rebase -i` 压缩 [WIP] 提交。
4. **意图交付**: 使用 PR 模板提交拉取请求，详细描述 Design Decisions。

## 4. 禁用操作
- 禁用 `git push --force` (除非在私有 Feature Branch 且经授权)。
- 禁用修改 `.git` 目录下的核心配置文件。
- 禁用在未清理工作区的情况下启动新任务。
