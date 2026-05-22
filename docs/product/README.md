# Vigilon Agent 产品文档入口

本目录负责沉淀 Vigilon Agent 的产品定位、能力边界、阶段目标和接手规则。

## 当前基线

- [2026-05-17 产品定位与能力边界](2026-05-17-product-positioning-and-boundary.md)
- [2026-05-17 Phase 1 Solo Runtime Parity Checklist](2026-05-17-phase-1-solo-runtime-parity-checklist.md)
- [2026-05-17 Phase 1 Copy-First Mechanism Map](2026-05-17-phase-1-copy-first-mechanism-map.md)
- [2026-05-17 Phase 1 Development Baseline](2026-05-17-phase-1-development-baseline.md)
- [2026-05-18 Phase 2 Core Capability Alignment](2026-05-18-phase-2-core-capability-alignment.md)
- [2026-05-18 Phase 2 Claude Code Coverage Audit](2026-05-18-phase-2-claude-code-coverage-audit.md)
- [2026-05-18 Surface vs Deep Claude Code Mechanism Audit](2026-05-18-surface-vs-deep-claude-code-mechanism-audit.md)
- [2026-05-19 P2.5 Runtime Governance](2026-05-19-p2-5-runtime-governance.md)
- [2026-05-22 Whiteboard Agent Alpha Readiness](2026-05-22-whiteboard-agent-alpha-readiness.md)
- [2026-05-22 Open Source v0.1.0 Release](2026-05-22-open-source-v0-1-0-release.md)
- [2026-05-19 Phase2/Phase3 Boundary Probe: Skill Implementation Search](2026-05-19-phase23-boundary-probe-skill-search.md)
- [2026-05-18 Phase 3 Closure Report](2026-05-18-phase-3-closure-report.md)
- [2026-05-18 Phase 3.1 TUI v2 Closure Report](2026-05-18-phase-3-1-tui-v2-closure-report.md)

## 路线图讨论稿

- [2026-05-18 P2-P5 路线图讨论稿](roadmaps/2026-05-18-roadmap-from-p2-to-p5.md)
- [2026-05-18 P2-P3 执行计划](roadmaps/2026-05-18-p2-p3-execution-plan.md)
- [2026-05-19 P2.5 Runtime Governance 执行计划](roadmaps/2026-05-19-p2-5-execution-plan.md)

## 当前硬决策

- Vigilon Agent 的最终定位是任务优先的超级个人助手。
- 当前阶段口径已调整为 Open Source v0.1.0：不再证明 Vigilon 等于 Claude Code，而是把 Claude Code 参考工程切成一个干净、可运行、可扩展的基础 Agent。
- 旧阶段里的 Claude Code 对照文档只保留为历史决策记录，不再作为当前开发的强制接手入口。
- v0.1.0 的硬目标是基础 Agent 能独立跑起来：理解任务、读搜改写、执行命令、权限控制、会话恢复、记忆压缩、subagent/task host 和 project instructions。
- 开源前仓库口径必须从“参考工程”切到“experimental local whiteboard Agent runtime”。
- 根 README、LICENSE、package metadata、quickstart、release gates 和 package dry-run 是当前阶段的一等交付物。
- Phase 1/2/3 文档中的 closure 语言只说明历史实现，不再自动等于当前能力完成。
- 2026-05-19 起，Phase 2 和 Phase 3 都重新打开：此前 `CLOSED` / closure 报告只作为历史实现记录，不能再作为深层能力完成证据。
- Phase 2 / Phase 3 不接受表层实现或最小实现作为完成口径；复杂任务日志、失败边界和 runtime 行为证据必须一起出现。
- P2.5 的方向是 Runtime Governance：Memory Runtime、Context / Compact Runtime、Safety / Sandbox Runtime、Subagent / Task Host Runtime。P2.5 不再把搜索链路作为主瓶颈。
- P2.5 Memory Runtime 已有局部门禁 `pnpm phase2.5:memory-probe`，只证明 session-memory manifest、typed sections、semantic fingerprint、fresh/stale、semantic drift inspection、model-grounded session-memory validation metadata、`memory validate --refresh` readiness gate、drift caveat、manual typed long-term memory promotion policy 和 delete 语义；它不等于 P2.5 closure。
- P2.5 Provider Memory Validation 已有真实 provider 门禁 `pnpm phase2.5:provider-memory-probe`，强制 DeepSeek 返回 supported grounding 和 usage metadata，才可作为 provider-backed memory validation closure evidence；synthetic memory probe 不能替代它。
- P2.5 Context / Compact Runtime 已有局部门禁 `pnpm phase2.5:compact-probe`，只证明 route metadata、session-memory extraction readiness/wait、model-grounded memory readiness gate、unsupported memory compact blocking、provider/model context-window budget metadata、provider input-token preflight、provider usage anchored token pressure、token-pressure evaluation、preserved segment head/anchor/tail event refs、registry-driven cleanup operations、manual compact CLI surface、auto gate 和 restoration metadata；TUI `/compact` surface 由 TUI unit test 和 baseline signal 覆盖；它不等于 P2.5 closure。
- P2.5 Safety / Sandbox Runtime 已有局部门禁 `pnpm phase2.5:safety-probe`，只证明 Bash policy metadata、sandbox decision、macOS read-only OS sandbox enforcement、permission origin、resolve-once permission coordination、destructive fail-closed 和 sed surrogate；它不等于 P2.5 closure。
- P2.5 Subagent / Task Host Runtime 已有局部门禁 `pnpm phase2.5:subagent-probe`，只证明 Claude Code-shaped agent source precedence（built-in/plugin/user/project/local/flag/managed）、override visibility、session + long-term memory snapshot、permission origin、父侧 transcript-derived permission/origin aggregation、shared task-host registration、byte-identical fork prefix metadata、复制型 worktree host isolation、git-native worktree branch/HEAD provenance、baseline-to-worktree diff artifact、baseline-checked source apply、check-only/partial/3-way/rollback apply lifecycle、TUI merge command choices、TaskStop shared stop path、cross-process stop request observation、isolated transcript、handoff、lifecycle streaming/replay、CLI inspect/resume/apply/stop、transcript-derived output stream、TUI `/agents` inventory/inspect/resume/apply/stop，以及 live + transcript-replayed background subagent completion notification；它不等于 P2.5 closure。
- P2.5 Provider Cache / Prefix Sharing 已有局部门禁 `pnpm phase2.5:cache-probe`，证明 DeepSeek provider prompt cache usage 映射、runtime transcript cache read/create evidence、forked subagent byte-identical prefix hash 继承和 request-stability provider-cache audit；`pnpm phase2.5:provider-cache-probe` 会强制真实 DeepSeek provider 返回 cache-hit evidence，才可作为 provider-backed cache-hit closure 证据。
- P2.5 Integrated Governance 已有局部门禁 `pnpm phase2.5:governance-probe`，会串五个 slice probes 并运行 synthetic main/subagent/Bash/memory/compact/resume 场景；它不等于 provider-backed long-task closure。
- 项目默认 DeepSeek 模型固定为 `deepseek-v4-flash`，除非用户显式传入 `--model` 或设置 `DEEPSEEK_MODEL`。
- v0.1.0 基础可用性新增 `vigilon init`、`vigilon tools` 和 project instructions 注入：runtime 会读取 `AGENTS.md`、`VIGILON.md`、`.vigilon/instructions.md` 并注入 CLI/TUI 模型上下文。
- v0.1.0 仍应显式标注缺口，不用 Claude Code 深层对照遮蔽真实状态。
- Phase 2 不做 daily-driver TUI、Codex 级桌面自动化或 Vigilon Agent 社会，这些分别后置到 P3、P4、P5。
- Phase 3.1 的 TUI 是内部 Agent-flow 验证面，不是最终用户产品面。
- Coding workflow 是基础形态，不是最终产品边界。
- Codex/Claude Code 只作为历史参照，不再是公开叙事的中心。
- Agent 社会是后续扩展方向，必须建立在可治理、可恢复、可审计的基础上。
- 当前明确不做 remote / bridge / multi-user / enterprise / admin / billing / telemetry / marketplace。
- Claude Code / research 源码镜像已从 Git 工作树移除；本机临时归档为 `.local-archives/vigilon-reference-mirrors-20260522-2132.tar.gz`，该目录不进入仓库。

## 后续 Agent 接手顺序

1. 先读仓库根目录 `README.md`。
2. 再读 [2026-05-22 Open Source v0.1.0 Release](2026-05-22-open-source-v0-1-0-release.md)。
3. 再读 [2026-05-22 Whiteboard Agent Alpha Readiness](2026-05-22-whiteboard-agent-alpha-readiness.md)。
4. 再读 [2026-05-19 P2.5 Runtime Governance](2026-05-19-p2-5-runtime-governance.md)。
5. 再按任务需要读 Phase 1/2/3 历史文档，注意其中 Claude Code 对照和 closure 口径已是历史背景。
6. 代码实现优先从 `packages/runtime` 和 `packages/tui` 进入；不要依赖已移除的 reference mirror。
