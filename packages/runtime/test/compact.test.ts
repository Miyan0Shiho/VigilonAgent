import { test, expect, describe } from 'vitest';
import {
  compactTranscript,
  shouldAutoCompactTranscript,
} from '../src/runtime/compact';
import { InMemoryTranscriptStore } from '../src/runtime/transcript';
import type { TranscriptEvent } from '../src/runtime/contracts';

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
    expect((finalEvents[3] as Extract<TranscriptEvent, { type: 'assistant' }>).reasoningContent).toBe('Need both tools.');
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
  });
});
