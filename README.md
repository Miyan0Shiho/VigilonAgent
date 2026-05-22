# Vigilon Agent

Vigilon Agent is an open-source local whiteboard Agent runtime. The v0.1.0 goal is a clean, runnable, extensible base system: enough core agent behavior to operate as an independent local coding/task agent, while keeping the codebase open for future specialized agents.

This repository is no longer treated as a Claude Code reference mirror. Historical reference source mirrors have been removed from the tracked tree; ignored local archives are not required to build or use v0.1.0.

## What Works Now

- CLI runtime for local agent turns, transcripts, resume, memory, compact, permissions, and tool execution.
- TUI operator shell for validating real agent flow and inspecting runtime state.
- DeepSeek provider integration, defaulting to `deepseek-v4-flash` unless overridden.
- Core tools for read/search/edit/write/bash/web fetch/notebook/LSP/task control/config/session operations.
- Project instructions from `AGENTS.md`, `VIGILON.md`, and `.vigilon/instructions.md`.
- Skills, MCP servers, subagents, task hosts, safety policy, sandbox decisions, and governance probes.

## Quickstart

```bash
pnpm install
pnpm build
export DEEPSEEK_API_KEY=...

pnpm start -- init --cwd .
pnpm start -- doctor
pnpm start -- run "inspect this repository and report the main runtime entrypoints" --permission-mode ask
pnpm tui
```

## Commands

```bash
pnpm start -- --help
pnpm start -- doctor
pnpm start -- init --cwd .
pnpm start -- tools --cwd .
pnpm start -- run "your task" --cwd . --permission-mode ask
pnpm start -- sessions --cwd .
pnpm start -- resume <session-id> --cwd .
pnpm start -- memory --cwd .
pnpm start -- compact --cwd .
pnpm start -- agents --cwd .
pnpm tui
```

## Project Layout

- `packages/runtime` - core Agent runtime, CLI, tools, session state, memory, permissions, MCP, subagents, and probes.
- `packages/tui` - terminal operator interface built on the runtime adapter boundary.
- `docs/product` - product direction, stage boundaries, readiness reports, and roadmaps.
- `docs/archived-research` - historical notes and comparison artifacts; source mirrors were removed from Git.
- `docs/superpowers` - implementation and research notes that remain part of the project.

## v0.1.0 Boundary

The v0.1.0 target is not to prove feature parity with any existing product. The target is a whiteboard Agent with enough base capabilities to run, inspect, edit, ask for permission, preserve state, recover sessions, and support future specialization.

Near-term work should focus on making that foundation easier to install, verify, and extend. Product surfaces such as remote execution, multi-user teams, enterprise governance, billing, telemetry, and marketplaces are intentionally out of scope.

## Development Gates

```bash
pnpm --filter @vigilon/runtime test
pnpm --filter @vigilon/tui exec vitest run
pnpm build
pnpm phase2.5:baseline
```

The release-facing gate is:

```bash
pnpm release:check
```

It runs workspace typecheck, runtime tests, TUI tests, build, version smoke, the runtime governance baseline, and package pack checks.

## Release Artifacts

- Runtime package: `@vigilon/runtime`
- TUI package: `@vigilon/tui`
- Changelog: `CHANGELOG.md`
- Release record: `docs/product/2026-05-22-open-source-v0-1-0-release.md`

## License

MIT
