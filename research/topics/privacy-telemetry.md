# 隐私 / 遥测 / 数据治理专题（Claude Code / OpenClaw / Hermes Agent）

> 范围：事件采集与管道（队列/flush/失败容错）、PII/敏感字段治理（脱敏/清洗/白名单）、开关与默认策略（opt-in/out、killswitch）、密钥与日志交叉治理（credential stripping/safe env）、数据留存与落盘（若能从源码/配置落证据）。  
> 证据规范：每条结论必须包含 Evidence ID（PRI-CC/OC/HA-###），并落到“文件 + 符号（函数/类型/常量）”；证据类型标注 CODE/TEST/CONFIG。

## TL;DR
- **Claude Code**：analytics 管道模块化（sink/metadata/killswitch），并配套 sanitization 与错误上报边界。
- **OpenClaw**：诊断/遥测能力与插件 SDK、usage 聚合与 secrets 体系交叉，偏工程化与可插拔。
- **Hermes Agent**：MCP 层已有 credential stripping/safe env 等安全治理；insights/analytics 页面体现数据汇聚与展示链路。

## 对齐维度
| 子维度 | 关注点 |
|---|---|
| 采集与管道 | queue/flush、失败处理、采样 |
| PII/清洗 | 脱敏策略、字段白名单/黑名单 |
| 开关与默认 | opt-in/out、killswitch、essential-only |
| 密钥交叉治理 | safe env、credential stripping、SecretRef |
| 留存与删除 | TTL/导出/删除（能落证据则写） |

---

## Evidence-backed Findings（按项目）

### Claude Code（CC）
> 代码根：`research/sources/claude-code/`

- **PRI-CC-001（CODE）**：Analytics 模块刻意“零依赖”，避免 import cycle；事件在 sink attach 前进入队列，降低初始化顺序导致的数据泄漏与崩溃风险。  
  - 证据：`sources/claude-code/src/services/analytics/index.ts` 头部注释（NO dependencies / queued until attach）

- **PRI-CC-002（CODE）**：sink attach 后以 `queueMicrotask` 异步 drain 队列，避免启动路径增加延迟；并且 attach 是幂等，允许多入口调用。  
  - 证据：`sources/claude-code/src/services/analytics/index.ts` → `attachAnalyticsSink(...)`：`queueMicrotask` + “Idempotent”注释

- **PRI-CC-003（CODE）**：`logEvent` 的 metadata 类型禁止 string（只允许 boolean/number/undefined），把“误记录代码/文件路径”在类型层面堵死。  
  - 证据：`sources/claude-code/src/services/analytics/index.ts` → `type LogEventMetadata = { [key: string]: boolean | number | undefined }` + 参数注释 “intentionally no strings”

- **PRI-CC-004（CODE）**：对确需 string 的场景引入“强制人工验签 marker type”（非代码/文件路径）与“PII-tagged” marker type，提升敏感数据进入遥测的显式性。  
  - 证据：`sources/claude-code/src/services/analytics/index.ts` → `AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` / `..._I_VERIFIED_THIS_IS_PII_TAGGED`

- **PRI-CC-005（CODE）**：PII 路由使用 `_PROTO_*` 键，且通过 `stripProtoFields` 一次性在非 1P sink 前剥离，避免“某个 sink 忘记过滤”导致泄露。  
  - 证据：`sources/claude-code/src/services/analytics/index.ts` → `stripProtoFields(...)` + 注释 “single stripProtoFields call guards all non-1P sinks”

- **PRI-CC-006（CODE）**：`stripProtoFields` 在无 `_PROTO_` key 时返回原引用（不拷贝），降低遥测路径的额外分配与性能开销。  
  - 证据：`sources/claude-code/src/services/analytics/index.ts` → `return result ?? metadata`

- **PRI-CC-007（CODE）**：遥测支持“采样配置”且采样率会写入 metadata（为隐私与成本做 gating 的设计点）。  
  - 证据：`sources/claude-code/src/services/analytics/index.ts` 注释：`tengu_event_sampling_config` + `sample_rate` 注入说明

- **PRI-CC-008（TEST）**：提供 `_resetForTesting` 清空 sink 与队列，保证测试环境不产生真实遥测副作用。  
  - 证据：`sources/claude-code/src/services/analytics/index.ts` → `_resetForTesting()`

- **PRI-CC-009（CODE）**：Unicode sanitization 常开（always enabled），用于缓解“隐藏字符/不可见指令注入”（含外部漏洞背景说明）。  
  - 证据：`sources/claude-code/src/utils/sanitization.ts` 头部注释（always enabled；attack description）

- **PRI-CC-010（CODE）**：sanitization 采用 NFKC 归一化 + 移除 `\p{Cf}\p{Co}\p{Cn}`，并提供危险区间 fallback（零宽/方向控制/私用区）。  
  - 证据：`sources/claude-code/src/utils/sanitization.ts` → `partiallySanitizeUnicode()`：`normalize('NFKC')` + regex + 显式 ranges

- **PRI-CC-011（CODE）**：sanitization 有 `MAX_ITERATIONS` 上限并在异常输入时 fail-loud，避免无限循环与静默绕过。  
  - 证据：`sources/claude-code/src/utils/sanitization.ts` → `MAX_ITERATIONS = 10` + `throw new Error(...)`

- **PRI-CC-012（CODE）**：提供递归 sanitization（字符串/数组/对象），同时 sanitizes object keys，降低“键名注入”带来的隐蔽风险。  
  - 证据：`sources/claude-code/src/utils/sanitization.ts` → `recursivelySanitizeUnicode(...)`（overloads + `Object.entries` 对 key/value 递归）

---

### OpenClaw（OC）
> 代码根：`research/sources/openclaw/`

- **PRI-OC-001（CODE）**：diagnostics-otel 插件 SDK 表面被显式“收窄导出”，并包含 `redactSensitiveText` 与日志/事件 hook，体现遥测扩展面的边界治理。  
  - 证据：`sources/openclaw/src/plugin-sdk/diagnostics-otel.ts` → re-export 列表（`emitDiagnosticEvent/onDiagnosticEvent/registerLogTransport/redactSensitiveText`）

- **PRI-OC-002（CODE）**：redaction 模式是强类型枚举（`off|tools`），默认对工具输出做脱敏，避免默认暴露 secrets。  
  - 证据：`sources/openclaw/src/logging/redact.ts` → `export type RedactSensitiveMode = "off" | "tools"` + `DEFAULT_REDACT_MODE = "tools"`

- **PRI-OC-003（CODE）**：默认脱敏 patterns 覆盖 ENV-style assignments、JSON 字段、CLI flags、Authorization headers、PEM blocks 与常见 token 前缀（sk-/ghp_/xoxb- 等）。  
  - 证据：`sources/openclaw/src/logging/redact.ts` → `DEFAULT_REDACT_PATTERNS[]`

- **PRI-OC-004（CODE）**：pattern 解析强制全局匹配（补 g flag），并支持 `/re/flags` 与 config-regex 编译，降低“用户配置 regex 不可用”风险。  
  - 证据：`sources/openclaw/src/logging/redact.ts` → `parsePattern(...)`：`if (!raw.flags.includes("g")) ...`；`compileConfigRegex(...)`

- **PRI-OC-005（CODE）**：token mask 保留前 6 后 4（长度不足则 `***`），在可读性与安全性间做折中。  
  - 证据：`sources/openclaw/src/logging/redact.ts` → `DEFAULT_REDACT_KEEP_START/END/MIN_LENGTH` + `maskToken(...)`

- **PRI-OC-006（CODE）**：对 PEM 私钥块做“仅保留头尾行”的块级脱敏，支持多行模式。  
  - 证据：`sources/openclaw/src/logging/redact.ts` → `redactPemBlock(...)` + `if (match.includes("PRIVATE KEY-----"))`

- **PRI-OC-007（CODE）**：redaction 默认从配置读取（`config.js`），读取失败也会 graceful degrade（不抛错），避免日志系统导致启动失败。  
  - 证据：`sources/openclaw/src/logging/redact.ts` → `resolveConfigRedaction()`：try/catch + `loadConfig()?.logging`

- **PRI-OC-008（CODE）**：`redactSensitiveLines` 先 join 再 redact 再 split，允许跨行 pattern（PEM）匹配；且 options 只解析一次，避免逐行重复解析。  
  - 证据：`sources/openclaw/src/logging/redact.ts` → `redactSensitiveLines(lines, resolved)` 注释与实现

- **PRI-OC-009（CODE）**：secrets 解析采用“赋值收集器”模型：对 provider apiKey/headers/request、skill apiKey 等字段逐一调用 `collectSecretInputAssignment` 并写回，支持 active/inactive reason。  
  - 证据：`sources/openclaw/src/secrets/runtime-config-collectors-core.ts` → `collectModelProviderAssignments(...)` / `collectSkillAssignments(...)`（`active`、`inactiveReason`、`apply`）

- **PRI-OC-010（CODE）**：对 agents memorySearch 的 remote apiKey，有“默认值仅在需要时激活”的判定逻辑（若所有 enabled agent 都 override 则 defaults inactive）。  
  - 证据：`sources/openclaw/src/secrets/runtime-config-collectors-core.ts` → `collectAgentMemorySearchAssignments(...)`：`hasEnabledAgentWithoutOverride` + `inactiveReason`

- **PRI-OC-011（CODE）**：gateway secrets（token 等）的 active/inactive 由“gateway auth surface state”计算得出（按环境与默认值决策），避免无效 secrets 被误解析/误上报。  
  - 证据：`sources/openclaw/src/secrets/runtime-config-collectors-core.ts` → `evaluateGatewayAuthSurfaceStates(...)` + `active: gatewaySurfaceStates["gateway.auth.token"].active`

- **PRI-OC-012（CODE）**：usage 聚合输出对 `dailyLatency/modelDaily/daily` 使用稳定排序（按 date/cost），确保分析结果可比、可复盘。  
  - 证据：`sources/openclaw/src/shared/usage-aggregates.ts` → `buildUsageAggregateTail(...)`：`.toSorted((a,b)=>a.date.localeCompare(b.date))` / `b.cost - a.cost`

---

### Hermes Agent（HA）
> 代码根：`research/sources/hermes-agent/`

- **PRI-HA-001（CODE）**：MCP stdio 子进程 env 采用白名单过滤，仅允许 `_SAFE_ENV_KEYS`（及 XDG_ 前缀）通过，降低凭据泄露到扩展子进程的风险。  
  - 证据：`sources/hermes-agent/tools/mcp_tool.py` → `_SAFE_ENV_KEYS` / `_build_safe_env(user_env)`

- **PRI-HA-002（CODE）**：MCP 错误在返回 LLM 前会做 credential stripping，把 token/key 等替换为 `[REDACTED]`。  
  - 证据：`sources/hermes-agent/tools/mcp_tool.py` → `_CREDENTIAL_PATTERN` / `_sanitize_error(text)`

- **PRI-HA-003（CODE）**：MCP 工具/服务器命名会做 component sanitization，避免把不安全字符串注入工具名/日志/协议层。  
  - 证据：`sources/hermes-agent/tools/mcp_tool.py` → `sanitize_mcp_name_component(value)`

- **PRI-HA-004（CODE）**：MCP 的多处返回路径会统一调用 `_sanitize_error(...)`（包括 tool_result content 与 errors），保证“非 1P 输出面”统一脱敏。  
  - 证据：`sources/hermes-agent/tools/mcp_tool.py` → `_sanitize_error` 的多处使用（例如 tool_result content 包装、sampling error）

- **PRI-HA-005（CODE）**：Insights 引擎的 SQL 查询字符串在类定义时预计算，并全部使用占位符参数（`?`），降低 SQL 注入与字符串拼接风险。  
  - 证据：`sources/hermes-agent/agent/insights.py` → `_GET_SESSIONS_WITH_SOURCE/_GET_SESSIONS_ALL` 注释 “f-string evaluated once… no user-controlled value can alter query structure”

- **PRI-HA-006（CODE）**：Insights 仅选择必要列，显式跳过 `system_prompt` 与 `model_config` blobs（数据最小化）。  
  - 证据：`sources/hermes-agent/agent/insights.py` → `_SESSION_COLS` 注释 “skip system_prompt, model_config blobs”

- **PRI-HA-007（CODE）**：tool usage 统计使用双来源：tool role 的 `tool_name` 与 assistant role 的 `tool_calls` JSON（覆盖 gateway/CLI 两种记录方式），减少因缺字段导致的数据盲区。  
  - 证据：`sources/hermes-agent/agent/insights.py` → `_get_tool_usage(...)` docstring + 两段 SQL + JSON loads 分支

- **PRI-HA-008（CODE）**：成本估计将 cache read/write tokens 纳入 CanonicalUsage，并把 provider/base_url 作为 billing 维度（数据分级更细）。  
  - 证据：`sources/hermes-agent/agent/insights.py` → `_estimate_cost(...)`：`cache_read_tokens/cache_write_tokens`、`billing_provider/billing_base_url`

- **PRI-HA-009（CODE）**：Web Analytics 页面把 input/output tokens 分色展示，并为 tooltip 提供 per-day 明细，属于“可解释统计”表面。  
  - 证据：`sources/hermes-agent/web/src/pages/AnalyticsPage.tsx` → `TokenBarChart`：输入 `#ffe6cb` / 输出 `emerald`；tooltip 显示 input/output/total

- **PRI-HA-010（CODE）**：Analytics 页面对 token 显示做 K/M 缩写，降低大数阅读负担（面向可用性的数据呈现）。  
  - 证据：`sources/hermes-agent/web/src/pages/AnalyticsPage.tsx` → `formatTokens(n)`：K/M 分支

- **PRI-HA-011（CODE）**：Analytics 页使用 i18n key 而非硬编码文案，减少多语言/合规文本调整的成本。  
  - 证据：`sources/hermes-agent/web/src/pages/AnalyticsPage.tsx` → `useI18n()` + `t.analytics.*`

- **PRI-HA-012（CODE）**：Insights 引擎对“无数据窗口”返回 `empty: True` 的结构化响应，避免 UI/CLI 打印原始异常（减少泄露面）。  
  - 证据：`sources/hermes-agent/agent/insights.py` → `if not sessions: return { empty: True, ... }`

---

## Evidence Index（按 ID）
### Claude Code（CC）
- PRI-CC-001：`services/analytics/index.ts` → module design (no deps / queue)
- PRI-CC-002：`services/analytics/index.ts` → `attachAnalyticsSink`（queueMicrotask + idempotent）
- PRI-CC-003：`services/analytics/index.ts` → `LogEventMetadata`（no strings）
- PRI-CC-004：`services/analytics/index.ts` → marker types（NOT_CODE / PII_TAGGED）
- PRI-CC-005：`services/analytics/index.ts` → `stripProtoFields`
- PRI-CC-006：`services/analytics/index.ts` → `stripProtoFields` returns same reference when no keys
- PRI-CC-007：`services/analytics/index.ts` → sampling config comment (`tengu_event_sampling_config`)
- PRI-CC-008：`services/analytics/index.ts` → `_resetForTesting`
- PRI-CC-009：`utils/sanitization.ts` → always-on sanitization design notes
- PRI-CC-010：`utils/sanitization.ts` → `partiallySanitizeUnicode` (NFKC + unicode property strip + ranges)
- PRI-CC-011：`utils/sanitization.ts` → `MAX_ITERATIONS` + throw
- PRI-CC-012：`utils/sanitization.ts` → `recursivelySanitizeUnicode`

### OpenClaw（OC）
- PRI-OC-001：`plugin-sdk/diagnostics-otel.ts` → narrowed surface + `redactSensitiveText`
- PRI-OC-002：`logging/redact.ts` → `RedactSensitiveMode` + default tools
- PRI-OC-003：`logging/redact.ts` → `DEFAULT_REDACT_PATTERNS`
- PRI-OC-004：`logging/redact.ts` → `parsePattern` forces global + `compileConfigRegex`
- PRI-OC-005：`logging/redact.ts` → `maskToken` keep start/end
- PRI-OC-006：`logging/redact.ts` → `redactPemBlock` / PRIVATE KEY handling
- PRI-OC-007：`logging/redact.ts` → `resolveConfigRedaction` loads config.js w/ try/catch
- PRI-OC-008：`logging/redact.ts` → `redactSensitiveLines` multiline batch
- PRI-OC-009：`secrets/runtime-config-collectors-core.ts` → `collectSecretInputAssignment` provider/skill
- PRI-OC-010：`secrets/runtime-config-collectors-core.ts` → `collectAgentMemorySearchAssignments` activation logic
- PRI-OC-011：`secrets/runtime-config-collectors-core.ts` → `evaluateGatewayAuthSurfaceStates`
- PRI-OC-012：`shared/usage-aggregates.ts` → stable `.toSorted(...)` outputs

### Hermes Agent（HA）
- PRI-HA-001：`tools/mcp_tool.py` → `_SAFE_ENV_KEYS` / `_build_safe_env`
- PRI-HA-002：`tools/mcp_tool.py` → `_CREDENTIAL_PATTERN` / `_sanitize_error`
- PRI-HA-003：`tools/mcp_tool.py` → `sanitize_mcp_name_component`
- PRI-HA-004：`tools/mcp_tool.py` → `_sanitize_error` used across tool results/errors
- PRI-HA-005：`agent/insights.py` → precomputed SQL strings + placeholders
- PRI-HA-006：`agent/insights.py` → `_SESSION_COLS` data minimization
- PRI-HA-007：`agent/insights.py` → `_get_tool_usage` dual source
- PRI-HA-008：`agent/insights.py` → `_estimate_cost` includes cache tokens + provider/base_url
- PRI-HA-009：`web/src/pages/AnalyticsPage.tsx` → token chart split + tooltip
- PRI-HA-010：`web/src/pages/AnalyticsPage.tsx` → `formatTokens` (K/M)
- PRI-HA-011：`web/src/pages/AnalyticsPage.tsx` → `useI18n` + `t.analytics.*`
- PRI-HA-012：`agent/insights.py` → `empty: True` structured response
