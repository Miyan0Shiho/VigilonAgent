import React from 'react'
import { Box, Text } from 'ink'

export function Composer({
  status,
  input,
}: {
  status: string
  input: string
}): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text color="gray">{status}</Text>
      <Text>
        vigilon&gt; {input}
      </Text>
    </Box>
  )
}
