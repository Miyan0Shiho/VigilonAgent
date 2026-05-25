# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vigilon Agent is an open-source local whiteboard Agent runtime. Two packages in a pnpm monorepo:

- **`packages/runtime`** (`@vigilon/runtime`) — Core agent runtime: CLI, agent loop, tools, session state, memory, compact, permissions, MCP, skills, subagents, LSP integration. Node.js >=22.
- **`packages/tui`** (`@vigilon/tui`) — Terminal operator UI (Ink/React) for inspecting runtime state and running agent turns.

Default model provider is DeepSeek (`deepseek-v4-flash`). Requires `DEEPSEEK_API_KEY` env var.

## Common Commands

```bash
pnpm install
pnpm build                                  # Build both packages
pnpm typecheck                              # Type-check both packages
pnpm --filter @vigilon/runtime test         # Run runtime tests (vitest)
pnpm --filter @vigilon/tui exec vitest run  # Run TUI tests
pnpm start -- <args>                        # Run runtime CLI (tsx src/cli.ts)
```

Run a single test file:
```bash
pnpm --filter @vigilon/runtime exec vitest run test/agentLoop.test.ts
```

## Architecture

### CLI → Agent Loop Flow

1. `src/cli.ts` — Entry point. Parses subcommands (`run`, `resume`, `init`, `doctor`, `memory`, `compact`, `sessions`, `agents`, `tui`, `tools`). Each subcommand calls `resolveOptions()` which loads settings, skills, MCP tools, and project config.
2. `resolveOptions()` in `src/cli/parse.ts` — Reads `.vigilon/settings.json` (project and local), loads skills from `.vigilon/skills/`, discovers MCP servers, resolves permission mode and model.
3. `runRuntimeTurn()` — Wires a `ModelClient` (DeepSeek) + `ToolRegistry` into `createVigilonAgentRuntime()` and iterates the async generator `runtime.runTurn()`.
4. `src/runtime/agentLoop.ts` — Core loop. Builds context window → sends to model → handles tool calls → runs pre-tool-use hooks → executes tools → appends transcript events. Supports auto-compact, subagent dispatch, plan/execute phases, and stop-after-result-report.

### Key Runtime Concepts

- **Transcript** (`src/runtime/transcript.ts`): JSONL append-only event log. `JsonlTranscriptStore` for file-backed storage, `InMemoryTranscriptStore` for testing. Session state (todos, plans, phase, permission mode) is replayed from transcript events on resume.

- **Session Memory** (`src/runtime/sessionMemory.ts`): Extracted markdown summary of session progress. Can be auto-generated, manually edited, validated, or refreshed. Injected into the model context window.

- **Project Memory** (`src/runtime/projectMemory.ts`): Long-term memory promoted from sessions. Stored under `.vigilon/memory/` with a manifest index. Types: user, feedback, project, reference.

- **Compact** (`src/runtime/compact.ts`): Transcript summarization when context grows too large. Drops old events, inserts a `compact-boundary` event with a summary. Token pressure estimation drives auto-compact decisions.

- **Permissions** (`src/runtime/permissions.ts`): Modes: `read-only`, `ask`, `accept-edits`, `bypass-local`. `PermissionGate` interface is called before tool execution; `PreToolUseHook` from settings can also deny.

- **Tools** (`src/tools/`): Each tool is a `Tool` object with `name`, `description`, `inputSchema`, and `execute()`. Registered in a `ToolRegistry`. Core tools include Read, Write, Edit, Bash, Glob, Grep, WebFetch, Notebook, LSP, Agent (subagent dispatch), and session management tools (plan mode, todos, result reports).

- **Subagents** (`src/runtime/subagent-runner.ts`): `AgentTool` dispatches background tasks. Can use git worktree isolation. Results flow through `SubagentTaskHost` → transcript events → `BackgroundTask` state.

- **Context Injection** (`src/runtime/context-injection.ts`): Builds the system prompt from project instructions (`AGENTS.md`, `VIGILON.md`, `.vigilon/instructions.md`), session memory, operator guidance, skill listings, and capability replay.

- **Project Instructions** (`src/runtime/projectInstructions.ts`): Loads from `AGENTS.md`, `VIGILON.md`, `.vigilon/instructions.md` in the project root.

- **Skills** (`src/runtime/skills.ts`): Loaded from `.vigilon/skills/`. Each skill is a markdown file with YAML frontmatter. The `SkillTool` lets the model invoke skills by name.

- **MCP** (`src/runtime/mcp.ts`): Model Context Protocol integration. Connects to MCP servers defined in settings `mcpServers` config. Tools from MCP servers are merged into the tool registry.

### Public API Surface

`src/index.ts` is the package's public API — it re-exports everything the TUI and external consumers need. The TUI imports `@vigilon/runtime` and calls these exports (not internal paths).

### Release Gate

```bash
pnpm release:check
```

Runs: typecheck → runtime tests → TUI tests → build → version smoke → governance baseline → pack check.
