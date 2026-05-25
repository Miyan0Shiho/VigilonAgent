// ═══════════════════════════════════════════════════════════════
// Phase 2 Architecture
//
// Phase 1 的 Agent 是原子单位。每个 Agent 自带:
//   - Transcript（事件日志）
//   - Session Memory（会话摘要）
//   - Project Memory（长期记忆）
//   - Agent Loop（模型交互循环）
//   - Permissions（权限）
//
// Phase 2 不做的事: 重新定义 Agent、Memory、WorkExperience。
// Phase 2 做的事: 在多个 Phase 1 Agent 之上加一层社会协调。
//
// 分层:
//   ┌──────────────────────────────────────────┐
//   │ 社会层 (Phase 2)                          │
//   │  dispute / dream / sleepWake / skillsRules │
//   │  输入: Phase 1 的 Transcript + Memory     │
//   │  输出: 社会事件 → 写回 Phase 1 Transcript  │
//   │       记忆变更 → 写回 Phase 1 Memory       │
//   ├──────────────────────────────────────────┤
//   │ Agent 实例 (Phase 1 runtime × N)          │
//   │  每个 Agent 是独立的 Phase 1 进程          │
//   │  有自己的 transcript / memory / permissions│
//   └──────────────────────────────────────────┘
//
// 数据流:
//   1. 每个 Agent 通过 Phase 1 Agent Loop 独立工作
//   2. 社会事件（争论、协作）作为 transcript event 写入
//   3. Session 结束时，社会层触发 Sleep → Dream
//   4. Dream 读取一个或多个 Agent 的记忆，产出整理建议
//   5. Skills/Rules 从 transcript + dream 中提取
//   6. Wake 时恢复社会状态（信任、约束、待办）
// ═══════════════════════════════════════════════════════════════

// Phase 1 types we depend on (from @vigilon/runtime)
import type { TranscriptEvent } from '@vigilon/runtime'

// ═══════════════════════════════════════════════════════════════
// Phase 2 扩展的 Transcript 事件类型
// 这些是社会层产生的新事件，追加到 Phase 1 Transcript 中
// ═══════════════════════════════════════════════════════════════

export type SocietyEvent =
  | {
      type: 'dispute-filed'
      disputeId: string
      challengerId: string
      defenderId: string
      subject: { type: 'belief' | 'plan' | 'action'; targetId: string; description: string }
      risk: 'low' | 'medium' | 'high' | 'critical'
      reason: string
      timestamp: string
    }
  | {
      type: 'dispute-resolved'
      disputeId: string
      resolution: 'auto-resolved' | 'negotiated' | 'mediated' | 'escalated'
      decision: 'proceed' | 'block' | 'modify' | 'escalated'
      resolvedBy: string
      reason: string
      trustImpacts: { fromId: string; toId: string; delta: number }[]
      timestamp: string
    }
  | {
      type: 'sleep-boundary'
      agentId: string
      sleepId: string
      dreamId?: string
      memoryChanges: { action: 'merged' | 'cleaned' | 'updated'; targetId: string; description: string }[]
      relationshipChanges: { fromId: string; toId: string; before: number; after: number }[]
      timestamp: string
    }
  | {
      type: 'wake-boundary'
      agentId: string
      fromSleepId: string
      identityDrift: 'none' | 'minor' | 'significant'
      loadedConstraints: string[]
      timestamp: string
    }
  | {
      type: 'skill-extracted'
      agentId: string
      skillId: string
      name: string
      confidence: number
      timestamp: string
    }
  | {
      type: 'rule-extracted'
      agentId: string
      ruleId: string
      rule: string
      type: 'hard-constraint' | 'soft-guideline' | 'process'
      priority: 'critical' | 'high' | 'medium' | 'low'
      timestamp: string
    }

// ═══════════════════════════════════════════════════════════════
// Phase 2 扩展的 Project Memory 条目类型
// 存储在 Phase 1 的 ProjectMemory 中，kind 为 'project'
// ═══════════════════════════════════════════════════════════════

export type SocietyMemoryEntry =
  | {
      kind: 'belief'
      id: string
      statement: string
      source: 'user-stated' | 'observation' | 'inference' | 'assumption' | 'external' | 'dream'
      confidence: number
      status: 'active' | 'challenged' | 'confirmed' | 'disproven' | 'expired'
      ownerAgentId: string
      challengedBy?: string[]
      createdAt: string
      updatedAt: string
    }
  | {
      kind: 'relationship'
      fromAgentId: string
      toAgentId: string
      trust: number // 0-100
      lastInteraction: string
      lastUpdated: string
    }
  | {
      kind: 'skill'
      id: string
      name: string
      trigger: string
      approach: string
      confidence: number
      ownerAgentId: string
      learnedFrom: string[]
      createdAt: string
    }
  | {
      kind: 'rule'
      id: string
      rule: string
      type: 'hard-constraint' | 'soft-guideline' | 'process'
      priority: 'critical' | 'high' | 'medium' | 'low'
      enforcedBy: string[]
      ownerAgentId: string
      learnedFrom: { type: string; ref: string }
      createdAt: string
    }

// ═══════════════════════════════════════════════════════════════
// 社会协调层: 不定义新的 Agent 类型，只定义 Agent 之间的交互
// ═══════════════════════════════════════════════════════════════

/** 社会中的 Agent 引用 — 不创建新 Agent，只引用 Phase 1 Agent */
export type SocietyAgentRef = {
  agentId: string
  /** Phase 1 session directory for this agent */
  sessionDir: string
  /** Paths to this agent's transcript and memory files */
  transcriptPath: string
  sessionMemoryPath: string
  projectMemoryPath: string
}

/** 社会状态 — 从多个 Phase 1 Agent 的状态中聚合而来 */
export type SocietyState = {
  agents: SocietyAgentRef[]
  /** trustGraph[a][b] = how much agent a trusts agent b */
  trustGraph: Record<string, Record<string, number>>
  /** Active disputes */
  activeDisputes: string[]
  /** Pending attention items for the user */
  attentionItems: { priority: 'high' | 'medium'; agentId: string; text: string }[]
}
