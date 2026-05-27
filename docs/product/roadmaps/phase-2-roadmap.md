# Phase 2 Roadmap

最后更新：2026-05-27

## 当前状态

Phase 2 方向已在 2026-05-27 重构。旧 "Agent Society" 讨论线存档在 [explorations/](../phase-2/explorations/)。

P2.5 Runtime Governance 工程仍在进行中。Phase 2 的新方向将吸收 P2.5 的成果（memory runtime、compact runtime、safety/sandbox runtime、subagent/task host runtime），但不以 P2.5 的 closure 为 Phase 2 的完成标准。

## 三阶段推进

### 第一阶段：认知基础设施（当前 — 2026 Q2）

在 P2.5 Runtime Governance 基础上，建立 Phase 2 的架构基础：

- **Belief Registry** — 带 source/evidence/epistemic category/expiry 的一等信念存储
- **Memory Ownership Model** — user/project/organization/agent/tool 五层所有权
- **Trust Boundary Architecture** — 所有外部输入的统一信任边界入口
- **Action Classification** — 可逆/需确认/需人在场/禁止 四层行动分类
- **Audit Trail** — 可回放的密码学绑定行动链

对应问题域：B（信念/知识/记忆）、F（运行时安全）、G（行动授权/审计）

### 第二阶段：智能与进化（2026 Q2-Q3）

在认知基础设施上构建感知和进化能力：

- **Knowledge Metabolism Pipeline** — 候选 belief → 验证 → 整合 → 提升 → 过期
- **Intent Translation** — 模糊意图 → 可执行计划，不需要用户写 prompt
- **Adaptive Stewardship** — 介入阈值光谱（代办/陪跑/质询/放权）
- **Life Segment Checkpoints** — 长任务的可恢复分段
- **Objective Drift Detection** — 跨 compact 的目标偏移检测
- **Evolution Verification** — 进化前后核心场景回归验证
- **Behavior Drift Detection** — 模型/配置更新后的行为变化检测

对应问题域：A（意图与引导）、C（规划与连续性）、D（自进化）

### 第三阶段：协作与扩展（2026 Q3+）

- **Agent-to-Agent Protocol** — 冲突治理、交接标准、背书与质疑
- **Multi-Model Adaptation** — 模型感知而不模型锁定
- **Cross-Session Continuity** — 用户下线再回来的快速上下文重建
- **Failure Mode Taxonomy** — 系统性失败模式分类与定向改进
- **Security Friction Tuning** — 基于用户反馈的安全分级优化

对应问题域：E（多 Agent 协作）、D（自进化深化）、F（安全深化）

## 明确不纳入 Phase 2 路线图

以下在问题域重估中被识别为超出 Vigilon Phase 2 可控范围，做接口预留但不排入工程：
- Agent identity 行业标准
- Agentic commerce 交易证明链
- C2PA/水印集成
- 法律合规规则库
- 跨组织 Agent 治理

## 历史路线图

- [P2-P5 路线图讨论稿](2026-05-18-roadmap-from-p2-to-p5.md)（2026-05-18，旧方向）
- [P2-P3 执行计划](2026-05-18-p2-p3-execution-plan.md)（2026-05-18，旧方向）
- [P2.5 执行计划](2026-05-19-p2-5-execution-plan.md)（2026-05-19，当前工程）
