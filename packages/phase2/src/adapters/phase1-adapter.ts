// ═══════════════════════════════════════════════════════════════
// Phase 1 Adapter — 将 Phase 1 session 数据转换为 Phase 2 的 SleepInput
//
// 读取 Phase 1 的:
//   .jsonl  transcript  → 提取事件摘要
//   .memory.md           → 提取 session summary
//   .vigilon/memory/     → 提取 project memory entries
//
// 不修改 Phase 1 代码。通过文件系统直接读取。
// ═══════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentRef } from '../sleepWake.js'

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface Phase1Session {
  sessionId: string
  transcriptPath: string
  memoryPath: string
  cwd: string
}

export interface SleepEvent {
  type: string
  description: string
  outcome?: string
}

export interface SleepMemory {
  id: string
  content: string
  kind: string
}

// ═══════════════════════════════════════════════════════════════
// Transcript parsing
// ═══════════════════════════════════════════════════════════════

export function parseTranscript(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return []
  const raw = readFileSync(path, 'utf-8')
  return raw
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      try { return JSON.parse(line) }
      catch { return null }
    })
    .filter(Boolean) as Record<string, unknown>[]
}

export function transcriptToSleepEvents(events: Record<string, unknown>[]): SleepEvent[] {
  const result: SleepEvent[] = []

  for (const e of events) {
    const type = String(e.type ?? '')
    switch (type) {
      case 'user':
        result.push({
          type: 'user-input',
          description: String(e.content ?? '').slice(0, 200),
        })
        break
      case 'assistant': {
        const content = String(e.content ?? '')
        const toolCalls = (e.toolCalls as Array<{ name?: string }>) ?? []
        if (toolCalls.length > 0) {
          const toolNames = toolCalls.map(t => t.name).filter(Boolean).join(', ')
          result.push({
            type: 'action',
            description: `调用工具: ${toolNames}`,
            outcome: content.slice(0, 100) || undefined,
          })
        } else if (content) {
          result.push({
            type: 'reasoning',
            description: content.slice(0, 200),
          })
        }
        break
      }
      case 'tool-result': {
        const res = e.result as Record<string, unknown> | undefined
        result.push({
          type: res?.ok ? 'success' : 'error',
          description: `工具结果: ${res?.ok ? '成功' : '失败'}`,
          outcome: typeof res?.content === 'string' ? res.content.slice(0, 100) : undefined,
        })
        break
      }
      case 'session-state': {
        const todos = e.todos as Array<{ content: string; status: string }> | undefined
        if (todos?.length) {
          const completed = todos.filter(t => t.status === 'completed').length
          result.push({
            type: 'progress',
            description: `任务进度: ${completed}/${todos.length} 完成`,
          })
        }
        break
      }
    }
  }

  return result
}

// ═══════════════════════════════════════════════════════════════
// Session memory parsing
// ═══════════════════════════════════════════════════════════════

export function parseSessionMemory(path: string): string | null {
  if (!existsSync(path)) return null
  const raw = readFileSync(path, 'utf-8')

  // Extract markdown content after the header comment
  const headerEnd = raw.indexOf('-->')
  if (headerEnd === -1) return raw.slice(0, 500)

  const body = raw.slice(headerEnd + 3).trim()
  return body.slice(0, 1000) // Reasonable size for LLM context
}

export function extractSessionSummary(memoryPath: string): string {
  const content = parseSessionMemory(memoryPath)
  if (!content) return '无会话记忆'

  // Extract key sections
  const sections: string[] = []
  const currentTask = content.match(/## Current Task\n([\s\S]*?)(?=\n## |$)/)
  if (currentTask) sections.push(`任务: ${currentTask[1].trim()}`)

  const currentState = content.match(/## Current State\n([\s\S]*?)(?=\n## |$)/)
  if (currentState) sections.push(`状态: ${currentState[1].trim()}`)

  const nextStep = content.match(/## Next Step\n([\s\S]*?)(?=\n## |$)/)
  if (nextStep) sections.push(`下一步: ${nextStep[1].trim()}`)

  return sections.join('\n') || content.slice(0, 500)
}

// ═══════════════════════════════════════════════════════════════
// Project memory parsing
// ═══════════════════════════════════════════════════════════════

export interface ProjectMemoryEntry {
  id: string
  content: string
  kind: string
}

export function parseProjectMemory(memoryDir: string): ProjectMemoryEntry[] {
  const indexPath = join(memoryDir, 'MEMORY.md')
  if (!existsSync(indexPath)) return []

  const raw = readFileSync(indexPath, 'utf-8')
  const entries: ProjectMemoryEntry[] = []

  // Parse MEMORY.md index for entries
  const lineRegex = /^- \[(.+?)\]\((.+?)\) — (.+)$/gm
  let match
  while ((match = lineRegex.exec(raw)) !== null) {
    entries.push({
      id: `pm-${entries.length}`,
      content: `${match[1]}: ${match[3]}`,
      kind: 'fact',
    })
  }

  return entries
}

// ═══════════════════════════════════════════════════════════════
// SleepInput builder
// ═══════════════════════════════════════════════════════════════

export function buildSleepInputFromSession(params: {
  agent: AgentRef
  sessionId: string
  transcriptPath: string
  memoryPath: string
  projectMemoryDir?: string
  trustGraph: Record<string, Record<string, number>>
  pendingDisputes?: unknown[]
}): {
  agent: AgentRef
  sessionId: string
  sessionSummary: string
  events: SleepEvent[]
  memories: SleepMemory[]
  pendingDisputes: unknown[]
  trustGraph: Record<string, Record<string, number>>
} {
  const events = transcriptToSleepEvents(parseTranscript(params.transcriptPath))
  const sessionSummary = extractSessionSummary(params.memoryPath)
  const memories = params.projectMemoryDir
    ? parseProjectMemory(params.projectMemoryDir)
    : []

  // Ensure we have at least some data
  if (memories.length === 0) {
    // Derive memories from events
    for (const e of events.slice(0, 4)) {
      memories.push({
        id: `mem-event-${memories.length}`,
        content: e.description.slice(0, 100),
        kind: e.type === 'error' ? 'incident' : 'fact',
      })
    }
  }

  return {
    agent: params.agent,
    sessionId: params.sessionId,
    sessionSummary: sessionSummary || events.map(e => e.description).join('; ').slice(0, 500),
    events: events.length > 0 ? events : [{ type: 'session', description: '会话记录' }],
    memories,
    pendingDisputes: params.pendingDisputes ?? [],
    trustGraph: params.trustGraph,
  }
}
