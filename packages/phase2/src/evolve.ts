// ═══════════════════════════════════════════════════════════════
// Evolve — 自主社会演化引擎
//
// 不依赖按钮。每次调用 evolve() 推进社会一步。
// 步骤由当前状态决定（信任图、声誉、角色、事件历史）。
//
// 使用: demo server 调用 evolve(ws) → 返回更新后的 state
//       前端定时轮询 → 看到社会自然演化
// ═══════════════════════════════════════════════════════════════

import { type WorkspaceState, addEvent, updateTrust, setPhase, setAgentSleep, setAgentWake, addSkill, addRule, saveWorkspace, loadWorkspace } from './workspace.js'
import { initReputation, applyReputationImpacts } from './reputation.js'
import { proposeCooperation } from './cooperation.js'
import { delegateTask } from './delegation.js'
import { askAdvice } from './consultation.js'
import { runCompetition } from './competition.js'
import { endorse } from './endorsement.js'
import { observe } from './observation.js'
import { initProfile, detectRoles, recordInteraction } from './roles.js'
import { resolveDispute } from './dispute.js'

// ═══════════════════════════════════════════════════════════════
// Step types
// ═══════════════════════════════════════════════════════════════

type StepType = 'cooperation' | 'delegation' | 'consultation' | 'competition' | 'endorsement' | 'observation' | 'dispute' | 'sleep' | 'wake'

interface StepResult {
  type: StepType
  summary: string
  events: string[]
}

// ═══════════════════════════════════════════════════════════════

const CYCLE_LENGTH = 5 // steps before sleep
const AGENT_IDS = ['agent-executor', 'agent-reviewer', 'agent-guide']

export async function evolve(ws: WorkspaceState, workspaceDir: string, hasApiKey: boolean): Promise<{ stepType: StepType; stepSummary: string }> {
  ensureState(ws)

  // Count steps since last sleep
  const stepsSinceSleep = countStepsSinceSleep(ws)

  // ── Enforce cycle: after N steps, sleep → wake → reset ──
  if (stepsSinceSleep >= CYCLE_LENGTH) {
    return await runSleepWake(ws, workspaceDir, hasApiKey)
  }

  // ── Determine next step probabilistically from state ──
  const step = pickNextStep(ws, stepsSinceSleep)
  const result = executeStep(ws, step)

  // Update profiles and roles
  updateProfiles(ws, step)

  // Record events
  for (const evt of result.events) {
    addEvent(ws, { phase: step === 'sleep' ? 'sleep' : step === 'dispute' ? 'dispute' : 'work', summary: evt })
  }
  addEvent(ws, { phase: 'work', summary: `[${stepLabel(step)}] ${result.summary}` })

  setPhase(ws, step === 'sleep' ? 'sleep' : step === 'dispute' ? 'dispute' : 'work')
  saveWorkspace(workspaceDir, ws)

  return { stepType: step, stepSummary: result.summary }
}

// ═══════════════════════════════════════════════════════════════

function ensureState(ws: WorkspaceState): void {
  if (!ws.reputation || Object.keys(ws.reputation).length === 0) {
    ws.reputation = initReputation(AGENT_IDS)
  }
  for (const id of AGENT_IDS) {
    ws.behaviorProfiles[id] ??= initProfile(id)
    ws.emergentRoles[id] ??= []
  }
}

function countStepsSinceSleep(ws: WorkspaceState): number {
  let count = 0
  for (let i = ws.events.length - 1; i >= 0; i--) {
    const e = ws.events[i]
    if (e.phase === 'sleep') break
    if (e.phase !== 'wake') count++
  }
  return count
}

function pickNextStep(ws: WorkspaceState, stepsSinceSleep: number): StepType {
  const weights: [StepType, number][] = []

  // Cooperation: likely when mutual trust is high and recent cooperation is low
  const avgTrust = averageMutualTrust(ws.trustGraph)
  const coopWeight = avgTrust >= 60 ? 25 : avgTrust >= 45 ? 15 : 5
  weights.push(['cooperation', coopWeight])

  // Delegation: likely when there's a competence gap
  const maxCompGap = maxReputationGap(ws.reputation, 'competence')
  const delegWeight = maxCompGap >= 15 ? 20 : 8
  weights.push(['delegation', delegWeight])

  // Consultation: likely when there's a knowledge gap
  const maxKnowGap = maxReputationGap(ws.reputation, 'knowledge')
  const consultWeight = maxKnowGap >= 10 ? 18 : 10
  weights.push(['consultation', consultWeight])

  // Competition: more likely when multiple agents have high competence
  const highCompCount = countHighReputation(ws.reputation, 'competence', 55)
  const compWeight = highCompCount >= 2 ? 15 : 5
  weights.push(['competition', compWeight])

  // Endorsement: more likely after cooperation or delegation
  const recentCoop = countRecentBehavior(ws, 'cooperation', 3)
  const endorsementWeight = recentCoop > 0 ? 15 : 5
  weights.push(['endorsement', endorsementWeight])

  // Observation: always some chance — it's ambient
  const observeWeight = 20
  weights.push(['observation', observeWeight])

  // Dispute: more likely when trust is low or diverging
  const avgTrustLow = avgTrust < 45
  const disputeWeight = avgTrustLow ? 20 : 8
  weights.push(['dispute', disputeWeight])

  // Weighted random pick
  const total = weights.reduce((s, [, w]) => s + w, 0)
  let roll = Math.random() * total
  for (const [step, weight] of weights) {
    roll -= weight
    if (roll <= 0) return step
  }
  return 'observation' // fallback
}

function executeStep(ws: WorkspaceState, step: StepType): StepResult {
  const tg = ws.trustGraph
  const rep = ws.reputation

  switch (step) {
    case 'cooperation': {
      const pair = pickPair(tg, 40)
      const goal = sampleGoal()
      const result = proposeCooperation({
        initiatorId: pair[0], partnerId: pair[1], goal,
        division: { [pair[0]]: '负责主要实现', [pair[1]]: '负责审查和测试' },
        trustGraph: tg,
      })
      for (const ti of result.trustImpacts) updateTrust(ws, ti.fromId, ti.toId, ti.delta)
      applyReputationImpacts(ws.reputation, result.reputationImpacts)
      return { type: 'cooperation', summary: result.outcome, events: [result.outcome] }
    }

    case 'delegation': {
      const deleg = pickByReputation(ws.reputation, 'competence')
      const task = sampleTask()
      const result = delegateTask({
        delegatorId: deleg.low, delegateId: deleg.high, task,
        reason: `声誉显示 ${deleg.high} 更擅长此类任务`,
        trustGraph: tg, reputation: rep,
      })
      for (const ti of result.trustImpacts) updateTrust(ws, ti.fromId, ti.toId, ti.delta)
      applyReputationImpacts(ws.reputation, result.reputationImpacts)
      return { type: 'delegation', summary: result.outcome, events: [result.outcome] }
    }

    case 'consultation': {
      const consult = pickByReputation(ws.reputation, 'knowledge')
      const question = sampleQuestion()
      const result = askAdvice({
        consulterId: consult.low, advisorId: consult.high, question,
        context: '项目开发过程中遇到的技术问题',
        trustGraph: tg, reputation: rep,
      })
      for (const ti of result.trustImpacts) updateTrust(ws, ti.fromId, ti.toId, ti.delta)
      applyReputationImpacts(ws.reputation, result.reputationImpacts)
      return { type: 'consultation', summary: result.outcome, events: [result.outcome] }
    }

    case 'competition': {
      const proposals = AGENT_IDS.filter(id => (rep[id]?.competence ?? 50) >= 45).map(id => ({
        agentId: id,
        proposal: `${id}: ${sampleGoal()}`,
        strengths: ['方案完整', '考虑边界条件'],
        risks: ['执行复杂度'],
      }))
      if (proposals.length < 2) {
        return { type: 'competition', summary: '参与竞争的 agent 不足', events: [] }
      }
      const result = runCompetition({
        goal: sampleGoal(), proposals,
        trustGraph: tg, reputation: rep,
      })
      for (const ti of result.trustImpacts) updateTrust(ws, ti.fromId, ti.toId, ti.delta)
      applyReputationImpacts(ws.reputation, result.reputationImpacts)
      return { type: 'competition', summary: result.outcome, events: [result.outcome] }
    }

    case 'endorsement': {
      const pair = pickPair(tg, 50)
      const dims: Array<'competence' | 'reliability' | 'cooperativeness' | 'knowledge'> = ['competence', 'reliability', 'cooperativeness', 'knowledge']
      const dim = dims[Math.floor(Math.random() * dims.length)]
      const result = endorse({
        endorserId: pair[0], endorseeId: pair[1], dimension: dim,
        reason: `在近期工作中表现出色`,
        trustGraph: tg, reputation: rep,
      })
      for (const ti of result.trustImpacts) updateTrust(ws, ti.fromId, ti.toId, ti.delta)
      applyReputationImpacts(ws.reputation, result.reputationImpacts)
      return { type: 'endorsement', summary: result.outcome, events: [result.outcome] }
    }

    case 'observation': {
      const [observer, subject] = pickPair(tg, 0)
      const behaviors = [
        '主动帮助其他 agent 解决问题',
        '按时交付了重构任务，质量良好',
        '在 code review 中指出了潜在的安全问题',
        '拒绝了一次合作邀请，理由是信任不足',
        '接受了委托任务并提前完成',
        '在讨论中诚实承认了自己之前的设计缺陷',
      ]
      const behavior = behaviors[Math.floor(Math.random() * behaviors.length)]
      const result = observe({
        observerId: observer, subjectId: subject, behavior,
        interpretation: `${observer} 对 ${subject} 的行为形成判断`,
        trustGraph: tg, reputation: rep,
      })
      for (const ti of result.trustImpacts) updateTrust(ws, ti.fromId, ti.toId, ti.delta)
      applyReputationImpacts(ws.reputation, result.reputationImpacts)
      return { type: 'observation', summary: result.outcome, events: [result.outcome] }
    }

    case 'dispute': {
      const pair = pickPair(tg, -1) //随机对，任意信任度
      const result = resolveDispute({
        disputeId: `d-${Date.now()}`,
        subject: { type: 'action', targetId: `task-${Math.floor(Math.random() * 100)}`, description: sampleGoal() },
        risk: Math.random() < 0.2 ? 'high' : 'medium',
        challengerId: pair[0], defenderId: pair[1],
        stances: [
          { agentId: pair[0], position: 'block', reasoning: '存在潜在风险，需要进一步验证' },
          { agentId: pair[1], position: 'approve', reasoning: '方案经过充分测试，风险可控' },
        ],
        trustGraph: tg,
        reversible: true,
        availableMediators: AGENT_IDS.filter(id => id !== pair[0] && id !== pair[1]),
      })
      for (const ti of result.trustImpacts) updateTrust(ws, ti.fromId, ti.toId, ti.delta)
      return {
        type: 'dispute',
        summary: `[${result.resolution}] ${result.reason}`,
        events: [result.reason],
      }
    }

    default:
      return { type: 'observation', summary: '无事发生', events: [] }
  }
}

async function runSleepWake(ws: WorkspaceState, workspaceDir: string, hasApiKey: boolean): Promise<{ stepType: StepType; stepSummary: string }> {
  const primary = ws.agents[0]
  const packet = hasApiKey
    ? await runLiveSleep(primary.id, primary.label, ws)
    : deterministicSleepPacket(primary.id, ws)

  setAgentSleep(ws, primary.id, packet)
  addEvent(ws, {
    phase: 'sleep',
    summary: `Dream: ${(packet as any)?.dream?.cleaned?.length ?? 0}c/${(packet as any)?.dream?.updated?.length ?? 0}u`,
  })

  // Wake
  const { wake } = await import('./sleepWake.js')
  const decl = wake({
    packet: packet as any,
    currentAgent: { agentId: primary.id, label: primary.label, modelId: primary.modelId, instructionsHash: primary.instructionsHash, toolHash: primary.toolHash },
    permissionState: 'inherited',
  })
  setAgentWake(ws, primary.id, decl as unknown as Record<string, unknown>)
  addEvent(ws, { phase: 'wake', summary: `醒来: ${(decl as any).constraints?.length ?? 0} 约束` })

  setPhase(ws, 'work')
  saveWorkspace(workspaceDir, ws)

  return {
    type: 'sleep',
    stepSummary: `5 步后进入睡眠 — Dream: ${(packet as any)?.dream?.crossAnalysis?.length ?? 0} 洞察 · Wake: ${(decl as any).constraints?.length ?? 0} 约束`,
  }
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function pickPair(tg: Record<string, Record<string, number>>, minTrust: number): [string, string] {
  const pairs = AGENT_IDS.flatMap(a => AGENT_IDS.filter(b => b !== a).map(b => [a, b] as [string, string]))
  // Filter by min trust if needed
  const valid = minTrust <= 0 ? pairs : pairs.filter(([a, b]) => (tg[a]?.[b] ?? 50) >= minTrust)
  if (valid.length === 0) return [AGENT_IDS[0], AGENT_IDS[1]]
  return valid[Math.floor(Math.random() * valid.length)]
}

function pickByReputation(rep: Record<string, Record<string, number>>, dim: string): { low: string; high: string } {
  const scores = AGENT_IDS.map(id => ({ id, score: rep[id]?.[dim] ?? 50 }))
  scores.sort((a, b) => b.score - a.score)
  return { low: scores[scores.length - 1].id, high: scores[0].id }
}

function averageMutualTrust(tg: Record<string, Record<string, number>>): number {
  let sum = 0, count = 0
  for (const a of AGENT_IDS) {
    for (const b of AGENT_IDS) {
      if (a !== b) { sum += tg[a]?.[b] ?? 50; count++ }
    }
  }
  return count > 0 ? sum / count : 50
}

function maxReputationGap(rep: Record<string, Record<string, number>>, dim: string): number {
  const scores = AGENT_IDS.map(id => rep[id]?.[dim] ?? 50)
  return Math.max(...scores) - Math.min(...scores)
}

function countHighReputation(rep: Record<string, Record<string, number>>, dim: string, threshold: number): number {
  return AGENT_IDS.filter(id => (rep[id]?.[dim] ?? 50) >= threshold).length
}

function countRecentBehavior(ws: WorkspaceState, type: string, lookback: number): number {
  return ws.events.slice(-lookback).filter(e => e.summary.startsWith(`[${stepLabel(type as StepType)}]`)).length
}

function updateProfiles(ws: WorkspaceState, step: StepType): void {
  const profileMap: Record<StepType, Array<{ id: string; action: Parameters<typeof recordInteraction>[1] }>> = {
    cooperation: [
      { id: AGENT_IDS[0], action: 'cooperation' },
      { id: AGENT_IDS[2], action: 'cooperation' },
    ],
    delegation: [
      { id: AGENT_IDS[0], action: 'delegation-given' },
      { id: AGENT_IDS[1], action: 'delegation-received' },
    ],
    consultation: [
      { id: AGENT_IDS[2], action: 'consultation-taken' },
      { id: AGENT_IDS[0], action: 'consultation-given' },
      { id: AGENT_IDS[0], action: 'consultation-accepted' },
    ],
    competition: [
      { id: AGENT_IDS[0], action: 'dispute-initiated' },
    ],
    endorsement: [
      { id: AGENT_IDS[0], action: 'consultation-given' },
      { id: AGENT_IDS[1], action: 'consultation-accepted' },
    ],
    observation: [],
    dispute: [
      { id: AGENT_IDS[1], action: 'dispute-initiated' },
      { id: AGENT_IDS[0], action: 'dispute-defended' },
    ],
    sleep: [],
    wake: [],
  }

  for (const entry of profileMap[step] ?? []) {
    ws.behaviorProfiles[entry.id] ??= initProfile(entry.id)
    recordInteraction(ws.behaviorProfiles[entry.id], entry.action)
  }

  for (const id of AGENT_IDS) {
    ws.emergentRoles[id] = detectRoles(ws.behaviorProfiles[id] ?? initProfile(id))
  }
}

function stepLabel(step: StepType): string {
  const labels: Record<StepType, string> = {
    cooperation: '合作', delegation: '委托', consultation: '咨询',
    competition: '竞争', endorsement: '背书', observation: '观察',
    dispute: '争议', sleep: '睡眠', wake: '醒来',
  }
  return labels[step]
}

// ── Sample data for demo ──

const GOALS = [
  '重构 auth 模块', '优化数据库查询', '添加缓存层', '升级依赖包',
  '修复 CI 流水线', '改进错误处理', '添加日志系统', '迁移到新 API',
]
const TASKS = [
  '审计安全漏洞', '优化性能瓶颈', '编写单元测试',
  '更新 API 文档', '清理技术债务', '添加监控指标',
]
const QUESTIONS = [
  '如何处理循环依赖问题？', '缓存策略应该怎么设计？',
  '如何评估用户的技术水平？', '什么时候应该重构 vs 重写？',
  '如何平衡性能和可读性？',
]

function sampleGoal() { return GOALS[Math.floor(Math.random() * GOALS.length)] }
function sampleTask() { return TASKS[Math.floor(Math.random() * TASKS.length)] }
function sampleQuestion() { return QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)] }

async function runLiveSleep(agentId: string, label: string, ws: WorkspaceState): Promise<Record<string, unknown>> {
  const { sleep } = await import('./sleepWake.js')
  const packet = await sleep({
    agent: { agentId, label, modelId: 'deepseek-v4-flash', instructionsHash: 'abc', toolHash: 'v2' },
    sessionId: `session-${Date.now()}`,
    sessionSummary: `社会演化第 ${ws.events.length} 步`,
    events: ws.events.slice(-5).map(e => ({ type: e.phase, description: e.summary })),
    memories: [],
    pendingDisputes: [],
    trustGraph: ws.trustGraph,
  })
  return packet as unknown as Record<string, unknown>
}

function deterministicSleepPacket(agentId: string, ws: WorkspaceState): Record<string, unknown> {
  return {
    sleepId: `sleep-${agentId}-${Date.now()}`,
    agentId, sessionId: 'evolve-001', sleptAt: new Date().toISOString(),
    resolvedDisputes: [],
    dream: {
      dreamId: `dream-${agentId}`,
      merged: [], cleaned: [], updated: [],
      crossAnalysis: [
        { pattern: '多次合作中信任稳定增长', evidence: ws.events.filter(e => e.summary.includes('合作')).map(e => e.summary.slice(0, 30)), insight: '建立信任需要至少 3 次成功互动' },
        { pattern: 'competence 声誉分化明显', evidence: ['delegation events'], insight: '任务委托加速了能力声誉的分化' },
      ],
    },
    relationshipChanges: [],
    resumeAnchor: { context: `社会已运行 ${ws.events.length} 步`, newConstraints: [], attentionItems: [] },
  }
}
