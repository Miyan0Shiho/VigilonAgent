import type { PendingPrompt } from './lineReader.js'
import { buildSessionViewModel, type TuiSessionViewModel, type TuiSessionTone } from './sessionView.js'
import type { TuiRuntimeEvent, TuiSessionSummary } from './types.js'
import { buildTurnViewModel, type TuiTurnViewModel } from './turnView.js'

export type TuiOperatorMode = 'ready' | 'working' | 'blocked' | 'question' | 'attention' | 'error'

export type TuiOperatorViewModel = {
  mode: TuiOperatorMode
  tone: TuiSessionTone
  title: string
  headline: string
  subline: string
  nextAction: string
  composerMode: string
  composerHint: string
  statusText: string
  commandHint: string
  spine: TuiOperatorSpineItem[]
  turn: TuiTurnViewModel
  sessions: TuiSessionViewModel
}

export type TuiOperatorSpineKind = 'prompt' | 'turn' | 'result' | 'session' | 'ready'

export type TuiOperatorSpineItem = {
  key: string
  kind: TuiOperatorSpineKind
  label: string
  title: string
  detail: string
  action: string
  tone: TuiSessionTone
  priority: number
}

export type BuildOperatorViewInput = {
  sessions: TuiSessionSummary[]
  events: TuiRuntimeEvent[]
  status: string
  running: boolean
  pendingPrompt?: PendingPrompt | null
  inputValue?: string
  detailMode?: boolean
}

export function buildOperatorViewModel(input: BuildOperatorViewInput): TuiOperatorViewModel {
  const turn = buildTurnViewModel(input.events, { detailMode: input.detailMode })
  const sessions = buildSessionViewModel(input.sessions)
  const pendingPrompt = input.pendingPrompt ?? null
  const base = {
    turn,
    sessions,
    statusText: input.status,
    commandHint: buildCommandHint(input),
    spine: buildOperatorSpine(input, turn, sessions, pendingPrompt),
  }

  if (pendingPrompt?.request?.choices?.length) {
    return {
      ...base,
      mode: 'question',
      tone: 'warning',
      title: 'operator input',
      headline: pendingPrompt.request.title,
      subline: 'The runtime is waiting for a bounded operator choice.',
      nextAction: 'Press a number, Tab to stage the highlighted choice, or Enter to answer.',
      composerMode: 'answer',
      composerHint: 'press a number, Tab to stage the highlighted choice, or Enter to accept it',
    }
  }

  if (pendingPrompt) {
    return {
      ...base,
      mode: 'question',
      tone: 'warning',
      title: 'operator input',
      headline: pendingPrompt.request?.title ?? 'Operator answer required',
      subline: 'The runtime is paused until the composer receives an answer.',
      nextAction: 'Reply with the requested option, y/n/s, or a short answer.',
      composerMode: 'answer',
      composerHint: 'reply with the requested option, y/n/s, or a short answer',
    }
  }

  if (input.running) {
    return {
      ...base,
      mode: 'working',
      tone: 'active',
      title: 'working',
      headline: normalizeTurnStatus(turn.overview.status),
      subline: buildTurnSubline(turn, input.events.length),
      nextAction: 'Watch the current turn; Ctrl-C records an interrupt request.',
      composerMode: 'working',
      composerHint: 'turn is running; Ctrl-C records an interrupt request',
    }
  }

  if (turn.overview.errors > 0 || input.status === 'error') {
    return {
      ...base,
      mode: 'error',
      tone: 'danger',
      title: 'attention',
      headline: normalizeTurnStatus(turn.overview.status),
      subline: buildTurnSubline(turn, input.events.length),
      nextAction: 'Inspect the current turn or open the affected session before continuing.',
      composerMode: 'prompt',
      composerHint: buildIdleComposerHint(input.inputValue),
    }
  }

  if (turn.overview.needsAttention) {
    return {
      ...base,
      mode: turn.overview.phase === 'question' ? 'question' : 'blocked',
      tone: 'warning',
      title: turn.overview.phase === 'question' ? 'operator input' : 'blocked',
      headline: normalizeTurnStatus(turn.overview.status),
      subline: buildTurnSubline(turn, input.events.length),
      nextAction: 'Answer in the composer so the runtime can continue.',
      composerMode: 'answer',
      composerHint: 'reply with the requested option, y/n/s, or a short answer',
    }
  }

  const firstAttentionSession = sessions.rows.find(row => row.needsAttention)
  if (firstAttentionSession) {
    return {
      ...base,
      mode: 'attention',
      tone: firstAttentionSession.tone,
      title: 'sessions need review',
      headline: sessions.headline,
      subline: `${firstAttentionSession.label}: ${firstAttentionSession.title}`,
      nextAction: `Run ${firstAttentionSession.commandHint} before starting unrelated work.`,
      composerMode: 'prompt',
      composerHint: buildIdleComposerHint(input.inputValue),
    }
  }

  return {
    ...base,
    mode: 'ready',
    tone: 'muted',
    title: 'ready',
    headline: input.status === 'ready' ? 'Ready for a task' : input.status,
    subline: sessions.rows.length > 0 ? sessions.headline : 'No session evidence yet.',
    nextAction: 'Type a task, resume a session, or open recent session detail.',
    composerMode: 'prompt',
    composerHint: buildIdleComposerHint(input.inputValue),
  }
}

function buildIdleComposerHint(inputValue: string | undefined): string {
  if (inputValue?.trimStart().startsWith('/')) return 'Tab completes the highlighted command; Enter runs it'
  return 'type a task, or type / for commands'
}

function buildCommandHint(input: BuildOperatorViewInput): string {
  const value = input.inputValue?.trimStart() ?? ''
  if (input.pendingPrompt?.request?.choices?.length) return 'number selects · Tab stages · Enter answers'
  if (input.pendingPrompt) return 'Enter answers · Esc keeps prompt open'
  if (input.running) return 'Ctrl-C requests interrupt · Ctrl-D details'
  if (value.startsWith('/')) return 'Tab completes · Enter runs · /help lists commands'
  return '/help for commands · /sessions recent work · Ctrl-D details'
}

function buildTurnSubline(turn: TuiTurnViewModel, eventCount: number): string {
  const { overview } = turn
  return `events ${eventCount} · messages ${turn.messages.length} visible · tools ${overview.tools.ok}/${overview.tools.total} ok · errors ${overview.errors}`
}

function normalizeTurnStatus(status: string): string {
  return status.replace(/\s+/g, ' ').trim()
}

function buildOperatorSpine(
  input: BuildOperatorViewInput,
  turn: TuiTurnViewModel,
  sessions: TuiSessionViewModel,
  pendingPrompt: PendingPrompt | null,
): TuiOperatorSpineItem[] {
  const items: TuiOperatorSpineItem[] = []
  if (pendingPrompt) {
    items.push({
      key: `prompt-${pendingPrompt.id}`,
      kind: 'prompt',
      label: pendingPrompt.request?.choices?.length ? 'answer' : 'input',
      title: pendingPrompt.request?.title ?? 'Operator answer required',
      detail: firstUsefulLine(pendingPrompt.request?.lines) ?? 'The runtime is paused for operator input.',
      action: pendingPrompt.request?.choices?.length
        ? 'Press a number or Enter to accept the highlighted choice.'
        : 'Reply in the composer to continue.',
      tone: 'warning',
      priority: 10,
    })
  }

  const result = latestHandoff(input.events)
  if (input.running || turn.overview.needsAttention || turn.overview.errors > 0 || input.events.length > 0) {
    items.push(buildTurnSpineItem(input, turn, result))
  }

  if (result) {
    items.push({
      key: 'result',
      kind: 'result',
      label: result.handoff.missing ? 'result?' : 'result',
      title: result.handoff.status,
      detail: result.handoff.finalMessage || 'No final answer recorded.',
      action: result.handoff.nextAction || 'Inspect the transcript before relying on this result.',
      tone: result.handoff.missing ? 'warning' : 'success',
      priority: result.handoff.missing ? 35 : 60,
    })
  }

  for (const row of sessions.rows.filter(row => row.needsAttention).slice(0, 3)) {
    items.push({
      key: `session-${row.session.sessionId}`,
      kind: 'session',
      label: row.label,
      title: row.title,
      detail: row.context ?? row.meta,
      action: row.commandHint,
      tone: row.tone,
      priority: 70 + row.priority,
    })
  }

  if (items.length === 0) {
    items.push({
      key: 'ready',
      kind: 'ready',
      label: 'ready',
      title: input.status === 'ready' ? 'Ready for a task' : input.status,
      detail: sessions.rows.length > 0 ? sessions.headline : 'No session evidence yet.',
      action: 'Type a task, resume a session, or open recent session detail.',
      tone: 'muted',
      priority: 1000,
    })
  }

  return items.sort((left, right) => left.priority - right.priority)
}

function buildTurnSpineItem(
  input: BuildOperatorViewInput,
  turn: TuiTurnViewModel,
  result: Extract<TuiRuntimeEvent, { type: 'handoff' }> | undefined,
): TuiOperatorSpineItem {
  if (turn.overview.errors > 0 || input.status === 'error') {
    return {
      key: 'turn-error',
      kind: 'turn',
      label: 'error',
      title: normalizeTurnStatus(turn.overview.status),
      detail: buildTurnSubline(turn, input.events.length),
      action: 'Inspect the current turn or open the affected session before continuing.',
      tone: 'danger',
      priority: 20,
    }
  }
  if (turn.overview.needsAttention) {
    return {
      key: 'turn-attention',
      kind: 'turn',
      label: turn.overview.phase,
      title: normalizeTurnStatus(turn.overview.status),
      detail: buildTurnSubline(turn, input.events.length),
      action: turn.overview.phase === 'needs result'
        ? 'Inspect the handoff and transcript before relying on this result.'
        : 'Answer in the composer so the runtime can continue.',
      tone: 'warning',
      priority: 30,
    }
  }
  if (input.running) {
    return {
      key: 'turn-running',
      kind: 'turn',
      label: 'working',
      title: normalizeTurnStatus(turn.overview.status),
      detail: buildTurnSubline(turn, input.events.length),
      action: 'Watch the current turn; use /details for full tool activity.',
      tone: 'active',
      priority: 40,
    }
  }
  return {
    key: 'turn',
    kind: 'turn',
    label: result ? 'finished' : turn.overview.phase,
    title: normalizeTurnStatus(turn.overview.status),
    detail: buildTurnSubline(turn, input.events.length),
    action: result?.handoff.nextAction || 'Review the result, then start or resume work.',
    tone: result?.handoff.missing ? 'warning' : 'muted',
    priority: 80,
  }
}

function latestHandoff(events: TuiRuntimeEvent[]): Extract<TuiRuntimeEvent, { type: 'handoff' }> | undefined {
  return [...events].reverse().find((event): event is Extract<TuiRuntimeEvent, { type: 'handoff' }> => event.type === 'handoff')
}

function firstUsefulLine(lines: string[] | undefined): string | undefined {
  return lines?.map(line => line.trim()).find(Boolean)
}
