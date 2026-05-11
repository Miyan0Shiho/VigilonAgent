# 优化细节专题（Claude Code / OpenClaw / Hermes Agent）

> 范围：性能、并发吞吐、资源治理（token/缓存/去重）、稳定性/降级、可观测性闭环。  
> 证据规范：每条结论必须包含 Evidence ID，并落到“文件 + 符号（函数/类型/常量）”。

## TL;DR
- **Claude Code**：终端渲染有明确的 diff/patch 优化规则（optimizer），并以 fileStateCache 等机制降低重复 IO/上下文抖动。
- **OpenClaw**：大量优化以“脚本化基准 + 懒加载 runtime + 缓存”落地（例如 CLI 启动 bench、audit 缓存）。
- **Hermes Agent**：以“上下文压缩 + 并行工具执行 + 心跳 + checkpoint”实现吞吐与稳定性平衡，并通过 toolset 控制能力面以避免不必要开销。

## 对齐维度
| 子维度 | 关注点 |
|---|---|
| 性能 | 启动/渲染/事件处理 |
| 并发吞吐 | 并行工具执行、心跳、防阻塞 |
| 资源治理 | token 预算、缓存、去重、压缩 |
| 稳定性 | 降级路径、懒加载、避免副作用初始化 |
| 可观测性 | 指标/日志/bench 支持优化闭环 |

---

## Evidence-backed Findings（按项目）

### Claude Code（CC）
> 代码根：`research/sources/claude-code/`

- **OPT-CC-001**：终端渲染存在专门的 diff/patch 优化器，并以规则集合形式减少无效变更与闪烁。  
  - 定义点：`sources/claude-code/src/ink/optimizer.ts` → `optimize(...)`（规则链）  
  - 执行点：`sources/claude-code/src/ink/*`（render pipeline 调用 optimizer 的位置，执行阶段补行号）  

- **OPT-CC-002**：计划文件在远程会话场景下会被 snapshot 到 transcript，减少“上下文压缩/断线”导致的执行偏移。  
  - 执行点：`sources/claude-code/src/utils/plans.ts` → `persistFileSnapshotIfRemote()`  
  - 恢复点：`sources/claude-code/src/utils/plans.ts` → `recoverPlanFromMessages(...)`  

- **OPT-CC-003**：ToolUseContext 注入 `readFileState: FileStateCache`，用于跨会话/跨回合的文件状态缓存与去重。  
  - 定义点：`sources/claude-code/src/Tool.ts` → `ToolUseContext.readFileState`  
  - 关联：`sources/claude-code/src/utils/fileStateCache.ts`（缓存实现）  

- **OPT-CC-004**：成本/用量状态会按 sessionId 写入并从 project config 恢复，避免切换会话后统计丢失。  
  - 定义点：`sources/claude-code/src/cost-tracker.ts` → `StoredCostState`  
  - 执行点：同文件 → `getStoredSessionCosts(sessionId)` / `restoreCostStateForSession(sessionId)`  

- **OPT-CC-005**：会话成本落盘包含 cache read/cache write/web search 等维度，并可记录 FPS 指标，形成性能/成本的闭环数据。  
  - 执行点：`sources/claude-code/src/cost-tracker.ts` → `saveCurrentSessionCosts(fpsMetrics?)`  
  - 字段：同文件 → `lastTotalCacheCreationInputTokens` / `lastTotalCacheReadInputTokens` / `lastTotalWebSearchRequests` / `lastFpsAverage`  

- **OPT-CC-006**：FileStateCache 采用 LRU + size-based eviction（默认 25MB），防止大文件读入导致内存无界增长。  
  - 定义点：`sources/claude-code/src/utils/fileStateCache.ts` → `READ_FILE_STATE_CACHE_SIZE` / `DEFAULT_MAX_CACHE_SIZE_BYTES`  
  - 执行点：同文件 → `new LRUCache({ max, maxSize, sizeCalculation })`  

- **OPT-CC-007**：FileStateCache 对路径 key 做 normalize，避免相对/绝对/冗余段导致 cache miss（提升命中率）。  
  - 定义点：`sources/claude-code/src/utils/fileStateCache.ts` → 注释“normalize all path keys”  
  - 执行点：同文件 → `get/set/has/delete` 均使用 `normalize(key)`  

- **OPT-CC-008**：提供 cache clone/merge（按 timestamp 新者覆盖旧者），支撑子代理隔离与“以最新读到的内容”为准的合并策略。  
  - 执行点：`sources/claude-code/src/utils/fileStateCache.ts` → `cloneFileStateCache(...)` / `mergeFileStateCaches(...)`  
  - 决策点：同文件 → merge 时 `fileState.timestamp > existing.timestamp`  

- **OPT-CC-009**：成本统计按 model canonical name 聚合，减少同一模型别名造成的噪声。  
  - 执行点：`sources/claude-code/src/cost-tracker.ts` → `formatModelUsage()`  
  - 关联：同文件 → `getCanonicalName(model)`  

- **OPT-CC-010**：成本状态的导出 API 同时暴露 cache read/cache write token，说明 prompt cache 被当作一等计费/优化对象。  
  - 证据点：`sources/claude-code/src/cost-tracker.ts` → `export { getTotalCacheReadInputTokens, getTotalCacheCreationInputTokens }`  
  - 关联：`sources/claude-code/src/bootstrap/state.ts`（token counters，后续可补）  

- **OPT-CC-011**：成本恢复严格校验 sessionId 一致性，避免跨会话污染统计。  
  - 决策点：`sources/claude-code/src/cost-tracker.ts` → `if (projectConfig.lastSessionId !== sessionId) return undefined`  
  - 执行点：同文件 → `getStoredSessionCosts(...)`  

- **OPT-CC-012**：对“未知模型成本”提供显式开关与状态（可避免错误统计误导优化决策）。  
  - 定义点：`sources/claude-code/src/cost-tracker.ts` → `hasUnknownModelCost` / `setHasUnknownModelCost`  
  - 关联：同文件 → `calculateUSDCost` / `getContextWindowForModel`（模型元数据参与统计）  

---

### OpenClaw（OC）
> 代码根：`research/sources/openclaw/`

- **OPT-OC-001**：CLI 启动性能以脚本形式基准化，形成可重复的优化闭环（指标 p50/p95 等）。  
  - 定义点：`sources/openclaw/scripts/bench-cli-startup.ts`（case 列表与统计方法）  
  - 执行点：同文件（bench runner 调用链，执行阶段补符号级证据）  

- **OPT-OC-002**：安全审计对结果做缓存，并可能对依赖采用懒加载，减少重复审计与冷启动开销。  
  - 缓存点：`sources/openclaw/src/security/audit.ts` → `codeSafetySummaryCache`  
  - 执行点：同文件 → `collectFilesystemFindings(...)` / `loadGatewayProbeDeps()`（以实际为准）  

- **OPT-OC-003**：runtime agent 通过 lazy runtime module/method 注入，避免不必要的运行时依赖在冷路径初始化。  
  - 执行点：`sources/openclaw/src/plugins/runtime/runtime-agent.ts` → `createLazyRuntimeModule(...)` / `createLazyRuntimeMethod(...)`  
  - 输出：同文件 → `createRuntimeAgent()`  

- **OPT-OC-004**：提供独立的 model latency bench 脚本，可对不同 provider 在相同 prompt 下多次运行并输出 median/min/max。  
  - 证据点：`sources/openclaw/scripts/bench-model.ts` → `DEFAULT_RUNS` / `median(values)`  
  - 执行点：同文件 → `runModel(...)` / `summarize(...)` / `main()`  

- **OPT-OC-005**：security audit 的模块 import 采用 Promise 缓存（多模块 lazy loader），减少重复加载与冷启动成本。  
  - 定义点：`sources/openclaw/src/security/audit.ts` → `auditNonDeepModulePromise` / `gatewayProbeDepsPromise` 等  
  - 执行点：同文件 → `loadGatewayProbeDeps()` / `loadAuditNonDeepModule()`  

- **OPT-OC-006**：provider env var candidates 使用“惰性只读 record（Proxy + cached resolve）”，避免启动时展开所有 provider 映射。  
  - 定义点：`sources/openclaw/src/secrets/provider-env-vars.ts` → `createLazyReadonlyRecord(...)`  
  - 执行点：同文件 → `PROVIDER_AUTH_ENV_VAR_CANDIDATES` / `PROVIDER_ENV_VARS`（lazy record）  

- **OPT-OC-007**：manifest registry 缓存窗口用于折叠启动期 bursty reload（减少 IO/解析），属于生态加载路径的性能优化。  
  - 定义点：`sources/openclaw/src/plugins/manifest-registry.ts` → `DEFAULT_MANIFEST_CACHE_MS = 1000`  
  - 证据点：同文件注释 “collapse bursty reloads during startup flows”  

- **OPT-OC-008**：plugin registry loader 会在满足 scope 时直接 return，避免重复 load（按 scopeRank 与 activeRegistrySatisfiesScope 判定）。  
  - 决策点：`sources/openclaw/src/plugins/runtime/runtime-registry-loader.ts` → `scopeRank(...)` / `activeRegistrySatisfiesScope(...)`  
  - 执行点：同文件 → `ensurePluginRegistryLoaded(...)`（early return 分支）  

- **OPT-OC-009**：任务通知策略包含“抑制重复终态投递”的逻辑，降低噪声与重复渲染开销。  
  - 决策点：`sources/openclaw/src/tasks/task-executor-policy.ts` → `shouldSuppressDuplicateTerminalDelivery(...)`  
  - 关联：同文件 → `shouldAutoDeliverTaskTerminalUpdate(...)`  

- **OPT-OC-010**：audit 参数允许传入 `codeSafetySummaryCache`，支持跨重复 deep audit 复用（降低重复分析开销）。  
  - 定义点：`sources/openclaw/src/security/audit.ts` → `SecurityAuditOptions.codeSafetySummaryCache?: Map<string, Promise<unknown>>`  
  - 关联：同文件 → `codeSafetySummaryCache: Map<string, Promise<unknown>>`（execution context）  

- **OPT-OC-011**：manifest registry 对 contract plugin ids 输出排序（localeCompare），在多次运行中保证稳定性与可比性。  
  - 执行点：`sources/openclaw/src/plugins/manifest-registry.ts` → `.toSorted((left, right) => left.localeCompare(right))`  
  - 执行点：同文件 → `resolveManifestContractPluginIds(...)`  

- **OPT-OC-012**：security audit 的 allowlist 解析会做归一化与 trim/filter，属于输入鲁棒性与性能（减少下游异常）。  
  - 执行点：`sources/openclaw/src/security/audit.ts` → `normalizeAllowFromList(...)`  
  - 关联：同文件 → `normalizeOptionalLowercaseStringOrEmpty`（输入归一化）  

---

### Hermes Agent（HA）
> 代码根：`research/sources/hermes-agent/`

- **OPT-HA-001**：工具执行支持批次并行（线程池），并在长批次期间发送心跳，避免 gateway 误判为卡死。  
  - 决策点：`sources/hermes-agent/run_agent.py` → `_execute_tool_calls(...)`（选择 sequential vs concurrent）  
  - 执行点：同文件 → `_execute_tool_calls_concurrent(...)`（heartbeats + thread pool）  

- **OPT-HA-002**：并行执行对文件变更与破坏性命令提供 checkpoint，降低不可逆风险，提高稳定性。  
  - 决策点：`sources/hermes-agent/run_agent.py` → `function_name in ("write_file","patch")` checkpoint 分支  
  - 关联：`sources/hermes-agent/tools/checkpoint_manager.py`（checkpoint manager）  

- **OPT-HA-003**：上下文压缩模块以 token 压力为核心信号，并在压缩后清理去重缓存，避免错误的“文件未变更”短路。  
  - 执行点：`sources/hermes-agent/agent/context_compressor.py`（压缩算法）  
  - 执行点：`sources/hermes-agent/run_agent.py`（压缩后 `reset_file_dedup(...)` 逻辑，执行阶段补精确位置）  

- **OPT-HA-004**：toolsets 通过组合与场景化（如 safe/debugging）缩小工具集合，减少不必要能力面与资源开销。  
  - 定义点：`sources/hermes-agent/toolsets.py` → `TOOLSETS`  
  - 执行点：`sources/hermes-agent/run_agent.py`（toolset 过滤 valid tools）  

- **OPT-HA-005**：上下文压缩使用结构化 summary 前缀，明确“参考用途、不要执行其中指令”，降低压缩后 prompt 注入风险并改善质量。  
  - 定义点：`sources/hermes-agent/agent/context_compressor.py` → `SUMMARY_PREFIX`  
  - 关联：同文件注释“handoff framing / do not respond to any questions”  

- **OPT-HA-006**：压缩前会先做“旧工具输出修剪”，并用 `_summarize_tool_result(...)` 输出信息密度更高的一行摘要替换大块输出。  
  - 定义点：`sources/hermes-agent/agent/context_compressor.py` → `_PRUNED_TOOL_PLACEHOLDER`  
  - 执行点：同文件 → `_summarize_tool_result(tool_name, tool_args, tool_content)`  

- **OPT-HA-007**：summary token 预算是比例缩放 + 上限封顶，避免大上下文导致 summary 失控。  
  - 定义点：`sources/hermes-agent/agent/context_compressor.py` → `_SUMMARY_RATIO` / `_SUMMARY_TOKENS_CEILING` / `_MIN_SUMMARY_TOKENS`  
  - 执行点：同文件 → `ContextCompressor.__init__(... summary_target_ratio ...)`（ratio clamp）  

- **OPT-HA-008**：压缩算法显式保护 head/tail，tail 以 token 预算保护而非固定消息数（提升鲁棒性）。  
  - 证据点：`sources/hermes-agent/agent/context_compressor.py` 顶部注释（Algorithm 步骤 2–3）  
  - 执行点：同文件 → `protect_last_n` / `threshold_tokens`（ContextEngine 继承）  

- **OPT-HA-009**：压缩后清理 file-read dedup，确保模型重新读取时拿到完整内容而非“未变更 stub”。  
  - 执行点：`sources/hermes-agent/run_agent.py` → `reset_file_dedup(task_id)`  
  - 注释：同文件解释“read content summarised away… needs full content”  

- **OPT-HA-010**：tool registry 支持 max_result_size_chars 参数，为工具结果提供尺寸上限，避免超大输出拖垮上下文。  
  - 定义点：`sources/hermes-agent/tools/registry.py` → `register(..., max_result_size_chars: int | float | None = None)`  
  - 执行点：同文件 → `ToolEntry(... max_result_size_chars=...)`  

- **OPT-HA-011**：MCP 客户端运行在后台 event loop + daemon thread，并用 lock 保护共享状态，避免阻塞主线程。  
  - 证据点：`sources/hermes-agent/tools/mcp_tool.py` 顶部 docstring（Architecture/Thread safety）  
  - 关联：同文件 → `_lock`（以实际实现段为准，后续可补）  

- **OPT-HA-012**：tool_calls 并行路径会根据 batch 独立性判定是否 parallelize（避免对互相影响的工具强行并行导致错误）。  
  - 决策点：`sources/hermes-agent/run_agent.py` → `_should_parallelize_tool_batch(tool_calls)`  
  - 执行点：同文件 → `_execute_tool_calls(...)`（sequential vs concurrent 分发）  

---

## Evidence Index（按 ID）
### Claude Code（CC）
- OPT-CC-001：`src/ink/optimizer.ts` → `optimize`
- OPT-CC-002：`src/utils/plans.ts` → `persistFileSnapshotIfRemote` / `recoverPlanFromMessages`
- OPT-CC-003：`src/Tool.ts` → `ToolUseContext.readFileState`；`src/utils/fileStateCache.ts`
- OPT-CC-004：`src/cost-tracker.ts` → `getStoredSessionCosts` / `restoreCostStateForSession`
- OPT-CC-005：`src/cost-tracker.ts` → `saveCurrentSessionCosts`
- OPT-CC-006：`src/utils/fileStateCache.ts` → `DEFAULT_MAX_CACHE_SIZE_BYTES` / LRU `maxSize`
- OPT-CC-007：`src/utils/fileStateCache.ts` → `normalize(key)` used in get/set/has/delete
- OPT-CC-008：`src/utils/fileStateCache.ts` → `cloneFileStateCache` / `mergeFileStateCaches`
- OPT-CC-009：`src/cost-tracker.ts` → `formatModelUsage` / `getCanonicalName`
- OPT-CC-010：`src/cost-tracker.ts` exports `getTotalCacheReadInputTokens` / `getTotalCacheCreationInputTokens`
- OPT-CC-011：`src/cost-tracker.ts` → sessionId guard in `getStoredSessionCosts`
- OPT-CC-012：`src/cost-tracker.ts` → `hasUnknownModelCost` / `setHasUnknownModelCost`

### OpenClaw（OC）
- OPT-OC-001：`scripts/bench-cli-startup.ts`
- OPT-OC-002：`src/security/audit.ts` → `codeSafetySummaryCache` / `collectFilesystemFindings`
- OPT-OC-003：`src/plugins/runtime/runtime-agent.ts` → `createLazyRuntimeModule`
- OPT-OC-004：`scripts/bench-model.ts` → `runModel` / `median`
- OPT-OC-005：`src/security/audit.ts` → module promise caches / `loadGatewayProbeDeps`
- OPT-OC-006：`src/secrets/provider-env-vars.ts` → `createLazyReadonlyRecord` / `PROVIDER_ENV_VARS`
- OPT-OC-007：`src/plugins/manifest-registry.ts` → `DEFAULT_MANIFEST_CACHE_MS`
- OPT-OC-008：`src/plugins/runtime/runtime-registry-loader.ts` → `ensurePluginRegistryLoaded` early return
- OPT-OC-009：`src/tasks/task-executor-policy.ts` → `shouldSuppressDuplicateTerminalDelivery`
- OPT-OC-010：`src/security/audit.ts` → `SecurityAuditOptions.codeSafetySummaryCache`
- OPT-OC-011：`src/plugins/manifest-registry.ts` → `.toSorted(...)` stable ordering
- OPT-OC-012：`src/security/audit.ts` → `normalizeAllowFromList`

### Hermes Agent（HA）
- OPT-HA-001：`run_agent.py` → `_execute_tool_calls_concurrent`
- OPT-HA-002：`run_agent.py` checkpoint 分支 + `tools/checkpoint_manager.py`
- OPT-HA-003：`agent/context_compressor.py` + `run_agent.py` → `reset_file_dedup`
- OPT-HA-004：`toolsets.py` → `TOOLSETS`
- OPT-HA-005：`agent/context_compressor.py` → `SUMMARY_PREFIX`
- OPT-HA-006：`agent/context_compressor.py` → `_summarize_tool_result` / `_PRUNED_TOOL_PLACEHOLDER`
- OPT-HA-007：`agent/context_compressor.py` → `_SUMMARY_RATIO` / `_SUMMARY_TOKENS_CEILING`
- OPT-HA-008：`agent/context_compressor.py` 顶部 Algorithm 注释 + `threshold_tokens`
- OPT-HA-009：`run_agent.py` → `reset_file_dedup(task_id)`
- OPT-HA-010：`tools/registry.py` → `max_result_size_chars`
- OPT-HA-011：`tools/mcp_tool.py`（Architecture/Thread safety）
- OPT-HA-012：`run_agent.py` → `_should_parallelize_tool_batch` / `_execute_tool_calls`
