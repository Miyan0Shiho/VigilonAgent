// ═══════════════════════════════════════════════════════════════
// Endorsement — Agent 为另一个 Agent 的能力或方案背书
//
// 模式: A 公开声明信任 B 的某方面能力 → 社会接受这个信号
// 如果 A 声誉高 → 背书效果强
// 如果被背书者后来出错 → A 的诚信声誉受损
// ═══════════════════════════════════════════════════════════════

import type { ReputationImpact, ReputationDimension, ReputationScores } from './reputation.js'

export interface EndorsementInput {
  endorserId: string
  endorseeId: string
  dimension: ReputationDimension // what aspect is being endorsed
  reason: string
  trustGraph: Record<string, Record<string, number>>
  reputation: Record<string, ReputationScores>
}

export interface EndorsementResult {
  status: 'strong' | 'moderate' | 'weak' | 'ignored'
  outcome: string
  trustImpacts: { fromId: string; toId: string; delta: number; reason: string }[]
  reputationImpacts: ReputationImpact[]
}

// ═══════════════════════════════════════════════════════════════

const STRONG_INTEGRITY = 70
const MODERATE_INTEGRITY = 50

export function endorse(input: EndorsementInput): EndorsementResult {
  const { endorserId, endorseeId, dimension, reason, trustGraph, reputation } = input

  const endorserIntegrity = reputation[endorserId]?.integrity ?? 50
  const endorserTrustInEndorsee = trustGraph[endorserId]?.[endorseeId] ?? 50
  const existingEndorseeRep = reputation[endorseeId]?.[dimension] ?? 50

  // Endorsement strength depends on endorser's integrity
  const strength = endorserIntegrity >= STRONG_INTEGRITY ? 'strong'
    : endorserIntegrity >= MODERATE_INTEGRITY ? 'moderate'
    : 'weak'

  // Effect multiplier
  const multiplier = strength === 'strong' ? 2.0 : strength === 'moderate' ? 1.0 : 0.4

  const trustImpacts: EndorsementResult['trustImpacts'] = []
  const reputationImpacts: ReputationImpact[] = []

  if (endorserTrustInEndorsee < 40) {
    // Endorsing someone you don't trust → damages integrity
    return {
      status: 'ignored',
      outcome: `${endorserId} 对 ${endorseeId} 的背书被无视（信任不足: ${endorserTrustInEndorsee}%）`,
      trustImpacts: [],
      reputationImpacts: [
        { agentId: endorserId, dimension: 'integrity', delta: -5, reason: `背书不信任的 agent: ${endorseeId}` },
      ],
    }
  }

  // Endorsement boosts endorsee's reputation in that dimension
  const repDelta = Math.round(4 * multiplier)
  reputationImpacts.push({
    agentId: endorseeId, dimension, delta: repDelta,
    reason: `${endorserId} 背书: ${reason.slice(0, 40)}`,
  })

  // Endorser gains slight integrity for publicly vouching
  reputationImpacts.push({
    agentId: endorserId, dimension: 'integrity', delta: 1,
    reason: `公开背书: ${endorseeId}`,
  })

  // Trust between them strengthens
  trustImpacts.push({
    fromId: endorserId, toId: endorseeId, delta: 4,
    reason: `公开背书: ${reason.slice(0, 30)}`,
  })

  const oldRep = existingEndorseeRep
  const newRep = Math.min(100, oldRep + repDelta)

  return {
    status: strength,
    outcome: `${endorserId} 为 ${endorseeId} 的${dimLabel(dimension)}背书（${strength === 'strong' ? '强' : strength === 'moderate' ? '中' : '弱'}效果: ${oldRep}→${newRep}）`,
    trustImpacts,
    reputationImpacts,
  }
}

function dimLabel(dim: ReputationDimension): string {
  const labels: Record<ReputationDimension, string> = {
    competence: '能力', reliability: '可靠性', cooperativeness: '合作性', integrity: '诚信', knowledge: '知识',
  }
  return labels[dim]
}
