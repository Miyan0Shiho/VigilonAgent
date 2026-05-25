// ═══════════════════════════════════════════════════════════════
// Observation — Agent 观察并评估其他 Agent 的行为
//
// 模式: A 观察 B 的行为 → 形成判断 → 更新对 B 的认知
// 不直接与 B 交互，是单向的"注视"
// ═══════════════════════════════════════════════════════════════

import type { ReputationImpact, ReputationDimension, ReputationScores } from './reputation.js'

export interface ObservationInput {
  observerId: string
  subjectId: string
  behavior: string // what was observed
  interpretation: string // how the observer interprets it
  trustGraph: Record<string, Record<string, number>>
  reputation: Record<string, ReputationScores>
}

export interface ObservationResult {
  impact: 'positive' | 'negative' | 'neutral'
  finding: { dimension: ReputationDimension; delta: number; reason: string }
  trustDelta: number
  outcome: string
  trustImpacts: { fromId: string; toId: string; delta: number; reason: string }[]
  reputationImpacts: ReputationImpact[]
}

// ═══════════════════════════════════════════════════════════════

export function observe(input: ObservationInput): ObservationResult {
  const { observerId, subjectId, behavior, interpretation, trustGraph, reputation } = input

  // Analyze behavior keywords to determine impact
  const behaviorLower = (behavior + ' ' + interpretation).toLowerCase()

  const patterns: { keywords: string[]; dimension: ReputationDimension; delta: number; label: string }[] = [
    { keywords: ['主动帮助', '协助', '合作', '配合', '帮助'], dimension: 'cooperativeness', delta: +4, label: '合作行为' },
    { keywords: ['按时完成', '稳定', '可靠', '准时', '交付'], dimension: 'reliability', delta: +5, label: '可靠行为' },
    { keywords: ['知识', '建议', '指导', '解答', '分析准确'], dimension: 'knowledge', delta: +4, label: '知识展现' },
    { keywords: ['诚实', '承认', '透明', '坦白', '如实'], dimension: 'integrity', delta: +3, label: '诚信行为' },
    { keywords: ['高质量', '优化', '提效', '改进', '优秀'], dimension: 'competence', delta: +5, label: '能力展现' },
    { keywords: ['拖延', '延迟', '逾期', '未完成', '跳过'], dimension: 'reliability', delta: -4, label: '不可靠行为' },
    { keywords: ['错误', 'bug', '问题', '事故', '失败'], dimension: 'competence', delta: -3, label: '能力缺陷' },
    { keywords: ['隐瞒', '欺骗', '绕过', '跳过检查'], dimension: 'integrity', delta: -5, label: '诚信问题' },
    { keywords: ['拒绝合作', '孤立', '不配合', '推诿'], dimension: 'cooperativeness', delta: -4, label: '不合作行为' },
  ]

  let bestMatch: typeof patterns[0] | null = null
  for (const p of patterns) {
    for (const kw of p.keywords) {
      if (behaviorLower.includes(kw)) {
        bestMatch = p
        break
      }
    }
    if (bestMatch) break
  }

  if (!bestMatch) {
    return {
      impact: 'neutral',
      finding: { dimension: 'reliability', delta: 0, reason: behavior.slice(0, 40) },
      trustDelta: 0,
      outcome: `${observerId} 观察了 ${subjectId}: "${behavior.slice(0, 40)}" — 无明确结论`,
      trustImpacts: [],
      reputationImpacts: [],
    }
  }

  const { dimension, delta, label } = bestMatch
  const observerKnowledge = reputation[observerId]?.knowledge ?? 50
  const observerTrust = trustGraph[observerId]?.[subjectId] ?? 50

  // Observation accuracy depends on observer's knowledge
  const accuracyMultiplier = observerKnowledge >= 70 ? 1.2 : observerKnowledge >= 50 ? 1.0 : 0.7
  const effectiveDelta = Math.round(delta * accuracyMultiplier)

  const impact = delta > 0 ? 'positive' : 'negative'

  // Trust change: moderated by existing trust (more impact when trust is low = surprise)
  const surprise = impact === 'positive' && observerTrust < 50 ? 1.5
    : impact === 'negative' && observerTrust > 60 ? 1.3
    : 1.0
  const trustDelta = Math.round(effectiveDelta * 0.5 * surprise)

  return {
    impact,
    finding: { dimension, delta: effectiveDelta, reason: `${label}: ${behavior.slice(0, 40)}` },
    trustDelta,
    outcome: `${observerId} 观察到 ${subjectId} 的${label}: "${behavior.slice(0, 50)}"`,
    trustImpacts: [
      { fromId: observerId, toId: subjectId, delta: trustDelta, reason: `观察: ${label}` },
    ],
    reputationImpacts: [
      { agentId: subjectId, dimension, delta: effectiveDelta, reason: `被 ${observerId} 观察: ${label}` },
    ],
  }
}
