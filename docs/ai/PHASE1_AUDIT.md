# Phase 1 → Phase 2 仓库状态审计

**日期**: 2026-05-24
**分支**: `codex/phase2-core-capability-alignment`
**Phase 1 commits**: 20 commits above `d62e436` (v0.1.0)

---

## 1. Modified (Tracked) 文件分类

| 文件 | 变更量 | 来源 | Phase 2 处理 |
|------|--------|------|-------------|
| `packages/runtime/src/cli.ts` | 708 lines | 分支预存在，非 Phase 1 | 需要 code review 后合并或丢弃 |
| `packages/runtime/src/tools/webFetchTool.ts` | 100 lines | 分支预存在 | 同上 |
| `packages/runtime/src/runtime/requestCache.ts` | 18 lines | 分支预存在 | 同上 |
| `package.json` | 14 lines | 分支预存在 | 同上 |
| `pnpm-lock.yaml` | 3478 lines | 分支预存在 | 随 package.json 变更 |

**结论**: 以上 5 个文件均非 Phase 1 改动。Phase 1 的 20 个 commit 全部已提交，无遗漏。

---

## 2. Untracked 文件分类

| 路径 | 分类 | 处置 |
|------|------|------|
| `docs/claudecode-research/` (2115 files) | Claude Code 参考材料 | 加入 .gitignore；保留本地作为设计参考 |
| `packages/claude-code/` | Claude Code 源码镜像 (removed from Git) | 加入 .gitignore；README 已声明 source mirrors removed |
| `.claude/worktrees/` | Claude Code worktree 产物 | 加入 .gitignore |
| `.vigilon/sessions/` | Agent 运行产物 | 已在 .gitignore (`**/.vigilon/sessions/**`) |
| `.vigilon/memory/` | Agent 长期记忆 | 已在 .gitignore |
| `.local-archives/` | 压缩归档 | 已在 .gitignore |

---

## 3. .gitignore 修正

需新增忽略项:
- `docs/claudecode-research/` — Claude Code 源码参考
- `packages/claude-code/` — Claude Code 镜像
- `.claude/worktrees/` — Worktree 产物

---

## 4. Phase 1 完整文件变更清单

Phase 1 新增/修改的所有文件 (20 commits):

```
新增:
  CLAUDE.md
  docs/ai/HANDOFF.md
  docs/ai/PHASE1_CAPABILITY_OVERVIEW.md
  docs/superpowers/specs/2026-05-24-boundary-test-report.md
  packages/runtime/src/cli/parse.ts
  packages/runtime/src/model/finRouter.ts
  packages/runtime/src/runtime/context-injection.ts
  packages/runtime/src/tools/applyPatchTool.ts
  packages/runtime/src/tools/gitTool.ts
  packages/runtime/src/tools/listDirTool.ts
  packages/runtime/src/tools/noteTool.ts
  packages/runtime/src/tools/runTestsTool.ts
  packages/runtime/src/tools/snapshotTool.ts

修改:
  packages/runtime/src/index.ts
  packages/runtime/src/model/deepseek.ts
  packages/runtime/src/runtime/agentDefinitions.ts
  packages/runtime/src/runtime/agentLoop.ts
  packages/runtime/src/runtime/context-injection.ts (新增 + 大量修改)
  packages/runtime/src/runtime/contracts.ts
  packages/runtime/src/runtime/safetyPolicy.ts
  packages/runtime/src/runtime/transcript.ts
  packages/runtime/src/services/lsp/LSPServerInstance.ts
  packages/runtime/src/tools/agentTool.ts
  packages/runtime/src/tools/coreTools.ts
  packages/runtime/src/tools/lspTool.ts
  packages/runtime/src/tools/readTool.ts
  packages/runtime/test/agentLoop.test.ts
  packages/runtime/test/cli.test.ts
  packages/runtime/test/executionTools.test.ts
  packages/runtime/test/lspTool.test.ts
  packages/runtime/test/sessionTools.test.ts
  packages/tui/src/components/InteractiveOperatorShell.tsx
  packages/tui/src/runtime/nodeAdapter.ts
  packages/tui/src/runtime/turnView.ts
  packages/tui/src/runtime/types.ts
```
