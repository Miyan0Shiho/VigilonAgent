import { describe, expect, test } from 'vitest'
import {
  buildForkedRequestEvents,
  buildRequestCachePrefixMetadata,
  buildRequestCacheSnapshot,
  selectRequestCacheTools,
} from '../src/runtime/requestCache'
import type { Tool, TranscriptEvent } from '../src/runtime/contracts'

const readTool: Tool = {
  name: 'Read',
  description: 'Read a file',
  inputJsonSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
  },
  async invoke() {
    return { toolCallId: '', ok: true, content: '' }
  },
}

const bashTool: Tool = {
  name: 'Bash',
  description: 'Run a shell command',
  inputJsonSchema: {
    type: 'object',
    properties: { command: { type: 'string' } },
  },
  async invoke() {
    return { toolCallId: '', ok: true, content: '' }
  },
}

describe('request cache prefix snapshots', () => {
  test('hashes model, tool schema, and wire-visible messages without timestamps', () => {
    const visibleEvents: TranscriptEvent[] = [
      { type: 'user', content: 'inspect cache sharing', timestamp: 't1' },
    ]
    const first = buildRequestCachePrefixMetadata({
      model: 'fake-model',
      visibleEvents,
      tools: [readTool],
    })
    const second = buildRequestCachePrefixMetadata({
      model: 'fake-model',
      visibleEvents: [{ ...visibleEvents[0]!, timestamp: 't2' }],
      tools: [readTool],
    })
    const changedTool = buildRequestCachePrefixMetadata({
      model: 'fake-model',
      visibleEvents,
      tools: [readTool, bashTool],
    })

    expect(first?.canonicalPrefixHash).toBe(second?.canonicalPrefixHash)
    expect(first?.canonicalPrefixHash).not.toBe(changedTool?.canonicalPrefixHash)
    expect(first).toMatchObject({
      source: 'request',
      eventCount: 1,
      sharedPrefixEventCount: 1,
      toolSchemaHash: expect.any(String),
      messagePrefixHash: expect.any(String),
    })
  })

  test('forked request prepends the parent snapshot and reuses parent tools', () => {
    const parentEvents: TranscriptEvent[] = [
      { type: 'user', content: 'parent task', timestamp: 'parent' },
    ]
    const parentPrefix = buildRequestCachePrefixMetadata({
      model: 'fake-model',
      visibleEvents: parentEvents,
      tools: [readTool, bashTool],
    })
    const parentSnapshot = buildRequestCacheSnapshot({
      model: 'fake-model',
      visibleEvents: parentEvents,
      tools: [readTool, bashTool],
      cachePrefix: parentPrefix ?? null,
    })
    const childEvents: TranscriptEvent[] = [
      { type: 'user', content: 'child directive', timestamp: 'child' },
    ]
    const forkedEvents = buildForkedRequestEvents({
      parentSnapshot,
      childEvents,
    })
    const forkedTools = selectRequestCacheTools({
      parentSnapshot,
      childTools: [readTool],
    })
    const forkedPrefix = buildRequestCachePrefixMetadata({
      model: 'fake-model',
      visibleEvents: forkedEvents,
      tools: forkedTools,
      source: 'fork-shared-prefix',
      sharedPrefixEventCount: parentSnapshot?.visibleEvents.length,
      parentCanonicalPrefixHash: parentSnapshot?.cachePrefix.canonicalPrefixHash,
    })

    expect(forkedEvents.map(event => event.type)).toEqual(['user', 'user'])
    expect(forkedTools.map(tool => tool.name)).toEqual(['Read', 'Bash'])
    expect(forkedPrefix).toMatchObject({
      source: 'fork-shared-prefix',
      sharedPrefixEventCount: 1,
      parentCanonicalPrefixHash: parentPrefix?.canonicalPrefixHash,
      canonicalPrefixHash: parentPrefix?.canonicalPrefixHash,
    })
  })
})
