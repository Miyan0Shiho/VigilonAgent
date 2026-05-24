# Phase 2 Entry Checklist

## 已满足的条件 ✅

- [x] Phase 1 所有改动已提交 (20 commits)
- [x] 核心能力综述文档就绪 (`docs/ai/PHASE1_CAPABILITY_OVERVIEW.md`)
- [x] 交接文档就绪 (`docs/ai/HANDOFF.md`)
- [x] 仓库审计完成 (`docs/ai/PHASE1_AUDIT.md`)
- [x] .gitignore 修正 (排除参考材料和 worktree 产物)
- [x] 210/211 测试通过 (1 known flaky)
- [x] 44/44 TUI 测试通过
- [x] Typecheck 0 错误
- [x] Build 成功
- [x] 6/6 真实任务端到端通过 (v4-pro)

## 阻塞项 ❌

- [ ] **分支预存在修改需 review**:
  - `packages/runtime/src/cli.ts` (708 lines) — 大型重构, 需要评估是否保留
  - `packages/runtime/src/tools/webFetchTool.ts` (100 lines)
  - `packages/runtime/src/runtime/requestCache.ts` (18 lines)
  - `package.json` (14 lines)
  - `pnpm-lock.yaml` (3478 lines)
  
  **建议**: 在 Phase 2 开始前 review 这些变更，决定合并、丢弃或单独 PR。

- [ ] **Worktree 测试 flaky** (test-only, 非 product bug):
  - 根因: 测试假设子代理一定产生文件变更，但 worktree setup 有时序不确定性
  - 修复方案: 测试使用 retry loop 或 mock 固定 worktree diff
  - 不阻塞 Phase 2 — 记录在已知限制中

## Phase 2 第一个能力点建议

根据与 DeepSeek-TUI 的差距分析，Phase 2 最有价值的第一个能力点：

### 选项 A: 专业化 Agent 定义系统
当前只有 `general-purpose` 内置 agent。Phase 2 可定义领域 agent (如 `code-reviewer`, `test-writer`, `doc-generator`)，每个有专门系统提示词和工具集。

### 选项 B: RLM (Recursive LM for large inputs)
DeepSeek-TUI 最独特的能力——为超大文件/长文本提供 Python REPL 分析。对代码库分析场景实用。

### 选项 C: 体验打磨 (TUI 交互 + 错误恢复)
完善 TUI 操作体验、中断恢复、后台任务可见性。让 agent 从"能用"到"好用"。

### 推荐
**A → C → B**。专业化 Agent 最能体现 Vigilon 的"可扩展 whiteboard Agent"定位，也是和通用 agent 工具拉开差距的关键。
