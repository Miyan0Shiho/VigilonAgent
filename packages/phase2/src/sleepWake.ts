// ═══════════════════════════════════════════════════════════════
// Sleep/Wake — Agent 生命周期衔接
//
// 每个 Agent 是 Phase 1 的原子 Agent（自带 loop/transcript/memory/permissions）。
// Sleep/Wake 是 Phase 2 在 Phase 1 的 session 边界上做的社会层处理。
//
// Sleep（Phase 1 session 结束时触发）:
//   1. 解决该 Agent 相关的未决争议
//   2. 运行 Dream（整理该 Agent 的记忆）
//   3. 生成 SleepPacket → 追加 sleep-boundary 到 Phase 1 Transcript
//
// Wake（Phase 1 session 启动时触发）:
//   1. 读取上次 SleepPacket
//   2. 检查身份连续性（model/tools/instructions 是否变化）
//   3. 恢复约束和关系状态
//   4. 生成 WakeDeclaration → 追加 wake-boundary 到 Phase 1 Transcript
// ═══════════════════════════════════════════════════════════════

import { runDream, type DreamInput, type DreamOutput } from './dream.js'
import { resolveDispute, type DisputeInput, type DisputeResult } from './dispute.js'

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type AgentRef = {
  agentId: string
  /** Display label — not used by social mechanisms */
  label: string
  modelId: string
  instructionsHash: string
  toolHash: string
}

export type SleepInput = {
  agent: AgentRef
  sessionId: string
  /** Session summary from Phase 1 SessionMemory */
  sessionSummary: string
  /** Key transcript events from this session */
  events: { type: string; description: string; outcome?: string }[]
  /** Agent's existing memories — from Phase 1 ProjectMemory */
  memories: { id: string; content: string; kind: string }[]
  /** Unresolved disputes involving this agent */
  pendingDisputes?: DisputeInput[]
  /** Current social trust graph */
  trustGraph: Record<string, Record<string, number>>
  dreamOptions?: { apiKey?: string; baseUrl?: string; model?: string }
}

export type SleepPacket = {
  sleepId: string
  agentId: string
  sessionId: string
  sleptAt: string
  resolvedDisputes: DisputeResult[]
  dream: DreamOutput
  relationshipChanges: { fromId: string; toId: string; before: number; after: number; delta: number; reason: string }[]
  resumeAnchor: {
    context: string
    newConstraints: string[]
    attentionItems: { priority: 'high' | 'medium'; text: string }[]
  }
}

export type WakeInput = {
  packet: SleepPacket
  currentAgent: AgentRef
  permissionState: 'inherited' | 'reduced' | 'needs-reauth'
  externalChanges?: { modelChanged?: string; toolsChanged?: string[] }
}

export type WakeDeclaration = {
  wakeId: string
  agentId: string
  fromSleepId: string
  wokeAt: string
  identity: { stillSameAgent: boolean; driftSummary: string }
  memoryChanges: { id: string; change: 'merged' | 'cleaned' | 'updated'; description: string }[]
  constraints: string[]
  relationshipState: { trustLevels: Record<string, number>; keyChanges: string[] }
  permissionStatus: { state: string; changes: string[] }
  userAttention: { needsAttention: boolean; items: { priority: string; text: string }[] }
}

// ═══════════════════════════════════════════════════════════════
// Sleep
// ═══════════════════════════════════════════════════════════════

export async function sleep(input: SleepInput): Promise<SleepPacket> {
  const sleepId = `sleep-${input.agent.agentId}-${Date.now()}`
  const relationshipDeltas: Record<string, Record<string, number>> = {}
  const resolvedDisputes: DisputeResult[] = []

  // 1. Resolve pending disputes
  for (const d of input.pendingDisputes ?? []) {
    const r = resolveDispute(d)
    resolvedDisputes.push(r)
    for (const impact of r.trustImpacts) {
      relationshipDeltas[impact.fromId] ??= {}
      relationshipDeltas[impact.fromId][impact.toId] ??= 0
      relationshipDeltas[impact.fromId][impact.toId] += impact.delta
    }
  }

  // 2. Dream
  const dream = await runDream({
    agentId: input.agent.agentId,
    sessionId: input.sessionId,
    memories: input.memories,
    sessionSummary: input.sessionSummary,
    events: input.events,
  }, input.dreamOptions)

  // 3. Relationship changes
  const relationshipChanges: SleepPacket['relationshipChanges'] = []
  for (const [fromId, targets] of Object.entries(relationshipDeltas)) {
    for (const [toId, delta] of Object.entries(targets)) {
      const before = input.trustGraph[fromId]?.[toId] ?? 50
      const after = Math.max(0, Math.min(100, before + delta))
      if (delta !== 0) {
        relationshipChanges.push({ fromId, toId, before, after, delta, reason: 'sleep 期间关系的调整' })
      }
    }
  }

  // 4. Resume anchor
  const constraints: string[] = []
  for (const ca of dream.crossAnalysis) {
    if (ca.insight && (ca.insight.includes('必须') || ca.insight.includes('先') || ca.insight.includes('不能'))) {
      constraints.push(ca.insight)
    }
  }
  for (const d of resolvedDisputes) {
    if (d.decision === 'block') constraints.push(`禁止: ${d.reason}`)
    if (d.modifiedPlan) constraints.push(`需修改: ${d.modifiedPlan}`)
  }

  const attentionItems: SleepPacket['resumeAnchor']['attentionItems'] = []
  for (const d of resolvedDisputes) {
    if (d.resolution === 'escalated') {
      attentionItems.push({ priority: 'high', text: `未决争议: ${d.disputeId}` })
    }
  }
  if (dream.cleaned.length + dream.updated.length >= 3) {
    attentionItems.push({ priority: 'medium', text: `${dream.cleaned.length + dream.updated.length} 条记忆被整理` })
  }

  return {
    sleepId, agentId: input.agent.agentId, sessionId: input.sessionId,
    sleptAt: new Date().toISOString(),
    resolvedDisputes, dream, relationshipChanges,
    resumeAnchor: { context: input.sessionSummary, newConstraints: constraints, attentionItems },
  }
}

// ═══════════════════════════════════════════════════════════════
// Wake
// ═══════════════════════════════════════════════════════════════

export function wake(input: WakeInput): WakeDeclaration {
  const { packet, currentAgent, externalChanges } = input
  const wakeId = `wake-${packet.sleepId}-${Date.now()}`

  const hasExternalChanges = !!externalChanges?.modelChanged || (externalChanges?.toolsChanged?.length ?? 0) > 0
  const stillSameAgent = !hasExternalChanges
  const driftSummary = hasExternalChanges ? `模型变更: ${externalChanges?.modelChanged ?? '未知'}` : '无变化'

  const memoryChanges: WakeDeclaration['memoryChanges'] = []
  for (const c of packet.dream.cleaned) memoryChanges.push({ id: c.target, change: 'cleaned', description: c.reason })
  for (const u of packet.dream.updated) memoryChanges.push({ id: u.target, change: 'updated', description: `${u.oldContent} → ${u.newContent}` })
  for (const m of packet.dream.merged) {
    for (const s of m.sources) memoryChanges.push({ id: s, change: 'merged', description: `合并到: ${m.into.slice(0, 50)}` })
  }

  const trustLevels: Record<string, number> = {}
  for (const rc of packet.relationshipChanges) trustLevels[`${rc.fromId}→${rc.toId}`] = rc.after

  const keyChanges = packet.relationshipChanges
    .filter(rc => Math.abs(rc.delta) >= 10)
    .map(rc => `${rc.fromId}→${rc.toId}: ${rc.before}% → ${rc.after}%`)

  const attentionItems = [
    ...packet.resumeAnchor.attentionItems,
    ...(hasExternalChanges ? [{ priority: 'medium', text: `环境变化: ${driftSummary}` }] : []),
  ]

  return {
    wakeId, agentId: packet.agentId, fromSleepId: packet.sleepId,
    wokeAt: new Date().toISOString(),
    identity: { stillSameAgent, driftSummary },
    memoryChanges, constraints: packet.resumeAnchor.newConstraints,
    relationshipState: { trustLevels, keyChanges },
    permissionStatus: {
      state: hasExternalChanges ? 'needs-reauth' : input.permissionState,
      changes: hasExternalChanges ? ['权限需重新确认'] : [],
    },
    userAttention: { needsAttention: attentionItems.length > 0 || !stillSameAgent, items: attentionItems },
  }
}
