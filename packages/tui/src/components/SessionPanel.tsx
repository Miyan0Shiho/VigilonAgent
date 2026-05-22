import React from 'react'
import { Box, Text } from 'ink'
import type { TuiSessionSummary } from '../runtime/types.js'
import { buildSessionViewModel, type TuiSessionRow, type TuiSessionTone } from '../runtime/sessionView.js'

export function SessionPanel({ sessions }: { sessions: TuiSessionSummary[] }): React.ReactElement {
  const model = buildSessionViewModel(sessions, { limit: 8 })

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold>Sessions</Text>
        <Text color={model.attentionCount > 0 ? 'yellow' : 'gray'}>{model.headline}</Text>
      </Box>
      {sessions.length === 0 ? (
        <Text color="gray">no sessions yet; start with a prompt</Text>
      ) : (
        model.visibleRows.map((row, index) => <SessionRow key={row.session.sessionId} visualIndex={index} row={row} />)
      )}
      {model.hiddenCount > 0 ? (
        <Text color="gray">... {model.hiddenCount} more; use /sessions or /open &lt;n&gt;</Text>
      ) : null}
    </Box>
  )
}

function SessionRow({
  visualIndex,
  row,
}: {
  visualIndex: number
  row: TuiSessionRow
}): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={visualIndex === 0 ? 0 : 1}>
      <Box>
        <Text color={sessionToneColor(row.tone)}>{String(row.commandIndex).padStart(2, ' ')} {row.label.padEnd(9, ' ')}</Text>
        <Text> {row.title.slice(0, 72)}</Text>
        <Text color="gray">  {row.commandHint}</Text>
      </Box>
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
