import { describe, expect, it } from 'vitest'
import { buildModelContextWindow, type TranscriptEvent } from '../src/index.js'

describe('buildModelContextWindow', () => {
  it('keeps the latest compact boundary and drops pre-compact history', () => {
    const events: TranscriptEvent[] = [
      { type: 'user', content: 'old user', timestamp: '2026-05-17T00:00:00Z' },
      {
        type: 'assistant',
        content: 'old assistant',
        timestamp: '2026-05-17T00:00:01Z',
      },
      {
        type: 'compact-boundary',
        summary: 'Earlier context summary',
        metadata: {
          trigger: 'manual',
          preEventCount: 2,
          messagesSummarized: 2,
        },
        timestamp: '2026-05-17T00:00:02Z',
      },
      {
        type: 'user',
        content: 'preserved suffix',
        timestamp: '2026-05-17T00:00:03Z',
      },
    ]

    expect(buildModelContextWindow(events)).toMatchObject({
      compacted: true,
      compactBoundaryIndex: 2,
      droppedEventCount: 2,
      events: [
        { type: 'compact-boundary', summary: 'Earlier context summary' },
        { type: 'user', content: 'preserved suffix' },
      ],
    })
  })

  it('drops orphan tool events after a compact boundary', () => {
    const events: TranscriptEvent[] = [
      {
        type: 'compact-boundary',
        summary: 'Earlier context summary',
        metadata: {
          trigger: 'manual',
          preEventCount: 0,
          messagesSummarized: 0,
        },
        timestamp: '2026-05-17T00:00:00Z',
      },
      {
        type: 'tool-result',
        result: { toolCallId: 'lost-call', ok: true, content: 'orphan' },
        timestamp: '2026-05-17T00:00:01Z',
      },
      {
        type: 'tool-call',
        call: { id: 'kept-call', name: 'Read', input: {} },
        timestamp: '2026-05-17T00:00:02Z',
      },
      {
        type: 'tool-result',
        result: { toolCallId: 'kept-call', ok: true, content: 'kept' },
        timestamp: '2026-05-17T00:00:03Z',
      },
    ]

    expect(buildModelContextWindow(events).events.map(event => event.type)).toEqual([
      'compact-boundary',
    ])
  })

  it('replaces large tool results and returns durable replacement records', () => {
    const events: TranscriptEvent[] = [
      {
        type: 'tool-call',
        call: { id: 'large-call', name: 'Bash', input: {} },
        timestamp: '2026-05-17T00:00:00Z',
      },
      {
        type: 'tool-result',
        result: {
          toolCallId: 'large-call',
          ok: true,
          content: 'x'.repeat(80),
        },
        timestamp: '2026-05-17T00:00:01Z',
      },
    ]

    const window = buildModelContextWindow(events, {
      toolResultReplacementLimit: 20,
    })

    expect(window.newContentReplacements).toHaveLength(1)
    expect(window.newContentReplacements[0]).toMatchObject({
      kind: 'tool-result',
      toolCallId: 'large-call',
    })
    expect(
      window.events.find(event => event.type === 'tool-result'),
    ).toMatchObject({
      result: {
        toolCallId: 'large-call',
        content: expect.stringContaining('vigilon_tool_result_replaced'),
      },
    })
  })

  it('reapplies stored content replacement records during resume', () => {
    const events: TranscriptEvent[] = [
      {
        type: 'content-replacement',
        replacements: [
          {
            kind: 'tool-result',
            toolCallId: 'call-1',
            replacement: '<persisted replacement>',
          },
        ],
        timestamp: '2026-05-17T00:00:00Z',
      },
      {
        type: 'tool-call',
        call: { id: 'call-1', name: 'Bash', input: {} },
        timestamp: '2026-05-17T00:00:01Z',
      },
      {
        type: 'tool-result',
        result: {
          toolCallId: 'call-1',
          ok: true,
          content: 'original full output',
        },
        timestamp: '2026-05-17T00:00:02Z',
      },
    ]

    const window = buildModelContextWindow(events, {
      toolResultReplacementLimit: 1000,
    })

    expect(window.newContentReplacements).toEqual([])
    expect(window.events.map(event => event.type)).toEqual([
      'tool-call',
      'tool-result',
    ])
    expect(
      window.events.find(event => event.type === 'tool-result'),
    ).toMatchObject({
      result: { content: '<persisted replacement>' },
    })
  })
})
