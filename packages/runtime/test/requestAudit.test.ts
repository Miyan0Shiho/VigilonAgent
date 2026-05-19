import { test, expect, describe } from 'vitest';
import { buildLlmRequestEvent, buildLlmResponseEvent, buildRequestStabilityEvent } from '../src/runtime/requestAudit';
import type { TranscriptEvent } from '../src/runtime/contracts';

describe('Request Stability Audit', () => {
  test('should detect tool schema change', () => {
    const timestamp = new Date().toISOString();
    const request1 = buildLlmRequestEvent({
      events: [],
      visibleEvents: [],
      tools: [{ name: 'Tool1', description: 'desc', invoke: async () => ({ toolCallId: '', ok: true, content: '' }) }],
      model: 'model-a',
      compacted: false,
      droppedEventCount: 0,
      timestamp,
    });

    const response1 = buildLlmResponseEvent({
      request: request1,
      stopReason: 'end_turn',
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 100,
      toolCallCount: 0,
      assistantChars: 10,
      timestamp,
    });

    const request2 = buildLlmRequestEvent({
      events: [request1, response1],
      visibleEvents: [],
      tools: [
        { name: 'Tool1', description: 'desc', invoke: async () => ({ toolCallId: '', ok: true, content: '' }) },
        { name: 'Tool2', description: 'new tool', invoke: async () => ({ toolCallId: '', ok: true, content: '' }) }
      ],
      model: 'model-a',
      compacted: false,
      droppedEventCount: 0,
      timestamp,
    });

    const response2 = buildLlmResponseEvent({
      request: request2,
      stopReason: 'end_turn',
      inputTokens: 120,
      outputTokens: 50,
      durationMs: 100,
      toolCallCount: 0,
      assistantChars: 10,
      timestamp,
    });

    const stabilityEvent = buildRequestStabilityEvent({
      events: [request1, response1, request2, response2],
      currentRequest: request2,
      currentResponse: response2,
      timestamp,
    });

    expect(stabilityEvent).not.toBeNull();
    expect(stabilityEvent?.toolSchemaChanged).toBe(true);
    expect(stabilityEvent?.classification).toBe('expected_change');
    expect(stabilityEvent?.reasons).toContain('tool_schema_changed');
  });

  test('should detect unexpected token shift', () => {
    const timestamp = new Date().toISOString();
    const request1 = buildLlmRequestEvent({
      events: [],
      visibleEvents: [],
      tools: [],
      model: 'model-a',
      compacted: false,
      droppedEventCount: 0,
      timestamp,
    });

    const response1 = buildLlmResponseEvent({
      request: request1,
      stopReason: 'end_turn',
      inputTokens: 5000,
      outputTokens: 50,
      durationMs: 100,
      toolCallCount: 0,
      assistantChars: 10,
      timestamp,
    });

    const request2 = buildLlmRequestEvent({
      events: [request1, response1],
      visibleEvents: [],
      tools: [],
      model: 'model-a',
      compacted: false,
      droppedEventCount: 0,
      timestamp,
    });

    const response2 = buildLlmResponseEvent({
      request: request2,
      stopReason: 'end_turn',
      inputTokens: 7000, // 40% increase without shape change
      outputTokens: 50,
      durationMs: 100,
      toolCallCount: 0,
      assistantChars: 10,
      timestamp,
    });

    const stabilityEvent = buildRequestStabilityEvent({
      events: [request1, response1, request2, response2],
      currentRequest: request2,
      currentResponse: response2,
      timestamp,
    });

    expect(stabilityEvent).not.toBeNull();
    expect(stabilityEvent?.classification).toBe('unexpected_change');
    expect(stabilityEvent?.reasons).toContain('input_tokens_shift_without_shape_change');
  });

  test('should include detailed hashes for system, tool schema, and compact capability changes', () => {
    const timestamp = new Date().toISOString();
    const request1 = buildLlmRequestEvent({
      events: [],
      visibleEvents: [],
      tools: [{ name: 'Tool1', description: 'desc', invoke: async () => ({ toolCallId: '', ok: true, content: '' }) }],
      model: 'model-a',
      compacted: false,
      droppedEventCount: 0,
      timestamp,
      systemPrompt: 'system-v1',
      compactCapability: { discoveredToolNames: ['Read'] },
    } as any);

    const response1 = buildLlmResponseEvent({
      request: request1,
      stopReason: 'end_turn',
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 100,
      toolCallCount: 0,
      assistantChars: 10,
      timestamp,
    });

    const request2 = buildLlmRequestEvent({
      events: [request1, response1],
      visibleEvents: [],
      tools: [
        { name: 'Tool1', description: 'desc', invoke: async () => ({ toolCallId: '', ok: true, content: '' }) },
        { name: 'Tool2', description: 'new tool', invoke: async () => ({ toolCallId: '', ok: true, content: '' }) },
      ],
      model: 'model-a',
      compacted: false,
      droppedEventCount: 0,
      timestamp,
      systemPrompt: 'system-v2',
      compactCapability: { discoveredToolNames: ['Read', 'Grep'] },
    } as any);

    const response2 = buildLlmResponseEvent({
      request: request2,
      stopReason: 'end_turn',
      inputTokens: 120,
      outputTokens: 50,
      durationMs: 100,
      toolCallCount: 0,
      assistantChars: 10,
      timestamp,
    });

    const stabilityEvent = buildRequestStabilityEvent({
      events: [request1, response1, request2, response2],
      currentRequest: request2,
      currentResponse: response2,
      timestamp,
    });

    expect(stabilityEvent).not.toBeNull();
    expect(stabilityEvent?.reasons).toContain('system_changed');
    expect(stabilityEvent?.reasons).toContain('tool_schema_changed');
    expect(stabilityEvent?.reasons).toContain('compact_capability_changed');
    expect(stabilityEvent?.details).toMatchObject({
      systemChanged: true,
      toolSchemaChanged: true,
      compactCapabilityChanged: true,
      modelId: 'model-a',
      systemPromptHash: expect.any(String),
      toolSchemaHash: expect.any(String),
      compactCapabilityHash: expect.any(String),
    });
  });
});
