# Vigilon Agent 产品文档入口

本目录负责沉淀 Vigilon Agent 的产品定位、能力边界、阶段目标和接手规则。

## 当前基线

- [2026-05-17 产品定位与能力边界](2026-05-17-product-positioning-and-boundary.md)
- [2026-05-17 Phase 1 Solo Runtime Parity Checklist](2026-05-17-phase-1-solo-runtime-parity-checklist.md)
- [2026-05-17 Phase 1 Copy-First Mechanism Map](2026-05-17-phase-1-copy-first-mechanism-map.md)
- [2026-05-17 Phase 1 Development Baseline](2026-05-17-phase-1-development-baseline.md)

## 当前硬决策

- Vigilon Agent 的最终定位是任务优先的超级个人助手。
- 第一阶段硬目标是 Claude Code Core Parity for Solo Runtime：优先复刻成熟本地 runtime，而不是从零发明或过早差异化。
- Phase 1 的具体功能设计必须 copy-first：先按 Claude Code 源码机制复刻，再做 Vigilon 改写和优化。
- Phase 1 开发门禁从 `pnpm phase1:baseline` 开始，等 Solo Runtime 主链稳定后逐步扩展。
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
6. 最后按任务需要进入 Claude Code 的 product、architecture、mechanisms、implementation 文档。
