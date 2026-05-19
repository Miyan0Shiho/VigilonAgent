import type {
  TuiHandoff,
  TuiRuntimeEvent,
  TuiSessionDetail,
  TuiSessionSummary,
  TuiToolActivity,
} from '../runtime/types.js'

export function renderShellFrame(input: {
  cwd: string
  sessionsDir?: string
  permissionMode?: string
  model?: string
  sessions: TuiSessionSummary[]
  events: TuiRuntimeEvent[]
  status: string
}): string {
  return [
    '',
    '╭─ Vigilon Operator Shell ────────────────────────────────────────────────╮',
    `│ ${padRight('Claude-like local operator surface', 70)} │`,
    `│ ${padRight(`cwd ${input.cwd}`, 70)} │`,
    `│ ${padRight(`model ${input.model ?? 'deepseek-v4-flash'}   permission ${input.permissionMode ?? 'ask'}`, 70)} │`,
    `│ ${padRight(`sessions ${input.sessionsDir ?? 'default .vigilon/sessions'}`, 70)} │`,
    '╰────────────────────────────────────────────────────────────────────────╯',
    '',
    '╭─ Sessions / tasks ─────────────────────────────────────────────────────╮',
    ...renderSessionRows(input.sessions),
    '╰────────────────────────────────────────────────────────────────────────╯',
    '',
    '╭─ Conversation ─────────────────────────────────────────────────────────╮',
    ...(input.events.length > 0 ? input.events.flatMap(renderRuntimeEvent) : ['  no active messages']),
    '╰────────────────────────────────────────────────────────────────────────╯',
    '',
    renderComposer(input.status),
  ].join('\n')
}

export function renderHelp(): string {
  return [
    '',
    '╭─ Help ─────────────────────────────────────────────────────────────────╮',
    '│ <prompt>                         start a task                          │',
    '│ /clear                           clear visible message stream           │',
    '│ /sessions                        refresh session/task panel             │',
    '│ /resume <index|session-id> ...    continue a session                    │',
    '│ /approve <index|session-id> ...   approve pending plan and continue     │',
    '│ /open <index|session-id>          inspect transcript preview             │',
    '│ /doctor                          show runtime health                    │',
    '│ /quit                            exit shell                             │',
    '╰────────────────────────────────────────────────────────────────────────╯',
  ].join('\n')
}

export function renderDoctor(data: Record<string, unknown>): string {
  return [
    '',
    '╭─ Doctor ───────────────────────────────────────────────────────────────╮',
    ...Object.entries(data).map(([key, value]) => frameLine(`${key}: ${formatValue(value)}`)),
    '╰────────────────────────────────────────────────────────────────────────╯',
  ].join('\n')
}

export function renderSessionDetail(detail: TuiSessionDetail): string {
  return [
    '',
    '╭─ Session detail ───────────────────────────────────────────────────────╮',
    frameLine(`session ${detail.session.sessionId}`),
    frameLine(`status ${detail.session.status}`),
    frameLine(`title ${detail.session.title ?? 'untitled'}`),
    frameLine(`handoff ${detail.session.hasHandoffReport ? 'recorded' : 'missing'}`),
    frameLine(`transcript ${detail.session.transcriptPath}`),
    detail.session.pendingPlan ? frameLine(`pending plan ${detail.session.pendingPlan}`) : '',
    '├─ Recent transcript ───────────────────────────────────────────────────┤',
    ...detail.recentEvents.map(line => frameLine(line)),
    '╰────────────────────────────────────────────────────────────────────────╯',
  ].filter(Boolean).join('\n')
}

export function renderRuntimeEvent(event: TuiRuntimeEvent): string[] {
  switch (event.type) {
    case 'user':
      return [`│ > ${truncate(event.content, 68).padEnd(68, ' ')} │`]
    case 'assistant':
      return [
        ...(event.reasoning ? [`│ ✻ ${truncate(event.reasoning, 68).padEnd(68, ' ')} │`] : []),
        `│   ${truncate(event.content || '(no text)', 68).padEnd(68, ' ')} │`,
      ]
    case 'working':
      return [`│ ✻ ${truncate(event.content, 68).padEnd(68, ' ')} │`]
    case 'tool':
      return renderToolActivity(event.activity)
    case 'permission':
      return renderDialog('Permission required', event.lines, 'permission')
    case 'ask-user':
      return renderDialog('Operator question', event.lines, 'ask-user')
    case 'hook':
      return renderDialog('Hook blocked tool', event.lines, 'hook-block')
    case 'error':
      return [`│ ✗ ${truncate(event.content, 68).padEnd(68, ' ')} │`]
    case 'handoff':
      return renderHandoff(event.handoff)
  }
}

export function renderToolActivity(activity: TuiToolActivity): string[] {
  const status =
    activity.status === 'running' ? 'running' : activity.status === 'ok' ? 'ok' : 'failed'
  const icon = activity.status === 'running' ? '●' : activity.status === 'ok' ? '✓' : '✗'
  const toolName = renderToolName(activity.name)
  return [
    `│ ${icon} ${padRight(`${toolName}  ${status}`, 68)} │`,
    `│   ${padRight(`tool        ${activity.name}  id=${activity.id}`, 68)} │`,
    `│   ⎿ ${padRight(truncate(activity.summary, 64), 66)} │`,
    ...(activity.detail ? [`│     ${padRight(truncate(activity.detail, 66), 66)} │`] : []),
  ]
}

export function renderHandoff(handoff: TuiHandoff): string[] {
  return [
    '├─ Result handoff ──────────────────────────────────────────────────────┤',
    `│ ${padRight(`result      ${handoff.status}${handoff.missing ? '  ResultReport missing' : ''}`, 70)} │`,
    frameLine(`final ${handoff.finalMessage || '(no final message)'}`),
    frameLine(`changed ${handoff.changedFiles.length ? handoff.changedFiles.join(' | ') : 'none recorded'}`),
    frameLine(`verified ${handoff.verification.length ? handoff.verification.join(' | ') : 'none recorded'}`),
    frameLine(`unverified ${handoff.unverified.join(' | ')}`),
    frameLine(`risks ${handoff.risks.join(' | ')}`),
    frameLine(`todos ${handoff.todos.length ? handoff.todos.join(' | ') : 'none'}`),
    frameLine(`transcript ${handoff.transcriptPath}`),
    frameLine(`next ${handoff.nextAction}`),
  ]
}

function renderSessionRows(sessions: TuiSessionSummary[]): string[] {
  if (sessions.length === 0) return [frameLine('no sessions yet')]
  return sessions.slice(0, 10).flatMap((session, index) => [
    frameLine(`${String(index + 1).padStart(2, ' ')} ${session.status.padEnd(16, ' ')} ${truncate(session.title ?? session.sessionId, 44)}`),
    frameLine(`   id=${session.sessionId} todos=${session.completedTodoCount}/${session.completedTodoCount + session.remainingTodoCount} verify=${session.verificationCount} handoff=${session.hasHandoffReport ? 'yes' : 'no'}`),
    session.lastAction ? frameLine(`   last ${truncate(session.lastAction, 60)}`) : '',
  ].filter(Boolean))
}

function renderDialog(title: string, lines: string[], marker: string): string[] {
  const controls =
    marker === 'ask-user'
      ? '│   ❯ answer with option number or label                               │'
      : '│   ❯ 1. allow    2. deny    3. allow similar                           │'
  return [
    '├────────────────────────────────────────────────────────────────────────┤',
    `│ ${padRight(`${marker}: ${title}`, 70)} │`,
    ...lines.map(line => frameLine(line)),
    controls,
  ]
}

function renderComposer(status: string): string {
  return [
    '╭─ Composer ─────────────────────────────────────────────────────────────╮',
    `│ ${padRight(`status ${status}`, 70)} │`,
    '│ vigilon ›                                                              │',
    '│ /help /clear /sessions /resume /open /approve /doctor /quit            │',
    '╰────────────────────────────────────────────────────────────────────────╯',
  ].join('\n')
}

function renderToolName(name: string): string {
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

function frameLine(value: string): string {
  return `│ ${padRight(truncate(value, 70), 70)} │`
}

function padRight(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width)
  return value.padEnd(width, ' ')
}

function truncate(value: string, maxChars: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
