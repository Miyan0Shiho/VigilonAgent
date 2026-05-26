# Agent 社会的问题在哪，以及 Agent 团队的差异化

## 一、Agent 社会为什么回答不了你的问题

Agent 社会的核心隐喻是"社会"——多个主体长期互动，关系、规范、制度从中涌现。研究也证实了这一点：三角闭合、优先连接、同质性会自发产生。

但你的 19 个问题不是"社会如何形成"的问题。它们是：

> 一个用户如何把复杂目标交给多个 Agent，并且信任结果？

这个问题有明确的主语（用户）、明确的动作（交付目标）、明确的验收（信任结果）。社会回答不了它，因为：

| Agent 社会 | 用户真正需要的 |
|-----------|-------------|
| 横向的（Agent 之间平等互动） | 纵向的（有人对结果负责） |
| 描述性的（观察什么在涌现） | 规范性的（确保什么该发生） |
| 长周期的（规范慢慢形成） | 即时的（这次任务就要做对） |
| 关注关系演化 | 关注任务完成 |
| 用户是旁观者 | 用户是目标设定者和最终裁决者 |

社会不是错，但它是**远期愿景**，不是**当前产品**。当用户说"帮我重构权限系统"，ta 需要的是一个能自主组织、执行、审查、交付的团队，不是一个会慢慢形成信任关系的社会。

## 二、Agent 团队如何回答 19 个问题

以下逐一映射：

### 1. 意图形成（Intention Formation Gap）
→ **Team Intake**：不是聊天框等用户输入完美 prompt。团队主动感知用户环境、历史、工作模式，提出"你可能需要做 X"

### 2. 需求协商（Requirement Negotiation）
→ **Team Debate before Execution**：不是一次调用就开始执行。Planner 提出方案 → Reviewer 质疑 → Executor 评估可行性 → 达成一致或保留分歧 → 再执行

### 3. 自适应引导（Adaptive Stewardship）
→ **User Liaison Role**：团队里有一个角色专门负责理解用户水平、调整沟通密度。新手得到更多解释，专家得到更少打扰

### 4. 集体治理（Collective Agency Governance）
→ **Role-based Authority**：不是所有 Agent 平等。Planner 有权拆任务，Reviewer 有权阻止执行，Risk Controller 有权要求人工确认。异议记录在案，不被沉默

### 5. 长周期连续性（Long-Horizon Continuity）
→ **Memory Keeper + Handoff Protocol**：复杂任务拆成多个 session 后，Memory Keeper 确保关键约束不丢失，Handoff 携带完整上下文

### 6. 认知纪律（Epistemic Discipline）
→ **Evidence Chain**：每个关键判断记录来源、证据、置信度、过期条件。Reviewer 负责检查证据链是否完整

### 7. 深度动态规划（Deep Planning）
→ **Planner Role + Pivot Detection**：规划不是一次性的。执行过程中持续检测"继续执行是否越来越错"，触发重新规划

### 8. 环境适应（Environment Adaptation）
→ **Domain Bootstrapping Protocol**：进入陌生领域时，先感知环境（数据结构、风险边界、术语、权限），再行动。形成 Domain Playbook 后复用

### 9. 企业安全与事故恢复（Enterprise Safety）
→ **Risk Controller + Audit Trail**：高风险行动必须有 blast radius 评估、回滚方案、审批记录。事故发生后可还原完整行动链

### 10. 运行时安全（Adversarial Security）
→ **Multi-layer Review**：不只靠单一 Agent 判断。外部输入经过 Executor → Reviewer → Risk Controller 三层检查

### 11. 知识代谢（Knowledge Metabolism）
→ **Team Retro**：不只是 Agent 个人记忆整理。每次任务后团队复盘：哪些知识已过时、哪些需要更新、哪些是从不可信来源获得的

### 12. 经济性（Agency Economics）
→ **Cost-aware Task Routing**：简单任务不调用重团队。团队知道什么时候值得花钱、什么时候应该停止

### 13. 记忆与身份（Memory Ownership）
→ **Layered Memory**：个人记忆（Agent 私有）、团队记忆（共享）、项目记忆（跨团队）。每层有明确的 scope、owner、expiry

### 14. Agentic Web（Browser Agent 信任）
→ **Evidence Provenance**：从网页获取的信息标记来源、可信度、获取时间。不把"网页上写的"直接当成"事实"

### 15. 劳动重组（Labor Recomposition）
→ **User as Governor, not Manager**：用户不需要学习如何管理 Agent。团队自己管理自己。用户设定目标、批准高风险行动、接收结果

### 16. 运维可靠性（Operational Reliability）
→ **Playbook as Test Suite**：每个 Domain Playbook 自带验证标准。模型更新后先跑 playbook 的回归测试

### 17. 法律可委托性（Legal Delegability）
→ **Action Classification**：每类行动有明确的委托等级（可自动 / 需确认 / 需人在场 / 不可委托）。团队在行动前检查

### 18. 学习负担（Learning Burden）
→ **Guided Onboarding**：团队主动了解用户水平。新用户不是面对空白聊天框，而是面对一个已经知道怎么帮 ta 的团队

### 19. 超个体分化（Super-Individual Divide）
→ **Team as Capability Equalizer**：团队补齐个人短板。用户不会写代码 ≠ 用户不能用 Agent 做复杂工程任务

## 三、为什么能解决真实复杂问题

真实复杂问题不是"帮我写一个函数"，而是：

> "这个遗留系统有 3 年历史、14 个模块、没有测试、文档过时、部分依赖已废弃。我需要你帮我搞清楚现状，然后逐步现代化，同时不能影响线上运行。"

这种问题不能靠一个 Agent 单打独斗，也不能靠用户逐步发指令。

**Agent 团队的处理方式：**

1. **Sensing Phase**：Explorer Agent 扫描代码库、依赖图、git 历史、线上配置，生成当前状态报告
2. **Planning Phase**：Planner 提出现代化路径（先做什么、后做什么、每步的风险和回滚方案）
3. **Debate Phase**：Reviewer 质疑计划中的假设，Risk Controller 标记高风险步骤
4. **Execution Phase**：多 Executor 并行工作，各自负责独立模块
5. **Integration Phase**：Integrator 合并结果，Reviewer 验证一致性
6. **Delivery Phase**：Memory Keeper 生成"我们做了什么、为什么这样做、有哪些已知风险"的交付文档
7. **Retro Phase**：团队复盘，更新能力地图和 playbook

用户不需要理解这个流程。ta 只需要说"帮我现代化这个系统"，然后在高风险步骤时被询问"这一步可能影响线上用户，确认继续？"

## 四、相比其他产品的差异

当前市场上的 Agent 产品可以分为几类：

### 单 Agent 工具（Claude Code / Codex / Cursor / Devin）
- 一个 Agent 做所有事
- 用户逐步发指令
- 没有内建的审查、风控、团队协作
- 复杂任务需要用户自己拆解

**我们的差异**：不是单兵作战，是团队自主协作。用户不需要拆任务、不需要审查每个步骤。

### 多 Agent 框架（LangChain / CrewAI / AutoGen / MetaGPT）
- 提供 Agent 编排能力
- 但需要用户（开发者）设计工作流、定义 Agent 角色、写 prompt
- 本质上是"Agent 编排框架"，不是"Agent 团队产品"

**我们的差异**：不是框架，是产品。用户不需要设计工作流。团队自己根据任务类型形成合适的结构。

### 垂直 Agent（Harvey / Cognition / Factory）
- 深度绑定特定领域（法律、代码、工业）
- 在领域内很强，但跨领域无力
- 不做通用团队结构

**我们的差异**：通用 Team OS + 可插拔 Domain Playbook。核心机制跨领域复用，领域知识通过 playbook 注入。

### 关键差异化总结

| 维度 | 其他产品 | Vigilon Agent Team |
|------|---------|-------------------|
| 用户角色 | Prompt engineer / 流程设计师 | 目标设定者 + 最终裁决者 |
| 任务分解 | 用户自己做 | 团队自主拆解 |
| 质量控制 | 用户自己审查 | 团队内建 Reviewer |
| 风险管理 | 没有或用户全责 | 团队内建 Risk Controller |
| 跨领域 | 通常绑定单一领域 | 通用 OS + domain playbook |
| 记忆 | 单 session 或简单的 project memory | 分层记忆（个人/团队/项目） |
| 进化 | 每次从头开始 | 每次任务后复盘，能力地图和 playbook 持续改进 |
| 复杂度适应 | 一套流程 | 根据任务动态组队 |
| 可解释性 | 黑盒 | 完整证据链和决策溯源 |
| 普通用户可用性 | 需要 prompt 技能 | 团队主动理解用户意图 |

## 五、从 Agent 社会继承什么

Agent 社会不是被抛弃，而是被重新定位为**远期愿景**。从社会研究中继承的东西：

- **角色涌现**（roles.ts 的检测逻辑）→ 团队中角色从实际表现中分化，不是预设
- **声誉与信任**→ 能力地图和信任档案，从任务结果中统计，不是机械赋值
- **规范形成**→ Playbook 从成功和失败中进化，是社会"先例"的产品化版本
- **冲突处理**（dispute 的多阶段模型）→ 团队内部 Review 和 Debate 的机制
- **Sleep/Dream**→ 团队复盘（Retro）是单 Agent Sleep 的团队级版本

这些概念不变，但实现方式从"让 Agent 自由互动然后观察"变成"在团队执行框架内让这些现象发生并被记录"。
