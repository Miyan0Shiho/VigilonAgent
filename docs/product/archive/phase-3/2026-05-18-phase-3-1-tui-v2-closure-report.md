# Phase 3.1 TUI v2 Closure Report

- Date: 2026-05-18
- Scope: Claude-like Operator Shell for `vigilon tui`
- Status: REOPENED / NOT CLOSED as of 2026-05-19. The executable TUI v2 acceptance evidence confirms integration, not Claude Code-level operator experience.

## 2026-05-19 Reopen Note

The current TUI is still too close to a surface-level Claude Code imitation:

- It has message rows, tool rows, permission rows, and handoff rows, but the information priority is not yet clear enough during real debugging.
- It proves event plumbing, not the actual Claude Code feel of "what is happening, why it matters, what is blocked, what evidence exists, what the model will do next."
- It should be treated as an internal Agent-flow validation surface, not a polished product surface.

Next TUI work should copy from Claude Code's actual TUI implementation and interaction structure as literally as possible within Vigilon's local-runtime boundary. Do not keep inventing a separate design language for this internal tool. The future user-facing product surface is GUI + CLI, so this TUI should optimize for faithful debugging of the Agent loop rather than ornamental polish.

## Boundary

Phase 3.1 upgrades the Phase 3 text workbench into a dedicated TUI package without expanding into P4/P5.

Included:

- `packages/tui` as the TUI package boundary.
- `ink + react` component shell for the operator surface.
- Runtime adapter that uses the existing Vigilon runtime, transcript, session resume, compact path, permission gate, tool pool, AskUserQuestion, and ResultReport.
- Dense message stream for user, assistant, reasoning, working state, tool activity, permission, AskUserQuestion, hook/error, and final handoff.
- Session/task panel and commands: `/help`, `/clear`, `/sessions`, `/resume`, `/open`, `/approve`, `/doctor`, `/quit`.

Excluded:

- Remote sessions.
- Teammate/swarm product surfaces.
- Enterprise/admin/billing/telemetry.
- Marketplace and desktop automation surfaces.

## What Landed

1. Package split
   - Added `@vigilon/tui` under `packages/tui`.
   - `vigilon tui` now delegates to `@vigilon/tui` instead of running the old runtime-local workbench loop.
   - Root scripts now include `phase3.1:acceptance`.

2. Copy-first TUI surface
   - The visible stream now follows the Claude Code TUI shape more closely:
     - framed operator shell header
     - session/task rail
     - conversation frame
     - `> prompt` user rows
     - `✻` working/reasoning rows
     - `●/✓/✗` tool activity rows
     - `⎿` compact tool-result summaries
     - permission and AskUser dialog blocks
     - structured Result handoff panel
   - The copy boundary is the daily-driver TUI interaction shape, not Claude Code's remote, teammate, enterprise, marketplace, analytics, or hosted session surfaces.
   - TTY mode now enters a real Ink app:
     - `render(<InteractiveOperatorShell />)`
     - `useInput()` handles composer keystrokes, submit, history up/down, and command dispatch
     - runtime events append into React state and rerender the conversation
     - permission and AskUser waits resolve through an in-UI pending prompt controller
   - Non-TTY mode keeps the scripted fallback used by acceptance tests.

3. Runtime adapter
   - The TUI adapter imports and uses the existing runtime APIs.
   - It creates `JsonlTranscriptStore`, resumes sessions through transcript state, constructs the core tool registry, loads settings/skills/MCP, and runs `createVigilonAgentRuntime`.
   - Permission and AskUserQuestion interactions continue to append transcript events.

4. Operator shell UX
   - The shell shows session/task state, message stream, and composer command hints.
   - Tool calls render as compact activity blocks instead of raw `[tool:start]` lines.
   - Permission requests show action, risk, subject, reason, and allow/deny/allow-similar choices.
   - AskUserQuestion renders a structured question/options block.
   - Result handoff explicitly marks whether `ResultReport` was present.

5. Acceptance evidence
   - Added `packages/tui/scripts/phase31-tui-acceptance.ts`.
   - The scripted scenario starts the new TUI, runs a scripted-model task, displays `Read` and `Write` tool activity, handles AskUserQuestion, handles a write permission request, records `ResultReport`, opens a session, and resumes by index.

## Validation Commands

```bash
pnpm typecheck
pnpm phase3:baseline
pnpm phase3:acceptance
pnpm phase3.1:acceptance
```

## Observed Evidence

### Phase 3 Baseline

- `pnpm phase3:baseline`
  - `pnpm typecheck` passed for `@vigilon/runtime` and `@vigilon/tui`
  - `pnpm --filter @vigilon/runtime test` passed: `25` files, `125` tests
  - `pnpm smoke:version` returned `0.1.0`
  - `vigilon doctor` returned structured `ok` output with `DEEPSEEK_API_KEY` present

### Phase 3 Acceptance

- `pnpm phase3:acceptance`
  - Workbench run scenario: passed with new Operator Shell title
  - Workbench approve/resume scenario: passed
  - Doctor scenario: passed
- Acceptance artifact root:
  - `/var/folders/zf/3t2thms15qn5w9zll5_747900000gn/T/vigilon-phase3-acceptance-TDQZFO`
- Acceptance transcripts:
  - `/var/folders/zf/3t2thms15qn5w9zll5_747900000gn/T/vigilon-phase3-acceptance-TDQZFO/sessions-workbench-run/var-folders-zf-3t2thms15qn5w9zll5_747900000gn-T-vigilon-phase3-acceptance-TDQZFO-repo-workbench-run/ef00b7d6-44a0-4c6e-9823-47a50817affc.jsonl`
  - `/var/folders/zf/3t2thms15qn5w9zll5_747900000gn/T/vigilon-phase3-acceptance-TDQZFO/sessions-workbench-approve/var-folders-zf-3t2thms15qn5w9zll5_747900000gn-T-vigilon-phase3-acceptance-TDQZFO-repo-workbench-approve/approve-me.jsonl`

### Phase 3.1 TUI v2 Acceptance

- `pnpm phase3.1:acceptance`
  - New TUI exited cleanly
  - Started `@vigilon/tui` shell
  - Displayed `Read` and `Write` tool activity
  - Displayed permission request
  - Displayed AskUserQuestion block
  - Displayed ResultReport handoff
  - Opened session detail
  - Resumed session by index
- Acceptance artifact root:
  - `/var/folders/zf/3t2thms15qn5w9zll5_747900000gn/T/vigilon-phase31-tui-VvxtU6`
- Acceptance stdout artifact:
  - `/var/folders/zf/3t2thms15qn5w9zll5_747900000gn/T/vigilon-phase31-tui-VvxtU6/stdout.txt`
- Acceptance sessions root:
  - `/var/folders/zf/3t2thms15qn5w9zll5_747900000gn/T/vigilon-phase31-tui-VvxtU6/sessions`

### TTY Dynamic Smoke

- Command:
  - `pnpm --filter @vigilon/tui start -- --cwd /Users/liuminxuan/Desktop/Vigilon/VigilonAgent --sessions-dir /tmp/vigilon-tui-dynamic-check`
- Result:
  - Started the real Ink app in a PTY.
  - The composer updated live while typing `/quit`.
  - Sending raw-mode Return exited cleanly.

## Known Limitations

- The current implementation prioritizes a real package boundary and runtime-backed interaction flow over advanced raw-mode editing.
- Scripted acceptance validates the event flow and transcript-backed integration; visual terminal polish should still be checked manually in a real TTY.
- P4/P5 surfaces remain intentionally absent.
