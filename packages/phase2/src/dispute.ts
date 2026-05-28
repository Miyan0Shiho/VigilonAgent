// ═══════════════════════════════════════════════════════════════
// Dispute — Agent 社会中的争论与分级裁决
//
// 角色无关。任何 Agent 都可以挑战、辩护、调解。
// 裁决只看三项：风险等级、信任差距、是否可逆。
// ═══════════════════════════════════════════════════════════════

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type AgentStance = {
  agentId: string
  position: 'approve' | 'block' | 'modify' | 'abstain'
  reasoning: string
  evidence?: string[]
  suggestedAlternative?: string
}

export type DisputeInput = {
  disputeId: string
  subject: {
    type: 'belief' | 'plan' | 'action'
    targetId: string
    description: string
  }
  risk: RiskLevel
  challengerId: string
  defenderId: string
  stances: AgentStance[]
  /** trust[fromId][toId] = trust score 0-100 */
  trustGraph: Record<string, Record<string, number>>
  reversible: boolean
  blastRadius?: string
  /** IDs of agents that can mediate (any agent, not a special role) */
  availableMediators?: string[]
}

export type ResolutionLevel = 'auto-resolved' | 'negotiated' | 'mediated' | 'escalated'

export type DisputeResult = {
  disputeId: string
  resolution: ResolutionLevel
  decision: 'proceed' | 'block' | 'modify' | 'escalated'
  modifiedPlan?: string
  minorityOpinion?: string
  resolvedBy: string
  reason: string
  trustImpacts: { fromId: string; toId: string; delta: number; reason: string }[]
  userPrompt?: {
    title: string
    challengerPosition: string
    defenderPosition: string
    risk: RiskLevel
    blastRadius?: string
  }
}

// ═══════════════════════════════════════
// Thresholds
// ═══════════════════════════════════════

const TRUST_GAP_THRESHOLD = 20 // minimum trust difference for auto-resolution
const MIN_TRUST_FOR_AUTO = 50 // the winning agent must have at least this much trust
const MIN_MUTUAL_TRUST_FOR_NEGOTIATE = 50 // both sides need decent trust to talk it out

// ═══════════════════════════════════════
// Resolution engine
// ═══════════════════════════════════════

export function resolveDispute(input: DisputeInput): DisputeResult {
  const { disputeId, risk, challengerId, defenderId, trustGraph, reversible } = input

  const defenderTrustInChallenger = trustGraph[defenderId]?.[challengerId] ?? 50
  const challengerTrustInDefender = trustGraph[challengerId]?.[defenderId] ?? 50
  const gapCW = defenderTrustInChallenger - challengerTrustInDefender // >0 = challenger more trusted

  // ── Level 1: Auto-resolve on trust gap ──
  const absGap = Math.abs(gapCW)
  const winnerTrust = gapCW > 0 ? defenderTrustInChallenger : challengerTrustInDefender
  const winnerId = gapCW > 0 ? challengerId : defenderId

  if (absGap >= TRUST_GAP_THRESHOLD && winnerTrust >= MIN_TRUST_FOR_AUTO) {
    if (canAutoResolve(risk, absGap)) {
      const loserId = winnerId === challengerId ? defenderId : challengerId
      return autoResolved(disputeId, winnerId, loserId, risk, winnerTrust)
    }
  }

  // ── Level 2: Negotiate (both sides can talk) ──
  const mutualTrust = Math.min(defenderTrustInChallenger, challengerTrustInDefender)
  if (risk !== 'critical' && risk !== 'high' && mutualTrust >= MIN_MUTUAL_TRUST_FOR_NEGOTIATE) {
    return negotiated(disputeId, challengerId, defenderId)
  }

  // ── Level 3: Mediation (find trusted third party) ──
  const mediatorId = findMediator(input)
  if (mediatorId && risk !== 'critical') {
    return mediated(disputeId, input, mediatorId)
  }

  // ── Level 4: Escalate ──
  return escalated(disputeId, input)
}

// ═══════════════════════════════════════
// Helpers
// ═══════════════════════════════════════

function canAutoResolve(risk: RiskLevel, trustGap: number): boolean {
  switch (risk) {
    case 'low': return trustGap >= TRUST_GAP_THRESHOLD
    case 'medium': return trustGap >= 25
    case 'high': return trustGap >= 35
    case 'critical': return false
  }
}

/** Pick the most-trusted available third party, if any */
function findMediator(input: DisputeInput): string | null {
  const { trustGraph, challengerId, defenderId, availableMediators } = input
  const candidates = availableMediators ?? Object.keys(trustGraph).filter(
    id => id !== challengerId && id !== defenderId,
  )
  let best: string | null = null
  let bestTrust = 0
  for (const id of candidates) {
    const t1 = trustGraph[challengerId]?.[id] ?? 50
    const t2 = trustGraph[defenderId]?.[id] ?? 50
    const avg = (t1 + t2) / 2
    if (avg > bestTrust) { bestTrust = avg; best = id }
  }
  return bestTrust >= 50 ? best : null
}

function autoResolved(
  disputeId: string, winnerId: string, loserId: string,
  risk: RiskLevel, winnerTrust: number,
): DisputeResult {
  const isChallengerWinner = loserId !== winnerId // simplified: winner is who had more trust
  return {
    disputeId, resolution: 'auto-resolved',
    decision: isChallengerWinner ? 'block' : 'proceed',
    resolvedBy: 'auto',
    reason: `信任差距明显（${winnerTrust}%），自动采纳 ${winnerId} 的判断`,
    minorityOpinion: `${loserId} 的反对意见已记录`,
    trustImpacts: [
      { fromId: loserId, toId: winnerId, delta: 5, reason: '自动裁决维持其判断' },
    ],
  }
}

function negotiated(disputeId: string, challengerId: string, defenderId: string): DisputeResult {
  return {
    disputeId, resolution: 'negotiated', decision: 'modify',
    modifiedPlan: '[协商结果] 双方各让一步，执行前增加验证步骤',
    resolvedBy: 'auto',
    reason: `${challengerId} 和 ${defenderId} 协商后达成一致`,
    trustImpacts: [
      { fromId: challengerId, toId: defenderId, delta: 3, reason: '对方愿意协商' },
      { fromId: defenderId, toId: challengerId, delta: 3, reason: '合理质疑并接受修改' },
    ],
  }
}

function mediated(disputeId: string, input: DisputeInput, mediatorId: string): DisputeResult {
  return {
    disputeId, resolution: 'mediated', decision: 'modify',
    modifiedPlan: `[${mediatorId} 调解] 采纳 ${input.challengerId} 的风险提示，但允许 ${input.defenderId} 在增加检查后继续`,
    resolvedBy: mediatorId,
    reason: `${mediatorId} 审查双方论据后做出判断`,
    trustImpacts: [
      { fromId: input.defenderId, toId: mediatorId, delta: 1, reason: '接受调解' },
      { fromId: input.challengerId, toId: mediatorId, delta: 2, reason: '调解合理' },
    ],
  }
}

function escalated(disputeId: string, input: DisputeInput): DisputeResult {
  const challengerStance = input.stances.find(s => s.agentId === input.challengerId)
  const defenderStance = input.stances.find(s => s.agentId === input.defenderId)
  return {
    disputeId, resolution: 'escalated', decision: 'escalated',
    resolvedBy: 'user',
    reason: '超出 Agent 社会自治边界，需用户裁决',
    trustImpacts: [],
    userPrompt: {
      title: `${input.challengerId} 质疑 ${input.defenderId} 的${input.subject.type === 'action' ? '操作' : '判断'}`,
      challengerPosition: challengerStance?.reasoning ?? '',
      defenderPosition: defenderStance?.reasoning ?? '',
      risk: input.risk,
      blastRadius: input.blastRadius,
    },
  }
}
