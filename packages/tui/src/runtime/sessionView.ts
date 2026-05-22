import type { TuiSessionSummary } from './types.js'

export type TuiSessionTone = 'danger' | 'warning' | 'active' | 'success' | 'muted'

export type TuiSessionRow = {
  session: TuiSessionSummary
  commandIndex: number
  label: string
  tone: TuiSessionTone
  title: string
  meta: string
  context: string | null
  commandHint: string
  needsAttention: boolean
  priority: number
}

export type TuiSessionViewModel = {
  rows: TuiSessionRow[]
  visibleRows: TuiSessionRow[]
  hiddenCount: number
  attentionCount: number
  headline: string
}

export type BuildSessionViewOptions = {
  limit?: number
}

export function buildSessionViewModel(
  sessions: TuiSessionSummary[],
  options: BuildSessionViewOptions = {},
): TuiSessionViewModel {
  const limit = options.limit ?? 8
  const rows = sessions
    .map((session, index) => buildSessionRow(session, index + 1))
    .sort((left, right) => left.priority - right.priority || left.commandIndex - right.commandIndex)
  const visibleRows = rows.slice(0, limit)
  const attentionCount = rows.filter(row => row.needsAttention).length

  return {
    rows,
    visibleRows,
    hiddenCount: Math.max(0, rows.length - visibleRows.length),
    attentionCount,
    headline: buildHeadline(sessions.length, attentionCount),
  }
}

export function buildSessionRow(session: TuiSessionSummary, commandIndex: number): TuiSessionRow {
  const state = classifySession(session)
  const totalTodos = session.completedTodoCount + session.remainingTodoCount
  const title = session.title ?? session.firstUserMessage ?? session.sessionId
  const meta = [
    `id ${shortSessionId(session.sessionId)}`,
    session.status,
    `todos ${session.completedTodoCount}/${totalTodos}`,
    `verify ${session.verificationCount}`,
    `handoff ${session.hasHandoffReport ? 'yes' : 'no'}`,
  ].join(' · ')

  return {
    session,
    commandIndex,
    label: state.label,
    tone: state.tone,
    title,
    meta,
    context: buildSessionContext(session, state.label),
    commandHint: buildCommandHint(commandIndex, state.label),
    needsAttention: state.needsAttention,
    priority: state.priority,
  }
}

function classifySession(session: TuiSessionSummary): {
  label: string
  tone: TuiSessionTone
  needsAttention: boolean
  priority: number
} {
  if (session.pendingPlan) {
    return { label: 'approve', tone: 'warning', needsAttention: true, priority: 10 }
  }
  if (session.status === 'failed') {
    return { label: 'failed', tone: 'danger', needsAttention: true, priority: 20 }
  }
  if (!session.finalMessage && session.status === 'completed') {
    return { label: 'result?', tone: 'warning', needsAttention: true, priority: 30 }
  }
  if (session.status === 'running') {
    return { label: 'running', tone: 'active', needsAttention: false, priority: 40 }
  }
  if (session.memoryFreshness === 'stale') {
    return { label: 'stale', tone: 'warning', needsAttention: true, priority: 50 }
  }
  if (session.status === 'completed') {
    return { label: 'done', tone: 'success', needsAttention: false, priority: 80 }
  }
  return {
    label: session.status.slice(0, 9) || 'session',
    tone: 'muted',
    needsAttention: false,
    priority: 70,
  }
}

function buildSessionContext(session: TuiSessionSummary, label: string): string | null {
  if (session.pendingPlan) return `plan waiting: ${session.pendingPlan}`
  if (label === 'result?') return 'completed without a final answer; inspect transcript before relying on it'
  if (label === 'failed') return session.lastAction ? `failed after: ${session.lastAction}` : 'failed; open details before resuming'
  if (session.lastAction) return `last: ${session.lastAction}`
  if (session.finalMessage) return `final: ${session.finalMessage}`
  return null
}

function buildCommandHint(commandIndex: number, label: string): string {
  if (label === 'approve') return `/approve ${commandIndex}`
  if (label === 'failed' || label === 'result?' || label === 'stale') return `/open ${commandIndex}`
  if (label === 'running') return `/open ${commandIndex}`
  return `/resume ${commandIndex}`
}

function buildHeadline(total: number, attentionCount: number): string {
  if (total === 0) return 'no sessions yet'
  if (attentionCount === 0) return `${total} sessions`
  return `${attentionCount} need attention · ${total} sessions`
}

function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 10)
}
