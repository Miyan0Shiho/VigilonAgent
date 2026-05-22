# P2-P3 Execution Plan

- 日期：2026-05-18
- 状态：执行计划草案
- 依据：[2026-05-18 P2-P5 路线图讨论稿](./2026-05-18-roadmap-from-p2-to-p5.md)
- Phase 2 阶段基线：[`docs/product/2026-05-18-phase-2-core-capability-alignment.md`](../2026-05-18-phase-2-core-capability-alignment.md)
- Phase 2 覆盖审计：[`docs/product/2026-05-18-phase-2-claude-code-coverage-audit.md`](../2026-05-18-phase-2-claude-code-coverage-audit.md)
- 前提：P1 Solo Runtime Core Parity 已完成，`packages/runtime` 是主开发入口，`packages/claude-code` 和 `docs/claudecode-research/` 是 copy-first 参考材料。

## 1. 总原则

P2 和 P3 不能混在一起。

P2 负责把能力推到 Claude Code 核心能力级别。它关心机制完整度、行为语义、失败语义、权限边界、上下文治理和恢复一致性。

P3 负责把这些能力组织成 daily-driver 生产工具。它关心日常入口、任务状态、操作反馈、错误恢复、结果交付、长任务恢复和用户是否愿意真实依赖它。

因此：

- P2 不追求好看的 TUI。
- P2 不追求 Vigilon 差异化。
- P3 不再以补能力清单为主。
- P3 不以“有界面”为完成标准，而以“愿意每天使用”为完成标准。

## 2. P2：Claude Code Core Capability Alignment

> 注意：本节保留 P2/P3 拆分讨论的原始执行切片。Phase 2 的最新能力门禁以 `docs/product/2026-05-18-phase-2-core-capability-alignment.md` 和覆盖审计为准；其中已经补入 LLM transport、ToolSearch/deferred tools、LSP/code intelligence、prompt cache/request stability、WebFetch、Notebook、AskUser、TaskStop、Config/runtime mutation 等反查后确认的缺口。

### 2.1 P2 目标

P2 的目标是：

**把 Vigilon 的核心能力从 P1 的可运行闭环，推进到尽可能接近 Claude Code 源码机制的完整核心能力水平。**

P2 的验收标准不是“模块存在”，而是：

- 状态流接近 Claude Code。
- 权限边界接近 Claude Code。
- 失败语义接近 Claude Code。
- 上下文治理接近 Claude Code。
- transcript / resume / compact 后的一致性接近 Claude Code。
- 能在真实仓库任务中稳定体现这些机制。

### 2.2 P2 切片

#### P2.1 Search And Context Ingress

目标：把搜索链路从“工具可用”推进到 Claude Code 式上下文入口。

对照材料：

- `docs/product/2026-05-17-phase-1-copy-first-mechanism-map.md`
- `docs/claudecode-research/library/mechanisms/32-file-read-grep-and-websearch-runtime.md`
- `docs/claudecode-research/library/mechanisms/91-fileread-image-pdf-dedup-and-supplemental-block-runtime.md`
- `docs/claudecode-research/library/mechanisms/92-fileread-skill-triggers-memory-freshness-and-session-analytics-sidecars.md`
- `docs/claudecode-research/library/mechanisms/93-fileread-path-guards-unc-screenshot-recovery-and-friendly-miss-runtime.md`
- `docs/claudecode-research/library/mechanisms/94-greptool-ripgrep-arg-synthesis-ignore-merging-and-pagination-runtime.md`
- `docs/claudecode-research/library/mechanisms/95-globtool-path-validation-result-capping-and-grep-ui-reuse-runtime.md`

范围：

- `ReadTool` 路径保护、友好错误、重复读取控制、读取状态跟踪。
- `GrepTool` ripgrep 参数合成、ignore 合并、输出模式、分页和数量限制。
- `GlobTool` 路径校验、结果 cap、和搜索 UI/model 数据分离。
- 搜索结果进入 model context 的格式稳定化。

验收：

- 陌生仓库中定位一个跨文件实现，工具调用数量可控。
- 大结果不会污染上下文。
- 读过的文件不会重复塞入上下文。
- 搜索失败、路径错误、ignore 过滤都有可解释结果。

#### P2.2 Edit / Write / Bash Safety

目标：把真实执行工具推到可信可恢复的 Claude Code 式执行层。

对照材料：

- `docs/claudecode-research/library/mechanisms/70-bash-tool-sandbox-permission-and-transcript-runtime.md`
- `docs/claudecode-research/library/mechanisms/87-fileedit-tool-staleness-quote-normalization-and-atomic-write-runtime.md`
- `docs/claudecode-research/library/mechanisms/88-filewrite-tool-full-replacement-create-overwrite-and-diff-runtime.md`

范围：

- `EditTool` stale check、anchor mismatch、quote normalization、atomic write。
- `WriteTool` read-before-write、create/overwrite 区分、diff metadata。
- `BashTool` timeout、interrupt、stdout/stderr budget、危险命令分类、路径破坏保护。
- 工具失败必须进入 transcript 并回到模型循环。

验收：

- 文件被用户并发修改时，edit/write 不静默覆盖。
- 危险 shell 命令需要权限 gate。
- 长输出被预算化处理，并能保留可读摘要。
- 工具失败后模型能继续修复任务。

#### P2.3 Plan Mode And Todo Semantics

目标：让计划模式和 todo 成为 runtime 状态，而不是提示词习惯。

对照材料：

- `docs/claudecode-research/library/mechanisms/69-exit-plan-mode-and-partially-visible-review-artifact-operator-loops.md`
- `docs/claudecode-research/library/mechanisms/72-todowrite-tool-session-checklist-and-verification-nudge-runtime.md`
- `docs/claudecode-research/library/mechanisms/73-enter-plan-mode-gating-transition-and-read-only-runtime.md`

范围：

- `EnterPlanMode` / `ExitPlanMode` 的状态迁移。
- plan 阶段写操作限制。
- plan approval 进入 transcript。
- todo 状态和 final report 对齐。
- verification nudge：任务结束前检查 todo 与验证证据。

验收：

- 高风险任务能自动或显式进入 plan。
- plan 阶段不能绕过权限写文件。
- 用户拒绝计划后任务不会继续执行。
- 最终报告能解释 todo 完成情况、验证情况和残余风险。

#### P2.4 Transcript / Resume / Compact Consistency

目标：把会话恢复和上下文压缩从“能存能读”推进到 Claude Code 式状态迁移。

对照材料：

- `docs/claudecode-research/library/implementation/03-query-loop-and-recovery.md`
- `docs/claudecode-research/library/implementation/04-session-storage-and-resume.md`
- `docs/claudecode-research/library/commands/07-memory-skills-plan-tasks-and-compact.md`
- `docs/claudecode-research/library/mechanisms/63-session-memory-compaction-autocompact-and-post-compact-restoration-runtime.md`

范围：

- transcript JSONL 持久化格式稳定化。
- content replacement record。
- compact boundary。
- resume 后 session state 恢复。
- compact 后恢复 permissions、todos、approved plan、verification notes。

验收：

- 中断任务后 resume 能继续同一任务。
- compact 前后模型看到的上下文一致且可解释。
- 工具结果预算替换不丢审计信息。
- transcript 可被人类和后续 Agent 接手。

#### P2.5 Memory Runtime

目标：建立 Claude Code 式 session memory 的最小完整形态，长期记忆仍保持保守。

对照材料：

- `docs/claudecode-research/library/mechanisms/07-skills-and-memory.md`
- `docs/claudecode-research/library/mechanisms/12-memdir-and-session-memory.md`
- `docs/claudecode-research/library/mechanisms/62-session-memory-prompt-template-waiting-and-manual-summary-runtime.md`
- `docs/claudecode-research/library/mechanisms/64-session-memory-away-summary-and-skillify-consumer-runtime.md`

范围：

- session summary。
- memory injection boundary。
- memory freshness。
- file-backed editable memory store。
- 明确禁止黑盒自动长期记忆。

验收：

- session memory 能帮助 resume 和 compact 后继续任务。
- 记忆内容可查看、可编辑、可删除。
- 记忆注入有来源和边界。
- 不把工具结果、隐私内容或失败状态误写为长期记忆。

#### P2.6 Skill / MCP / Hook Runtime

目标：把扩展机制从“能加载”推进到工具池语义、权限边界和错误恢复完整。

对照材料：

- `docs/claudecode-research/library/mechanisms/05-mcp-integration.md`
- `docs/claudecode-research/library/mechanisms/11-skills-runtime-and-loading.md`
- `docs/claudecode-research/library/mechanisms/23-permission-runtime-hooks-classifier-and-dialog-pipeline.md`
- `docs/claudecode-research/library/mechanisms/77-mcp-resource-listing-reading-and-binary-persistence-runtime.md`
- `docs/claudecode-research/library/mechanisms/84-mcp-tool-dynamic-tool-synthesis-progress-elicitation-and-result-runtime.md`

范围：

- MCP tool schema synthesis。
- MCP resource list/read。
- MCP error surface。
- Skill frontmatter、allowed tools、path triggers。
- PreToolUse hook 结果进入 transcript。

验收：

- 一个本地 MCP server 可以稳定暴露工具并被 runtime 调用。
- MCP 失败能进入模型上下文并给出可解释错误。
- skill 不会越过 allowedTools。
- hook block 能停止工具执行并保留审计记录。

#### P2.7 Subagent / AgentTool Foundation

目标：补齐 Claude Code 的 AgentTool 核心语义，但不进入 Agent 社会。

对照材料：

- `docs/claudecode-research/library/mechanisms/06-tasks-subagents-and-background.md`
- `docs/claudecode-research/library/mechanisms/51-agent-definitions-selection-spawn-and-handoff-runtime.md`
- `docs/claudecode-research/library/mechanisms/53-local-agent-task-retention-panel-and-notification-runtime.md`

范围：

- agent definition loader。
- delegation prompt routing。
- sync local subagent host。
- subagent transcript boundary。
- result protocol。

不做：

- remote agents。
- teammate / swarm。
- worktree host。
- background task product surface。
- Agent 社会。

验收：

- 主 Agent 可把一个明确、有限、可回收的子任务交给 subagent。
- subagent 有独立 transcript。
- 主 Agent 收到结构化结果而不是任意长文本。
- subagent 权限和工具边界可解释。

### 2.3 P2 总验收

P2 完成时，必须能完成以下真实验收：

1. 在陌生 TypeScript 仓库里定位跨文件 bug。
2. 搜索、读取、编辑、运行测试、恢复任务都经过 transcript。
3. 大输出、重复读取、搜索噪音被上下文治理控制。
4. 中断后 resume 能继续。
5. compact 后任务状态仍一致。
6. 一个本地 skill 和一个本地 MCP 工具能进入同一条 tool loop。
7. 一个同步 local subagent 能完成有限子任务。
8. 最终报告能说明改动、验证、未验证项、风险和 todo 状态。

## 3. P3：Daily-Driver Productization

### 3.1 P3 目标

P3 的目标是：

**把 Claude Code 级核心能力组织成一个你愿意每天真实依赖的生产工具。**

P3 不以“有 TUI”为完成标准。P3 以真实使用意愿为完成标准。

### 3.2 P3 切片

#### P3.1 Operator TUI

目标：建立日常主操作界面。

范围：

- 任务输入。
- 当前任务状态。
- 工具调用流。
- 权限等待。
- 错误恢复入口。
- transcript/resume 入口。

验收：

- 能在 TUI 内完成一个真实代码任务。
- 用户能看清 Agent 正在做什么、卡在哪里、等什么决定。
- TUI 不隐藏 runtime 状态。

#### P3.2 Session And Task Workbench

目标：让长任务、中断任务和多任务可管理。

范围：

- session list。
- resume。
- task title / status。
- last action。
- verification summary。
- transcript preview。

验收：

- 退出后能从 session list 选择任务继续。
- 用户能区分已完成、失败、等待确认、可恢复任务。
- 恢复入口不依赖记住 session id。

#### P3.3 Permission And Error UX

目标：让权限等待和错误恢复成为可控操作流。

范围：

- 权限请求展示。
- 风险原因。
- allow / deny / allow similar。
- tool failure 展示。
- retry / revise plan / stop。

验收：

- 高风险操作不会被淹没在日志里。
- 用户能快速判断是否授权。
- 失败后有明确恢复路径。

#### P3.4 Result Handoff

目标：每次任务结束都像交付物。

范围：

- changed files。
- tests / commands run。
- unverified items。
- risks。
- todo final state。
- next suggested action。

验收：

- 用户不需要翻完整 transcript 才知道任务是否完成。
- 结果报告能直接作为开发记录。
- 未验证内容不会被包装成已完成。

#### P3.5 Self-Hosting Workflow

目标：Vigilon 能稳定帮助开发 Vigilon 自己。

范围：

- 使用 Vigilon 完成 `packages/runtime` 的小功能。
- 使用 Vigilon 跑测试和解释失败。
- 使用 Vigilon 生成结果报告。
- 记录自举任务质量。

验收：

- 至少连续完成 5 个 Vigilon 自身开发任务。
- 每个任务都有 transcript、diff、测试结果和 final report。
- 出现失败时能恢复或清楚解释不能恢复的原因。

#### P3.6 Packaging And Local Install

目标：让 Vigilon 成为可日常调用的本地工具。

范围：

- `vigilon` bin。
- local install / link。
- config path。
- session path。
- doctor。
- update-free local workflow。

验收：

- 在任意本地 repo 中运行 `vigilon`。
- `vigilon doctor` 能检查模型 key、配置、session path、工具可用性。
- 不依赖开发仓库 cwd 才能使用。

### 3.3 P3 总验收

P3 完成时，必须满足：

1. 用户愿意把真实开发任务默认交给 Vigilon。
2. TUI 能完成输入、执行、权限、错误、恢复、交付闭环。
3. session/task workbench 能承载长任务和中断恢复。
4. final report 可作为真实交付记录。
5. Vigilon 能稳定参与自身开发。
6. 本地安装后可在任意 repo 使用。

## 4. P2 到 P3 的切换条件

只有当下面条件满足，才进入 P3 主线：

- P2.1 到 P2.6 已完成。
- P2.7 至少完成 sync local subagent 基础版，或明确决定推迟到 P4。
- `pnpm phase1:baseline` 已升级为 P2 baseline，覆盖核心能力。
- 至少 3 个陌生仓库任务通过 P2 验收。
- transcript / resume / compact 在真实任务中稳定。

如果这些条件不满足，P3 的 UI 和产品化会变成包装不稳定能力。

## 5. 建议任务顺序

1. P2.1 Search And Context Ingress。
2. P2.2 Edit / Write / Bash Safety。
3. P2.4 Transcript / Resume / Compact Consistency。
4. P2.3 Plan Mode And Todo Semantics。
5. P2.6 Skill / MCP / Hook Runtime。
6. P2.5 Memory Runtime。
7. P2.7 Subagent / AgentTool Foundation。
8. P3.1 Operator TUI。
9. P3.2 Session And Task Workbench。
10. P3.3 Permission And Error UX。
11. P3.4 Result Handoff。
12. P3.5 Self-Hosting Workflow。
13. P3.6 Packaging And Local Install。

## 6. 当前不做

P2 和 P3 都不做：

- remote / bridge。
- multi-user / organization。
- enterprise admin。
- billing / license。
- commercial telemetry。
- marketplace。
- managed enterprise policy。
- Codex 级桌面操作和高阶自动化。
- Vigilon 独有 Agent 社会。

这些属于 P4/P5 或明确非目标。
