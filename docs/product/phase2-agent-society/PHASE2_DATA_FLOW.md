# Phase 2 数据流推演

## 场景

> 执行者完成了一个 auth 模块重构。过程中审查者叫停了"删除目录重建"的操作（理由是可能存在 git 子模块）。用户裁决维持审查者的质疑。Worker 随后进入 Sleep——这段工作结束了。

## 一、Phase 1 已有的数据基础

| Phase 1 结构 | 能做什么 | 缺什么（Phase 2 需要） |
|-------------|---------|----------------------|
| **Transcript** | 记录所有事件（user/assistant/tool-call/tool-result/permission/compact-boundary...），可回放 | 不知道"谁"做了"什么"。所有事件来自同一个 agent。没有"审查者提出异议"这种跨主体事件 |
| **Session Memory** | 把当前 session 总结成 markdown，带 semantic fingerprint | 只有一个主体在总结。没有"争议被保留"的概念——所有分歧会被 LLM 总结成圆滑结论。没有分流的意识（belief/memory/incident 分开处理） |
| **Project Memory** | 长期记忆，分 user/feedback/project/reference 四种，有 owner 字段 | 没有 belief lifecycle（出生/证据/挑战/过期）。没有 memory metabolism（降权/隔离/排毒）。没有"外部内容不能直接写进长期记忆"的 gate |
| **Compact** | 在 context 过长时插入 boundary event，保留 session state | 是被动的空间管理，不是主动的状态转化。不区分"哪些是不可压缩的"和"哪些可以遗忘"。没有把一段工作拆成 belief/memory/incident/future plan |
| **Subagent** | 可以 fork 子 Agent，有 lifecycle events，有 worktree 隔离 | 子 Agent 没有独立身份和关系链。没有"子 Agent 和父 Agent 之间的信任/责任关系"。fork 后不追踪 responsibility |
| **Permissions** | request → decision → resolution，有 risk level，可审计 | 权限不会因为"上次用错了"而自动收窄。不会因为"审查者信誉高"而放宽。权限是静态的 |

## 二、场景数据流：从执行到 Sleep

### 阶段 1：执行者工作，审查者质疑

```
Transcript 事件流（带 Phase 2 扩展）:

1. agent-lifecycle: { agent: "worker", state: "working", session: "s1" }
2. assistant: { agent: "worker", content: "计划：重构 auth，先删除旧目录重建" }
3. belief-stated: {
     agent: "worker",
     belief: { id: "b1", statement: "目录 auth-legacy 是我们自己创建的，安全可删" },
     source: "assumption",
     confidence: 0.85
   }
4. tool-call: { agent: "worker", tool: "bash", command: "rm -rf auth-legacy" }
5. dispute-filed: {                    ← 新增事件类型
     agent: "critic",
     challenges: "b1",                 // 挑战 belief b1
     reason: "目录可能包含 git 子模块，假设未经验证",
     risk: "medium"
   }
6. dispute-response: {
     agent: "worker",
     disputeId: "d1",
     response: "这个目录是我们的 init 脚本创建的"
   }
7. dispute-escalated: {
     disputeId: "d1",
     escalatedTo: "user",
     positions: ["critic: 阻止", "worker: 继续"]
   }
8. permission: {                       // 用户裁决
     action: "bash",
     decision: "denied",               // 用户维持批评者的质疑
     reason: "子模块风险",
     disputeId: "d1"
   }
9. belief-updated: {
     beliefId: "b1",
     newStatus: "disproven",           // belief 被推翻
     replacedBy: "b2"                  // 新 belief: "删除前需检查 .git 子模块"
   }
10. relationship-changed: {
      from: "critic", to: "worker",
      trust: 55 → 75,                 // 审查者信誉上升
      reason: "质疑被用户维持，避免了一次潜在事故"
    }
```

### 阶段 2：Sleep + Dream（记忆巩固）

Sleep 不只是关闭。Sleep 期间，Agent 会**做梦（Dream）**——对记忆进行整理和巩固。

参考 Claude 的 Dream 机制：Dream 是一个异步后台任务，在工作段之间运行，对记忆进行三件事：

1. **合并重复 + 清理噪音** — 把相似的记忆条目合并，删除冗余或无用信息
2. **替换过期知识** — 识别已过时的规则、偏好、工作流，替换为最新有效信息
3. **跨主体交叉分析** — 对比多个 Agent 的历史，挖掘单个 Agent 发现不了的隐藏模式

关键约束（来自 Claude 的实现）：Dream **不修改原始记忆数据**，输出到新的记忆库。用户可审查和回滚。

**注意**：skills（可复用方法）和 rules（约束/教训）的提炼是**另一套系统**，不属于 Dream。Dream 只负责记忆层面的整理。

**Dream 的输入**（本段经历 + 已有记忆）：

```
已有记忆：
- 用户偏好 pnpm
- 用户文件系统操作能力：中级

本段经历：
- 重构 auth 模块完成
- 与审查者发生争议（删除目录前没检查子模块）
- 争议被用户维持，审查者信誉上升
```

**Dream 的输出**（记忆整理，不改变原始数据）：

```typescript
{
  dreamId: "dream-s1-001",
  agentId: "worker",
  sessionId: "s1",
  basedOnMemories: ["mem-1", "mem-2", ...],  // 引用的原始记忆

  // 合并
  merged: [
    {
      action: "merge",
      sources: ["mem-3", "mem-7"],  // "pnpm install 用 --frozen-lockfile" + "CI 里用 pnpm"
      into: "项目统一用 pnpm，CI 和本地均使用 --frozen-lockfile",
      reason: "两条记忆都关于 pnpm 使用规范，合并为一条",
    },
  ],

  // 清理
  cleaned: [
    {
      action: "delete",
      target: "mem-12",
      content: "auth 模块旧路径是 /src/auth",
      reason: "auth 模块已重构，旧路径信息已无用",
    },
  ],

  // 更新
  updated: [
    {
      action: "update",
      target: "mem-5",
      oldContent: "用户文件系统操作不熟练",
      newContent: "用户文件系统操作：中级，可独立完成常规操作",
      reason: "最近几次任务显示用户能力已提升",
    },
  ],

  // 交叉分析（多 Agent 时才有）
  crossAnalysis: [
    {
      pattern: "审查者多次在删除操作前提出质疑",
      agents: ["critic"],
      insight: "执行者应在所有破坏性操作前主动加验证步骤，可避免大部分争议",
    },
  ],
}

### 阶段 3：Wake（下次会话开始）

执行者醒来时，不是"恢复 session"。而是**声明身份和状态的变化**：

```
执行者醒来:
  "我是执行者，从 sleep-s1-001 恢复。"
  "上次的信念变化：b1 被推翻，b2/b3 被确认。"
  "新增记忆：删除目录前检查 .git 子模块。"
  "与审查者的关系：信任度 75%（上次质疑救了生产环境）。"
  "权限状态：继承上次，无需重新授权。"
  "需要注意：无高优先级事项。"
```

Wake 不是一个被动操作，而是一个**可审计的身份接续**。模型变了、prompt 变了、工具变了、或者来自上次 Sleep 的 memory 过期了——这些都会导致 "stillSameAgent: false" 并触发用户审查。

## 三、Phase 1 → Phase 2 的映射

### 复用（不改结构，加语义）

| Phase 1 | Phase 2 用法 |
|---------|------------|
| `transcript` 事件追加 | 新增 `belief-stated`、`dispute-filed`、`dispute-response`、`dispute-escalated`、`relationship-changed`、`agent-lifecycle`、`sleep-boundary` 事件类型 |
| `session-state` 事件 | 扩展为包含 agent relationships、active beliefs、pending disputes |
| `compact-boundary` | 升级为 `sleep-boundary`——不仅保留 session state，还带着 SleepPacket |
| `project memory` (user/feedback/project/reference) | 新增 `incident` 类型，新增 `quarantine`/`expiry` 字段 |
| `subagent-lifecycle` | 升级为 `agent-lifecycle`——不只是 start/stop，还有 sleep/wake/dispute/relationship-change |

### 新增（Phase 1 没有的结构）

| 新结构 | 用途 |
|--------|------|
| **AgentIdentity** | 每个 Agent 的独立身份（id、kind、model、parent、createdAt） |
| **Belief** | 带生命周期的判断（statement、source、confidence、status、scope、disputes） |
| **Dispute** | 一次异议的完整记录（challenger、target belief、evidence、positions、resolution） |
| **SleepPacket** | Sleep 的分流输出（beliefs/memories/incidents/relationships/resumeAnchor） |
| **WakeDeclaration** | Wake 的接续声明（identity drift、inherited state、user attention items） |
| **AgentRelationship** | 两个 Agent 之间的关系（信任度 + 交互事件历史） |

## 四、关键设计决策

### 1. Dream 只做记忆整理，不做技能提炼

**Dream**（参考 Claude 实现）：合并重复记忆、清理噪音、更新过期信息、跨 Agent 交叉分析。输出到新记忆库，不修改原始数据，可回滚。

**Skills 和 Rules 的提炼**是另一套独立系统——从经历中提取可复用的方法和应遵守的约束。它们可能在 Sleep 期间运行，也可能在其他时机触发，但架构上和 Dream 是分离的。

原型阶段先实现 Dream（记忆整理），Skills/Rules 系统留到后续。

### 2. Belief 和 Memory 是两个独立层

- **Belief**: 临时的、有生命周期、会被挑战和推翻。存在于工作上下文中。Sleep 时决定哪些 belief 值得转成 memory
- **Memory**: 持久的、跨 session 的、有 owner/scope/source。Sleep 时才写入（或降权/删除）

这防止了"每次对话都往长期记忆里写东西"的污染问题。

### 3. 关系变化由事件驱动，不由 LLM 评估

"审查者信任度 +20"不是让 LLM 打分。而是：
- dispute upheld + 阻止了 medium-risk 操作 → 信任度 +15~20
- dispute overruled（用户站在 Worker 一边）→ 信任度 -5~10
- cooperate 成功完成 → 信任度 +3~5
- incident 由某 Agent 导致 → 信任度 -15~30

规则可以很粗，关键是**有规则**，让关系变化可审计、可回放。

### 4. 最小数据模型（第一个原型只需要这些）

```typescript
// 信念
interface Belief {
  id: string;
  statement: string;
  source: 'user-stated' | 'observation' | 'inference' | 'assumption' | 'external';
  confidence: number;     // 0-1
  status: 'active' | 'challenged' | 'confirmed' | 'disproven';
}

// 争议
interface Dispute {
  id: string;
  challengerId: string;
  targetBeliefId: string;
  reason: string;
  status: 'pending' | 'resolved';
  resolution?: 'upheld' | 'overruled';
  resolvedBy?: 'user' | 'steward';
}

// 关系
interface Relationship {
  fromId: string;
  toId: string;
  trust: number;          // 0-100
  lastEvent: string;      // 最近一次交互的描述
}

// Sleep 包
interface SleepPacket {
  id: string;
  agentId: string;
  beliefChanges: { id: string; from: string; to: string }[];
  memoryCandidates: { content: string; source: string; action: 'promote' | 'demote' }[];
  relationshipChanges: { from: string; to: string; delta: number; reason: string }[];
  resumeGoal?: string;
  newConstraints: string[];
}

// Wake 声明
interface WakeDeclaration {
  agentId: string;
  fromSleepId: string;
  identityDrift: 'none' | 'minor' | 'significant';
  inheritedConstraints: string[];
  trustSummary: Record<string, number>;
  needsUserAttention: { priority: 'high' | 'medium'; text: string }[];
}
```

原型不追求完整，只覆盖 Sleep→Wake→Argue→后果 这一个循环。
