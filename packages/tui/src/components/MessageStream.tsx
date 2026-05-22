import React from 'react'
import { Box, Text } from 'ink'
import type { PendingPrompt } from '../runtime/lineReader.js'
import type {
  TuiAgentDefinitionRow,
  TuiAgentTaskRow,
  TuiAgentView,
  TuiCompactResult,
  TuiPermissionOriginSummary,
  TuiRuntimeEvent,
  TuiSessionDetail,
  TuiSessionSummary,
} from '../runtime/types.js'
import { buildSessionViewModel, type TuiSessionRow, type TuiSessionTone } from '../runtime/sessionView.js'
import { buildTurnViewModel, type TuiTurnTimelineItem, type TuiTurnTimelineTone } from '../runtime/turnView.js'
import { Markdown } from './Markdown.js'

export function MessageStream({
  events,
  detailMode,
  sessions = [],
  showSessions = false,
  sessionDetail = null,
  agentView = null,
  compactResult = null,
  doctor = null,
  pendingPrompt = null,
}: {
  events: TuiRuntimeEvent[]
  detailMode: boolean
  sessions?: TuiSessionSummary[]
  showSessions?: boolean
  sessionDetail?: TuiSessionDetail | null
  agentView?: TuiAgentView | null
  compactResult?: TuiCompactResult | null
  doctor?: Record<string, unknown> | null
  pendingPrompt?: PendingPrompt | null
}): React.ReactElement {
  const model = buildTurnViewModel(events, {
    detailMode,
    activePromptKind: pendingPrompt?.request?.kind,
  })
  const { overview } = model
  const sessionModel = buildSessionViewModel(sessions, { limit: 8 })
  const hasInlinePayload = Boolean(sessionDetail || agentView || compactResult || doctor || showSessions)
  const showStreamStatus = detailMode || overview.needsAttention
  const timelineMarginTop = showStreamStatus || model.hiddenTimelineCount > 0 ? 1 : 0
  const hasVisibleContent = showStreamStatus ||
    model.hiddenTimelineCount > 0 ||
    model.timeline.length > 0 ||
    hasInlinePayload

  if (!hasVisibleContent) return <Box />

  return (
    <Box flexDirection="column">
      {showStreamStatus ? (
        <Text color={overview.needsAttention ? 'yellow' : 'gray'}>
          {overview.phase}: {overview.status}
          {detailMode ? ` · events ${events.length} · tools ${overview.tools.ok}/${overview.tools.total} ok · errors ${overview.errors}` : ''}
        </Text>
      ) : null}
      {model.hiddenTimelineCount > 0 ? <Text color="gray">... {model.hiddenTimelineCount} earlier events hidden; /details expands tool activity</Text> : null}
      {model.timeline.length > 0 ? (
        <Box flexDirection="column" marginTop={timelineMarginTop}>
          {model.timeline.map(item => (
            <TimelineRow item={item} key={item.key} />
          ))}
        </Box>
      ) : null}
      {sessionDetail ? <InlineSessionDetail detail={sessionDetail} /> : null}
      {agentView ? <InlineAgents view={agentView} /> : null}
      {compactResult ? <InlineCompact result={compactResult} /> : null}
      {doctor ? <InlineDoctor doctor={doctor} /> : null}
      {showSessions ? <InlineSessions rows={sessionModel.visibleRows} hiddenCount={sessionModel.hiddenCount} headline={sessionModel.headline} /> : null}
    </Box>
  )
}

function InlineCompact({ result }: { result: TuiCompactResult }): React.ReactElement {
  const readiness = result.memoryReadiness
  const grounding = readiness?.groundingValidation
  const tokenPressure = result.boundary?.tokenPressure
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text color="cyan">compact   </Text>
        <Text>{result.sessionId}</Text>
        <Text color="gray"> · {result.summarySource ?? 'unknown-summary'} · events {result.eventCount ?? 'unknown'}</Text>
      </Text>
      <Text color={readiness?.ready === false ? 'yellow' : 'gray'}>
        {'  '}memory {readiness?.after ?? 'missing'} · ready {readiness?.ready === false ? 'no' : 'yes'} · refreshed {readiness?.refreshed ? 'yes' : 'no'}
        {readiness?.blockingReasons?.length ? ` · blocks ${readiness.blockingReasons.join(', ')}` : ''}
      </Text>
      {grounding ? (
        <Text color={grounding.status === 'supported' ? 'green' : 'yellow'}>
          {'  '}grounding {grounding.status} · {grounding.modelId ?? 'unknown-model'} · {(grounding.reason ?? '').slice(0, 120)}
        </Text>
      ) : null}
      {tokenPressure ? (
        <Text color="gray">
          {'  '}tokens {tokenPressure.tokenCountSource ?? 'unknown'} · {tokenPressure.estimatedTokens ?? '?'} / {tokenPressure.tokenBudget ?? '?'} · {tokenPressure.reason ?? 'unknown'}
        </Text>
      ) : null}
      <Text color="gray">
        {'  '}route {result.boundary?.route?.strategy ?? 'unknown'} · cleanup {result.boundary?.postCompactCleanup?.completed ? 'complete' : 'unknown'} · transcript {result.transcriptPath ?? 'unknown'}
      </Text>
    </Box>
  )
}

function InlineAgents({ view }: { view: TuiAgentView }): React.ReactElement {
  const activeDefinitions = view.definitions.filter(definition => definition.active)
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text color="cyan">agents    </Text>
        <Text>{activeDefinitions.length} active definitions · {view.tasks.length} subagent tasks</Text>
      </Text>
      <Text color="gray">{'  '}sources {view.sourcePrecedence.join(' < ')}</Text>
      {activeDefinitions.slice(0, 8).map(definition => <InlineAgentDefinition key={`${definition.source}:${definition.name}`} definition={definition} />)}
      {view.tasks.length === 0 ? <Text color="gray">{'  '}no retained or background subagent tasks</Text> : null}
      {view.tasks.slice(0, 8).map(task => <InlineAgentTask key={`${task.sessionId}:${task.id}`} task={task} />)}
      {view.detail ? <InlineAgentDetail view={view} /> : null}
    </Box>
  )
}

function InlineAgentDefinition({ definition }: { definition: TuiAgentDefinitionRow }): React.ReactElement {
  return (
    <Text color="gray">
      {'  '}{definition.name} · {definition.source} · {definition.host ?? 'local'}{definition.background ? ' · background' : ''} · {(definition.allowedTools ?? []).join(', ') || 'no tools'}
    </Text>
  )
}

function InlineAgentTask({ task }: { task: TuiAgentTaskRow }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={task.status === 'running' ? 'cyan' : task.status === 'completed' ? 'green' : 'yellow'}>
          {'  '}{task.id.slice(0, 12).padEnd(12, ' ')}
        </Text>
        <Text>{task.agentName ?? 'subagent'}</Text>
        <Text color="gray"> · {task.status ?? 'unknown'} · /agents inspect {task.sessionId.slice(0, 8)} {task.id.slice(0, 8)}</Text>
      </Text>
      {task.outputSummary ? <Text color="gray">{'     '}{task.outputSummary.slice(0, 120)}</Text> : null}
      {task.worktreeDiff ? <Text color="gray">{'     '}worktree diff {task.worktreeDiff.status} · {task.worktreeDiff.filesChanged} files · +{task.worktreeDiff.additions} -{task.worktreeDiff.deletions}</Text> : null}
      {task.worktreeDiff?.sourceApply ? <Text color="gray">{'     '}source apply {task.worktreeDiff.sourceApply.status} · {task.worktreeDiff.sourceApply.filesChanged} files</Text> : null}
    </Box>
  )
}

function InlineAgentDetail({ view }: { view: TuiAgentView }): React.ReactElement {
  const detail = view.detail
  if (!detail) return <Box />
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text><Text color="cyan">agent     </Text>Task detail <Text color="gray">{detail.task.id}</Text></Text>
      <Text color="gray">{'  '}parent {detail.parentSessionId} · status {detail.task.status ?? 'unknown'} · transcript {detail.transcriptPath ?? 'missing'}</Text>
      {detail.permissionSummary ? <InlinePermissionSummary summary={detail.permissionSummary} /> : null}
      {detail.task.worktreeDiff ? <Text color="gray">{'  '}worktree diff {detail.task.worktreeDiff.status} · {detail.task.worktreeDiff.filesChanged} files · +{detail.task.worktreeDiff.additions} -{detail.task.worktreeDiff.deletions}{detail.task.worktreeDiff.patchPath ? ` · patch ${detail.task.worktreeDiff.patchPath}` : ''}</Text> : null}
      {detail.task.worktreeDiff?.sourceApply ? <Text color="gray">{'  '}source apply {detail.task.worktreeDiff.sourceApply.status} · {detail.task.worktreeDiff.sourceApply.filesChanged} files{detail.task.worktreeDiff.sourceApply.conflicts?.length ? ` · conflicts ${detail.task.worktreeDiff.sourceApply.conflicts.join(', ')}` : ''}</Text> : null}
      {detail.resumeResult ? <Text color="gray">{'  '}resume {detail.resumeResult.status}: {detail.resumeResult.finalMessage.slice(0, 120)}</Text> : null}
      {detail.stopResult ? <Text color={detail.stopResult.ok ? 'green' : 'yellow'}>{'  '}stop {detail.stopResult.ok ? 'ok' : 'unavailable'}: {detail.stopResult.message.slice(0, 120)}</Text> : null}
      {detail.applyResult ? <Text color={detail.applyResult.status === 'applied' || detail.applyResult.status === 'clean' ? 'green' : 'yellow'}>{'  '}apply {detail.applyResult.status}: {detail.applyResult.message.slice(0, 120)}</Text> : null}
      {detail.lifecycleEvents.slice(-6).map((event, index) => <Text color="gray" key={`lifecycle:${index}`}>{'  '}lifecycle {event}</Text>)}
      {detail.recentEvents.slice(-6).map((event, index) => <Text color="gray" key={`recent:${index}`}>{'  '}{event}</Text>)}
    </Box>
  )
}

function InlinePermissionSummary({ summary }: { summary: TuiPermissionOriginSummary }): React.ReactElement {
  if (summary.totalRequests === 0) {
    return <Text color="gray">{'  '}permissions none</Text>
  }
  const origins = summary.agents
    .map(agent => {
      const parent = agent.parentAgentId ? `<-${agent.parentAgentId}` : ''
      const tools = agent.tools.length ? ` · ${agent.tools.join(',')}` : ''
      return `${agent.agentRole}:${agent.agentId}${parent} ${agent.count}/${agent.allowed}/${agent.denied}${tools}`
    })
    .join('; ')
  const actions = summary.actions
    .map(action => `${action.action}:${action.count}`)
    .join(', ')
  const latest = summary.latest
    ? `${summary.latest.action} ${summary.latest.allowed ? 'allow' : 'deny'} ${summary.latest.subject}`
    : undefined
  return (
    <Box flexDirection="column">
      <Text color="gray">{'  '}permissions {summary.totalRequests} · allow {summary.allowed} · deny {summary.denied}{actions ? ` · ${actions}` : ''}</Text>
      {origins ? <Text color="gray">{'  '}origins {origins}</Text> : null}
      {latest ? <Text color="gray">{'  '}latest permission {latest}</Text> : null}
    </Box>
  )
}

function TimelineRow({ item }: { item: TuiTurnTimelineItem }): React.ReactElement {
  if (item.kind === 'assistant') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="green">Assistant</Text>
        <Box marginLeft={2}>
          <Markdown width={92}>{item.detail}</Markdown>
        </Box>
      </Box>
    )
  }
  if (item.kind === 'user') return <Text color="cyan">&gt; {item.detail.slice(0, 180)}</Text>
  if ((item.kind === 'tool' || item.kind === 'prompt' || item.kind === 'result') && !item.meta) {
    return (
      <Text>
        <Text color={timelineToneColor(item.tone)}>{timelineGlyph(item)} {item.label.padEnd(10, ' ')}</Text>
        <Text>{item.title}</Text>
        <Text color="gray">  {item.detail.slice(0, 96)}</Text>
      </Text>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text color={timelineToneColor(item.tone)}>{timelineGlyph(item)} {item.label.padEnd(10, ' ')}</Text>
        <Text>{item.title}</Text>
      </Text>
      <Text color="gray">  ⎿ {item.detail.slice(0, 140)}</Text>
      {item.meta ? <Text color="gray">    {item.meta.slice(0, 136)}</Text> : null}
      {item.activity?.detail ? <Text color="red">    {item.activity.detail.slice(0, 136)}</Text> : null}
    </Box>
  )
}

function timelineGlyph(item: TuiTurnTimelineItem): string {
  if (item.kind === 'tool' && item.activity?.status === 'running') return '●'
  if (item.tone === 'success') return '✓'
  if (item.tone === 'danger') return '✗'
  if (item.tone === 'warning') return '!'
  return '·'
}

function timelineToneColor(tone: TuiTurnTimelineTone): 'red' | 'yellow' | 'cyan' | 'green' | 'gray' {
  if (tone === 'danger') return 'red'
  if (tone === 'warning') return 'yellow'
  if (tone === 'active') return 'cyan'
  if (tone === 'success') return 'green'
  return 'gray'
}

function InlineSessionDetail({ detail }: { detail: TuiSessionDetail }): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text color="cyan">session   </Text>
        <Text>Session detail</Text>
        <Text color="gray">  {detail.session.sessionId}</Text>
      </Text>
      <Text color="gray">
        {'  '}status {detail.session.status} · result {detail.session.finalMessage ? 'recorded' : 'missing'} · handoff {detail.session.hasHandoffReport ? 'structured' : 'optional'} · events {detail.session.eventCount}
      </Text>
      {detail.recentEvents.slice(-8).map((event, index) => <Text color="gray" key={index}>{'  '}{event}</Text>)}
    </Box>
  )
}

function InlineDoctor({ doctor }: { doctor: Record<string, unknown> }): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text><Text color="cyan">doctor    </Text>Doctor</Text>
      {Object.entries(doctor).slice(0, 12).map(([key, value]) => (
        <Text key={key} color="gray">{'  '}{key}: {Array.isArray(value) ? value.join(', ') : String(value)}</Text>
      ))}
    </Box>
  )
}

function InlineSessions({
  rows,
  hiddenCount,
  headline,
}: {
  rows: TuiSessionRow[]
  hiddenCount: number
  headline: string
}): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text><Text color="cyan">sessions  </Text>{headline}</Text>
      {rows.length === 0 ? <Text color="gray">  no sessions yet; start with a prompt</Text> : null}
      {rows.map(row => <InlineSessionRow key={row.session.sessionId} row={row} />)}
      {hiddenCount > 0 ? <Text color="gray">  ... {hiddenCount} more; use /sessions or /open &lt;n&gt;</Text> : null}
    </Box>
  )
}

function InlineSessionRow({ row }: { row: TuiSessionRow }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={sessionToneColor(row.tone)}>{String(row.commandIndex).padStart(2, ' ')} {row.label.padEnd(9, ' ')}</Text>
        <Text>{row.title.slice(0, 72)}</Text>
        <Text color="gray">  {row.commandHint}</Text>
      </Text>
      <Text color="gray">{'   '}{row.meta}</Text>
      {row.context ? <Text color={row.needsAttention ? 'yellow' : 'gray'}>{'   '}{row.context.slice(0, 96)}</Text> : null}
    </Box>
  )
}

function sessionToneColor(tone: TuiSessionTone): 'red' | 'yellow' | 'cyan' | 'green' | 'gray' {
  if (tone === 'danger') return 'red'
  if (tone === 'warning') return 'yellow'
  if (tone === 'active') return 'cyan'
  if (tone === 'success') return 'green'
  return 'gray'
}
