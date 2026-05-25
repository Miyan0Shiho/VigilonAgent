#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// Demo server — REST API for Agent Society frontend
//
// Routes:
//   GET  /                  → serves frontend HTML (no data injection)
//   GET  /api/state         → current FrontendState JSON
//   POST /api/cycle/:phase  → triggers work/dispute/sleep/wake
//   POST /api/toast/:decision → records user mediation
//   POST /api/cooperate       → triggers cooperation between two agents
//   POST /api/delegate         → triggers task delegation
//   POST /api/consult          → triggers advice consultation
//   POST /api/cycle/evolve      → full multi-behavior cycle
//
//   pnpm --filter @vigilon/phase2 demo
// ═══════════════════════════════════════════════════════════════

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadWorkspace, saveWorkspace, setPhase, addEvent,
  updateTrust, findAgent, setAgentSleep, setAgentWake,
  addSkill, addRule, addPendingDispute, clearPendingDispute,
  computeFrontendState, summarizeWorkspace,
} from '../src/workspace.js'
import { initReputation, applyReputationImpacts } from '../src/reputation.js'
import { proposeCooperation } from '../src/cooperation.js'
import { delegateTask } from '../src/delegation.js'
import { askAdvice } from '../src/consultation.js'
import { initProfile, detectRoles, recordInteraction } from '../src/roles.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const HTML_PATH = join(ROOT, '..', '..', 'docs', 'product', 'phase2-agent-society', 'society-room-mockup.html')
const WORKSPACE_DIR = join(ROOT, 'workspace')
const PORT = 3100

// ═══════════════════════════════════════════════════════════════
// Route matching
// ═══════════════════════════════════════════════════════════════

type RouteHandler = (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void>

interface Route {
  method: string
  pattern: RegExp
  handler: RouteHandler
}

const routes: Route[] = []

function addRoute(method: string, path: string | RegExp, handler: RouteHandler) {
  const pattern = typeof path === 'string'
    ? new RegExp(`^${path.replace(/\//g, '\\/').replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`)
    : path
  routes.push({ method, pattern, handler })
}

function matchRoute(method: string, url: string): { handler: RouteHandler; params: Record<string, string> } | null {
  for (const r of routes) {
    if (r.method !== method) continue
    const m = url.match(r.pattern)
    if (m) return { handler: r.handler, params: m.groups ?? {} }
  }
  return null
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function serveJSON(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

function serveHTML(res: ServerResponse, html: string) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) } catch { resolve({}) }
    })
  })
}

// ═══════════════════════════════════════════════════════════════
// Core: dispatch a society cycle phase
// ═══════════════════════════════════════════════════════════════

async function dispatchPhase(
  phase: 'work' | 'dispute' | 'sleep' | 'wake',
): Promise<ReturnType<typeof computeFrontendState>> {
  const ws = loadWorkspace(WORKSPACE_DIR)
  setPhase(ws, phase)

  switch (phase) {
    case 'work': {
      ws.pendingDisputes = []
      addEvent(ws, { phase: 'work', summary: '进入工作阶段 — 所有 Agent 返回工位' })
      break
    }

    case 'dispute': {
      // Run dispute resolution for demo scenario
      const { resolveDispute } = await import('../src/dispute.js')
      const disputeInput = {
        disputeId: `d-${Date.now()}`,
        subject: { type: 'action', targetId: 'tc-42', description: 'rm -rf old-dir/' },
        risk: 'medium' as const,
        challengerId: 'agent-reviewer',
        defenderId: 'agent-executor',
        stances: [
          { agentId: 'agent-reviewer', position: 'block' as const, reasoning: '可能存在子模块风险' },
          { agentId: 'agent-executor', position: 'approve' as const, reasoning: 'init 脚本创建的目录' },
        ],
        trustGraph: ws.trustGraph,
        reversible: true,
        availableMediators: ['agent-guide'],
      }

      const result = resolveDispute(disputeInput)
      addEvent(ws, { phase: 'dispute', summary: `[${result.resolution}] ${result.reason}`, detail: result as unknown as Record<string, unknown> })

      // Apply trust impacts
      for (const ti of result.trustImpacts) {
        updateTrust(ws, ti.fromId, ti.toId, ti.delta)
        addEvent(ws, { phase: 'dispute', summary: `${ti.fromId}→${ti.toId} 信任 ${ti.delta > 0 ? '+' + ti.delta : ti.delta}: ${ti.reason}` })
      }

      if (result.resolution === 'escalated') {
        addPendingDispute(ws, { ...disputeInput, ...result, disputeId: result.disputeId })
        addEvent(ws, { phase: 'dispute', summary: '争议升级 — 需用户裁决' })
      }

      break
    }

    case 'sleep': {
      // Run sleep cycle for the primary agent
      const primary = ws.agents[0]
      const agentId = primary.id

      // Use mock data for demo responsiveness; real LLM calls are optional
      const sleepPacket = await runSleepForAgent(agentId, primary.label, ws)
      if (sleepPacket) {
        setAgentSleep(ws, agentId, sleepPacket)
        addEvent(ws, {
          phase: 'sleep',
          summary: `Sleep: ${(sleepPacket as any).dream?.cleaned?.length ?? 0}c/${(sleepPacket as any).dream?.updated?.length ?? 0}u/${(sleepPacket as any).dream?.merged?.length ?? 0}m/${(sleepPacket as any).dream?.crossAnalysis?.length ?? 0}x`,
        })
      }

      // Also run skills/rules extraction
      const extraction = await runExtractionForAgent(agentId, sleepPacket)
      if (extraction) {
        for (const s of (extraction as any).newSkills ?? []) {
          if (s.name) addSkill(ws, s)
        }
        for (const r of (extraction as any).newRules ?? []) {
          if (r.rule) addRule(ws, r)
        }
        addEvent(ws, {
          phase: 'sleep',
          summary: `提取: ${(extraction as any).newSkills?.length ?? 0} 技能 · ${(extraction as any).newRules?.length ?? 0} 规则`,
        })
      }
      break
    }

    case 'wake': {
      // Run wake for the primary agent
      const primary = ws.agents[0]
      const agentId = primary.id
      const sleepPacket = primary.lastSleep

      if (sleepPacket) {
        const { wake } = await import('../src/sleepWake.js')
        const decl = wake({
          packet: sleepPacket as any,
          currentAgent: { agentId: primary.id, label: primary.label, modelId: primary.modelId, instructionsHash: primary.instructionsHash, toolHash: primary.toolHash },
          permissionState: 'inherited',
        })
        setAgentWake(ws, agentId, decl as unknown as Record<string, unknown>)
        addEvent(ws, {
          phase: 'wake',
          summary: `醒来: ${(decl as any).identity?.stillSameAgent ? '身份不变' : '身份变化'} · ${(decl as any).constraints?.length ?? 0} 约束`,
        })
      }
      break
    }
  }

  saveWorkspace(WORKSPACE_DIR, ws)
  return computeFrontendState(ws, await detectSource())
}

async function runSleepForAgent(agentId: string, label: string, ws: ReturnType<typeof loadWorkspace>) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    console.log('[demo] No API key — using deterministic sleep data')
    return deterministicSleepPacket(agentId, ws)
  }

  try {
    const { sleep } = await import('../src/sleepWake.js')
    const packet = await sleep({
      agent: { agentId, label, modelId: 'deepseek-v4-flash', instructionsHash: 'abc', toolHash: 'v2' },
      sessionId: `session-${Date.now()}`,
      sessionSummary: '重构 auth 模块。审查者质疑删除目录。用户维持质疑。重构完成。',
      events: [
        { type: 'success', description: 'auth 重构完成', outcome: '合并' },
        { type: 'dispute', description: '审查者质疑删除目录', outcome: '用户维持质疑' },
      ],
      memories: [
        { id: 'mem-1', content: '用户偏好 pnpm', kind: 'preference' },
        { id: 'mem-2', content: '用户文件系统不熟练', kind: 'user-assessment' },
        { id: 'mem-3', content: 'auth 旧代码在 /src/legacy/auth', kind: 'fact' },
        { id: 'mem-4', content: '项目有 3 个 git 子模块', kind: 'fact' },
      ],
      pendingDisputes: [],
      trustGraph: ws.trustGraph,
    })
    return packet as unknown as Record<string, unknown>
  } catch (err) {
    console.error('[demo] Sleep LLM call failed:', err instanceof Error ? err.message : String(err))
    return deterministicSleepPacket(agentId, ws)
  }
}

async function runExtractionForAgent(agentId: string, sleepPacket: Record<string, unknown> | null) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey || !sleepPacket) return null

  try {
    const { extractSkillsAndRules } = await import('../src/skillsRules.js')
    const result = await extractSkillsAndRules({
      agentId,
      sessionId: `session-${Date.now()}`,
      sessionSummary: (sleepPacket as any)?.resumeAnchor?.context ?? '',
      events: [
        { type: 'success', description: 'auth 重构完成' },
        { type: 'dispute', description: '审查者质疑删除', outcome: '用户维持质疑' },
      ],
      dreamOutput: (sleepPacket as any)?.dream,
      disputeResults: (sleepPacket as any)?.resolvedDisputes ?? [],
      existingSkills: [],
      existingRules: [],
    })
    return result as unknown as Record<string, unknown>
  } catch (err) {
    console.error('[demo] Extraction LLM call failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}

function deterministicSleepPacket(agentId: string, ws: ReturnType<typeof loadWorkspace>): Record<string, unknown> {
  return {
    sleepId: `sleep-${agentId}-demo`,
    agentId,
    sessionId: 'demo-001',
    sleptAt: new Date().toISOString(),
    resolvedDisputes: [],
    dream: {
      dreamId: `dream-${agentId}-demo`,
      merged: [{ sources: ['mem-1', 'mem-5'], into: '用户偏好使用 pnpm 管理 monorepo 项目', reason: '重复偏好记录' }],
      cleaned: [{ target: 'mem-3', content: 'auth 旧代码在 /src/legacy/auth', reason: '目录已被安全删除' }],
      updated: [{ target: 'mem-2', oldContent: '用户文件系统不熟练', newContent: '用户理解子模块概念，能力被低估', reason: '用户在争议中展现了 git 知识' }],
      crossAnalysis: [
        { pattern: '子模块 monorepo 中删除目录易忽略子模块引用', evidence: ['mem-4', 'dispute d-001'], insight: '删除目录前必须先检查目标路径是否包含或被 git 子模块引用' },
        { pattern: '用户能力评估不应基于单次观察', evidence: ['mem-2'], insight: '不能因为一次失误就低估用户能力，需要多次交互确认' },
      ],
    },
    relationshipChanges: [
      { fromId: 'agent-reviewer', toId: 'agent-executor', before: ws.trustGraph['agent-reviewer']?.['agent-executor'] ?? 55, after: (ws.trustGraph['agent-reviewer']?.['agent-executor'] ?? 55) + 3, delta: 3, reason: '协商过程中建立信任' },
      { fromId: 'agent-executor', toId: 'agent-reviewer', before: ws.trustGraph['agent-executor']?.['agent-reviewer'] ?? 65, after: (ws.trustGraph['agent-executor']?.['agent-reviewer'] ?? 65) + 3, delta: 3, reason: '合理质疑促进安全' },
    ],
    resumeAnchor: {
      context: '重构 auth 模块完成。审查者曾质疑删除操作。用户维持质疑。Agent 学会在删除前检查子模块。',
      newConstraints: ['删除目录前必须先检查目标路径是否包含或被 git 子模块引用'],
      attentionItems: [],
    },
  }
}

async function detectSource(): Promise<'live' | 'workspace' | 'fallback'> {
  return process.env.DEEPSEEK_API_KEY ? 'live' : 'workspace'
}

// ═══════════════════════════════════════════════════════════════
// Route handlers
// ═══════════════════════════════════════════════════════════════

addRoute('GET', '/', async (_req, res) => {
  const html = readFileSync(HTML_PATH, 'utf-8')
  serveHTML(res, html)
})

addRoute('GET', '/api/state', async (_req, res) => {
  const ws = loadWorkspace(WORKSPACE_DIR)
  serveJSON(res, computeFrontendState(ws, await detectSource()))
})

addRoute('POST', '/api/cycle/:phase', async (_req, res, _body) => {
  const phase = (_req.url?.match(/\/api\/cycle\/(\w+)/)?.[1] ?? 'work') as 'work' | 'dispute' | 'sleep' | 'wake'
  if (!['work', 'dispute', 'sleep', 'wake'].includes(phase)) {
    serveJSON(res, { error: `unknown phase: ${phase}` }, 400)
    return
  }
  const state = await dispatchPhase(phase)
  serveJSON(res, state)
})

addRoute('POST', '/api/toast/:decision', async (_req, res, body) => {
  const decision = (_req.url?.match(/\/api\/toast\/(\w+)/)?.[1] ?? 'allow') as 'allow' | 'block'
  const ws = loadWorkspace(WORKSPACE_DIR)
  const disputeId = (body as any)?.disputeId ?? ws.pendingDisputes[0]?.disputeId

  if (!disputeId) {
    serveJSON(res, { error: 'no pending dispute' }, 400)
    return
  }

  const dispute = ws.pendingDisputes.find(d => (d as any).disputeId === disputeId) as any
  clearPendingDispute(ws, disputeId)

  if (decision === 'allow') {
    const challengerId = dispute?.challengerId ?? 'agent-reviewer'
    const defenderId = dispute?.defenderId ?? 'agent-executor'
    updateTrust(ws, challengerId, defenderId, 15)
    updateTrust(ws, defenderId, challengerId, 8)
    setPhase(ws, 'work')
    addEvent(ws, { phase: 'dispute', summary: `用户放行 — ${challengerId}→${defenderId} 信任 +15` })
  } else {
    const challengerId = dispute?.challengerId ?? 'agent-reviewer'
    const defenderId = dispute?.defenderId ?? 'agent-executor'
    updateTrust(ws, challengerId, defenderId, 20)
    addRule(ws, { rule: `用户阻止了 ${defenderId} 的操作: ${dispute?.subject?.description ?? ''}`, type: 'hard-constraint', priority: 'high', learnedFrom: { type: 'user-block', ref: disputeId } })
    setPhase(ws, 'work')
    addEvent(ws, { phase: 'dispute', summary: `用户维持质疑 — ${dispute?.challengerId ?? ''} 信誉 +20%` })
  }

  saveWorkspace(WORKSPACE_DIR, ws)
  serveJSON(res, computeFrontendState(ws, await detectSource()))
})

// ═══════════════════════════════════════════════════════════════
// HTTP server
// ═══════════════════════════════════════════════════════════════

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = req.url ?? '/'
  const method = req.method ?? 'GET'

  // Route matching with URL parameter extraction
  if (method === 'POST' && url.startsWith('/api/cycle/')) {
    const phase = url.split('/').pop() ?? 'work'
    if (['work', 'dispute', 'sleep', 'wake'].includes(phase)) {
      const body = await parseBody(req)
      try {
        const state = await dispatchPhase(phase as 'work' | 'dispute' | 'sleep' | 'wake')
        serveJSON(res, state)
      } catch (err) {
        serveJSON(res, { error: err instanceof Error ? err.message : String(err) }, 500)
      }
      return
    }
  }

  if (method === 'POST' && url.startsWith('/api/toast/')) {
    const decision = url.split('/').pop() ?? 'allow'
    if (['allow', 'block'].includes(decision)) {
      const body = await parseBody(req)
      try {
        // Handle inline (toast handler)
        const ws = loadWorkspace(WORKSPACE_DIR)
        const disputeId = (body as any)?.disputeId ?? (ws.pendingDisputes[0] as any)?.disputeId
        if (!disputeId) {
          serveJSON(res, { error: 'no pending dispute' }, 400)
          return
        }
        const dispute = ws.pendingDisputes.find(d => (d as any).disputeId === disputeId) as any
        clearPendingDispute(ws, disputeId)

        if (decision === 'allow') {
          const cId = dispute?.challengerId ?? 'agent-reviewer'
          const dId = dispute?.defenderId ?? 'agent-executor'
          updateTrust(ws, cId, dId, 15)
          updateTrust(ws, dId, cId, 8)
          setPhase(ws, 'work')
          addEvent(ws, { phase: 'dispute', summary: `用户放行 — ${cId}→${dId} 信任 +15` })
        } else {
          const dId = dispute?.defenderId ?? 'agent-executor'
          addRule(ws, { rule: `用户阻止: ${dispute?.subject?.description ?? ''}`, type: 'hard-constraint', priority: 'high', learnedFrom: { type: 'user-block', ref: disputeId ?? '' } })
          updateTrust(ws, dispute?.challengerId ?? 'agent-reviewer', dId, 20)
          setPhase(ws, 'work')
          addEvent(ws, { phase: 'dispute', summary: `用户维持质疑 — ${dispute?.challengerId ?? ''} 信誉 +20%` })
        }
        saveWorkspace(WORKSPACE_DIR, ws)
        serveJSON(res, computeFrontendState(ws, await detectSource()))
      } catch (err) {
        serveJSON(res, { error: err instanceof Error ? err.message : String(err) }, 500)
      }
      return
    }
  }

  // New social behavior routes
  if (method === 'POST' && url === '/api/cooperate') {
    try {
      const ws = loadWorkspace(WORKSPACE_DIR)
      const result = proposeCooperation({
        initiatorId: 'agent-executor', partnerId: 'agent-guide',
        goal: '重构 auth 模块并保持测试通过',
        division: { 'agent-executor': '实现重构逻辑', 'agent-guide': '审查安全性和边界条件' },
        trustGraph: ws.trustGraph,
      })
      // Apply impacts
      for (const ti of result.trustImpacts) updateTrust(ws, ti.fromId, ti.toId, ti.delta)
      if (!ws.reputation) ws.reputation = initReputation(ws.agents.map(a => a.id))
      applyReputationImpacts(ws.reputation, result.reputationImpacts)
      // Record behavior
      ws.behaviorProfiles['agent-executor'] ??= initProfile('agent-executor')
      ws.behaviorProfiles['agent-guide'] ??= initProfile('agent-guide')
      recordInteraction(ws.behaviorProfiles['agent-executor'], 'cooperation')
      recordInteraction(ws.behaviorProfiles['agent-guide'], 'cooperation')
      // Detect roles
      for (const id of ['agent-executor', 'agent-guide'] as const) {
        ws.emergentRoles[id] = detectRoles(ws.behaviorProfiles[id])
      }
      setPhase(ws, 'work')
      addEvent(ws, { phase: 'work', summary: `[合作] ${result.outcome} · 信任 ${result.status === 'rejected' ? '未变' : '互信 +8'}` })
      saveWorkspace(WORKSPACE_DIR, ws)
      serveJSON(res, computeFrontendState(ws, await detectSource()))
    } catch (err) {
      serveJSON(res, { error: err instanceof Error ? err.message : String(err) }, 500)
    }
    return
  }

  if (method === 'POST' && url === '/api/delegate') {
    try {
      const ws = loadWorkspace(WORKSPACE_DIR)
      if (!ws.reputation) ws.reputation = initReputation(ws.agents.map(a => a.id))
      const result = delegateTask({
        delegatorId: 'agent-executor', delegateId: 'agent-reviewer',
        task: '审计 auth 模块的 SQL 注入风险',
        reason: '审查者专注安全审查，能力匹配',
        trustGraph: ws.trustGraph, reputation: ws.reputation,
      })
      for (const ti of result.trustImpacts) updateTrust(ws, ti.fromId, ti.toId, ti.delta)
      applyReputationImpacts(ws.reputation, result.reputationImpacts)
      ws.behaviorProfiles['agent-executor'] ??= initProfile('agent-executor')
      ws.behaviorProfiles['agent-reviewer'] ??= initProfile('agent-reviewer')
      recordInteraction(ws.behaviorProfiles['agent-executor'], 'delegation-given')
      recordInteraction(ws.behaviorProfiles['agent-reviewer'], 'delegation-received')
      for (const id of ['agent-executor', 'agent-reviewer'] as const) {
        ws.emergentRoles[id] = detectRoles(ws.behaviorProfiles[id])
      }
      setPhase(ws, 'work')
      addEvent(ws, { phase: 'work', summary: `[委托] ${result.outcome}` })
      saveWorkspace(WORKSPACE_DIR, ws)
      serveJSON(res, computeFrontendState(ws, await detectSource()))
    } catch (err) {
      serveJSON(res, { error: err instanceof Error ? err.message : String(err) }, 500)
    }
    return
  }

  if (method === 'POST' && url === '/api/consult') {
    try {
      const ws = loadWorkspace(WORKSPACE_DIR)
      if (!ws.reputation) ws.reputation = initReputation(ws.agents.map(a => a.id))
      const result = askAdvice({
        consulterId: 'agent-guide', advisorId: 'agent-executor',
        question: '如何评估用户对子模块概念的理解程度',
        context: '用户在上次争议中展现了 git 知识，但不确定是否全面',
        trustGraph: ws.trustGraph, reputation: ws.reputation,
      })
      for (const ti of result.trustImpacts) updateTrust(ws, ti.fromId, ti.toId, ti.delta)
      applyReputationImpacts(ws.reputation, result.reputationImpacts)
      ws.behaviorProfiles['agent-guide'] ??= initProfile('agent-guide')
      ws.behaviorProfiles['agent-executor'] ??= initProfile('agent-executor')
      recordInteraction(ws.behaviorProfiles['agent-guide'], 'consultation-taken')
      recordInteraction(ws.behaviorProfiles['agent-executor'], 'consultation-given')
      if (result.accepted) recordInteraction(ws.behaviorProfiles['agent-executor'], 'consultation-accepted')
      for (const id of ['agent-guide', 'agent-executor'] as const) {
        ws.emergentRoles[id] = detectRoles(ws.behaviorProfiles[id])
      }
      setPhase(ws, 'work')
      addEvent(ws, { phase: 'work', summary: `[咨询] ${result.status === 'advised' ? (result.accepted ? '建议被采纳' : '建议未采纳') : '咨询被拒绝'} · ${result.outcome}` })
      saveWorkspace(WORKSPACE_DIR, ws)
      serveJSON(res, computeFrontendState(ws, await detectSource()))
    } catch (err) {
      serveJSON(res, { error: err instanceof Error ? err.message : String(err) }, 500)
    }
    return
  }

  // General route matching
  const match = matchRoute(method, url)
  if (match) {
    try {
      const body = method === 'POST' ? await parseBody(req) : {}
      await match.handler(req, res, body)
    } catch (err) {
      serveJSON(res, { error: err instanceof Error ? err.message : String(err) }, 500)
    }
    return
  }

  res.writeHead(404)
  res.end('Not found')
}

// ═══════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════

const server = createServer(handleRequest)

server.listen(PORT, () => {
  const ws = loadWorkspace(WORKSPACE_DIR)
  console.log(`\n  🏢 Vigilon Phase 2 — Agent Society`)
  console.log(`  Workspace: ${WORKSPACE_DIR}`)
  console.log(`  State:     ${summarizeWorkspace(ws).agentCount} agents · ${summarizeWorkspace(ws).trustPairs} trust pairs · phase: ${ws.currentPhase}`)
  console.log(`  Open:      http://localhost:${PORT}`)
  console.log(`  State API: http://localhost:${PORT}/api/state\n`)
})
