# Phase 2 North-Star Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close `packages/runtime` against the full Phase 2 north-star requirement and acceptance chain so the branch is ready for Codex review.

**Architecture:** The work proceeds in five closure waves: deferred discovery plus LSP parity, tool parity surfaces, compact and restoration semantics, stop/stability/config hardening, and end-to-end acceptance with enforced handoff. Every wave must preserve the shared runtime state chain across transcript, permissions, plan, todo, compact, resume, and final report.

**Tech Stack:** TypeScript, Vitest, Node.js, JSONL transcript runtime, local MCP, LSP stdio clients

---

### Task 1: Re-enable Deferred Discovery In The Default Runtime

**Files:**
- Modify: `packages/runtime/src/tools/coreTools.ts`
- Modify: `packages/runtime/src/tools/toolSearchTool.ts`
- Modify: `packages/runtime/src/runtime/agentLoop.ts`
- Modify: `packages/runtime/test/toolSearch.test.ts`
- Modify: `packages/runtime/test/sessionTools.test.ts`
- Modify: `packages/runtime/test/executionTools.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
expect(createCoreToolRegistry().list().map(tool => tool.name)).toContain('ToolSearch')

expect(result.metadata).toMatchObject({
  discoveredTools: ['LSP'],
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test test/toolSearch.test.ts test/sessionTools.test.ts test/executionTools.test.ts`
Expected: FAIL because `ToolSearch` is absent from the default runtime path or discovered-tool recovery is incomplete.

- [ ] **Step 3: Write minimal implementation**

```ts
export const CORE_TOOLS = [
  ReadTool,
  GlobTool,
  GrepTool,
  ToolSearchTool,
  LspTool,
  TaskStopTool,
  AgentTool,
  ConfigTool,
  WebFetchTool,
  AskUserQuestionTool,
  TodoWriteTool,
  EnterPlanModeTool,
  ExitPlanModeTool,
  WriteTool,
  EditTool,
  BashTool,
  ResultReportTool,
] as const
```

```ts
if (result.metadata?.discoveredTools && Array.isArray(result.metadata.discoveredTools)) {
  // preserve discovered deferred tools in runtime session state
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test test/toolSearch.test.ts test/sessionTools.test.ts test/executionTools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/tools/coreTools.ts packages/runtime/src/tools/toolSearchTool.ts packages/runtime/src/runtime/agentLoop.ts packages/runtime/test/toolSearch.test.ts packages/runtime/test/sessionTools.test.ts packages/runtime/test/executionTools.test.ts
git commit -m "feat(runtime): restore deferred tool discovery"
```

### Task 2: Complete LSP Code-Intelligence Parity

**Files:**
- Modify: `packages/runtime/src/tools/lspTool.ts`
- Modify: `packages/runtime/src/services/lsp/LSPServerManager.ts`
- Modify: `packages/runtime/src/services/lsp/LSPDiagnosticRegistry.ts`
- Modify: `packages/runtime/test/lspTool.test.ts`
- Modify: `packages/runtime/test/agentLoop.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
expect(result.content).toContain('workspace symbols')
expect(result.content).toContain('incoming calls')
expect(result.content).toContain('diagnostics')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test test/lspTool.test.ts test/agentLoop.test.ts`
Expected: FAIL because the tool does not yet expose workspace symbol, implementation, call hierarchy, or real diagnostics behavior.

- [ ] **Step 3: Write minimal implementation**

```ts
case 'workspace_symbol':
  return ok(formatWorkspaceSymbols(await manager.workspaceSymbol(query)))
case 'implementation':
  return ok(formatLocations(await manager.implementation(filePath, line, character)))
case 'call_hierarchy':
  return ok(formatCallHierarchy(await manager.callHierarchy(filePath, line, character)))
case 'diagnostics':
  return ok(formatDiagnostics(await manager.getDiagnostics(filePath)))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test test/lspTool.test.ts test/agentLoop.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/tools/lspTool.ts packages/runtime/src/services/lsp/LSPServerManager.ts packages/runtime/src/services/lsp/LSPDiagnosticRegistry.ts packages/runtime/test/lspTool.test.ts packages/runtime/test/agentLoop.test.ts
git commit -m "feat(runtime): complete lsp parity surface"
```

### Task 3: Make Notebook A First-Class Runtime Surface

**Files:**
- Modify: `packages/runtime/src/tools/coreTools.ts`
- Modify: `packages/runtime/src/tools/notebookTool.ts`
- Modify: `packages/runtime/test/notebookTool.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
expect(createCoreToolRegistry().list().map(tool => tool.name)).toContain('Notebook')
expect(result.metadata).toMatchObject({ truncatedOutputs: true })
expect(editResult.content).toContain('stale notebook')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test test/notebookTool.test.ts`
Expected: FAIL because notebook is not in the default path and large-output/stale guards are incomplete.

- [ ] **Step 3: Write minimal implementation**

```ts
if (totalOutputChars > MAX_NOTEBOOK_OUTPUT_CHARS) {
  outputs = ['[output omitted: notebook output exceeds runtime budget]']
}
```

```ts
export const CORE_TOOLS = [
  // ...
  NotebookTool,
  // ...
]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test test/notebookTool.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/tools/coreTools.ts packages/runtime/src/tools/notebookTool.ts packages/runtime/test/notebookTool.test.ts
git commit -m "feat(runtime): harden notebook runtime parity"
```

### Task 4: Enforce Skill Allowed-Tools Boundaries

**Files:**
- Modify: `packages/runtime/src/runtime/skills.ts`
- Modify: `packages/runtime/src/tools/skillTool.ts`
- Modify: `packages/runtime/src/runtime/agentLoop.ts`
- Modify: `packages/runtime/test/skills.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
expect(toolResult?.result.metadata).toMatchObject({
  allowedTools: ['Read', 'Grep'],
})
expect(request.tools.map(tool => tool.name)).toEqual(['Read', 'Grep'])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test test/skills.test.ts`
Expected: FAIL because skill `allowedTools` are parsed but not enforced on the delegated runtime path.

- [ ] **Step 3: Write minimal implementation**

```ts
const scopedTools = createCoreToolRegistry({
  skills,
  mcpTools,
  allowedTools: skill.allowedTools,
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test test/skills.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/runtime/skills.ts packages/runtime/src/tools/skillTool.ts packages/runtime/src/runtime/agentLoop.ts packages/runtime/test/skills.test.ts
git commit -m "fix(runtime): enforce skill tool boundaries"
```

### Task 5: Upgrade Compact To A Restoration Runtime

**Files:**
- Modify: `packages/runtime/src/runtime/compact.ts`
- Modify: `packages/runtime/src/runtime/transcript.ts`
- Modify: `packages/runtime/src/runtime/agentLoop.ts`
- Modify: `packages/runtime/src/runtime/contracts.ts`
- Modify: `packages/runtime/test/transcript.test.ts`
- Modify: `packages/runtime/test/sessionMemory.test.ts`
- Modify: `packages/runtime/test/agentLoop.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
expect(restored.sessionState.discoveredToolNames).toContain('LSP')
expect(restored.sessionState.pendingPlan).toBe('Investigate compact replay')
expect(restored.sessionState.verificationNotes).toContain('Ran focused checks')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test test/transcript.test.ts test/sessionMemory.test.ts test/agentLoop.test.ts`
Expected: FAIL because compact replay does not yet restore the full capability/state surface.

- [ ] **Step 3: Write minimal implementation**

```ts
metadata: {
  trigger,
  preEventCount,
  messagesSummarized,
  discoveredToolNames: sessionState.discoveredToolNames,
  todos: sessionState.todos,
  approvedPlan: sessionState.approvedPlan,
  pendingPlan: sessionState.pendingPlan,
  verificationNotes: sessionState.verificationNotes,
  memoryFreshness: freshness,
  mcpInstructions: sessionState.mcpInstructions,
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test test/transcript.test.ts test/sessionMemory.test.ts test/agentLoop.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/runtime/compact.ts packages/runtime/src/runtime/transcript.ts packages/runtime/src/runtime/agentLoop.ts packages/runtime/src/runtime/contracts.ts packages/runtime/test/transcript.test.ts packages/runtime/test/sessionMemory.test.ts packages/runtime/test/agentLoop.test.ts
git commit -m "feat(runtime): restore compact state replay"
```

### Task 6: Unify Stop Paths And Strengthen Request Stability

**Files:**
- Modify: `packages/runtime/src/runtime/requestAudit.ts`
- Modify: `packages/runtime/src/tools/taskStopTool.ts`
- Modify: `packages/runtime/src/runtime/taskManager.ts`
- Modify: `packages/runtime/src/model/deepseek.ts`
- Modify: `packages/runtime/test/requestAudit.test.ts`
- Modify: `packages/runtime/test/taskStopTool.test.ts`
- Modify: `packages/runtime/test/deepseek.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
expect(stability.details).toMatchObject({
  systemChanged: true,
  toolSchemaChanged: true,
  compactCapabilityChanged: true,
})
expect(result.content).toContain('shared stop path')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test test/requestAudit.test.ts test/taskStopTool.test.ts test/deepseek.test.ts`
Expected: FAIL because stability fields and shared stop semantics are still incomplete.

- [ ] **Step 3: Write minimal implementation**

```ts
details: {
  systemPromptHash,
  toolSchemaHash,
  modelId,
  compactCapabilityHash,
}
```

```ts
await context.taskManager.shutdown()
return ok('TaskStop routed through the shared stop path.')
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test test/requestAudit.test.ts test/taskStopTool.test.ts test/deepseek.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/runtime/requestAudit.ts packages/runtime/src/tools/taskStopTool.ts packages/runtime/src/runtime/taskManager.ts packages/runtime/src/model/deepseek.ts packages/runtime/test/requestAudit.test.ts packages/runtime/test/taskStopTool.test.ts packages/runtime/test/deepseek.test.ts
git commit -m "fix(runtime): harden stop path and request stability"
```

### Task 7: Enforce Final Handoff Before Completion

**Files:**
- Modify: `packages/runtime/src/tools/sessionTools.ts`
- Modify: `packages/runtime/src/runtime/agentLoop.ts`
- Modify: `packages/runtime/test/sessionTools.test.ts`
- Modify: `packages/runtime/test/agentLoop.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
expect(result.report.handoffReport).toBeDefined()
expect(result.report.todos).toEqual([])
expect(result.report.verificationNotes.length).toBeGreaterThan(0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test test/sessionTools.test.ts test/agentLoop.test.ts`
Expected: FAIL because the final handoff is still optional in the runtime completion path.

- [ ] **Step 3: Write minimal implementation**

```ts
if (!sessionState.handoffReport) {
  stopReason = 'error'
  finalMessage = 'Task ended without a structured result handoff.'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test test/sessionTools.test.ts test/agentLoop.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/tools/sessionTools.ts packages/runtime/src/runtime/agentLoop.ts packages/runtime/test/sessionTools.test.ts packages/runtime/test/agentLoop.test.ts
git commit -m "feat(runtime): require final handoff report"
```

### Task 8: Build The End-To-End Acceptance Harness

**Files:**
- Create: `packages/runtime/test/phase2Acceptance.test.ts`
- Modify: `packages/runtime/src/cli.ts`
- Modify: `packages/runtime/src/runtime/baseline.ts`

- [ ] **Step 1: Write the failing acceptance test**

```ts
it('satisfies the phase 2 acceptance chain for an unfamiliar repo task', async () => {
  expect(report.finalMessage).toContain('fixed')
  expect(report.handoffReport?.risks).toEqual([])
  expect(report.toolResults.some(result => result.ok)).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test test/phase2Acceptance.test.ts`
Expected: FAIL because the full acceptance chain has not yet been encoded or satisfied.

- [ ] **Step 3: Write minimal implementation**

```ts
export function createPhase2RuntimeBaseline() {
  return {
    phase: 'phase-2',
    // ...
  }
}
```

```ts
// acceptance fixture drives: search -> LSP -> plan -> todo -> edit -> bash -> resume/compact -> report
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test test/phase2Acceptance.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/test/phase2Acceptance.test.ts packages/runtime/src/cli.ts packages/runtime/src/runtime/baseline.ts
git commit -m "test(runtime): add phase 2 acceptance harness"
```

### Task 9: Final Verification Sweep

**Files:**
- Modify: `docs/superpowers/specs/2026-05-18-phase2-north-star-closure-design.md`
- Modify: `docs/superpowers/plans/2026-05-18-phase2-north-star-closure.md`

- [ ] **Step 1: Run full verification**

Run: `pnpm typecheck && pnpm --filter @vigilon/runtime test`
Expected: PASS

- [ ] **Step 2: Write the self-review checklist result**

```md
- P2.0: verified by `packages/runtime/test/deepseek.test.ts`
- P2.1/P2.7: verified by deferred discovery + LSP tests
- P2.3: verified by notebook/webfetch/ask-user tests
- P2.5/P2.6: verified by compact/resume/session-memory tests
- P2.8/P2.9: verified by request audit + config tests
- P2.10: verified by subagent and acceptance harness
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-05-18-phase2-north-star-closure-design.md docs/superpowers/plans/2026-05-18-phase2-north-star-closure.md
git commit -m "docs(runtime): record phase 2 verification evidence"
```
