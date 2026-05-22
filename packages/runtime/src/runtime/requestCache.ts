import { createHash } from 'node:crypto'
import type {
  RequestCachePrefixMetadata,
  RequestCacheSnapshot,
  Tool,
  TranscriptEvent,
} from './contracts.js'

export const REQUEST_CACHE_PREFIX_VERSION = 2
export const REQUEST_CACHE_PREFIX_TAG = 'vigilon-request-cache-prefix-v2'

export function buildRequestCachePrefixMetadata(options: {
  model: string
  visibleEvents: readonly TranscriptEvent[]
  tools: readonly Tool[]
  source?: RequestCachePrefixMetadata['source']
  sharedPrefixEventCount?: number
  parentCanonicalPrefixHash?: string
}): RequestCachePrefixMetadata | undefined {
  if (options.visibleEvents.length === 0) return undefined

  const sharedPrefixEventCount = clampSharedEventCount(
    options.sharedPrefixEventCount ?? options.visibleEvents.length,
    options.visibleEvents.length,
  )
  const canonicalTools = canonicalizeTools(options.tools)
  const canonicalMessages = options.visibleEvents
    .slice(0, sharedPrefixEventCount)
    .map(canonicalizeVisibleEvent)
    .filter((event): event is CanonicalVisibleEvent => event !== null)

  if (canonicalMessages.length === 0) return undefined

  const toolSchemaHash = sha256(stableStringify(canonicalTools))
  const messagePrefixHash = sha256(stableStringify(canonicalMessages))
  const canonicalPrefix = stableStringify({
    tag: REQUEST_CACHE_PREFIX_TAG,
    version: REQUEST_CACHE_PREFIX_VERSION,
    model: options.model,
    tools: canonicalTools,
    messages: canonicalMessages,
  })

  return {
    version: REQUEST_CACHE_PREFIX_VERSION,
    byteIdentical: true,
    source: options.source ?? 'request',
    model: options.model,
    toolSchemaHash,
    messagePrefixHash,
    contentHash: messagePrefixHash,
    canonicalPrefixHash: sha256(canonicalPrefix),
    byteLength: Buffer.byteLength(canonicalPrefix, 'utf8'),
    eventCount: options.visibleEvents.length,
    sharedPrefixEventCount: canonicalMessages.length,
    ...(options.parentCanonicalPrefixHash
      ? { parentCanonicalPrefixHash: options.parentCanonicalPrefixHash }
      : {}),
  }
}

export function buildRequestCacheSnapshot(options: {
  model: string
  visibleEvents: readonly TranscriptEvent[]
  tools: readonly Tool[]
  cachePrefix: RequestCachePrefixMetadata | null
}): RequestCacheSnapshot | undefined {
  if (!options.cachePrefix) return undefined
  return {
    model: options.model,
    visibleEvents: options.visibleEvents.map(cloneVisibleEvent),
    tools: options.tools.map(cloneTool),
    cachePrefix: { ...options.cachePrefix },
  }
}

export function buildForkedRequestEvents(options: {
  parentSnapshot?: RequestCacheSnapshot
  childEvents: readonly TranscriptEvent[]
}): TranscriptEvent[] {
  if (!options.parentSnapshot) return [...options.childEvents]
  return [
    ...options.parentSnapshot.visibleEvents.map(cloneVisibleEvent),
    ...options.childEvents,
  ]
}

export function selectRequestCacheTools(options: {
  parentSnapshot?: RequestCacheSnapshot
  childTools: readonly Tool[]
}): Tool[] {
  return (options.parentSnapshot?.tools ?? options.childTools).map(cloneTool)
}

export function isRequestCachePrefixContent(content: string): boolean {
  return content.includes(REQUEST_CACHE_PREFIX_TAG)
}

export function buildRequestCachePrefixEvent(timestamp: string): Extract<TranscriptEvent, { type: 'user' }> {
  return {
    type: 'user',
    content: `<${REQUEST_CACHE_PREFIX_TAG} version="${REQUEST_CACHE_PREFIX_VERSION}" />`,
    timestamp,
  }
}

export function injectRequestCachePrefix(
  events: readonly TranscriptEvent[],
  _timestamp: string,
): TranscriptEvent[] {
  return [...events]
}

type CanonicalVisibleEvent =
  | { type: 'user'; content: string }
  | { type: 'assistant'; content: string; reasoningContent?: string; toolCalls?: unknown }
  | { type: 'tool-call'; call: unknown }
  | { type: 'tool-result'; result: { toolCallId: string; ok: boolean; content: string; metadata?: unknown } }
  | { type: 'project-config'; config: unknown }
  | { type: 'compact-boundary'; summary: string }

function canonicalizeVisibleEvent(event: TranscriptEvent): CanonicalVisibleEvent | null {
  switch (event.type) {
    case 'user':
      return { type: 'user', content: event.content }
    case 'assistant':
      return {
        type: 'assistant',
        content: event.content,
        ...(event.reasoningContent ? { reasoningContent: event.reasoningContent } : {}),
        ...(event.toolCalls ? { toolCalls: event.toolCalls } : {}),
      }
    case 'tool-call':
      return { type: 'tool-call', call: event.call }
    case 'tool-result':
      return {
        type: 'tool-result',
        result: {
          toolCallId: event.result.toolCallId,
          ok: event.result.ok,
          content: event.result.content,
          ...(event.result.metadata ? { metadata: event.result.metadata } : {}),
        },
      }
    case 'project-config':
      return { type: 'project-config', config: event.config }
    case 'compact-boundary':
      return { type: 'compact-boundary', summary: event.summary }
    default:
      return null
  }
}

function canonicalizeTools(tools: readonly Tool[]): unknown[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputJsonSchema: tool.inputJsonSchema,
    readOnly: tool.readOnly ?? false,
    deferred: tool.deferred ?? false,
  }))
}

function cloneVisibleEvent(event: TranscriptEvent): TranscriptEvent {
  return structuredClone(event)
}

function cloneTool(tool: Tool): Tool {
  return { ...tool, inputJsonSchema: structuredClone(tool.inputJsonSchema) }
}

function clampSharedEventCount(value: number, max: number): number {
  if (!Number.isFinite(value)) return max
  return Math.max(0, Math.min(Math.trunc(value), max))
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)]),
  )
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
