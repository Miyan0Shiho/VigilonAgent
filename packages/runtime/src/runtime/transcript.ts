import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  PermissionMode,
  RuntimeSessionSnapshot,
  RuntimeSessionState,
  RuntimeSessionSummary,
  ResultHandoffReport,
  TodoItem,
  TranscriptEvent,
  TranscriptStore,
} from './contracts.js'

export class InMemoryTranscriptStore implements TranscriptStore {
  readonly sessionId: string
  private events: TranscriptEvent[] = []

  constructor(sessionId = createSessionId()) {
    this.sessionId = sessionId
  }

  async append(event: TranscriptEvent): Promise<void> {
    this.events.push(event)
  }

  async replace(events: TranscriptEvent[]): Promise<void> {
    this.events = [...events]
  }

  async readAll(): Promise<TranscriptEvent[]> {
    return [...this.events]
  }
}

export type JsonlTranscriptStoreOptions = {
  sessionId?: string
  transcriptPath?: string
  sessionsDir?: string
  cwd?: string
}

export class JsonlTranscriptStore implements TranscriptStore {
  readonly sessionId: string
  readonly transcriptPath: string

  constructor(options: JsonlTranscriptStoreOptions = {}) {
    this.sessionId = options.sessionId ?? createSessionId()
    this.transcriptPath =
      options.transcriptPath ??
      getTranscriptPath({
        sessionsDir: options.sessionsDir,
        cwd: options.cwd ?? process.cwd(),
        sessionId: this.sessionId,
      })
  }

  async append(event: TranscriptEvent): Promise<void> {
    await mkdir(path.dirname(this.transcriptPath), { recursive: true })
    await writeFile(this.transcriptPath, `${JSON.stringify(event)}\n`, {
      encoding: 'utf8',
      flag: 'a',
    })
  }

  async replace(events: TranscriptEvent[]): Promise<void> {
    await mkdir(path.dirname(this.transcriptPath), { recursive: true })
    const content =
      events.map(event => JSON.stringify(event)).join('\n') +
      (events.length > 0 ? '\n' : '')
    await writeFile(this.transcriptPath, content, {
      encoding: 'utf8',
    })
  }

  async readAll(): Promise<TranscriptEvent[]> {
    return readTranscriptFile(this.transcriptPath)
  }
}

export function createSessionId(): string {
  return randomUUID()
}

export function createTimestamp(): string {
  return new Date().toISOString()
}

export function getDefaultSessionsDir(): string {
  return path.join(process.cwd(), '.vigilon', 'sessions')
}

export function getProjectSessionDir(
  cwd: string,
  sessionsDir = getDefaultSessionsDir(),
): string {
  const resolved = path.resolve(cwd)
  const sanitized = resolved
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return path.join(sessionsDir, sanitized || 'root')
}

export function getTranscriptPath({
  sessionsDir,
  cwd,
  sessionId,
}: {
  sessionsDir?: string
  cwd: string
  sessionId: string
}): string {
  return path.join(getProjectSessionDir(cwd, sessionsDir), `${sessionId}.jsonl`)
}

export async function readTranscriptFile(
  transcriptPath: string,
): Promise<TranscriptEvent[]> {
  let raw: string
  try {
    raw = await readFile(transcriptPath, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return []
    throw error
  }

  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line) as TranscriptEvent)
}

export async function resumeSessionFromTranscript(
  transcriptPath: string,
): Promise<RuntimeSessionSnapshot> {
  const events = await readTranscriptFile(transcriptPath)
  return {
    sessionId: path.basename(transcriptPath, '.jsonl'),
    transcriptPath,
    events,
    sessionState: restoreSessionStateFromEvents(events),
  }
}

export async function resumeSessionById({
  sessionId,
  cwd,
  sessionsDir,
}: {
  sessionId: string
  cwd: string
  sessionsDir?: string
}): Promise<RuntimeSessionSnapshot> {
  return resumeSessionFromTranscript(
    getTranscriptPath({ sessionsDir, cwd, sessionId }),
  )
}

export async function listSessions({
  cwd,
  sessionsDir,
}: {
  cwd: string
  sessionsDir?: string
}): Promise<RuntimeSessionSummary[]> {
  const projectDir = getProjectSessionDir(cwd, sessionsDir)
  let entries
  try {
    entries = await readdir(projectDir, { withFileTypes: true })
  } catch (error) {
    if (isNotFound(error)) return []
    throw error
  }

  const summaries = await Promise.all(
    entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map(entry => summarizeTranscript(path.join(projectDir, entry.name))),
  )
  return summaries.sort((a, b) =>
    (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
  )
}

export function restoreSessionStateFromEvents(
  events: readonly TranscriptEvent[],
  fallbackPermissionMode: PermissionMode = 'ask',
): RuntimeSessionState {
  const state: RuntimeSessionState = {
    phase: 'execute',
    permissionMode: fallbackPermissionMode,
    prePlanPermissionMode: undefined,
    todos: [],
    approvedPlan: undefined,
    pendingPlan: undefined,
    handoffReport: undefined,
    verificationNotes: [],
    backgroundTasks: [],
    discoveredToolNames: [],
    mcpInstructions: [],
    memoryFreshness: undefined,
  }

  for (const event of events) {
    if (event.type === 'compact-boundary') {
      if (event.metadata.phase) {
        state.phase = event.metadata.phase
      }
      if (event.metadata.permissionMode) {
        state.permissionMode = event.metadata.permissionMode
      }
      if (event.metadata.prePlanPermissionMode) {
        state.prePlanPermissionMode = event.metadata.prePlanPermissionMode
      }
      if (event.metadata.discoveredToolNames) {
        state.discoveredToolNames = [...event.metadata.discoveredToolNames]
      }
      if (event.metadata.todos) {
        state.todos = cloneTodos(event.metadata.todos)
      }
      if (event.metadata.approvedPlan) {
        state.approvedPlan = event.metadata.approvedPlan
      }
      if (event.metadata.pendingPlan) {
        state.pendingPlan = event.metadata.pendingPlan
      }
      if (event.metadata.verificationNotes) {
        state.verificationNotes = [...event.metadata.verificationNotes]
      }
      if (event.metadata.mcpInstructions) {
        state.mcpInstructions = [...event.metadata.mcpInstructions]
      }
      if (event.metadata.memoryFreshness) {
        state.memoryFreshness = event.metadata.memoryFreshness
      }
      continue
    }

    if (event.type === 'session-state') {
      state.phase = event.phase
      if (event.permissionMode) state.permissionMode = event.permissionMode
      if (event.prePlanPermissionMode !== undefined) {
        state.prePlanPermissionMode =
          event.prePlanPermissionMode === null
            ? undefined
            : event.prePlanPermissionMode
      }
      if (event.todos) state.todos = cloneTodos(event.todos)
      if (event.approvedPlan !== undefined) {
        state.approvedPlan =
          event.approvedPlan === null ? undefined : event.approvedPlan
      }
      if (event.pendingPlan !== undefined) {
        state.pendingPlan =
          event.pendingPlan === null ? undefined : event.pendingPlan
      }
      if (event.handoffReport !== undefined) {
        state.handoffReport =
          event.handoffReport === null
            ? undefined
            : cloneHandoffReport(event.handoffReport)
      }
      if (event.verificationNotes) {
        state.verificationNotes = [...event.verificationNotes]
      }
      if (event.backgroundTasks) {
        state.backgroundTasks = [...event.backgroundTasks]
      }
      if (event.discoveredToolNames) {
        state.discoveredToolNames = [...event.discoveredToolNames]
      }
      if (event.mcpInstructions) {
        state.mcpInstructions = [...event.mcpInstructions]
      }
      if (event.memoryFreshness !== undefined) {
        state.memoryFreshness =
          event.memoryFreshness === null ? undefined : event.memoryFreshness
      }
      continue
    }

    if (event.type === 'tool-result' && event.result.metadata?.discoveredTools) {
      const discovered = event.result.metadata.discoveredTools
      if (Array.isArray(discovered)) {
        for (const name of discovered) {
          if (typeof name === 'string' && !state.discoveredToolNames.includes(name)) {
            state.discoveredToolNames.push(name)
          }
        }
      }
    }

    if (event.type === 'tool-call' && event.call.name === 'TodoWrite') {
      const todos = parseTodos(event.call.input)
      if (todos) {
        const allDone =
          todos.length > 0 && todos.every(todo => todo.status === 'completed')
        state.todos = allDone ? [] : cloneTodos(todos)
      }
    }

    if (event.type === 'tool-call' && event.call.name === 'ResultReport') {
      const notes = parseStringArrayField(event.call.input, 'verification_notes')
      if (notes) state.verificationNotes = notes
      const handoffReport = parseHandoffReport(event.call.input)
      if (handoffReport) state.handoffReport = handoffReport
    }
  }

  return state
}

async function summarizeTranscript(
  transcriptPath: string,
): Promise<RuntimeSessionSummary> {
  const events = await readTranscriptFile(transcriptPath)
  const fileStat = await stat(transcriptPath)
  return {
    sessionId: path.basename(transcriptPath, '.jsonl'),
    transcriptPath,
    eventCount: events.length,
    createdAt: events[0]?.timestamp,
    updatedAt: events.at(-1)?.timestamp ?? fileStat.mtime.toISOString(),
    firstUserMessage: events.find(event => event.type === 'user')?.content,
  }
}

function parseTodos(input: unknown): TodoItem[] | undefined {
  if (!input || typeof input !== 'object') return undefined
  const todos = (input as Record<string, unknown>).todos
  if (!Array.isArray(todos)) return undefined
  const parsed: TodoItem[] = []
  for (const todo of todos) {
    if (!todo || typeof todo !== 'object') continue
    const value = todo as Record<string, unknown>
    if (
      typeof value.id !== 'string' ||
      typeof value.content !== 'string' ||
      !(
        value.status === 'pending' ||
        value.status === 'in_progress' ||
        value.status === 'completed'
      )
    ) {
      continue
    }
    parsed.push({
      id: value.id,
      content: value.content,
      status: value.status,
      activeForm:
        typeof value.activeForm === 'string' ? value.activeForm : undefined,
    })
  }
  return parsed
}

function parseStringArrayField(
  input: unknown,
  field: string,
): string[] | undefined {
  if (!input || typeof input !== 'object') return undefined
  const value = (input as Record<string, unknown>)[field]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined
}

function cloneTodos(todos: readonly TodoItem[]): TodoItem[] {
  return todos.map(todo => ({ ...todo }))
}

function cloneHandoffReport(report: ResultHandoffReport): ResultHandoffReport {
  return {
    finalMessage: report.finalMessage,
    changes: [...report.changes],
    verified: [...report.verified],
    unverified: [...report.unverified],
    risks: [...report.risks],
  }
}

function parseHandoffReport(input: unknown): ResultHandoffReport | undefined {
  if (!input || typeof input !== 'object') return undefined
  const value = input as Record<string, unknown>
  const finalMessage = value.final_message
  const changes = parseStringArrayField(input, 'changes')
  const verified = parseStringArrayField(input, 'verification_notes')
  const unverified = parseStringArrayField(input, 'unverified')
  const risks = parseStringArrayField(input, 'risks')
  if (
    typeof finalMessage !== 'string' ||
    !changes ||
    !verified ||
    !unverified ||
    !risks
  ) {
    return undefined
  }
  return { finalMessage, changes, verified, unverified, risks }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
