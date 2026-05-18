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
}

export async function compactTranscript(
  options: CompactTranscriptOptions,
): Promise<Extract<TranscriptEvent, { type: 'compact-boundary' }>> {
  const allEvents = await options.transcript.readAll()
  
  const reactiveEventCount = options.reactiveEventCount ?? 0
  const eventsToSummarize = reactiveEventCount > 0 
    ? allEvents.slice(0, -reactiveEventCount)
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
      todos: options.sessionState?.todos,
      approvedPlan: options.sessionState?.approvedPlan,
      pendingPlan: options.sessionState?.pendingPlan,
      verificationNotes: options.sessionState?.verificationNotes,
      mcpInstructions: options.sessionState?.mcpInstructions,
      memoryFreshness: options.sessionState?.memoryFreshness,
    },
    timestamp: createTimestamp(),
  }

  if (reactiveEventCount > 0 && reactiveEventCount < allEvents.length) {
    // Insert boundary BEFORE the reactive events
    const head = allEvents.slice(0, -reactiveEventCount)
    const tail = allEvents.slice(-reactiveEventCount)
    await options.transcript.replace([...head, boundary, ...tail])
  } else {
    await options.transcript.append(boundary)
  }

  return boundary
}
