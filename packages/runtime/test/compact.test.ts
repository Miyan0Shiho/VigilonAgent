import { test, expect, describe } from 'vitest';
import {
  compactTranscript,
  estimateCompactTokenPressure,
  evaluateAutoCompactTranscript,
  resolveCompactContextWindowBudget,
  runPostCompactCleanup,
  shouldAutoCompactTranscript,
} from '../src/runtime/compact';
import { InMemoryTranscriptStore } from '../src/runtime/transcript';
import type { TranscriptEvent } from '../src/runtime/contracts';

const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('Context Compaction', () => {
  test('should leave reactive turns uncompacted', async () => {
    const transcript = new InMemoryTranscriptStore();
    const events: TranscriptEvent[] = [
      { type: 'user', content: 'm1', timestamp: '1' },
      { type: 'assistant', content: 'r1', timestamp: '2' },
      { type: 'user', content: 'm2', timestamp: '3' },
      { type: 'assistant', content: 'r2', timestamp: '4' },
    ];
    for (const e of events) await transcript.append(e);

    const sessionState = {
      discoveredToolNames: ['tool1'],
      todos: [],
      approvedPlan: 'plan',
      verificationNotes: [],
      backgroundTasks: [],
    } as any;

    // Compact leaving 2 events uncompacted (m2, r2)
    const boundary = await compactTranscript({
      transcript,
      summary: 'Summary of m1, r1',
      sessionState,
      reactiveEventCount: 2,
    });

    const finalEvents = await transcript.readAll();
    expect(finalEvents.length).toBe(5); // m1, r1, boundary, m2, r2
    expect(finalEvents[2].type).toBe('compact-boundary');
    expect(finalEvents[2].summary).toBe('Summary of m1, r1');
    expect((finalEvents[2] as any).metadata.messagesSummarized).toBe(2); // m1, r1
    expect((finalEvents[2] as any).metadata.discoveredToolNames).toEqual(['tool1']);
    expect((finalEvents[2] as any).metadata.approvedPlan).toBe('plan');
    expect((finalEvents[2] as any).metadata.compactRoute).toMatchObject({
      strategy: 'session-memory',
      reason: 'summary_available_without_custom_context',
      fallbacks: ['reactive', 'legacy'],
    });
    expect((finalEvents[2] as any).metadata.preservedSegment).toMatchObject({
      requestedSplitIndex: 2,
      adjustedSplitIndex: 2,
      summarizedEventCount: 2,
      preservedEventCount: 2,
      eventRefStrategy: 'deterministic-event-fingerprint',
      headEventIndex: 1,
      headEventRef: {
        role: 'head',
        eventIndex: 1,
        eventType: 'assistant',
        timestamp: '2',
        eventId: expect.stringMatching(UUID_LIKE_PATTERN),
      },
      anchorEventIndex: 2,
      anchorEventRef: {
        role: 'anchor',
        eventIndex: 2,
        eventType: 'user',
        timestamp: '3',
        eventId: expect.stringMatching(UUID_LIKE_PATTERN),
      },
      tailEventIndex: 3,
      tailEventRef: {
        role: 'tail',
        eventIndex: 3,
        eventType: 'assistant',
        timestamp: '4',
        eventId: expect.stringMatching(UUID_LIKE_PATTERN),
      },
      apiInvariantAdjusted: false,
    });
    expect((finalEvents[2] as any).metadata.postCompactCleanup).toMatchObject({
      required: true,
      completed: true,
      cleared: expect.arrayContaining(['capability-replay-required']),
    });
    
    expect(finalEvents[3].content).toBe('m2');
    expect(finalEvents[4].content).toBe('r2');
  });

  test('should not split assistant tool-call groups during reactive compaction', async () => {
    const transcript = new InMemoryTranscriptStore();
    const events: TranscriptEvent[] = [
      { type: 'user', content: 'm1', timestamp: '1' },
      { type: 'assistant', content: 'r1', timestamp: '2' },
      {
        type: 'assistant',
        content: '',
        reasoningContent: 'Need both tools.',
        toolCalls: [
          { id: 'call-1', name: 'Read', input: { file_path: 'a.ts' } },
          { id: 'call-2', name: 'Grep', input: { pattern: 'skill' } },
        ],
        timestamp: '3',
      },
      {
        type: 'tool-call',
        call: { id: 'call-1', name: 'Read', input: { file_path: 'a.ts' } },
        timestamp: '4',
      },
      {
        type: 'tool-result',
        result: { toolCallId: 'call-1', ok: true, content: 'a' },
        timestamp: '5',
      },
      {
        type: 'tool-call',
        call: { id: 'call-2', name: 'Grep', input: { pattern: 'skill' } },
        timestamp: '6',
      },
      {
        type: 'tool-result',
        result: { toolCallId: 'call-2', ok: true, content: 'b' },
        timestamp: '7',
      },
    ];
    for (const e of events) await transcript.append(e);

    await compactTranscript({
      transcript,
      summary: 'Summary of old context',
      reactiveEventCount: 2,
    });

    const finalEvents = await transcript.readAll();
    expect(finalEvents.map(event => event.type)).toEqual([
      'user',
      'assistant',
      'compact-boundary',
      'assistant',
      'tool-call',
      'tool-result',
      'tool-call',
      'tool-result',
    ]);
    expect((finalEvents[2] as any).metadata.preservedSegment).toMatchObject({
      requestedSplitIndex: 5,
      adjustedSplitIndex: 2,
      eventRefStrategy: 'deterministic-event-fingerprint',
      headEventRef: {
        role: 'head',
        eventIndex: 1,
        eventType: 'assistant',
      },
      anchorEventRef: {
        role: 'anchor',
        eventIndex: 2,
        eventType: 'assistant',
      },
      tailEventRef: {
        role: 'tail',
        eventIndex: 6,
        eventType: 'tool-result',
      },
      apiInvariantAdjusted: true,
    });
    expect((finalEvents[3] as Extract<TranscriptEvent, { type: 'assistant' }>).reasoningContent).toBe('Need both tools.');
  });

  test('should route custom-context compaction through reactive fallback before legacy', async () => {
    const transcript = new InMemoryTranscriptStore();
    const events: TranscriptEvent[] = [
      { type: 'user', content: 'm1', timestamp: '1' },
      { type: 'assistant', content: 'r1', timestamp: '2' },
      { type: 'user', content: 'm2', timestamp: '3' },
    ];
    for (const e of events) await transcript.append(e);

    const boundary = await compactTranscript({
      transcript,
      summary: 'Use this operator custom summary',
      userContext: 'Preserve this operator instruction',
      reactiveEventCount: 1,
    });

    expect(boundary.metadata.compactRoute).toMatchObject({
      strategy: 'reactive',
      reason: 'custom_context_disables_session_memory',
      fallbacks: ['legacy'],
    });
    expect(boundary.metadata.modelParams).toMatchObject({
      compactStrategy: 'reactive',
    });
  });

  test('should carry model-grounded memory validation into compact boundary metadata', async () => {
    const transcript = new InMemoryTranscriptStore();
    await transcript.append({
      type: 'user',
      content: 'm1',
      timestamp: '1',
    });

    const boundary = await compactTranscript({
      transcript,
      summary: 'Grounded memory summary',
      memoryReadiness: {
        before: 'stale',
        after: 'fresh',
        ready: true,
        blockingReasons: [],
        validationRequired: true,
        refreshed: true,
        memoryPath: '/tmp/session.memory.md',
        manifestPath: '/tmp/session.memory.manifest.json',
        groundingValidation: {
          kind: 'vigilon.session-memory-grounding',
          version: 1,
          status: 'supported',
          modelId: 'fake-grounding-model',
          validatedAt: '2026-05-18T00:00:00Z',
          memorySourceEventCount: 1,
          currentEventCount: 1,
          semanticDriftStatus: 'none',
          changedAnchors: [],
          evidenceEventCount: 1,
          supportedClaims: ['summary is supported'],
          contradictedClaims: [],
          missingClaims: [],
          reason: 'model checked memory against transcript evidence',
        },
      },
    });

    expect(boundary.metadata.memoryReadiness?.groundingValidation).toMatchObject({
      status: 'supported',
      modelId: 'fake-grounding-model',
      supportedClaims: ['summary is supported'],
    });
  });

  test('should produce deterministic preserved event refs for the same transcript boundary', async () => {
    const events: TranscriptEvent[] = [
      { type: 'user', content: 'm1', timestamp: '1' },
      { type: 'assistant', content: 'r1', timestamp: '2' },
      { type: 'user', content: 'm2', timestamp: '3' },
      { type: 'assistant', content: 'r2', timestamp: '4' },
    ];
    const firstTranscript = new InMemoryTranscriptStore();
    const secondTranscript = new InMemoryTranscriptStore();
    for (const event of events) {
      await firstTranscript.append(event);
      await secondTranscript.append(event);
    }

    const first = await compactTranscript({
      transcript: firstTranscript,
      summary: 'summary',
      reactiveEventCount: 2,
    });
    const second = await compactTranscript({
      transcript: secondTranscript,
      summary: 'summary',
      reactiveEventCount: 2,
    });

    expect(first.metadata.preservedSegment?.headEventRef?.eventId).toBe(
      second.metadata.preservedSegment?.headEventRef?.eventId,
    );
    expect(first.metadata.preservedSegment?.anchorEventRef?.eventId).toBe(
      second.metadata.preservedSegment?.anchorEventRef?.eventId,
    );
    expect(first.metadata.preservedSegment?.tailEventRef?.eventId).toBe(
      second.metadata.preservedSegment?.tailEventRef?.eventId,
    );
  });

  test('should only auto-compact after enough new events since the latest boundary', async () => {
    const events: TranscriptEvent[] = Array.from({ length: 31 }, (_, index) => ({
      type: 'user',
      content: `m${index}`,
      timestamp: String(index),
    }));

    expect(shouldAutoCompactTranscript(events, { threshold: 30 })).toBe(true);

    const withBoundary: TranscriptEvent[] = [
      ...events.slice(0, 21),
      {
        type: 'compact-boundary',
        summary: 'old context',
        metadata: {
          trigger: 'auto',
          preEventCount: 31,
          messagesSummarized: 21,
        },
        timestamp: 'boundary',
      },
      ...events.slice(21),
    ];

    expect(shouldAutoCompactTranscript(withBoundary, { threshold: 30 })).toBe(false);

    const enoughNewEvents = [
      ...withBoundary,
      ...Array.from({ length: 21 }, (_, index) => ({
        type: 'assistant' as const,
        content: `r${index}`,
        timestamp: `new-${index}`,
      })),
    ];
    expect(shouldAutoCompactTranscript(enoughNewEvents, { threshold: 30 })).toBe(true);
    expect(
      evaluateAutoCompactTranscript(enoughNewEvents, {
        threshold: 30,
        querySource: 'compact',
      }),
    ).toMatchObject({
      shouldCompact: false,
      reason: 'query_source_compact_blocked',
    });
    expect(
      evaluateAutoCompactTranscript(enoughNewEvents, {
        threshold: 30,
        consecutiveFailures: 3,
        maxConsecutiveFailures: 3,
      }),
    ).toMatchObject({
      shouldCompact: false,
      reason: 'consecutive_failure_circuit_open',
    });
  });

  test('should auto-compact from token pressure before event threshold', () => {
    const events: TranscriptEvent[] = [
      {
        type: 'user',
        content: 'x'.repeat(2_000),
        timestamp: '1',
      },
    ];

    const pressure = estimateCompactTokenPressure(events, {
      tokenBudget: 500,
      pressureThreshold: 0.8,
    });
    expect(pressure).toMatchObject({
      estimatedTokens: 500,
      tokenBudget: 500,
      pressureRatio: 1,
      pressureThreshold: 0.8,
      eventsMeasured: 1,
      tokenCountSource: 'runtime-char-estimate',
      reason: 'token_pressure_exceeded',
    });

    expect(
      evaluateAutoCompactTranscript(events, {
        threshold: 30,
        tokenBudget: 500,
        pressureThreshold: 0.8,
      }),
    ).toMatchObject({
      shouldCompact: true,
      reason: 'token_pressure_exceeded',
      eventsSinceLastBoundary: 1,
      tokenPressure: {
        reason: 'token_pressure_exceeded',
        tokenBudget: 500,
      },
    });
  });

  test('should derive token pressure from provider context-window budget', () => {
    const events: TranscriptEvent[] = [
      {
        type: 'user',
        content: 'x'.repeat(2_000),
        timestamp: '1',
      },
    ];
    const contextBudget = resolveCompactContextWindowBudget({
      modelId: 'deepseek:deepseek-v4-flash',
      provider: 'deepseek',
      contextWindowTokens: 1_000,
      reservedOutputTokens: 100,
      reservedSystemTokens: 100,
      reservedToolSchemaTokens: 100,
      safetyMarginTokens: 100,
      pressureThreshold: 0.8,
    });

    expect(contextBudget).toMatchObject({
      source: 'model-context-window',
      modelId: 'deepseek:deepseek-v4-flash',
      provider: 'deepseek',
      contextWindowTokens: 1000,
      effectiveInputBudgetTokens: 600,
      estimator: {
        kind: 'char-estimate',
        source: 'runtime-heuristic',
      },
    });

    expect(
      estimateCompactTokenPressure(events, {
        contextBudget,
      }),
    ).toMatchObject({
      estimatedTokens: 500,
      tokenBudget: 600,
      pressureRatio: 500 / 600,
      tokenCountSource: 'runtime-char-estimate',
      reason: 'token_pressure_exceeded',
      contextBudget: {
        source: 'model-context-window',
        effectiveInputBudgetTokens: 600,
      },
    });

    expect(
      evaluateAutoCompactTranscript(events, {
        threshold: 30,
        contextBudget,
      }),
    ).toMatchObject({
      shouldCompact: true,
      reason: 'token_pressure_exceeded',
      tokenPressure: {
        contextBudget: {
          modelId: 'deepseek:deepseek-v4-flash',
          effectiveInputBudgetTokens: 600,
        },
      },
    });
  });

  test('should prefer provider usage anchor plus delta estimate over whole-transcript char estimate', () => {
    const events: TranscriptEvent[] = [
      {
        type: 'user',
        content: 'older context that should already be in provider usage',
        timestamp: '1',
      },
      {
        type: 'llm-response',
        requestId: 'req-provider-1',
        previousRequestId: null,
        status: 'ok',
        stopReason: 'end_turn',
        inputTokens: 850,
        outputTokens: 100,
        totalTokens: 950,
        cacheReadInputTokens: 600,
        cacheCreationInputTokens: 250,
        durationMs: 12,
        toolCallCount: 0,
        assistantChars: 12,
        timestamp: '2',
      },
      {
        type: 'tool-result',
        result: {
          toolCallId: 'delta',
          ok: true,
          content: 'x'.repeat(198),
        },
        timestamp: '3',
      },
    ];
    const contextBudget = resolveCompactContextWindowBudget({
      modelId: 'deepseek:deepseek-v4-flash',
      provider: 'deepseek',
      contextWindowTokens: 1_500,
      reservedOutputTokens: 100,
      reservedSystemTokens: 100,
      reservedToolSchemaTokens: 100,
      safetyMarginTokens: 100,
      pressureThreshold: 0.8,
    });

    const pressure = estimateCompactTokenPressure(events, {
      contextBudget,
    });

    expect(pressure).toMatchObject({
      estimatedTokens: 1000,
      tokenBudget: 1100,
      tokenCountSource: 'provider-usage-plus-delta-estimate',
      reason: 'token_pressure_exceeded',
      contextBudget: {
        estimator: {
          kind: 'provider-usage-plus-delta-estimate',
          source: 'transcript-llm-response-usage',
          requestId: 'req-provider-1',
          responseEventIndex: 1,
          baseInputTokens: 850,
          baseOutputTokens: 100,
          baseTotalTokens: 950,
          baseCacheReadInputTokens: 600,
          baseCacheCreationInputTokens: 250,
          baseContextTokens: 950,
          deltaEventCount: 1,
          deltaEstimatedTokens: 50,
        },
      },
    });
  });

  test('should prefer provider input-token preflight over transcript heuristic sources', () => {
    const events: TranscriptEvent[] = [
      {
        type: 'user',
        content: 'x'.repeat(2_000),
        timestamp: '1',
      },
    ];
    const contextBudget = resolveCompactContextWindowBudget({
      modelId: 'deepseek:deepseek-v4-flash',
      provider: 'deepseek',
      contextWindowTokens: 2_000,
      reservedOutputTokens: 100,
      reservedSystemTokens: 100,
      reservedToolSchemaTokens: 100,
      safetyMarginTokens: 100,
      pressureThreshold: 0.8,
    });

    const pressure = estimateCompactTokenPressure(events, {
      contextBudget,
      tokenPreflight: {
        status: 'ok',
        source: 'model-client-count-input-tokens',
        modelId: 'deepseek:deepseek-v4-flash',
        provider: 'deepseek',
        requestEventCount: 7,
        toolCount: 14,
        inputTokens: 1_300,
        totalTokens: 1_301,
        cacheReadInputTokens: 900,
        cacheCreationInputTokens: 400,
      },
    });

    expect(pressure).toMatchObject({
      estimatedTokens: 1300,
      tokenBudget: 1600,
      tokenCountSource: 'provider-input-token-preflight',
      reason: 'token_pressure_exceeded',
      contextBudget: {
        estimator: {
          kind: 'provider-input-token-preflight',
          source: 'model-client-count-input-tokens',
          modelId: 'deepseek:deepseek-v4-flash',
          provider: 'deepseek',
          requestEventCount: 7,
          toolCount: 14,
          inputTokens: 1300,
          totalTokens: 1301,
          cacheReadInputTokens: 900,
          cacheCreationInputTokens: 400,
        },
      },
    });
  });

  test('should force compact pressure when provider preflight reports context overflow', () => {
    const events: TranscriptEvent[] = [
      {
        type: 'user',
        content: 'small transcript but provider request overflowed after injections',
        timestamp: '1',
      },
    ];
    const contextBudget = resolveCompactContextWindowBudget({
      modelId: 'deepseek:deepseek-v4-flash',
      provider: 'deepseek',
      contextWindowTokens: 2_000,
      reservedOutputTokens: 100,
      reservedSystemTokens: 100,
      reservedToolSchemaTokens: 100,
      safetyMarginTokens: 100,
      pressureThreshold: 0.8,
    });

    const pressure = estimateCompactTokenPressure(events, {
      contextBudget,
      tokenPreflight: {
        status: 'context-overflow',
        source: 'model-client-count-input-tokens',
        modelId: 'deepseek:deepseek-v4-flash',
        provider: 'deepseek',
        requestEventCount: 50,
        toolCount: 20,
        errorMessage: 'context length exceeded',
      },
    });

    expect(pressure).toMatchObject({
      estimatedTokens: 1601,
      tokenBudget: 1600,
      tokenCountSource: 'provider-context-overflow-preflight',
      reason: 'token_pressure_exceeded',
      contextBudget: {
        estimator: {
          kind: 'provider-context-overflow-preflight',
          source: 'model-client-count-input-tokens',
          modelId: 'deepseek:deepseek-v4-flash',
          provider: 'deepseek',
          requestEventCount: 50,
          toolCount: 20,
          errorMessage: 'context length exceeded',
        },
      },
    });
  });

  test('should expose provider preflight failure before falling back to char estimate', () => {
    const events: TranscriptEvent[] = [
      {
        type: 'user',
        content: 'x'.repeat(2_000),
        timestamp: '1',
      },
    ];

    const pressure = estimateCompactTokenPressure(events, {
      tokenBudget: 500,
      pressureThreshold: 0.8,
      tokenPreflight: {
        status: 'failed',
        source: 'model-client-count-input-tokens',
        modelId: 'deepseek:deepseek-v4-flash',
        provider: 'deepseek',
        requestEventCount: 3,
        toolCount: 2,
        errorKind: 'provider_error',
        errorMessage: 'rate limited',
      },
    });

    expect(pressure).toMatchObject({
      estimatedTokens: 500,
      tokenCountSource: 'runtime-char-estimate',
      contextBudget: {
        estimator: {
          kind: 'char-estimate',
          preflightFailure: {
            source: 'model-client-count-input-tokens',
            modelId: 'deepseek:deepseek-v4-flash',
            provider: 'deepseek',
            requestEventCount: 3,
            toolCount: 2,
            errorKind: 'provider_error',
            errorMessage: 'rate limited',
          },
        },
      },
    });
  });

  test('should record token pressure on compact boundary metadata', async () => {
    const transcript = new InMemoryTranscriptStore();
    await transcript.append({
      type: 'user',
      content: 'x'.repeat(2_000),
      timestamp: '1',
    });

    const tokenPressure = estimateCompactTokenPressure(await transcript.readAll(), {
      tokenBudget: 500,
      pressureThreshold: 0.8,
    });
    const boundary = await compactTranscript({
      transcript,
      summary: 'Compressed due to token pressure.',
      trigger: 'auto',
      tokenPressure,
    });

    expect(boundary.metadata.tokenPressure).toMatchObject({
      estimatedTokens: 500,
      tokenBudget: 500,
      pressureRatio: 1,
      tokenCountSource: 'runtime-char-estimate',
      reason: 'token_pressure_exceeded',
    });
    expect(boundary.metadata.modelParams).toMatchObject({
      compactStrategy: 'session-memory',
    });
  });

  test('should perform post-compact cleanup without dropping read safety state', async () => {
    const transcript = new InMemoryTranscriptStore();
    await transcript.append({
      type: 'user',
      content: 'compact cleanup',
      timestamp: '1',
    });
    const lspOpenFileState = new Set(['/project/src/a.ts', '/project/src/b.ts']);
    const readFileState = new Map([
      ['/project/src/a.ts', { fullRead: true }],
    ]);

    const boundary = await compactTranscript({
      transcript,
      summary: 'cleanup summary',
      cleanupState: {
        lspOpenFileState,
        readFileState,
      },
    });

    expect(lspOpenFileState.size).toBe(0);
    expect(readFileState.size).toBe(1);
    expect(boundary.metadata.postCompactCleanup?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: 'lsp-open-file-state',
          scope: 'main',
          action: 'cleared',
          policy: 'rebuild-after-compact',
          beforeCount: 2,
          afterCount: 0,
        }),
        expect.objectContaining({
          target: 'read-file-state',
          scope: 'main',
          action: 'preserved',
          policy: 'preserve-safety-state',
          beforeCount: 1,
          afterCount: 1,
        }),
      ]),
    );
  });

  test('should scope post-compact registry operations to subagent compact sources', () => {
    const cleanup = runPostCompactCleanup({
      strategy: 'session-memory',
      trigger: 'auto',
      querySource: 'agent:reviewer',
      reason: 'requested_session-memory',
      fallbacks: ['reactive', 'legacy'],
    });

    expect(cleanup.cleared).toEqual(
      expect.arrayContaining(['agent-scoped-compact-state']),
    );
    expect(cleanup.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: 'compact-state',
          scope: 'agent:reviewer',
          action: 'cleared',
          policy: 'discard-after-boundary',
        }),
        expect.objectContaining({
          target: 'capability-replay',
          scope: 'agent:reviewer',
          action: 'scheduled',
          policy: 'replay-after-compact',
        }),
      ]),
    );
  });
});
