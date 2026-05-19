# Phase 2 Claude Code Coverage Audit

- 日期：2026-05-18
- 状态：Phase 2 文档反查审计
- 结论：原 `2026-05-18-phase-2-core-capability-alignment.md` 不能直接声称已经覆盖 Claude Code 核心能力对齐。它覆盖了主链，但把若干关键机制压成了过粗的词，漏掉了 LSP/code intelligence、LLM transport、tool search/deferred tools、prompt cache stability、AskUser、TaskStop、WebFetch、Notebook 和更完整的 compact runtime。

## 1. 审计方法

本次审计不是从 Vigilon 现有实现出发，而是从 Claude Code 研究文档反查 Phase 2 是否有能力门禁。

重点反查材料：

- `docs/claudecode-research/library/master-index.md`
- `docs/claudecode-research/library/implementation/03-query-loop-and-recovery.md`
- `docs/claudecode-research/library/implementation/04-session-storage-and-resume.md`
- `docs/claudecode-research/library/commands/07-memory-skills-plan-tasks-and-compact.md`
- `docs/claudecode-research/library/mechanisms/02-tool-pool-and-tool-use-context.md`
- `docs/claudecode-research/library/mechanisms/23-permission-runtime-hooks-classifier-and-dialog-pipeline.md`
- `docs/claudecode-research/library/mechanisms/25-api-request-streaming-retry-and-telemetry.md`
- `docs/claudecode-research/library/mechanisms/26-prompt-cache-break-detection-and-stability-auditing.md`
- `docs/claudecode-research/library/mechanisms/28-tool-search-deferred-tools-and-mcp-instruction-deltas.md`
- `docs/claudecode-research/library/mechanisms/63-session-memory-compaction-autocompact-and-post-compact-restoration-runtime.md`
- `docs/claudecode-research/library/mechanisms/68-ask-user-question-schema-preview-and-operator-loop-runtime.md`
- `docs/claudecode-research/library/mechanisms/74-webfetch-tool-domain-gates-redirects-and-secondary-model-runtime.md`
- `docs/claudecode-research/library/mechanisms/79-taskstop-tool-stoptask-shared-kill-path-and-sdk-bookend-runtime.md`
- `docs/claudecode-research/library/mechanisms/80-lsp-tool-initialization-deferred-loading-and-diagnostic-attachment-runtime.md`
- `docs/claudecode-research/library/mechanisms/85-toolsearch-tool-deferred-discovery-tool-reference-and-schema-recovery-runtime.md`
- `docs/claudecode-research/library/mechanisms/89-notebookedit-tool-cell-identity-json-materialization-and-permission-diff-runtime.md`
- `docs/claudecode-research/library/mechanisms/90-notebook-read-toolresult-blocks-large-output-guard-and-cell-id-runtime.md`

## 2. 原 Phase 2 文档的主要缺口

| 缺口 | 为什么是核心能力 | 原文档问题 | Phase 2 修正方向 |
| --- | --- | --- | --- |
| LLM transport kernel | Claude Code 的 API 层负责 tool schema 编译、message normalization、streaming 组包、retry/fallback、context overflow 修正、usage/cost/tracing | 原文档只讲 agent loop，没有把 API transport 当 runtime 核心 | 增加 `LLM Transport / Streaming / Retry` 门禁 |
| ToolSearch / deferred tools | Claude Code 用 deferred tools、`tool_reference`、delta attachment、schema-not-sent recovery 控制动态工具池和 prompt cache | 原文档只写 MCP dynamic tool synthesis，没有覆盖 tool discovery 协议 | 增加 `Deferred Tool Discovery` 门禁 |
| Prompt cache stability | Claude Code 有 prompt cache break detection，按 querySource/agentId 跟踪 system/tool/cache_control/model/betas 等变化 | 原文档没有 cache stability 概念 | 增加 `Prompt Cache / Request Stability` 门禁 |
| LSP / code intelligence | Claude Code 的 LSPTool 是延迟可用、只读、权限检查、结果清洗、被动 diagnostics 附着的代码智能 runtime | 原文档只写 Grep/Glob/Read，没有结构化代码智能 | 增加 `LSP / Structural Code Intelligence` 门禁 |
| AST 工具边界 | 研究文档未显示 Claude Code 有独立 ASTTool；对应能力更接近 LSP/documentSymbol/workspaceSymbol/callHierarchy/passive diagnostics | 用户预期里的 AST 不能凭空写成 Claude Code 原生机制 | 写清：Claude parity 先 LSP；Vigilon 可用 AST/tree-sitter 作为本地 fallback，但必须服从 LSP/code-intelligence 语义 |
| Compact 三路径 | Claude Code `/compact` 是 session-memory -> reactive -> legacy 的策略路由，带 autocompact circuit breaker、API invariant 修复、post-compact cleanup | 原文档只写 compact boundary/post-compact restoration，过粗 | 增加 context-management 子系统门禁 |
| AskUserQuestion | Claude Code 不是简单问答，而是 operator loop runtime：问卷 DSL、preview、permission queue、continuation signal | 原文档没有人机澄清工具 | 增加 `Operator Clarification / AskUser` 门禁 |
| TaskStop / background kill path | Claude Code 把 LLM stop、SDK stop、task host kill 收束到共享 stopTask 语义 | 原文档只有 interrupt/timeout，没有后台任务停止协议 | 增加 `TaskStop / Abort / Background Task Control` 门禁 |
| WebFetch | Claude Code 的 WebFetch 有 domain gate、redirect policy、preflight、cache、markdown transform、secondary model summary | 原文档未覆盖网络读取工具边界 | P2 可做 solo public WebFetch，或明确延期；不能假装已对齐 |
| Notebook | Claude Code 对 `.ipynb` 有结构化 read/edit、cell identity、large-output guard、permission diff | 原文档只覆盖文本文件 | P2 需至少定义 notebook parity 是否 must-have；若目标是 coding parity，建议纳入 P2 |
| ConfigTool / runtime settings mutation | Claude Code 有受限 settings tool，支持 source routing、coerce、validate、disk write、immediate AppState effect | 原文档只有 settings/project config，没有 tool 化修改语义 | 增加 `Config / Runtime Mutation` solo-simplified 门禁 |
| Tool pool ordering and cache stability | built-in tools contiguous prefix 是 prompt cache 稳定性的一部分 | 原文档只说统一 registry | 加入 tool pool ordering / schema stability 要求 |

## 3. 多轮审查结论

### 第一轮：核心 runtime 主链

原 Phase 2 覆盖了：

- Query loop / ToolUseContext
- Read / Grep / Glob
- Edit / Write / Bash
- Plan / Todo
- Transcript / Resume / Compact
- Memory / Skill / MCP / Hook
- Subagent foundation

这足以作为 P2 草案，但不足以称为彻底对齐。

### 第二轮：上下文与工具池

Claude Code 的上下文系统不是只有 compact：

- API 请求前会过滤工具、修补 message、处理 tool search、维护 cache policy。
- deferred tools 和 MCP instructions 通过 attachment delta 持久进入会话。
- compaction 后要恢复 discovered tools、MCP instructions、agent listing 等 capability announcements。
- prompt cache stability 有在线审计和 diff 文件。

原 Phase 2 文档没有把这些列成验收项。

### 第三轮：代码智能

Claude Code 研究文档里没有发现独立的 `ASTTool` 作为原生命名机制。对应的核心能力是：

- `LSPTool`
- `documentSymbol`
- `workspace/symbol`
- `goToDefinition`
- `findReferences`
- `goToImplementation`
- `incomingCalls / outgoingCalls`
- passive diagnostics attachments

所以 Phase 2 不应该写“复刻 ASTTool”。更准确的要求是：

- 复刻 Claude Code 的 LSP/code-intelligence runtime。
- Vigilon 可以用 AST/tree-sitter/ts-morph 做 fallback 或索引加速，但不能绕过 read permission、ignore、budget、transcript、deferred loading 和 diagnostics attachment 语义。

### 第四轮：工具族缺口

若目标是 Claude Code coding parity，P2 不能只做文本仓库：

- WebFetch 是调研和文档读取的核心工具。
- Notebook read/edit 是 Python/数据科学仓库的真实 coding surface。
- AskUserQuestion 是模型澄清需求的 operator loop。
- TaskStop 是长任务和后台任务的控制协议。
- ConfigTool 是受限运行时设置 mutation 面。

这些至少要在 Phase 2 中明确：must-have、solo-simplified、或显式延期。不能隐身。

## 4. 修正文档原则

Phase 2 文档必须从“能力清单”升级成“Claude Code core coverage gate”：

1. 每个 P2 子任务必须先写 Claude Code 对照文档。
2. 每个能力必须说明是否属于 must-align、solo-simplified 或 explicit-deferred。
3. 如果 Claude Code 有机制而 Vigilon P2 不做，必须写清楚延期原因。
4. 如果 Vigilon 用不同实现方式，例如 AST fallback，必须证明行为语义仍对齐 Claude Code。
5. 验收任务必须覆盖代码智能、上下文压缩、deferred tools、WebFetch/Notebook/AskUser/TaskStop 中至少一组真实场景。
