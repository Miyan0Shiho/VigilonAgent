import React from 'react'
import { Box, Text } from 'ink'
import type { PendingPrompt } from '../runtime/lineReader.js'
import type { TuiRuntimeEvent, TuiSessionDetail, TuiSessionSummary } from '../runtime/types.js'
import { buildSessionViewModel, type TuiSessionRow, type TuiSessionTone } from '../runtime/sessionView.js'
import { buildTurnViewModel, type TuiTurnTimelineItem, type TuiTurnTimelineTone } from '../runtime/turnView.js'
import { Markdown } from './Markdown.js'

export function MessageStream({
  events,
  detailMode,
  sessions = [],
  showSessions = false,
  sessionDetail = null,
  doctor = null,
  pendingPrompt = null,
}: {
  events: TuiRuntimeEvent[]
  detailMode: boolean
  sessions?: TuiSessionSummary[]
  showSessions?: boolean
  sessionDetail?: TuiSessionDetail | null
  doctor?: Record<string, unknown> | null
  pendingPrompt?: PendingPrompt | null
}): React.ReactElement {
  const model = buildTurnViewModel(events, {
    detailMode,
    activePromptKind: pendingPrompt?.request?.kind,
  })
  const { overview } = model
  const sessionModel = buildSessionViewModel(sessions, { limit: 8 })
  const hasInlinePayload = Boolean(sessionDetail || doctor || showSessions)
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
      {doctor ? <InlineDoctor doctor={doctor} /> : null}
      {showSessions ? <InlineSessions rows={sessionModel.visibleRows} hiddenCount={sessionModel.hiddenCount} headline={sessionModel.headline} /> : null}
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
