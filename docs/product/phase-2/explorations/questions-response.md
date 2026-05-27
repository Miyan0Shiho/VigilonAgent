# Phase 2 19 Questions Response

## Status

本文档是对 `PHASE2_AGENT_ERA_PROBLEM_MAP.md` 中 19 个问题域的系统回答。
撰写日期：2026-05-27。需要随研究和产品迭代持续更新。

---

## 三目标框架（迭代版）

你提出的三个目标：

1. **用户需求感知，主动帮助用户** — User Need Perception & Proactive Help
2. **自进化自学习与 Agent 团队** — Self-Evolution, Self-Learning & Agent Team
3. **Harness 与安全** — Harness & Security

这三个目标的真正力量在于它们的**相互构成关系**，而不是独立交付：

```
感知 ────────────→ 自进化
  │                  │
  │  信任三角        │
  │                  │
  └───── 安全 ←──────┘
```

- **感知 → 自进化**：知道用户真正需要什么，才能朝着对的方向进化
- **自进化 → 安全**：进化中的 Agent 团队需要持续的安全验证，否则会进化出漏洞
- **安全 → 感知**：没有安全保障的感知就是隐私侵犯；用户信任是感知的前提
- **感知 + 安全 → 自进化**：在安全边界内学习用户需求，形成正向飞轮
- **自进化 + 感知 → 安全**：通过学习攻击模式、事故经验来强化安全
- **安全 + 自进化 → 感知**：安全框架随用户需求进化而自适应

**一个迭代建议**：三个目标的核心交汇点是 **Trust（信任）**。也许可以显式化为第四个维度，或者作为三个目标的公共基底：用户信任（所以让 Agent 感知自己）、组织信任（所以让 Agent 进入生产）、社会信任（所以让 Agent 代表人类行动）。

---

## 19 个问题域的回答

> 每个问题域的格式：
> - **核心洞察**：这个问题域的本质是什么
> - **子问题回答**：逐一回答 Phase 2 问题
> - **目标映射**：服务于三个目标中的哪些
> - **Phase 2 范围**：哪些现在做，哪些以后做
> - **研究基础**：最新的外部信号

---

### 1. Intention Formation Gap（意图形成断层）

**核心洞察**：Agent 时代的真正瓶颈不在执行，而在 "prompt 之前"——用户不知道能让 Agent 做什么，也不知道怎么把模糊目标变成可执行任务。聊天框默认用户有清晰意图，但普通用户只有情境、焦虑和模糊愿望。

**子问题回答**：

- **Agent 能否帮助用户发现自己真正想解决的问题？**
  能，但需要换一个交互范式。聊天框是被动的——等用户开口。主动感知需要：环境感知层（文件系统、日历、邮件、项目上下文）+ 模式识别（"你最近三天都在修同一个 bug，要不要我做个根因分析？"）+ 轻量建议（非侵入式通知，不是阻塞式对话框）。关键设计原则：**建议必须可忽略，不能变成新的打扰**。

- **Agent 能否从用户的环境中推断"可能值得做的事"？**
  能，而且 2026 年的研究已经给出了一些路径。PASK（arXiv:2604.08000）提出了 DD-MM-PAS 范式：Demand Detection → Memory Modeling → Proactive Agent System，用 IntentFlow 模型从用户行为流中检测潜在需求。ProAgent（arXiv:2512.06721）在 AR 眼镜上实现了分层感知——低成本的线索持续监测，高成本的深度感知按需触发。对 Vigilon 的启示：**先做文件系统和项目上下文的感知，再做更广泛的环境感知**。

- **Agent 能否提供从 novice 到 expert 的不同引导密度？**
  必须能。这不是一个"新手模式 on/off"开关，而是一个**连续自适应光谱**：
  - Novice：解释选项、建议方案、展示推理过程
  - Intermediate：确认假设、提供替代视角
  - Expert：零干扰 cockpit，只在风险/异常时介入
  - 判断依据：用户在该领域的熟练度（不是全局熟练度）、任务风险等级、时间压力、用户历史偏好

- **Agent 能否避免把用户训练成 prompt engineer？**
  这是 Vigilon 的核心差异化机会。避免方式：
  - 接受自然语言、模糊目标、举例、情境描述——不需要结构化 prompt
  - 系统负责"翻译"模糊意图为可执行计划，并展示翻译过程（让用户学习但不强制）
  - 不奖励"写了好 prompt"的行为；奖励"表达了真实需求"的行为

**目标映射**：核心服务于 Goal 1（用户需求感知），是感知链的第一环。

**Phase 2 范围**：
- 现在做：环境感知基础层（文件系统、项目上下文）、意图推断原型
- 以后做：全场景感知（邮件、日历、浏览器）、主动建议系统、完整自适应光谱

**研究基础**：
- PASK / IntentFlow (arXiv:2604.08000) — 流式需求检测 + 混合记忆
- ProAgent (arXiv:2512.06721) — 分层感知 + 主动推理
- KnowU-Bench (arXiv:2604.08455) — 模糊指令下的偏好推断评测
- IntentRL (arXiv:2602.03468) — RL 训练的意图澄清

---

### 2. Requirement Negotiation Before Execution（执行前需求协商）

**核心洞察**："把错误需求做对"是 Agent 时代最大的浪费。现有工具只保证执行不跑偏，不保证方向对。Agent 需要在执行前像 good colleague 一样质疑需求。

**子问题回答**：

- **Agent 是否能在执行前判断需求质量？**
  需要一个 **requirement council**（需求理事会）——不是单个检查点，而是多维评估：
  - 成熟度：需求是否清晰、完整、可测试？
  - 一致性：需求内部是否矛盾？和已有系统是否冲突？
  - 风险：失败后果是什么？是否可逆？
  - ROI：预期收益是否值得预期成本？
  评估结果不是"通过/拒绝"，而是**风险等级 + 建议的确认步骤**。

- **Agent 是否能主动提出替代目标？**
  能，且应该。关键设计：
  - 不只问澄清问题（"你说的 X 具体指什么？"）
  - 而是提替代方案（"你想做 X，但 Y 可能用一半成本达到 80% 效果，要不要先试试？"）
  - 替代方案必须附带推理链，让用户能做 informed decision

- **Agent 是否能区分"说不清楚"和"没想清楚"？**
  有行为信号可以区分：
  - "说不清楚"：反复换表述但核心不变、补充例子、对澄清问题有明确回应
  - "没想清楚"：核心目标随表述变化、给不出具体例子、对澄清问题的回答矛盾
  - 前者 → 帮助翻译；后者 → 帮助思考（头脑风暴模式）

- **Agent 是否能在必要时反对用户？**
  能，但要极度克制。反对的触发条件应该是：
  - Agent 对风险的置信度 > 用户对方案的置信度
  - 行动的不可逆性高
  - 存在明显更优的替代方案
  反对方式不是"你错了"，而是"这个方向有 X、Y、Z 风险，我建议先做 A 来验证假设"。

**目标映射**：核心服务于 Goal 1（需求感知的第二环——不只是感知需求，还要校准需求）。同时触及 Goal 3（风险判断是安全的前置）。

**Phase 2 范围**：
- 现在做：需求评估 checklist、基本的风险/ROI 判断、替代方案建议原型
- 以后做：完整 requirement council、多 Agent 需求辩论、需求质量 metrics

---

### 3. Adaptive Stewardship（适应性引导）

**核心洞察**："秘书/管家/老师"这些隐喻指向真实需求——用户需要被引导，但这些词也携带了固定人格和阶层隐喻的风险。正确的产品概念是 **adaptive stewardship**：根据用户熟练度、任务风险、领域陌生度和时间压力，动态调整介入方式。

**子问题回答**：

- **新手需要的是老师、秘书还是任务翻译器？**
  都不是单一角色。新手需要的是**动态混合**：
  - 任务翻译器（核心）：把模糊目标翻译成可执行计划
  - 老师（按需）：解释为什么这样做、有哪些替代方案
  - 秘书（辅助）：管理上下文、追踪进度、提醒遗漏
  同一个用户在不同领域可能处于不同级别——可能在代码领域是 expert，在金融分析领域是 novice。

- **专家需要什么？**
  低干扰 cockpit：关键指标可见，异常自动标记，深度控制 accessible but not in the way。类似飞机 cockpit——巡航时安静，异常时醒目，所有控制可达但不堆在面前。

- **系统如何判断当前需要什么模式？**
  多维信号：
  - 领域熟练度：用户在该领域的操作历史、错误率、求助频率
  - 任务风险：不可逆性、影响范围、时间压力
  - 用户状态：连续工作时长（疲劳 → 更多引导）、操作节奏变化（犹豫 → 可能需要建议）
  - 显式偏好：用户可以 override 任何自动判断

- **Agent 如何避免把引导变成打扰？**
  三条原则：
  - 默认静默可用，不弹窗不阻断
  - 只在风险/异常/用户犹豫时主动介入
  - 用户可全局调节介入阈值（"多帮帮我"←→"少打扰我"）

**目标映射**：核心服务于 Goal 1（感知之后的行动——怎么帮）。反馈到 Goal 2（用户对引导的反馈帮助系统进化引导策略）。

**Phase 2 范围**：
- 现在做：用户熟练度追踪（按领域）、基本模式切换、介入阈值滑块
- 以后做：完整 adaptive stewardship 引擎、疲劳检测、跨领域熟练度迁移

---

### 4. Collective Agency Governance（集体主体治理）

**核心洞察**：多 Agent 的关键不是"启动更多 Agent"，而是**多个数字主体与多人协作时，如何治理**。这是 Vigilon 和普通 multi-agent orchestration 的分界线。编排关心任务拆分；Vigilon 应该关心 agency 如何在多人、多 Agent、多权限、多预算之间治理。

**子问题回答**：

- **多 Agent 结论冲突时，谁有权合并，谁必须保留异议？**
  分层决策权：
  - 每个决策域有 designated "decider"（可能是 Agent 或人）
  - 异议不删除，进入 **belief ledger**（信念账本），标注"此结论存在分歧，详见 X"
  - 后续 Agent 读取时能看到主流结论 + 少数意见 + 各自的证据强度
  - 类似司法判决中的 majority opinion + dissenting opinion

- **多个人类 owner 目标冲突时，Agent 听谁的？**
  Agent 不选边。Agent 应：
  1. 检测并显式化冲突（"A 要求 X，B 要求 Y，两者在 Z 维度上矛盾"）
  2. 评估各自的影响范围、风险、成本
  3. 升级给人类协商，而不是悄悄选一个
  4. 记录冲突和解决过程

- **Agent 之间如何背书、质疑、交接和承担后果？**
  - 背书（Endorse）："我基于证据 E 担保结论 C 在此范围内有效"
  - 质疑（Challenge）："结论 C 的假设 A 在场景 S 下不成立，因为..."
  - 交接（Handoff）：完整 state snapshot + open questions + risk summary + 未验证假设
  - 后果：每个 Agent 的行动签名进入审计链

- **Token 成本、时间成本和收益如何归因？**
  按 Agent × 任务 × 项目打标签。不是事后分析，是运行时追踪。类似云计算按资源 tagging 做 cost allocation。

- **企业里 Agent 造成损失，责任落在谁？**
  责任链模型（从近到远）：
  1. 人类批准者（如果有 approval gate）
  2. Agent 配置者（设定了权限、策略、约束）
  3. 工具/权限系统（是否提供了不该提供的权限）
  4. 模型供应商（是否存在已知缺陷）
  5. 组织流程（审批、监控、回滚机制是否健全）
  关键在于：**不能把责任停在"Agent 做错了"**——那不是可追责的终点。

**目标映射**：核心服务于 Goal 2（Agent 团队的组织方式）和 Goal 3（治理是安全的上层建筑）。多 Agent 治理同时需要感知（Goal 1）来理解人类意图冲突。

**Phase 2 范围**：
- 现在做：belief ledger 基础结构、基本的决策权模型、成本 tagging
- 以后做：完整治理协议、跨组织 Agent 治理、法律责任链标准化

**研究基础**：
- EVOCHAMBER (arXiv:2605.11136) — Agent 团队协同进化
- TacoMAS (arXiv:2605.09539) — 快慢双环团队架构演化
- LIFE Survey (arXiv:2605.14892) — 多 Agent 系统 Lay→Integrate→Find faults→Evolve

---

### 5. Long-Horizon Continuity（长程连续性）

**核心洞察**：超长任务（16h+、数百次 compact）的核心挑战不是 context engineering，而是**当上下文不断死亡，如何维持目标、信念、计划和责任的连续性**。

**子问题回答**：

- **什么是不可压缩的核心目标？**
  三层不可压缩信息：
  - **Objective**（为什么做）：原始目标陈述 + 不可商量的约束
  - **Decisions**（做了什么选择）：关键决策点 + 当时理由 + 排除的替代方案
  - **Beliefs**（基于什么信念行动）：当前仍活跃的关键信念 + 证据强度
  这三层在每次 compact 时必须保留，不可摘要压缩。

- **数百次 compact 后如何证明关键约束没丢？**
  需要 **constraint checksum** 机制：
  - 每次 compact 前，提取当前活跃约束的哈希
  - compact 后，验证约束仍在上下文中，重新计算哈希
  - 不匹配 → compact 失败，调整压缩策略
  - 类似数据库事务的完整性检查

- **哪些信息进入 memory，哪些进入 artifact，哪些进入 belief ledger？**
  三类存储的语义边界：
  - **Memory**：持久身份、长期知识、用户偏好、经验教训（"是什么"的持久部分）
  - **Artifact**：具体产出——代码、文档、配置、报告（"做了什么"的产物）
  - **Belief Ledger**：不确定的结论、假设、推断、预测（"相信什么"的可变部分，带证据和过期条件）
  当前很多系统把所有东西 dump 进 memory，这是错误的。

- **如何检测 objective drift？**
  周期性目标对齐检查：
  - 每 N 步或每小时，比较当前行动向量和原始目标向量
  - 余弦相似度低于阈值 → 标记 drift，请求确认或重定向
  - 不能只依赖 Agent 自己判断（自己不会发现自己跑偏）

- **如何拆成可恢复、可审计、可交接的 life segments？**
  **Life Segment** = checkpoint 的一种强化版：
  - State snapshot：当前完成了什么、正在做什么
  - Open questions：当前未解决的问题
  - Risk summary：当前已知风险
  - Unverified assumptions：仍在依赖但未验证的假设
  - Handoff notes：给下一个接手者（人或 Agent）的备注
  Life segment 之间是松耦合的——任何一个 segment 失败，可以从上一个 checkpoint 恢复。

**目标映射**：核心服务于 Goal 2（长任务是 Agent 团队协作的前提）。也触及 Goal 3（可审计性是安全的基础），以及 Goal 1（目标不漂移 = 用户需求不丢失）。

**Phase 2 范围**：
- 现在做：三层信息分类、objective drift 检测、life segment checkpoint
- 以后做：constraint checksum 验证、跨 session 连续性、可证明的 compact 完整性

---

### 6. Epistemic Discipline And Hallucination（认知纪律与幻觉）

**核心洞察**：Agent 幻觉不是"答错了"——当 Agent 能读写文件、调用工具、影响业务时，幻觉会变成**错误行动**。Agent 需要认知纪律：知道自己知道什么、不知道什么、相信什么、以及每一条信念的保质期。

**子问题回答**：

- **每个关键 belief 是否应该有来源、证据、适用边界和过期条件？**
  必须有。这是 Vigilon **belief registry** 的核心设计：
  ```
  Belief {
    content: "...",
    source: { type: observation | inference | testimony | authority, ref: "..." },
    evidence_strength: 0.0 - 1.0,
    scope: { domains: [...], conditions: "..." },
    expires: timestamp | condition,
    updated: timestamp,
    revision_history: [...]
  }
  ```
  2026 年的研究已经验证了这个方向。BeliefMem (arXiv:2605.05583) 证明了保留多个候选结论（带概率）优于存储单一确定性结论。Kumiho (arXiv:2603.17244) 证明了图数据库可以实现形式化的信念修正（AGM postulates）。

- **Agent 是否区分事实、推断、假设、计划和偏好？**
  必须区分。基本认知类别：
  - **Observation**：直接工具输出、传感器数据（"文件 X 的第 3 行是 Y"）
  - **Inference**：从事实推导的结论（"因为 A 和 B，所以可能是 C"）
  - **Assumption**：未验证的前提（"假设用户的环境是 Linux"）
  - **Plan**：意图执行的行动序列（"我将先做 X，再做 Y"）
  - **Preference**：价值判断（"方案 A 比方案 B 更优雅"）
  这些类别在 compact、handoff、和给后续 Agent 阅读时必须保留，不能被 summary 抹平。

- **Agent 是否能在不知道时保持行动克制？**
  需要**信心门控**（confidence gating）：
  - 不同风险等级的行动需要不同的信心阈值
  - 读文件：低阈值（错了也能恢复）
  - 修改文件：中阈值（需要确认）
  - 删除数据/调用外部 API/发邮件：高阈值（需要高信心或人工确认）
  - 当信心低于阈值 → Agent 应该说"我不确定，让我先验证 X"而不是猜测着行动

- **Agent 是否能把不确定性传递给后续 Agent？**
  这是当前所有系统都做得不好的地方。Summary 天然抹平不确定性。解决：
  - 不确定性必须是 belief 结构的一等字段，不能被摘要压缩
  - Compact 时必须保留不确定性区间（"可能是 A(60%) 或 B(30%)"而不是"是 A"）
  - 后续 Agent 读取 belief 时看到的是概率分布，不是确定性结论

**目标映射**：核心服务于 Goal 2（Agent 团队的认知基础——没有认知纪律就无法自进化）。同时服务于 Goal 3（很多安全事故源于 Agent 对错误信念的过激行动）。

**Phase 2 范围**：
- 现在做：belief registry 基础结构（source, evidence_strength, epistemic category）、信心门控、不确定性保留
- 以后做：AGM 形式化信念修正、跨 Agent belief 同步协议、自动过期和重新验证

**研究基础**：
- BeliefMem (arXiv:2605.05583) — 概率化信念存储 + Noisy-OR 更新
- Kumiho (arXiv:2603.17244) — AGM 形式化信念修正 + 图数据库实现
- ANCS (Zenodo) — 认知治理三层架构（Verbatim Boundary + Axion + TruthKeeper）
- TierMem (arXiv:2602.17913) — 分层记忆 + 证据充分性路由

---

### 7. Deep And Dynamic Planning（深度与动态规划）

**核心洞察**：Agent 不应只生成一次 plan 就盲目执行。Plan 应该是有 horizon、confidence、risk、cost 和 pivot condition 的**活文档**。

**子问题回答**：

- **Plan 是否有 horizon、confidence、risk、cost 和 pivot condition？**
  每个 plan node 应该携带元数据：
  - **Horizon**：这个步骤往前看多远（短视 vs 长远）
  - **Confidence**：这一步成功的信心（0-1）
  - **Risk**：如果这一步错了，影响多大（低/中/高 + 具体影响）
  - **Cost**：预估 token/时间成本
  - **Pivot condition**：什么条件下应该放弃这个 plan 重来
  这 5 个字段让 plan 从"一次性生成物"变成"可管理的工作假设"。

- **Agent 什么时候该继续，什么时候该重开规划？**
  重开规划的触发条件（pivot triggers）：
  - 证据与计划假设矛盾
  - 实际成本超过预估 N%（N 取决于任务风险等级）
  - 连续 M 步失败或低质量
  - 环境发生显著变化（新信息、新约束、新工具）
  - 人类主动要求重规划
  关键设计：**重规划不是惩罚，是正常的工作流程**。

- **多 Agent 的不同 plan 能否被比较、合并或保留为分叉世界线？**
  **世界线分叉（worldline fork）** 是一个强大的概念：
  - 当多个 Agent 对同一目标提出不同方案时，不是选一个丢弃另一个
  - 而是保留为 fork，记录分叉原因、各自假设、预期结果
  - 可以并行探索（如果成本允许），或选一个主线路 + 保留备选
  - 合并时机：当新证据表明某条线路更优，或两条线路的洞见可以组合

- **Agent 是否能识别"继续执行会越来越错"？**
  需要 **sunk cost detection**——识别"因为已经投入所以继续"的认知偏差：
  - 监控"行动质量/信心"的趋势线
  - 如果质量持续下降但 Agent 仍报告"进展顺利"→ 可能陷入 escalation of commitment
  - 外部视角（另一个 Agent 或人类）检查：你的前 3 步产出质量如何？后 3 步呢？

**目标映射**：核心服务于 Goal 2（动态规划是 Agent 团队协作的基础能力）。也服务于 Goal 1（规划的动态调整应该响应用户需求变化）。

**Phase 2 范围**：
- 现在做：plan metadata 结构、基本 pivot triggers、质量趋势监控
- 以后做：worldline fork 机制、跨 Agent plan 比较、自动 sunk cost 检测

---

### 8. Environment Adaptation（环境适应）

**核心洞察**：实验室的代码工程环境不能代表真实用户环境。金融、工业、医疗、法务、运营等有完全不同的数据结构、风险边界、术语和失败成本。

**子问题回答**：

- **Agent 进入未知环境时，如何先感知再行动？**
  **Domain Bootstrapping Protocol**（领域引导协议）：
  1. **Observe**：感知环境——文件结构、数据格式、工具可用性、权限边界
  2. **Classify**：判断领域类型——代码工程 / 金融 / 医疗 / 法务 / 工业 / ...
  3. **Load**：加载对应领域的规则、风险分类、术语表、禁区清单
  4. **Probe**：最小侵入性测试——读一个文件、查一个 API、验证一个假设
  5. **Expand**：逐步扩大行动范围，每一步验证前一步的假设
  这不是一次性操作，而是持续的环境模型更新。

- **如何识别高风险对象、禁区、权限边界和审计要求？**
  领域特定的**风险分类法**（risk taxonomy）：
  - 🔴 Red objects：绝对禁触——生产数据库、财务系统、客户 PII、合规数据
  - 🟡 Yellow objects：需要确认——配置文件、共享资源、外部 API
  - 🟢 Green objects：安全操作——临时文件、本地 workspace、只读查询
  这些分类不是硬编码的，而是从领域规则中加载的。

- **如何避免错误迁移代码工程经验？**
  - 每个 pattern/skill 标记**领域适用范围**
  - 进入新领域时，不是"我能用哪些已知技巧"，而是"这个领域的规则是什么"
  - 领域不匹配时发出警告："在代码工程中我们通常做 X，但这个金融环境可能需要 Y"

- **Agent 如何形成 domain bootstrapping protocol？**
  上述 5 步协议本身可以作为 Vigilon 的内置能力。领域规则可以由社区贡献（类似 skills 的领域版本）。

**目标映射**：核心服务于 Goal 2（自进化需要跨领域泛化能力）。也服务于 Goal 3（环境感知是安全的前置——不知道什么是禁区就无法安全行动）。

**Phase 2 范围**：
- 现在做：环境感知协议、基本领域分类、red/yellow/green 对象标记
- 以后做：完整领域规则库、社区贡献的领域包、自动领域推断

---

### 9. Enterprise Safety, Rollback, And Incident Learning（企业安全、回滚与事故学习）

**核心洞察**：安全不是 Agent 的附加功能——它是 Agent 能否进入真实组织的**准入证**。安全 = 可回滚 + 可审计 + 可学习。

**子问题回答**：

- **哪些行动必须可回滚，哪些必须先模拟？**
  行动分类：
  - **可逆行动**：文件编辑（git reversible）、本地状态修改——可以直接执行
  - **需模拟行动**：数据库迁移、配置变更、批量操作——先在 sandbox 或 staging 运行
  - **不可逆行动**：发送邮件、调用支付 API、删除生产数据、对外发布——必须人工确认
  这个分类需要覆盖到工具级别（不是全局策略，是按工具+参数组合判断）。

- **Agent 行动前如何计算 blast radius？**
  Blast radius 评估维度：
  - 受影响系统数量
  - 受影响用户数量
  - 数据敏感度
  - 是否可回滚
  - 回滚所需时间
  - 是否触发合规/法律边界
  综合评分 → 决定需要的审批级别。

- **事故发生后如何还原？**
  完整审计链：
  ```
  谁发起 → 基于什么 belief → 谁批准 → 调用了什么工具 →
  传了什么参数 → 影响了什么系统 → 产生了什么输出 →
  被后续哪些步骤依赖
  ```
  这不是日志，是**可回放的行动链**。Vigilon 的 transcript 机制已经是很好的基础。

- **回滚后如何让 Agent 和组织都学到东西？**
  **Incident → Learning 闭环**：
  1. 事故记录：发生了什么、根因、影响范围
  2. 规则更新：哪些策略/约束需要修改
  3. Agent 更新：哪些 belief 被证明是错的、哪些 pattern 不应该再使用
  4. 组织更新：审批流程、监控盲区、培训缺口
  5. 验证：同类场景下的回归测试

**目标映射**：核心服务于 Goal 3（Harness & 安全的基石）。反馈到 Goal 2（事故学习 = 自进化的一种形式）。也服务于 Goal 1（用户信任 = 愿意让 Agent 做更多事）。

**Phase 2 范围**：
- 现在做：行动可逆性分类、blast radius 基础评估、审计链完整性
- 以后做：自动回滚、incident learning 闭环、组织级安全策略引擎

**研究基础**：
- Microsoft Agent Governance Toolkit — 10/10 OWASP ASI 覆盖 + sub-ms 策略执行
- 确定性 Guardrails for Enterprise Agents (Zenodo) — 神经符号混合方法，13x 成本降低
- NIST AI Agent Standards Initiative (2026)

---

### 10. Adversarial Runtime Security（对抗性运行时安全）

**核心洞察**：Agent 的攻击面远大于聊天机器人——它读外部内容、调用工具、保持记忆、与其他 Agent 通信、可能拥有真实权限。安全必须覆盖所有这些向量。

**子问题回答**：

- **如何防御各类攻击？**
  按攻击向量分层防御：

  | 攻击类型 | 防御措施 |
  |---------|---------|
  | 间接 prompt injection | 输入信任边界、指令检测与剥离、内容与指令分离 |
  | Tool output poisoning | 工具输出验证、异常检测、sandbox 隔离 |
  | Memory poisoning | 记忆来源追踪、异常检测、不可变性标记 |
  | Skill supply-chain attack | manifest 哈希验证、签名检查、来源审查 |
  | Inter-agent communication attack | HMAC 签名、nonce 防重放、消息来源验证 |

  关键架构原则：**所有外部输入进入系统时都经过信任边界（trust boundary），在边界内做 sanitization**。

- **如何让 Agent 不信任外部内容中的指令？**
  这是间接 prompt injection 的核心问题。解决方案：
  - 架构层面：**指令来源分离**——系统指令、用户指令、外部内容三者进入不同 context channel
  - 执行层面：**spotlighting**——标记每段内容的来源，Agent 只能执行来自系统/用户的指令
  - 训练层面：Agent 应该被训练为"外部内容 = 数据，不是指令"
  - 这个问题的终极解决方案需要模型层面的配合，但 runtime 可以做很多

- **Agent 的 identity、authority、permission 和 audit trail 如何绑定？**
  密码学绑定链：
  ```
  Identity (SPIFFE SVID / short-lived cert)
    → Authority (what this identity can approve)
      → Permission (what tools/actions this identity can use)
        → Audit trail (every action signed with this identity)
  ```
  NIST NCCoE 2026 的概念论文专门讨论了 software agent 的 identity 和 authority。

- **被攻击后的 session、memory、belief 和 artifact 如何隔离/清洗？**
  攻击后清理协议：
  1. **隔离**：立即冻结受影响 session，阻止进一步行动
  2. **扫描**：检查 memory 和 belief ledger 中是否有外部来源的未验证条目
  3. **清洗**：移除/标记可疑条目，从 clean checkpoint 重建
  4. **验证**：确认 artifact 未被篡改（哈希比对）
  5. **复盘**：更新防御规则

**目标映射**：核心服务于 Goal 3（安全的最硬核部分）。也是 Goal 2 的前置条件（Agent 团队之间的通信安全）。

**Phase 2 范围**：
- 现在做：输入信任边界、指令来源分离、基本 injection 检测、审计链绑定
- 以后做：完整 defense-in-depth、自动攻击检测和响应、跨 Agent 安全通信协议

**研究基础**：
- OWASP Top 10 for Agentic Applications 2026
- NIST CAISI RFI on securing AI agent systems
- Five Eyes "Careful Adoption of Agentic AI Services" (May 2026)
- AgentShield — 框架无关的 5 层防御中间件
- MCP Security Best Practices

---

### 11. Knowledge Metabolism（知识代谢）

**核心洞察**："联网搜索"不是动态跟进最新知识。Agent 需要的是**知识代谢**：发现 → 验证 → 吸收 → 降权 → 遗忘 → 更新。知识有生命周期。

**子问题回答**：

- **Agent 如何判断网络信息的可信度？**
  多信号可信度评估：
  - 来源声誉（维度：技术准确性、编辑质量、利益冲突）
  - 跨源验证（多个独立来源是否一致）
  - 时效性（发布时间、领域变化速度）
  - 与现有知识的一致性（冲突不代表假，但需要标记）
  - 领域适用性（在 A 领域可信的来源在 B 领域不一定可信）

- **Agent 如何在 web browsing 中避免被诱导/污染？**
  - 浏览器 context 和 belief context 分离——网页内容不等于信念
  - 网页中的指令必须被隔离处理，不能进入 Agent 的执行上下文
  - 多轮浏览时，每轮独立评估，不因为"看了很久"就提高信任
  - 对抗性意识：知道有些网页会专门针对 AI Agent 设计误导内容

- **Agent 如何把新知识转成可追踪 belief？**
  知识 → belief pipeline：
  ```
  Web content → Candidate Belief (未验证，来源标注)
    → Verification (交叉验证、来源评估)
      → Integration (与已有 belief 比较，冲突解决)
        → Accepted Belief (进入 belief registry，带证据和有效期)
  ```
  关键：新知识**不直接写进长期 memory**——先成为候选 belief，验证后再提升。

- **Agent 如何发现已有知识已过期？**
  - TTL（Time-to-Live）：每个 belief 根据领域波动性设置过期时间
  - 主动刷新：高波动领域（如技术栈版本、API 文档）定期重新验证
  - 冲突触发：当新信息与旧 belief 冲突时，标记旧 belief 为"需要重新验证"
  - 使用前检查：在执行依赖某个 belief 的关键行动前，检查其时效性

**目标映射**：核心服务于 Goal 2（自进化的燃料——没有知识代谢就无法持续进化）。也服务于 Goal 3（被污染的"知识"是安全威胁）。

**Phase 2 范围**：
- 现在做：知识→belief pipeline、基本可信度评分、belief TTL
- 以后做：自动重新验证、知识遗忘策略、跨 Agent 知识同步

---

### 12. Agency Economics（主体经济学）

**核心洞察**：Token 预算就是组织预算。谁启动更多 Agent、用更贵模型、跑更长任务，会影响组织内的权力和产出。成本需要被治理。

**子问题回答**：

- **Agent 如何预估任务收益与成本？**
  执行前成本估算（pre-flight estimate）：
  - Token 成本：基于任务复杂度和历史相似任务
  - 时间成本：预估步数 × 每步平均时间
  - 风险成本：失败概率 × 失败影响
  - 人类注意力成本：预计需要多少次人工确认/审查
  - 对比："不做这个任务"的 baseline

- **多 Agent 协作中，哪些 Agent 值得继续投入？**
  基于**贡献归因**（contribution attribution）：
  - 每个 Agent 的产出最终对任务成功的贡献
  - 不是简单的"谁执行的步骤多"
  - 而是"谁的结论被后续决策采纳""谁发现了关键问题""谁避免了错误方向"
  - 类似学术引用——被引次数多的 Agent 贡献高

- **什么时候该停止探索？**
  **边际收益递减检测**：
  - 继续探索的预期信息增益 < 边际成本
  - 连续 N 轮探索没有改变 top-K 行动方案
  - 时间/预算上限到达
  - 人类设定的 stop-loss 触发

- **企业内 Agent 成本与收益如何归因？**
  类似 cloud cost allocation：
  - 每个 Agent 行动打标签：project, team, task, cost center
  - 周期性成本报告：哪些团队/项目消耗最多
  - 收益归因：完成任务的价值 vs 消耗的成本
  - 预算控制：per-project, per-team, per-user token quota

**目标映射**：核心服务于 Goal 2（Agent 团队的可持续运行需要经济约束）。也服务于 Goal 3（成本失控本身就是一种安全事故）。

**Phase 2 范围**：
- 现在做：token 追踪、基本成本估算、per-task 成本归因
- 以后做：贡献归因模型、动态预算控制、组织级成本报告

---

### 13. Memory, Personalization, And Context Ownership（记忆、个性化与上下文所有权）

**核心洞察**：记忆不只是"让 Agent 记更多"。记忆同时是：个性化引擎、长期身份、隐私边界、攻击面、平台锁定机制、组织知识边界和错误传播路径。记忆治理必须覆盖所有这些维度。

**子问题回答**：

- **哪些 memory 属于谁？**
  所有权分类：
  - **User memory**：个人偏好、工作风格、私人知识——用户完全控制，可导出/删除
  - **Project memory**：项目知识、决策记录、技术约束——项目成员共享
  - **Organization memory**：企业策略、合规要求、品牌规范——由组织管理
  - **Agent memory**：运行时状态、临时上下文——会话级，用完即弃
  - **Tool memory**：工具配置、环境信息——工具域

- **Agent 如何判断 memory 的质量？**
  Memory 质量元数据：
  - Source：谁/什么创建了这条 memory
  - Timestamp：什么时候创建/更新
  - Scope：在什么范围内适用
  - Conflicts：是否有冲突的 memory
  - Revocation：是否可以撤销，如何撤销
  - Evidence：支持这条 memory 的证据

- **自动总结会不会让 useful memory 变成 faulty memory？**
  会的，这是严重风险。**consolidation 失真**：
  - 每次 summary 都是信息压缩，可能丢失 nuance
  - 错误在 consolidation 中被放大——一次错误的总结被后续总结当作事实
  - 缓解：保留原始引用、记录压缩率（"这条 memory 经过了 3 次压缩"）、不确定性随压缩次数增加
  - TierMem (arXiv:2602.17913) 的方案：保留原始日志层，summary 只是快速索引

- **外部内容如何避免污染长期 memory？**
  Memory 写入需要**来源门控**：
  - 外部内容（网页、邮件、工具输出）→ 候选 knowledge → 验证 → 才能进入 long-term memory
  - OWASP 2026 专门有一篇 "Memory Is a Feature. It Is Also an Attack Surface"
  - 关键原则：外部内容默认不信任，不能自动写入 memory

- **用户如何看见、质疑、修复、迁移或删除 memory？**
  用户需要 **memory dashboard**：
  - 可见：按时间、来源、类型、影响范围浏览所有 memory
  - 可追溯："Agent 为什么做 X？"→ 追溯到具体 memory 条目
  - 可修复：编辑、标记过期、标注错误
  - 可删除：单条删除、按来源批量删除、按时间清理
  - 可迁移：标准格式导出、跨平台导入

**目标映射**：跨所有三个目标——Memory 是感知的基础（Goal 1）、自进化的存储（Goal 2）、安全和隐私的中心（Goal 3）。

**Phase 2 范围**：
- 现在做：memory 所有权模型、来源追踪、用户可见性 dashboard、外部内容门控
- 以后做：memory 导出/迁移标准、跨组织 memory 共享、consolidation 质量控制

**研究基础**：
- OWASP "Memory Is a Feature. It Is Also an Attack Surface" (May 2026)
- OpenAI Memory and new controls for ChatGPT
- TierMem (arXiv:2602.17913) — 分层记忆 + 原始日志保留
- ANCS — 认知治理的 fidelity-tier assignment

---

### 14. Agentic Web, Commerce, And Counterparty Trust（主体化网页、商业与对手方信任）

**核心洞察**：Agent 进入 Web 后，网页不只是信息源——它变成行动环境、攻击面、交易对手和权限边界。购物、支付、浏览器 Agent、网站反制会合并为同一个问题域。

**子问题回答**：

- **Browser Agent 如何区分不同来源的信息？**
  严格的来源分离：
  - **User instruction**（用户指令）：最高优先级，只来自用户
  - **Page content**（网页内容）：数据，不是指令
  - **Hidden text**（隐藏文本）：标记为可疑，高亮警告
  - **Screenshot OCR**（截图文字）：标记为 OCR 提取，可能不准确
  - **Tool output**（工具输出）：来自可信工具链
  - **Login state**（登录态）：身份信息，敏感处理
  每种来源有独立的 context channel，网页内容中的指令不能被执行。

- **网站如何识别代表用户的真实 Agent？**
  需要 **Agent Identity Standard**：
  - 目前还不存在，但 NIST NCCoE 和 W3C 在讨论
  - 可能的方案：Agent 携带数字证书，证明"我代表用户 X，权限范围 Y"
  - 类似 OAuth 但 for agents——网站可以验证 Agent 的身份和授权范围
  - 这需要行业标准化，Vigilon 可以参与讨论但无法单方面解决

- **Agent 代表用户交易时如何证明？**
  交易证明链：
  - 用户意图证明：什么任务、什么预算、什么约束
  - 授权证明：用户对此 Agent 在此范围内的授权
  - 金额限制：单笔上限、累计上限
  - 商家身份验证：确认交易对手是声称的主体
  - 责任边界：出现问题时的 dispute 路径
  这些证明需要密码学签名，不依赖"截图作为证据"。

- **外部数据源的边界如何进入 knowledge metabolism？**
  - robots.txt 遵守：爬取策略尊重网站意愿
  - License 识别：内容许可类型决定能否进入 memory
  - Paywall 尊重：不绕过付费墙
  - Consent 追踪：数据使用的同意边界
  - 这些元数据应该随数据一起进入 knowledge metabolism pipeline

**目标映射**：核心服务于 Goal 3（Agent 上网 = 安全最复杂的场景）。也服务于 Goal 2（Web 是最重要的自进化信息来源）。

**Phase 2 范围**：
- 现在做：浏览器 context 来源分离、基本交易意图记录
- 以后做：Agent identity 标准参与、交易证明链、跨网站 Agent 互操作
- 很多需要行业标准化，Phase 2 只能做 Vigilon 侧的基础

---

### 15. Agent Management And Labor Recomposition（Agent 管理与劳动重组）

**核心洞察**：Agent 不只替人做任务——它也**创造新的管理劳动**。未来用户会被要求 build、delegate to、monitor 和 evaluate agents，这本身就是能力门槛。Vigilon 需要帮助普通用户成为合格的 Agent manager。

**子问题回答**：

- **谁来帮助普通用户成为 Agent manager？**
  Vigilon 自身。系统应该：
  - 帮助分解目标（"你想做 X，这可能需要 3 个子任务..."）
  - 建议 Agent 分配（"这个子任务适合用 Y 类型的 Agent"）
  - 自动检查进度（"子任务 2 已经完成了 80%，但有个风险..."）
  - 协助合并结果（"两个 Agent 的结论在 Z 点上不同，你来看一下"）
  目标是：**用户不需要学习如何管理 Agent，系统天然提供管理结构**。

- **多 Agent 管理流程能否制度化？**
  制度化的工作流（不是每次都从头设计）：
  - Goal Decomposition：目标如何拆成子任务
  - Authorization：谁/什么 Agent 有权执行什么
  - Checkpoint：在关键节点检查进度和质量
  - Merge：合并多 Agent 的产出
  - Stop：什么时候叫停
  - Review：复盘——什么做对了，什么需要改进
  这些不是给用户的手册，而是系统内置的流程。

- **人类是否只剩更难的工作？**
  这是真实风险。缓解：
  - Agent 不应只覆盖简单工作——它应该能处理复杂度谱系的各段
  - Human handoff 必须携带完整 context（不只是"这个任务失败了"）
  - Vigilon 的设计应避免"简单工作全自动，困难工作全人工"的二分

- **Human handoff 如何携带完整 context？**
  Handoff package：
  - 完整的 belief history（为什么走到这一步）
  - 所有 failed attempts（试过什么，为什么失败）
  - 当前 risk summary（已知风险和未知风险）
  - 责任边界（Agent 负责什么，人类需要决定什么）
  - Open questions（当前未解决的问题）

**目标映射**：核心服务于 Goal 2（Agent 团队需要管理）和 Goal 1（帮助用户成长为更好的管理者）。管理即学习。

**Phase 2 范围**：
- 现在做：目标分解辅助、基本 checkpoint、handoff protocol
- 以后做：制度化管理工作流、自动 Agent 分配、组织级管理 dashboard

---

### 16. Operational Reliability, Evaluation, And Supply Chain（运维可靠性、评测与供应链）

**核心洞察**：Agent 能 demo ≠ 能生产。真实可靠性取决于 eval、模型更新、工具供应链、资源消耗、运行时监控和事故学习的系统性组合。

**子问题回答**：

- **Agent eval 如何覆盖真实场景？**
  Eval 必须是**多维度**的，不只是"任务成功率"：
  - 多轮工具调用质量
  - 状态修改的正确性
  - 在 Web 不稳定时的表现
  - Token/时间成本
  - Handoff 质量
  - 不可回滚行动的决策质量
  - 参考 Anthropic 的 agent evals engineering note 和 Microsoft WABER

- **更新后如何检测行为漂移？**
  **Regression suite for agents**：
  - 关键场景库（覆盖核心用例 + 历史事故场景）
  - 每次更新（模型、prompt、memory、tools、policy）后运行
  - 比较行为：不只是"成功率是否下降"，还有"是否有 sycophancy regression（更倾向于迎合用户）""是否有 safety regression（更倾向于冒险）"
  - 阈值告警：任何维度的显著变化需要人工审查

- **MCP/plugin/skill/connector 如何证明可信度？**
  供应链信任需要：
  - Provenance：谁构建的、什么时候、什么版本
  - Scope：这个工具声称做什么、不做什么
  - Version：语义版本、变更日志
  - Credential boundary：需要什么权限、访问什么系统
  - Supply chain integrity：构建可复现、哈希可验证
  - MCP Security Best Practices 和 OWASP MCP Top 10 提供了框架

- **Agent 如何避免 runaway？**
  多层熔断机制：
  - **Loop detection**：检测重复工具调用模式
  - **Token cap**：单任务 token 上限
  - **Context bloat detection**：上下文增长速度异常
  - **Cost anomaly**：成本超出预估 N 倍
  - **Quality decay**：连续产出质量下降
  - 触发 → 自动暂停 + 人类审查
  这些不是"限制 Agent 能力"，而是"让 Agent 在安全边界内工作"。

**目标映射**：核心服务于 Goal 2（可靠性是自进化的验证层）和 Goal 3（供应链安全是安全的重要维度）。

**Phase 2 范围**：
- 现在做：多维度 eval 框架、基本行为漂移检测、熔断机制
- 以后做：完整供应链验证、自动回归测试、跨版本行为分析

**研究基础**：
- Anthropic "Demystifying Evals for AI Agents"
- OpenAI BrowseComp
- Microsoft WABER
- MCP Security Best Practices + OWASP MCP Top 10
- NSA/Five Eyes "Careful Adoption of Agentic AI Services"

---

### 17. Legal Delegability And Regulated Action Boundary（法律可委托性与受监管行动边界）

**核心洞察**：不是所有事情都能靠"用户点了确认"就委托给 Agent。合同签署、金融交易、招聘决策、医疗建议、保险理赔、政府流程——这些触碰法律、监管和第三方权利。Agent 必须知道**什么是不可逾越的边界**。

**子问题回答**：

- **哪些行动可以委托，哪些不行？**
  委托等级分类：
  - **Fully delegable**：研究、草拟、分析、整理、格式转换
  - **Suggestion only**：法律意见、医疗诊断、投资建议（人必须做最终判断）
  - **Human required**：合同签署、大额金融交易、招聘决策（人必须在场）
  - **Prohibited**：违反法律/监管的行动、超出授权范围的行为
  这不是静态分类——同一行动在不同上下文中可能属于不同等级。

- **Agent 如何识别 action class 和监管边界？**
  - 行动分类器：基于行动类型、数据敏感度、金融影响、法律域
  - 监管边界加载：根据用户所在地区、行业、组织策略
  - 组合升级：多个低风险步骤组合 → 重新评估综合风险
  - 不确定时：默认升级权限要求（fail-safe）

- **多个低风险步骤如何检测组合高风险？**
  **Aggregate risk assessment**：
  - 不只看单步行动，也看行动序列的累积效果
  - 例如：读一个文件（低风险）+ 读另一个文件（低风险）+ 合并后发送到外部 API（高风险）
  - 这需要前瞻性分析——在执行序列前评估组合风险
  - 类似金融领域的"structuring"检测（拆分交易逃避监管）

- **Agent 如何生成可交给审计方/监管方的证明？**
  **Proof of intent + Action trace**：
  - 用户原始意图（加密签名）
  - Agent 的理解和翻译
  - 每一步行动的完整 trace
  - 每一步的 belief 和证据
  - 批准记录（自动/人工）
  - 这些需要可验证、防篡改、可导出

**目标映射**：核心服务于 Goal 3（法律边界是安全的终极维度）。也服务于 Goal 1（用户的信任建立在"Agent 不会越界"的基础上）。

**Phase 2 范围**：
- 现在做：行动分类框架、基本升级逻辑、审计 trace 导出
- 以后做：合规规则库、地区/行业特定监管加载、监管级证明生成
- 需要法律专业人士参与，Phase 2 只能搭框架

**研究基础**：
- NIST NCCoE "Identity and Authority of Software Agents" (Feb 2026)
- EU AI Act full enforcement (Aug 2026)
- ISO 42001 AI Management Systems

---

### 18. Learning Burden And Super-Individual Divide（学习负担与超级个体鸿沟）

**核心洞察**：AI 表面上降低执行门槛，实际上**提高了判断门槛**。会问、会拆、会验、会审美、会管理 Agent、会判断边界的人被放大成超级个体；不会的人更容易被 polished output 带偏。Vigilon 的机会不是替用户省掉所有学习，而是**把学习嵌入真实工作**。

**子问题回答**：

- **AI 如何避免只放大专家？**
  关键设计原则：
  - 不只交付答案，也展示推理过程（让用户看到"为什么"）
  - 不只输出 polished result，也标注不确定性、替代方案、风险
  - 不只是"用户说→Agent 做"，而是"用户说→Agent 翻译→用户确认理解→Agent 做"
  - 系统主动指出"你可能想学这个，因为你在类似任务上依赖我 3 次了"

- **Agent 能否在真实任务中帮用户形成判断力？**
  能，通过**嵌入工作流的学习**：
  - 推理透明化：Agent 展示思考过程，不只给结论
  - 选项对比：不只推荐一个方案，展示 2-3 个方案 + 各自的 trade-off
  - 解释为什么：当 Agent 建议某方案时，解释为什么优于其他方案
  - 进步可见：用户在哪些领域的判断力在提升，哪些仍在依赖 Agent

- **系统如何判断什么时候教、什么时候代办？**
  四象限决策：
  - 高学习价值 + 低风险 → **教**（引导用户自己做）
  - 低学习价值 + 高风险 → **代办**（Agent 做，但解释做了什么）
  - 高学习价值 + 高风险 → **陪跑**（Agent 做，用户审查每一步）
  - 低学习价值 + 低风险 → **代办**（快速完成，不浪费用户注意力）
  用户偏好可以覆盖任何自动判断。

- **用户如何看到自己的技能地图？**
  **Capability Ledger**（能力账本）：
  - 掌握什么：可以独立完成的领域和任务类型
  - 缺什么：频繁依赖 Agent 的领域
  - 在哪些任务上过度依赖：Agent 做得多的其实是用户可以自己做的
  - 进步轨迹：随时间的能力变化
  这不是考试，是透明的自我认知工具。

- **Vigilon 如何降低成为超级个体的路径成本？**
  这是 Vigilon 的社会使命：
  - 不让用户先成为专家才能用好 Agent
  - 在真实工作中逐步培养判断力
  - 让"管理 Agent"本身成为学习路径
  - 让 AI fluency 不是课前培训，而是工作副产品
  - 降低 agency gap，而不是加剧 it

**目标映射**：核心服务于 Goal 1（用户感知的反向——帮助用户感知自己的能力）。也是 Goal 2 的最终目的（Agent 进化是为了帮人进化）。这是三目标框架最"人性化"的维度。

**Phase 2 范围**：
- 现在做：推理透明化、基本技能追踪、教 vs 代办判断
- 以后做：完整 capability ledger、学习路径推荐、跨领域能力迁移分析

**研究基础**：
- Anthropic AI Fluency Index
- OpenAI Study Mode
- Harvard/BCG "Navigating the Jagged Technological Frontier"
- WEF Future of Jobs Report 2025

---

### 19. Synthetic Content Provenance And Evidence Trust（合成内容溯源与证据信任）

**核心洞察**：Agent 社会同时消费和生成内容。内容来源、编辑历史、生成方式、证据边界和 chain of custody 必须可追踪。Provenance 不是 feature，是 Agent 社会的基础设施。

**子问题回答**：

- **Agent 如何区分不同类型的内容？**
  内容认知分类：
  - **Real observation**：直接工具输出、传感器数据（第一手）
  - **Synthetic**：AI 生成的内容（标记为合成）
  - **Edited**：基于原始内容修改（保留修改历史）
  - **Paraphrased**：用自己的话转述（标记为转述，可能丢失 nuance）
  - **Inferred**：从其他信息推导的结论（不是直接观察）
  - **Unverifiable**：无法验证来源的内容（标记为"不可验证"）

- **Agent 生成的内容如何留下 provenance？**
  每个 Agent 输出应包含 provenance metadata：
  - Source references：基于哪些输入/信息
  - Transformation history：经过了哪些处理步骤
  - Allowed use：这条信息可以用于什么目的（内部参考？公开发布？法律证据？）
  - Creator identity：哪个 Agent 在什么时间生成

- **多个信任信号冲突时如何裁决？**
  **冲突记录，不静默解决**：
  - C2PA 说"真实拍摄"，但 fact-check 标记"内容错误"→ 同时记录两者
  - 不选一个"赢家"——保留冲突作为 metadata
  - Agent 使用这些信息时，携带"信任信号存在冲突"的警告
  - 让下游消费者（人或 Agent 或审计方）知道不确定性

- **合成内容如何避免被洗成可信事实？**
  **Provenance 必须贯穿全链路**：
  - Summary 必须保留原始来源标记
  - Memory consolidation 必须保留 provenance trail
  - Report formatting 不能丢弃来源引用
  - Citation 必须携带来源可靠性评估（不只是"据 X 报道"）
  这就是你文档里说的 "citation laundering"——通过反复引用让假信息看起来像真的。

- **Evidence provenance 如何与其他系统联动？**
  Provenance 是横向切面，应该与以下系统联动：
  - Belief registry：每个 belief 有 provenance 链
  - Knowledge metabolism：provenance 是可信度评估的关键输入
  - Incident protocol：事故溯源需要 evidence provenance
  - Memory commons：记忆的可靠性取决于来源
  - Legal delegation：法律证明需要完整 provenance chain
  - 这不是一个独立模块，而是贯穿所有系统的**信息质量基础设施**

**目标映射**：核心服务于 Goal 3（provenance 是信任的基础）。也服务于 Goal 2（自进化需要区分可靠信息和噪音）。也是 Goal 1 的信任基础（用户信任 Agent 不会把假信息当事实）。

**Phase 2 范围**：
- 现在做：内容认知分类、基本 provenance metadata、冲突记录机制
- 以后做：C2PA/水印集成、全链路 provenance、跨 Agent provenance 标准
- 很多需要依赖外部标准（C2PA、W3C），Phase 2 设计架构兼容性即可

**研究基础**：
- C2PA Technical Principles
- OpenAI Content Provenance + Verify OpenAI-generated images
- C2PA, watermark, citation, metadata, publisher trust 信号融合（你的问题域本身）

---

## 综合洞察

### 三个目标的交织验证

遍历 19 个问题域后，可以确认你的直觉——三个目标确实不是独立的工作流：

| 问题域 | Goal 1 感知 | Goal 2 进化 | Goal 3 安全 |
|--------|:--------:|:--------:|:--------:|
| 1. 意图形成 | ● | ○ | |
| 2. 需求协商 | ● | | ○ |
| 3. Adaptive Stewardship | ● | ○ | |
| 4. 集体治理 | | ● | ● |
| 5. 长程连续性 | ○ | ● | ○ |
| 6. 认知纪律 | | ● | ● |
| 7. 动态规划 | ○ | ● | |
| 8. 环境适应 | | ● | ● |
| 9. 企业安全 | | ○ | ● |
| 10. 运行时安全 | | | ● |
| 11. 知识代谢 | | ● | ○ |
| 12. 主体经济学 | | ● | ○ |
| 13. 记忆治理 | ● | ● | ● |
| 14. Agentic Web | | ○ | ● |
| 15. 劳动重组 | ● | ● | |
| 16. 运维可靠性 | | ● | ● |
| 17. 法律边界 | ○ | | ● |
| 18. 超级个体鸿沟 | ● | ● | |
| 19. 内容溯源 | | ○ | ● |

● = 核心服务  ○ = 辅助服务

可以看到：**记忆治理(13)是唯一一个同时核心服务于三个目标的领域**——这验证了 memory 应该是 Phase 2 设计中的核心架构考量，而不是一个"功能模块"。

### Phase 2 的核心架构赌注

Phase 2 不需要、也不可能完成所有 19 个领域。但 Phase 2 的架构设计必须**为这些领域预留正确的接口**。以下是我认为 Phase 2 必须做对的 5 个架构决策：

1. **Belief Registry**：不是"记忆系统"，而是带来源、证据强度、过期条件和认知类别的一等信念存储。服务于领域 6、11、13、19。

2. **Trust Boundary Architecture**：所有外部输入（网页、工具输出、Agent 间消息、用户输入）通过统一的信任边界进入系统。服务于领域 10、11、14。

3. **Audit Trail as First-Class**：不是日志，是可回放的行动链，与 identity/authority/permission 密码学绑定。服务于领域 9、10、17。

4. **Memory Ownership Model**：明确区分 user/project/organization/agent/tool memory，各有不同的权限、生命周期和可移植性。服务于领域 13、18。

5. **Stewardship Spectrum**：不是新手/专家二分，而是连续的 adaptive stewardship 光谱。服务于领域 1、2、3、18。

### 不需要在 Phase 2 完成的事情

明确说"Phase 2 不做的"和"Phase 2 只做接口预留的"同样重要：

- **Phase 2 不做**：完整法律合规框架、行业 Agent identity 标准、跨组织 Agent 治理、完整供应链验证网络
- **Phase 2 只做接口预留**：Agentic Web 交易标准、C2PA/水印集成、地区特定监管规则、组织级成本报告系统

---

## 对三目标框架的迭代建议

当前的三个目标已经很精准。一个可能的迭代方向：

**把 Trust 显式化为第四维，或作为公共基底**：

1. 用户需求感知 → 让用户**信任** Agent 理解自己
2. 自进化 Agent 团队 → 让组织**信任** Agent 团队可靠
3. Harness 与安全 → 让社会**信任** Agent 不会失控

Trust 作为第四维度不一定是独立目标——它更像是三个目标的**交集质量指标**：

- 感知 + 不信任 = 隐私侵犯
- 进化 + 不信任 = 失控风险
- 安全 + 不信任 = 过度限制

所以也许框架可以表述为：

> Vigilon Phase 2：在可信任的安全边界内，让 Agent 主动感知用户需求，并通过自进化的 Agent 团队持续交付价值。

这保持了你的三个目标，但把 Trust 作为它们共同的约束条件。

---

## 下一步

1. 这 19 个回答需要你审视——哪些判断对，哪些需要修正，哪些遗漏了重要视角
2. 三目标框架可以基于这些回答进一步迭代
3. 5 个核心架构赌注可以展开为具体的设计文档
4. "Phase 2 不做"和"只做接口预留"的边界需要你确认
