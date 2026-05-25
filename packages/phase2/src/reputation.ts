// ═══════════════════════════════════════════════════════════════
// Reputation — 多维公开声誉
//
// 区别:
//   Trust   = 私有的、定向的   (A→B: 我信任 B 多少)
//   Reputation = 公开的、多维度的 (社会公认 B 在 X 方面能力如何)
//
// 所有社会行为共同更新声誉，声誉影响委托/合作/咨询等行为的决策。
// ═══════════════════════════════════════════════════════════════

export type ReputationDimension = 'competence' | 'reliability' | 'cooperativeness' | 'integrity' | 'knowledge'

export const REPUTATION_DIMENSIONS: ReputationDimension[] = [
  'competence', 'reliability', 'cooperativeness', 'integrity', 'knowledge',
]

export type ReputationScores = Record<ReputationDimension, number>

export type ReputationState = Record<string, ReputationScores>

export interface ReputationImpact {
  agentId: string
  dimension: ReputationDimension
  delta: number
  reason: string
}

// ═══════════════════════════════════════════════════════════════

export function initReputation(agentIds: string[]): ReputationState {
  const state: ReputationState = {}
  for (const id of agentIds) {
    state[id] = {
      competence: 50,
      reliability: 50,
      cooperativeness: 50,
      integrity: 50,
      knowledge: 50,
    }
  }
  return state
}

export function getReputation(state: ReputationState, agentId: string): ReputationScores {
  return state[agentId] ?? {
    competence: 50,
    reliability: 50,
    cooperativeness: 50,
    integrity: 50,
    knowledge: 50,
  }
}

export function applyReputationImpacts(
  state: ReputationState,
  impacts: ReputationImpact[],
): ReputationState {
  for (const imp of impacts) {
    const scores = getReputation(state, imp.agentId)
    scores[imp.dimension] = clamp(scores[imp.dimension] + imp.delta)
    state[imp.agentId] = scores
  }
  return state
}

export function getTopAgent(
  state: ReputationState,
  dimension: ReputationDimension,
  excludeIds: string[] = [],
): string | null {
  let best: string | null = null
  let bestScore = -1
  for (const [id, scores] of Object.entries(state)) {
    if (excludeIds.includes(id)) continue
    if (scores[dimension] > bestScore) {
      bestScore = scores[dimension]
      best = id
    }
  }
  return best
}

export function summarizeReputation(state: ReputationState, agentId: string): string {
  const scores = getReputation(state, agentId)
  const entries = Object.entries(scores)
    .filter(([, v]) => v >= 60)
    .sort(([, a], [, b]) => b - a)
  if (entries.length === 0) return '暂无突出声誉'
  return entries.map(([dim, val]) => `${dimLabel(dim)} ${val}%`).join(' · ')
}

// ═══════════════════════════════════════════════════════════════

function clamp(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)))
}

const DIM_LABELS: Record<ReputationDimension, string> = {
  competence: '能力',
  reliability: '可靠',
  cooperativeness: '合作',
  integrity: '诚信',
  knowledge: '知识',
}

export function dimLabel(dim: ReputationDimension): string {
  return DIM_LABELS[dim]
}
