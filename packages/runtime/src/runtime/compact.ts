import type {
  CompactTrigger,
  RuntimeSessionState,
  TranscriptEvent,
  TranscriptStore,
} from './contracts.js'
import { createTimestamp } from './transcript.js'

export type CompactTranscriptOptions = {
  transcript: TranscriptStore
  summary: string
  trigger?: CompactTrigger
  userContext?: string
  sessionState?: RuntimeSessionState
  reactiveEventCount?: number
  strategy?: 'session-memory' | 'reactive' | 'legacy'
}

export async function compactTranscript(
  options: CompactTranscriptOptions,
): Promise<Extract<TranscriptEvent, { type: 'compact-boundary' }>> {
  const allEvents = await options.transcript.readAll()
  const reactiveEventCount = options.reactiveEventCount ?? 0
  const requestedSplitIndex =
    reactiveEventCount > 0
      ? Math.max(0, allEvents.length - reactiveEventCount)
      : allEvents.length
  const splitIndex =
    reactiveEventCount > 0
      ? adjustReactiveSplitIndex(allEvents, requestedSplitIndex)
      : allEvents.length
  const strategy =
    options.strategy ??
    (options.summary.trim()
      ? 'session-memory'
      : reactiveEventCount > 0
        ? 'reactive'
        : 'legacy')

  const eventsToSummarize = reactiveEventCount > 0
    ? allEvents.slice(0, splitIndex)
    : allEvents

  const lastBoundaryIndex = eventsToSummarize.findLastIndex(
    event => event.type === 'compact-boundary',
  )
  const messagesSummarized =
    lastBoundaryIndex === -1
      ? eventsToSummarize.length
      : Math.max(0, eventsToSummarize.length - lastBoundaryIndex - 1)

  const boundary: Extract<TranscriptEvent, { type: 'compact-boundary' }> = {
    type: 'compact-boundary',
    summary: options.summary,
    metadata: {
      phase: options.sessionState?.phase,
      permissionMode: options.sessionState?.permissionMode,
      prePlanPermissionMode: options.sessionState?.prePlanPermissionMode,
      trigger: options.trigger ?? 'manual',
      preEventCount: allEvents.length,
      messagesSummarized,
      userContext: options.userContext,
      discoveredToolNames: options.sessionState?.discoveredToolNames,
      toolReferenceDeltas: options.sessionState?.toolReferenceDeltas,
      todos: options.sessionState?.todos,
      approvedPlan: options.sessionState?.approvedPlan,
      pendingPlan: options.sessionState?.pendingPlan,
      verificationNotes: options.sessionState?.verificationNotes,
      mcpInstructions: options.sessionState?.mcpInstructions,
      activeSkill: options.sessionState?.activeSkill,
      memoryFreshness: options.sessionState?.memoryFreshness,
      systemPrompt: options.sessionState?.systemPrompt,
      toolSchema: options.sessionState?.toolSchema,
      modelParams: {
        ...options.sessionState?.modelParams,
        compactStrategy: strategy,
      },
    },
    timestamp: createTimestamp(),
  }

  if (
    reactiveEventCount > 0 &&
    splitIndex > 0 &&
    splitIndex < allEvents.length
  ) {
    // Insert boundary BEFORE the reactive events
    const head = allEvents.slice(0, splitIndex)
    const tail = allEvents.slice(splitIndex)
    await options.transcript.replace([...head, boundary, ...tail])
  } else {
    await options.transcript.append(boundary)
  }

  return boundary
}

export function shouldAutoCompactTranscript(
  events: readonly TranscriptEvent[],
  options: {
    threshold: number
  },
): boolean {
  const lastBoundaryIndex = events.findLastIndex(
    event => event.type === 'compact-boundary',
  )
  const eventsSinceLastBoundary =
    lastBoundaryIndex === -1
      ? events.length
      : events.length - lastBoundaryIndex - 1
  return eventsSinceLastBoundary > options.threshold
}

function adjustReactiveSplitIndex(
  events: readonly TranscriptEvent[],
  requestedSplitIndex: number,
): number {
  let splitIndex = requestedSplitIndex
  while (splitIndex > 0) {
    const crossingAssistantIndex = findCrossingAssistantIndex(events, splitIndex)
    if (crossingAssistantIndex === -1 || crossingAssistantIndex >= splitIndex) {
      return splitIndex
    }
    splitIndex = crossingAssistantIndex
  }
  return splitIndex
}

function findCrossingAssistantIndex(
  events: readonly TranscriptEvent[],
  splitIndex: number,
): number {
  const tailToolCallIds = new Set<string>()
  for (const event of events.slice(splitIndex)) {
    if (event.type === 'tool-call') tailToolCallIds.add(event.call.id)
    if (event.type === 'tool-result') tailToolCallIds.add(event.result.toolCallId)
  }
  if (tailToolCallIds.size === 0) return -1

  for (let index = splitIndex - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (
      event.type === 'assistant' &&
      event.toolCalls?.some(call => tailToolCallIds.has(call.id))
    ) {
      return index
    }
  }
  return -1
}
