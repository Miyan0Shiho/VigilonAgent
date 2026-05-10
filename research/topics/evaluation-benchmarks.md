# 评测与基准体系专题（Claude Code / OpenClaw / Hermes Agent）

> 范围：测试分层与环境隔离、性能基准（启动/延迟/吞吐/资源）、质量门禁（verification/parity/security tests）、可复现机制（lock/seed/timeout）、结果报告与可比性。  
> 证据规范：每条结论必须包含 Evidence ID（EVA-CC/OC/HA-###），并落到“文件 + 符号（函数/类型/常量）”；证据类型标注 CODE/TEST/CONFIG。

## TL;DR
- **Claude Code**：内置 verification/doctor/insights 等机制可作为“质量门禁/可诊断性”证据入口。
- **OpenClaw**：bench 脚本与 QA 扩展（parity report）清晰体现评测与基准闭环。
- **Hermes Agent**：基准环境（terminalbench）与安全测试、以及训练/评测工具链为评测体系提供工程化证据。

## 对齐维度
| 子维度 | 关注点 |
|---|---|
| 测试分层 | unit/integration/contract/e2e |
| 性能基准 | startup、model latency、吞吐、资源 |
| 质量门禁 | verification/parity/security tests |
| 可复现 | lock/seed/timeout、环境发现 |
| 报告 | 结构化输出、聚合、稳定排序 |

---

## Evidence-backed Findings（按项目）

### Claude Code（CC）
> 代码根：`research/sources/claude-code/`

- **EVA-CC-001（CODE）**：内置 Verification Agent 的 system prompt 明确要求“对抗式验证”，并点名两类常见失败模式（verification avoidance / first 80% bias）。  
  - 证据：`sources/claude-code/src/tools/AgentTool/built-in/verificationAgent.ts` → `VERIFICATION_SYSTEM_PROMPT`（开头段落）

- **EVA-CC-002（CODE）**：Verification Agent 明确禁止修改项目目录（可写 /tmp 仅限临时测试脚本），属于评测/验收时的“非破坏性验证”约束。  
  - 证据：同文件 `VERIFICATION_SYSTEM_PROMPT` → “DO NOT MODIFY THE PROJECT”条款

- **EVA-CC-003（CODE）**：Verification Agent 要求每个 check 都必须包含“Command run + Output observed”，并强制以 `VERDICT: PASS/FAIL/PARTIAL` 结尾（机器可解析）。  
  - 证据：同文件 `VERIFICATION_SYSTEM_PROMPT` → “OUTPUT FORMAT (REQUIRED)”与 `VERDICT:` 规范

- **EVA-CC-004（CODE）**：Verification Agent 规定通用 baseline（读 CLAUDE.md、build、tests、linters）与按变更类型的验证策略模板（frontend/backend/CLI/infra 等）。  
  - 证据：同文件 `VERIFICATION_SYSTEM_PROMPT` → “REQUIRED STEPS” + “VERIFICATION STRATEGY”

- **EVA-CC-005（CODE）**：Verification Agent 强制包含至少一个 adversarial probe（并发/边界/幂等/孤儿操作）才可 PASS，形成“质量门禁”。  
  - 证据：同文件 `VERIFICATION_SYSTEM_PROMPT` → “BEFORE ISSUING PASS”段落

- **EVA-CC-006（CODE）**：Verification Agent 作为 `BuiltInAgentDefinition` 注册，并通过 `disallowedTools` 限制其对项目的写入能力（工具级门禁）。  
  - 证据：`sources/claude-code/src/tools/AgentTool/built-in/verificationAgent.ts` → `VERIFICATION_AGENT.disallowedTools`

- **EVA-CC-007（CODE）**：doctor 诊断将安装形态强类型化（npm-global/local/native/package-manager/development/unknown），为“环境正确性评测”提供结构化输出。  
  - 证据：`sources/claude-code/src/utils/doctorDiagnostic.ts` → `InstallationType` / `DiagnosticInfo`

- **EVA-CC-008（CODE）**：doctor 对 Windows 路径进行 normalize，以保证跨平台诊断一致（避免 path 匹配误判）。  
  - 证据：`sources/claude-code/src/utils/doctorDiagnostic.ts` → `getNormalizedPaths()`（win32.sep → posix.sep）

- **EVA-CC-009（CODE）**：doctor 会检测“多安装冲突”，并特别处理 Homebrew cask 与 npm 安装同路径的 symlink 情况，避免误诊。  
  - 证据：`sources/claude-code/src/utils/doctorDiagnostic.ts` → `detectMultipleInstallations()`：`realpath(globalBinPath)` + `/Caskroom/` 判断

- **EVA-CC-010（CODE）**：/insights 选择高质量模型（Opus）用于“facet extraction 与 narrative insights”，体现评测/分析输出质量优先策略。  
  - 证据：`sources/claude-code/src/commands/insights.ts` → `getAnalysisModel()` / `getInsightsModel()` 均返回 `getDefaultOpusModel()`

- **EVA-CC-011（CODE）**：/insights 支持跨远程主机并行采集（coder/ssh/scp），并用 `COPYFILE_EXCL` 跳过已存在文件，保证采集幂等性与可复盘性。  
  - 证据：`sources/claude-code/src/commands/insights.ts` → `collectAllRemoteHostData(...)` / `collectFromRemoteHost(...)`：`Promise.all` + `copyFile(... COPYFILE_EXCL)`

- **EVA-CC-012（CODE）**：/insights 的 session meta 记录包含 tool_errors、error categories、使用 MCP/WebSearch/WebFetch 等特征，为后续回归/评测提供维度。  
  - 证据：`sources/claude-code/src/commands/insights.ts` → `type SessionMeta`：`tool_errors/tool_error_categories/uses_mcp/uses_web_search...`

---

### OpenClaw（OC）
> 代码根：`research/sources/openclaw/`

- **EVA-OC-001（CODE）**：CLI 启动基准脚本把“case 集合”结构化为 id/name/args/presets，并支持按 preset 选择（startup/real）。  
  - 证据：`sources/openclaw/scripts/bench-cli-startup.ts` → `COMMAND_CASES` / `resolveCases(...)`

- **EVA-OC-002（CODE）**：基准统计输出 p50/p95/min/max/avg，并汇总退出原因（exit code/signal），使结果可比较。  
  - 证据：`sources/openclaw/scripts/bench-cli-startup.ts` → `SummaryStats` / `summarizeNumbers` / `collectExitSummary`

- **EVA-OC-003（CODE）**：bench 支持 runs/warmup/timeout/json/output/cpuProfDir/heapProfDir 等参数，体现“可复现实验配置”。  
  - 证据：`sources/openclaw/scripts/bench-cli-startup.ts` → `CliOptions` / `DEFAULT_*` / `parseFlagValue/parseRepeatableFlag/parsePositiveInt`

- **EVA-OC-004（CODE）**：bench 通过 stdout marker 注入方式提取 max RSS（`__OPENCLAW_MAX_RSS_KB__=`），把资源占用纳入指标。  
  - 证据：`sources/openclaw/scripts/bench-cli-startup.ts` → `MAX_RSS_MARKER`

- **EVA-OC-005（CODE）**：model latency bench 对两种 provider/model 多次运行，输出 median/min/max，并强制检查必要 env var（缺失即抛错）。  
  - 证据：`sources/openclaw/scripts/bench-model.ts` → `DEFAULT_RUNS` / `runModel(...)` / `median(...)`；`Missing ANTHROPIC_API_KEY` 抛错

- **EVA-OC-006（CODE）**：Parity report 将 scenario/step 的 pass/fail/skip 与 counts 建模为强类型，并支持 run metadata（后向兼容缺失 run block）。  
  - 证据：`sources/openclaw/extensions/qa-lab/src/agentic-parity-report.ts` → `QaParitySuiteSummary` / `QaParityRunBlock` 注释（legacy summaries）

- **EVA-OC-007（CODE）**：Parity metrics 显式识别“unintended stop”与“fake success”（pass 但 details 呈失败语气），用于抓住评测的假阳性。  
  - 证据：同文件 → `UNINTENDED_STOP_PATTERNS` / `SUSPICIOUS_PASS_FAILURE_TONE_PATTERNS` / `fakeSuccessCount` 计算

- **EVA-OC-008（CODE）**：valid-tool-call rate 只统计“应当调用真实工具”的场景集合，避免记忆/纯理解任务抬高指标。  
  - 证据：同文件 → `QA_AGENTIC_PARITY_TOOL_BACKED_SCENARIO_TITLES` + `toolBackedScenarioCount/validToolCallCount`

- **EVA-OC-009（CODE）**：Parity 比较会先验证 summary 的 `run.primaryProvider/model` 与调用方 label 匹配，避免 baseline/candidate 路径交换导致“反向结论”。  
  - 证据：同文件 → `verifySummaryLabelMatch(...)` + `QaParityLabelMismatchError`（错误文案点名 swapped paths）

- **EVA-OC-010（CODE）**：比较只对 parity pack 场景计数（drop counts、按 title set filter），并对 scenario comparisons 做稳定排序（localeCompare）。  
  - 证据：同文件 → `scopeSummaryToParityPack(...)` 注释 + `scenarioComparisons.toSorted(...)`

- **EVA-OC-011（CODE）**：gate 失败条件显式列出（覆盖缺失/必跑场景 fail、completion/unintended-stop/valid-tool-call rate、fakeSuccessCount 必须为 0）。  
  - 证据：同文件 → `buildQaAgenticParityComparison(...)` failures push 逻辑

- **EVA-OC-012（CODE）**：Parity 报告提供 markdown 渲染器，输出包含 verdict、failures、逐场景对比与 notes，便于审阅与归档。  
  - 证据：同文件 → `renderQaAgenticParityMarkdownReport(...)`

---

### Hermes Agent（HA）
> 代码根：`research/sources/hermes-agent/`

- **EVA-HA-001（CODE）**：TerminalBench2 是 eval-only 环境：每任务给独立 Docker sandbox + 指令 + 测试套件，在同一 sandbox 内跑 `test.sh` 验证并产出二元 reward。  
  - 证据：`sources/hermes-agent/environments/benchmarks/terminalbench_2/terminalbench2_env.py` 顶部 docstring（evaluate flow + reward）

- **EVA-HA-002（CODE）**：评测配置（pydantic Field）覆盖 dataset/test timeout/task timeout/并发上限，并解释“过多并发会触发 Modal 内部 deadlock”。  
  - 证据：同文件 → `class TerminalBench2EvalConfig`：`max_concurrent_tasks` 字段描述

- **EVA-HA-003（CODE）**：评测并发支持 `eval_concurrency`（0=无限），并推荐本地设置为 8 以避免压垮机器。  
  - 证据：同文件 → `eval_concurrency` Field 描述

- **EVA-HA-004（CODE）**：评测流程明确“每任务：agent loop → 上传 tests → 运行 test.sh → 读 reward.txt”，体现可复现的验证闭环。  
  - 证据：同文件 docstring → rollout_and_score_eval 步骤（含 `/logs/verifier/reward.txt`）

- **EVA-HA-005（CODE）**：评测环境对 base64 tar 的解包实现了 path traversal/绝对路径/Windows drive 的安全校验。  
  - 证据：同文件 → `_normalize_tar_member_parts(member_name)`：`is_absolute/drive/..` 检查

- **EVA-HA-006（CODE）**：解包实现拒绝 symlink/非文件条目，并对目标路径做 `relative_to(target_root)` 验证，防止越界写盘。  
  - 证据：同文件 → `_safe_extract_tar(...)`：`member.isfile()` gate + `relative_to` 检查

- **EVA-HA-007（TEST）**：存在针对解包的安全测试：允许安全文件、拒绝 `../` traversal、拒绝 symlink。  
  - 证据：`sources/hermes-agent/tests/environments/benchmarks/test_terminalbench2_env_security.py` → `test_extract_base64_tar_*`

- **EVA-HA-008（CODE）**：RL training 工具把“环境发现”做成 AST 扫描 BaseEnv subclass（不 import 执行 env 文件），减少副作用与提高可扩展性。  
  - 证据：`sources/hermes-agent/tools/rl_training_tool.py` → `_scan_environments()`（AST walk `ast.ClassDef`）

- **EVA-HA-009（CODE）**：训练配置包含 LOCKED_FIELDS（基础设施调优字段不可被模型修改），体现评测/训练系统的安全与可复现门禁。  
  - 证据：`sources/hermes-agent/tools/rl_training_tool.py` → `LOCKED_FIELDS` 注释 “cannot be changed by the model”

- **EVA-HA-010（CODE）**：训练状态查询具有 30min rate limit，避免过频轮询对基础设施造成噪声与成本。  
  - 证据：`sources/hermes-agent/tools/rl_training_tool.py` → `MIN_STATUS_CHECK_INTERVAL = 30 * 60`

- **EVA-HA-011（CODE）**：日志目录按需创建（lazy），避免 import-time side effects，利于评测工具在多环境中安全加载。  
  - 证据：`sources/hermes-agent/tools/rl_training_tool.py` → `_ensure_logs_dir()` docstring

- **EVA-HA-012（CODE）**：训练环境配置可通过 `config_init()` 动态提取；失败时回退到 BaseEnvConfig 并记录 info（容错与可诊断性）。  
  - 证据：`sources/hermes-agent/tools/rl_training_tool.py` → `_get_env_config_fields(...)`：`config_init` try/catch + fallback import `BaseEnvConfig`

---

## Evidence Index（按 ID）
### Claude Code（CC）
- EVA-CC-001：`AgentTool/built-in/verificationAgent.ts` → `VERIFICATION_SYSTEM_PROMPT`（对抗式验证）
- EVA-CC-002：`verificationAgent.ts` → “DO NOT MODIFY THE PROJECT”条款
- EVA-CC-003：`verificationAgent.ts` → command run + output + `VERDICT:` 格式
- EVA-CC-004：`verificationAgent.ts` → required steps + change-type strategies
- EVA-CC-005：`verificationAgent.ts` → adversarial probe mandatory
- EVA-CC-006：`verificationAgent.ts` → `VERIFICATION_AGENT.disallowedTools`
- EVA-CC-007：`utils/doctorDiagnostic.ts` → `InstallationType` / `DiagnosticInfo`
- EVA-CC-008：`utils/doctorDiagnostic.ts` → `getNormalizedPaths`（Windows normalize）
- EVA-CC-009：`utils/doctorDiagnostic.ts` → `detectMultipleInstallations`（Homebrew cask symlink）
- EVA-CC-010：`commands/insights.ts` → `getAnalysisModel/getInsightsModel`（Opus）
- EVA-CC-011：`commands/insights.ts` → `collectAllRemoteHostData/collectFromRemoteHost`（scp + COPYFILE_EXCL）
- EVA-CC-012：`commands/insights.ts` → `SessionMeta`（tool_errors/uses_mcp 等）

### OpenClaw（OC）
- EVA-OC-001：`scripts/bench-cli-startup.ts` → `COMMAND_CASES` / `resolveCases`
- EVA-OC-002：`scripts/bench-cli-startup.ts` → p50/p95 stats + exit summary
- EVA-OC-003：`scripts/bench-cli-startup.ts` → cli flags (runs/warmup/timeout/json/prof dirs)
- EVA-OC-004：`scripts/bench-cli-startup.ts` → `MAX_RSS_MARKER`
- EVA-OC-005：`scripts/bench-model.ts` → `runModel` / `median` + env var gate
- EVA-OC-006：`extensions/qa-lab/.../agentic-parity-report.ts` → `QaParitySuiteSummary` / `run` block legacy handling
- EVA-OC-007：`agentic-parity-report.ts` → unintended stop + fake success patterns
- EVA-OC-008：`agentic-parity-report.ts` → tool-backed scenario metric
- EVA-OC-009：`agentic-parity-report.ts` → label match verification + `QaParityLabelMismatchError`
- EVA-OC-010：`agentic-parity-report.ts` → scope to parity pack + stable sorting
- EVA-OC-011：`agentic-parity-report.ts` → gate failures logic
- EVA-OC-012：`agentic-parity-report.ts` → markdown report renderer

### Hermes Agent（HA）
- EVA-HA-001：`terminalbench2_env.py` → eval-only flow + binary reward
- EVA-HA-002：`terminalbench2_env.py` → `TerminalBench2EvalConfig.max_concurrent_tasks` deadlock note
- EVA-HA-003：`terminalbench2_env.py` → `eval_concurrency`
- EVA-HA-004：`terminalbench2_env.py` → rollout_and_score_eval steps + reward.txt
- EVA-HA-005：`terminalbench2_env.py` → `_normalize_tar_member_parts`
- EVA-HA-006：`terminalbench2_env.py` → `_safe_extract_tar` (reject symlinks/non-files)
- EVA-HA-007：`test_terminalbench2_env_security.py` → traversal/symlink tests
- EVA-HA-008：`tools/rl_training_tool.py` → `_scan_environments` (AST)
- EVA-HA-009：`tools/rl_training_tool.py` → `LOCKED_FIELDS`
- EVA-HA-010：`tools/rl_training_tool.py` → `MIN_STATUS_CHECK_INTERVAL`
- EVA-HA-011：`tools/rl_training_tool.py` → `_ensure_logs_dir`
- EVA-HA-012：`tools/rl_training_tool.py` → `_get_env_config_fields` fallback
