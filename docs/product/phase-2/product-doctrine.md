# Phase 2 Product Doctrine

最后更新：2026-05-27
取代：[旧 Phase 2 Product Doctrine (Agent Life Physics)](../phase-2/explorations/PHASE2_PRODUCT_DOCTRINE.md)

---

## Vigilon Phase 2 的产品命题

> Vigilon Phase 2 builds a runtime where agents perceive user needs, self-evolve through agent teams, and operate within trusted harness boundaries.

> Vigilon Phase 2 构建一个 runtime，让 Agent 能够感知用户需求、通过 Agent 团队自进化、并在可信任的 harness 边界内行动。

这不是三个独立功能。这是同一个 runtime 的三个维度。

---

## 一、为什么是这三个目标

### 感知：Agent 时代的入口断层

当前所有 Agent 产品（Claude Code、Codex、OpenClaw、Harness）的交互范式都是**聊天框默认用户有清晰意图**。但真实用户只有情境、焦虑和模糊愿望。

"意图形成"的成本——想清楚自己要什么、再把它翻译成 Agent 能理解的表达——已经成为 Agent 普及的最大障碍。不解决这个问题，Agent 永远是精英用户的放大器。

### 自进化：Agent 不能只执行，还要变好

当前 Agent 每次任务基本从零开始。即使有 memory，也只是"记住更多信息"，不是"从经验中变得更强"。用户每次都要重新教 Agent 自己的偏好、项目的约定、什么方案有效什么方案无效。

自进化的核心不是"能不能学"，而是"学什么、怎么验证、学错了怎么回退"。盲目进化比不进化更危险。

### 安全：Agent 进入真实组织的准入证

当 Agent 能读写文件、调用 API、访问系统、代表用户行动时，"答错了"会变成"做错了"。安全不只是防止恶意攻击——更是让用户和组织信任 Agent 不会在无意中造成损害。

但安全机制如果太重，用户会绕过它。安全摩擦（security friction）是和安全能力同等重要的一阶问题。

---

## 二、三个目标的相互构成

这三个目标不是独立的 OKR。它们构成一个**信任三角**：

```
          感知
         /    \
        /      \
       /  信任  \
      /          \
  自进化 ──────── 安全
```

- **感知 → 自进化**：知道用户真正需要什么，才能朝对的方向进化。感知系统提供进化的目标函数。
- **自进化 → 安全**：进化中的 Agent 行为会变化——每次进化都需要安全回归验证。安全系统提供进化的护栏。
- **安全 → 感知**：没有安全边界的"感知"就是隐私侵犯。用户对 Agent 的信任建立在"它不会滥用我的信息"上。
- **感知 + 安全 → 自进化**：在安全边界内学习用户需求，形成正向飞轮——越用越懂你，越懂你越安全。
- **自进化 + 安全 → 感知**：通过学习攻击模式和事故经验来强化安全机制，进化让安全更智能。

**信任不是第四个目标，而是三个目标的公共基底**：
- 感知 + 不信任 = 隐私侵犯
- 进化 + 不信任 = 失控风险
- 安全 + 不信任 = 过度限制

---

## 三、产品原则

### Belief over Text

Agent 的核心认知单位不是文本，是信念（belief）。每条信念携带：来源（observation/inference/testimony/authority）、证据强度（0-1）、认知类别（事实/推断/假设/计划/偏好）、适用边界和过期条件。

信念在 compact、handoff、summary 中不能被抹平成确定性文本。不确定性是一等公民。

### Memory with Ownership

记忆不是"Agent 记住的东西"。记忆是分所有权的：用户记忆（可导出/删除）、项目记忆（共享）、组织记忆（合规管理）、Agent 记忆（会话级）、工具记忆（环境配置）。

没有所有权模型的记忆系统会同时成为隐私漏洞、攻击面和平台锁定机制。

### Trust First, Then Autonomy

自主性在可信任边界内逐步授予，不是一次性开关。Agent 从"只读观察"开始，在证明了可靠性之后逐步获得更多权限。

这不是限制 Agent——这是让 Agent 有机会证明自己。

### Evolution with Rollback

每次进化必须可验证（在核心场景上的回归测试）、可回退（进化历史像 git history 一样可追溯）。进化不是"希望它变好"，而是"证明它变好了，如果没变好就回退"。

### Friction-Aware Security

安全机制的假阳性代价可能高于漏过一次攻击。用户连续三次被误拦 → 关掉安全机制 → 完全没有保护。安全分级（静默通过 / 请求确认 / 强制阻断）比统一的高安全级别更重要。

### Learn by Working

AI 降低了执行门槛，但提高了判断门槛。Vigilon 的机会不是替用户省掉所有学习，而是把学习嵌入真实工作——推理透明、选项对比、不确定性可见。

用户不需要先成为 prompt engineer 或 Agent manager。系统本身提供引导结构。

---

## 四、工程范围：七问题域

产品原则落地为 7 个问题域。详见 [problem-framework.md](problem-framework.md)。

| # | 领域 | 核心冲突 |
|---|------|---------|
| A | 意图理解与适应性引导 | 聊天框假设清晰意图，用户只有模糊愿望 |
| B | 信念、知识与记忆架构 | 知识以相同可信度混在 memory 里 |
| C | 规划与长程连续性 | 上下文死亡时目标和约束不能一起死 |
| D | 自进化与持续学习 | 学到的可能是错的——怎么验证、怎么回退 |
| E | 多 Agent 协作 | 不是"启动更多 worker"，而是治理 O(n²) 复杂度 |
| F | 运行时安全与信任边界 | 安全要有效但不能重到被绕过 |
| G | 行动授权、审计与成本治理 | 谁可以做什么、怎么记录、怎么从事敌中学 |

B 域（信念/知识/记忆）是唯一同时核心服务于三个目标的架构——belief registry + memory commons 是 Phase 2 最重要的架构决策。

---

## 五、明确的边界

### Phase 2 做

- Belief registry 基础结构（source/evidence/epistemic category/expiry）
- 记忆所有权模型（user/project/organization/agent/tool）
- 输入信任边界与 OWASP ASI 对齐
- 行动分类（可逆/需确认/需人在场/禁止）与审计链
- 知识代谢 pipeline（候选→验证→整合→提升→过期）
- Agent-to-Agent 冲突协议与交接标准
- 进化验证与行为漂移检测
- 适应性引导（介入阈值光谱，非新手/专家二分）
- 多模型适配（模型感知而不模型锁定）

### Phase 2 不做

- Agent identity 行业标准（依赖 W3C/NIST）
- Agentic commerce 交易证明链（需要支付/银行配合）
- C2PA/水印集成（依赖外部标准，做接口预留）
- 法律合规规则库（需要律师，取决于地区/行业）
- 跨组织 Agent 治理
- 完整 Agent Society 产品面（需要可治理 runtime 基础）

### 永远不做（当前决策）

- remote / bridge / multi-user / enterprise / admin / billing / telemetry / marketplace
