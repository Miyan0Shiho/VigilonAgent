import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  compactTranscript,
  evaluateAutoCompactTranscript,
  estimateCompactTokenPressure,
  InMemoryTranscriptStore,
  JsonlTranscriptStore,
  readTranscriptFile,
  resolveCompactContextWindowBudget,
  restoreSessionStateFromEvents,
  runCli,
  type ModelClient,
  type RuntimeSessionState,
  type TranscriptEvent,
} from '../src/index.js'

const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type ProbeCheck = {
  name: string
  passed: boolean
  details?: unknown
}

async function main(): Promise<void> {
  const transcript = new InMemoryTranscriptStore('phase25-compact-probe')
  const events: TranscriptEvent[] = [
    { type: 'user', content: 'Investigate a long task.', timestamp: '1' },
    { type: 'assistant', content: 'Plan accepted.', timestamp: '2' },
    {
      type: 'assistant',
      content: '',
      reasoningContent: 'Need a grouped read and grep.',
      toolCalls: [
        { id: 'call-read', name: 'Read', input: { file_path: 'src/a.ts' } },
        { id: 'call-grep', name: 'Grep', input: { pattern: 'Runtime' } },
      ],
      timestamp: '3',
    },
    {
      type: 'tool-call',
      call: { id: 'call-read', name: 'Read', input: { file_path: 'src/a.ts' } },
      timestamp: '4',
    },
    {
      type: 'tool-result',
      result: { toolCallId: 'call-read', ok: true, content: 'read result' },
      timestamp: '5',
    },
    {
      type: 'tool-call',
      call: { id: 'call-grep', name: 'Grep', input: { pattern: 'Runtime' } },
      timestamp: '6',
    },
    {
      type: 'tool-result',
      result: { toolCallId: 'call-grep', ok: true, content: 'grep result' },
      timestamp: '7',
    },
    { type: 'user', content: 'Continue after tool work.', timestamp: '8' },
  ]
  for (const event of events) await transcript.append(event)

  const sessionState = {
    phase: 'execute',
    permissionMode: 'ask',
    todos: [{ id: 't1', content: 'Finish compact governance', status: 'in_progress' }],
    approvedPlan: 'Use memory-first compact, preserve tool groups, restore runtime state.',
    verificationNotes: ['compact probe should restore this note'],
    backgroundTasks: [],
    discoveredToolNames: ['Read', 'Grep', 'ToolSearch'],
    toolReferenceDeltas: [
      {
        name: 'ToolSearch',
        reason: 'deferred discovery',
        schemaHash: 'sha256:toolsearch',
        discoveredAt: '2026-05-19T00:00:00Z',
      },
    ],
    mcpInstructions: ['Preserve MCP instruction after compact.'],
    memoryFreshness: 'stale',
  } satisfies RuntimeSessionState

  const boundary = await compactTranscript({
    transcript,
    summary: '## Session Memory\nThe task is compact governance.',
    trigger: 'manual',
    querySource: 'main',
    reactiveEventCount: 3,
    sessionState,
    cleanupState: {
      lspOpenFileState: new Set(['src/a.ts', 'src/b.ts']),
      readFileState: new Map([['src/a.ts', { fullRead: true }]]),
    },
  })
  const compactedEvents = await transcript.readAll()
  const restored = restoreSessionStateFromEvents(compactedEvents)

  const customTranscript = new InMemoryTranscriptStore('phase25-compact-custom')
  for (const event of events.slice(0, 4)) await customTranscript.append(event)
  const customBoundary = await compactTranscript({
    transcript: customTranscript,
    summary: 'Custom compact summary.',
    userContext: 'Operator custom instruction disables session-memory route.',
    reactiveEventCount: 1,
    sessionState,
  })

  const thresholdEvents: TranscriptEvent[] = Array.from({ length: 35 }, (_, index) => ({
    type: 'user',
    content: `event-${index}`,
    timestamp: String(index),
  }))
  const autoReady = evaluateAutoCompactTranscript(thresholdEvents, {
    threshold: 30,
    querySource: 'main',
  })
  const autoBlockedBySource = evaluateAutoCompactTranscript(thresholdEvents, {
    threshold: 30,
    querySource: 'compact',
  })
  const autoBlockedByCircuit = evaluateAutoCompactTranscript(thresholdEvents, {
    threshold: 30,
    consecutiveFailures: 3,
    maxConsecutiveFailures: 3,
  })
  const tokenPressureEvents: TranscriptEvent[] = [
    {
      type: 'tool-result',
      result: {
        toolCallId: 'large-context',
        ok: true,
        content: 'x'.repeat(2_400),
      },
      timestamp: 'token-pressure',
    },
  ]
  const contextBudget = resolveCompactContextWindowBudget({
    modelId: 'deepseek:deepseek-v4-flash',
    provider: 'deepseek',
    contextWindowTokens: 1_500,
    reservedOutputTokens: 250,
    reservedSystemTokens: 250,
    reservedToolSchemaTokens: 250,
    safetyMarginTokens: 250,
    pressureThreshold: 0.85,
  })
  const tokenPressure = estimateCompactTokenPressure(tokenPressureEvents, {
    contextBudget,
  })
  const autoReadyByTokenPressure = evaluateAutoCompactTranscript(tokenPressureEvents, {
    threshold: 30,
    querySource: 'main',
    contextBudget,
  })
  const tokenPressureTranscript = new InMemoryTranscriptStore('phase25-compact-token-pressure')
  for (const event of tokenPressureEvents) await tokenPressureTranscript.append(event)
  const tokenPressureBoundary = await compactTranscript({
    transcript: tokenPressureTranscript,
    summary: 'Token-pressure compact summary.',
    trigger: 'auto',
    querySource: 'main',
    reactiveEventCount: 0,
    sessionState,
    tokenPressure: autoReadyByTokenPressure.tokenPressure,
  })
  const providerUsagePressureEvents: TranscriptEvent[] = [
    {
      type: 'user',
      content: 'Provider usage anchor should dominate compact pressure accounting.',
      timestamp: 'provider-usage-1',
    },
    {
      type: 'llm-response',
      requestId: 'phase25-provider-usage-anchor',
      previousRequestId: null,
      status: 'ok',
      stopReason: 'end_turn',
      inputTokens: 850,
      outputTokens: 100,
      totalTokens: 950,
      cacheReadInputTokens: 600,
      cacheCreationInputTokens: 250,
      durationMs: 10,
      toolCallCount: 0,
      assistantChars: 20,
      timestamp: 'provider-usage-2',
    },
    {
      type: 'tool-result',
      result: {
        toolCallId: 'provider-usage-delta',
        ok: true,
        content: 'x'.repeat(198),
      },
      timestamp: 'provider-usage-3',
    },
  ]
  const providerUsagePressure = estimateCompactTokenPressure(providerUsagePressureEvents, {
    contextBudget: resolveCompactContextWindowBudget({
      modelId: 'deepseek:deepseek-v4-flash',
      provider: 'deepseek',
      contextWindowTokens: 1_500,
      reservedOutputTokens: 100,
      reservedSystemTokens: 100,
      reservedToolSchemaTokens: 100,
      safetyMarginTokens: 100,
      pressureThreshold: 0.8,
    }),
  })
  const providerPreflightPressure = estimateCompactTokenPressure(tokenPressureEvents, {
    contextBudget: resolveCompactContextWindowBudget({
      modelId: 'deepseek:deepseek-v4-flash',
      provider: 'deepseek',
      contextWindowTokens: 1_500,
      reservedOutputTokens: 100,
      reservedSystemTokens: 100,
      reservedToolSchemaTokens: 100,
      safetyMarginTokens: 100,
      pressureThreshold: 0.8,
    }),
    tokenPreflight: {
      status: 'ok',
      source: 'model-client-count-input-tokens',
      modelId: 'deepseek:deepseek-v4-flash',
      provider: 'deepseek',
      requestEventCount: 8,
      toolCount: 12,
      inputTokens: 1_000,
      totalTokens: 1_001,
      cacheReadInputTokens: 760,
      cacheCreationInputTokens: 240,
    },
  })

  const cliRoot = await mkdtemp(path.join(tmpdir(), 'vigilon-phase25-compact-cli-'))
  const cliCwd = path.join(cliRoot, 'workspace')
  const cliSessionsDir = path.join(cliRoot, 'sessions')
  await mkdir(cliCwd, { recursive: true })
  const cliTranscript = new JsonlTranscriptStore({
    cwd: cliCwd,
    sessionsDir: cliSessionsDir,
    sessionId: 'phase25-compact-cli',
  })
  for (const event of events.slice(0, 3)) await cliTranscript.append(event)
  const cliIo = createProbeIo()
  const cliExitCode = await runCli(
    [
      'compact',
      'phase25-compact-cli',
      '--reactive-events',
      '1',
      '--context-window',
      '1000',
      '--output-reserve',
      '100',
      '--system-reserve',
      '100',
      '--tool-schema-reserve',
      '100',
      '--safety-margin',
      '100',
      '--validate-memory',
      '--cwd',
      cliCwd,
      '--sessions-dir',
      cliSessionsDir,
    ],
    cliIo,
    {
      createModelClient: () => createProbeGroundingModel(),
    },
  )
  const cliOutput = JSON.parse(cliIo.stdoutText) as {
    compacted?: boolean
    summarySource?: string
    memoryReadiness?: {
      before?: string | null
      after?: string | null
      ready?: boolean
      blockingReasons?: string[]
      validationRequired?: boolean
      refreshed?: boolean
      extraction?: { status?: string; trigger?: string; sourceEventCount?: number }
      groundingValidation?: {
        status?: string
        modelId?: string
        supportedClaims?: string[]
      }
    }
    boundary?: {
      route?: { strategy?: string }
      tokenPressure?: {
        contextBudget?: {
          source?: string
          effectiveInputBudgetTokens?: number
        }
      }
      postCompactCleanup?: { completed?: boolean }
      memoryFreshness?: string
      memoryReadiness?: {
        ready?: boolean
        blockingReasons?: string[]
        validationRequired?: boolean
        refreshed?: boolean
        extraction?: { status?: string; trigger?: string; sourceEventCount?: number }
        groundingValidation?: {
          status?: string
          modelId?: string
          supportedClaims?: string[]
        }
      }
    }
    transcriptPath?: string
  }
  const cliEvents = cliOutput.transcriptPath
    ? await readTranscriptFile(cliOutput.transcriptPath)
    : []
  const blockedTranscript = new JsonlTranscriptStore({
    cwd: cliCwd,
    sessionsDir: cliSessionsDir,
    sessionId: 'phase25-compact-blocked',
  })
  for (const event of events.slice(0, 2)) await blockedTranscript.append(event)
  const blockedCliIo = createProbeIo()
  const blockedCliExitCode = await runCli(
    [
      'compact',
      'phase25-compact-blocked',
      '--validate-memory',
      '--reactive-events',
      '0',
      '--cwd',
      cliCwd,
      '--sessions-dir',
      cliSessionsDir,
    ],
    blockedCliIo,
    {
      createModelClient: () => createContradictingGroundingModel(),
    },
  )
  const blockedCliEvents = await readTranscriptFile(blockedTranscript.transcriptPath)
  await rm(cliRoot, { recursive: true, force: true })

  const checks: ProbeCheck[] = [
    {
      name: 'manual compact records session-memory first route',
      passed:
        boundary.metadata.compactRoute?.strategy === 'session-memory' &&
        boundary.metadata.compactRoute.fallbacks.join(',') === 'reactive,legacy',
      details: boundary.metadata.compactRoute,
    },
    {
      name: 'compact boundary records preserved segment metadata',
      passed:
        boundary.metadata.preservedSegment?.preservedEventCount === 6 &&
        boundary.metadata.preservedSegment.requestedSplitIndex === 5 &&
        boundary.metadata.preservedSegment.adjustedSplitIndex === 2 &&
        boundary.metadata.preservedSegment.eventRefStrategy === 'deterministic-event-fingerprint' &&
        boundary.metadata.preservedSegment.headEventRef?.eventType === 'assistant' &&
        boundary.metadata.preservedSegment.anchorEventRef?.eventType === 'assistant' &&
        boundary.metadata.preservedSegment.tailEventRef?.eventType === 'user' &&
        Boolean(boundary.metadata.preservedSegment.headEventRef.eventId.match(UUID_LIKE_PATTERN)) &&
        Boolean(boundary.metadata.preservedSegment.anchorEventRef.eventId.match(UUID_LIKE_PATTERN)) &&
        Boolean(boundary.metadata.preservedSegment.tailEventRef.eventId.match(UUID_LIKE_PATTERN)) &&
        boundary.metadata.preservedSegment.apiInvariantAdjusted === true,
      details: boundary.metadata.preservedSegment,
    },
    {
      name: 'post-compact cleanup runs registry-driven cache/state operations',
      passed:
        boundary.metadata.postCompactCleanup?.required === true &&
        boundary.metadata.postCompactCleanup.completed === true &&
        boundary.metadata.postCompactCleanup.cleared.includes('capability-replay-required') &&
        Boolean(boundary.metadata.postCompactCleanup.operations?.some(operation =>
          operation.target === 'lsp-open-file-state' &&
          operation.scope === 'main' &&
          operation.action === 'cleared' &&
          operation.policy === 'rebuild-after-compact' &&
          operation.beforeCount === 2 &&
          operation.afterCount === 0,
        )) &&
        Boolean(boundary.metadata.postCompactCleanup.operations?.some(operation =>
          operation.target === 'read-file-state' &&
          operation.scope === 'main' &&
          operation.action === 'preserved' &&
          operation.policy === 'preserve-safety-state' &&
          operation.beforeCount === 1 &&
          operation.afterCount === 1,
        )),
      details: boundary.metadata.postCompactCleanup,
    },
    {
      name: 'compact restoration preserves runtime state',
      passed:
        restored.approvedPlan === sessionState.approvedPlan &&
        restored.memoryFreshness === 'stale' &&
        restored.discoveredToolNames.includes('ToolSearch') &&
        restored.mcpInstructions.includes('Preserve MCP instruction after compact.') &&
        restored.verificationNotes.includes('compact probe should restore this note'),
    },
    {
      name: 'custom context routes through reactive fallback',
      passed:
        customBoundary.metadata.compactRoute?.strategy === 'reactive' &&
        customBoundary.metadata.compactRoute.reason === 'custom_context_disables_session_memory',
      details: customBoundary.metadata.compactRoute,
    },
    {
      name: 'auto compact threshold can open the gate',
      passed: autoReady.shouldCompact && autoReady.reason === 'threshold_exceeded',
      details: autoReady,
    },
    {
      name: 'auto compact token pressure can open the gate before event threshold',
      passed:
        autoReadyByTokenPressure.shouldCompact &&
        autoReadyByTokenPressure.reason === 'token_pressure_exceeded' &&
        autoReadyByTokenPressure.eventsSinceLastBoundary === 1 &&
        autoReadyByTokenPressure.tokenPressure?.reason === 'token_pressure_exceeded',
      details: autoReadyByTokenPressure,
    },
    {
      name: 'compact boundary records token pressure metadata',
      passed:
        tokenPressure.reason === 'token_pressure_exceeded' &&
        tokenPressureBoundary.metadata.tokenPressure?.tokenBudget === 500 &&
        tokenPressureBoundary.metadata.tokenPressure.reason === 'token_pressure_exceeded' &&
        tokenPressureBoundary.metadata.tokenPressure.contextBudget?.source === 'model-context-window' &&
        tokenPressureBoundary.metadata.tokenPressure.contextBudget.modelId === 'deepseek:deepseek-v4-flash',
      details: tokenPressureBoundary.metadata.tokenPressure,
    },
    {
      name: 'compact token pressure uses provider usage anchor before delta estimate',
      passed:
        providerUsagePressure.estimatedTokens === 1000 &&
        providerUsagePressure.tokenBudget === 1100 &&
        providerUsagePressure.tokenCountSource === 'provider-usage-plus-delta-estimate' &&
        providerUsagePressure.contextBudget?.estimator.kind === 'provider-usage-plus-delta-estimate' &&
        providerUsagePressure.contextBudget.estimator.requestId === 'phase25-provider-usage-anchor' &&
        providerUsagePressure.contextBudget.estimator.baseContextTokens === 950 &&
        providerUsagePressure.contextBudget.estimator.deltaEstimatedTokens === 50,
      details: providerUsagePressure,
    },
    {
      name: 'compact token pressure uses provider input-token preflight without usage anchor',
      passed:
        providerPreflightPressure.estimatedTokens === 1000 &&
        providerPreflightPressure.tokenBudget === 1100 &&
        providerPreflightPressure.tokenCountSource === 'provider-input-token-preflight' &&
        providerPreflightPressure.contextBudget?.estimator.kind ===
          'provider-input-token-preflight' &&
        providerPreflightPressure.contextBudget.estimator.inputTokens === 1000 &&
        providerPreflightPressure.contextBudget.estimator.requestEventCount === 8 &&
        providerPreflightPressure.contextBudget.estimator.toolCount === 12,
      details: providerPreflightPressure,
    },
    {
      name: 'manual compact CLI refreshes session memory and writes a compact boundary',
      passed:
        cliExitCode === 0 &&
        cliOutput.compacted === true &&
        cliOutput.summarySource === 'refreshed-session-memory' &&
        cliOutput.memoryReadiness?.before === null &&
        cliOutput.memoryReadiness.after === 'fresh' &&
        cliOutput.memoryReadiness.ready === true &&
        cliOutput.memoryReadiness.validationRequired === true &&
        cliOutput.memoryReadiness.blockingReasons?.length === 0 &&
        cliOutput.memoryReadiness.refreshed === true &&
        cliOutput.memoryReadiness.extraction?.status === 'completed' &&
        cliOutput.memoryReadiness.extraction.trigger === 'compact' &&
        cliOutput.memoryReadiness.extraction.sourceEventCount === 3 &&
        cliOutput.memoryReadiness.groundingValidation?.status === 'supported' &&
        cliOutput.memoryReadiness.groundingValidation.modelId === 'phase25-compact-grounding-model' &&
        cliOutput.boundary?.tokenPressure?.contextBudget?.source === 'model-context-window' &&
        cliOutput.boundary.tokenPressure.contextBudget.effectiveInputBudgetTokens === 600 &&
        cliOutput.boundary?.route?.strategy === 'session-memory' &&
        cliOutput.boundary.postCompactCleanup?.completed === true &&
        cliOutput.boundary.memoryReadiness?.refreshed === true &&
        cliOutput.boundary.memoryReadiness.ready === true &&
        cliOutput.boundary.memoryReadiness.validationRequired === true &&
        cliOutput.boundary.memoryReadiness.extraction?.status === 'completed' &&
        cliOutput.boundary.memoryReadiness.extraction.trigger === 'compact' &&
        cliOutput.boundary.memoryReadiness.groundingValidation?.status === 'supported' &&
        cliOutput.boundary.memoryFreshness === 'fresh' &&
        cliEvents.some(event => event.type === 'compact-boundary'),
      details: cliOutput,
    },
    {
      name: 'manual compact CLI blocks unsupported model-grounded session memory',
      passed:
        blockedCliExitCode === 1 &&
        blockedCliIo.stderrText.includes('compact memory readiness blocked: session_memory_grounding_contradicted') &&
        blockedCliEvents.every(event => event.type !== 'compact-boundary'),
      details: {
        exitCode: blockedCliExitCode,
        stderr: blockedCliIo.stderrText,
        eventTypes: blockedCliEvents.map(event => event.type),
      },
    },
    {
      name: 'auto compact recursion/query-source gate blocks compact source',
      passed:
        !autoBlockedBySource.shouldCompact &&
        autoBlockedBySource.reason === 'query_source_compact_blocked',
      details: autoBlockedBySource,
    },
    {
      name: 'auto compact circuit breaker blocks repeated failures',
      passed:
        !autoBlockedByCircuit.shouldCompact &&
        autoBlockedByCircuit.reason === 'consecutive_failure_circuit_open',
      details: autoBlockedByCircuit,
    },
  ]

  const passed = checks.every(check => check.passed)
  console.log(
    JSON.stringify(
      {
        phase: 'P2.5 Context / Compact Runtime',
        status: passed ? 'compact_probe_ok' : 'compact_probe_failed',
        closureEvidence: false,
        scope:
          'Proves the current compact runtime slice: route metadata, session-memory extraction readiness/wait protocol, model-grounded memory readiness gate, unsupported memory compact blocking, provider/model context-window budget metadata, provider usage anchored token-pressure accounting, provider input-token preflight accounting when no usage anchor exists, token-pressure auto-compact evaluation, preserved segment head/anchor/tail event refs, registry-driven post-compact cleanup operations, manual compact CLI surface, auto-compact gates, and restoration metadata. It does not prove full P2.5 closure.',
        checks,
        compactedEventTypes: compactedEvents.map(event => event.type),
      },
      null,
      2,
    ),
  )
  if (!passed) process.exitCode = 1
}

function createProbeIo(): {
  stdoutText: string
  stderrText: string
  stdout: { write(chunk: string): boolean }
  stderr: { write(chunk: string): boolean }
  env: NodeJS.ProcessEnv
} {
  const io = {
    stdoutText: '',
    stderrText: '',
    stdout: {
      write(chunk: string) {
        io.stdoutText += chunk
        return true
      },
    },
    stderr: {
      write(chunk: string) {
        io.stderrText += chunk
        return true
      },
    },
    env: {
      VIGILON_DISABLE_GLOBAL_SETTINGS: '1',
    },
  }
  return io
}

function createProbeGroundingModel(): ModelClient {
  return {
    id: 'phase25-compact-grounding-model',
    async createMessage(request) {
      const prompt = request.messages[0]?.type === 'user' ? request.messages[0].content : ''
      return {
        content: JSON.stringify({
          status:
            prompt.includes('<session_memory>') &&
            prompt.includes('<current_transcript_evidence>')
              ? 'supported'
              : 'unknown',
          supportedClaims: ['Manual compact consumed model-grounded session memory.'],
          contradictedClaims: [],
          missingClaims: [],
          reason: 'Synthetic grounding model verified the session memory before compact.',
        }),
        toolCalls: [],
        stopReason: 'end_turn',
      }
    },
  }
}

function createContradictingGroundingModel(): ModelClient {
  return {
    id: 'phase25-compact-contradicting-grounding-model',
    async createMessage() {
      return {
        content: JSON.stringify({
          status: 'contradicted',
          supportedClaims: [],
          contradictedClaims: ['The generated session memory is not supported by current transcript evidence.'],
          missingClaims: [],
          reason: 'Synthetic grounding model rejected the session memory before compact.',
        }),
        toolCalls: [],
        stopReason: 'end_turn',
      }
    },
  }
}

await main()
