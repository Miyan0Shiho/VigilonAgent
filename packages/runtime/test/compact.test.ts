import { test, expect, describe } from 'vitest';
import { compactTranscript } from '../src/runtime/compact';
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
});
