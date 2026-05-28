# Vigilon Agent 产品文档入口

## Phase 2：可感知、可进化、可信任的 Agent Runtime

Phase 2 的正式文档在 [phase-2/](phase-2/) 目录下。

**必读（接手顺序）**：
1. [Phase 2 README](phase-2/README.md) — 概述与文档索引
2. [Phase 2 Product Doctrine](phase-2/product-doctrine.md) — 产品哲学与三目标框架
3. [Phase 2 Problem Framework](phase-2/problem-framework.md) — 七问题域详细定义

**历史探索（了解思路演进）**：
- [Phase 2 Explorations README](phase-2/explorations/README.md) — 历史文档索引
- [Agent Era Problem Map](phase-2/explorations/agent-era-problem-map.md) — 原始 19 问题域
- [Questions Response](phase-2/explorations/questions-response.md) — 19 问题域回答
- [Question Quality Review](phase-2/explorations/question-quality-review.md) — 问题域质量审查

## 当前基线

### Phase 2 方向（2026-05-27 更新）

Phase 2 的三个目标：
1. **用户需求感知，主动帮助用户** — Agent 从环境和历史中理解用户真正需要什么
2. **自进化自学习与 Agent 团队** — 从交互中学习，团队协同进化，每次比上一次更好
3. **Harness 与安全** — 可信任边界内的自主行动，可审计、可回退、可恢复

工程框架：7 个问题域（A-G），见 [Phase 2 Problem Framework](phase-2/problem-framework.md)。

### 当前工程：P2.5 Runtime Governance

- [P2.5 Runtime Governance](2026-05-19-p2-5-runtime-governance.md)
- 局部门禁：`pnpm phase2.5:memory-probe`、`phase2.5:compact-probe`、`phase2.5:safety-probe`、`phase2.5:subagent-probe`、`phase2.5:cache-probe`、`phase2.5:governance-probe`
- P2.5 不再把搜索链路作为主瓶颈

### v0.1.0 发布

- [Open Source v0.1.0 Release](2026-05-22-open-source-v0-1-0-release.md)
- [Whiteboard Agent Alpha Readiness](2026-05-22-whiteboard-agent-alpha-readiness.md)

## 硬决策

- Vigilon Agent 的最终定位是任务优先的超级个人助手。
- Phase 2 的三目标框架：感知、自进化、安全——三者构成信任三角，不是独立工作流。
- 开源前仓库口径：experimental local whiteboard Agent runtime。
- 项目默认 DeepSeek 模型固定为 `deepseek-v4-flash`，除非显式传入 `--model` 或设置 `DEEPSEEK_MODEL`。
- v0.1.0 基础可用性：`vigilon init`、`vigilon tools`、project instructions 注入。
- Phase 1/2/3 历史文档中的 closure 语言只说明历史实现，不再自动等于当前能力完成。
- Phase 2 和 Phase 3 都重新打开：此前 CLOSED / closure 报告只作为历史实现记录。
- Coding workflow 是基础形态，不是最终产品边界。
- Codex/Claude Code 只作为历史参照，不再是公开叙事的中心。
- 当前不做 remote / bridge / multi-user / enterprise / admin / billing / telemetry / marketplace。
- Claude Code / research 源码镜像已移除。

## 路线图

- [Phase 2 Roadmap](roadmaps/phase-2-roadmap.md)（待更新）
- [P2-P5 路线图讨论稿](roadmaps/2026-05-18-roadmap-from-p2-to-p5.md)（历史）
- [P2-P3 执行计划](roadmaps/2026-05-18-p2-p3-execution-plan.md)（历史）
- [P2.5 执行计划](roadmaps/2026-05-19-p2-5-execution-plan.md)

## 历史文档

历史阶段文档已归档至 [archive/](archive/)。

- [Phase 1](archive/phase-1/) — Copy-First 机制、Solo Runtime Parity、产品定位基线
- [Phase 2 旧方向](archive/phase-2-old/) — Claude Code 对齐、能力审计、Closure 报告
- [Phase 3](archive/phase-3/) — TUI、Self-Hosting、Closure 报告
- [Phase 2 历史探索](phase-2/explorations/) — Agent Society 讨论线、19 问题域
