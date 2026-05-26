# Phase 2 方向讨论：从 Agent 社会到 Adaptive Agent Team

> 讨论时间：2026-05-26
> 状态：方向级讨论，非工程计划

## 一、问题的起点

Phase 2 最初的目标是"Agent 社会产品"——多个 Phase 1 原子 Agent 组成社会，用户通过 colony-sim 风格的前端观察社会运行。

我们做了几轮原型：
- 社会行为模块（cooperation / delegation / consultation / competition / endorsement / observation / dispute）
- 自主演化引擎（evolve.ts）
- 声誉系统和角色检测
- Phase 1 session 数据适配器
- Fetch 驱动的前端仪表板（去按钮，纯观察）

## 二、原型暴露的问题

回顾日志时发现了几个根本性问题：

1. **Agent 没有真正参与互动** — 社会引擎（evolve.ts）用 if/else 规则替 Agent 决策，Agent 本身的 LLM loop 从未参与社会行为
2. **行为发生得过于简单** — "合作"就是 trust >= 40 → accepted → trust +8，没有 Agent 之间的真实沟通
3. **社会事件空洞** — 日志只记录结果（"A 和 B 合作了"），不记录为什么合作、怎么协商的、结果如何
4. **研究结论被忽视** — 多 Agent 系统研究一致表明：规则引擎不能替代 Agent 自主决策，社会行为是涌现的，不是被调度的

## 三、关键判断：Agent 社会 vs Agent 团队

经过讨论，我们意识到一个重要的区分：

### Agent 社会（远期愿景）

回答的是：长期、多主体、大规模、半自治系统中，关系、规范、声誉和制度如何形成。

这对应 Problem Map 中的"集体 agency 治理"、"多 Agent 时代的多人合作"等问题。但它不是 Phase 2 当前应该解决的产品形态。

### Agent 团队（Phase 2 产品核心）

回答的是：用户如何把一个目标交给多个 Agent，由 Agent 自主组织、执行、审查、控制风险，并在每次任务后进化。

这更直接地回答了 Problem Map 中的核心问题：
- 意图形成：Agent 团队帮助用户澄清目标
- 需求协商：执行前 Agent 之间互相质疑和协商
- 集体治理：谁有权合并、谁必须保留异议
- 长周期连续性：复杂任务拆成多个 session 后如何交接
- 事故学习：出问题后团队流程如何改进
- 劳动重组：普通用户如何不被训练成 Agent 管理者

## 四、Adaptive Agent Team 的核心设计

### 4.1 Agent Team OS — 通用层

不管什么领域、什么任务，Agent 团队都有不变的核心结构：

1. 理解目标（Intake）
2. 拆解任务（Breakdown）
3. 分配角色（Role Assignment）
4. 执行（Execution）
5. 检查（Review）
6. 处理风险（Risk Handling）
7. 交付结果（Delivery）
8. 复盘学习（Retrospective）

Phase 2 的核心不是做"金融 Agent"或"代码 Agent"，而是做一个通用的 **Agent Team OS**，提供：

- **Task Intake**：理解用户目标，判断复杂度和风险等级
- **Complexity/Risk Classification**：决定任务简单还是复杂、高风险还是低风险
- **Role Assignment**：根据任务需要和 Agent 能力地图，动态分配角色
- **Delegation Protocol**：如何拆任务、如何交接上下文
- **Review Protocol**：执行结果如何被审查
- **Escalation Protocol**：什么时候问用户，什么时候自主决策
- **Memory Protocol**：哪些经验沉淀为团队记忆
- **Retrospective Protocol**：任务后如何复盘并改进流程

### 4.2 Domain Playbook — 场景层

通用角色（Planner / Executor / Reviewer / Risk Controller / Memory Keeper / Domain Specialist）在不同领域加载不同的 playbook：

| 领域 | Reviewer 关注点 | Risk Controller 关注点 |
|------|----------------|----------------------|
| 代码 | 正确性、测试、安全 | 破坏性变更、生产影响 |
| 金融 | 合规、假设、数据来源 | 金额、权限、审计 |
| 教育 | 概念准确性、学生理解度 | 误导、适龄性 |
| 工业 | 安全、流程、设备 | 物理风险、不可逆操作 |

架构：

```text
Agent Team OS（通用组织机制）
  ├── Code Playbook
  ├── Finance Playbook
  ├── Education Playbook
  └── Industrial Playbook
```

### 4.3 动态组队 — 任务复杂度层

团队不是固定人数，而是根据任务自动选择拓扑：

| 任务类型 | 团队形态 |
|---------|---------|
| 极简单（改 typo） | 单 Agent |
| 简单但要准确 | 单 Agent + self-check |
| 中等复杂 | Planner + Executor + Reviewer |
| 多模块复杂 | Lead + 多 Executor + Reviewer |
| 高风险 | Risk Controller + Human Gate |
| 长周期 | Memory Keeper + Handoff Agent |

同一个 Team OS，不同任务触发不同的团队拓扑。不是一套流程通吃，而是根据任务自动裁剪。

### 4.4 团队如何进化

进化不是"Agent 关系越来越复杂"，而是团队的组织能力在四个维度上积累：

**Capability Map 进化**：系统逐渐知道哪个 Agent 擅长什么、哪个 Agent 容易在哪类任务犯错、哪些 Agent 组合效果好、哪些场景必须加 Reviewer

**Playbook 进化**：每次任务后复盘——哪一步浪费了、哪一步漏检了、哪个风险没提前发现、哪个检查点应该固定下来。成功经验沉淀为 playbook，事故沉淀为 guardrail

**Role 进化**：角色从粗到细自然分化——Planner 可能分化出 Codebase Navigator / Migration Reviewer / Security Reviewer / Cost Controller 等

**Workflow 进化**：团队学会哪些任务不用计划、哪些必须先探索、哪些必须并行、哪些必须人工确认

## 五、与 Phase 1 的关系

Phase 1 Agent 仍然是原子 Agent（独立的 transcript / memory / permissions / loop）。Phase 2 不修改 Phase 1，而是在其上叠加：

- **团队组织形式**：定义角色、职责、检查点、交接协议
- **团队记忆**：区别于 Agent 私有的 session memory，团队级别的共享知识
- **Domain Playbook**：可插拔的场景规范
- **复盘机制**：任务后进化能力地图和流程

## 六、与当前原型的关系

保留的：
- Phase 1 session 数据格式和理解
- 前端纯观察仪表板的方向（去按钮）
- Dream 的记忆整理逻辑
- 角色检测的概念（但实现方式要变）
- 信任/声誉的概念（但计算方式从机械 delta 改为统计推断）

推倒的：
- `evolve.ts` — 社会引擎不再存在
- 6 个行为模块（cooperation / delegation / consultation / competition / endorsement / observation）
- 单 Agent 的 sleep/wake 模式
- 随机 pair 选择 + if/else 规则的所有逻辑

新的核心：
- **Agent Team OS**：通用组织机制
- **Domain Playbook**：可插拔的场景规范
- **动态组队**：根据任务自动生成团队拓扑
- **复盘进化**：从任务经验中持续改进
