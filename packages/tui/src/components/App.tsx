import React from 'react'
import { Box, Text } from 'ink'
import type { TuiRuntimeEvent, TuiSessionSummary } from '../runtime/types.js'
import { MessageStream } from './MessageStream.js'
import { SessionPanel } from './SessionPanel.js'
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
  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
        <Text bold>Vigilon Operator Shell</Text>
        <Text color="gray">
          cwd={props.cwd} permission={props.permissionMode ?? 'ask'} model={props.model ?? 'deepseek-v4-flash'}
        </Text>
      </Box>
      <Box marginTop={1}>
        <SessionPanel sessions={props.sessions} />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <MessageStream events={props.events} />
      </Box>
      <Box marginTop={1}>
        <Composer status={props.status} input={props.input} />
      </Box>
    </Box>
  )
}
