import type { ContentReplacementRecord, TranscriptEvent } from './contracts.js'

export const DEFAULT_TOOL_RESULT_REPLACEMENT_LIMIT = 20_000

export type ModelContextOptions = {
  toolResultReplacementLimit?: number
}

export type ModelContextWindow = {
  events: TranscriptEvent[]
  compacted: boolean
  compactBoundaryIndex?: number
  droppedEventCount: number
  newContentReplacements: ContentReplacementRecord[]
}

export function buildModelContextWindow(
  events: readonly TranscriptEvent[],
  options: ModelContextOptions = {},
): ModelContextWindow {
  const compactBoundaryIndex = events.findLastIndex(
    event => event.type === 'compact-boundary',
  )
  const existingReplacements = collectContentReplacements(events)
  if (compactBoundaryIndex === -1) {
    const { events: windowEvents, newContentReplacements } =
      applyToolResultReplacements([...events], existingReplacements, options)
    return {
      events: windowEvents,
      compacted: false,
      droppedEventCount: 0,
      newContentReplacements,
    }
  }

  const window = trimOrphanToolResults(events.slice(compactBoundaryIndex))
  const { events: windowEvents, newContentReplacements } =
    applyToolResultReplacements(window, existingReplacements, options)
  return {
    events: windowEvents,
    compacted: true,
    compactBoundaryIndex,
    droppedEventCount: compactBoundaryIndex,
    newContentReplacements,
  }
}

function trimOrphanToolResults(events: TranscriptEvent[]): TranscriptEvent[] {
  const seenToolCalls = new Set<string>()
  const trimmed: TranscriptEvent[] = []

  for (const event of events) {
    if (event.type === 'tool-call') {
      if (seenToolCalls.has(event.call.id)) {
        trimmed.push(event)
      }
      continue
    }

    if (event.type === 'assistant') {
      for (const call of event.toolCalls ?? []) {
        seenToolCalls.add(call.id)
      }
      trimmed.push(event)
      continue
    }

    if (event.type === 'tool-result') {
      if (seenToolCalls.has(event.result.toolCallId)) {
        trimmed.push(event)
      }
      continue
    }

    trimmed.push(event)
  }

  return trimmed
}

function applyToolResultReplacements(
  events: TranscriptEvent[],
  existingReplacements: ReadonlyMap<string, string>,
  options: ModelContextOptions,
): {
  events: TranscriptEvent[]
  newContentReplacements: ContentReplacementRecord[]
} {
  const maxChars =
    options.toolResultReplacementLimit ?? DEFAULT_TOOL_RESULT_REPLACEMENT_LIMIT
  const newContentReplacements: ContentReplacementRecord[] = []
  const windowEvents: TranscriptEvent[] = []

  for (const event of events) {
    if (event.type === 'content-replacement') continue
    if (event.type !== 'tool-result') {
      windowEvents.push(event)
      continue
    }

    const existing = existingReplacements.get(event.result.toolCallId)
    if (existing) {
      windowEvents.push(replaceToolResultContent(event, existing))
      continue
    }

    if (event.result.content.length > maxChars) {
      const replacement = buildToolResultReplacement(
        event.result.toolCallId,
        event.result.content,
        maxChars,
      )
      newContentReplacements.push({
        kind: 'tool-result',
        toolCallId: event.result.toolCallId,
        replacement,
      })
      windowEvents.push(replaceToolResultContent(event, replacement))
      continue
    }

    windowEvents.push(event)
  }

  return { events: windowEvents, newContentReplacements }
}

function collectContentReplacements(
  events: readonly TranscriptEvent[],
): Map<string, string> {
  const replacements = new Map<string, string>()
  for (const event of events) {
    if (event.type !== 'content-replacement') continue
    for (const replacement of event.replacements) {
      if (replacement.kind === 'tool-result') {
        replacements.set(replacement.toolCallId, replacement.replacement)
      }
    }
  }
  return replacements
}

function replaceToolResultContent(
  event: Extract<TranscriptEvent, { type: 'tool-result' }>,
  content: string,
): TranscriptEvent {
  return {
    ...event,
    result: {
      ...event.result,
      content,
    },
  }
}

function buildToolResultReplacement(
  toolCallId: string,
  content: string,
  maxChars: number,
): string {
  const previewChars = Math.max(0, Math.min(maxChars, 2_000))
  const preview = content.slice(0, previewChars)
  const omittedChars = Math.max(0, content.length - preview.length)
  return [
    `<vigilon_tool_result_replaced tool_call_id="${escapeAttribute(toolCallId)}" original_chars="${content.length}" omitted_chars="${omittedChars}">`,
    preview,
    '</vigilon_tool_result_replaced>',
  ].join('\n')
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}
