import { createHash, randomUUID } from 'node:crypto'
import type {
  RuntimeProjectConfig,
  RuntimeSkill,
  Tool,
  TranscriptEvent,
} from './contracts.js'

type LlmRequestEvent = Extract<TranscriptEvent, { type: 'llm-request' }>
type LlmResponseEvent = Extract<TranscriptEvent, { type: 'llm-response' }>

export function filterModelVisibleEvents(
  events: readonly TranscriptEvent[],
): TranscriptEvent[] {
  return events.filter(
    event =>
      event.type !== 'llm-request' &&
      event.type !== 'llm-response' &&
      event.type !== 'request-stability',
  )
}

export function buildLlmRequestEvent(options: {
  events: readonly TranscriptEvent[]
  visibleEvents: readonly TranscriptEvent[]
  tools: readonly Tool[]
  model: string
  compacted: boolean
  compactBoundaryIndex?: number
  droppedEventCount: number
  projectConfig?: RuntimeProjectConfig
  skills?: readonly RuntimeSkill[]
  timestamp: string
}): LlmRequestEvent {
  const previousRequest = findLastLlmRequestEvent(options.events)
  const replacements = options.events.filter(
    event => event.type === 'content-replacement',
  )
  const contentReplacementCount = replacements.reduce(
    (count, event) => count + event.replacements.length,
    0,
  )
  const contentReplacementChars = replacements.reduce((count, event) => {
    return (
      count +
      event.replacements.reduce((replacementCount, replacement) => {
        return replacementCount + replacement.replacement.length
      }, 0)
    )
  }, 0)

  return {
    type: 'llm-request',
    requestId: randomUUID(),
    previousRequestId: previousRequest?.requestId ?? null,
    model: options.model,
    toolCount: options.tools.length,
    toolSchemaHash: hashValue(
      options.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputJsonSchema: tool.inputJsonSchema,
        readOnly: tool.readOnly ?? false,
      })),
    ),
    messageCount: options.visibleEvents.length,
    modelVisibleEventCount: options.visibleEvents.length,
    compacted: options.compacted,
    ...(options.compactBoundaryIndex !== undefined
      ? { compactBoundaryIndex: options.compactBoundaryIndex }
      : {}),
    droppedEventCount: options.droppedEventCount,
    contentReplacementCount,
    contentReplacementChars,
    projectConfigHash: options.projectConfig
      ? hashValue(options.projectConfig)
      : null,
    skillListingHash:
      options.skills && options.skills.length > 0
        ? hashValue(
            options.skills.map(skill => ({
              name: skill.name,
              description: skill.description,
              source: skill.source,
            })),
          )
        : null,
    timestamp: options.timestamp,
  }
}

export function buildLlmResponseEvent(options: {
  request: LlmRequestEvent
  stopReason: LlmResponseEvent['stopReason']
  inputTokens?: number
  outputTokens?: number
  durationMs: number
  toolCallCount: number
  assistantChars: number
  reasoningChars?: number
  errorMessage?: string
  timestamp: string
}): LlmResponseEvent {
  return {
    type: 'llm-response',
    requestId: options.request.requestId,
    previousRequestId: options.request.previousRequestId,
    status: options.stopReason === 'error' ? 'error' : 'ok',
    stopReason: options.stopReason,
    ...(options.inputTokens !== undefined
      ? { inputTokens: options.inputTokens }
      : {}),
    ...(options.outputTokens !== undefined
      ? { outputTokens: options.outputTokens }
      : {}),
    durationMs: options.durationMs,
    toolCallCount: options.toolCallCount,
    assistantChars: options.assistantChars,
    ...(options.reasoningChars !== undefined
      ? { reasoningChars: options.reasoningChars }
      : {}),
    ...(options.errorMessage ? { errorMessage: options.errorMessage } : {}),
    timestamp: options.timestamp,
  }
}

export function buildRequestStabilityEvent(options: {
  events: readonly TranscriptEvent[]
  currentRequest: LlmRequestEvent
  currentResponse: LlmResponseEvent
  timestamp: string
}): Extract<TranscriptEvent, { type: 'request-stability' }> | null {
  const previousRequest = findPreviousLlmRequestEvent(
    options.events,
    options.currentRequest.requestId,
  )
  if (!previousRequest) return null
  const previousResponse = findLlmResponseByRequestId(
    options.events,
    previousRequest.requestId,
  )

  const toolSchemaChanged =
    previousRequest.toolSchemaHash !== options.currentRequest.toolSchemaHash
  const modelChanged = previousRequest.model !== options.currentRequest.model
  const projectConfigChanged =
    previousRequest.projectConfigHash !== options.currentRequest.projectConfigHash
  const skillListingChanged =
    previousRequest.skillListingHash !== options.currentRequest.skillListingHash
  const compactionChanged =
    previousRequest.compacted !== options.currentRequest.compacted ||
    previousRequest.compactBoundaryIndex !== options.currentRequest.compactBoundaryIndex ||
    previousRequest.droppedEventCount !== options.currentRequest.droppedEventCount
  const contentReplacementChanged =
    previousRequest.contentReplacementCount !==
      options.currentRequest.contentReplacementCount ||
    previousRequest.contentReplacementChars !==
      options.currentRequest.contentReplacementChars

  const reasons: string[] = []
  if (toolSchemaChanged) reasons.push('tool_schema_changed')
  if (modelChanged) reasons.push('model_changed')
  if (projectConfigChanged) reasons.push('project_config_changed')
  if (skillListingChanged) reasons.push('skill_listing_changed')
  if (compactionChanged) reasons.push('compact_boundary_moved')
  if (contentReplacementChanged) reasons.push('content_replacement_changed')

  let inputTokensDelta: number | undefined
  let inputTokensDeltaRatio: number | undefined
  if (
    previousResponse?.inputTokens !== undefined &&
    options.currentResponse.inputTokens !== undefined
  ) {
    inputTokensDelta =
      options.currentResponse.inputTokens - previousResponse.inputTokens
    inputTokensDeltaRatio =
      previousResponse.inputTokens === 0
        ? undefined
        : Math.abs(inputTokensDelta) / previousResponse.inputTokens
    if (
      reasons.length === 0 &&
      Math.abs(inputTokensDelta) >= 1_000 &&
      (inputTokensDeltaRatio ?? 0) >= 0.2
    ) {
      reasons.push('input_tokens_shift_without_shape_change')
    }
  }

  if (reasons.length === 0) return null
  const classification =
    compactionChanged || contentReplacementChanged
      ? 'expected_reset'
      : reasons.includes('input_tokens_shift_without_shape_change')
        ? 'unexpected_change'
        : 'expected_change'

  return {
    type: 'request-stability',
    requestId: options.currentRequest.requestId,
    previousRequestId: previousRequest.requestId,
    classification,
    reasons,
    ...(inputTokensDelta !== undefined ? { inputTokensDelta } : {}),
    ...(inputTokensDeltaRatio !== undefined ? { inputTokensDeltaRatio } : {}),
    toolSchemaChanged,
    modelChanged,
    projectConfigChanged,
    skillListingChanged,
    compactionChanged,
    contentReplacementChanged,
    timestamp: options.timestamp,
  }
}

function findLastLlmRequestEvent(
  events: readonly TranscriptEvent[],
): LlmRequestEvent | undefined {
  return [...events].reverse().find(
    (event): event is LlmRequestEvent => event.type === 'llm-request',
  )
}

function findPreviousLlmRequestEvent(
  events: readonly TranscriptEvent[],
  requestId: string,
): LlmRequestEvent | undefined {
  let seenCurrent = false
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type !== 'llm-request') continue
    if (event.requestId === requestId) {
      seenCurrent = true
      continue
    }
    if (seenCurrent) return event
  }
  return undefined
}

function findLlmResponseByRequestId(
  events: readonly TranscriptEvent[],
  requestId: string,
): LlmResponseEvent | undefined {
  return [...events].reverse().find(
    (event): event is LlmResponseEvent =>
      event.type === 'llm-response' && event.requestId === requestId,
  )
}

function hashValue(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`
  }
  const objectValue = value as Record<string, unknown>
  const entries = Object.keys(objectValue)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
  return `{${entries.join(',')}}`
}
