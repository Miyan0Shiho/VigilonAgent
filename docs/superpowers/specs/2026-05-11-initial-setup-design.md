# Spec: Vigilon Agent 初始架构与基础设施设计

- **日期**: 2026-05-11
- **状态**: 草案 (Draft)
- **定位**: 核心基础设施与 Monorepo 初始化

## 1. 愿景与目标

构建一个以 **DeepSeek V4** 为推理引擎，采用 **Claude Code** 工程秩序，并具备 **Codex** 级交互体验的 Coding Agent。

## 2. 架构设计 (Scheme A - Monorepo)

采用模块化单体仓库架构，确保逻辑、展示与协议的清晰边界。

### 2.1 目录结构
- `packages/core`: 
    - 职责：处理任务规划 (Planning)、工具调用 (Tool Use)、DeepSeek 模型通信。
    - 关键组件：`Planner`, `Executor`, `ModelClient`, `ToolRegistry`。
- `packages/web`:
    - 职责：提供 Codex 风格的前端界面，展示 Agent 的实时思考与执行状态。
    - 技术栈：(待定，倾向于 React/Next.js)。
- `packages/shared`:
    - 职责：定义跨模块的 JSON-RPC 协议、常量、以及通用的 TypeScript 类型。
- `docs/research`:
    - 归档前期对 Claude Code 等项目的深度调研。
- `docs/superpowers/specs`:
    - 存放各阶段的设计文档 (Spec)。

## 3. 核心秩序 (Inherited from Claude Code & AI-Git-Best-Practices)

1.  **Plan-Execute 分离**: Agent 在执行高风险操作前必须生成 Plan 并获得用户授权。
2.  **状态透明化**: 每一个工具调用的输入、输出以及模型的思考链路必须在 UI 层清晰可见。
3.  **权限门控**: 敏感操作（如删除文件、执行 shell 命令）需显式审批。
4.  **Agent-Aware Git 规范**: 
    - 强制使用 `Agent-Decision` 等 Trailer 记录意图。
    - 采用 Checkpoint (WIP) 与 Atomic Commit 结合的工作流。
    - 使用 `ai-git-manager` 技能自动化管理版本历史。

## 4. 后续规划

1.  **Phase 1**: 初始化 Monorepo 环境（pnpm/npm workspaces）。
2.  **Phase 2**: 定义 `packages/shared` 中的核心协议。
3.  **Phase 3**: 在 `packages/core` 中实现基础的 DeepSeek V4 调用链路。
