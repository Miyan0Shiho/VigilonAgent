# Open Source v0.1.0 Release

- Date: 2026-05-22
- Status: release cut readiness
- Version: `0.1.0`

## Release Boundary

Vigilon v0.1.0 is an open-source local whiteboard Agent runtime. The release target is a runnable and extensible base system, not mature product parity with any existing agent product.

Included:

- Runtime CLI, model provider wiring, transcript, resume, permissions, safety policy, memory, compact, tools, skills, MCP loading, subagents, task hosts, and project instructions.
- TUI operator shell for local runtime validation and session inspection.
- Product docs that explain current boundaries and historical decisions.
- MIT license and package metadata for `@vigilon/runtime` and `@vigilon/tui`.

Excluded:

- Tracked source mirrors of third-party reference projects.
- Remote execution, multi-user teams, enterprise administration, billing, telemetry, and marketplace surfaces.
- Claims of daily-driver maturity or full Claude Code-level behavior.

## Release Gates

The v0.1.0 gate is:

```bash
pnpm release:check
```

It expands to:

- workspace typecheck
- runtime tests
- TUI tests
- workspace build
- runtime version smoke
- `phase2.5:baseline`
- package pack checks for `@vigilon/runtime` and `@vigilon/tui`

Provider-backed probes are useful evidence expansion, but they require live credentials and are not part of the default open-source release gate.

## Packaging Rules

Only built `dist` artifacts and package READMEs are included in package pack checks. Runtime transcripts, local `.vigilon` state, source mirrors, scratch archives, tests, scripts, and local OS artifacts must stay out of packages.

## Release Checklist

- `package.json` version is `0.1.0`.
- `packages/runtime/package.json` version is `0.1.0`.
- `packages/tui/package.json` version is `0.1.0`.
- Root README describes Vigilon as an open-source local whiteboard Agent runtime.
- `LICENSE`, `CHANGELOG.md`, `CONTRIBUTING.md`, and `SECURITY.md` exist.
- `pnpm release:check` passes.
