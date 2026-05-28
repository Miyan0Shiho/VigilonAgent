# Phase 2 Real Acceptance Report

- Date: 2026-05-18
- Status: PASSED for scripted real-task runtime acceptance
- Harness: `packages/runtime/scripts/phase2-real-acceptance.ts`
- Provider validation: PASSED with real DeepSeek model-backed CLI run

## Commands Run

```bash
pnpm phase2:baseline
pnpm --filter @vigilon/runtime exec tsx scripts/phase2-real-acceptance.ts
pnpm --filter @vigilon/runtime typecheck
DEEPSEEK_API_KEY=<redacted> pnpm --filter @vigilon/runtime exec tsx src/cli.ts run '<provider acceptance prompt>' --cwd /tmp/vigilon-provider-acceptance-H8ODNL --permission-mode bypass-local --max-turns 12
```

## Baseline Result

`pnpm phase2:baseline` passed:

- Runtime typecheck passed.
- Runtime test suite passed: 25 test files, 122 tests.
- CLI version smoke passed: `0.1.0`.

## Real Acceptance Harness Result

The acceptance harness passed all 3 temporary repository scenarios.

### repo-a-ts-bugfix

Purpose: validate cross-file code task flow with context ingress, deferred LSP materialization, edit, and shell verification.

Checks passed:

- Used `Grep` for context ingress.
- Used `Read` for file context.
- Materialized deferred `LSP` through `ToolSearch`.
- Edited the target TypeScript file.
- Completed the runtime turn.

### repo-b-notebook-docs

Purpose: validate WebFetch cache/summary, Notebook cell operation, AskUser operator loop, and compact/request audit side effects.

Checks passed:

- Verified `WebFetch` cache hit.
- Used `WebFetch`.
- Inserted a notebook cell.
- Used `AskUserQuestion`.
- Completed the runtime turn.

### repo-c-skill-subagent

Purpose: validate skill activation, skill allowed-tools execution gate, and request audit recording.

Checks passed:

- Loaded local `Skill`.
- Blocked `Bash` because the active skill allowed only `Read` and `Grep`.
- Recorded request audit events.
- Completed the runtime turn.

## Closure Decision

Phase 2 is now materially stronger than the earlier closure claim:

- Deferred tool recovery now has schema-not-sent guidance and tool reference deltas.
- LSP now participates in workspace permission, path existence checks, ignore policy, read-state, and result budgeting.
- Skill `allowedTools` is enforced at runtime execution, not only listed as metadata.
- WebFetch now has cache and secondary summary hooks.
- Notebook now supports read/edit/insert/delete and atomic writes.
- Compact metadata now records strategy and replay-critical capability state.

This is sufficient to say Phase 2 has passed the local scripted real-task acceptance harness.

## Provider-Backed Unscripted Validation

A real DeepSeek provider-backed CLI run was executed against a temporary unfamiliar TypeScript repository.

Evidence:

- Temporary repo: `/tmp/vigilon-provider-acceptance-H8ODNL`
- Transcript: `/Users/liuminxuan/Desktop/Vigilon/VigilonAgent/packages/runtime/.vigilon/sessions/tmp-vigilon-provider-acceptance-H8ODNL/92eaa387-8a6f-4bae-b401-cc852a48f52a.jsonl`
- CLI result: `status=completed`, `stopReason=end_turn`, `turns=7`
- Final message: `Task complete — the bug is fixed and the test passes.`
- Tools used by the model: `Read`, `Edit`, `Bash`, `ResultReport`
- Runtime behavior observed: the model hit invalid `ResultReport` calls twice, received recoverable tool errors, corrected the report input, and completed with a valid handoff report.
- File verification after the run:

```bash
cd /tmp/vigilon-provider-acceptance-H8ODNL
node test.js
# pricing test passed
```

Final patched file:

```ts
export function calculateTotal(subtotal: number, tax: number): number {
  return subtotal + tax;
}
```

## Remaining Evidence Gap

No Phase 2 runtime closure blocker remains from the earlier review. The next evidence expansion should be broader unscripted coverage across multiple real external repositories, but that is a confidence expansion rather than a blocker for Phase 2 closure.
