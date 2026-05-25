// ═══════════════════════════════════════════════════════════════
// Delegation — 将子任务委托给更擅长的 Agent
//
// 规则:
//   委托人信任 >= 50 + 被委托人 competence 声誉 >= 50 → 接受
//   被委托人 competence < 30 → 拒绝并建议换人
//   成功 → 委托人→被委托人信任 +10, 被委托人 competence +8, reliability +5
// ═══════════════════════════════════════════════════════════════

import type { ReputationImpact, ReputationScores } from './reputation.js'

export interface DelegationInput {
  delegatorId: string
  delegateId: string
  task: string
  reason: string
  trustGraph: Record<string, Record<string, number>>
  reputation: Record<string, ReputationScores>
}

export interface DelegationResult {
  status: 'accepted' | 'rejected' | 'reassigned'
  suggestedDelegate?: string
  outcome: string
  trustImpacts: { fromId: string; toId: string; delta: number; reason: string }[]
  reputationImpacts: ReputationImpact[]
}

// ═══════════════════════════════════════════════════════════════

const MIN_DELEGATOR_TRUST = 50
const MIN_DELEGATE_COMPETENCE = 50
const LOW_COMPETENCE_THRESHOLD = 30
const DELEGATION_TRUST_DELTA = 10
const DELEGATION_COMPETENCE_DELTA = 8
const DELEGATION_RELIABILITY_DELTA = 5

export function delegateTask(input: DelegationInput): DelegationResult {
  const { delegatorId, delegateId, task, reason, trustGraph, reputation } = input

  const delegatorTrust = trustGraph[delegatorId]?.[delegateId] ?? 50
  const delegateComp = reputation[delegateId]?.competence ?? 50

  if (delegateComp < LOW_COMPETENCE_THRESHOLD) {
    // Find a better candidate
    let bestId: string | null = null
    let bestComp = 0
    for (const [id, scores] of Object.entries(reputation)) {
      if (id === delegatorId || id === delegateId) continue
      if (scores.competence > bestComp) {
        bestComp = scores.competence
        bestId = id
      }
    }
    return {
      status: 'reassigned',
      suggestedDelegate: bestId ?? undefined,
      outcome: `${delegateId} 的 competence 声誉过低 (${delegateComp}%)，建议委托给 ${bestId ?? '其他 agent'}`,
      trustImpacts: [],
      reputationImpacts: [
        { agentId: delegateId, dimension: 'reliability', delta: -2, reason: `能力不足以接受委托: ${task.slice(0, 40)}` },
      ],
    }
  }

  if (delegatorTrust >= MIN_DELEGATOR_TRUST && delegateComp >= MIN_DELEGATE_COMPETENCE) {
    return {
      status: 'accepted',
      outcome: `${delegateId} 接受了 ${delegatorId} 的委托: ${task}（原因: ${reason}）`,
      trustImpacts: [
        { fromId: delegatorId, toId: delegateId, delta: DELEGATION_TRUST_DELTA, reason: '委托任务并完成' },
      ],
      reputationImpacts: [
        { agentId: delegateId, dimension: 'competence', delta: DELEGATION_COMPETENCE_DELTA, reason: `完成委托: ${task.slice(0, 40)}` },
        { agentId: delegateId, dimension: 'reliability', delta: DELEGATION_RELIABILITY_DELTA, reason: `被委托: ${task.slice(0, 40)}` },
      ],
    }
  }

  if (delegatorTrust < MIN_DELEGATOR_TRUST) {
    return {
      status: 'rejected',
      outcome: `${delegatorId} 对 ${delegateId} 的信任不足 (${delegatorTrust}%)，无法委托`,
      trustImpacts: [],
      reputationImpacts: [],
    }
  }

  return {
    status: 'rejected',
    outcome: `${delegateId} 的 competence 声誉 (${delegateComp}%) 未达到委托阈值 (${MIN_DELEGATE_COMPETENCE}%)`,
    trustImpacts: [],
    reputationImpacts: [],
  }
}
