// ═══════════════════════════════════════════════════════════════
// Workspace — Agent 社会的工作区状态持久化
//
// 工作区 = 唯一真源。前端通过 API 读取/修改，原型模块写入。
// society.json 包含: Agent、信任图、争议、技能、规则、事件
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// ═══════════════════════════════════════════════════════════════
// Workspace types (persisted to disk)
// ═══════════════════════════════════════════════════════════════

export interface WorkspaceAgent {
  id: string
  label: string
  modelId: string
  instructionsHash: string
  toolHash: string
  sessionPath?: string
  /** Per-agent sleep packet from most recent session */
  lastSleep?: Record<string, unknown>
  /** Per-agent wake declaration from most recent session */
  lastWake?: Record<string, unknown>
}

export interface WorkspaceTrustGraph {
  [fromId: string]: { [toId: string]: number }
}

export interface WorkspaceEvent {
  at: string
  phase: 'work' | 'dispute' | 'sleep' | 'wake'
  summary: string
  detail?: Record<string, unknown>
}

export interface WorkspaceState {
  version: '0.1.0'
  name: string
  createdAt: string
  updatedAt: string

  agents: WorkspaceAgent[]
  trustGraph: WorkspaceTrustGraph

  /** Society-wide skills (accumulated across all agents) */
  skills: Record<string, unknown>[]
  /** Society-wide rules (accumulated across all agents) */
  rules: Record<string, unknown>[]

  /** Current society phase */
  currentPhase: 'work' | 'dispute' | 'sleep' | 'wake'
  /** Disputes awaiting user mediation (escalated) */
  pendingDisputes: Record<string, unknown>[]

  /** Recent society events (ring buffer, last N) */
  events: WorkspaceEvent[]
}

// ═══════════════════════════════════════════════════════════════
// Frontend state (sent over the wire)
// ═══════════════════════════════════════════════════════════════

export interface BeliefItem {
  text: string
  status: 'ok' | 'warn'
  note: string
}

export interface MemoryItem {
  text: string
  source: string
}

export interface FrontendAgent {
  id: string
  label: string
  modelId: string
  shape: 'hex' | 'diamond' | 'circle'
  color: string
  glowColor: string
  homeDeskIdx: number
  beliefs: BeliefItem[]
  memory: MemoryItem[]
  relationships: Record<string, number>
  status: 'working' | 'disputing' | 'resting'
  position: { x: number; y: number }
}

export interface FrontendMediation {
  disputeId: string
  title: string
  challengerPosition: string
  defenderPosition: string
  risk: 'low' | 'medium' | 'high' | 'critical'
  challengerId: string
  defenderId: string
}

export interface FrontendEvent {
  at: string
  phase: string
  summary: string
}

export interface FrontendState {
  phase: 'work' | 'dispute' | 'sleep' | 'wake'
  source: 'live' | 'workspace' | 'fallback'
  updatedAt: string

  agents: FrontendAgent[]
  trustGraph: Record<string, Record<string, number>>
  events: FrontendEvent[]

  activeMediation: FrontendMediation | null

  lastSleep: Record<string, unknown> | null
  lastWake: Record<string, unknown> | null
}

// ═══════════════════════════════════════════════════════════════
// Agent geometry (shared with frontend)
// ═══════════════════════════════════════════════════════════════

const AGENT_STYLE: Record<string, { shape: 'hex' | 'diamond' | 'circle'; color: string; glowColor: string; homeDeskIdx: number }> = {
  'agent-executor': { shape: 'hex', color: '#e87850', glowColor: 'rgba(232,120,80,0.35)', homeDeskIdx: 0 },
  'agent-reviewer': { shape: 'diamond', color: '#5098b8', glowColor: 'rgba(80,152,184,0.35)', homeDeskIdx: 2 },
  'agent-guide': { shape: 'circle', color: '#68a878', glowColor: 'rgba(104,168,120,0.35)', homeDeskIdx: 3 },
}

// Desk positions (mirrored from frontend LAYOUT.desks)
const DESKS = [
  { x: 120, y: 140, w: 56, h: 34 },
  { x: 220, y: 90, w: 56, h: 34 },
  { x: 80, y: 270, w: 56, h: 34 },
  { x: 200, y: 220, w: 56, h: 34 },
]
const MEETING = { x: 660, y: 180 }
const LOUNGE = { x: 700, y: 410 }
const TERMINAL = { x: 170, y: 540 }

// ═══════════════════════════════════════════════════════════════
// Default workspace
// ═══════════════════════════════════════════════════════════════

export function defaultWorkspace(name: string): WorkspaceState {
  const now = new Date().toISOString()
  return {
    version: '0.1.0',
    name,
    createdAt: now,
    updatedAt: now,
    agents: buildDefaultAgents(),
    trustGraph: {
      'agent-executor': { 'agent-reviewer': 65, 'agent-guide': 85 },
      'agent-reviewer': { 'agent-executor': 55, 'agent-guide': 70 },
      'agent-guide': { 'agent-executor': 85, 'agent-reviewer': 70 },
    },
    skills: [],
    rules: [],
    currentPhase: 'work',
    pendingDisputes: [],
    events: [{ at: now, phase: 'work', summary: '工作区已创建' }],
  }
}

function buildDefaultAgents(): WorkspaceAgent[] {
  return [
    { id: 'agent-executor', label: '执行者', modelId: 'deepseek-v4-flash', instructionsHash: 'abc', toolHash: 'v2' },
    { id: 'agent-reviewer', label: '审查者', modelId: 'deepseek-v4-flash', instructionsHash: 'def', toolHash: 'v2' },
    { id: 'agent-guide', label: '引导者', modelId: 'deepseek-v4-flash', instructionsHash: 'ghi', toolHash: 'v2' },
  ]
}

// ═══════════════════════════════════════════════════════════════
// Load / Save
// ═══════════════════════════════════════════════════════════════

export function loadWorkspace(dir: string): WorkspaceState {
  const path = join(dir, 'society.json')
  if (!existsSync(path)) {
    const ws = defaultWorkspace(dir.split('/').pop() ?? 'society')
    saveWorkspace(dir, ws)
    return ws
  }
  const raw = readFileSync(path, 'utf-8')
  const ws = JSON.parse(raw) as WorkspaceState
  // Ensure fields added in later versions exist
  ws.currentPhase ??= 'work'
  ws.pendingDisputes ??= []
  if (!ws.agents?.length) ws.agents = buildDefaultAgents()
  if (!ws.trustGraph || Object.keys(ws.trustGraph).length === 0) {
    ws.trustGraph = {
      'agent-executor': { 'agent-reviewer': 65, 'agent-guide': 85 },
      'agent-reviewer': { 'agent-executor': 55, 'agent-guide': 70 },
      'agent-guide': { 'agent-executor': 85, 'agent-reviewer': 70 },
    }
  }
  return ws
}

export function saveWorkspace(dir: string, state: WorkspaceState): void {
  mkdirSync(dir, { recursive: true })
  state.updatedAt = new Date().toISOString()
  writeFileSync(join(dir, 'society.json'), JSON.stringify(state, null, 2))
}

// ═══════════════════════════════════════════════════════════════
// Mutations
// ═══════════════════════════════════════════════════════════════

export function addEvent(state: WorkspaceState, event: Omit<WorkspaceEvent, 'at'>): WorkspaceState {
  const evt: WorkspaceEvent = { ...event, at: new Date().toISOString() }
  state.events.push(evt)
  if (state.events.length > 50) state.events = state.events.slice(-50)
  return state
}

export function updateTrust(
  state: WorkspaceState,
  fromId: string,
  toId: string,
  delta: number,
): WorkspaceState {
  state.trustGraph[fromId] ??= {}
  state.trustGraph[fromId][toId] = Math.max(0, Math.min(100, (state.trustGraph[fromId][toId] ?? 50) + delta))
  return state
}

export function setPhase(state: WorkspaceState, phase: WorkspaceState['currentPhase']): WorkspaceState {
  state.currentPhase = phase
  return state
}

export function findAgent(state: WorkspaceState, agentId: string): WorkspaceAgent | undefined {
  return state.agents.find(a => a.id === agentId)
}

export function setAgentSleep(state: WorkspaceState, agentId: string, packet: Record<string, unknown>): WorkspaceState {
  const a = findAgent(state, agentId)
  if (a) a.lastSleep = packet
  return state
}

export function setAgentWake(state: WorkspaceState, agentId: string, decl: Record<string, unknown>): WorkspaceState {
  const a = findAgent(state, agentId)
  if (a) a.lastWake = decl
  return state
}

export function addSkill(state: WorkspaceState, skill: Record<string, unknown>): WorkspaceState {
  state.skills.push(skill)
  return state
}

export function addRule(state: WorkspaceState, rule: Record<string, unknown>): WorkspaceState {
  state.rules.push(rule)
  return state
}

export function addPendingDispute(state: WorkspaceState, dispute: Record<string, unknown>): WorkspaceState {
  state.pendingDisputes.push(dispute)
  return state
}

export function clearPendingDispute(state: WorkspaceState, disputeId: string): WorkspaceState {
  state.pendingDisputes = state.pendingDisputes.filter(d => (d as any).disputeId !== disputeId)
  return state
}

// ═══════════════════════════════════════════════════════════════
// FrontendState computation
// ═══════════════════════════════════════════════════════════════

export function computeFrontendState(ws: WorkspaceState, source: FrontendState['source'] = 'workspace'): FrontendState {
  const agents = ws.agents.map(a => buildFrontendAgent(a, ws))
  const activeMediation = buildMediation(ws)

  // Pick primary agent's lastSleep/lastWake for the scenario detail panels
  const primary = ws.agents.find(a => a.lastSleep) ?? ws.agents[0]
  const lastSleep = (primary?.lastSleep ?? null) as FrontendState['lastSleep']
  const lastWake = (primary?.lastWake ?? null) as FrontendState['lastWake']

  return {
    phase: ws.currentPhase,
    source,
    updatedAt: ws.updatedAt,
    agents,
    trustGraph: ws.trustGraph,
    events: ws.events.map(e => ({ at: e.at, phase: e.phase, summary: e.summary })),
    activeMediation,
    lastSleep,
    lastWake,
  }
}

function buildFrontendAgent(a: WorkspaceAgent, ws: WorkspaceState): FrontendAgent {
  const style = AGENT_STYLE[a.id] ?? { shape: 'circle' as const, color: '#888', glowColor: 'rgba(255,255,255,0.1)', homeDeskIdx: 0 }

  // Relationships from trust graph
  const relationships: Record<string, number> = {}
  const tg = ws.trustGraph[a.id] ?? {}
  for (const [target, trust] of Object.entries(tg)) {
    if (target !== a.id) relationships[target] = trust
  }

  // Add relationship deltas from sleep
  const sleepRc = (a.lastSleep as any)?.relationshipChanges ?? []
  for (const rc of sleepRc) {
    if (rc.fromId === a.id) relationships[rc.toId] = rc.after
  }

  // Beliefs from per-agent sleep/wake data
  const beliefs = buildBeliefs(a, ws)

  // Memory from per-agent dream output
  const memory = buildMemory(a)

  // Position from phase
  const pos = agentPosition(a.id, ws.currentPhase, a)

  // Status from phase + agent involvement
  let status: FrontendAgent['status'] = 'working'
  if (ws.currentPhase === 'dispute') {
    const isInDispute = ws.pendingDisputes.some(
      d => (d as any).challengerId === a.id || (d as any).defenderId === a.id,
    )
    status = isInDispute ? 'disputing' : 'working'
  } else if (ws.currentPhase === 'sleep') {
    status = 'resting'
  }

  return {
    id: a.id,
    label: a.label,
    modelId: a.modelId,
    shape: style.shape,
    color: style.color,
    glowColor: style.glowColor,
    homeDeskIdx: style.homeDeskIdx,
    beliefs,
    memory,
    relationships,
    status,
    position: pos,
  }
}

function buildBeliefs(a: WorkspaceAgent, ws: WorkspaceState): BeliefItem[] {
  const beliefs: BeliefItem[] = []

  // From dream cross-analysis
  const ca = (a.lastSleep as any)?.dream?.crossAnalysis ?? []
  for (const c of ca) {
    if (c.insight) {
      beliefs.push({
        text: c.insight.slice(0, 120),
        status: c.pattern?.includes('风险') || c.insight?.includes('必须') ? 'warn' : 'ok',
        note: `证据: ${(c.evidence ?? []).slice(0, 2).join(', ') || 'Dream 分析'}`,
      })
    }
  }

  // From wake constraints
  const constraints = (a.lastWake as any)?.constraints ?? []
  for (const c of constraints) {
    if (typeof c === 'string') {
      beliefs.push({ text: c.slice(0, 120), status: 'warn', note: '从争议中学习' })
    }
  }

  // From society rules (rules applicable to this agent)
  for (const r of ws.rules) {
    const rule = r as any
    if (rule.enforcedBy?.includes(a.id) || rule.relevantTo?.includes(a.id)) {
      beliefs.push({
        text: rule.rule?.slice(0, 120) ?? '',
        status: rule.type === 'hard-constraint' ? 'warn' : 'ok',
        note: `[${rule.type ?? 'rule'}] ${rule.priority ?? ''}`,
      })
    }
  }

  // Fallback: agent's role context
  if (beliefs.length === 0) {
    const ctx = (a.lastSleep as any)?.resumeAnchor?.context as string | undefined
    if (ctx) {
      beliefs.push({ text: ctx.slice(0, 120), status: 'ok', note: '上次会话摘要' })
    } else {
      beliefs.push({ text: `${a.label}在工作区中活跃`, status: 'ok', note: '工作区状态' })
    }
  }

  return beliefs
}

function buildMemory(a: WorkspaceAgent): MemoryItem[] {
  const mems: MemoryItem[] = []
  const dream = (a.lastSleep as any)?.dream ?? {}

  for (const u of dream.updated ?? []) {
    mems.push({ text: `${u.oldContent} → ${u.newContent}`.slice(0, 100), source: `更新: ${u.reason}` })
  }
  for (const c of dream.cleaned ?? []) {
    mems.push({ text: c.content?.slice(0, 100), source: `清理: ${c.reason}` })
  }
  for (const m of dream.merged ?? []) {
    mems.push({ text: m.into?.slice(0, 100), source: `合并: ${m.reason}` })
  }

  if (mems.length === 0) {
    const ctx = (a.lastSleep as any)?.resumeAnchor?.context as string | undefined
    if (ctx) {
      mems.push({ text: ctx.slice(0, 100), source: '会话摘要' })
    } else {
      mems.push({ text: '等待首次工作周期', source: '工作区' })
    }
  }

  return mems
}

function agentPosition(
  agentId: string,
  phase: WorkspaceState['currentPhase'],
  _agent: WorkspaceAgent,
): { x: number; y: number } {
  const style = AGENT_STYLE[agentId]
  const desk = DESKS[style?.homeDeskIdx ?? 0]

  switch (phase) {
    case 'work':
      if (agentId === 'agent-executor') return { x: desk.x + desk.w / 2, y: desk.y + desk.h / 2 }
      if (agentId === 'agent-reviewer') return { x: 560, y: 120 }
      return { x: TERMINAL.x, y: TERMINAL.y }

    case 'dispute':
      if (agentId === 'agent-executor') return { x: 640, y: 180 }
      if (agentId === 'agent-reviewer') return { x: 695, y: 180 }
      return { x: 665, y: 250 }

    case 'sleep':
      return { x: 620 + Math.random() * 110, y: 420 + Math.random() * 40 }

    case 'wake':
      return agentPosition(agentId, 'work', _agent)

    default:
      return { x: desk.x + desk.w / 2, y: desk.y + desk.h / 2 }
  }
}

function buildMediation(ws: WorkspaceState): FrontendMediation | null {
  if (ws.pendingDisputes.length === 0) return null

  const d = ws.pendingDisputes[0] as any
  const challengerStance = (d.stances ?? []).find((s: any) => s.agentId === d.challengerId)
  const defenderStance = (d.stances ?? []).find((s: any) => s.agentId === d.defenderId)

  return {
    disputeId: d.disputeId ?? '',
    title: `${d.challengerId ?? '?'} 质疑 ${d.defenderId ?? '?'} 的${d.subject?.type === 'action' ? '操作' : '判断'}`,
    challengerPosition: challengerStance?.reasoning ?? '',
    defenderPosition: defenderStance?.reasoning ?? '',
    risk: (d.risk as FrontendMediation['risk']) ?? 'medium',
    challengerId: d.challengerId ?? '',
    defenderId: d.defenderId ?? '',
  }
}

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════

export function summarizeWorkspace(state: WorkspaceState) {
  return {
    name: state.name,
    updatedAt: state.updatedAt,
    agentCount: state.agents.length,
    trustPairs: Object.entries(state.trustGraph).reduce((sum, [, targets]) => sum + Object.keys(targets).length, 0),
    disputeCount: state.events.filter(e => e.phase === 'dispute').length,
    sleepCount: state.events.filter(e => e.phase === 'sleep').length,
    skillCount: state.skills.length,
    ruleCount: state.rules.length,
    pendingDisputes: state.pendingDisputes.length,
    phase: state.currentPhase,
    lastEvent: state.events[state.events.length - 1]?.summary ?? '',
  }
}
