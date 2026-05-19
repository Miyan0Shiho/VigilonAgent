import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { RuntimeSessionSnapshot, TranscriptEvent } from './contracts.js'
import { getTranscriptPath } from './transcript.js'

const SESSION_MEMORY_HEADER_PREFIX = '<!-- vigilon_session_memory '
const SESSION_MEMORY_HEADER_SUFFIX = ' -->'

export type SessionMemoryRecord = {
  sessionId: string
  generatedAt: string
  sourceEventCount: number
  content: string
}

export function getSessionMemoryPath(options: {
  sessionId: string
  cwd: string
  sessionsDir?: string
  transcriptPath?: string
}): string {
  if (options.transcriptPath) {
    return options.transcriptPath.replace(/\.jsonl$/, '.memory.md')
  }
  return getTranscriptPath({
    cwd: options.cwd,
    sessionsDir: options.sessionsDir,
    sessionId: options.sessionId,
  }).replace(/\.jsonl$/, '.memory.md')
}

export async function writeSessionMemory(
  filePath: string,
  record: SessionMemoryRecord,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const metadata = JSON.stringify({
    sessionId: record.sessionId,
    generatedAt: record.generatedAt,
    sourceEventCount: record.sourceEventCount,
  })
  const content = [
    `${SESSION_MEMORY_HEADER_PREFIX}${metadata}${SESSION_MEMORY_HEADER_SUFFIX}`,
    record.content.trim(),
    '',
  ].join('\n')
  await writeFile(filePath, content, 'utf8')
}

export async function readSessionMemory(
  filePath: string,
): Promise<SessionMemoryRecord | null> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }

  const [headerLine = '', ...rest] = raw.split(/\r?\n/)
  if (
    !headerLine.startsWith(SESSION_MEMORY_HEADER_PREFIX) ||
    !headerLine.endsWith(SESSION_MEMORY_HEADER_SUFFIX)
  ) {
    return null
  }
  const metadata = JSON.parse(
    headerLine.slice(
      SESSION_MEMORY_HEADER_PREFIX.length,
      headerLine.length - SESSION_MEMORY_HEADER_SUFFIX.length,
    ),
  ) as Omit<SessionMemoryRecord, 'content'>

  return {
    ...metadata,
    content: rest.join('\n').trim(),
  }
}

export function isSessionMemoryFresh(
  memory: SessionMemoryRecord,
  eventCount: number,
): boolean {
  return memory.sourceEventCount === eventCount
}

export function generateSessionMemoryFromSnapshot(
  snapshot: RuntimeSessionSnapshot,
): SessionMemoryRecord {
  const latestUserMessage =
    [...snapshot.events]
      .reverse()
      .find((event): event is Extract<TranscriptEvent, { type: 'user' }> => event.type === 'user')
      ?.content ?? 'Unknown task'

  const importantFiles = collectRecentFilePaths(snapshot.events)
  const todos =
    snapshot.sessionState.todos.length > 0
      ? snapshot.sessionState.todos
          .map(todo => `- [${todo.status}] ${todo.content}`)
          .join('\n')
      : '- None'
  const verificationNotes =
    snapshot.sessionState.verificationNotes.length > 0
      ? snapshot.sessionState.verificationNotes.map(note => `- ${note}`).join('\n')
      : '- None'

  const content = [
    '## Current Task',
    latestUserMessage,
    '',
    '## Current State',
    snapshot.sessionState.approvedPlan ?? 'No approved plan yet.',
    '',
    '## Todo State',
    todos,
    '',
    '## Verification Notes',
    verificationNotes,
    '',
    '## Important Files',
    importantFiles.length > 0 ? importantFiles.map(file => `- ${file}`).join('\n') : '- None',
    '',
    '## Next Step',
    'Resume the task from the latest confirmed state and verify before reporting completion.',
  ].join('\n')

  return {
    sessionId: snapshot.sessionId,
    generatedAt: new Date().toISOString(),
    sourceEventCount: snapshot.events.length,
    content,
  }
}

export function buildSessionMemoryInjection(
  memory: SessionMemoryRecord,
  freshness: 'fresh' | 'stale',
): Extract<TranscriptEvent, { type: 'user' }> {
  return {
    type: 'user',
    content: [
      `<vigilon_session_memory source="manual" freshness="${freshness}" session_id="${escapeAttribute(memory.sessionId)}">`,
      memory.content,
      '</vigilon_session_memory>',
    ].join('\n'),
    timestamp: memory.generatedAt,
  }
}

function collectRecentFilePaths(events: readonly TranscriptEvent[]): string[] {
  const files = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool-result') continue
    const filePath = event.result.metadata?.filePath
    if (typeof filePath === 'string') files.add(filePath)
    if (files.size >= 5) break
  }
  return [...files]
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
