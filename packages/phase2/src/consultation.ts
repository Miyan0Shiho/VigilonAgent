// ═══════════════════════════════════════════════════════════════
// Consultation — 就不确定的问题寻求建议
//
// 规则:
//   咨询者信任顾问者 >= 40 → 愿意给出建议
//   建议被采纳 → 顾问者 knowledge +3, 顾问者→咨询者信任 +4
//   建议未被采纳但合理 → 无变化
//   多次高质量建议 → "顾问" 角色涌现
// ═══════════════════════════════════════════════════════════════

import type { ReputationImpact, ReputationScores } from './reputation.js'

export interface ConsultationInput {
  consulterId: string
  advisorId: string
  question: string
  context: string
  trustGraph: Record<string, Record<string, number>>
  reputation: Record<string, ReputationScores>
}

export interface ConsultationResult {
  status: 'advised' | 'declined'
  advice: string
  accepted: boolean
  outcome: string
  trustImpacts: { fromId: string; toId: string; delta: number; reason: string }[]
  reputationImpacts: ReputationImpact[]
}

// ═══════════════════════════════════════════════════════════════

const MIN_CONSULTER_TRUST = 40
const ADVICE_TRUST_DELTA = 4
const ADVICE_KNOWLEDGE_DELTA = 3

export function askAdvice(input: ConsultationInput): ConsultationResult {
  const { consulterId, advisorId, question, context, trustGraph, reputation } = input

  const consulterTrust = trustGraph[consulterId]?.[advisorId] ?? 50
  const advisorKnowledge = reputation[advisorId]?.knowledge ?? 50

  if (consulterTrust < MIN_CONSULTER_TRUST) {
    return {
      status: 'declined',
      advice: '',
      accepted: false,
      outcome: `${advisorId} 拒绝了 ${consulterId} 的咨询请求（信任不足: ${consulterTrust}%）`,
      trustImpacts: [],
      reputationImpacts: [],
    }
  }

  // Generate deterministic advice based on question + context + advisor's knowledge level
  const advice = generateAdvice(question, context, advisorId, advisorKnowledge)

  // Determine if advice is likely accepted (based on trust + knowledge)
  const accepted = consulterTrust >= 50 || advisorKnowledge >= 60

  const trustImpacts: ConsultationResult['trustImpacts'] = []
  const reputationImpacts: ReputationImpact[] = []

  if (accepted) {
    trustImpacts.push(
      { fromId: consulterId, toId: advisorId, delta: ADVICE_TRUST_DELTA, reason: '采纳了建议' },
    )
    reputationImpacts.push(
      { agentId: advisorId, dimension: 'knowledge', delta: ADVICE_KNOWLEDGE_DELTA, reason: `建议被采纳: ${question.slice(0, 40)}` },
    )
  }

  return {
    status: 'advised',
    advice,
    accepted,
    trustImpacts,
    reputationImpacts,
  }
}

// ═══════════════════════════════════════════════════════════════

function generateAdvice(
  question: string,
  context: string,
  _advisorId: string,
  knowledge: number,
): string {
  // Deterministic advice based on question keywords and advisor's knowledge level
  const quality = knowledge >= 70 ? 'strong' : knowledge >= 50 ? 'moderate' : 'basic'

  const adviceByTopic: Record<string, Record<string, string>> = {
    strong: {
      delete: '建议在删除前执行三步检查: 1) git submodule status 2) 检查引用链 3) 创建备份。基于过往类似案例的经验。',
      refactor: '建议采用渐进式重构: 先提取接口 → 再替换实现 → 最后删除旧代码。测试覆盖率应保持 >80%。',
      architecture: '基于此项目的 monorepo 结构，建议将共享逻辑提取到 packages/shared，避免循环依赖。',
      security: '建议在 CI 中加入安全扫描步骤，并对敏感操作添加二次确认机制。',
      default: `基于对「${question.slice(0, 30)}」的分析和相关经验，建议先验证前提假设，再从最小可行方案开始迭代。`,
    },
    moderate: {
      delete: '建议先确认目录是否被其他模块引用，再执行删除。可以考虑先移动到临时目录观察一段时间。',
      refactor: '重构时注意保持测试通过，每次只改一个模块。可以先写测试再重构。',
      architecture: '建议先画出模块依赖图，避免引入循环依赖。保持接口稳定。',
      security: '关注输入验证和权限检查。基本的安全措施不要跳过。',
      default: `针对「${question.slice(0, 30)}」，建议参考已有最佳实践，从简单方案开始逐步优化。`,
    },
    basic: {
      delete: '删除前确认没有重要文件被误删。建议先备份。',
      refactor: '建议从小范围开始，确保每一步都可以回退。',
      architecture: '保持简单，避免过度设计。先满足当前需求。',
      security: '注意基本的输入输出校验，不要信任外部数据。',
      default: `关于「${question.slice(0, 30)}」，建议先明确需求和约束条件。`,
    },
  }

  const level = adviceByTopic[quality] ?? adviceByTopic.basic

  for (const [keyword, text] of Object.entries(level)) {
    if (keyword === 'default') continue
    if (question.toLowerCase().includes(keyword) || context.toLowerCase().includes(keyword)) {
      return text
    }
  }
  return level.default
}
