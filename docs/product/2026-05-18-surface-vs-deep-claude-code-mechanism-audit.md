# Surface vs Deep Claude Code Mechanism Audit

- 日期：2026-05-18
- 状态：审计 + 第一处修复已落地
- 范围：`packages/runtime` 当前 P2 实现，对照 `docs/claudecode-research/library/` 和 `packages/claude-code` 的 copy-first 机制目标。
- 结论：当前实现已经覆盖了很多 Claude Code 的能力名目，但仍有几处属于“表层机制复刻”：有工具名、事件名或最小行为，却还没有吃透原机制真正解决的问题、状态流和优势。

## 1. 判断标准

这里不按“有没有这个功能”判断，而按下面三层判断：

1. **表层机制**：Vigilon 有同名工具、同类事件或最小可运行行为。
2. **深层原理**：Vigilon 保留了 Claude Code 这套机制为什么存在，例如 cache stability、context migration、API invariant、operator loop、failure recovery。
3. **优势兑现**：Vigilon 在真实任务中得到对应收益，例如少污染上下文、可恢复、可审计、不中断、可接手。

如果只满足第 1 层，就算“只抄了表层”。

## 2. 已确认的表层复刻点

| 优先级 | 机制 | 当前实现表层 | 缺失的深层机制 / 原理 | 影响 | 本次处理 |
| --- | --- | --- | --- | --- | --- |
| P0 | Auto Compact | 有 `compact-boundary`、`session-memory/reactive/legacy` 策略名，也会自动调用 `compactTranscript()` | Claude Code autocompact 是 context-management 协调器，有 circuit breaker / recursion gate / post-compact cleanup / API invariant 修复；不是“事件数大了就压” | 长会话可能反复 compact，boundary 变成噪音，context 迁移优势被削弱 | 已修第一层熔断：自动 compact 只按“latest boundary 之后的新事件数”触发 |
| P0 | Compact API invariant | `adjustReactiveSplitIndex()` 能避免切开 assistant tool-call group | Claude Code 维护的是更完整的 API invariant：tool_use/tool_result、同一 message streaming block、preserved suffix cursor、post-compact capability replay | 复杂工具链或多 tool-call 仍可能出现恢复语义不足 | 保留为下一步 P2.5 |
| P0 | ToolSearch / deferred tools | 有 `ToolSearch`、`deferred` 标记、`discoveredToolNames`、schema-not-sent recovery | Claude Code 的核心不是“搜索工具”，而是 deferred tools delta + MCP instructions delta + compact-boundary 恢复 + prompt cache stability | 大工具池虽然可按需暴露，但缺少阈值策略、delta attachment、MCP instruction 同步和模型能力 gate | 保留为下一步 P2.7 / P2.8 |
| P1 | Prompt cache / request stability | 有 `llm-request`、`llm-response`、`request-stability` 事件和 schema hash | Claude Code 是两阶段 cache break diagnosis：请求前记录潜在变化，请求后用真实 cache read token 判断，再生成根因 diff | 当前更像请求形状日志，不能解释同名工具 schema 变化、cache_control、model/betas/effort 等细因 | 保留为 P2.8 |
| P1 | LSP / code intelligence | 有 LSP manager、deferred LSP 工具、diagnostics event | Claude Code 的 LSPTool 是 feature gate + runtime health + pending init wait + read permission + didOpen side effect + 10MB budget + passive diagnostics attachment | 当前更接近“有 LSP RPC 面”，还没完全兑现只读权限、健康降级、诊断附着和 deferred readiness 优势 | 保留为 P2.1 |
| P1 | Read/Grep/Glob | 有路径保护、ignore、预算、分页、重复读取 stub | Claude Code 搜索链路把 Glob/Grep/Read 作为 context ingress 协议，模型可消费结果和 UI chrome 分离，读取补充块和去重状态更完整 | 已有基础，但还没证明在陌生仓库里做到“搜得少、读得准、污染低” | 需要真实任务验收 |
| P1 | AskUser | 有 `RuntimeOperator` 和 `AskUserQuestion` 类型 | Claude Code 的 AskUser 是 operator loop：问卷 DSL、preview、permission queue、continuation signal、tool_result 回流 | 目前像类型预留，尚未证明模型会在信息不足时结构化询问并继续执行 | 保留为 P2.3 |
| P1 | TaskStop | 有 `TaskStopTool` 和 `TaskManager.stopTask()` | Claude Code 把 LLM stop、SDK stop、shell/background host kill 收束成共享 bookend/kill path | 当前可停任务，但后台任务终态、噪音控制、transcript bookend 仍需补齐 | 保留为 P2.2 |
| P2 | Notebook | 有 notebook 工具入口 | Claude Code 把 `.ipynb` 当 cell IR，不是 JSON 文本；编辑按 cell id、large-output guard、permission diff 运行 | 若只按 JSON 或粗读写，会丢掉 notebook 的真实优势 | 保留为 P2.3 |
| P2 | ConfigTool | 有配置工具 | Claude Code 是受限 settings registry：source routing、coerce/validate、disk write、immediate runtime effect | 若只是任意改配置文件，会绕过可审计 mutation 边界 | 保留为 P2.9 |

## 3. 本次已经修掉的一个深层偏差

### 3.1 问题

`createVigilonAgentRuntime()` 之前用：

```ts
if (allEvents.length > AUTO_COMPACT_THRESHOLD) {
  await compactTranscript(...)
}
```

这只复刻了“会自动 compact”的表层行为。它没有保留 Claude Code autocompact 的关键原则：自动压缩是长会话后台机制，必须避免重复触发和自我放大。

### 3.2 改进

新增：

- `shouldAutoCompactTranscript(events, { threshold })`
- 判定从“总事件数超过阈值”改成“最新 compact boundary 之后的新事件数超过阈值”
- 测试覆盖：第一次超过阈值会触发；已有 boundary 后不会立刻再次触发；boundary 后继续积累足够新事件才再次触发

对应文件：

- `packages/runtime/src/runtime/compact.ts`
- `packages/runtime/src/runtime/agentLoop.ts`
- `packages/runtime/test/compact.test.ts`

这不是完整复刻 Claude Code 的 autocompact，但已经把当前最危险的表层偏差修到正确方向：compact 从“重复摘要动作”重新变成“有边界的上下文迁移”。

## 4. 下一步改进顺序

### P2.5 Compact / Context Management

继续补：

- auto compact failure counter
- skip gate：compact/query-source/recursive context-management 场景不触发
- compact 后 capability replay 明确化，不只依赖 boundary metadata
- preserved segment metadata：head/anchor/tail 或 Vigilon 等价 cursor
- post-compact cleanup：清理已失效 request/context cache

### P2.7 ToolSearch / MCP Delta

继续补：

- `ToolSearchMode`: always / auto-threshold / standard
- deferred tool delta event，而不是只靠 tool result metadata
- MCP instructions delta event
- compact boundary 恢复 discovered tools 和 MCP instructions
- schema-not-sent recovery 附带可执行修复提示

### P2.8 Request Stability

继续补：

- per-tool schema hash 和 changed-tool schema diff
- system/tool/cache/model 参数的 request lineage
- compact / cache deletion 作为 expected reset
- 若 DeepSeek 无 prompt-cache usage，也要保留本地 request-shape diff 文件

### P2.1 LSP Runtime

继续补：

- LSP runtime health gate
- pending init wait 和失败降级消息
- read permission + ignore + UNC guard + max file size
- `didOpen` side effect 和 passive diagnostics attachment
- LSP unavailable 时的 AST fallback，但不能绕过权限、预算、transcript

## 5. 验收要求

后续每补一个机制，都不要只测“工具能调用”。验收必须包含：

- Claude Code 对照文档和源码路径
- Vigilon 当前状态流
- 权限边界和失败语义
- compact/resume 后是否保持一致
- 一个真实仓库任务中的收益证据

这份审计的核心结论是：P2 不能再用“模块存在”当完成标准。必须按“Claude Code 原机制解决的问题是否在 Vigilon 里同样被解决”来判断。

## 6. 2026-05-19 修复记录

### ToolSearch 从词面发现推进到能力语义发现

边界探针 `搜索项目中 skill 的实现` 暴露了一个具体缺口：模型查询 `language symbols references diagnostics` 时，`ToolSearch` 没有发现 `LSP`，因为旧实现只做 `name/description.includes(query)`。这属于典型表层实现：有 deferred tool 和 schema gate，但模型无法按能力意图找到它。

本次修复：

- `Tool` 增加 `searchTerms`。
- `LSP` 增加 code-intelligence 相关能力词：symbol、definition、references、diagnostics、call hierarchy 等。
- `ToolSearch` 改为按 name、description、schema、searchTerms 做 token 化匹配，并把匹配原因写进 `toolReferenceDeltas`。
- 新增测试覆盖语义查询 `language symbols references diagnostics` 必须 materialize `LSP`。
- 重新运行边界探针后，`LSP schema was materialized through ToolSearch`，原缺口关闭。

新的边界发现是：LSP 被正确发现后，本机调用失败为 `spawn typescript-language-server ENOENT`。这说明下一步应补 Claude Code 式 LSP runtime health / pending init / unavailable fallback，而不是把 LSP 调用存在本身当成完成。

### LSP 从“可发现”推进到可用的生命周期协议

继续沿同一个边界探针追下去后，又暴露了两个更深的偏差：

1. `typescript-language-server` 不在 workspace 依赖中，默认 LSP 配置和实际运行环境不一致。
2. LSP manager 初始化不是幂等的：runtime 创建时会 fire-and-forget 初始化，`runTurn()` 开始又初始化一次，`extensionToServers` 可能保留旧实例；工具实际路由到旧实例，`shutdown()` 只停止 `servers` map 中的新实例，导致 turn 已完成但 `typescript-language-server` / `tsserver` 残留。
3. `LSPTool` 把 `Read` 的 `readFileState` 当成 LSP `didOpen` 状态。复杂任务先 `Read` 了 `skills.ts`，随后 `documentSymbol` 跳过 `didOpen`，结果 LSP 可调用但返回 `No symbols found`。

对照 Claude Code：

- `packages/claude-code/src/services/lsp/manager.ts` 用 singleton + initialization state 防止重复初始化。
- `packages/claude-code/src/services/lsp/LSPServerManager.ts` 单独维护 `openedFiles`，不会把 file-read cache 混同为 LSP-open state。
- `packages/claude-code/src/tools/LSPTool/LSPTool.ts` 在请求前检查权限、文件大小、`didOpen`，再把请求交给 manager。

本次修复：

- root `devDependencies` 增加 `typescript-language-server`，让默认 TypeScript LSP 配置有可执行依赖。
- `LSPServerManager.initialize()` 改成幂等；`shutdown()` 会从 `servers` 和 `extensionToServers` 收集唯一实例，避免旧路由实例逃过 cleanup。
- `LSPClient.stop()` 增加 shutdown timeout、best-effort exit、进程组终止和 process-exit 兜底，避免 LSP 子进程把复杂任务挂住。
- `ToolUseContext` 新增 `lspOpenFileState`，`LSPTool` 按 LSP-open 状态决定是否发送 `textDocument/didOpen`，不再依赖 `Read` cache。
- 新增测试覆盖：重复初始化后路由 server 必须被 shutdown；Read 已缓存文件时 LSP 仍必须发送 `didOpen`；LSP server 不可用时 `documentSymbol` 可降级为文本符号 fallback。

验收结果：

- `pnpm --filter @vigilon/runtime exec vitest run test/lspTool.test.ts test/lspManager.test.ts test/lspClient.test.ts test/agentLoop.test.ts`
- `pnpm --filter @vigilon/runtime typecheck`
- `pnpm phase23:boundary-probe`
- `ps -ef | rg "typescript-language-server|tsserver.js|phase23-boundary-probe|tsx scripts/phase23" || true`

最新边界探针中，`LSP documentSymbol` 对 `packages/runtime/src/runtime/skills.ts` 返回 `buildSkillContent`、`buildSkillListing`、`loadRuntimeSkills` 等 16 个符号；进程表无 `typescript-language-server` / `tsserver` 残留。

### Live CLI 复杂任务：从“工具存在”推进到“边界进入协议”

脚本探针通过后，同一任务用真实 `deepseek-v4-flash` 跑 CLI：

```bash
VIGILON_DISABLE_GLOBAL_SETTINGS=1 pnpm --filter @vigilon/runtime exec tsx src/cli.ts run \
  '搜索项目中 skill 的实现，不搜索 research/.research 等噪音目录，最后给我一个报告' \
  --cwd /Users/liuminxuan/Desktop/Vigilon/VigilonAgent \
  --sessions-dir /Users/liuminxuan/Desktop/Vigilon/VigilonAgent/.vigilon/live-probes/phase23 \
  --permission-mode bypass-local \
  --max-turns 20
```

暴露出的深层问题：

1. `project-config` 事件虽然在 runtime visible events 里，但 DeepSeek adapter 没有把它转成 chat message。fake model 能看到配置，真实模型看不到；这是典型“内部状态存在、实际模型不可用”。
2. 用户请求里的 `不搜索 research/.research` 没有进入工具执行层。模型第一次全局 `Grep` 就把 `.trae/documents`、`docs/archived-research` 等噪音灌进上下文，随后 auto compact 又把噪音固化。
3. `Bash find/ls/grep` 可以绕过 `Grep` / `Glob` 的 project ignore，成为搜索边界旁路。
4. `.vigilon` 历史探针、`.trae` 计划文档、`dist` 生成物会进入搜索结果，说明搜索工具没有默认避开运行时产物和生成目录。
5. 即使边界明显改善后，live run 仍在 16 轮内停在 `max_tokens`，没有 `ResultReport`。最新失败不再主要是噪音目录，而是模型在 Claude Code bundled skill 细节里过度展开，缺少强制收敛/报告交付协议。

本次修复：

- `agentLoop` 从当前 prompt 提取 turn-local ignore：支持 `不搜索` / `排除` / `ignore` / `exclude` 等表达，并把 `research/.research` 扩展为 `research/**`、`.research/**`、`*research*` 类目录匹配。
- 派生后的 `projectConfig` 同时进入工具上下文、模型可见 `project-config` 事件和 request audit。
- DeepSeek adapter 新增 `project-config` 到 chat message 的转换，明确告诉模型 ignored paths/globs 不可搜索、读取、总结。
- `Read`、`Grep`、`Glob`、`Bash` 输出路径都开始执行 project ignore；`Read/Grep/Glob/Bash` 还默认避开 `.vigilon`、`.trae`、`node_modules`、`dist`、`build`、`coverage` 等运行时或生成目录。
- CLI 默认注入 operator guidance：代码搜索优先 `Grep` / `Glob` / `Read` / `LSP`，避免宽泛 Bash 管道；报告类复杂任务结束前应调用 `ResultReport`。CLI runtime 同时打开 `stopAfterResultReport`。

验证：

- `pnpm --filter @vigilon/runtime exec vitest run test/coreTools.test.ts test/executionTools.test.ts test/cli.test.ts test/deepseek.test.ts test/lspTool.test.ts`
- `pnpm --filter @vigilon/runtime typecheck`
- Live transcript:
  `/Users/liuminxuan/Desktop/Vigilon/VigilonAgent/.vigilon/live-probes/phase23/Users-liuminxuan-Desktop-Vigilon-VigilonAgent/live-skill-search-after-default-excludes-1779157330.jsonl`

最新 live 指标：

- 工具调用：`Glob` 9 次、`Bash` 2 次、`Read` 21 次、`Grep` 5 次。
- `research/.research/archived-research/claudecode-research` 噪音提及降到 1 处。
- `.vigilon/.trae/dist` 产物不再主导首轮搜索结果，但仍有一次模型尝试读取 `.vigilon/agents/skill-writer.md`，已补 `Read` 默认拒绝运行时产物路径。
- `ResultReport` 仍为 0；最终 `stopReason=max_tokens`。

结论：这一轮关闭的是“边界约束没有真正进入模型和工具协议”的缺口；没有关闭“复杂任务必须稳定收敛并交付报告”的缺口。下一步要继续对齐 Claude Code 的任务管理/计划/交付协议，不能把当前 live probe 当成完成证据。

### `maxTurns` 从错误默认上限改为显式保护阀

追问“16 轮后没有收敛怎么办”暴露了一个新的对齐偏差：Vigilon 把 `maxTurns` 当成默认任务预算，Claude Code 把它当成可选保护阀。

对照 Claude Code 源码：

- `packages/claude-code/src/QueryEngine.ts` 中 `maxTurns?: number` 是可选参数。
- `packages/claude-code/src/query.ts` 只在 `if (maxTurns && nextTurnCount > maxTurns)` 时触发 `max_turns_reached`。
- 因此 Claude Code 主循环没有“默认 16 轮”这个硬上限；只有调用方显式传入 `maxTurns` 时才会限制。子代理、memory extraction、compact 等内部场景可以有自己的显式上限，但这不是普通任务的默认值。

Vigilon 旧行为：

- `agentLoop` 使用 `options.maxTurns ?? 16`，导致 CLI 普通任务也默认 16 轮停止。
- live probe 的 `ResultReport=0` 和 `stopReason=max_tokens` 被这个默认硬停放大：模型还在阅读时直接终止，没有最后一轮交付协议。
- workbench 也把未设置的 `maxTurns` 显示成 `16`，进一步把错误语义暴露给操作者。

本次修复：

- `agentLoop` 改为 `const maxTurns = options.maxTurns`，循环条件为 `while (!maxTurns || turns < maxTurns)`；未设置时不再有隐式 16 轮上限。
- 不再把 `ResultReport` 当成完成必要条件；自然语言 `end_turn` 是一等 final result，和 Claude Code headless `result` 输出更接近。
- 显式 `maxTurns` 到达时保持 stopped/error-style 语义，不伪造 fallback handoff。
- runtime 增加请求级工具池执行门禁：模型本轮没有看到的工具，即使存在于全局 registry，也不能执行。非 deadline 场景仍保留 deferred tool 的 `Call ToolSearch first` recovery。
- DeepSeek adapter 增加 `toolChoice` 映射和不兼容降级：如果 specific function `tool_choice` 被后端拒绝，会重试为 `auto`，但主循环不依赖它来强制交付。
- CLI operator guidance 明确：“There is no fixed default turn limit”。
- workbench 显示从 `maxTurns=16` 改为 `maxTurns=unbounded`。
- runtime final report 增加 `warnings`：自然语言结束仍是一等完成结果，但如果 todo 未完成或已批准计划缺少验证记录，会在报告和 workbench 中显式暴露，不再用 fallback handoff 伪装完成。
- runtime 每次模型请求前注入轻量 `<vigilon_runtime_progress>`：包含未完成 todo、批准/待批准计划和验证记录。这样进度状态不只藏在历史工具结果或最终 warning 里，而是在下一轮推理时持续可见，帮助复杂任务向当前 in-progress/pending 项收敛。

验证：

- `pnpm --filter @vigilon/runtime exec vitest run test/agentLoop.test.ts test/deepseek.test.ts`
- `pnpm --filter @vigilon/runtime typecheck`
- `pnpm --filter @vigilon/runtime test`
- Live transcript:
  `/Users/liuminxuan/Desktop/Vigilon/VigilonAgent/.vigilon/live-probes/phase23/Users-liuminxuan-Desktop-Vigilon-VigilonAgent/live-skill-search-after-toolchoice-fallback-1779158985.jsonl`

新增测试覆盖：

- 未设置 `maxTurns` 时，模型可以跑过旧的第 16 轮隐式上限并在第 17 轮正常结束。
- 显式 `maxTurns=2` 时，最后一轮不会被强制收窄到 `ResultReport`，模型自然语言结束即 completed。
- 显式 `maxTurns` 到达且模型仍持续调用工具时，结果保持 `status=stopped`，不会生成 fallback handoff。
- `stopAfterResultReport` 模式下，模型自然语言结束仍是 final result；`ResultReport` 是可选结构化审计增强，不是完成条件。
- 自然语言结束但 todo 未完成时，结果保持 `completed`，同时报告 `warnings`，用于暴露“看似结束但任务状态未闭合”的深层问题。
- TodoWrite 后的下一次模型请求包含 `<vigilon_runtime_progress>`，列出当前 `in_progress` / `pending` todo，并提醒不要在未完成 todo 存在时直接 final answer，除非明确报告 blocker 或任务范围变化。
- DeepSeek 拒绝 specific `tool_choice` 时，adapter 会降级重试 `auto`。

最新 live 指标：

- 请求数 / 响应数：15 / 15。
- 最后一轮 `llm-response.stopReason=end_turn`，`toolCallCount=0`，模型以自然语言结束。
- 最终 `status=completed`，但没有结构化 `handoffReport`；这与 Claude Code 的 headless result 更接近，也暴露出另一个产品问题：当前 CLI 输出可能回答偏题，且 todo 未完成时仍可自然语言结束。

结论：16 轮不是 Claude Code 的普通任务默认值，而是 Vigilon 自己引入的错误硬停。复杂任务不收敛时，正确方向不是默认截断，而是：

1. 默认允许继续，直到模型完成或用户/系统显式限制。
2. 显式限制存在时，到达上限应明确 stopped，而不是伪造成 completed handoff。
3. 自然语言 final result 要成为 first-class 结果；结构化报告可以作为审计增强，但不能是主循环完成的脆弱依赖。
4. 后续要继续补计划/进度/任务完成判断，让模型更早收敛到正确答案，而不是靠默认轮数或 fallback 报告硬切。

仍未关闭的问题：真实模型仍可能自然语言结束但偏离原任务；当前只把 todo/plan/verification 进度持续放回模型上下文，并在最终报告暴露 warning，还没有证明 live 模型在复杂任务中稳定收敛。下一步重点应转向工具输出聚焦、结果判定和 operator-visible progress 的 live 验证，而不是继续堆 `ResultReport` 兜底。
