import React from 'react'
import { Box, Text } from 'ink'
import type { TuiCommandDefinition } from '../runtime/commandCatalog.js'
import type { PendingPrompt } from '../runtime/lineReader.js'
import type { TuiOperatorViewModel } from '../runtime/operatorView.js'
import { splitPromptAtCursor, type PromptBufferState } from '../runtime/promptBuffer.js'
import type { TuiSessionTone } from '../runtime/sessionView.js'
import { displayToolName } from '../runtime/turnView.js'

export function Composer({
  operator,
  input,
  suggestions,
  pendingPrompt,
  environment,
}: {
  operator: TuiOperatorViewModel
  input: PromptBufferState
  suggestions: readonly TuiCommandDefinition[]
  pendingPrompt: PendingPrompt | null
  environment?: string
}): React.ReactElement {
  const accent = toneColor(operator.tone)
  const segments = splitPromptAtCursor(input)

  return (
    <Box flexDirection="column" marginTop={1}>
      {pendingPrompt?.request ? (
        <OperatorPrompt pendingPrompt={pendingPrompt} accent={accent} />
      ) : null}
      {!pendingPrompt ? <ActiveToolStatus operator={operator} /> : null}
      <Box borderStyle="round" borderColor={accent} borderLeft={false} borderRight={false} borderBottom={false} paddingX={1}>
        <Text>
          <Text color={accent}>vigilon</Text> › {segments.before}
          <Text inverse>{segments.cursorText}</Text>
          {segments.after}
        </Text>
      </Box>
      <Text color="gray">
        {formatComposerFooter(operator, environment)}
      </Text>
      {suggestions.length > 0 ? (
        <Box flexDirection="column">
          {suggestions.slice(0, 5).map((suggestion, index) => (
            <Text key={suggestion.name} color={index === 0 ? accent : 'gray'}>
              {index === 0 ? '❯' : ' '} {suggestion.usage.padEnd(36, ' ')} {suggestion.summary}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}

function formatComposerFooter(operator: TuiOperatorViewModel, environment?: string): string {
  if (operator.mode === 'ready' || operator.mode === 'attention') {
    return [environment, operator.commandHint].filter(Boolean).join(' · ')
  }
  return [operator.composerHint, environment, operator.commandHint].filter(Boolean).join(' · ')
}

function ActiveToolStatus({
  operator,
}: {
  operator: TuiOperatorViewModel
}): React.ReactElement | null {
  const latest = operator.turn.toolSummary?.latest
  if (operator.mode !== 'working' || latest?.status !== 'running') return null
  return (
    <Text color="gray">
      <Text color="cyan">● </Text>
      running {displayToolName(latest.name)}
      {latest.summary ? ` · ${latest.summary.slice(0, 96)}` : ''}
    </Text>
  )
}

function OperatorPrompt({
  pendingPrompt,
  accent,
}: {
  pendingPrompt: PendingPrompt
  accent: ReturnType<typeof toneColor>
}): React.ReactElement | null {
  if (!pendingPrompt.request) return null
  const choices = pendingPrompt.request.choices ?? []
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Text>
        <Text color={accent}>{pendingPrompt.request.kind === 'permission' ? 'permission' : 'question'} </Text>
        <Text bold>{pendingPrompt.request.title}</Text>
      </Text>
      {pendingPrompt.request.lines.slice(1, 5).map(line => (
        <Text key={line} color="gray">  {line}</Text>
      ))}
      {choices.map((choice, index) => (
        <Text key={choice.key} color={index === 0 ? accent : 'gray'}>
          {index === 0 ? '❯' : ' '} {choice.key}. {choice.label}
          {choice.description ? <Text color="gray"> - {choice.description}</Text> : null}
        </Text>
      ))}
    </Box>
  )
}

function toneColor(tone: TuiSessionTone): 'red' | 'yellow' | 'cyan' | 'green' | 'gray' {
  if (tone === 'danger') return 'red'
  if (tone === 'warning') return 'yellow'
  if (tone === 'active') return 'cyan'
  if (tone === 'success') return 'green'
  return 'gray'
}
