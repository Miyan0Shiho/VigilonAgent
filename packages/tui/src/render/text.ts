import type {
  TuiAgentView,
  TuiCompactResult,
  TuiHandoff,
  TuiRuntimeEvent,
  TuiSessionDetail,
  TuiSessionSummary,
  TuiToolActivity,
} from '../runtime/types.js'
import { formatCommandHelpLines } from '../runtime/commandCatalog.js'
import { buildOperatorViewModel, type TuiOperatorViewModel } from '../runtime/operatorView.js'
import {
  buildTurnTimeline,
  displayToolName,
  isFocusedControlTool,
  type TuiTurnTimelineItem,
} from '../runtime/turnView.js'
import { renderMarkdownToAnsi } from './markdown.js'

export function renderShellFrame(input: {
  cwd: string
  sessionsDir?: string
  permissionMode?: string
  model?: string
  sessions: TuiSessionSummary[]
  events: TuiRuntimeEvent[]
  status: string
  showSessions?: boolean
  detailMode?: boolean
}): string {
  const operator = buildOperatorViewModel({
    sessions: input.sessions,
    events: input.events,
    status: input.status,
    running: input.status.startsWith('running'),
    detailMode: input.detailMode ?? false,
  })
  const timeline = operator.turn.timeline.length > 0 ? renderTimeline(operator.turn.timeline) : []

  return [
    '',
    `✳ Vigilon Operator Shell                                                  ${operator.title}`,
    `${operator.headline} · ${operator.nextAction}`,
    ...timeline,
    ...(input.showSessions || operator.sessions.attentionCount > 0 ? [
      '',
      ...renderSessionRows(operator),
    ] : []),
    renderComposer(operator, formatComposerEnvironment(input)),
  ].join('\n')
}

export function renderHelp(): string {
  return [
    '',
    'help',
    '  <prompt>                            Start a new agent task.',
    ...formatCommandHelpLines().map(line => `  ${line}`),
  ].join('\n')
}

export function renderDoctor(data: Record<string, unknown>): string {
  return [
    '',
    'doctor    Doctor',
    ...Object.entries(data).map(([key, value]) => `  ${key}: ${formatValue(value)}`),
  ].join('\n')
}

export function renderSessionDetail(detail: TuiSessionDetail): string {
  return [
    '',
    `session    Session detail  ${detail.session.sessionId}`,
    `  status ${detail.session.status}`,
    `  title ${detail.session.title ?? 'untitled'}`,
    `  handoff ${detail.session.hasHandoffReport ? 'recorded' : 'missing'}`,
    `  transcript ${detail.session.transcriptPath}`,
    detail.session.pendingPlan ? `  pending plan ${detail.session.pendingPlan}` : '',
    ...detail.recentEvents.map(line => `  ${line}`),
  ].filter(Boolean).join('\n')
}

export function renderAgentView(view: TuiAgentView): string {
  const activeDefinitions = view.definitions.filter(definition => definition.active)
  return [
    '',
    `agents    ${activeDefinitions.length} active definitions · ${view.tasks.length} subagent tasks`,
    `  cwd ${view.cwd}`,
    `  sources ${view.sourcePrecedence.join(' < ')}`,
    ...activeDefinitions.slice(0, 12).map(definition =>
      `  ${definition.name} · ${formatAgentSource(definition.source, definition.sourceScope)} · ${definition.host ?? 'local'}${definition.background ? ' · background' : ''} · ${(definition.allowedTools ?? []).join(', ') || 'no tools'}`,
    ),
    view.tasks.length === 0 ? '  no retained or background subagent tasks' : '',
    ...view.tasks.slice(0, 12).flatMap(task => [
      `  ${task.id} · ${task.agentName ?? 'subagent'} · ${task.status ?? 'unknown'} · parent ${task.sessionId}`,
      task.outputSummary ? `    ${truncate(task.outputSummary, 120)}` : '',
      task.worktreeDiff ? `    worktree diff ${formatWorktreeDiff(task.worktreeDiff)}` : '',
      task.worktreeDiff?.sourceApply ? `    source apply ${formatWorktreeApply(task.worktreeDiff.sourceApply)}` : '',
      task.worktreeDiff ? `    merge ${formatMergeCommands(task.sessionId, task.id, task.worktreeDiff)}` : '',
      `    /agents inspect ${task.sessionId} ${task.id}`,
    ].filter(Boolean)),
    ...(view.detail ? [
      '',
      `agent     Task detail ${view.detail.task.id}`,
	      `  parent ${view.detail.parentSessionId}`,
	      `  status ${view.detail.task.status ?? 'unknown'}`,
	      `  transcript ${view.detail.transcriptPath ?? 'missing'}`,
	      ...formatPermissionSummary(view.detail.permissionSummary),
	      view.detail.task.worktreeDiff ? `  worktree diff ${formatWorktreeDiff(view.detail.task.worktreeDiff)}` : '',
      view.detail.task.worktreeDiff?.sourceApply ? `  source apply ${formatWorktreeApply(view.detail.task.worktreeDiff.sourceApply)}` : '',
      view.detail.task.worktreeDiff ? `  merge ${formatMergeCommands(view.detail.parentSessionId, view.detail.task.id, view.detail.task.worktreeDiff)}` : '',
      view.detail.resumeResult ? `  resume ${view.detail.resumeResult.status}: ${truncate(view.detail.resumeResult.finalMessage, 120)}` : '',
      view.detail.stopResult ? `  stop ${view.detail.stopResult.ok ? 'ok' : 'unavailable'}: ${truncate(view.detail.stopResult.message, 120)}` : '',
      view.detail.applyResult ? `  apply ${view.detail.applyResult.status}: ${truncate(view.detail.applyResult.message, 120)}` : '',
      ...view.detail.lifecycleEvents.slice(-8).map(line => `  lifecycle ${line}`),
      ...view.detail.recentEvents.slice(-8).map(line => `  ${line}`),
    ].filter(Boolean) : []),
	  ].filter(Boolean).join('\n')
}

export function renderCompactResult(result: TuiCompactResult): string {
  const readiness = result.memoryReadiness
  const grounding = readiness?.groundingValidation
  const tokenPressure = result.boundary?.tokenPressure
  return [
    '',
    `compact   ${result.sessionId}`,
    `  compacted ${result.compacted ? 'yes' : 'no'} · summary ${result.summarySource ?? 'unknown'} · events ${result.eventCount ?? 'unknown'}`,
    `  memory ${readiness?.after ?? 'missing'} · ready ${readiness?.ready === false ? 'no' : 'yes'} · refreshed ${readiness?.refreshed ? 'yes' : 'no'}`,
    readiness?.blockingReasons?.length ? `  blocks ${readiness.blockingReasons.join(', ')}` : '',
    grounding ? `  grounding ${grounding.status ?? 'unknown'} · ${grounding.modelId ?? 'unknown-model'} · ${truncate(grounding.reason ?? '', 120)}` : '',
    tokenPressure ? `  tokens ${tokenPressure.tokenCountSource ?? 'unknown'} · ${tokenPressure.estimatedTokens ?? '?'} / ${tokenPressure.tokenBudget ?? '?'} · ${tokenPressure.reason ?? 'unknown'}` : '',
    `  route ${result.boundary?.route?.strategy ?? 'unknown'} · cleanup ${result.boundary?.postCompactCleanup?.completed ? 'complete' : 'unknown'}`,
    result.transcriptPath ? `  transcript ${result.transcriptPath}` : '',
  ].filter(Boolean).join('\n')
}

function formatAgentSource(source: string, scope?: string): string {
  return scope ? `${source}:${scope}` : source
}

function formatPermissionSummary(
  summary: NonNullable<TuiAgentView['detail']>['permissionSummary'],
): string[] {
  if (!summary) return []
  if (summary.totalRequests === 0) return ['  permissions none']
  const actions = summary.actions.map(action => `${action.action}:${action.count}`).join(', ')
  const origins = summary.agents
    .map(agent => {
      const parent = agent.parentAgentId ? `<-${agent.parentAgentId}` : ''
      const tools = agent.tools.length ? ` · ${agent.tools.join(',')}` : ''
      return `${agent.agentRole}:${agent.agentId}${parent} ${agent.count}/${agent.allowed}/${agent.denied}${tools}`
    })
    .join('; ')
  const latest = summary.latest
    ? `  latest permission ${summary.latest.action} ${summary.latest.allowed ? 'allow' : 'deny'} ${summary.latest.subject}`
    : ''
  return [
    `  permissions ${summary.totalRequests} · allow ${summary.allowed} · deny ${summary.denied}${actions ? ` · ${actions}` : ''}`,
    origins ? `  origins ${origins}` : '',
    latest,
  ].filter(Boolean)
}

function formatWorktreeDiff(diff: NonNullable<TuiAgentView['tasks'][number]['worktreeDiff']>): string {
  const files = diff.changedFiles?.length ? ` · files ${diff.changedFiles.slice(0, 5).join(', ')}` : ''
  return `${diff.status} · ${diff.filesChanged} files · +${diff.additions} -${diff.deletions}${files}${diff.patchPath ? ` · patch ${diff.patchPath}` : ''}`
}

function formatWorktreeApply(apply: NonNullable<NonNullable<TuiAgentView['tasks'][number]['worktreeDiff']>['sourceApply']>): string {
  const conflicts = apply.conflicts?.length ? ` · conflicts ${apply.conflicts.join(', ')}` : ''
  const error = apply.error ? ` · ${truncate(apply.error, 80)}` : ''
  return `${apply.status} · ${apply.filesChanged} files${conflicts}${error}`
}

function formatMergeCommands(
  sessionId: string,
  taskId: string,
  diff: NonNullable<TuiAgentView['tasks'][number]['worktreeDiff']>,
): string {
  const fileHint = diff.changedFiles?.length
    ? ` · partial /agents apply ${sessionId} ${taskId} --files ${diff.changedFiles.slice(0, 3).join(',')}`
    : ''
  return [
    `/agents apply ${sessionId} ${taskId} --check`,
    `/agents apply ${sessionId} ${taskId} --3way`,
    `/agents apply ${sessionId} ${taskId} --rollback`,
  ].join(' · ') + fileHint
}

export function renderRuntimeEvent(
  event: TuiRuntimeEvent,
  options: { detailMode?: boolean; previousEvents?: TuiRuntimeEvent[] } = {},
): string[] {
  const detailMode = options.detailMode ?? false
  if (!detailMode && event.type === 'tool' && event.activity.status !== 'error' && isFocusedControlTool(event.activity)) {
    return []
  }
  if (!detailMode && event.type === 'tool' && event.activity.status === 'running') {
    return [`● running ${displayToolName(event.activity.name)}${event.activity.summary ? `  ${truncate(event.activity.summary, 96)}` : ''}`]
  }
  const previousEvents = options.previousEvents ?? []
  const eventIndex = previousEvents.length
  return renderTimeline(
    buildTurnTimeline([...previousEvents, event], { detailMode })
      .filter(item => item.key.startsWith(`${eventIndex}-`)),
  )
}

export function renderToolActivity(activity: TuiToolActivity): string[] {
  const status =
    activity.status === 'running' ? 'running' : activity.status === 'ok' ? 'ok' : 'failed'
  const icon = activity.status === 'running' ? '●' : activity.status === 'ok' ? '✓' : '✗'
  const toolName = displayToolName(activity.name)
  return [
    `│ ${icon} ${padRight(`${toolName}  ${status}`, 68)} │`,
    `│   ${padRight(`tool        ${activity.name}  id=${activity.id}`, 68)} │`,
    `│   ⎿ ${padRight(truncate(activity.summary, 64), 66)} │`,
    ...(activity.detail ? [`│     ${padRight(truncate(activity.detail, 66), 66)} │`] : []),
  ]
}

export function renderHandoff(handoff: TuiHandoff): string[] {
  return [
    '├─ Result ──────────────────────────────────────────────────────────────┤',
    `│ ${padRight(`result      ${handoff.status}${handoff.missing ? '  missing final answer' : ''}`, 70)} │`,
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

function renderSessionRows(operator: TuiOperatorViewModel): string[] {
  const model = operator.sessions
  if (model.rows.length === 0) return ['sessions  no sessions yet']
  return [
    `sessions  ${model.headline}`,
    ...model.visibleRows.flatMap(row => [
      `${String(row.commandIndex).padStart(2, ' ')} ${row.label.padEnd(10, ' ')} ${truncate(row.title, 42)}  ${row.commandHint}`,
      `   ${row.meta}`,
      row.context ? `   ${truncate(row.context, 60)}` : '',
    ].filter(Boolean)),
    model.hiddenCount > 0 ? `   ... ${model.hiddenCount} more; use /sessions` : '',
  ].filter(Boolean)
}

function renderTurnSummary(operator: TuiOperatorViewModel): string[] {
  const model = operator.turn
  const { overview, toolSummary } = model
  const lines = [
    `${overview.phase}; ${overview.status}; timeline=${model.timeline.length}; tools=${overview.tools.ok}/${overview.tools.total} ok`,
  ]
  if (toolSummary) {
    lines.push(
      `tools running=${toolSummary.running} ok=${toolSummary.ok} errors=${toolSummary.error}${
        toolSummary.latest ? ` latest=${displayToolName(toolSummary.latest.name)} ${toolSummary.latest.status}` : ''
      }`,
    )
  }
  return [
    ...lines,
  ]
}

function renderTimeline(items: TuiTurnTimelineItem[]): string[] {
  return items.flatMap(item => {
    if (item.kind === 'user') return [`> ${truncate(item.detail, 120)}`]
    if (item.kind === 'assistant') return renderAssistantMarkdown(item.detail)
    if ((item.kind === 'tool' || item.kind === 'prompt' || item.kind === 'result') && !item.meta) {
      return [`${timelineGlyph(item)} ${item.label.padEnd(10, ' ')} ${truncate(`${item.title}  ${item.detail}`, 96)}`]
    }
    return [
      `${timelineGlyph(item)} ${item.label.padEnd(10, ' ')} ${truncate(item.title, 96)}`,
      `  ${truncate(item.detail, 120)}`,
      item.meta ? `  ${truncate(item.meta, 120)}` : '',
      item.activity?.detail ? `  ${truncate(item.activity.detail, 120)}` : '',
    ].filter(Boolean)
  })
}

function renderAssistantMarkdown(value: string): string[] {
  const rendered = renderMarkdownToAnsi(value, { width: 112, maxLines: 12 })
  if (!rendered.trim()) return ['  (no text)']
  return rendered.split('\n').map(line => `  ${line}`)
}

function timelineGlyph(item: TuiTurnTimelineItem): string {
  if (item.kind === 'tool' && item.activity?.status === 'running') return '●'
  if (item.tone === 'success') return '✓'
  if (item.tone === 'danger') return '✗'
  if (item.tone === 'warning') return '!'
  return '·'
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

function renderComposer(operator: TuiOperatorViewModel, environment?: string): string {
  return [
    'vigilon ›',
    formatComposerFooter(operator, environment),
  ].join('\n')
}

function formatComposerFooter(operator: TuiOperatorViewModel, environment?: string): string {
  if (operator.mode === 'ready' || operator.mode === 'attention') {
    return [environment, operator.commandHint].filter(Boolean).join(' · ')
  }
  return [operator.composerHint, environment, operator.commandHint].filter(Boolean).join(' · ')
}

function formatComposerEnvironment(input: {
  cwd: string
  model?: string
  permissionMode?: string
}): string {
  return `${input.model ?? 'deepseek-v4-flash'} · ${input.permissionMode ?? 'ask'} · cwd ${basename(input.cwd)}`
}

function basename(path: string): string {
  const normalized = path.replace(/\/+$/, '')
  return normalized.split('/').filter(Boolean).at(-1) ?? path
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
