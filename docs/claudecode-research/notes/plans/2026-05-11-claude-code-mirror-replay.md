# Claude Code Mirror Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Perform a pixel-perfect port of the Claude Code source tree into a single package, preserving all directory relationships and removing existing trial code.

**Architecture:** A single package `packages/claude-code` will contain the entire mirrored `src` directory. Existing multi-package trial code will be removed to simplify the structure and avoid dependency conflicts.

**Tech Stack:** TypeScript, Node.js, React, Ink, pnpm workspaces.

---

### Task 1: Clean up existing trial code

**Files:**
- Delete: `packages/core`
- Delete: `packages/shared`
- Delete: `packages/tui`

- [ ] **Step 1: Delete existing trial package directories**
Run: `rm -rf packages/core packages/shared packages/tui`

- [ ] **Step 2: Commit cleanup**
```bash
git add packages
git commit -m "chore: remove trial package directories"
```

### Task 2: Initialize `packages/claude-code`

**Files:**
- Create: `packages/claude-code/package.json`
- Create: `packages/claude-code/tsconfig.json`

- [ ] **Step 1: Create `packages/claude-code` directory**
Run: `mkdir -p packages/claude-code/src`

- [ ] **Step 2: Create `package.json` for the new package**
```json
{
  "name": "@vigilon/claude-code",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "start": "tsx src/entrypoints/cli.tsx"
  },
  "dependencies": {
    "ink": "^7.0.2",
    "react": "^19.2.6",
    "tsx": "^4.21.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json` for the new package**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "baseUrl": ".",
    "paths": {
      "*": ["src/*"]
    }
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Commit initialization**
```bash
git add packages/claude-code
git commit -m "feat: initialize @vigilon/claude-code package"
```

### Task 3: Mirror the source tree

**Files:**
- Create: `packages/claude-code/src/**` (from `docs/claudecode-research/src/**`)

- [ ] **Step 1: Copy all source files from mirror to new package**
Run: `cp -r docs/claudecode-research/src/* packages/claude-code/src/`

- [ ] **Step 2: Verify file count**
Run: `find packages/claude-code/src -type f | wc -l`
Expected: Approximately 1800+ files.

- [ ] **Step 3: Commit mirrored source**
```bash
git add packages/claude-code/src
git commit -m "feat: mirror claude-code source tree into packages/claude-code"
```

### Task 4: Update Workspace Configuration

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json` (root)

- [ ] **Step 1: Update `pnpm-workspace.yaml` to only include the new package**
```yaml
packages:
  - 'packages/claude-code'
```

- [ ] **Step 2: Update root `package.json` scripts**
```json
{
  "name": "vigilon-agent",
  "private": true,
  "packageManager": "pnpm@10.0.0",
  "type": "module",
  "scripts": {
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "start": "pnpm --filter @vigilon/claude-code start"
  },
  "devDependencies": {
    "@types/node": "^24.10.0",
    "@types/react": "^19.2.2",
    "tsx": "^4.21.0",
    "typescript": "^6.0.3",
    "vitest": "^4.1.5"
  }
}
```

- [ ] **Step 3: Run `pnpm install` to update lockfile**
Run: `corepack pnpm install`

- [ ] **Step 4: Commit workspace updates**
```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml
git commit -m "chore: update workspace configuration for @vigilon/claude-code"
```

### Task 5: Final Verification

- [ ] **Step 1: Run typecheck to verify structure**
Run: `pnpm typecheck`
Expected: May have errors due to missing dependencies, but should correctly scan all files.

- [ ] **Step 2: Summary of work**
Check that all 1800+ files are present and the directory structure is preserved.
