import React from 'react'
import { Box, Text } from 'ink'
import type { TuiSessionSummary } from '../runtime/types.js'

export function SessionPanel({ sessions }: { sessions: TuiSessionSummary[] }): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>Sessions / tasks</Text>
      {sessions.length === 0 ? (
        <Text color="gray">no sessions yet</Text>
      ) : (
        sessions.slice(0, 8).map((session, index) => (
          <Text key={session.sessionId}>
            {String(index + 1).padStart(2, ' ')} {session.status.padEnd(16, ' ')}{' '}
            {(session.title ?? session.sessionId).slice(0, 72)} todos=
            {session.completedTodoCount}/{session.completedTodoCount + session.remainingTodoCount}{' '}
            handoff={session.hasHandoffReport ? 'yes' : 'no'}
          </Text>
        ))
      )}
    </Box>
  )
}
