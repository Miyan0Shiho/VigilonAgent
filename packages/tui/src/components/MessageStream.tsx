import React from 'react'
import { Box, Text } from 'ink'
import type { TuiRuntimeEvent } from '../runtime/types.js'

export function MessageStream({ events }: { events: TuiRuntimeEvent[] }): React.ReactElement {
  const summary = summarizeEvents(events)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>Current turn</Text>
      <Text color={summary.needsAttention ? 'yellow' : 'gray'}>
        {summary.status}
      </Text>
      {events.length === 0 ? <Text color="gray">no active messages</Text> : null}
      {events.slice(-24).map((event, index) => (
        <Message event={event} key={index} />
      ))}
    </Box>
  )
}

function Message({ event }: { event: TuiRuntimeEvent }): React.ReactElement {
  if (event.type === 'tool') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>
          {event.activity.status === 'running' ? '●' : event.activity.status === 'ok' ? '✓' : '✗'}{' '}
          <Text bold>{event.activity.name}</Text> {event.activity.status}
        </Text>
        <Text color="gray">  ⎿ {event.activity.summary.slice(0, 96)}</Text>
      </Box>
    )
  }
  if (event.type === 'handoff') {
    return (
      <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor={event.handoff.missing ? 'yellow' : 'green'} paddingX={1}>
        <Text bold>Result handoff {event.handoff.status}{event.handoff.missing ? ' ResultReport missing' : ''}</Text>
        <Text>{event.handoff.finalMessage.slice(0, 96)}</Text>
        <Text color="gray">transcript {event.handoff.transcriptPath}</Text>
      </Box>
    )
  }
  if (event.type === 'permission' || event.type === 'ask-user' || event.type === 'hook') {
    return (
      <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={event.type === 'permission' ? 'yellow' : 'cyan'} paddingX={1}>
        <Text bold>{event.type}</Text>
        {event.lines.slice(0, 8).map((line, index) => <Text key={index}>{line.slice(0, 120)}</Text>)}
      </Box>
    )
  }
  if (event.type === 'assistant') {
    return (
      <Box flexDirection="column" marginTop={1}>
        {event.reasoning ? <Text color="gray">✻ {event.reasoning.slice(0, 120)}</Text> : null}
        <Text>  {event.content.slice(0, 120)}</Text>
      </Box>
    )
  }
  if (event.type === 'user') {
    return <Text color="cyan">&gt; {event.content.slice(0, 120)}</Text>
  }
  return <Text color="gray">✻ {'content' in event ? String(event.content).slice(0, 120) : ''}</Text>
}

function summarizeEvents(events: TuiRuntimeEvent[]): {
  status: string
  needsAttention: boolean
} {
  if (events.length === 0) {
    return {
      status: 'idle - no task evidence yet',
      needsAttention: false,
    }
  }
  const latest = events.at(-1)
  const errors = events.filter(
    event =>
      event.type === 'error' ||
      (event.type === 'tool' && event.activity.status === 'error'),
  ).length
  const runningTool = [...events]
    .reverse()
    .find(
      event => event.type === 'tool' && event.activity.status === 'running',
    )
  const handoff = [...events].reverse().find(event => event.type === 'handoff')
  if (handoff?.type === 'handoff') {
    return {
      status: `handoff ${handoff.handoff.status}${handoff.handoff.missing ? ' - ResultReport missing' : ''}; errors=${errors}`,
      needsAttention: handoff.handoff.missing || errors > 0,
    }
  }
  if (latest?.type === 'permission') {
    return {
      status: `waiting for permission; errors=${errors}`,
      needsAttention: true,
    }
  }
  if (latest?.type === 'ask-user') {
    return {
      status: `waiting for user answer; errors=${errors}`,
      needsAttention: true,
    }
  }
  if (runningTool?.type === 'tool') {
    return {
      status: `running ${runningTool.activity.name}; errors=${errors}`,
      needsAttention: errors > 0,
    }
  }
  return {
    status: `events=${events.length}; errors=${errors}`,
    needsAttention: errors > 0,
  }
}
