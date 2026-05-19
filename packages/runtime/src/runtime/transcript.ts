import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  ActiveSkillRuntimeState,
  PermissionMode,
  RuntimeSessionSnapshot,
  RuntimeSessionStatus,
  RuntimeSessionState,
  RuntimeSessionSummary,
  ResultHandoffReport,
  TodoItem,
  ToolReferenceDelta,
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
    toolReferenceDeltas: [],
    mcpInstructions: [],
    activeSkill: undefined,
    memoryFreshness: undefined,
    systemPrompt: undefined,
    toolSchema: undefined,
    modelParams: undefined,
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
      if (event.metadata.toolReferenceDeltas) {
        state.toolReferenceDeltas = [...event.metadata.toolReferenceDeltas]
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
      if (event.metadata.activeSkill) {
        state.activeSkill = { ...event.metadata.activeSkill }
      }
      if (event.metadata.memoryFreshness) {
        state.memoryFreshness = event.metadata.memoryFreshness
      }
      if (event.metadata.systemPrompt) {
        state.systemPrompt = event.metadata.systemPrompt
      }
      if (event.metadata.toolSchema) {
        state.toolSchema = event.metadata.toolSchema
      }
      if (event.metadata.modelParams) {
        state.modelParams = { ...event.metadata.modelParams }
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
      if (event.toolReferenceDeltas) {
        state.toolReferenceDeltas = [...event.toolReferenceDeltas]
      }
      if (event.mcpInstructions) {
        state.mcpInstructions = [...event.mcpInstructions]
      }
      if (event.activeSkill !== undefined) {
        state.activeSkill =
          event.activeSkill === null ? undefined : { ...event.activeSkill }
      }
      if (event.memoryFreshness !== undefined) {
        state.memoryFreshness =
          event.memoryFreshness === null ? undefined : event.memoryFreshness
      }
      if (event.systemPrompt !== undefined) {
        state.systemPrompt = event.systemPrompt === null ? undefined : event.systemPrompt
      }
      if (event.toolSchema !== undefined) {
        state.toolSchema = event.toolSchema === null ? undefined : event.toolSchema
      }
      if (event.modelParams !== undefined) {
        state.modelParams = event.modelParams === null ? undefined : { ...event.modelParams }
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

    if (event.type === 'tool-result' && event.result.metadata?.toolReferenceDeltas) {
      const deltas = event.result.metadata.toolReferenceDeltas
      if (Array.isArray(deltas)) {
        state.toolReferenceDeltas = [
          ...state.toolReferenceDeltas,
          ...deltas.filter(isToolReferenceDelta),
        ]
      }
    }

    if (event.type === 'tool-result' && event.result.metadata?.activeSkill) {
      const activeSkill = event.result.metadata.activeSkill
      if (isActiveSkillRuntimeState(activeSkill)) {
        state.activeSkill = activeSkill
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
  const sessionState = restoreSessionStateFromEvents(events)
  const firstUserMessage = events.find(event => event.type === 'user')?.content
  const finalAssistantMessage = [...events]
    .reverse()
    .find(event => event.type === 'assistant') as
    | Extract<TranscriptEvent, { type: 'assistant' }>
    | undefined
  const completedTodoCount = sessionState.todos.filter(
    todo => todo.status === 'completed',
  ).length
  const remainingTodoCount = sessionState.todos.filter(
    todo => todo.status !== 'completed',
  ).length
  return {
    sessionId: path.basename(transcriptPath, '.jsonl'),
    transcriptPath,
    eventCount: events.length,
    status: deriveSessionStatus(events, sessionState),
    createdAt: events[0]?.timestamp,
    updatedAt: events.at(-1)?.timestamp ?? fileStat.mtime.toISOString(),
    title: buildSessionTitle(firstUserMessage),
    firstUserMessage,
    finalMessage: finalAssistantMessage?.content,
    lastAction: buildLastAction(events, sessionState),
    pendingPlan: sessionState.pendingPlan,
    verificationCount: sessionState.verificationNotes.length,
    completedTodoCount,
    remainingTodoCount,
    backgroundTaskCount: sessionState.backgroundTasks.length,
    memoryFreshness: sessionState.memoryFreshness,
    hasHandoffReport: Boolean(sessionState.handoffReport),
  }
}

function deriveSessionStatus(
  events: readonly TranscriptEvent[],
  sessionState: RuntimeSessionState,
): RuntimeSessionStatus {
  if (sessionState.backgroundTasks.length > 0) return 'running'
  if (sessionState.phase === 'plan' && sessionState.pendingPlan) {
    return 'waiting_approval'
  }

  const lastResponse = [...events]
    .reverse()
    .find(event => event.type === 'llm-response') as
    | Extract<TranscriptEvent, { type: 'llm-response' }>
    | undefined
  if (lastResponse?.status === 'error' || lastResponse?.stopReason === 'error') {
    return 'failed'
  }

  const lastToolResult = [...events]
    .reverse()
    .find(event => event.type === 'tool-result') as
    | Extract<TranscriptEvent, { type: 'tool-result' }>
    | undefined
  if (lastToolResult && !lastToolResult.result.ok) {
    return 'recoverable'
  }

  if (sessionState.handoffReport) return 'completed'
  return events.length > 0 ? 'recoverable' : 'running'
}

function buildSessionTitle(message: string | undefined): string | undefined {
  if (!message) return undefined
  const singleLine = message.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= 72) return singleLine
  return `${singleLine.slice(0, 69)}...`
}

function buildLastAction(
  events: readonly TranscriptEvent[],
  sessionState: RuntimeSessionState,
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type === 'tool-result') {
      return event.result.ok
        ? `Tool ${event.result.toolCallId || 'result'} succeeded`
        : `Tool ${event.result.toolCallId || 'result'} failed: ${event.result.content}`
    }
    if (event.type === 'tool-call') {
      return `Tool ${event.call.name} started`
    }
    if (event.type === 'permission') {
      return event.decision.allowed
        ? `Permission allowed: ${event.request.action}`
        : `Permission denied: ${event.request.action}`
    }
    if (event.type === 'assistant' && event.content.trim()) {
      return buildSessionTitle(event.content)
    }
  }
  if (sessionState.pendingPlan) return 'Waiting for plan approval'
  return undefined
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

function isToolReferenceDelta(value: unknown): value is ToolReferenceDelta {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.name === 'string' &&
    typeof record.reason === 'string' &&
    typeof record.schemaHash === 'string' &&
    typeof record.discoveredAt === 'string'
  )
}

function isActiveSkillRuntimeState(value: unknown): value is ActiveSkillRuntimeState {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.name === 'string' &&
    Array.isArray(record.allowedTools) &&
    record.allowedTools.every(item => typeof item === 'string') &&
    typeof record.activatedAt === 'string'
  )
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
