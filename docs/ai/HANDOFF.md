# Phase 1 交接

## 当前状态

- **分支**: `codex/phase2-core-capability-alignment`
- **Ahead of main**: 64 commits (20 from Phase 1, 44 pre-existing)
- **Phase 1 范围**: `d62e436..442fa0f` (20 commits)
- **最后验证**: 2026-05-24

## 测试状态 (当前工作区实测)

- **Runtime tests**: 210/211 pass (`pnpm --filter @vigilon/runtime test`)
  - 1 known flaky: `runs a worktree-hosted subagent` — worktreeDiff 0 files → 记录在 PHASE1_CAPABILITY_OVERVIEW.md 已知限制中
- **TUI tests**: 44/44 pass (`pnpm --filter @vigilon/tui exec vitest run`)
- **Typecheck**: 0 errors (`pnpm typecheck`)
- **Build**: 成功 (`pnpm build`)

## 未提交的 Modified 文件 (均非 Phase 1 改动)

| 文件 | 来源 |
|------|------|
| `packages/runtime/src/cli.ts` (708 lines) | 分支预存在 |
| `packages/runtime/src/tools/webFetchTool.ts` (100 lines) | 分支预存在 |
| `packages/runtime/src/runtime/requestCache.ts` (18 lines) | 分支预存在 |
| `package.json` (14 lines) | 分支预存在 |
| `pnpm-lock.yaml` (3478 lines) | 分支预存在 |

Phase 2 需要 review 这些变更：合并或丢弃。

## Untracked 较大目录 (已在 .gitignore)

- `docs/claudecode-research/` — Claude Code 源码参考 (2115 files)
- `packages/claude-code/` — Claude Code 源码镜像
- `.claude/worktrees/` — worktree 产物

## 已知风险

1. **Worktree subagent 测试偶发失败**: worktreeDiff.status 可能为 "clean" (0 files changed) 而非 "changed"。根因: 子代理在独立 worktree 中运行 Bash，如果命令不产生文件变更，diff 为空。不是功能 Bug，是测试对 side-effect 有假设。

2. **分支有 44 个预存在 commit**: Phase 2 开始前建议确认这些 commit 的意图，避免冲突。

3. **LSP 诊断首次调用可能返回空**: didOpen 后异步诊断有 500ms 等待，仍有竞态风险。

## Phase 2 入口

- Entry checklist: `docs/ai/PHASE2_ENTRY_CHECKLIST.md`
- 审计: `docs/ai/PHASE1_AUDIT.md`
- 能力综述: `docs/ai/PHASE1_CAPABILITY_OVERVIEW.md`

## Phase 2 入口文档

- 完整能力综述: `docs/ai/PHASE1_CAPABILITY_OVERVIEW.md`
- 仓库状态审计: `docs/ai/PHASE1_AUDIT.md`
- 边界测试报告: `docs/superpowers/specs/2026-05-24-boundary-test-report.md`
