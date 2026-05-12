# Claude Code V2 总索引

## 问题导航

| 问题 | 当前入口文档 | 关键源码 | 证据页 | 备注 |
| --- | --- | --- | --- | --- |
| Claude Code 的产品表面到底是不是单一 TUI？ | [README.md](./README.md) | `packages/claude-code/src/entrypoints/cli.tsx`, `packages/claude-code/src/main.tsx` | [evidence-ledger.md](./evidence/evidence-ledger.md) | 当前证据显示它是多路 fast-path + 完整主程序的组合 |
| 一个 prompt 从输入到 query loop 之前经历了什么？ | [reading-paths.md](./reading-paths.md) | `packages/claude-code/src/QueryEngine.ts`, `packages/claude-code/src/utils/processUserInput/processUserInput.ts` | [function-index.md](./evidence/function-index.md) | 已确认输入预处理、hooks、slash command 与 transcript 提前写入 |
| agent loop 的核心复杂度在哪里？ | [reading-paths.md](./reading-paths.md) | `packages/claude-code/src/query.ts` | [function-index.md](./evidence/function-index.md) / [variable-state-index.md](./evidence/variable-state-index.md) | 当前主复杂度落在 `query()` / `queryLoop()` |
| Tool / Skill / MCP / 权限是怎样汇流的？ | [glossary.md](./glossary.md) | `packages/claude-code/src/Tool.ts`, `packages/claude-code/src/tools.ts`, `packages/claude-code/src/services/mcp/**`, `packages/claude-code/src/skills/**` | [source-to-doc-map.md](./evidence/source-to-doc-map.md) | V2 正文尚未展开，先用证据页定位 |
| 会话恢复依赖什么持久化结构？ | [reading-paths.md](./reading-paths.md) | `packages/claude-code/src/utils/sessionStorage.ts`, `packages/claude-code/src/utils/sessionRestore.ts` | [evidence-ledger.md](./evidence/evidence-ledger.md) / [variable-state-index.md](./evidence/variable-state-index.md) | 当前证据显示 JSONL transcript 是主底座 |
| 哪些地方适合插桩和性能分析？ | [README.md](./README.md) | `packages/claude-code/src/utils/queryProfiler.ts`, `packages/claude-code/src/utils/startupProfiler.ts`, `packages/claude-code/src/services/api/claude.ts` | [source-to-doc-map.md](./evidence/source-to-doc-map.md) | 已有 profiling，不是从零开始 |

## 文档导航

### 当前已存在入口

| 状态 | 文档 | 作用 |
| --- | --- | --- |
| 已存在 | [architecture/01-04.md](./architecture/01-04.md) | 架构综合卷，涵盖入口、内核、状态与 UI |
| 已存在 | [implementation/01-08.md](./implementation/01-08.md) | 实现综合卷，涵盖输入处理、循环、存储、API 与任务 |
| 已存在 | [README.md](./README.md) | 研究库定位、边界、当前基线与缺口 |
| 已存在 | [reading-paths.md](./reading-paths.md) | 人类阅读与 agent 调研路径 |
| 已存在 | [glossary.md](./glossary.md) | V2 统一术语表 |
| 已存在 | [evidence/evidence-ledger.md](./evidence/evidence-ledger.md) | 关键结论、证据等级、状态与缺口 |
| 已存在 | [evidence/doc-to-source-map.md](./evidence/doc-to-source-map.md) | V2 目标文档到源码入口的映射 |
| 已存在 | [evidence/source-to-doc-map.md](./evidence/source-to-doc-map.md) | 源码入口到 V2 文档的映射 |
| 已存在 | [evidence/function-index.md](./evidence/function-index.md) | 函数级观察点 |
| 已存在 | [evidence/variable-state-index.md](./evidence/variable-state-index.md) | 状态与关键变量索引 |
| 已存在 | [evidence/external-sources.md](./evidence/external-sources.md) | 官方资料、旧稿与社区资料登记 |
| 已存在 | [users/04.md](./users/04.md) | 集成商与自动化流水线画像 |
| 已存在 | [synthesis/01-04.md](./synthesis/01-04.md) | 01-04 画像模式、规避项与机会点提炼 |
| 已存在 | [../figures/index.md](../figures/index.md) | 图谱索引初稿 |

### 当前规划卷册

以下条目当前尚未创建 `.md` 文件，只在映射页保留规划位。

| 状态 | 规划卷册 | 说明 |
| --- | --- | --- |
| 规划中 | `architecture/01-entrypoints-and-bootstrap.md` | CLI 入口与 `main.tsx` 装配图 |
| 规划中 | `architecture/02-runtime-kernel.md` | `QueryEngine`、`query.ts`、`Tool.ts` 运行时内核 |
| 规划中 | `implementation/01-cli-dispatch-and-fast-paths.md` | CLI fast-path 分发实现 |
| 规划中 | `implementation/02-process-user-input.md` | 输入预处理与 slash command |
| 规划中 | `implementation/06-session-storage-and-resume.md` | transcript、resume 与恢复边界 |
| 规划中 | `mechanisms/05-mcp-and-plugin-boundary.md` | MCP、plugins 与权限边界 |
| 规划中 | `mechanisms/06-subagents-tasks-and-sessions.md` | tasks、agents 与 session 生命周期 |
| 规划中 | `mechanisms/07-observability-and-telemetry.md` | profiling、logging、tracing |

## 图谱导航

| 状态 | 图谱文档或资产 | 说明 |
| --- | --- | --- |
| 已存在 | [../figures/index.md](../figures/index.md) | 汇总当前仓库中已存在的 SVG 图谱资产 |
| 已存在 | [architecture-claude-code.svg](../figures/architecture-claude-code.svg) | Claude Code 架构图 |
| 已存在 | [planner-executor-sequence.svg](../figures/planner-executor-sequence.svg) | planner/executor 序列图 |
| 规划中 | `QueryEngine -> query()` 主链图 | 需与 V2 文档建立双向回链 |
| 规划中 | `session lifecycle` 图 | 需覆盖 transcript / subagent / resume |

## 源码导航

### 一等入口

- `packages/claude-code/src/entrypoints/cli.tsx`
- `packages/claude-code/src/main.tsx`
- `packages/claude-code/src/QueryEngine.ts`
- `packages/claude-code/src/query.ts`
- `packages/claude-code/src/Tool.ts`
- `packages/claude-code/src/tools.ts`

### 二等入口

- `packages/claude-code/src/utils/processUserInput/processUserInput.ts`
- `packages/claude-code/src/utils/sessionStorage.ts`
- `packages/claude-code/src/utils/sessionRestore.ts`
- `packages/claude-code/src/services/api/claude.ts`
- `packages/claude-code/src/services/mcp/**`
- `packages/claude-code/src/tasks/**`
- `packages/claude-code/src/skills/**`
- `packages/claude-code/src/utils/queryProfiler.ts`
- `packages/claude-code/src/utils/startupProfiler.ts`

## 证据导航

### A 级优先阅读

- [evidence/evidence-ledger.md](./evidence/evidence-ledger.md) 中关于 CLI 分发、query loop、ToolUseContext、JSONL transcript、profiling 的条目。
- [evidence/function-index.md](./evidence/function-index.md) 中关于 `main()`、`submitMessage()`、`processUserInput()`、`query()`、`queryLoop()` 的条目。
- [evidence/variable-state-index.md](./evidence/variable-state-index.md) 中关于 `State`、`mutableMessages`、`messages`、`toolUseContext` 的条目。

### 当前最值得继续深挖的缺口

- `services/mcp/**` 如何在 REPL 与 headless 两种上下文中合流。
- `tasks/**`、`AgentTool/**`、background session 与 transcript 之间的生命周期关系。
- `main.tsx` 中 settings/policy/plugins/skills/LSP 的真实初始化依赖顺序。
