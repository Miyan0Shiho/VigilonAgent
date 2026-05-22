import type { TuiRuntimeEvent, TuiToolActivity } from './types.js'

export type TuiTurnTimelineTone = 'danger' | 'warning' | 'active' | 'success' | 'muted'

export type TuiTurnTimelineKind =
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'tool'
  | 'prompt'
  | 'result'
  | 'error'
  | 'system'

export type TuiTurnTimelineItem = {
  key: string
  kind: TuiTurnTimelineKind
  label: string
  title: string
  detail: string
  meta?: string
  tone: TuiTurnTimelineTone
  activity?: TuiToolActivity
}

export type TuiTurnOverview = {
  phase: string
  status: string
  needsAttention: boolean
  errors: number
  tools: {
    total: number
    ok: number
  }
}

export type TuiToolSummary = {
  running: number
  ok: number
  error: number
  latest?: TuiToolActivity
}

export type TuiTurnViewModel = {
  overview: TuiTurnOverview
  timeline: TuiTurnTimelineItem[]
  hiddenTimelineCount: number
  messages: TuiRuntimeEvent[]
  toolActivities: TuiToolActivity[]
  toolSummary: TuiToolSummary | null
}

export type BuildTurnViewOptions = {
  detailMode?: boolean
  messageLimit?: number
  toolLimit?: number
  timelineLimit?: number
  activePromptKind?: 'permission' | 'question' | 'input'
}

export function buildTurnViewModel(
  events: TuiRuntimeEvent[],
  options: BuildTurnViewOptions = {},
): TuiTurnViewModel {
  const detailMode = options.detailMode ?? false
  const messageLimit = options.messageLimit ?? (detailMode ? 18 : 8)
  const toolLimit = options.toolLimit ?? 10
  const timelineLimit = options.timelineLimit ?? (detailMode ? 24 : 10)
  const toolActivities = collectToolActivities(events)
  const timeline = buildTurnTimeline(events, { detailMode, activePromptKind: options.activePromptKind })
  const visibleTimeline = timeline.slice(-timelineLimit)
  const messages = events
    .filter(event => event.type !== 'tool')
    .filter(event => detailMode || event.type !== 'working')
    .slice(-messageLimit)

  return {
    overview: buildTurnOverview(events),
    timeline: visibleTimeline,
    hiddenTimelineCount: Math.max(0, timeline.length - visibleTimeline.length),
    messages,
    toolActivities: toolActivities.slice(-toolLimit),
    toolSummary: buildToolSummary(toolActivities),
  }
}

export function buildTurnOverview(events: TuiRuntimeEvent[]): TuiTurnOverview {
  const toolActivities = collectToolActivities(events)
  const toolSnapshot = latestToolSnapshot(toolActivities)
  const tools = summarizeTools(toolSnapshot)
  const explicitErrors = events.filter(event => event.type === 'error').length
  const errors = explicitErrors + toolSnapshot.filter(activity => activity.status === 'error').length

  if (events.length === 0) {
    return {
      phase: 'idle',
      status: 'idle - no task evidence yet',
      needsAttention: false,
      errors,
      tools,
    }
  }

  const latest = events.at(-1)
  const handoff = [...events].reverse().find(event => event.type === 'handoff')
  if (handoff?.type === 'handoff') {
    const hasVisibleResult = !handoff.handoff.missing
    return {
      phase: hasVisibleResult ? 'result' : 'needs result',
      status: `result ${handoff.handoff.status}${hasVisibleResult ? '' : ' - no final answer'}; errors=${errors}`,
      needsAttention: !hasVisibleResult || errors > 0,
      errors,
      tools,
    }
  }

  if (latest?.type === 'permission') {
    return {
      phase: 'blocked',
      status: `waiting for permission; errors=${errors}`,
      needsAttention: true,
      errors,
      tools,
    }
  }

  if (latest?.type === 'ask-user') {
    return {
      phase: 'question',
      status: `waiting for user answer; errors=${errors}`,
      needsAttention: true,
      errors,
      tools,
    }
  }

  if (latest?.type === 'agent-notification') {
    const replay = latest.notification.replayed ? 'replayed ' : ''
    return {
      phase: 'agent',
      status: `${replay}${latest.notification.agentName ?? 'subagent'} ${latest.notification.status}; errors=${errors}`,
      needsAttention: latest.notification.status === 'failed' || latest.notification.status === 'stopped' || errors > 0,
      errors,
      tools,
    }
  }

  const runningTool = latestRunningTool(events, toolSnapshot)
  if (runningTool) {
    return {
      phase: 'working',
      status: `running ${displayToolName(runningTool.name)}; errors=${errors}`,
      needsAttention: errors > 0,
      errors,
      tools,
    }
  }

  return {
    phase: errors > 0 ? 'attention' : 'working',
    status: `events=${events.length}; errors=${errors}`,
    needsAttention: errors > 0,
    errors,
    tools,
  }
}

export function displayToolName(name: string): string {
  const labels: Record<string, string> = {
    Read: 'Read',
    Grep: 'Search',
    Glob: 'Glob',
    Edit: 'Edit',
    Write: 'Write',
    Bash: 'Bash',
    WebFetch: 'Fetch',
    Notebook: 'Notebook',
    TaskStop: 'Stop task',
    Agent: 'Agent',
    ResultReport: 'ResultReport',
    AskUserQuestion: 'Ask user',
  }
  return labels[name] ?? name
}

export function isFocusedControlTool(activity: TuiToolActivity): boolean {
  return [
    'AskUserQuestion',
    'ResultReport',
    'TodoWrite',
    'EnterPlanMode',
    'ExitPlanMode',
    'TaskStop',
  ].includes(activity.name)
}

export function buildTurnTimeline(
  events: TuiRuntimeEvent[],
  options: { detailMode?: boolean; activePromptKind?: BuildTurnViewOptions['activePromptKind'] } = {},
): TuiTurnTimelineItem[] {
  const detailMode = options.detailMode ?? false
  if (detailMode) return events.flatMap((event, index) => timelineItemForEvent(event, index, detailMode))

  const latestToolIndexById = new Map<string, number>()
  events.forEach((event, index) => {
    if (event.type === 'tool') latestToolIndexById.set(event.activity.id, index)
  })

  const activePromptIndex = latestActivePromptIndex(events, options.activePromptKind)

  return events.flatMap((event, index) => {
    if (event.type === 'working') return []
    if (event.type === 'tool' && event.activity.status === 'running') return []
    if (event.type === 'tool' && latestToolIndexById.get(event.activity.id) !== index) return []
    if (event.type === 'tool' && event.activity.status !== 'error' && isFocusedControlTool(event.activity)) return []
    if (index === activePromptIndex) return []
    if (isResolvedOperatorPrompt(events, index)) return []
    if (event.type === 'handoff' && isDuplicateFocusedHandoff(events, index)) return []
    return timelineItemForEvent(event, index, detailMode)
  })
}

function isResolvedOperatorPrompt(events: TuiRuntimeEvent[], index: number): boolean {
  const event = events[index]
  if (!event || (event.type !== 'permission' && event.type !== 'ask-user' && event.type !== 'hook')) return false
  return events.slice(index + 1).some(later => {
    if (later.type === 'working') return false
    if (later.type === 'permission' || later.type === 'ask-user' || later.type === 'hook') return true
    return true
  })
}

function isDuplicateFocusedHandoff(events: TuiRuntimeEvent[], index: number): boolean {
  const event = events[index]
  if (event?.type !== 'handoff' || event.handoff.missing) return false
  const finalMessage = normalizeComparableText(event.handoff.finalMessage)
  if (!finalMessage) return false
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const previous = events[cursor]
    if (!previous) continue
    if (previous.type === 'user') return false
    if (previous.type === 'assistant') {
      return normalizeComparableText(previous.content) === finalMessage
    }
  }
  return false
}

function normalizeComparableText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function latestActivePromptIndex(
  events: TuiRuntimeEvent[],
  activePromptKind: BuildTurnViewOptions['activePromptKind'],
): number | null {
  if (!activePromptKind || activePromptKind === 'input') return null
  const eventType = activePromptKind === 'permission' ? 'permission' : 'ask-user'
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === eventType) return index
  }
  return null
}

function collectToolActivities(events: TuiRuntimeEvent[]): TuiToolActivity[] {
  return events
    .filter((event): event is Extract<TuiRuntimeEvent, { type: 'tool' }> => event.type === 'tool')
    .map(event => event.activity)
}

function timelineItemForEvent(event: TuiRuntimeEvent, index: number, detailMode: boolean): TuiTurnTimelineItem[] {
  switch (event.type) {
    case 'user':
      return [{
        key: `${index}-user`,
        kind: 'user',
        label: 'user',
        title: 'User prompt',
        detail: event.content,
        tone: 'active',
      }]
    case 'assistant':
      return [
        ...(detailMode && event.reasoning ? [{
          key: `${index}-thinking`,
          kind: 'thinking' as const,
          label: 'think',
          title: 'Assistant reasoning',
          detail: event.reasoning,
          tone: 'muted' as const,
        }] : []),
        {
          key: `${index}-assistant`,
          kind: 'assistant',
          label: 'assistant',
          title: 'Assistant',
          detail: event.content || '(no text)',
          tone: 'success',
        },
      ]
    case 'working':
      return [{
        key: `${index}-working`,
        kind: 'thinking',
        label: 'work',
        title: 'Working',
        detail: event.content,
        tone: 'muted',
      }]
    case 'tool':
      return [{
        key: `${index}-tool-${event.activity.id}`,
        kind: 'tool',
        label: toolStatusLabel(event.activity.status),
        title: detailMode
          ? `${displayToolName(event.activity.name)} ${toolStatusText(event.activity.status)}`
          : displayToolName(event.activity.name),
        detail: event.activity.summary,
        meta: detailMode ? `tool        ${event.activity.name}  id=${event.activity.id}` : undefined,
        tone: event.activity.status === 'error' ? 'danger' : event.activity.status === 'running' ? 'active' : 'success',
        activity: event.activity,
      }]
    case 'subagent':
      return [{
        key: `${index}-subagent-${event.taskId}-${event.status}`,
        kind: 'tool',
        label: 'agent',
        title: `${event.agentName} ${event.status}`,
        detail: event.summary || event.taskId,
        meta: detailMode ? `subagent    ${event.agentName}  id=${event.taskId}` : undefined,
        tone: event.status === 'failed' || event.status === 'stopped'
          ? 'danger'
          : event.status === 'completed'
            ? 'success'
            : 'active',
      }]
    case 'agent-notification':
      const replay = event.notification.replayed ? 'replayed ' : ''
      return [{
        key: `${index}-agent-notification-${event.notification.taskId}-${event.notification.status}`,
        kind: 'system',
        label: 'agent',
        title: `${replay}${event.notification.agentName ?? 'subagent'} ${event.notification.status}`,
        detail: event.notification.outputSummary ?? event.notification.terminalReason ?? event.notification.taskId,
        meta: detailMode
          ? `task        ${event.notification.taskId}${event.notification.sessionId ? `  parent=${event.notification.sessionId}` : ''}`
          : undefined,
        tone: event.notification.status === 'failed' || event.notification.status === 'stopped'
          ? 'warning'
          : 'success',
      }]
    case 'permission':
      return [{
        key: `${index}-permission`,
        kind: 'prompt',
        label: 'permission',
        title: 'Permission required',
        detail: firstUsefulLine(event.lines) ?? 'Permission decision required.',
        meta: detailMode ? 'reply y / n / s' : undefined,
        tone: 'warning',
      }]
    case 'ask-user':
      return [{
        key: `${index}-ask-user`,
        kind: 'prompt',
        label: 'ask-user',
        title: 'Operator question',
        detail: firstUsefulLine(event.lines) ?? 'Operator answer required.',
        meta: detailMode ? 'reply with option number or label' : undefined,
        tone: 'warning',
      }]
    case 'hook':
      return [{
        key: `${index}-hook`,
        kind: 'prompt',
        label: 'hook',
        title: 'Hook decision',
        detail: firstUsefulLine(event.lines) ?? 'Hook blocked tool execution.',
        meta: detailMode ? 'reply y / n / s' : undefined,
        tone: 'warning',
      }]
    case 'error':
      return [{
        key: `${index}-error`,
        kind: 'error',
        label: 'error',
        title: 'Runtime error',
        detail: event.content,
        tone: 'danger',
      }]
    case 'handoff':
      if (!detailMode && !event.handoff.missing) {
        return [{
          key: `${index}-handoff`,
          kind: 'assistant',
          label: 'assistant',
          title: 'Assistant',
          detail: event.handoff.finalMessage || '(no final message)',
          tone: 'success',
        }]
      }
      return [{
        key: `${index}-handoff`,
        kind: 'result',
        label: event.handoff.missing ? 'result?' : 'result',
        title: `Result ${event.handoff.status}`,
        detail: event.handoff.finalMessage || '(no final message)',
        meta: detailMode
          ? `result      ${event.handoff.status}${event.handoff.missing ? '  missing final answer' : ''}; next ${event.handoff.nextAction}`
          : event.handoff.missing ? event.handoff.nextAction : undefined,
        tone: event.handoff.missing ? 'warning' : 'success',
      }]
  }
}

function toolStatusLabel(status: TuiToolActivity['status']): string {
  if (status === 'running') return 'tool...'
  if (status === 'ok') return 'tool'
  return 'tool!'
}

function toolStatusText(status: TuiToolActivity['status']): string {
  if (status === 'running') return 'running'
  if (status === 'ok') return 'ok'
  return 'failed'
}

function firstUsefulLine(lines: string[]): string | undefined {
  return lines.map(line => line.trim()).find(Boolean)
}

function buildToolSummary(activities: TuiToolActivity[]): TuiToolSummary | null {
  if (activities.length === 0) return null
  const snapshot = latestToolSnapshot(activities)
  return {
    running: snapshot.filter(activity => activity.status === 'running').length,
    ok: snapshot.filter(activity => activity.status === 'ok').length,
    error: snapshot.filter(activity => activity.status === 'error').length,
    latest: activities.at(-1),
  }
}

function latestToolSnapshot(activities: TuiToolActivity[]): TuiToolActivity[] {
  const latestById = new Map<string, TuiToolActivity>()
  for (const activity of activities) latestById.set(activity.id, activity)
  return [...latestById.values()]
}

function summarizeTools(activities: TuiToolActivity[]): TuiTurnOverview['tools'] {
  return {
    total: activities.length,
    ok: activities.filter(activity => activity.status === 'ok').length,
  }
}

function latestRunningTool(
  events: TuiRuntimeEvent[],
  toolSnapshot: TuiToolActivity[],
): TuiToolActivity | undefined {
  const runningIds = new Set(
    toolSnapshot
      .filter(activity => activity.status === 'running')
      .map(activity => activity.id),
  )
  for (const event of [...events].reverse()) {
    if (event.type === 'tool' && runningIds.has(event.activity.id)) return event.activity
  }
  return undefined
}
