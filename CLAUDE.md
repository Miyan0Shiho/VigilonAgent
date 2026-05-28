# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vigilon Agent is an open-source local whiteboard Agent runtime. Two packages in a pnpm monorepo:

- **`packages/runtime`** (`@vigilon/runtime`) — Core agent runtime: CLI, agent loop, tools, session state, memory, compact, permissions, MCP, skills, subagents, LSP integration. Node.js >=22.
- **`packages/tui`** (`@vigilon/tui`) — Terminal operator UI (Ink/React) for inspecting runtime state and running agent turns.

Default model provider is DeepSeek (`deepseek-v4-flash`). Requires `DEEPSEEK_API_KEY` env var.

## Phase 2 Product Direction

Phase 2 重新定义了 Vigilon 的产品核心。三个相互构成的目标：

1. **用户需求感知，主动帮助用户** — Agent 从环境、历史和工作模式中理解用户真正需要什么，不等用户开口
2. **自进化自学习与 Agent 团队** — Agent 从每次交互中学习，Agent 团队协同进化，下一次比上一次更好
3. **Harness 与安全** — Agent 在可信任边界内行动，可审计、可回退、可恢复

这三个目标构成信任三角：感知 → 自进化（知道需要什么才能朝对的方向进化）→ 安全（进化需要安全验证）→ 感知（没有安全边界的感知就是隐私侵犯）。

工程范围被组织为 7 个问题域（详见 `docs/product/phase-2/problem-framework.md`）：

| # | 领域 | 核心冲突 |
|---|------|---------|
| A | 意图理解与适应性引导 | 聊天框假设清晰意图，用户只有模糊愿望 |
| B | 信念、知识与记忆架构 | 知识以相同可信度混在 memory 里 |
| C | 规划与长程连续性 | 上下文死亡时目标和约束不能一起死 |
| D | 自进化与持续学习 | 学到的可能是错的——怎么验证、怎么回退 |
| E | 多 Agent 协作 | 不是"启动更多 worker"，而是治理 O(n²) 复杂度 |
| F | 运行时安全与信任边界 | 安全要有效但不能重到被绕过 |
| G | 行动授权、审计与成本治理 | 谁可以做什么、怎么记录、怎么从事敌中学 |

**当前工程阶段**：P2.5 Runtime Governance（memory runtime、compact runtime、safety/sandbox runtime、subagent/task host runtime）进行中。P2.5 的局部门禁（`pnpm phase2.5:*-probe`）是 Phase 2 认知基础设施的前置工程。

**Phase 2 设计原则**（影响代码决策）：
- **Belief over Text**：Agent 的核心认知单位不是文本，是带 source/evidence/category/expiry 的信念。memory 和 compact 的设计需要为此预留结构。
- **Memory with Ownership**：记忆有 user/project/organization/agent/tool 五层所有权，不是全局 key-value。
- **Trust First, Then Autonomy**：自主性在可信任边界内逐步授予。权限系统需要支持渐进式授权。
- **Evolution with Rollback**：每次行为变化需要可验证、可回退。配置和 prompt 变更需要回归门禁。
- **Friction-Aware Security**：安全检查的假阳性代价可能高于漏过一次攻击。安全需要分级（静默/确认/阻断），不是一律拦截。
- **Model-Aware, Not Model-Locked**：架构需要感知模型特性（context window、capabilities、cost），但不绑定单一模型。

完整产品文档入口：`docs/product/README.md`
对标分析（Codex & Claude Code）：`docs/product/phase-2/competitive-analysis.md`
感知机制调研（Appshots / Computer Use / Chronicle）：`docs/product/phase-2/perception-research.md`

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
