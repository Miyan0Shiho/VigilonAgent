// ═══════════════════════════════════════════════════════════════
// Cooperation — 两 Agent 对同一目标的协作
//
// 规则:
//   双方互信 >= 40 → 直接接受
//   一方 >= 60 且另一方 >= 30 → 协商后接受
//   双方互信 < 30 → 拒绝
//   成功合作 → 双方互信 +8，cooperativeness 声誉 +5
// ═══════════════════════════════════════════════════════════════

import type { ReputationImpact } from './reputation.js'

export interface CooperationInput {
  initiatorId: string
  partnerId: string
  goal: string
  division: Record<string, string> // agentId → 负责部分
  trustGraph: Record<string, Record<string, number>>
}

export interface CooperationResult {
  status: 'accepted' | 'negotiated' | 'rejected'
  outcome: string
  trustImpacts: { fromId: string; toId: string; delta: number; reason: string }[]
  reputationImpacts: ReputationImpact[]
}

// ═══════════════════════════════════════════════════════════════

const MIN_MUTUAL_TRUST = 40
const MIN_ASYMMETRIC_HIGH = 60
const MIN_ASYMMETRIC_LOW = 30
const COOPERATION_TRUST_DELTA = 8
const COOPERATION_REPUTATION_DELTA = 5

export function proposeCooperation(input: CooperationInput): CooperationResult {
  const { initiatorId, partnerId, goal, division, trustGraph } = input

  const initiatorTrustInPartner = trustGraph[initiatorId]?.[partnerId] ?? 50
  const partnerTrustInInitiator = trustGraph[partnerId]?.[initiatorId] ?? 50
  const mutual = Math.min(initiatorTrustInPartner, partnerTrustInInitiator)

  let status: CooperationResult['status']
  let outcome: string

  if (mutual >= MIN_MUTUAL_TRUST) {
    status = 'accepted'
    outcome = `${initiatorId} 和 ${partnerId} 就「${goal}」达成合作`
  } else if (
    initiatorTrustInPartner >= MIN_ASYMMETRIC_HIGH &&
    partnerTrustInInitiator >= MIN_ASYMMETRIC_LOW
  ) {
    status = 'negotiated'
    outcome = `${initiatorId} 和 ${partnerId} 经过协商后同意合作「${goal}」，分工: ${formatDivision(division)}`
  } else if (
    partnerTrustInInitiator >= MIN_ASYMMETRIC_HIGH &&
    initiatorTrustInPartner >= MIN_ASYMMETRIC_LOW
  ) {
    status = 'negotiated'
    outcome = `${partnerId} 接受 ${initiatorId} 的合作邀请，双方就「${goal}」达成一致`
  } else {
    status = 'rejected'
    outcome = `${partnerId} 拒绝了 ${initiatorId} 的合作邀请（互信不足: ${mutual}%）`
  }

  const trustImpacts: CooperationResult['trustImpacts'] = []
  const reputationImpacts: ReputationImpact[] = []

  if (status !== 'rejected') {
    trustImpacts.push(
      { fromId: initiatorId, toId: partnerId, delta: COOPERATION_TRUST_DELTA, reason: '成功合作' },
      { fromId: partnerId, toId: initiatorId, delta: COOPERATION_TRUST_DELTA, reason: '成功合作' },
    )
    reputationImpacts.push(
      { agentId: initiatorId, dimension: 'cooperativeness', delta: COOPERATION_REPUTATION_DELTA, reason: `合作: ${goal.slice(0, 40)}` },
      { agentId: partnerId, dimension: 'cooperativeness', delta: COOPERATION_REPUTATION_DELTA, reason: `合作: ${goal.slice(0, 40)}` },
    )
  } else {
    // Rejecting cooperation damages cooperativeness of the rejector
    reputationImpacts.push(
      { agentId: partnerId, dimension: 'cooperativeness', delta: -3, reason: `拒绝合作: ${goal.slice(0, 40)}` },
    )
  }

  return { status, outcome, trustImpacts, reputationImpacts }
}

// ═══════════════════════════════════════════════════════════════

function formatDivision(div: Record<string, string>): string {
  return Object.entries(div)
    .map(([id, part]) => `${id}: ${part}`)
    .join(' | ')
}
