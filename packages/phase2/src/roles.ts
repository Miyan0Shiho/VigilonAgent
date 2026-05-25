// ═══════════════════════════════════════════════════════════════
// Roles — 从累积行为中检测涌现角色
//
// 角色是描述标签，不是约束。Agent 不因为被标记为"审查者"就不能合作。
// 标签帮助用户理解社会动态，但不限制 agent 行为。
// ═══════════════════════════════════════════════════════════════

export interface BehaviorProfile {
  agentId: string
  disputesInitiated: number
  disputesDefended: number
  cooperationsParticipated: number
  delegationsReceived: number
  delegationsGiven: number
  consultationsGiven: number
  consultationsTaken: number
  consultationsAccepted: number // advice was accepted
  totalInteractions: number
}

export function initProfile(agentId: string): BehaviorProfile {
  return {
    agentId,
    disputesInitiated: 0,
    disputesDefended: 0,
    cooperationsParticipated: 0,
    delegationsReceived: 0,
    delegationsGiven: 0,
    consultationsGiven: 0,
    consultationsTaken: 0,
    consultationsAccepted: 0,
    totalInteractions: 0,
  }
}

export function detectRoles(profile: BehaviorProfile): string[] {
  const roles: string[] = []
  const { totalInteractions } = profile

  if (totalInteractions < 3) {
    return ['观察期'] // not enough data
  }

  const disputeRatio = profile.disputesInitiated / totalInteractions
  const cooperationRatio = profile.cooperationsParticipated / totalInteractions
  const delegationRatio = profile.delegationsReceived / totalInteractions
  const consultationRatio = profile.consultationsGiven / totalInteractions
  const adviceQuality = profile.consultationsGiven > 0
    ? profile.consultationsAccepted / profile.consultationsGiven
    : 0

  // Critic pattern: frequently challenges others
  if (disputeRatio >= 0.25 && profile.disputesInitiated >= 2) {
    roles.push('质疑者')
  }

  // Executor pattern: frequently receives delegation
  if (delegationRatio >= 0.2 && profile.delegationsReceived >= 2) {
    roles.push('执行者')
  }

  // Collaborator pattern: frequently cooperates
  if (cooperationRatio >= 0.3 && profile.cooperationsParticipated >= 2) {
    roles.push('协作者')
  }

  // Consultant pattern: frequently gives advice that's accepted
  if (consultationRatio >= 0.2 && adviceQuality >= 0.5 && profile.consultationsGiven >= 2) {
    roles.push('顾问')
  }

  // Learner pattern: frequently seeks advice
  if ((profile.consultationsTaken / totalInteractions) >= 0.3 && profile.consultationsTaken >= 2) {
    roles.push('学习者')
  }

  // Generalist: does a bit of everything
  if (
    roles.length === 0 &&
    totalInteractions >= 5 &&
    profile.cooperationsParticipated > 0 &&
    profile.consultationsTaken > 0
  ) {
    roles.push('通才')
  }

  // Still nothing? Default based on most frequent behavior
  if (roles.length === 0 && totalInteractions >= 3) {
    const counts: [string, number][] = [
      ['质疑者', profile.disputesInitiated],
      ['协作者', profile.cooperationsParticipated],
      ['执行者', profile.delegationsReceived],
      ['顾问', profile.consultationsGiven],
    ]
    counts.sort(([, a], [, b]) => b - a)
    if (counts[0][1] > 0) roles.push(counts[0][0])
  }

  return roles
}

export function recordInteraction(
  profile: BehaviorProfile,
  type: 'dispute-initiated' | 'dispute-defended' | 'cooperation' | 'delegation-received' | 'delegation-given' | 'consultation-given' | 'consultation-taken' | 'consultation-accepted',
): BehaviorProfile {
  switch (type) {
    case 'dispute-initiated': profile.disputesInitiated++; break
    case 'dispute-defended': profile.disputesDefended++; break
    case 'cooperation': profile.cooperationsParticipated++; break
    case 'delegation-received': profile.delegationsReceived++; break
    case 'delegation-given': profile.delegationsGiven++; break
    case 'consultation-given': profile.consultationsGiven++; break
    case 'consultation-taken': profile.consultationsTaken++; break
    case 'consultation-accepted': profile.consultationsAccepted++; break
  }
  profile.totalInteractions++
  return profile
}
