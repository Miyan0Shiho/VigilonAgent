# Contributing

Vigilon v0.1.0 is a local Agent runtime preview. Contributions should keep fixes general and rooted in runtime contracts, not point patches for one prompt or one fixture.

## Development

```bash
pnpm install
pnpm typecheck
pnpm --filter @vigilon/runtime test
pnpm --filter @vigilon/tui exec vitest run
pnpm build
```

Before a release-facing change, run:

```bash
pnpm release:check
```

## Scope

- Runtime behavior lives in `packages/runtime`.
- Operator shell behavior lives in `packages/tui`.
- Historical comparison notes live under `docs`; do not reintroduce tracked source mirrors.
- Remote execution, multi-user teams, enterprise administration, billing, telemetry, and marketplaces are outside the v0.1.0 boundary.
