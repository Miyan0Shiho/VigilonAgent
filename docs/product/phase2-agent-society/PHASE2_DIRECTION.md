# Phase 2 方向规划

## 地基

[Phase 2 Agent Era Problem Map](PHASE2_AGENT_ERA_PROBLEM_MAP.md) — 19 个 Agent 时代核心问题，是 Phase 2 存在的理由，也是最终验收清单。

产品哲学：**Vigilon 定义数字工作主体的存在规律。** 产品形态是 Agent 社会运行时。

## 核心赌注

> 如果你能让 3 个 Agent 在一个用户可见的空间里合作、争论，并且关系会随时间变化——你就已经证明了 Agent 社会的产品形态。
>
> 剩下的问题不是"做不做"，而是"有了这个循环之后，它们自然会碰到"。

## 设计原则

1. **原型驱动，不做更多设计文档。** 一个能跑的烂原型比一份完美的设计文档有价值 100 倍。原型会告诉你哪里不对，文档只会告诉你哪里看起来很对。
2. **前端表面即产品。** 不是"先做后端制度，再画 UI 皮肤"。前端是验收标准——用户不靠聊天日志也能看出这是一个数字工作社会。chat 是和社会沟通的 radio，不是整个世界。
3. **概念克制。** 不预先定义 19 个制度、12 种行为、8 条规律。核心概念一只手数得过来。其他东西在代码里长出来。
4. **关系随时间变化。** 社会感不在角色分工，在关系会随互动结果改变——信任积累、信任衰减、上次合作成功这次更愿意委托。
5. **用 Problem Map 做验收。** 每做完一个原型切片，回头对照 19 个问题：有没有碰到其中至少一部分？用户能不能感知到？

## 产品形态设想

### 前端表面（主界面）

用户看到的是一个可观察的数字工作空间，不是聊天框。

视觉隐喻参考 colony sim / management game（如 RimWorld）：用户通过小人、空间、对象和事件理解工作社会，不需要读日志。

**默认视图**包含：
- 几个 Agent 小人在不同区域做不同事
- 用户 5 秒内感知：谁在工作、谁卡住了、有没有争论、要不要我介入
- 小人行为是 runtime state 的真实映射（不是装饰动画）

**空间区域**（随原型迭代逐步加入）：
- Workshop：主要工作区
- Council Area：争论、协商
- Sleep Quarters：沉淀、修复
- Briefing Area：与用户沟通目标

**用户角色**：governor，不是 prompt engineer
- 设定目标，但不一定要拆解任务
- 裁决分歧，但不一定要看懂日志
- 批准高风险行动，但不需逐个确认
- 在关键节点介入，但不持续 micromanage

### 最小社会循环

3 个主体 + 2 种关系，关系会随时间变化。

```
合作（Worker + Steward 协作判断用户需要什么）
   ↕
争论（Worker 要执行，Critic 挑战）
   ↕
后果（争论结果 + 合作结果 → 改变信任、权限、引导密度）
   ↕
Sleep（带着变化和教训进入下一个周期）
   ↕
Wake（以变化后的身份和关系重新进入工作）
```

**三个主体**：

| 主体 | 职责 |
|------|------|
| Worker | 执行任务，可以 fork 出子 Agent 并行工作 |
| Critic | 挑战 Worker 的判断、计划和 belief，保留异议 |
| Steward | 关注用户能力和意图，调节引导密度，保护用户 agency |

**两种关系**：

| 关系 | 表现 |
|------|------|
| 争论（Worker ↔ Critic） | Critic 基于证据挑战 Worker 的假设和计划。争论有结果，保留少数意见，改变后续信任和行为 |
| 合作（Worker ↔ Steward） | Steward 帮助 Worker 理解用户意图和上下文，Worker 提供执行反馈。合作质量影响双方信任和后续协作方式 |

**关系随时间变化**：
- 上次合作成功的两个 Agent，这次会更愿意互相委托
- 上次被 Critic 救了生产事故的 Worker，这次会更主动咨询它
- 连续判断失误的 Agent，其整体权重会被下调
- Steward 注意到用户在某领域已熟练，降低引导密度
- 关系不是全局 score，是具体事件、上下文和后果的累积

### 最小原型切片

**Phase 2a：最小社会原型**

3 个 Agent（Worker、Critic、Steward）+ Sleep/Wake + 争论 + 合作 + 前端 Society Room Slice。

必须证明：
- 用户不靠 chat 也能看懂 Agent 在做什么
- Critic 的异议会改变 Worker 的 plan 或 memory
- Sleep 不是 summary，是把经历拆成记忆、信念、争议、教训
- Wake 声明身份和关系的变化
- 一次合作/争论的结果会影响下一次互动

**Phase 2b：社会循环闭环**

必须证明"后果传导"：
- Sleep 产出能被 Wake 消费
- 争论结果改变后续权限、记忆权重、信任关系
- 事故进入 Sleep 分流，影响下个周期的行为倾向
- 前端能看到完整社会因果链

**Phase 2c：扩展到真实场景**

证明"不是玩具"，覆盖 Problem Map 中更多问题，收集外部反馈。

## 与 Phase 1 的衔接

Phase 1 已有的底层能力，不推倒重建，而是升级语义：

| Phase 1 能力 | Phase 2 升级方向 |
|-------------|-----------------|
| Transcript | 升级为 Society Event Stream（可查询、可回放、关联到具体主体和 belief） |
| Session Memory | 升级为 Memory Commons 存储层，加入 owner/scope/source/expiry/quarantine |
| Compact | 升级为 Sleep 的分流机制（raw episode → memory/belief/incident/future plan） |
| Subagent / TaskHost | 升级为有身份、责任链、关系状态的 Agent 主体 |
| Permissions | 升级为受社会关系影响的动态权限（争议结果可收窄/放宽权限） |
| TUI | 为前端 Society Room 提供数据接口，先在 TUI 验证数据流 |

## 反模式

这些是 Codex 设计文档暴露的问题，必须避免：

- 把社会做成角色列表 + workflow 模板
- 把争论做成两个 Agent 各自输出文本然后 LLM 生成圆滑总结
- 把关系做成全局 trust score
- 把前端做成后端制度的可视化皮肤
- 先定义全部概念，再按概念逐个实现
- 用文档自洽代替原型验证

## 下一层需要细化的

本文件只定义方向和边界。以下需要在进入实现前进一步细化（但不是写更多设计文档——可以是白板、草稿、代码注释）：

1. Sleep/Wake 的数据模型：raw episode 拆成 memory、belief、dispute、incident、future plan 时，各自的最小字段是什么
2. 争论的协议：Critic 如何提出异议、异议如何绑定证据、裁决如何影响后续行为
3. 关系的建模：用什么数据结构存储"上次合作结果影响下次委托意愿"
4. 前端 Society Room 的技术选型与第一个像素级 mockup
5. Phase 1 代码中哪些模块可以直接复用、哪些需要重构
