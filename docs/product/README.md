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
- [2026-05-19 Phase2/Phase3 Boundary Probe: Skill Implementation Search](2026-05-19-phase23-boundary-probe-skill-search.md)
- [2026-05-18 Phase 3 Closure Report](2026-05-18-phase-3-closure-report.md)
- [2026-05-18 Phase 3.1 TUI v2 Closure Report](2026-05-18-phase-3-1-tui-v2-closure-report.md)

## 路线图讨论稿

- [2026-05-18 P2-P5 路线图讨论稿](roadmaps/2026-05-18-roadmap-from-p2-to-p5.md)
- [2026-05-18 P2-P3 执行计划](roadmaps/2026-05-18-p2-p3-execution-plan.md)

## 当前硬决策

- Vigilon Agent 的最终定位是任务优先的超级个人助手。
- 第一阶段硬目标是 Claude Code Core Parity for Solo Runtime：优先复刻成熟本地 runtime，而不是从零发明或过早差异化。
- Phase 1 的具体功能设计必须 copy-first：先按 Claude Code 源码机制复刻，再做 Vigilon 改写和优化。
- Phase 1 开发门禁从 `pnpm phase1:baseline` 开始，等 Solo Runtime 主链稳定后逐步扩展。
- Phase 2 的硬目标是 Claude Code Core Capability Alignment：对齐搜索、编辑、Bash、Plan、Todo、Transcript、Resume、Compact、Memory、Skill、MCP、Hook 和 Subagent 的行为语义。
- 2026-05-19 起，Phase 2 和 Phase 3 都重新打开：此前 `CLOSED` / closure 报告只作为历史实现记录，不能再作为深层能力完成证据。
- Phase 2 继续 copy-first：每个具体功能必须先对照 Claude Code 源码机制和 `docs/claudecode-research/`，再改写到 Vigilon runtime。
- Phase 2 / Phase 3 不接受表层实现或最小实现作为完成口径；复杂任务日志、失败边界和 Claude Code 机制对照必须一起出现。
- 项目默认 DeepSeek 模型固定为 `deepseek-v4-flash`，除非用户显式传入 `--model` 或设置 `DEEPSEEK_MODEL`。
- Phase 2 必须覆盖 Claude Code 的 LLM transport、ToolSearch/deferred tools、LSP/code intelligence、prompt cache/request stability、WebFetch、Notebook、AskUser 和 TaskStop；缺任何一项都要显式标成延期，不能隐身。
- Phase 2 不做 daily-driver TUI、Codex 级桌面自动化或 Vigilon Agent 社会，这些分别后置到 P3、P4、P5。
- Phase 3.1 的 TUI 是内部 Agent-flow 验证面，不是最终用户产品面；后续应尽量贴着 Claude Code 的真实 TUI 代码和交互结构抄，不再发明独立风格。
- Coding workflow 是基础形态，不是最终产品边界。
- Codex 是体验标尺，Claude Code 是 runtime 骨架。
- Agent 社会是后续扩展方向，必须建立在可治理、可恢复、可审计的基础上。
- 当前明确不做 remote / bridge / multi-user / enterprise / admin / billing / telemetry / marketplace。

## 后续 Agent 接手顺序

1. 先读仓库根目录 `README.md`。
2. 再读本目录当前基线。
3. 再读 `docs/claudecode-research/README.md` 和 `docs/claudecode-research/library/master-index.md`。
4. 再读 Phase 1 Copy-First Mechanism Map。
5. 再读 Phase 1 Development Baseline。
6. 再读 Phase 2 Core Capability Alignment。
7. 再读 Phase 2 Claude Code Coverage Audit。
8. 再读 Surface vs Deep Claude Code Mechanism Audit。
9. 再读 Phase2/Phase3 Boundary Probe: Skill Implementation Search。
10. 再读 P2-P3 执行计划。
11. 再读 Phase 3 Closure Report。
12. 再读 Phase 3.1 TUI v2 Closure Report。
13. 最后按任务需要进入 Claude Code 的 product、architecture、mechanisms、implementation 文档。
