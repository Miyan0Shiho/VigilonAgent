// ═══════════════════════════════════════════════════════════════
// Skills/Rules — 从经历中提炼可复用方法和约束规则
//
// 与 Dream 分离: Dream 整理记忆，Skills/Rules 从经历中学习
//
// 输入: Session events + Dream 交叉分析 + Dispute 结果
// 输出: Skills (可复用方法) + Rules (约束) → 写回 Phase 1 ProjectMemory
//
// Skills: 正面经验 → "当 X 时，用 Y 方法效果好"
// Rules:  争议/事故 → "做 X 前必须先检查 Y"
// ═══════════════════════════════════════════════════════════════

import type { DreamOutput } from './dream.js'
import type { DisputeResult } from './dispute.js'

// ═══════════════════════════════════════════════════════════════

export type Skill = {
  id: string; name: string; trigger: string; approach: string
  confidence: number; evidenceFrom: string[]; relevantTo: string[]
}

export type Rule = {
  id: string; rule: string
  type: 'hard-constraint' | 'soft-guideline' | 'process'
  enforcedBy: string[]; consequence: string
  learnedFrom: { type: string; ref: string }; priority: 'critical' | 'high' | 'medium' | 'low'
}

export type ExtractionInput = {
  agentId: string; sessionId: string
  sessionSummary: string
  events: { type: string; description: string; outcome?: string }[]
  dreamOutput?: DreamOutput
  disputeResults?: DisputeResult[]
  existingSkills?: Skill[]
  existingRules?: Rule[]
}

export type ExtractionOutput = {
  extractionId: string; agentId: string; sessionId: string; generatedAt: string
  newSkills: Skill[]; updatedSkills: { skillId: string; changes: string; newConfidence: number }[]
  newRules: Rule[]; retiredRules: { ruleId: string; rule: string; reason: string }[]
  errors?: string[]
}

// ═══════════════════════════════════════════════════════════════

const SYSTEM = `You extract reusable skills and rules from an agent's work experience.
SKILLS are reusable methods from successful patterns: "when X, approach Y works"
RULES are constraints from incidents/disputes: "never do X without checking Y"

You ONLY output valid JSON. Only extract NEW things. Each must cite specific evidence.`

export type ExtractionOptions = { apiKey?: string; baseUrl?: string; model?: string }

export async function extractSkillsAndRules(
  input: ExtractionInput,
  opts: ExtractionOptions = {},
): Promise<ExtractionOutput> {
  const extractionId = `extract-${input.agentId}-${Date.now()}`
  const apiKey = opts.apiKey ?? process.env.DEEPSEEK_API_KEY
  const baseUrl = opts.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'

  if (!apiKey) return empty(extractionId, input, ['DEEPSEEK_API_KEY not set'])

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model ?? 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: buildPrompt(input) },
        ],
        max_tokens: 4096, temperature: 0.2, stream: false,
      }),
      signal: AbortSignal.timeout(60000),
    })

    const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
    if (!res.ok || payload.error) return empty(extractionId, input, [payload.error?.message ?? `HTTP ${res.status}`])

    const text = payload.choices?.[0]?.message?.content?.trim() ?? ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return empty(extractionId, input, ['No JSON in output'])

    const p = JSON.parse(match[0])
    const arr = (x: unknown): any[] => Array.isArray(x) ? x : []
    const str = (x: unknown, fallback = '') => typeof x === 'string' ? x : fallback
    return {
      extractionId, agentId: input.agentId, sessionId: input.sessionId,
      generatedAt: new Date().toISOString(),
      newSkills: arr(p.newSkills ?? p.skills).map((s: any) => ({
        id: str(s.id, `skill-${Date.now()}`), name: str(s.name), trigger: str(s.trigger), approach: str(s.approach ?? s.method ?? s.how),
        confidence: Number(s.confidence ?? 0.4), evidenceFrom: arr(s.evidenceFrom ?? s.evidence), relevantTo: arr(s.relevantTo ?? s.agents),
      })),
      updatedSkills: arr(p.updatedSkills ?? p.updated).map((s: any) => ({
        skillId: str(s.skillId), changes: str(s.changes), newConfidence: Number(s.newConfidence ?? s.confidence ?? 0.5),
      })),
      newRules: arr(p.newRules ?? p.rules).map((r: any) => ({
        id: str(r.id, `rule-${Date.now()}`), rule: str(r.rule ?? r.description ?? r.text),
        type: (['hard-constraint','soft-guideline','process'].includes(String(r.type)) ? String(r.type) : 'soft-guideline') as Rule['type'],
        enforcedBy: arr(r.enforcedBy ?? r.enforced ?? r.agents).map(String),
        consequence: str(r.consequence ?? r.impact ?? r.ifViolated),
        learnedFrom: { type: str(r.learnedFrom?.type ?? 'observation'), ref: str(r.learnedFrom?.ref ?? '') },
        priority: (['critical','high','medium','low'].includes(String(r.priority)) ? String(r.priority) : 'medium') as Rule['priority'],
      })),
      retiredRules: arr(p.retiredRules ?? p.retired).map((r: any) => ({
        ruleId: str(r.ruleId), rule: str(r.rule), reason: str(r.reason),
      })),
    }
  } catch (err) {
    return empty(extractionId, input, [err instanceof Error ? err.message : String(err)])
  }
}

function buildPrompt(input: ExtractionInput): string {
  const events = input.events.map(e => `- [${e.type}] ${e.description}${e.outcome ? ' → ' + e.outcome : ''}`).join('\n')
  const disputes = (input.disputeResults ?? []).map(d => `- ${d.disputeId}: ${d.resolution} → ${d.decision} (${d.reason})`).join('\n')
  const patterns = input.dreamOutput?.crossAnalysis.map(c => `- ${c.pattern}\n  洞察: ${c.insight}`).join('\n') ?? ''
  const existingS = (input.existingSkills ?? []).map(s => `- [${s.id}] ${s.name} (信心:${s.confidence})`).join('\n')
  const existingR = (input.existingRules ?? []).map(r => `- [${r.id}] [${r.type}] ${r.rule}`).join('\n')

  return `## Session Summary
${input.sessionSummary}

## Events
${events || '(none)'}

## Dispute Outcomes
${disputes || '(none)'}

## Dream Patterns
${patterns || '(none)'}

## Existing Skills
${existingS || '(none)'}

## Existing Rules
${existingR || '(none)'}

## Task
Review the experience and extract:
1. NEW skills (reusable methods from successes) — ID: "skill-{name}", confidence based on repetitions
2. UPDATED skills (existing ones reinforced by this session)
3. NEW rules (constraints from disputes/incidents) — ID: "rule-{name}", type: hard-constraint|soft-guideline|process
4. RETIRED rules (no longer relevant)

Reply ONLY valid JSON: {"newSkills":[{...}],"updatedSkills":[{...}],"newRules":[{...}],"retiredRules":[{...}]}`
}

function empty(id: string, input: ExtractionInput, errors: string[]): ExtractionOutput {
  return { extractionId: id, agentId: input.agentId, sessionId: input.sessionId, generatedAt: new Date().toISOString(), newSkills: [], updatedSkills: [], newRules: [], retiredRules: [], errors }
}
