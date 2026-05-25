// ═══════════════════════════════════════════════════════════════
// Competition — 多个 agent 提出不同方案，择优采纳
//
// 模式: 多方提案 → 基于声誉+信任评估 → 选出最佳方案
// ═══════════════════════════════════════════════════════════════

import type { ReputationImpact, ReputationScores } from './reputation.js'

export interface CompetitionInput {
  goal: string
  proposals: {
    agentId: string
    proposal: string
    strengths: string[]
    risks: string[]
  }[]
  trustGraph: Record<string, Record<string, number>>
  reputation: Record<string, ReputationScores>
  judgeId?: string // who decides (default: highest integrity reputation)
}

export interface CompetitionResult {
  winnerId: string
  runnerUpId?: string
  outcome: string
  scores: { agentId: string; score: number; breakdown: string }[]
  trustImpacts: { fromId: string; toId: string; delta: number; reason: string }[]
  reputationImpacts: ReputationImpact[]
}

// ═══════════════════════════════════════════════════════════════

export function runCompetition(input: CompetitionInput): CompetitionResult {
  const { goal, proposals, trustGraph, reputation, judgeId } = input

  // Pick judge: specified, or highest integrity reputation
  const judge = judgeId ?? findBestJudge(proposals.map(p => p.agentId), reputation)

  // Score each proposal: proposalQuality * (1 + trustBonus + repBonus)
  const scores = proposals.map(p => {
    const trustBonus = (trustGraph[judge]?.[p.agentId] ?? 50) / 100 - 0.5 // -0.5 to +0.5
    const competenceBonus = (reputation[p.agentId]?.competence ?? 50) / 100 - 0.5
    const integrityBonus = (reputation[p.agentId]?.integrity ?? 50) / 100 - 0.5
    const strengthScore = Math.min(p.strengths.length * 0.2, 0.4)
    const riskPenalty = Math.min(p.risks.length * 0.1, 0.2)
    const baseScore = 0.5 + strengthScore - riskPenalty
    const finalScore = baseScore * (1 + trustBonus * 0.3 + competenceBonus * 0.25 + integrityBonus * 0.15)
    return {
      agentId: p.agentId,
      score: Math.round(finalScore * 100),
      breakdown: `基础:${(baseScore * 100).toFixed(0)} 信任:${(trustBonus * 100).toFixed(0)} 能力:${(competenceBonus * 100).toFixed(0)}`,
    }
  })

  scores.sort((a, b) => b.score - a.score)
  const winner = scores[0]
  const runnerUp = scores.length > 1 ? scores[1] : undefined

  const trustImpacts: CompetitionResult['trustImpacts'] = []
  const reputationImpacts: ReputationImpact[] = []

  // Winner gains competence reputation
  reputationImpacts.push({
    agentId: winner.agentId, dimension: 'competence', delta: 5,
    reason: `赢得竞争: ${goal.slice(0, 40)}`,
  })

  // Judge's trust in winner increases
  trustImpacts.push({
    fromId: judge, toId: winner.agentId, delta: 5,
    reason: `方案获选: ${goal.slice(0, 30)}`,
  })

  // Runner-up gains minor recognition (integrity for participating)
  if (runnerUp) {
    reputationImpacts.push({
      agentId: runnerUp.agentId, dimension: 'integrity', delta: 2,
      reason: `参与竞争: ${goal.slice(0, 40)}`,
    })
  }

  // Losers don't get penalized (healthy competition)

  return {
    winnerId: winner.agentId,
    runnerUpId: runnerUp?.agentId,
    outcome: `${winner.agentId} 的方案获选（得分: ${winner.score}）`,
    scores,
    trustImpacts,
    reputationImpacts,
  }
}

function findBestJudge(
  agentIds: string[],
  reputation: Record<string, ReputationScores>,
): string {
  let best: string | null = null
  let bestIntegrity = -1
  for (const id of agentIds) {
    const integrity = reputation[id]?.integrity ?? 50
    if (integrity > bestIntegrity) {
      bestIntegrity = integrity
      best = id
    }
  }
  return best ?? agentIds[0]
}
