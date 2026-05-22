import { createHash } from 'node:crypto'
import type {
  CompactContextWindowBudgetMetadata,
  CompactTokenEstimatorMetadata,
  CompactTokenPreflightMetadata,
  CompactQuerySource,
  CompactPreservedEventRefMetadata,
  CompactMemoryReadinessMetadata,
  CompactRouteMetadata,
  CompactStrategy,
  CompactTokenPressureMetadata,
  CompactTrigger,
  PostCompactCleanupMetadata,
  RuntimeSessionState,
  TranscriptEvent,
  TranscriptStore,
} from './contracts.js'
import { createPostCompactStateRegistry } from './postCompactStateRegistry.js'
import { createTimestamp } from './transcript.js'

const DEFAULT_MAX_AUTOCOMPACT_FAILURES = 3
const DEFAULT_TOKEN_PRESSURE_THRESHOLD = 0.85
const ESTIMATED_CHARS_PER_TOKEN = 4
const DEFAULT_RESERVED_OUTPUT_TOKENS = 4_096
const DEFAULT_RESERVED_SYSTEM_TOKENS = 2_048
const DEFAULT_RESERVED_TOOL_SCHEMA_TOKENS = 2_048
const DEFAULT_SAFETY_MARGIN_TOKENS = 1_024

export type CompactTranscriptOptions = {
  transcript: TranscriptStore
  summary: string
  trigger?: CompactTrigger
  querySource?: CompactQuerySource
  userContext?: string
  sessionState?: RuntimeSessionState
  reactiveEventCount?: number
  strategy?: CompactStrategy
  tokenPressure?: CompactTokenPressureMetadata
  memoryReadiness?: CompactMemoryReadinessMetadata
  cleanupState?: PostCompactCleanupState
}

export type PostCompactCleanupState = {
  lspOpenFileState?: Set<string>
  readFileState?: Map<unknown, unknown>
}

export type AutoCompactEvaluation = {
  shouldCompact: boolean
  reason: string
  querySource: CompactQuerySource
  eventsSinceLastBoundary: number
  threshold: number
  tokenPressure?: CompactTokenPressureMetadata
  consecutiveFailures: number
  maxConsecutiveFailures: number
}

export function evaluateAutoCompactTranscript(
  events: readonly TranscriptEvent[],
  options: {
    threshold: number
    querySource?: CompactQuerySource
    consecutiveFailures?: number
    maxConsecutiveFailures?: number
    tokenBudget?: number
    contextBudget?: CompactContextWindowBudgetMetadata
    modelId?: string
    provider?: string
    budgetSource?: CompactContextWindowBudgetMetadata['source']
    contextWindowTokens?: number
    reservedOutputTokens?: number
    reservedSystemTokens?: number
    reservedToolSchemaTokens?: number
    safetyMarginTokens?: number
    pressureThreshold?: number
    tokenPreflight?: CompactTokenPreflightMetadata
  },
): AutoCompactEvaluation {
  const querySource = options.querySource ?? 'main'
  const consecutiveFailures = options.consecutiveFailures ?? 0
  const maxConsecutiveFailures =
    options.maxConsecutiveFailures ?? DEFAULT_MAX_AUTOCOMPACT_FAILURES
  const lastBoundaryIndex = events.findLastIndex(
    event => event.type === 'compact-boundary',
  )
  const eventsSinceLastBoundary =
    lastBoundaryIndex === -1
      ? events.length
      : events.length - lastBoundaryIndex - 1
  const eventsToMeasure =
    lastBoundaryIndex === -1 ? events : events.slice(lastBoundaryIndex + 1)
  const tokenPressure =
    options.contextBudget ||
    (options.tokenBudget && options.tokenBudget > 0) ||
    (options.contextWindowTokens && options.contextWindowTokens > 0)
      ? estimateCompactTokenPressure(eventsToMeasure, {
          tokenBudget: options.tokenBudget,
          contextBudget: options.contextBudget,
          modelId: options.modelId,
          provider: options.provider,
          budgetSource: options.budgetSource,
          contextWindowTokens: options.contextWindowTokens,
          reservedOutputTokens: options.reservedOutputTokens,
          reservedSystemTokens: options.reservedSystemTokens,
          reservedToolSchemaTokens: options.reservedToolSchemaTokens,
          safetyMarginTokens: options.safetyMarginTokens,
          pressureThreshold:
            options.pressureThreshold ?? DEFAULT_TOKEN_PRESSURE_THRESHOLD,
          tokenPreflight: options.tokenPreflight,
        })
      : undefined

  if (querySource === 'compact' || querySource === 'session_memory') {
    return {
      shouldCompact: false,
      reason: `query_source_${querySource}_blocked`,
      querySource,
      eventsSinceLastBoundary,
      threshold: options.threshold,
      ...(tokenPressure ? { tokenPressure } : {}),
      consecutiveFailures,
      maxConsecutiveFailures,
    }
  }
  if (consecutiveFailures >= maxConsecutiveFailures) {
    return {
      shouldCompact: false,
      reason: 'consecutive_failure_circuit_open',
      querySource,
      eventsSinceLastBoundary,
      threshold: options.threshold,
      ...(tokenPressure ? { tokenPressure } : {}),
      consecutiveFailures,
      maxConsecutiveFailures,
    }
  }
  if (tokenPressure?.reason === 'token_pressure_exceeded') {
    return {
      shouldCompact: true,
      reason: 'token_pressure_exceeded',
      querySource,
      eventsSinceLastBoundary,
      threshold: options.threshold,
      tokenPressure,
      consecutiveFailures,
      maxConsecutiveFailures,
    }
  }
  if (eventsSinceLastBoundary <= options.threshold) {
    return {
      shouldCompact: false,
      reason: 'below_threshold',
      querySource,
      eventsSinceLastBoundary,
      threshold: options.threshold,
      ...(tokenPressure ? { tokenPressure } : {}),
      consecutiveFailures,
      maxConsecutiveFailures,
    }
  }
  return {
    shouldCompact: true,
    reason: 'threshold_exceeded',
    querySource,
    eventsSinceLastBoundary,
    threshold: options.threshold,
    ...(tokenPressure ? { tokenPressure } : {}),
    consecutiveFailures,
    maxConsecutiveFailures,
  }
}

export function estimateCompactTokenPressure(
  events: readonly TranscriptEvent[],
  options: {
    tokenBudget?: number
    contextBudget?: CompactContextWindowBudgetMetadata
    modelId?: string
    provider?: string
    budgetSource?: CompactContextWindowBudgetMetadata['source']
    contextWindowTokens?: number
    reservedOutputTokens?: number
    reservedSystemTokens?: number
    reservedToolSchemaTokens?: number
    safetyMarginTokens?: number
    pressureThreshold?: number
    tokenPreflight?: CompactTokenPreflightMetadata
  },
): CompactTokenPressureMetadata {
  const contextBudget =
    options.contextBudget ??
    resolveCompactContextWindowBudget({
      tokenBudget: options.tokenBudget,
      modelId: options.modelId,
      provider: options.provider,
      budgetSource: options.budgetSource,
      contextWindowTokens: options.contextWindowTokens,
      reservedOutputTokens: options.reservedOutputTokens,
      reservedSystemTokens: options.reservedSystemTokens,
      reservedToolSchemaTokens: options.reservedToolSchemaTokens,
      safetyMarginTokens: options.safetyMarginTokens,
      pressureThreshold: options.pressureThreshold,
    })
  const charsMeasured = events.reduce(
    (total, event) => total + compactEventCharWeight(event),
    0,
  )
  const tokenCount = estimateCompactEventTokens(events, {
    charsMeasured,
    contextBudget,
    tokenPreflight: options.tokenPreflight,
  })
  const estimatedTokens = tokenCount.estimatedTokens
  const contextBudgetWithEstimator: CompactContextWindowBudgetMetadata = {
    ...contextBudget,
    estimator: tokenCount.estimator,
  }
  const tokenBudget = contextBudget.effectiveInputBudgetTokens
  const pressureRatio = estimatedTokens / tokenBudget
  const pressureThreshold = contextBudget.pressureThreshold
  return {
    estimatedTokens,
    tokenBudget,
    pressureRatio,
    pressureThreshold,
    eventsMeasured: events.length,
    charsMeasured,
    tokenCountSource: tokenCount.source,
    reason:
      pressureRatio >= pressureThreshold
        ? 'token_pressure_exceeded'
        : 'below_token_pressure',
    contextBudget: contextBudgetWithEstimator,
  }
}

export function resolveCompactContextWindowBudget(options: {
  tokenBudget?: number
  modelId?: string
  provider?: string
  budgetSource?: CompactContextWindowBudgetMetadata['source']
  contextWindowTokens?: number
  reservedOutputTokens?: number
  reservedSystemTokens?: number
  reservedToolSchemaTokens?: number
  safetyMarginTokens?: number
  pressureThreshold?: number
}): CompactContextWindowBudgetMetadata {
  const pressureThreshold =
    options.pressureThreshold ?? DEFAULT_TOKEN_PRESSURE_THRESHOLD
  if (options.tokenBudget !== undefined) {
    const tokenBudget = Math.max(1, Math.floor(options.tokenBudget))
    return {
      source: options.budgetSource ?? 'explicit-token-budget',
      modelId: options.modelId ?? 'unknown',
      ...(options.provider ? { provider: options.provider } : {}),
      contextWindowTokens: null,
      reservedOutputTokens: 0,
      reservedSystemTokens: 0,
      reservedToolSchemaTokens: 0,
      safetyMarginTokens: 0,
      effectiveInputBudgetTokens: tokenBudget,
      pressureThreshold,
      estimator: buildCharEstimateEstimator(),
    }
  }

  const contextWindowTokens = Math.max(1, Math.floor(options.contextWindowTokens ?? 1))
  const reservedOutputTokens = Math.max(
    0,
    Math.floor(options.reservedOutputTokens ?? DEFAULT_RESERVED_OUTPUT_TOKENS),
  )
  const reservedSystemTokens = Math.max(
    0,
    Math.floor(options.reservedSystemTokens ?? DEFAULT_RESERVED_SYSTEM_TOKENS),
  )
  const reservedToolSchemaTokens = Math.max(
    0,
    Math.floor(options.reservedToolSchemaTokens ?? DEFAULT_RESERVED_TOOL_SCHEMA_TOKENS),
  )
  const safetyMarginTokens = Math.max(
    0,
    Math.floor(options.safetyMarginTokens ?? DEFAULT_SAFETY_MARGIN_TOKENS),
  )
  const effectiveInputBudgetTokens = Math.max(
    1,
    contextWindowTokens -
      reservedOutputTokens -
      reservedSystemTokens -
      reservedToolSchemaTokens -
      safetyMarginTokens,
  )
  return {
    source: 'model-context-window',
    modelId: options.modelId ?? 'unknown',
    ...(options.provider ? { provider: options.provider } : {}),
    contextWindowTokens,
    reservedOutputTokens,
    reservedSystemTokens,
    reservedToolSchemaTokens,
    safetyMarginTokens,
    effectiveInputBudgetTokens,
    pressureThreshold,
    estimator: buildCharEstimateEstimator(),
  }
}

function estimateCompactEventTokens(
  events: readonly TranscriptEvent[],
  options: {
    charsMeasured: number
    contextBudget: CompactContextWindowBudgetMetadata
    tokenPreflight?: CompactTokenPreflightMetadata
  },
): {
  estimatedTokens: number
  source: CompactTokenPressureMetadata['tokenCountSource']
  estimator: CompactTokenEstimatorMetadata
} {
  if (options.tokenPreflight?.status === 'ok') {
    return {
      estimatedTokens: Math.max(0, Math.floor(options.tokenPreflight.inputTokens)),
      source: 'provider-input-token-preflight',
      estimator: {
        kind: 'provider-input-token-preflight',
        source: options.tokenPreflight.source,
        modelId: options.tokenPreflight.modelId,
        ...(options.tokenPreflight.provider
          ? { provider: options.tokenPreflight.provider }
          : {}),
        requestEventCount: options.tokenPreflight.requestEventCount,
        toolCount: options.tokenPreflight.toolCount,
        inputTokens: Math.max(0, Math.floor(options.tokenPreflight.inputTokens)),
        ...(options.tokenPreflight.totalTokens !== undefined
          ? { totalTokens: options.tokenPreflight.totalTokens }
          : {}),
        ...(options.tokenPreflight.cacheReadInputTokens !== undefined
          ? { cacheReadInputTokens: options.tokenPreflight.cacheReadInputTokens }
          : {}),
        ...(options.tokenPreflight.cacheCreationInputTokens !== undefined
          ? { cacheCreationInputTokens: options.tokenPreflight.cacheCreationInputTokens }
          : {}),
      },
    }
  }
  if (options.tokenPreflight?.status === 'context-overflow') {
    return {
      estimatedTokens: options.contextBudget.effectiveInputBudgetTokens + 1,
      source: 'provider-context-overflow-preflight',
      estimator: {
        kind: 'provider-context-overflow-preflight',
        source: options.tokenPreflight.source,
        modelId: options.tokenPreflight.modelId,
        ...(options.tokenPreflight.provider
          ? { provider: options.tokenPreflight.provider }
          : {}),
        requestEventCount: options.tokenPreflight.requestEventCount,
        toolCount: options.tokenPreflight.toolCount,
        errorMessage: options.tokenPreflight.errorMessage,
      },
    }
  }
  if (options.tokenPreflight?.status === 'failed') {
    return {
      estimatedTokens: Math.ceil(
        options.charsMeasured / ESTIMATED_CHARS_PER_TOKEN,
      ),
      source: 'runtime-char-estimate',
      estimator: buildCharEstimateEstimator({
        preflightFailure: {
          source: options.tokenPreflight.source,
          modelId: options.tokenPreflight.modelId,
          ...(options.tokenPreflight.provider
            ? { provider: options.tokenPreflight.provider }
            : {}),
          requestEventCount: options.tokenPreflight.requestEventCount,
          toolCount: options.tokenPreflight.toolCount,
          errorKind: options.tokenPreflight.errorKind,
          errorMessage: options.tokenPreflight.errorMessage,
        },
      }),
    }
  }
  const usageAnchor = findLatestProviderUsageAnchor(events, {
    modelId: options.contextBudget.modelId,
    provider: options.contextBudget.provider,
  })
  if (usageAnchor) {
    return {
      estimatedTokens:
        usageAnchor.baseContextTokens + usageAnchor.deltaEstimatedTokens,
      source: 'provider-usage-plus-delta-estimate',
      estimator: {
        kind: 'provider-usage-plus-delta-estimate',
        source: 'transcript-llm-response-usage',
        modelId: options.contextBudget.modelId,
        ...(options.contextBudget.provider
          ? { provider: options.contextBudget.provider }
          : {}),
        requestId: usageAnchor.requestId,
        responseEventIndex: usageAnchor.responseEventIndex,
        ...(usageAnchor.baseInputTokens !== undefined
          ? { baseInputTokens: usageAnchor.baseInputTokens }
          : {}),
        ...(usageAnchor.baseOutputTokens !== undefined
          ? { baseOutputTokens: usageAnchor.baseOutputTokens }
          : {}),
        ...(usageAnchor.baseTotalTokens !== undefined
          ? { baseTotalTokens: usageAnchor.baseTotalTokens }
          : {}),
        ...(usageAnchor.baseCacheReadInputTokens !== undefined
          ? { baseCacheReadInputTokens: usageAnchor.baseCacheReadInputTokens }
          : {}),
        ...(usageAnchor.baseCacheCreationInputTokens !== undefined
          ? { baseCacheCreationInputTokens: usageAnchor.baseCacheCreationInputTokens }
          : {}),
        baseContextTokens: usageAnchor.baseContextTokens,
        deltaEventCount: usageAnchor.deltaEventCount,
        deltaChars: usageAnchor.deltaChars,
        deltaEstimatedTokens: usageAnchor.deltaEstimatedTokens,
        deltaEstimator: buildCharEstimateEstimator(),
      },
    }
  }
  return {
    estimatedTokens: Math.ceil(
      options.charsMeasured / ESTIMATED_CHARS_PER_TOKEN,
    ),
    source: 'runtime-char-estimate',
    estimator: buildCharEstimateEstimator(),
  }
}

function findLatestProviderUsageAnchor(
  events: readonly TranscriptEvent[],
  options: {
    modelId: string
    provider?: string
  },
):
  | {
      requestId: string
      responseEventIndex: number
      baseInputTokens?: number
      baseOutputTokens?: number
      baseTotalTokens?: number
      baseCacheReadInputTokens?: number
      baseCacheCreationInputTokens?: number
      baseContextTokens: number
      deltaEventCount: number
      deltaChars: number
      deltaEstimatedTokens: number
    }
  | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!event || event.type !== 'llm-response' || event.status !== 'ok') continue
    const baseContextTokens = providerContextTokensFromResponse(event)
    if (baseContextTokens === null) continue
    const deltaEvents = events.slice(index + 1)
    const deltaChars = deltaEvents.reduce(
      (total, deltaEvent) => total + compactEventCharWeight(deltaEvent),
      0,
    )
    return {
      requestId: event.requestId,
      responseEventIndex: index,
      ...(event.inputTokens !== undefined ? { baseInputTokens: event.inputTokens } : {}),
      ...(event.outputTokens !== undefined ? { baseOutputTokens: event.outputTokens } : {}),
      ...(event.totalTokens !== undefined ? { baseTotalTokens: event.totalTokens } : {}),
      ...(event.cacheReadInputTokens !== undefined
        ? { baseCacheReadInputTokens: event.cacheReadInputTokens }
        : {}),
      ...(event.cacheCreationInputTokens !== undefined
        ? { baseCacheCreationInputTokens: event.cacheCreationInputTokens }
        : {}),
      baseContextTokens,
      deltaEventCount: deltaEvents.length,
      deltaChars,
      deltaEstimatedTokens: Math.ceil(deltaChars / ESTIMATED_CHARS_PER_TOKEN),
    }
  }
  return null
}

function providerContextTokensFromResponse(
  event: Extract<TranscriptEvent, { type: 'llm-response' }>,
): number | null {
  const promptTokens =
    event.inputTokens ??
    (event.cacheReadInputTokens !== undefined ||
    event.cacheCreationInputTokens !== undefined
      ? (event.cacheReadInputTokens ?? 0) + (event.cacheCreationInputTokens ?? 0)
      : undefined)
  if (promptTokens !== undefined) {
    return promptTokens + (event.outputTokens ?? 0)
  }
  return event.totalTokens ?? null
}

function buildCharEstimateEstimator(options: {
  preflightFailure?: Extract<
    CompactTokenEstimatorMetadata,
    { kind: 'char-estimate' }
  >['preflightFailure']
} = {}): Extract<
  CompactTokenEstimatorMetadata,
  { kind: 'char-estimate' }
> {
  return {
    kind: 'char-estimate',
    charsPerToken: ESTIMATED_CHARS_PER_TOKEN,
    source: 'runtime-heuristic',
    ...(options.preflightFailure
      ? { preflightFailure: options.preflightFailure }
      : {}),
  }
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
  const route = resolveCompactRoute({
    requestedStrategy: options.strategy,
    summary: options.summary,
    trigger: options.trigger ?? 'manual',
    querySource: options.querySource ?? 'main',
    userContext: options.userContext,
    reactiveEventCount,
  })

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
      compactRoute: route,
      tokenPressure: options.tokenPressure,
      memoryReadiness: options.memoryReadiness,
      preservedSegment: buildPreservedSegmentMetadata({
        allEvents,
        splitIndex,
        requestedSplitIndex,
        summarizedEventCount: eventsToSummarize.length,
      }),
      postCompactCleanup: runPostCompactCleanup(route, options.cleanupState),
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
        compactStrategy: route.strategy,
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
    querySource?: CompactQuerySource
    consecutiveFailures?: number
    maxConsecutiveFailures?: number
  },
): boolean {
  return evaluateAutoCompactTranscript(events, options).shouldCompact
}

function compactEventCharWeight(event: TranscriptEvent): number {
  switch (event.type) {
    case 'user':
      return event.content.length
    case 'assistant':
      return event.content.length +
        (event.reasoningContent?.length ?? 0) +
        JSON.stringify(event.toolCalls ?? []).length
    case 'tool-call':
      return event.call.name.length + JSON.stringify(event.call.input).length
    case 'tool-result':
      return event.result.content.length + JSON.stringify(event.result.metadata ?? {}).length
    case 'compact-boundary':
      return event.summary.length + JSON.stringify(event.metadata ?? {}).length
    case 'session-state':
    case 'project-config':
    case 'content-replacement':
    case 'llm-request':
    case 'llm-response':
    case 'request-stability':
    case 'subagent-lifecycle':
    case 'permission':
    case 'hook':
    case 'lsp-diagnostics':
      return JSON.stringify(event).length
  }
}

function resolveCompactRoute(options: {
  requestedStrategy?: CompactStrategy
  summary: string
  trigger: CompactTrigger
  querySource: CompactQuerySource
  userContext?: string
  reactiveEventCount: number
}): CompactRouteMetadata {
  if (options.requestedStrategy) {
    return {
      strategy: options.requestedStrategy,
      trigger: options.trigger,
      querySource: options.querySource,
      reason: `requested_${options.requestedStrategy}`,
      fallbacks: compactFallbacks(options.requestedStrategy),
    }
  }

  if (options.summary.trim() && !options.userContext?.trim()) {
    return {
      strategy: 'session-memory',
      trigger: options.trigger,
      querySource: options.querySource,
      reason: 'summary_available_without_custom_context',
      fallbacks: ['reactive', 'legacy'],
    }
  }

  if (options.reactiveEventCount > 0) {
    return {
      strategy: 'reactive',
      trigger: options.trigger,
      querySource: options.querySource,
      reason: options.userContext?.trim()
        ? 'custom_context_disables_session_memory'
        : 'reactive_tail_requested',
      fallbacks: ['legacy'],
    }
  }

  return {
    strategy: 'legacy',
    trigger: options.trigger,
    querySource: options.querySource,
    reason: 'legacy_full_transcript_compaction',
    fallbacks: [],
  }
}

function compactFallbacks(strategy: CompactStrategy): CompactStrategy[] {
  if (strategy === 'session-memory') return ['reactive', 'legacy']
  if (strategy === 'reactive') return ['legacy']
  return []
}

function buildPreservedSegmentMetadata(options: {
  allEvents: readonly TranscriptEvent[]
  splitIndex: number
  requestedSplitIndex: number
  summarizedEventCount: number
}): NonNullable<Extract<TranscriptEvent, { type: 'compact-boundary' }>['metadata']['preservedSegment']> {
  const preservedEventCount = Math.max(0, options.allEvents.length - options.splitIndex)
  const metadata: NonNullable<Extract<TranscriptEvent, { type: 'compact-boundary' }>['metadata']['preservedSegment']> = {
    requestedSplitIndex: options.requestedSplitIndex,
    adjustedSplitIndex: options.splitIndex,
    summarizedEventCount: options.summarizedEventCount,
    preservedEventCount,
    eventRefStrategy: 'deterministic-event-fingerprint',
    apiInvariantAdjusted: options.requestedSplitIndex !== options.splitIndex,
  }
  if (options.splitIndex > 0) {
    const headEventIndex = options.splitIndex - 1
    metadata.headEventIndex = headEventIndex
    metadata.headEventRef = buildCompactPreservedEventRef({
      role: 'head',
      event: compactEventAt(options.allEvents, headEventIndex),
      eventIndex: headEventIndex,
    })
  }
  if (preservedEventCount > 0) {
    metadata.anchorEventIndex = options.splitIndex
    metadata.anchorEventRef = buildCompactPreservedEventRef({
      role: 'anchor',
      event: compactEventAt(options.allEvents, options.splitIndex),
      eventIndex: options.splitIndex,
    })
    metadata.tailEventIndex = options.allEvents.length - 1
    metadata.tailEventRef = buildCompactPreservedEventRef({
      role: 'tail',
      event: compactEventAt(options.allEvents, options.allEvents.length - 1),
      eventIndex: options.allEvents.length - 1,
    })
  }
  return metadata
}

function buildCompactPreservedEventRef(options: {
  role: CompactPreservedEventRefMetadata['role']
  event: TranscriptEvent
  eventIndex: number
}): CompactPreservedEventRefMetadata {
  const timestamp = options.event.timestamp
  const ref: CompactPreservedEventRefMetadata = {
    role: options.role,
    eventId: deterministicCompactEventId(options.event, options.eventIndex),
    eventIndex: options.eventIndex,
    eventType: options.event.type,
  }
  if (timestamp) ref.timestamp = timestamp
  return ref
}

function deterministicCompactEventId(
  event: TranscriptEvent,
  eventIndex: number,
): string {
  const digest = createHash('sha256')
    .update(String(eventIndex))
    .update('\0')
    .update(JSON.stringify(event))
    .digest('hex')
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join('-')
}

function compactEventAt(
  events: readonly TranscriptEvent[],
  index: number,
): TranscriptEvent {
  const event = events[index]
  if (!event) {
    throw new Error(`Compact preserved segment points outside transcript: ${index}`)
  }
  return event
}

export function runPostCompactCleanup(
  route: CompactRouteMetadata,
  state: PostCompactCleanupState = {},
): PostCompactCleanupMetadata {
  return createPostCompactStateRegistry({
    route,
    ...(state.lspOpenFileState ? { lspOpenFileState: state.lspOpenFileState } : {}),
    ...(state.readFileState ? { readFileState: state.readFileState } : {}),
  }).run()
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
