// ═══════════════════════════════════════════════════════════════
// Workspace — Agent 社会的工作区状态持久化
//
// 每个 workspace 是一个目录，包含:
//   society.json  — 当前社会状态（Agent、信任、争议、技能、规则）
//   sessions/     — 各 Agent 的 session 引用
//
// Phase 2 通过 workspace 读写 Agent 状态，前端通过 workspace 渲染。
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface WorkspaceAgent {
  id: string
  label: string
  modelId: string
  instructionsHash: string
  toolHash: string
  sessionPath?: string // path to Phase 1 session directory
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

  /** Latest sleep packet (most recent session boundary) */
  lastSleep?: Record<string, unknown>
  /** Latest wake declaration */
  lastWake?: Record<string, unknown>

  /** Extracted skills, keyed by skill id */
  skills: Record<string, unknown>[]
  /** Extracted rules, keyed by rule id */
  rules: Record<string, unknown>[]

  /** Recent society events (ring buffer, last N) */
  events: WorkspaceEvent[]
}

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
    agents: [],
    trustGraph: {},
    skills: [],
    rules: [],
    events: [{ at: now, phase: 'work', summary: '工作区已创建' }],
  }
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
  return JSON.parse(raw) as WorkspaceState
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

export function setSleepPacket(state: WorkspaceState, packet: Record<string, unknown>): WorkspaceState {
  state.lastSleep = packet
  return state
}

export function setWakeDeclaration(state: WorkspaceState, decl: Record<string, unknown>): WorkspaceState {
  state.lastWake = decl
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

// ═══════════════════════════════════════════════════════════════
// Summary (for frontend consumption)
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
    lastEvent: state.events[state.events.length - 1]?.summary ?? '',
  }
}
