# Phase 2 North-Star Closure Design

- Date: 2026-05-18
- Status: Draft approved for spec write-up
- Scope: `packages/runtime`
- Goal: Close Phase 2 against the north-star document as a complete runtime coverage gate, not a minimal implementation milestone.

## 1. Problem Statement

The current runtime has a substantial Phase 2 skeleton, but it still does not satisfy the north-star definition in `docs/product/2026-05-18-phase-2-core-capability-alignment.md`.

The main gap is not the total absence of tools. The real gap is that several capabilities exist only as partial implementations or isolated tests, while the north-star requires:

- mechanism-level parity rather than feature presence
- end-to-end recovery and handoff semantics
- consistent transcript, resume, compact, permission, and verification behavior
- real acceptance chains instead of module existence checks

This design defines the closure plan required before claiming that Phase 2 is complete or ready for Codex review.

## 2. Completion Standard

Phase 2 is considered complete only when all of the following are true:

1. `pnpm typecheck` passes.
2. `pnpm --filter @vigilon/runtime test` passes.
3. P2.0 through P2.10 are either:
   - implemented to the north-star requirement, or
   - explicitly deferred with documented justification that still preserves Phase 2 scope integrity.
4. The acceptance chain in `docs/product/2026-05-18-phase-2-core-capability-alignment.md` items 1-18 has executable evidence.
5. The runtime leaves a structured, auditable handoff record suitable for a second agent or human reviewer.

No partial green state counts as complete.

## 3. Design Principles

### 3.1 Copy-First

Each work item must map back to the Claude Code mechanism category described in:

- `docs/claudecode-research/library/mechanisms/25-api-request-streaming-retry-and-telemetry.md`
- `docs/claudecode-research/library/mechanisms/26-prompt-cache-break-detection-and-stability-auditing.md`
- `docs/claudecode-research/library/mechanisms/28-tool-search-deferred-tools-and-mcp-instruction-deltas.md`
- `docs/claudecode-research/library/mechanisms/63-session-memory-compaction-autocompact-and-post-compact-restoration-runtime.md`
- `docs/claudecode-research/library/mechanisms/68-ask-user-question-schema-preview-and-operator-loop-runtime.md`
- `docs/claudecode-research/library/mechanisms/74-webfetch-tool-domain-gates-redirects-and-secondary-model-runtime.md`
- `docs/claudecode-research/library/mechanisms/75-config-tool-supported-settings-source-routing-and-immediate-effect-runtime.md`
- `docs/claudecode-research/library/mechanisms/79-taskstop-tool-stoptask-shared-kill-path-and-sdk-bookend-runtime.md`
- `docs/claudecode-research/library/mechanisms/80-lsp-tool-initialization-deferred-loading-and-diagnostic-attachment-runtime.md`
- `docs/claudecode-research/library/mechanisms/85-toolsearch-tool-deferred-discovery-tool-reference-and-schema-recovery-runtime.md`
- `docs/claudecode-research/library/mechanisms/89-notebookedit-tool-cell-identity-json-materialization-and-permission-diff-runtime.md`
- `docs/claudecode-research/library/mechanisms/90-notebook-read-toolresult-blocks-large-output-guard-and-cell-id-runtime.md`

### 3.2 Acceptance-First

Every major change must unlock a blocked north-star acceptance item, not just improve local code quality.

### 3.3 Single-State Runtime

Permission, transcript, compact, todo, plan, verification, subagent, and result reporting must stay in one state chain. No feature is considered complete if it bypasses that chain.

### 3.4 Solo Runtime Boundary

The design may simplify enterprise or remote surfaces, but it must not collapse the mechanism being aligned. Deferred or simplified surfaces must be explicit.

## 4. Remaining Gap Model

The closure work is organized around five blocking groups.

### 4.1 Deferred Discovery And Code Intelligence

Blocked areas:

- deferred tool discovery is not fully available on the default runtime path
- `ToolSearch` is not consistently part of the real execution loop
- `LSP` parity is incomplete for diagnostics and higher-order symbol operations

Required closure:

- make deferred discovery available in the default runtime path
- restore discovered tools after compact and resume
- complete LSP parity for:
  - definition
  - references
  - document symbols
  - workspace symbols
  - implementation
  - call hierarchy or a documented parity-equivalent
  - passive diagnostics attachment
- ensure fallback behavior remains under the same permission, budget, ignore, transcript, and compact semantics

North-star slices:

- P2.1
- P2.7
- acceptance items 3, 4, 15

### 4.2 Tool Parity Surfaces

Blocked areas:

- notebook support exists but is not yet a first-class runtime surface
- large notebook outputs can still pollute context
- WebFetch and AskUser need stricter parity validation in the unified acceptance chain

Required closure:

- make notebook read/edit part of the default runtime path or explicitly document a justified alternative
- add large-output guards, cell identity handling, and stale-safe notebook edit semantics
- verify WebFetch domain gate, redirect policy, and bounded content behavior
- verify AskUser operator loop behavior as tool-result continuation, not plain chat fallback

North-star slices:

- P2.3
- acceptance items 9, 10, 11

### 4.3 Context Management And Restoration

Blocked areas:

- compact currently behaves as a basic transcript summarization boundary, not the full context-management protocol
- replay of discovered tools, MCP instructions, plan state, memory status, and capability announcements is incomplete

Required closure:

- upgrade compact to a routed runtime with at least:
  - session-memory path
  - reactive path
  - legacy fallback path
- persist and restore:
  - discovered tools
  - deferred tool state
  - MCP instructions or equivalent runtime announcements
  - todo state
  - plan state
  - verification notes
  - memory freshness context
  - subagent-related session continuity metadata where applicable
- ensure resume and compact leave one coherent state model

North-star slices:

- P2.5
- P2.6
- acceptance items 13, 14

### 4.4 Stop Paths, Config, And Request Stability

Blocked areas:

- `TaskStop` is narrower than the shared stop-path requirement
- request stability is present but still thinner than the required transport audit coverage
- config mutation exists but needs clearer runtime semantics and audit posture

Required closure:

- unify stop semantics for long-running and background execution where Phase 2 requires a shared kill path
- extend request stability auditing to capture:
  - tool schema shifts
  - system prompt changes
  - cache-policy-equivalent changes
  - model/runtime parameter changes
  - compact-related capability deltas
- ensure config mutation remains:
  - registry-driven
  - source-aware
  - transcript-audited
  - rollback-capable or explicitly constrained

North-star slices:

- P2.0
- P2.2
- P2.8
- P2.9
- acceptance items 8, 17

### 4.5 Final Handoff And Real Acceptance Harness

Blocked areas:

- final reporting is optional in practice instead of a hard delivery gate
- there is no single executable proof chain covering the full north-star runtime

Required closure:

- require structured result handoff before considering a task complete
- ensure final delivery always includes:
  - changes
  - verification
  - unverified items
  - risks
  - todo state
- add end-to-end acceptance harnesses for at least one unfamiliar TypeScript/JavaScript repository scenario
- use the harness to prove the 1-18 acceptance sequence, not just isolated tool behavior

North-star slices:

- P2.4
- P2.10
- acceptance items 1, 2, 5, 6, 7, 12, 16, 18

## 5. Execution Order

The closure work must proceed in this order:

1. Deferred discovery and LSP/code-intelligence parity
2. Notebook and tool parity surfaces
3. Compact/resume/capability replay restoration
4. Shared stop path, request stability, and config hardening
5. Final handoff enforcement and end-to-end acceptance harness

This order is intentional:

- deferred discovery blocks LSP parity and mixed tool-loop acceptance
- notebook and tool parity must exist before real acceptance tasks are meaningful
- compact and restoration must stabilize before any completion claim
- stop/stability/config hardening depends on the runtime state model being settled
- end-to-end acceptance should validate the full integrated runtime, not a moving target

## 6. File Ownership Map

Primary files expected to change:

- `packages/runtime/src/model/deepseek.ts`
- `packages/runtime/src/runtime/agentLoop.ts`
- `packages/runtime/src/runtime/compact.ts`
- `packages/runtime/src/runtime/transcript.ts`
- `packages/runtime/src/runtime/requestAudit.ts`
- `packages/runtime/src/runtime/mcp.ts`
- `packages/runtime/src/runtime/skills.ts`
- `packages/runtime/src/tools/coreTools.ts`
- `packages/runtime/src/tools/toolSearchTool.ts`
- `packages/runtime/src/tools/lspTool.ts`
- `packages/runtime/src/tools/notebookTool.ts`
- `packages/runtime/src/tools/taskStopTool.ts`
- `packages/runtime/src/tools/sessionTools.ts`
- `packages/runtime/src/tools/configTool.ts`

Primary test files expected to expand:

- `packages/runtime/test/agentLoop.test.ts`
- `packages/runtime/test/deepseek.test.ts`
- `packages/runtime/test/toolSearch.test.ts`
- `packages/runtime/test/lspTool.test.ts`
- `packages/runtime/test/notebookTool.test.ts`
- `packages/runtime/test/sessionMemory.test.ts`
- `packages/runtime/test/transcript.test.ts`
- `packages/runtime/test/sessionTools.test.ts`
- `packages/runtime/test/configTool.test.ts`
- new end-to-end acceptance tests under `packages/runtime/test/`

## 7. Commit Strategy

Work must be committed as atomic north-star slices, not as one large batch.

Expected commit groups:

1. deferred discovery and LSP runtime parity
2. notebook and parity-surface hardening
3. compact and restoration semantics
4. request stability / stop-path / config hardening
5. end-to-end acceptance harness and handoff enforcement

Each commit must:

- pass local typecheck and runtime tests
- use Conventional Commits
- include `Agent-Task` and `Agent-Decision` trailers

## 8. Risks

- The largest risk is false completion caused by passing unit tests without satisfying the acceptance chain.
- The second risk is state divergence between compact, resume, and deferred capability replay.
- The third risk is local fixes that bypass the shared runtime state chain and therefore weaken auditability.

The closure effort must reject "feature exists" as evidence. Only integrated runtime behavior counts.

## 9. Verification Plan

Verification is complete only when all layers below are green:

- unit tests for each modified runtime surface
- integration tests for mixed tool loops
- compact/resume restoration tests
- subagent and handoff tests
- at least one end-to-end unfamiliar repository acceptance scenario
- explicit self-review mapping each north-star slice to evidence

## 10. Non-Goals

This design does not introduce:

- remote agents
- enterprise policy systems
- worktree hosts beyond the local subagent foundation already permitted in Phase 2
- marketplace or product-shell features from later phases

## 11. Exit Decision

The implementation phase ends only when there is enough evidence to make the following statement truthfully:

"Phase 2 now satisfies the north-star coverage gate, passes the acceptance chain, and is ready for Codex review without relying on undocumented shortcuts or partial parity claims."
