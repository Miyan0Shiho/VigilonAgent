# Claude Code 研究库 V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `docs/superpowers/research/claude-code-library-v2/` research library with volume structure, function-level evidence, SVG diagrams, and cross-linked product / architecture / user / implementation analysis.

**Architecture:** The implementation proceeds in seven layers: repository scaffolding, evidence base, runtime-kernel analysis, mechanism deep dives, user/product synthesis, SVG diagram production, and editorial QA. Existing `claude-code-deep-dive` materials remain reference-only; the new V2 library becomes the formal, indexed, cross-linked knowledge system.

**Tech Stack:** Markdown, SVG, local repository source analysis, Anthropic official docs, high-quality community references, git, subagent task decomposition.

---

## File Structure

### New research library root

- Create: `docs/superpowers/research/claude-code-library-v2/README.md`
  - Library homepage and scope statement.
- Create: `docs/superpowers/research/claude-code-library-v2/master-index.md`
  - Global navigation from questions to documents, source files, and diagrams.
- Create: `docs/superpowers/research/claude-code-library-v2/reading-paths.md`
  - Human-first and agent-first reading sequences.
- Create: `docs/superpowers/research/claude-code-library-v2/glossary.md`
  - Stable terminology for product, runtime, tool, session, permission, and extension concepts.

### Product layer

- Create: `docs/superpowers/research/claude-code-library-v2/product/01-positioning-and-surface.md`
- Create: `docs/superpowers/research/claude-code-library-v2/product/02-capability-matrix.md`
- Create: `docs/superpowers/research/claude-code-library-v2/product/03-workflows-and-modes.md`
- Create: `docs/superpowers/research/claude-code-library-v2/product/04-plans-governance-and-enterprise.md`

### Architecture layer

- Create: `docs/superpowers/research/claude-code-library-v2/architecture/01-entrypoints-and-bootstrap.md`
- Create: `docs/superpowers/research/claude-code-library-v2/architecture/02-runtime-kernel.md`
- Create: `docs/superpowers/research/claude-code-library-v2/architecture/03-state-and-persistence.md`
- Create: `docs/superpowers/research/claude-code-library-v2/architecture/04-ui-repl-and-ink.md`

### User layer

- Create: `docs/superpowers/research/claude-code-library-v2/users/01-terminal-and-power-users.md`
- Create: `docs/superpowers/research/claude-code-library-v2/users/02-team-and-enterprise-admins.md`
- Create: `docs/superpowers/research/claude-code-library-v2/users/03-extension-developers.md`
- Create: `docs/superpowers/research/claude-code-library-v2/users/04-user-journeys-and-friction-points.md`

### Implementation layer

- Create: `docs/superpowers/research/claude-code-library-v2/implementation/01-cli-dispatch-and-fast-paths.md`
- Create: `docs/superpowers/research/claude-code-library-v2/implementation/02-process-user-input.md`
- Create: `docs/superpowers/research/claude-code-library-v2/implementation/03-query-engine.md`
- Create: `docs/superpowers/research/claude-code-library-v2/implementation/04-query-loop.md`
- Create: `docs/superpowers/research/claude-code-library-v2/implementation/05-tool-use-context.md`
- Create: `docs/superpowers/research/claude-code-library-v2/implementation/06-session-storage-and-resume.md`
- Create: `docs/superpowers/research/claude-code-library-v2/implementation/07-api-streaming-and-budgeting.md`
- Create: `docs/superpowers/research/claude-code-library-v2/implementation/08-repl-state-rendering.md`

### Mechanism layer

- Create: `docs/superpowers/research/claude-code-library-v2/mechanisms/01-tools-and-tool-registry.md`
- Create: `docs/superpowers/research/claude-code-library-v2/mechanisms/02-skills-and-prompts.md`
- Create: `docs/superpowers/research/claude-code-library-v2/mechanisms/03-hooks-and-guardrails.md`
- Create: `docs/superpowers/research/claude-code-library-v2/mechanisms/04-permissions-and-policy-limits.md`
- Create: `docs/superpowers/research/claude-code-library-v2/mechanisms/05-mcp-and-plugin-boundary.md`
- Create: `docs/superpowers/research/claude-code-library-v2/mechanisms/06-subagents-tasks-and-sessions.md`
- Create: `docs/superpowers/research/claude-code-library-v2/mechanisms/07-observability-and-telemetry.md`

### Evidence layer

- Create: `docs/superpowers/research/claude-code-library-v2/evidence/evidence-ledger.md`
- Create: `docs/superpowers/research/claude-code-library-v2/evidence/doc-to-source-map.md`
- Create: `docs/superpowers/research/claude-code-library-v2/evidence/source-to-doc-map.md`
- Create: `docs/superpowers/research/claude-code-library-v2/evidence/function-index.md`
- Create: `docs/superpowers/research/claude-code-library-v2/evidence/variable-state-index.md`
- Create: `docs/superpowers/research/claude-code-library-v2/evidence/external-sources.md`

### Synthesis layer

- Create: `docs/superpowers/research/claude-code-library-v2/synthesis/01-design-principles.md`
- Create: `docs/superpowers/research/claude-code-library-v2/synthesis/02-patterns-to-inherit.md`
- Create: `docs/superpowers/research/claude-code-library-v2/synthesis/03-patterns-to-avoid.md`
- Create: `docs/superpowers/research/claude-code-library-v2/synthesis/04-product-opportunities.md`

### Diagram assets

- Create: `docs/superpowers/research/claude-code-library-v2/figures/01-product-surface.svg`
- Create: `docs/superpowers/research/claude-code-library-v2/figures/02-cli-dispatch.svg`
- Create: `docs/superpowers/research/claude-code-library-v2/figures/03-main-bootstrap.svg`
- Create: `docs/superpowers/research/claude-code-library-v2/figures/04-query-kernel.svg`
- Create: `docs/superpowers/research/claude-code-library-v2/figures/05-process-user-input.svg`
- Create: `docs/superpowers/research/claude-code-library-v2/figures/06-tool-use-context.svg`
- Create: `docs/superpowers/research/claude-code-library-v2/figures/07-permission-boundary.svg`
- Create: `docs/superpowers/research/claude-code-library-v2/figures/08-session-lifecycle.svg`
- Create: `docs/superpowers/research/claude-code-library-v2/figures/09-user-roles.svg`
- Create: `docs/superpowers/research/claude-code-library-v2/figures/10-doc-to-runtime-map.svg`

## Task 1: Scaffold the V2 library and library-wide conventions

**Files:**
- Create: `docs/superpowers/research/claude-code-library-v2/README.md`
- Create: `docs/superpowers/research/claude-code-library-v2/master-index.md`
- Create: `docs/superpowers/research/claude-code-library-v2/reading-paths.md`
- Create: `docs/superpowers/research/claude-code-library-v2/glossary.md`

- [ ] **Step 1: Create the directory tree**

Run:

```bash
mkdir -p \
  docs/superpowers/research/claude-code-library-v2/{product,architecture,users,implementation,mechanisms,evidence,synthesis,figures}
```

Expected: all eight content folders exist under `docs/superpowers/research/claude-code-library-v2/`.

- [ ] **Step 2: Write the library homepage**

Create `docs/superpowers/research/claude-code-library-v2/README.md` with:

```md
# Claude Code 深度研究文档库 V2

## 目标

- 建立一套面向人类阅读与 agent 调研的 Claude Code 长期研究库。
- 用产品层、架构层、用户层、实现层、机制层、证据层、图谱层、启发层形成闭环。
- 让关键结论回链到具体源码、函数、变量、状态与外部证据。

## 研究边界

- 核心源码：`packages/claude-code/src/**`
- 依赖链：CLI 入口、QueryEngine、query loop、ToolUseContext、session storage、permissions、hooks、MCP、tasks、REPL / Ink
- 外部资料：Anthropic 官方资料 + 高质量社区资料

## 阅读入口

- 从 `master-index.md` 进入问题导航
- 从 `reading-paths.md` 选择阅读路径
- 从 `evidence/` 进入证据与映射
- 从 `figures/` 查看 SVG 图谱
```

- [ ] **Step 3: Write the master index and reading guides**

Create `master-index.md`, `reading-paths.md`, and `glossary.md` with these fixed section headers:

```md
# Claude Code V2 总索引
## 问题导航
## 文档导航
## 图谱导航
## 源码导航
## 证据导航
```

```md
# Claude Code V2 阅读路径
## 人类阅读路径
## Agent 调研路径
## 快速切入路径
## 深度穿透路径
```

```md
# Claude Code V2 术语表
## 产品术语
## 运行时术语
## 工具与扩展术语
## 状态与会话术语
## 用户与治理术语
```

- [ ] **Step 4: Add a library-wide writing convention note**

Append this block to `README.md`:

```md
## 写作规范

- 每篇核心文档统一采用：研究问题、结论摘要、证据等级、关键源码入口、关键调用链、关键函数、关键变量 / 状态、边界与失败模式、外部资料互证、产品启发。
- 每条高价值结论必须给出证据等级。
- SVG 图谱必须能回链到对应文档和源码。
```

- [ ] **Step 5: Commit scaffold**

Use the `git-commit` skill to create a `docs(research)` commit for the V2 library scaffold only.

## Task 2: Build the evidence base before writing analysis volumes

**Files:**
- Create: `docs/superpowers/research/claude-code-library-v2/evidence/evidence-ledger.md`
- Create: `docs/superpowers/research/claude-code-library-v2/evidence/doc-to-source-map.md`
- Create: `docs/superpowers/research/claude-code-library-v2/evidence/source-to-doc-map.md`
- Create: `docs/superpowers/research/claude-code-library-v2/evidence/function-index.md`
- Create: `docs/superpowers/research/claude-code-library-v2/evidence/variable-state-index.md`
- Create: `docs/superpowers/research/claude-code-library-v2/evidence/external-sources.md`

- [ ] **Step 1: Seed the evidence ledger**

Create `evidence-ledger.md` with:

```md
# Claude Code V2 证据台账

| 结论 | 证据等级 | 本地源码证据 | 外部证据 | 状态 |
| --- | --- | --- | --- | --- |
| CLI 入口是多路 fast-path 分发层 | A | `packages/claude-code/src/entrypoints/cli.tsx` | Anthropic overview / CLI docs | 已确认 |
| `query.ts` 承担 agent loop 核心复杂度 | A | `packages/claude-code/src/query.ts` | how-claude-code-works | 已确认 |
| `ToolUseContext` 是工具能力汇流枢纽 | B | `packages/claude-code/src/Tool.ts` | 社区深拆 / 本地研究映射 | 待扩写 |
```

- [ ] **Step 2: Seed the bidirectional mapping pages**

Create `doc-to-source-map.md` and `source-to-doc-map.md` with these starter rows:

```md
# 文档 -> 源码映射

| 文档 | 关键源码 |
| --- | --- |
| `product/01-positioning-and-surface.md` | `packages/claude-code/src/entrypoints/cli.tsx`, `packages/claude-code/src/main.tsx` |
| `implementation/04-query-loop.md` | `packages/claude-code/src/query.ts` |
| `mechanisms/05-mcp-and-plugin-boundary.md` | `packages/claude-code/src/services/mcp/**`, `packages/claude-code/src/plugins/**` |
```

```md
# 源码 -> 文档映射

| 源码 | 对应文档 |
| --- | --- |
| `packages/claude-code/src/entrypoints/cli.tsx` | `architecture/01-entrypoints-and-bootstrap.md`, `implementation/01-cli-dispatch-and-fast-paths.md` |
| `packages/claude-code/src/query.ts` | `architecture/02-runtime-kernel.md`, `implementation/04-query-loop.md` |
| `packages/claude-code/src/utils/sessionStorage.ts` | `architecture/03-state-and-persistence.md`, `implementation/06-session-storage-and-resume.md` |
```

- [ ] **Step 3: Seed the function and variable indexes**

Create `function-index.md` and `variable-state-index.md` with these starters:

```md
# Claude Code V2 函数索引

| 符号 | 文件 | 责任 | 主文档 |
| --- | --- | --- | --- |
| `main()` | `packages/claude-code/src/entrypoints/cli.tsx` | CLI fast-path dispatch | `implementation/01-cli-dispatch-and-fast-paths.md` |
| `query()` | `packages/claude-code/src/query.ts` | Agent loop entry | `implementation/04-query-loop.md` |
| `queryLoop()` | `packages/claude-code/src/query.ts` | Iterative turn execution | `implementation/04-query-loop.md` |
```

```md
# Claude Code V2 变量与状态索引

| 名称 | 文件 | 类型 | 作用 | 主文档 |
| --- | --- | --- | --- | --- |
| `args` | `packages/claude-code/src/entrypoints/cli.tsx` | runtime input | CLI path selection | `implementation/01-cli-dispatch-and-fast-paths.md` |
| `State` | `packages/claude-code/src/query.ts` | loop state | turn-to-turn mutable runtime | `implementation/04-query-loop.md` |
| `messages` | `packages/claude-code/src/query.ts` | message array | main fact stream | `architecture/02-runtime-kernel.md` |
```

- [ ] **Step 4: Write the external sources registry**

Create `external-sources.md` with these sections:

```md
# Claude Code V2 外部资料台账
## 官方文档
- `https://code.claude.com/docs/en/overview`
- `https://code.claude.com/docs/en/how-claude-code-works`
- `https://code.claude.com/docs/en/settings`
- `https://code.claude.com/docs/en/hooks`
- `https://code.claude.com/docs/en/sub-agents`
- `https://code.claude.com/docs/en/skills`

## 官方平台与支持资料
- `https://platform.claude.com/docs/en/home`
- `https://support.claude.com/`

## 高质量社区资料
- 记录标题、作者、发布日期、核心价值、风险说明
```

- [ ] **Step 5: Cross-check the evidence pages against local source files**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
required = [
    "packages/claude-code/src/entrypoints/cli.tsx",
    "packages/claude-code/src/query.ts",
    "packages/claude-code/src/Tool.ts",
    "packages/claude-code/src/QueryEngine.ts",
    "packages/claude-code/src/utils/sessionStorage.ts",
]
for p in required:
    print("OK" if Path(p).exists() else "MISSING", p)
PY
```

Expected: every listed path prints `OK`.

- [ ] **Step 6: Commit evidence base**

Use the `git-commit` skill to create a `docs(research)` commit for the initial evidence layer.

## Task 3: Write the runtime kernel and implementation-core volumes first

**Files:**
- Create: `docs/superpowers/research/claude-code-library-v2/architecture/01-entrypoints-and-bootstrap.md`
- Create: `docs/superpowers/research/claude-code-library-v2/architecture/02-runtime-kernel.md`
- Create: `docs/superpowers/research/claude-code-library-v2/architecture/03-state-and-persistence.md`
- Create: `docs/superpowers/research/claude-code-library-v2/implementation/01-cli-dispatch-and-fast-paths.md`
- Create: `docs/superpowers/research/claude-code-library-v2/implementation/02-process-user-input.md`
- Create: `docs/superpowers/research/claude-code-library-v2/implementation/03-query-engine.md`
- Create: `docs/superpowers/research/claude-code-library-v2/implementation/04-query-loop.md`
- Create: `docs/superpowers/research/claude-code-library-v2/implementation/05-tool-use-context.md`
- Create: `docs/superpowers/research/claude-code-library-v2/implementation/06-session-storage-and-resume.md`
- Create: `docs/superpowers/research/claude-code-library-v2/implementation/07-api-streaming-and-budgeting.md`

- [ ] **Step 1: Write the architecture entrypoint document**

Create `architecture/01-entrypoints-and-bootstrap.md` with these mandatory sections:

```md
# 入口与启动装配
## 研究问题
## 结论摘要
## 证据等级
## 关键源码入口
## `entrypoints/cli.tsx` fast-path 分发
## `main.tsx` 装配责任
## 关键函数
## 关键变量 / 状态
## 边界与失败模式
## 外部资料互证
## 产品启发
```

- [ ] **Step 2: Write the runtime-kernel and state documents**

Create `architecture/02-runtime-kernel.md` and `architecture/03-state-and-persistence.md` and ensure both mention these symbols exactly:

```md
- `packages/claude-code/src/query.ts`
- `packages/claude-code/src/QueryEngine.ts`
- `packages/claude-code/src/bootstrap/state.ts`
- `packages/claude-code/src/utils/sessionStorage.ts`
- `messages`
- `State`
- `mutableMessages`
```

- [ ] **Step 3: Write the implementation docs for CLI, input preprocessing, and QueryEngine**

Each of these files must include at least one table of `函数 -> 责任 -> 关键变量 -> 上下游调用`:

```md
- `implementation/01-cli-dispatch-and-fast-paths.md`
- `implementation/02-process-user-input.md`
- `implementation/03-query-engine.md`
```

Required functions to analyze:

```md
- `main()` in `packages/claude-code/src/entrypoints/cli.tsx`
- `processUserInput()` in `packages/claude-code/src/utils/processUserInput/processUserInput.ts`
- the main session-submit path in `packages/claude-code/src/QueryEngine.ts`
```

- [ ] **Step 4: Write the implementation docs for query loop, ToolUseContext, session storage, and API streaming**

Each of these files must include one explicit call-chain block:

```md
`caller -> callee -> state change -> persisted artifact / UI effect`
```

Required symbols to cover:

```md
- `query()`
- `queryLoop()`
- `ToolUseContext`
- `messages`
- `recordContentReplacement`
- streaming model request path in `packages/claude-code/src/services/api/claude.ts`
```

- [ ] **Step 5: Verify kernel docs cover real symbols**

Run:

```bash
grep -n "queryLoop\|ToolUseContext\|processUserInput\|sessionStorage" \
  docs/superpowers/research/claude-code-library-v2/architecture/*.md \
  docs/superpowers/research/claude-code-library-v2/implementation/*.md
```

Expected: matches appear in the created architecture and implementation documents.

- [ ] **Step 6: Commit kernel volumes**

Use the `git-commit` skill to create a `docs(research)` commit for architecture and implementation-core volumes.

## Task 4: Write the mechanism volumes for tools, permissions, hooks, MCP, tasks, and telemetry

**Files:**
- Create: `docs/superpowers/research/claude-code-library-v2/mechanisms/01-tools-and-tool-registry.md`
- Create: `docs/superpowers/research/claude-code-library-v2/mechanisms/02-skills-and-prompts.md`
- Create: `docs/superpowers/research/claude-code-library-v2/mechanisms/03-hooks-and-guardrails.md`
- Create: `docs/superpowers/research/claude-code-library-v2/mechanisms/04-permissions-and-policy-limits.md`
- Create: `docs/superpowers/research/claude-code-library-v2/mechanisms/05-mcp-and-plugin-boundary.md`
- Create: `docs/superpowers/research/claude-code-library-v2/mechanisms/06-subagents-tasks-and-sessions.md`
- Create: `docs/superpowers/research/claude-code-library-v2/mechanisms/07-observability-and-telemetry.md`

- [ ] **Step 1: Write the tools / skills / prompts documents**

Ensure these files explicitly mention:

```md
- `packages/claude-code/src/Tool.ts`
- `packages/claude-code/src/tools.ts`
- `packages/claude-code/src/skills/**`
- prompt-carrying files under `packages/claude-code/src/tools/**/prompt.ts`
```

- [ ] **Step 2: Write the hooks and permissions documents**

Ensure these files explicitly mention:

```md
- `packages/claude-code/src/query/stopHooks.ts`
- hook execution paths under `packages/claude-code/src/utils/hooks/**`
- permission or policy limit paths discovered during source reading
- at least one deterministic guardrail example
```

- [ ] **Step 3: Write the MCP and subagent/session documents**

Ensure these files explicitly mention:

```md
- `packages/claude-code/src/services/mcp/**`
- `packages/claude-code/src/plugins/**`
- `packages/claude-code/src/tasks/**`
- `packages/claude-code/src/tools/AgentTool/**`
```

- [ ] **Step 4: Write the observability document**

Create `mechanisms/07-observability-and-telemetry.md` with sections for:

```md
## `queryProfiler`
## `startupProfiler`
## API logging
## transcript as evidence
## future instrumentation opportunities
```

- [ ] **Step 5: Link the mechanism docs back into evidence maps**

Append rows to:

```md
- `evidence/doc-to-source-map.md`
- `evidence/source-to-doc-map.md`
- `evidence/function-index.md`
```

for each mechanism document created in this task.

- [ ] **Step 6: Commit mechanism layer**

Use the `git-commit` skill to create a `docs(research)` commit for the mechanism volumes.

## Task 5: Write the product and user volumes after the technical core is stable

**Files:**
- Create: `docs/superpowers/research/claude-code-library-v2/product/01-positioning-and-surface.md`
- Create: `docs/superpowers/research/claude-code-library-v2/product/02-capability-matrix.md`
- Create: `docs/superpowers/research/claude-code-library-v2/product/03-workflows-and-modes.md`
- Create: `docs/superpowers/research/claude-code-library-v2/product/04-plans-governance-and-enterprise.md`
- Create: `docs/superpowers/research/claude-code-library-v2/users/01-terminal-and-power-users.md`
- Create: `docs/superpowers/research/claude-code-library-v2/users/02-team-and-enterprise-admins.md`
- Create: `docs/superpowers/research/claude-code-library-v2/users/03-extension-developers.md`
- Create: `docs/superpowers/research/claude-code-library-v2/users/04-user-journeys-and-friction-points.md`

- [ ] **Step 1: Write the product surface and capability matrix docs**

These files must include:

```md
- one table mapping `official claim -> user-visible behavior -> source implementation`
- one section comparing official docs to actual repo evidence
- one section identifying what is first-class product surface versus secondary capability
```

- [ ] **Step 2: Write workflows, modes, and plan/governance docs**

These files must explicitly cover:

```md
- normal interactive path
- fast paths
- background / session-resume path
- enterprise or policy-limited path
```

- [ ] **Step 3: Write the three user-role documents**

Each role document must include:

```md
## 目标
## 主要能力
## 关键摩擦
## 关键源码支撑
## 对 Vigilon 的启发
```

The three role files are:

```md
- `users/01-terminal-and-power-users.md`
- `users/02-team-and-enterprise-admins.md`
- `users/03-extension-developers.md`
```

- [ ] **Step 4: Write the journeys and friction document**

Create `users/04-user-journeys-and-friction-points.md` and include these four journey lanes:

```md
- first-run and onboarding
- deep codebase task
- high-risk permissioned operation
- extension / customization workflow
```

- [ ] **Step 5: Link product/user docs into the master index**

Update:

```md
- `docs/superpowers/research/claude-code-library-v2/master-index.md`
- `docs/superpowers/research/claude-code-library-v2/reading-paths.md`
```

to include product-first and user-first navigation blocks.

- [ ] **Step 6: Commit product and user layers**

Use the `git-commit` skill to create a `docs(research)` commit for product and user volumes.

## Task 6: Produce the SVG research diagrams and wire them into the documents

**Files:**
- Create: `docs/superpowers/research/claude-code-library-v2/figures/01-product-surface.svg`
- Create: `docs/superpowers/research/claude-code-library-v2/figures/02-cli-dispatch.svg`
- Create: `docs/superpowers/research/claude-code-library-v2/figures/03-main-bootstrap.svg`
- Create: `docs/superpowers/research/claude-code-library-v2/figures/04-query-kernel.svg`
- Create: `docs/superpowers/research/claude-code-library-v2/figures/05-process-user-input.svg`
- Create: `docs/superpowers/research/claude-code-library-v2/figures/06-tool-use-context.svg`
- Create: `docs/superpowers/research/claude-code-library-v2/figures/07-permission-boundary.svg`
- Create: `docs/superpowers/research/claude-code-library-v2/figures/08-session-lifecycle.svg`
- Create: `docs/superpowers/research/claude-code-library-v2/figures/09-user-roles.svg`
- Create: `docs/superpowers/research/claude-code-library-v2/figures/10-doc-to-runtime-map.svg`

- [ ] **Step 1: Produce the three core runtime diagrams first**

Generate:

```md
- `figures/02-cli-dispatch.svg`
- `figures/03-main-bootstrap.svg`
- `figures/04-query-kernel.svg`
```

with plain white background, academic style, and labels matching source symbols.

- [ ] **Step 2: Produce input, context, and permission diagrams**

Generate:

```md
- `figures/05-process-user-input.svg`
- `figures/06-tool-use-context.svg`
- `figures/07-permission-boundary.svg`
```

and make sure each has a linked explanation paragraph in the corresponding `.md` document.

- [ ] **Step 3: Produce lifecycle, role, and mapping diagrams**

Generate:

```md
- `figures/08-session-lifecycle.svg`
- `figures/09-user-roles.svg`
- `figures/10-doc-to-runtime-map.svg`
```

and reference them from `master-index.md`.

- [ ] **Step 4: Produce the product-surface diagram**

Generate:

```md
- `figures/01-product-surface.svg`
```

and embed or link it from:

```md
- `product/01-positioning-and-surface.md`
- `README.md`
```

- [ ] **Step 5: Validate SVG completeness**

Run:

```bash
find docs/superpowers/research/claude-code-library-v2/figures -name '*.svg' | sort
```

Expected: ten SVG files are listed in numeric order.

- [ ] **Step 6: Commit diagrams**

Use the `git-commit` skill to create a `docs(research)` commit for SVG diagram assets and their document links.

## Task 7: Write the synthesis layer and complete editorial QA

**Files:**
- Create: `docs/superpowers/research/claude-code-library-v2/synthesis/01-design-principles.md`
- Create: `docs/superpowers/research/claude-code-library-v2/synthesis/02-patterns-to-inherit.md`
- Create: `docs/superpowers/research/claude-code-library-v2/synthesis/03-patterns-to-avoid.md`
- Create: `docs/superpowers/research/claude-code-library-v2/synthesis/04-product-opportunities.md`
- Modify: `docs/superpowers/research/claude-code-library-v2/master-index.md`
- Modify: `docs/superpowers/research/claude-code-library-v2/reading-paths.md`
- Modify: `docs/superpowers/research/claude-code-library-v2/evidence/evidence-ledger.md`

- [ ] **Step 1: Write the synthesis documents**

Ensure every synthesis file uses this fixed section pattern:

```md
## 事实前提
## Claude Code 的设计取向
## 值得继承的部分
## 应规避的部分
## 对 Vigilon 的机会点
```

- [ ] **Step 2: Add final reading-path navigation**

Append to `reading-paths.md`:

```md
## 以产品对标为主的路径
## 以源码复现为主的路径
## 以扩展生态研究为主的路径
```

- [ ] **Step 3: Update the evidence ledger to reflect completed volumes**

Append status rows like:

```md
| V2 runtime kernel docs completed | A | `architecture/02-runtime-kernel.md`, `implementation/04-query-loop.md` | N/A | 已完成 |
| V2 mechanism docs completed | A | `mechanisms/*.md` | Official docs registry | 已完成 |
```

- [ ] **Step 4: Run repo-level research QA checks**

Run:

```bash
find docs/superpowers/research/claude-code-library-v2 -name '*.md' | wc -l
find docs/superpowers/research/claude-code-library-v2 -name '*.svg' | wc -l
grep -R "TODO\|TBD\|待定" docs/superpowers/research/claude-code-library-v2 || true
```

Expected:

- markdown count matches the planned document set
- svg count is `10`
- placeholder grep returns no matches

- [ ] **Step 5: Perform manual editorial review**

Review checklist:

```md
- every core document follows the standard template
- every volume links to at least one source file
- every diagram is referenced by at least one document
- product, architecture, user, and implementation layers cross-link
- evidence pages reflect the final document set
```

- [ ] **Step 6: Commit synthesis and QA pass**

Use the `git-commit` skill to create a final `docs(research)` commit for synthesis and editorial QA.

## Task 8: Execution orchestration with subagents

**Files:**
- Modify as needed throughout previous tasks

- [ ] **Step 1: Dispatch the evidence and external-sources subagent**

Subagent brief:

```text
Build the evidence layer and external source registry for Claude Code V2. Return completed markdown files, evidence gaps, and a list of source URLs requiring manual verification.
```

- [ ] **Step 2: Dispatch the runtime-kernel subagent**

Subagent brief:

```text
Write architecture and implementation-core documents for CLI dispatch, QueryEngine, query loop, ToolUseContext, session storage, and API streaming. Every conclusion must cite exact files and symbols.
```

- [ ] **Step 3: Dispatch the mechanism and user/product subagents**

Subagent briefs:

```text
Mechanism subagent: cover tools, skills, hooks, permissions, MCP, tasks, and telemetry with function-level evidence.
User/product subagent: cover product surface, workflows, role-based user analysis, and governance with source back-links.
```

- [ ] **Step 4: Dispatch the diagram and editorial subagents**

Subagent briefs:

```text
Diagram subagent: produce ten SVG research diagrams linked to documents.
Editorial subagent: normalize terminology, verify template compliance, and repair missing cross-links.
```

- [ ] **Step 5: Run two-stage review after every task**

Review rule:

```md
1. Spec compliance review: does the output satisfy the V2 design spec and this plan?
2. Quality review: are the claims specific, sourced, cross-linked, and non-generic?
```

- [ ] **Step 6: Keep commits atomic**

Commit policy:

```md
- one logical layer per commit
- do not mix unfinished SVG drafts with unrelated markdown changes
- use `git-commit` skill rather than raw `git commit`
```

## Self-Review

- Spec coverage: this plan covers scaffolding, evidence, architecture, implementation, mechanisms, product, users, diagrams, synthesis, QA, and subagent orchestration.
- Placeholder scan: no `TODO`, `TBD`, or “implement later” placeholders are used as instructions.
- Type consistency: all document paths and figure names align with the approved V2 design spec and remain stable across tasks.

