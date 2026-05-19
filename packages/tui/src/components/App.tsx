import React from 'react'
import { Box, Text } from 'ink'
import type { TuiRuntimeEvent, TuiSessionSummary } from '../runtime/types.js'
import { buildOperatorViewModel } from '../runtime/operatorView.js'
import { replacePromptBuffer } from '../runtime/promptBuffer.js'
import { MessageStream } from './MessageStream.js'
import { Composer } from './Composer.js'

export function App(props: {
  cwd: string
  sessionsDir?: string
  permissionMode?: string
  model?: string
  sessions: TuiSessionSummary[]
  events: TuiRuntimeEvent[]
  status: string
  input: string
}): React.ReactElement {
  const operator = buildOperatorViewModel({
    sessions: props.sessions,
    events: props.events,
    status: props.status,
    running: props.status.startsWith('running'),
    inputValue: props.input,
  })

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text>
          <Text bold>✳ Vigilon Operator Shell</Text>
          <Text color="gray"> · {operator.headline}</Text>
        </Text>
        <Text color="gray">{operator.title}</Text>
      </Box>
      <Box flexDirection="column">
        <MessageStream
          events={props.events}
          detailMode={false}
          sessions={props.sessions}
          showSessions={operator.sessions.attentionCount > 0}
        />
      </Box>
      <Box marginTop={1}>
        <Composer
          operator={operator}
          input={replacePromptBuffer(props.input)}
          suggestions={[]}
          pendingPrompt={null}
          environment={`${props.model ?? 'deepseek-v4-flash'} · ${props.permissionMode ?? 'ask'} · cwd ${basename(props.cwd)}`}
        />
      </Box>
    </Box>
  )
}

function basename(path: string): string {
  const normalized = path.replace(/\/+$/, '')
  return normalized.split('/').filter(Boolean).at(-1) ?? path
}
