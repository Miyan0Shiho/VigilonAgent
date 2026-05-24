# Phase 1 → Phase 2 仓库状态审计

**日期**: 2026-05-24
**分支**: `codex/phase2-core-capability-alignment`
**Phase 1 commits**: 20 commits above `d62e436` (v0.1.0)

---

## 1. Preflight 处理结论

| 项 | 处理 |
|------|------|
| `packages/runtime/src/cli.ts` | 保留。该文件已引用 `src/cli/display.ts`，属于 CLI 展示逻辑拆分。 |
| `packages/runtime/src/cli/display.ts` | 入库。否则干净 clone 后 `cli.ts` 引用缺文件。 |
| `packages/runtime/src/runtime/subagent-runner.ts` | 入库。否则 `agentLoop.ts` 引用缺文件。 |
| `packages/runtime/src/runtime/contracts/permission.ts` | 入库。否则 `contracts.ts` 引用缺文件。 |
| `packages/runtime/src/tools/webFetchTool.ts` | 保留。新增私有/本地地址拦截，避免 WebFetch 访问非公共 host。 |
| `packages/runtime/src/runtime/requestCache.ts` | 保留。移除未使用的 `injectRequestCachePrefix` 空实现。 |
| `package.json` | 清理。移除本地 Claude Code 参考包脚本残留。 |
| `pnpm-lock.yaml` | 清理。恢复为不包含 `packages/claude-code` importer 的锁文件。 |
| `pnpm-workspace.yaml` | 更新。显式排除 `packages/claude-code`，避免本地参考镜像再次污染 workspace。 |

**结论**: Phase 1 的 20 个 implementation commit 已提交；closure/preflight 变更已归类并准备作为 Phase 2 入口提交。

---

## 2. 本地忽略内容分类

| 路径 | 分类 | 处置 |
|------|------|------|
| `docs/claudecode-research/` (2115 files) | Claude Code 参考材料 | 加入 .gitignore；保留本地作为设计参考 |
| `packages/claude-code/` | Claude Code 源码镜像 (removed from Git) | 加入 .gitignore；README 已声明 source mirrors removed |
| `.claude/worktrees/` | Claude Code worktree 产物 | 加入 .gitignore |
| `.vigilon/sessions/` | Agent 运行产物 | 已在 .gitignore (`**/.vigilon/sessions/**`) |
| `.vigilon/memory/` | Agent 长期记忆 | 已在 .gitignore |
| `.local-archives/` | 压缩归档 | 已在 .gitignore |

---

## 3. Ignore / Workspace 修正

已新增忽略项:
- `docs/claudecode-research/` — Claude Code 源码参考
- `packages/claude-code/` — Claude Code 镜像
- `.claude/worktrees/` — Worktree 产物

已新增 workspace exclude:
- `!packages/claude-code` — 避免本地参考镜像参与 pnpm workspace 与 lockfile 生成

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
