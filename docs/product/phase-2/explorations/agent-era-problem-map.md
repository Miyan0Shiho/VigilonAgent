# Phase 2 Agent Era Problem Map

## Status

本文档记录 2026-05-25 对 Phase 2 的问题域重估。

它不是 MVP、不是工程拆解、不是功能列表。它的作用是把用户对 Agent 时代的核心问题洞察沉淀下来，并把这些问题细化为 Phase 2 后续设计必须回答的 product questions。

本文档与 `PHASE2_PRODUCT_DOCTRINE.md` 的关系：

- `PHASE2_PRODUCT_DOCTRINE.md` 定义产品哲学：Vigilon 定义数字工作主体的存在规律。
- 本文档定义问题地图：今天的 Agent 产品为什么还没有真正释放潜力，Phase 2 必须回答哪些时代问题。
- `PHASE2_AGENT_SOCIETY_THESIS.md` 定义产品回答：Agent 社会是“数字工作主体存在规律”的产品形态。

## User Draft Record

以下是用户草稿的结构化记录，保留原始判断方向，不在记录层做过度改写。

1. **意图构建成本**
   用户面对 Codex、Claude Code、OpenClaw 等界面时，最花时间的往往不是执行，而是先构建一个想法，再把它表达出来。没有代码开发经验的人第一次使用这些工具时，会花很久思考“我要拿它做什么”。很多人拿到 OpenClaw 只会让它处理邮件；要处理复杂任务，还要学习 harness 工程、agent 使用手册等。这种学习成本会浪费产品潜力。

2. **需求对齐**
   现有 Agent 很依赖用户能清楚表达需求。Harness 工程更多解决 agent 工作不跑偏，但如果用户一开始就没描述清楚需求，方向从一开始就是错的。Ask-for-user、CLAUDE.md、记忆、skill、头脑风暴 skill、截取用户电脑操作习惯等都是尝试，但仍不够。它们默认用户有电脑使用习惯、会表达需求、懂大模型或懂 agent 操作，这会扩大精英用户与普通用户之间的知识鸿沟。用户缺少类似“秘书 / 管家 / 女仆 / 老师”的 Agent 角色来引导使用，但熟悉 Agent 的用户又不需要过度引导。

3. **多 Agent 时代的大型多人合作**
   大型多人合作项目里，多 Agent 如何工作？如何同步需求、解决分歧、承担责任、分配利益、平衡 token 支出与收益？很多大公司正在大量引入 Claude Code，这些问题已经出现。如果能解决它，这可能成为产品护城河。

4. **Context 工程与超持久工作**
   超长上下文、数百次超过上下文上限后的压缩、超过 16 小时的超持久工作中，如何保证任务目标不偏移，如何保证重要信息不丢失？

5. **Agent 幻觉**
   Agent 如何避免幻觉，如何知道自己不知道，如何避免把错误结论写进工作结果？

6. **远规划与动态规划**
   Agent 如何规划得更远、考虑更深、覆盖面更广，并能随着新信息动态修改规划？

7. **环境适应与感知**
   Agent 如何在未知环境中适应？实验室测试可能是代码工程环境，但用户真实环境可能是金融、工业或其他行业。

8. **企业安全与事故恢复**
   当公司把 Agent 接入财务和数据系统时，如何避免出问题？出问题后如何回退、解决，并避免下次再发生？

9. **越狱攻击与运行时安全**
   如何避免恶意注入与恶意攻击？如何避免 Agent 在运行时被攻击？

10. **动态跟进最新知识**
    Agent 如何动态跟进最新知识，如何在网络上正确遨游并吸收知识？

## Core Reframe

Phase 2 不能只问“Agent 能不能做更多任务”。今天 Agent 时代的核心问题已经变成：

> How does agency become usable, aligned, social, persistent, safe, and knowledge-refreshing?

中文：

> 如何让 agency 变得可用、可对齐、可社会化、可持久、可安全、可持续吸收新知识？

这意味着 Phase 2 要回答的不是一个功能问题，而是一组社会技术问题：

- 人如何形成意图。
- Agent 如何帮助人澄清意图。
- 多个 Agent 与多人如何共同承担责任。
- 长时间任务如何保持目标连续性。
- Agent 如何处理不确定性、幻觉和新知识。
- Agent 获得真实行动能力后，如何安全、可回退、可审计。

## Refined Problem Areas

### 1. Intention Formation Gap

用户不是总能“提出一个好需求”。很多时候，真正的成本在 prompt 之前：用户不知道自己能让 Agent 做什么，也不知道如何把模糊目标转成可执行任务。

这是普通 agent UI 的第一道断层。聊天框默认用户已经拥有清晰意图，但普通用户常常只有情境、焦虑、任务压力或模糊愿望。

Phase 2 问题：

- Agent 能否帮助用户发现自己真正想解决的问题？
- Agent 能否从用户的环境、历史、文件、日程、工作模式中推断“可能值得做的事”？
- Agent 能否提供从 novice 到 expert 的不同引导密度？
- Agent 能否避免把用户训练成 prompt engineer？

### 2. Requirement Negotiation Before Execution

“把错误需求做正确”是 Agent 时代的大坑。Harness、tool governance 和 execution trace 只能证明执行过程没跑偏，但不能证明原始目标是对的。

Phase 2 问题：

- Agent 是否能在执行前判断需求是否未成形、互相矛盾、风险过高或 ROI 不合理？
- Agent 是否能主动提出替代目标，而不是只问澄清问题？
- Agent 是否能区分“用户说不清楚”和“用户其实还没想清楚”？
- Agent 是否能在必要时反对用户的当前方向？

### 3. Adaptive Stewardship

用户草稿里的“秘书 / 管家 / 女仆 / 老师”指出了一个真实需求：用户需要被引导。但这些词也有风险：容易滑向固定人格、服务姿态、性别化或阶层化隐喻。

更准确的产品概念应是 **adaptive stewardship**：Agent 根据用户熟练度、任务风险、领域陌生度和时间压力，动态调整介入方式。

Phase 2 问题：

- 新手需要的是老师、秘书还是任务翻译器？
- 专家需要的是低干扰 cockpit，而不是手把手教学。
- 系统如何判断用户当前需要引导、质询、代办、陪跑，还是完全放权？
- Agent 如何避免把引导变成打扰？

### 4. Collective Agency Governance

多 Agent 的关键不是“启动更多 agent”，而是多个数字主体与多人协作时，如何同步需求、处理分歧、承担责任和分配收益。

这也是 Phase 2 与普通 multi-agent orchestration 的分界。普通编排关心任务如何拆分；Vigilon 应该关心 agency 如何在多人、多 Agent、多权限、多预算之间治理。

Phase 2 问题：

- 多个 Agent 的结论冲突时，谁有权合并，谁必须保留异议？
- 多个人类 owner 的目标冲突时，Agent 听谁的？
- Agent 之间如何背书、质疑、交接和承担后果？
- token 成本、时间成本和收益如何归因？
- 企业里如果一个 Agent 造成损失，责任落在人、Agent 配置、工具权限、模型供应商还是组织流程？

### 5. Long-Horizon Continuity

超长上下文和超持久任务不是简单 context engineering。真正的问题是：当 context window 不断死亡，Agent 如何维持目标、信念、计划和责任的连续性。

Phase 2 问题：

- 超过 16 小时的任务中，什么是不可压缩的核心目标？
- 数百次 compact 后，如何证明关键约束没有丢失？
- 哪些信息应该进入 memory，哪些应该进入 artifact，哪些应该进入 belief ledger？
- 如何检测 objective drift？
- 如何把长期工作拆成可恢复、可审计、可交接的 life segments？

### 6. Epistemic Discipline And Hallucination

Agent 幻觉不是简单“答错了”。当 Agent 能读写文件、调用工具、访问系统、影响业务时，幻觉会变成错误行动。

Phase 2 问题：

- Agent 的每个关键 belief 是否有来源、证据、适用边界和过期条件？
- Agent 是否能区分事实、推断、假设、计划和偏好？
- Agent 是否能在不知道时保持行动克制？
- Agent 是否能把不确定性传递给后续 Agent，而不是在 summary 中被抹平？

### 7. Deep And Dynamic Planning

Agent 不应只是生成一次 plan。它需要能远看、深想、广泛考虑，并在环境变化、证据变化、成本变化时动态修改规划。

Phase 2 问题：

- Plan 是否有 horizon、confidence、risk、cost 和 pivot condition？
- Agent 什么时候应该继续原计划，什么时候应该重开规划？
- 多 Agent 的不同 plan 是否能被比较、合并或保留为分叉世界线？
- Agent 是否能识别“继续执行会越来越错”的时刻？

### 8. Environment Adaptation

实验室中的代码工程环境不能代表真实用户环境。金融、工业、医疗、法务、运营、供应链等环境有完全不同的数据结构、风险边界、术语、权限和失败成本。

Phase 2 问题：

- Agent 进入未知环境时，如何先感知环境再行动？
- 如何识别当前领域的高风险对象、禁区、权限边界和审计要求？
- 如何避免把代码工程中的成功经验错误迁移到金融或工业场景？
- Agent 如何形成 domain bootstrapping protocol？

### 9. Enterprise Safety, Rollback, And Incident Learning

当 Agent 接入财务、数据、客户、生产系统后，安全不再是附加功能。它决定 Agent 能否进入真实组织。

Phase 2 问题：

- 哪些行动必须可回滚，哪些行动必须先模拟？
- Agent 行动前如何计算 blast radius？
- 事故发生后如何还原：谁发起、谁批准、基于什么 belief、调用了什么工具、影响了什么系统？
- 回滚后如何让 Agent 和组织流程都学到东西，避免同类事故？

### 10. Adversarial Runtime Security

Agent 的攻击面比聊天机器人更大，因为它会读外部内容、调用工具、记忆状态、与其他 Agent 通信，并可能拥有真实权限。

Phase 2 问题：

- 如何防御间接 prompt injection、tool output poisoning、memory poisoning、skill supply-chain attack 和 inter-agent communication attack？
- 如何让 Agent 不信任网页、文档、邮件、工具输出中的指令？
- Agent 的 identity、authority、permission 和 audit trail 如何绑定？
- 被攻击后的 session、memory、belief 和 artifact 如何隔离或清洗？

### 11. Knowledge Metabolism

“上网搜索”不是动态跟进最新知识。Agent 需要的是知识代谢：发现、验证、吸收、降权、遗忘和更新。

Phase 2 问题：

- Agent 如何判断一个网络信息是否可信、过期、冲突或只适用于特定上下文？
- Agent 如何在 web browsing 中避免被诱导、污染或带偏？
- Agent 如何把新知识转成可追踪 belief，而不是直接写进长期记忆？
- Agent 如何发现自己已有知识已经过期？

### 12. Agency Economics

多 Agent 和长任务都会引入成本问题。Token、时间、算力、人类注意力和错误恢复成本都必须被治理。

Phase 2 问题：

- Agent 如何预估任务收益与 token / time / risk 成本？
- 多 Agent 协作中，哪些 Agent 的贡献值得继续投入？
- 什么时候应该停止探索，什么时候应该继续花钱验证？
- 企业内 Agent 的成本与收益如何归因到项目、团队或业务结果？

### 13. Memory, Personalization, And Context Ownership

记忆不是“让 Agent 记更多东西”。记忆同时是个性化、长期身份、隐私、攻击面、平台锁定、组织知识边界和错误传播机制。

Phase 2 问题：

- 哪些 memory 属于用户，哪些属于项目、组织、Agent 或工具环境？
- Agent 如何判断 memory 的来源、时效、冲突、适用范围和撤销语义？
- 自动总结和持续 consolidation 会不会让 useful memory 变成 faulty memory？
- 外部内容、网页、邮件和工具输出如何避免污染长期 memory？
- 用户如何看见、质疑、修复、迁移或删除影响 Agent 行为的 memory？

### 14. Agentic Web, Commerce, And Counterparty Trust

Agent 进入 Web 后，网页不只是信息源，也会变成行动环境、攻击面、交易对手和权限边界。购物、支付、爬取、浏览器 Agent、网站反制和商家授权会合并成同一个问题域。

Phase 2 问题：

- Browser Agent 如何区分用户指令、网页内容、隐藏文本、截图 OCR、工具输出和登录态？
- 网站如何识别代表用户行动的真实 Agent、伪装 Agent、crawler 和普通浏览器？
- Agent 代表用户购物、付款、订票或提交表单时，如何证明意图、授权、金额、商家和责任边界？
- 外部数据源的 consent、license、paywall、robots policy 和 memory ingestion 边界如何进入 knowledge metabolism？

### 15. Agent Management And Labor Recomposition

Agent 不只是替人做任务，也会创造新的管理劳动。未来许多用户会被要求 build、delegate to、monitor 和 evaluate agents，但这本身就是新的能力门槛。

Phase 2 问题：

- 如果每个人都要管理 Agent，谁来帮助普通用户成为合格的 Agent manager？
- 多 Agent 管理中的目标拆分、授权、检查、合并、停止和复盘能否制度化，而不是都压到用户身上？
- Agent 替代重复工作后，人类是否只剩更难、更情绪化、更高责任的 fallback work？
- Human handoff 如何携带完整 context、belief history、failed attempts、risk summary 和责任边界？

### 16. Operational Reliability, Evaluation, And Supply Chain

Agent 能 demo 成功，不等于能生产可用。真实可靠性取决于 eval、模型更新、工具供应链、资源消耗、运行时监控和事故学习的组合。

Phase 2 问题：

- Agent eval 如何覆盖多轮工具调用、状态修改、Web 不稳定、成本、handoff 和不可回滚行动？
- 模型、system prompt、memory、tools 或 policy 更新后，如何检测行为漂移和 sycophancy regression？
- MCP / plugin / skill / connector 如何证明 provenance、scope、version、credential boundary 和供应链可信度？
- Agent 如何避免 runaway loops、tool thrash、context bloat 和不可预测成本？

### 17. Legal Delegability And Regulated Action Boundary

不是所有事情都能靠“用户点了确认”授权给 Agent。合同、金融、招聘、教育、医疗、保险、政府流程和关键基础设施场景中，Agent 行动会触碰法律、监管、审计和第三方权利。

Phase 2 问题：

- 哪些行动可以完全委托，哪些只能建议，哪些必须人工在场，哪些不应被 Agent 执行？
- Agent 如何识别 action class、risk level、required authority、audit burden 和 non-delegable boundary？
- 多个低风险步骤组合成高风险结果时，系统如何升级权限和监督？
- Agent 如何生成可交给 counterparty、auditor 或 regulator 的 proof of intent 和 action trace？

### 18. Learning Burden And Super-Individual Divide

AI 表面上降低了执行门槛，但实际上提高了判断门槛。普通人可以借助 AI 开始写代码、做研究、做设计、做运营，但要把事情做对，反而需要理解更多领域常识、证据质量、审美判断、工具权限、风险、成本和 Agent 管理方法。

Phase 2 问题：

- AI 如何避免只把专家放大成超级个体，而让普通用户停留在低阶自动化？
- Agent 是否能在真实任务中帮助用户形成 AI fluency、领域判断力和 Agent 管理能力，而不是只交付答案？
- 系统如何判断什么时候应该教、什么时候代办、什么时候反问、什么时候让用户亲自接管关键判断？
- 用户如何看到自己已经掌握什么、持续缺什么、在哪些任务上过度依赖 Agent？
- Vigilon 如何降低普通人成为超级个体的路径成本，而不是要求用户先成为超级个体才能用好 Agent？

### 19. Synthetic Content Provenance And Evidence Trust

Agent 社会会同时消费和生成内容：网页、截图、图像、视频、录音、报告、合同、邮件、事故证据和研究材料都可能进入 belief、memory、decision log 或 legal trace。AI 时代的问题不是“内容看起来是否真实”，而是内容的来源、编辑历史、生成方式、证据边界和 chain of custody 是否可追踪。

Phase 2 问题：

- Agent 如何区分真实观测、合成内容、编辑产物、转述、推断和无法验证材料？
- Agent 生成报告、截图、图像或决策证据时，如何留下 provenance、source refs、transformation history 和 allowed use？
- C2PA、watermark、citation、metadata、publisher trust 和 fact check 信号冲突时，Agent 如何裁决？
- 合成内容如何避免通过 summary、memory consolidation、report formatting 和 citation laundering 被洗成可信事实？
- Evidence provenance 如何和 belief registry、knowledge metabolism、incident protocol、memory commons 和 legal delegation 联动？

## Social Problems Behind The Product Problems

Phase 2 还必须看见 Agent 时代的社会问题，而不只是工程问题。

### Knowledge Gap Becomes Agency Gap

Claude Code、Codex、OpenClaw、Harness 等工具表面上降低了开发门槛，但也可能扩大新门槛：会 prompt、会拆任务、懂工具权限、懂 agent workflow 的人获得超能力；不会这些的人只能做简单邮件、总结或闲聊。

这意味着未来的差距不只是“谁会写代码”，而是“谁会调动数字主体”。

Vigilon 如果能降低意图形成和需求对齐成本，就不是在做更好用的 agent UI，而是在降低 agency gap。

### Accountability Becomes Blurred Labor

当 Agent 代表人行动时，组织里的责任会变模糊。是员工的责任、Agent 的责任、配置者的责任、批准者的责任、工具系统的责任，还是模型供应商的责任？

如果没有新的责任链，Agent 会成为责任漂白层：成功归人，失败归模型。

### Token Budget Becomes Political Budget

多 Agent 工作不是免费的。谁能启动更多 Agent、谁能跑更长任务、谁能用更贵模型，会影响组织内的权力和产出。

Token budget 会变成一种新的组织预算，也会影响不同团队、不同个人获得 agency 的能力。

### Automation Can Outrun Understanding

Agent 可以比人更快行动，但组织理解、审批、回滚和复盘的速度没有同步提升。自动化越快，错误传播越快。

Vigilon 的机会不是让 Agent 更快，而是让 Agent 的行动速度与理解、责任和恢复机制匹配。

### The Internet Becomes An Adversarial Work Environment

Agent 上网不是人在浏览网页。Agent 会把网页、文档、邮件和工具输出当成行动上下文，这让互联网从信息环境变成攻击环境。

动态知识获取必须和 adversarial awareness 绑定，否则“学习最新知识”会变成“持续被污染”。

### Learning Gap Becomes Super-Individual Divide

AI 时代的学习问题不是“还要不要学知识”，而是“什么知识变得更重要”。AI 降低了执行门槛，但提高了判断门槛：会问、会拆、会验、会审美、会管理 Agent、会判断边界的人会被放大；不会这些的人会更容易被 polished output、错误 belief 和自动化幻觉带偏。

Vigilon 的大众化机会不是替用户省掉所有学习，而是把学习嵌入真实工作：让用户在与 Agent 社会共同完成任务的过程中逐渐获得判断力和接管能力。

### Synthetic Evidence Becomes Social Risk

AI 让内容生产成本接近归零，也让伪造证据、合成截图、虚假音视频、AI 生成报告和二次转述更容易混入工作流。Agent 如果只看表面文本、像素或 citation，就会把内容真实性问题带进 belief、memory、incident 和 legal delegation。

Vigilon 的机会不是做一个单点鉴伪工具，而是把 evidence provenance 变成 Agent 社会制度：每条关键证据都要知道它来自哪里、如何被采集、是否被编辑、经过哪些 Agent 转换、能否进入 memory、能否支撑行动或法律授权。

## External Signals

这些问题不是内部臆测。2026 年的公开材料已经显示出同一趋势：

- Deloitte 的 [2026 State of AI in the Enterprise](https://www.deloitte.com/us/en/what-we-do/capabilities/applied-artificial-intelligence/content/state-of-ai-in-the-enterprise.html) 与 [agentic AI guardrails analysis](https://www.deloitte.com/us/en/insights/topics/emerging-technologies/ai-agents-scaling-faster.html) 指出，agentic AI usage 正在快速上升，但自治 Agent 治理成熟度落后；公开摘要强调很多组织缺少清晰边界、实时监控和完整审计链。
- OWASP 已发布 [Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)，把自主 / agentic AI 系统的安全风险作为单独问题域。
- NIST / CAISI 在 2026 年发布 [securing AI agent systems RFI](https://www.nist.gov/news-events/news/2026/01/caisi-issues-request-information-about-securing-ai-agent-systems)，明确提到间接 prompt injection、数据投毒、误目标行动等风险。
- NIST NCCoE 的 [software agent identity and authority concept paper](https://www.nist.gov/news-events/news/2026/02/new-concept-paper-identity-and-authority-software-agents) 聚焦 software agents 的 identification、authorization、auditing、non-repudiation 和 prompt injection mitigation。
- TrueFoundry 的 [Enterprise AI Gateway Report announcement](https://www.businesswire.com/news/home/20260514715268/en/TrueFoundry-Survey-Finds-Most-Enterprises-Cannot-Audit-Their-AI-Systems-as-Agent-Adoption-Surges) 也把统一日志、集中治理、agent workflow 审计和成本可见性不足作为企业 Agent 采用中的现实问题。
- OpenAI 的 [Memory and new controls for ChatGPT](https://openai.com/index/memory-and-new-controls-for-chatgpt/)、OWASP 的 [Memory Is a Feature. It Is Also an Attack Surface](https://genai.owasp.org/2026/05/13/memory-is-a-feature-it-is-also-an-attack-surface/) 与 agent memory 研究共同说明，memory 已经从体验增强变成长期身份、隐私、所有权和攻击面问题。
- Anthropic 的 [agent evals engineering note](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)、OpenAI 的 [BrowseComp](https://openai.com/index/browsecomp/) 和 Microsoft Research 的 [WABER](https://www.microsoft.com/en-us/research/publication/waber-evaluating-reliability-and-efficiency-of-web-agents/) 说明，Agent 评测必须覆盖多轮工具调用、状态变化、可靠性和效率，而不只是一次性完成率。
- MCP 的 [Security Best Practices](https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices)、OWASP 的 [MCP Top 10](https://owasp.org/www-project-mcp-top-10/) 与 NSA / Five Eyes 的 [Careful Adoption of Agentic AI Services](https://www.nsa.gov/Press-Room/Press-Releases-Statements/Press-Release-View/Article/4475134/nsa-joins-the-asds-acsc-and-others-to-release-guidance-on-agentic-artificial-in/) 说明，Agent 的工具供应链、权限、行为偏移和持续 assurance 已经成为公共安全与企业治理问题。
- WEF 的 [Future of Jobs Report 2025](https://www.weforum.org/publications/the-future-of-jobs-report-2025/in-full/3-skills-outlook/)、Anthropic 的 [AI Fluency Index](https://www.anthropic.com/research/AI-fluency-index)、OpenAI 的 [Study Mode](https://openai.com/index/chatgpt-study-mode/) 与 Harvard / BCG 的 [Jagged Technological Frontier](https://d3.harvard.edu/navigating-the-jagged-technological-frontier/) 共同说明，AI 时代的关键不是少学，而是学会判断 AI 能力边界、质疑 polished output、迭代问题和逐步获得更高阶能力。
- C2PA 的 [technical principles](https://spec.c2pa.org/principles/)、OpenAI 的 [content provenance](https://openai.com/index/advancing-content-provenance/) 和 [Verify OpenAI-generated images](https://openai.com/verify/) 说明，内容来源、合成标记、水印和 provenance 已经成为 AI 时代的基础信任设施；但这些信号也需要进入 Agent runtime，而不能只停留在媒体文件层。

## Phase 2 Product Thesis

Phase 2 的产品命题可以收束为：

> Vigilon is not building another agent interface. It is building a runtime for usable, aligned, social, persistent, safe, and knowledge-refreshing agency.

中文：

> Vigilon 不是再做一个 agent 界面，而是在构建一种可用、可对齐、可社会化、可持久、可安全、可持续吸收新知识的 agency runtime。

这条主线可以承接 `PHASE2_PRODUCT_DOCTRINE.md`：

- Human-like behaviors 是用户能感知到的表层：沉淀、争论、协作、探索、批评。
- Life physics 是底层：分叉、上下文死亡、信念生命周期、记忆代谢、权限塑形、身份连续、并行后果、社会成本、委托权威和运行时可验证性。
- Agent era problem map 是市场与社会问题：意图形成、需求对齐、多主体治理、长程连续、幻觉、动态规划、环境适应、安全恢复、运行时攻击、知识代谢、成本归因、记忆所有权、Agentic Web、劳动重组、评测可靠性、工具供应链、法律可委托边界、超级个体分化和合成内容证据信任。

任何 Phase 2 设计如果只回答其中一个点，很可能仍是普通功能。Vigilon 的机会在于把这些问题放到同一个 runtime 里回答。

这个 runtime 的产品形态是 Agent 社会。Agent 社会不是更多 worker，而是用社会制度统一回答这些问题：stewardship 负责意图形成，requirement council 负责需求协商，critique / dispute system 负责分歧，belief registry 负责幻觉与信念生命周期，memory commons 负责长程连续和记忆治理，permission institutions 负责授权与安全，incident protocol 负责回滚与复盘，knowledge metabolism 负责动态知识，agency economy 负责 token、时间、风险和收益归因，agent registry / supply-chain protocol 负责工具和 Agent 身份，transaction / delegation protocol 负责跨边界交易和法律可委托行动，learning stewardship / capability ledger / apprenticeship protocol 负责人的能力增长和超级个体路径，evidence provenance registry 负责内容来源、合成标记、编辑历史、证据边界和 chain of custody。

## Immediate Doctrine Impact

后续 Phase 2 设计不能再只用“多 Agent”“记忆”“安全”“浏览器搜索”这些功能名立项。每个设计必须说明它回答了哪一个 Agent 时代问题：

- 它降低了用户意图形成成本，还是只要求用户写更好的 prompt？
- 它改善了需求对齐，还是只保证执行不跑偏？
- 它让多 Agent 责任更清楚，还是只是启动更多 worker？
- 它保持长期目标连续性，还是只压缩上下文？
- 它治理 belief，还是只减少幻觉文案？
- 它适应新环境，还是把代码工程假设搬到所有场景？
- 它让安全可回退、可审计、可学习，还是只加了 permission prompt？
- 它让知识代谢，还是只是联网搜索？
