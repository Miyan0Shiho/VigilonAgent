# Phase 1 → Phase 2 交接

## 当前状态

- **分支**: `codex/phase2-core-capability-alignment`
- **Phase 1 implementation range**: `d62e436..442fa0f` (20 commits)
- **Closure / preflight**: `5eb356a` plus the current handoff cleanup commit
- **当前入口状态**: Phase 1 功能已收尾；Phase 2 可以从干净的 local whiteboard Agent Alpha 边界继续
- **最后同步**: 2026-05-24

> 精确 ahead 数与 HEAD hash 以 `git status --short --branch` 和 `git log --oneline -1` 为准；本文件只记录阶段边界，避免后续提交后文档再次漂移。

## 验证状态

- **Runtime tests**: 210/211 pass (`pnpm --filter @vigilon/runtime test`)
  - 1 known flaky: `runs a worktree-hosted subagent` — worktreeDiff 0 files → 记录在 PHASE1_CAPABILITY_OVERVIEW.md 已知限制中
- **TUI tests**: 44/44 pass (`pnpm --filter @vigilon/tui exec vitest run`)
- **Typecheck**: 0 errors (`pnpm typecheck`)
- **Build**: 成功 (`pnpm build`)

本轮 preflight 收尾按用户要求未重跑测试。

## Preflight 已处理项

- `packages/runtime/src/cli/display.ts` 入库：`cli.ts` 已引用该拆分文件，不能留作 untracked。
- `packages/runtime/src/runtime/subagent-runner.ts` 入库：`agentLoop.ts` 已引用该拆分文件，不能留作 untracked。
- `packages/runtime/src/runtime/contracts/permission.ts` 入库：`contracts.ts` 已引用该拆分文件，不能留作 untracked。
- `pnpm-workspace.yaml` 显式排除 `packages/claude-code`，避免本地参考镜像污染 workspace 与 lockfile。
- 移除 `package.json` 中的 `reference:claude-version` 残留；`pnpm-lock.yaml` 已恢复为不包含 Claude Code 参考包 importer 的状态。
- 保留 runtime 安全/结构化改动：CLI display 拆分、subagent runner 拆分、permission contract 拆分、WebFetch 私有地址拦截、request cache 死代码移除。

## 本地忽略内容

- `docs/claudecode-research/` — Claude Code 源码参考 (2115 files)
- `packages/claude-code/` — Claude Code 源码镜像
- `.claude/worktrees/` — worktree 产物

## 已知风险

1. **Worktree subagent 测试偶发失败**: worktreeDiff.status 可能为 "clean" (0 files changed) 而非 "changed"。根因: 子代理在独立 worktree 中运行 Bash，如果命令不产生文件变更，diff 为空。不是功能 Bug，是测试对 side-effect 有假设。

2. **LSP 诊断首次调用可能返回空**: didOpen 后异步诊断有 500ms 等待，仍有竞态风险。

3. **本地参考镜像仍可存在但不入库**: `packages/claude-code/` 被 `.gitignore` 与 workspace exclude 双重隔离，不能作为发布包或 lockfile 来源。

## Phase 2 入口

- Phase 2 Agent Society 讨论入口: `docs/product/phase2-agent-society/README.md`
- Phase 2 核心精华: `docs/product/phase2-agent-society/PHASE2_CORE_ESSENCE.md`
- 产品哲学入口: `docs/product/phase2-agent-society/PHASE2_PRODUCT_DOCTRINE.md`
- Agent 时代问题地图: `docs/product/phase2-agent-society/PHASE2_AGENT_ERA_PROBLEM_MAP.md`
- Agent 时代问题细化: `docs/product/phase2-agent-society/PHASE2_AGENT_ERA_PROBLEM_ATLAS.md`，当前已扩展到 40 个问题，新增重点包括 memory governance、Agentic Web / browser counterparties、labor recomposition、operational eval / model drift / tool supply chain / resource runaway、legal delegability、learning burden / super-individual divide、synthetic content provenance / evidence trust，并新增 10 个高层 problem clustering view。
- Human-like work behaviors deep dive: `docs/product/phase2-agent-society/PHASE2_HUMAN_LIKE_WORK_BEHAVIORS.md`，当前定义 primary behaviors: sleep、wake、argue、cooperate、explore、criticize、steward；embedded behaviors: refuse / de-escalate、remember / forget、evaluate / rehearse、teach / apprentice、prove / attest。
- Agent Society frontend surface: `docs/product/phase2-agent-society/PHASE2_AGENT_SOCIETY_FRONTEND_SURFACE.md`，当前口径是 chat 只是 radio，主表面是 colony-sim / management-game-like 的数字工作社会沙盘：用户通过小人、空间、对象和事件理解 Agent runtime。
- Agent 社会产品回答: `docs/product/phase2-agent-society/PHASE2_AGENT_SOCIETY_THESIS.md`
- 完整能力综述: `docs/ai/PHASE1_CAPABILITY_OVERVIEW.md`
- 仓库状态审计: `docs/ai/PHASE1_AUDIT.md`
- Entry checklist: `docs/ai/PHASE2_ENTRY_CHECKLIST.md`
- 边界测试报告: `docs/superpowers/specs/2026-05-24-boundary-test-report.md`
