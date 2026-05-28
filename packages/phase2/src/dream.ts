// ═══════════════════════════════════════════════════════════════
// Dream — 跨 Agent 记忆整理
//
// 输入: Phase 1 Session Memory 摘要 + Project Memory 条目
// 输出: 记忆整理建议 → 写回 Phase 1 ProjectMemory
// ═══════════════════════════════════════════════════════════════

export type DreamInput = {
  agentId: string; sessionId: string
  memories: { id: string; content: string; kind: string }[]
  sessionSummary: string
  events: { type: string; description: string; outcome?: string }[]
}

export type DreamOutput = {
  dreamId: string
  merged: { sources: string[]; into: string; reason: string }[]
  cleaned: { target: string; content: string; reason: string }[]
  updated: { target: string; oldContent: string; newContent: string; reason: string }[]
  crossAnalysis: { pattern: string; evidence: string[]; insight: string }[]
  errors?: string[]
}

const SYSTEM = 'You are a memory consolidation system. Output ONLY valid JSON. Only merge/clean/update/cross-analyze EXISTING memories. Never invent new ones.'

export type DreamOptions = { apiKey?: string; baseUrl?: string; model?: string }

export async function runDream(input: DreamInput, opts: DreamOptions = {}): Promise<DreamOutput> {
  const dreamId = `dream-${input.agentId}-${Date.now()}`
  const apiKey = opts.apiKey ?? process.env.DEEPSEEK_API_KEY
  const baseUrl = opts.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'

  if (!apiKey) return empty(dreamId, ['DEEPSEEK_API_KEY not set'])

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model ?? 'deepseek-v4-flash',
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: buildPrompt(input) }],
        max_tokens: 4096, temperature: 0.2, stream: false,
      }),
      signal: AbortSignal.timeout(60000),
    })

    const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
    if (!res.ok || payload.error) return empty(dreamId, [payload.error?.message ?? `HTTP ${res.status}`])

    const text = payload.choices?.[0]?.message?.content?.trim() ?? ''
    return parseDream(dreamId, text)
  } catch (err) {
    return empty(dreamId, [err instanceof Error ? err.message : String(err)])
  }
}

function buildPrompt(input: DreamInput): string {
  const mems = input.memories.map(m => `[${m.id}] (${m.kind}) ${m.content}`).join('\n')
  const evts = input.events.map(e => `- [${e.type}] ${e.description}${e.outcome ? ' → ' + e.outcome : ''}`).join('\n')
  return `## Existing Memories\n${mems || '(none)'}\n\n## Session Summary\n${input.sessionSummary}\n\n## Session Events\n${evts}\n\n## Task\n1. Merge duplicates 2. Clean noise 3. Update outdated 4. Cross-analyze\n\nReply ONLY valid JSON with these exact field names:\n{"merged":[{"sources":["id1","id2"],"into":"text","reason":"why"}],"cleaned":[{"target":"id","content":"original","reason":"why"}],"updated":[{"target":"id","oldContent":"before","newContent":"after","reason":"why"}],"crossAnalysis":[{"pattern":"found pattern","evidence":["ref"],"insight":"meaning"}]}`
}

function parseDream(dreamId: string, text: string): DreamOutput {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return empty(dreamId, ['No JSON in output'])
  try {
    const p = JSON.parse(match[0])
    const arr = (x: unknown) => (Array.isArray(x) ? x : [])
    return {
      dreamId,
      merged: arr(p.merged).map((m: any) => ({ sources: arr(m.sources ?? m.sourceIds), into: String(m.into ?? m.merged ?? ''), reason: String(m.reason ?? '') })),
      cleaned: arr(p.cleaned).map((c: any) => ({ target: String(c.target ?? c.id ?? ''), content: String(c.content ?? c.original ?? ''), reason: String(c.reason ?? '') })),
      updated: arr(p.updated).map((u: any) => ({ target: String(u.target ?? u.id ?? ''), oldContent: String(u.oldContent ?? u.old ?? ''), newContent: String(u.newContent ?? u.new ?? ''), reason: String(u.reason ?? '') })),
      crossAnalysis: arr(p.crossAnalysis ?? p.cross_analysis).map((c: any) => ({ pattern: String(c.pattern ?? c.finding ?? ''), evidence: arr(c.evidence ?? c.sources), insight: String(c.insight ?? c.implication ?? '') })),
    }
  } catch (err) {
    return empty(dreamId, [String(err)])
  }
}

function empty(dreamId: string, errors: string[]): DreamOutput {
  return { dreamId, merged: [], cleaned: [], updated: [], crossAnalysis: [], errors }
}
