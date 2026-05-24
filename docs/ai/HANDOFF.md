# Phase 1 — 结束态

## 状态

- 分支: `codex/phase2-core-capability-alignment`
- 19 commits above `d62e436` (v0.1.0 release)
- 所有测试通过 (211 runtime + 44 TUI)
- 端到端验证: 6/6 真实任务通过 (deepseek-v4-pro)

## 下次接手关键文件

- 系统提示词: `packages/runtime/src/runtime/context-injection.ts` (buildStaticSystemPrompt + buildDynamicContext)
- 核心循环: `packages/runtime/src/runtime/agentLoop.ts` (runTurn)
- DeepSeek 客户端: `packages/runtime/src/model/deepseek.ts`
- Fin 路由: `packages/runtime/src/model/finRouter.ts`
- 工具注册: `packages/runtime/src/tools/coreTools.ts`
- 完整能力综述: `docs/ai/PHASE1_CAPABILITY_OVERVIEW.md`

## 还不属于 git 跟踪的重要内容

- `.vigilon/sessions/` — 测试产生的会话转录
- `.vigilon/memory/` — 测试产生的长期记忆
- `.vigilon/test-logs/` — 已清理

## 分支状态

分支有预存在的修改 (不属于 Phase 1):
- `packages/runtime/src/cli.ts` (大量重构)
- `packages/runtime/src/runtime/requestCache.ts`
- `packages/runtime/src/tools/webFetchTool.ts`
- 以及部分新目录 (`src/cli/`, `src/runtime/contracts/`, `src/runtime/context-injection.ts` 等已在 Phase 1 中正式创建)
