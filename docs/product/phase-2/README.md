# Phase 2：可感知、可进化、可信任的 Agent Runtime

## Phase 2 目标

Phase 2 不是在 Phase 1 上叠加功能，而是重新定义 Vigilon 的产品核心。三个目标：

1. **用户需求感知，主动帮助用户** — Agent 不等用户开口，从环境、历史和工作模式中理解用户真正需要什么
2. **自进化自学习与 Agent 团队** — Agent 从每一次交互中学习，Agent 团队协同进化，下一次比上一次更好
3. **Harness 与安全** — Agent 在可信任的边界内行动，可审计、可回退、可恢复

这三个目标不是独立的工作流。它们构成一个**信任三角**：

- 感知 → 自进化：知道用户需要什么，才能朝对的方向进化
- 自进化 → 安全：进化中的 Agent 需要持续安全验证
- 安全 → 感知：没有安全边界的感知就是隐私侵犯

## 七问题域框架

Phase 2 的工程范围被组织为 7 个问题域，每个域回答一个核心冲突：

| # | 领域 | 核心冲突 | 目标 |
|---|------|---------|------|
| A | 意图理解与适应性引导 | 用户说不清楚时帮他想清楚，说错时敢质疑，知道要什么时不挡路 | 感知 |
| B | 信念、知识与记忆架构 | Agent 需要知道自己知道什么、怎么知道的、有多确定、什么时候过期 | 感知+进化+安全 |
| C | 规划与长程连续性 | 上下文不断死亡，但目标、约束和决策理由不能一起死 | 进化 |
| D | 自进化与持续学习 | 从每次交互中学习，但学到的可能是错的——怎么验证、怎么回退 | 进化 |
| E | 多 Agent 协作 | 多 Agent 不只是"启动更多 worker"，还有冲突、污染和责任 | 进化 |
| F | 运行时安全与信任边界 | 安全要有效，但不能重到用户绕过它 | 安全 |
| G | 行动授权、审计与成本治理 | 谁可以做什么、怎么记录、怎么从事敌中学、成本怎么呈现 | 安全 |

详细框架见 [problem-framework.md](problem-framework.md)。

## 产品原则

- **Belief over Text**：Agent 的核心认知单位不是文本，是带来源、证据强度、认知类别和过期条件的信念。
- **Memory with Ownership**：记忆有主人——用户、项目、组织、Agent、工具——各有不同的权限和生命周期。
- **Trust First, Then Autonomy**：自主性在可信任边界内逐步授予，不是一次性开关。
- **Evolution with Rollback**：每次进化必须可验证、可回退，进化历史像 git history 一样可追溯。
- **Friction-Aware Security**：安全机制的假阳性代价可能高于漏过一次攻击，分级响应比一律阻断更重要。
- **Learn by Working**：用户在与 Agent 协作中自然提升 AI fluency，不需要先成为 prompt engineer。

## 文档结构

- [product-doctrine.md](product-doctrine.md) — 产品哲学与三目标框架（Phase 3+ 愿景）
- [problem-framework.md](problem-framework.md) — 七问题域详细定义（长期愿景）
- [capability-alignment-plan.md](capability-alignment-plan.md) — Phase 2 能力对齐计划
- [tool-composition-design.md](tool-composition-design.md) — 工具组合系统设计（分区并行执行）
- [competitive-analysis.md](competitive-analysis.md) — 对标分析（Codex & Claude Code 2026 年 5 月）
- [perception-research.md](perception-research.md) — 用户感知机制深度调研
- [explorations/](explorations/) — 历史探索文档（19 问题域、Agent Society 讨论线）
- [../roadmaps/](../roadmaps/) — 路线图

## 与旧 Phase 2 的区别

旧 Phase 2 以 "Agent Society"（Agent 社会）为核心概念，围绕 life physics、human-like behaviors、social institutions 展开。这个方向在 2026-05-25 的 [问题域重估](explorations/agent-era-problem-map.md) 后被重构。

新 Phase 2 保留了旧方向的核心洞察（belief registry、knowledge metabolism、long-horizon continuity、memory commons），但：
- 将 19 个分散问题域重构为 7 个有清晰核心冲突的领域
- 将自进化从子问题提升为独立一级领域（对应三大目标之一）
- 将产品可控问题与社会/行业标准问题分离
- 补上了 onboarding、用户纠错、安全摩擦、多模型适配等盲区

重构的完整逻辑见 [explorations/question-quality-review.md](explorations/question-quality-review.md)。
