# Vigilon Phase 2: LSP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a read-only LSP tool that provides code intelligence (definition, references, symbols, hover) aligned with Claude Code.

**Architecture:**
- `LSPClient`: Low-level JSON-RPC client over stdio with `Content-Length` framing.
- `LSPServerManager`: Singleton manager handling server lifecycle and routing by extension.
- `LSPTool`: Model-callable tool wrapping LSP operations with defensive formatting and permission checks.

**Tech Stack:** TypeScript, Node.js `child_process`, `vscode-jsonrpc`, `vscode-languageserver-protocol`.

---

### Task 1: Add Dependencies

**Files:**
- Modify: `packages/runtime/package.json`

- [ ] **Step 1: Ask for permission to add dependencies**

Use `AskUserQuestion` to ask for permission to add `vscode-jsonrpc` and `vscode-languageserver-protocol` to `packages/runtime`.

- [ ] **Step 2: Add dependencies to package.json**

```json
{
  "dependencies": {
    "vscode-jsonrpc": "^6.7.0",
    "vscode-languageserver-protocol": "^3.17.5",
    "vscode-languageserver-types": "^3.17.5"
  }
}
```

- [ ] **Step 3: Run install**

Run: `pnpm install`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/package.json pnpm-lock.yaml
git commit -m "chore(runtime): add lsp dependencies"
```

---

### Task 2: Implement LSPClient

**Files:**
- Create: `packages/runtime/src/services/lsp/LSPClient.ts`
- Test: `packages/runtime/test/lspClient.test.ts`

- [ ] **Step 1: Write failing test for LSPClient**

```typescript
import { test, expect } from 'vitest';
import { createLSPClient } from '../src/services/lsp/LSPClient.js';

test('LSPClient should start and initialize', async () => {
  // Test logic here
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vigilon/runtime test -- lspClient.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement minimal LSPClient**

Copy and adapt from `claude-code`'s `LSPClient.ts`, using `vscode-jsonrpc`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vigilon/runtime test -- lspClient.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/services/lsp/LSPClient.ts packages/runtime/test/lspClient.test.ts
git commit -m "feat(runtime): add LSPClient"
```

---

### Task 3: Implement LSPServerManager

**Files:**
- Create: `packages/runtime/src/services/lsp/LSPServerManager.ts`
- Create: `packages/runtime/src/services/lsp/config.ts`
- Test: `packages/runtime/test/lspServerManager.test.ts`

- [ ] **Step 1: Write failing test for LSPServerManager**

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement LSPServerManager and default config**

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

---

### Task 4: Implement LSPTool

**Files:**
- Create: `packages/runtime/src/tools/lspTool.ts`
- Create: `packages/runtime/src/tools/lsp/formatters.ts`
- Modify: `packages/runtime/src/tools/coreTools.ts`
- Test: `packages/runtime/test/lspTool.test.ts`

- [ ] **Step 1: Write failing test for LSPTool**

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement LSPTool and formatters**

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

---

### Task 5: Integration and Cleanup

- [ ] **Step 1: Add LSP manager to agentLoop**
- [ ] **Step 2: Final build and regression tests**
- [ ] **Step 3: Commit**
