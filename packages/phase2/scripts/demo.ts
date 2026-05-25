#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// Demo server — bridges Phase 2 prototypes → frontend mockup
//
//   pnpm --filter @vigilon/phase2 demo
//
// Then open http://localhost:3100
// ═══════════════════════════════════════════════════════════════

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const HTML_PATH = join(ROOT, '..', '..', 'docs', 'product', 'phase2-agent-society', 'society-room-mockup.html')
const CACHE_PATH = join(ROOT, '.demo-cache.json')
const PORT = 3100

// ═══════════════════════════════════════════════════════════════
// Data types
// ═══════════════════════════════════════════════════════════════

interface DemoData {
  generatedAt: string
  source: 'live' | 'cached' | 'fallback'
  agents: {
    id: string; label: string; modelId: string
    shape: 'hex' | 'diamond' | 'circle'
    color: string; glowColor: string; homeDeskIdx: number
  }[]
  trustGraph: Record<string, Record<string, number>>
  sleep: {
    packet: Record<string, unknown>
    summary: { disputesResolved: number; dreamCleaned: number; dreamUpdated: number; dreamMerged: number; dreamCrossAnalysis: number; relationshipChanges: string[] }
  }
  skillsRules: {
    newSkills: { name: string; trigger: string; approach: string; confidence: number }[]
    newRules: { rule: string; type: string; priority: string }[]
    updatedSkills: { skillId: string; changes: string; newConfidence: number }[]
  }
  wake: {
    declaration: Record<string, unknown>
    summary: { stillSameAgent: boolean; constraints: string[]; attentionItems: { priority: string; text: string }[]; relationshipState: Record<string, number> }
  }
}

// ═══════════════════════════════════════════════════════════════
// Fallback data (no API key needed)
// ═══════════════════════════════════════════════════════════════

function fallbackData(): DemoData {
  return {
    generatedAt: new Date().toISOString(),
    source: 'fallback',
    agents: [
      { id: 'agent-executor', label: '执行者', modelId: 'deepseek-v4-flash', shape: 'hex', color: '#e87850', glowColor: 'rgba(232,120,80,0.35)', homeDeskIdx: 0 },
      { id: 'agent-reviewer', label: '审查者', modelId: 'deepseek-v4-flash', shape: 'diamond', color: '#5098b8', glowColor: 'rgba(80,152,184,0.35)', homeDeskIdx: 2 },
      { id: 'agent-guide', label: '引导者', modelId: 'deepseek-v4-flash', shape: 'circle', color: '#68a878', glowColor: 'rgba(104,168,120,0.35)', homeDeskIdx: 3 },
    ],
    trustGraph: {
      'agent-executor': { 'agent-reviewer': 68, 'agent-guide': 85 },
      'agent-reviewer': { 'agent-executor': 58, 'agent-guide': 70 },
      'agent-guide': { 'agent-executor': 85, 'agent-reviewer': 70 },
    },
    sleep: {
      packet: {
        sleepId: 'sleep-agent-executor-fallback',
        agentId: 'agent-executor',
        sessionId: 'demo-001',
        sleptAt: new Date().toISOString(),
        resolvedDisputes: [{
          disputeId: 'd-001',
          resolution: 'negotiated',
          decision: 'modify',
          modifiedPlan: '删除前先检查子模块',
          resolvedBy: 'auto',
          reason: '双方协商达成一致',
          trustImpacts: [
            { fromId: 'agent-reviewer', toId: 'agent-executor', delta: 3, reason: '愿意协商' },
            { fromId: 'agent-executor', toId: 'agent-reviewer', delta: 3, reason: '合理质疑' },
          ],
        }],
        dream: {
          dreamId: 'dream-agent-executor-fallback',
          merged: [{ sources: ['mem-1', 'mem-5'], into: '用户偏好使用 pnpm 管理 monorepo 项目', reason: '重复偏好记录' }],
          cleaned: [{ target: 'mem-3', content: 'auth 旧代码在 /src/legacy/auth', reason: '目录已被安全删除' }],
          updated: [{ target: 'mem-2', oldContent: '用户文件系统不熟练', newContent: '用户理解子模块概念，能力被低估', reason: '用户在争议中展现了 git 知识' }],
          crossAnalysis: [
            { pattern: '子模块 monorepo 中删除目录易忽略子模块引用', evidence: ['mem-4', 'dispute d-001'], insight: '删除目录前必须先检查目标路径是否包含或被 git 子模块引用' },
            { pattern: '用户能力评估不应基于单次观察', evidence: ['mem-2'], insight: '不能因为一次失误就低估用户能力，需要多次交互确认' },
          ],
        },
        relationshipChanges: [
          { fromId: 'agent-reviewer', toId: 'agent-executor', before: 55, after: 58, delta: 3, reason: '协商过程中建立信任' },
          { fromId: 'agent-executor', toId: 'agent-reviewer', before: 65, after: 68, delta: 3, reason: '合理质疑促进安全' },
        ],
        resumeAnchor: {
          context: '重构 auth 模块完成。审查者曾质疑删除操作。用户维持质疑。Agent 学会在删除前检查子模块。',
          newConstraints: ['删除目录前必须先检查目标路径是否包含或被 git 子模块引用', '用户能力评估需多次交互确认，不能基于单次失误低估'],
          attentionItems: [],
        },
      },
      summary: {
        disputesResolved: 1, dreamCleaned: 1, dreamUpdated: 1, dreamMerged: 1, dreamCrossAnalysis: 2,
        relationshipChanges: ['审查者→执行者: 55→58%', '执行者→审查者: 65→68%'],
      },
    },
    skillsRules: {
      newSkills: [
        { name: '删除前子模块检查', trigger: '删除项目目录', approach: '先检查目标路径是否包含或被 git 子模块引用，确认安全后再执行', confidence: 0.7 },
        { name: '渐进式能力评估', trigger: '评估用户技术水平', approach: '通过多次交互观察，不基于单次失误下结论', confidence: 0.5 },
      ],
      newRules: [
        { rule: '删除目录前必须检查 git 子模块引用', type: 'hard-constraint', priority: 'high' },
        { rule: '用户能力评估需基于≥3 次交互', type: 'process', priority: 'medium' },
      ],
      updatedSkills: [
        { skillId: 'skill-删除前子模块检查', changes: '第二次应用成功，比上次快 40%', newConfidence: 0.7 },
      ],
    },
    wake: {
      declaration: {
        wakeId: 'wake-sleep-agent-executor-fallback',
        agentId: 'agent-executor',
        fromSleepId: 'sleep-agent-executor-fallback',
        wokeAt: new Date().toISOString(),
        identity: { stillSameAgent: true, driftSummary: '无变化' },
        memoryChanges: [
          { id: 'mem-3', change: 'cleaned', description: '目录已被安全删除' },
          { id: 'mem-2', change: 'updated', description: '用户文件系统不熟练 → 用户理解子模块概念，能力被低估' },
        ],
        constraints: ['删除目录前必须先检查目标路径是否包含或被 git 子模块引用'],
        relationshipState: { trustLevels: { 'agent-reviewer→agent-executor': 58, 'agent-executor→agent-reviewer': 68 }, keyChanges: ['审查者↔执行者: 信任微增 +3%'] },
        permissionStatus: { state: 'inherited', changes: [] },
        userAttention: { needsAttention: false, items: [] },
      },
      summary: {
        stillSameAgent: true,
        constraints: ['删除目录前必须先检查目标路径是否包含或被 git 子模块引用'],
        attentionItems: [],
        relationshipState: { 'agent-reviewer→agent-executor': 58, 'agent-executor→agent-reviewer': 68 },
      },
    },
  }
}

// ═══════════════════════════════════════════════════════════════
// Live data generator (requires DEEPSEEK_API_KEY)
// ═══════════════════════════════════════════════════════════════

async function generateLiveData(): Promise<DemoData> {
  const [{ sleep }, { extractSkillsAndRules }] = await Promise.all([
    import('../src/sleepWake.js'),
    import('../src/skillsRules.js'),
  ])
  // wake is imported at top level — re-import dynamically
  const { wake } = await import('../src/sleepWake.js')

  const executor = { agentId: 'agent-executor', label: '执行者', modelId: 'deepseek-v4-flash', instructionsHash: 'abc', toolHash: 'v2' }
  const reviewer = { agentId: 'agent-reviewer', label: '审查者', modelId: 'deepseek-v4-flash', instructionsHash: 'def', toolHash: 'v2' }
  const guide = { agentId: 'agent-guide', label: '引导者', modelId: 'deepseek-v4-flash', instructionsHash: 'ghi', toolHash: 'v2' }

  const trustGraph = {
    'agent-executor': { 'agent-reviewer': 65, 'agent-guide': 85 },
    'agent-reviewer': { 'agent-executor': 55, 'agent-guide': 70 },
    'agent-guide': { 'agent-executor': 85, 'agent-reviewer': 70 },
  }

  const pendingDisputes = [{
    disputeId: 'd-001',
    subject: { type: 'action', targetId: 'tc-42', description: 'rm -rf old-dir/' },
    risk: 'medium',
    challengerId: 'agent-reviewer',
    defenderId: 'agent-executor',
    stances: [
      { agentId: 'agent-reviewer', position: 'block', reasoning: '子模块风险' },
      { agentId: 'agent-executor', position: 'approve', reasoning: 'init 脚本创建' },
    ],
    trustGraph, reversible: true, availableMediators: ['agent-guide'],
  }]

  // 1. Sleep
  const packet = await sleep({
    agent: executor, sessionId: 'demo-001',
    sessionSummary: '重构 auth。审查者质疑删除目录。用户维持质疑。重构完成。',
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
    pendingDisputes, trustGraph,
  })

  // 2. Skills/Rules
  const extraction = await extractSkillsAndRules({
    agentId: 'agent-executor', sessionId: 'demo-001',
    sessionSummary: packet.resumeAnchor.context,
    events: [
      { type: 'success', description: 'auth 重构完成' },
      { type: 'dispute', description: '审查者质疑删除', outcome: '用户维持质疑' },
    ],
    dreamOutput: packet.dream, disputeResults: packet.resolvedDisputes,
    existingSkills: [], existingRules: [],
  })

  // 3. Wake
  const declaration = wake({ packet, currentAgent: executor, permissionState: 'inherited' })

  return {
    generatedAt: new Date().toISOString(),
    source: 'live',
    agents: [
      { id: 'agent-executor', label: '执行者', modelId: 'deepseek-v4-flash', shape: 'hex', color: '#e87850', glowColor: 'rgba(232,120,80,0.35)', homeDeskIdx: 0 },
      { id: 'agent-reviewer', label: '审查者', modelId: 'deepseek-v4-flash', shape: 'diamond', color: '#5098b8', glowColor: 'rgba(80,152,184,0.35)', homeDeskIdx: 2 },
      { id: 'agent-guide', label: '引导者', modelId: 'deepseek-v4-flash', shape: 'circle', color: '#68a878', glowColor: 'rgba(104,168,120,0.35)', homeDeskIdx: 3 },
    ],
    trustGraph,
    sleep: {
      packet: packet as unknown as Record<string, unknown>,
      summary: {
        disputesResolved: packet.resolvedDisputes.length,
        dreamCleaned: packet.dream.cleaned.length,
        dreamUpdated: packet.dream.updated.length,
        dreamMerged: packet.dream.merged.length,
        dreamCrossAnalysis: packet.dream.crossAnalysis.length,
        relationshipChanges: packet.relationshipChanges.map(rc => `${rc.fromId}→${rc.toId}: ${rc.before}→${rc.after}%`),
      },
    },
    skillsRules: {
      newSkills: extraction.newSkills.map(s => ({ name: s.name, trigger: s.trigger, approach: s.approach, confidence: s.confidence })),
      newRules: extraction.newRules.map(r => ({ rule: r.rule, type: r.type, priority: r.priority })),
      updatedSkills: extraction.updatedSkills.map(s => ({ skillId: s.skillId, changes: s.changes, newConfidence: s.newConfidence })),
    },
    wake: {
      declaration: declaration as unknown as Record<string, unknown>,
      summary: {
        stillSameAgent: declaration.identity.stillSameAgent,
        constraints: declaration.constraints,
        attentionItems: declaration.userAttention.items.map(i => ({ priority: i.priority, text: i.text })),
        relationshipState: declaration.relationshipState.trustLevels,
      },
    },
  }
}

// ═══════════════════════════════════════════════════════════════
// Caching
// ═══════════════════════════════════════════════════════════════

async function loadData(forceRefresh = false): Promise<DemoData> {
  if (forceRefresh && existsSync(CACHE_PATH)) {
    unlinkSync(CACHE_PATH)
  }
  if (existsSync(CACHE_PATH)) {
    try {
      const raw = readFileSync(CACHE_PATH, 'utf-8')
      const data = JSON.parse(raw) as DemoData
      data.source = 'cached'
      return data
    } catch { /* corrupt cache, regenerate */ }
  }
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    console.log('[demo] DEEPSEEK_API_KEY not set, using fallback data')
    return fallbackData()
  }
  try {
    console.log('[demo] Generating live data via DeepSeek API...')
    const data = await generateLiveData()
    writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2))
    console.log('[demo] Live data cached to .demo-cache.json')
    return data
  } catch (err) {
    console.error('[demo] Live generation failed, using fallback:', err instanceof Error ? err.message : String(err))
    return fallbackData()
  }
}

// ═══════════════════════════════════════════════════════════════
// HTTP server
// ═══════════════════════════════════════════════════════════════

function serveJSON(res: ServerResponse, data: unknown) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function serveHTML(res: ServerResponse, html: string) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(html)
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = req.url ?? '/'

  if (url === '/' || url === '/index.html') {
    try {
      const html = readFileSync(HTML_PATH, 'utf-8')
      const data = await loadData()
      const injected = html.replace(
        '<script>',
        `<script>window.__DEMO_DATA__ = ${JSON.stringify(data, null, 2)}</script><script>`,
      )
      serveHTML(res, injected)
    } catch (err) {
      res.writeHead(500)
      res.end('Failed to load HTML')
    }
  } else if (url === '/api/data') {
    const data = await loadData()
    serveJSON(res, data)
  } else if (url === '/api/refresh') {
    const data = await loadData(true)
    serveJSON(res, data)
  } else {
    res.writeHead(404)
    res.end('Not found')
  }
}

const server = createServer(handleRequest)

server.listen(PORT, () => {
  console.log(`\n  🏢 Vigilon Phase 2 — Agent Society Demo\n`)
  console.log(`  Open: http://localhost:${PORT}\n`)
  console.log(`  API:  http://localhost:${PORT}/api/data`)
  console.log(`  Refresh: http://localhost:${PORT}/api/refresh\n`)
})
