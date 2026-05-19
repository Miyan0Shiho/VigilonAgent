import type { Readable } from 'node:stream'

export type OperatorShellIO = {
  stdout: Pick<NodeJS.WriteStream, 'write'>
  stderr: Pick<NodeJS.WriteStream, 'write'>
  stdin?: Readable
  env: NodeJS.ProcessEnv
}

export type OperatorShellDeps = {
  createModelClient?: (env: NodeJS.ProcessEnv) => unknown
  runtimeModule?: unknown
}

export type TuiOptions = {
  cwd: string
  sessionsDir?: string
  permissionMode?: string
  maxTurns?: number
  sessionId?: string
  model?: string
  deepseekBaseUrl?: string
}

export type TuiSessionSummary = {
  sessionId: string
  transcriptPath: string
  eventCount: number
  status: string
  createdAt?: string
  updatedAt?: string
  title?: string
  firstUserMessage?: string
  finalMessage?: string
  lastAction?: string
  pendingPlan?: string
  verificationCount: number
  completedTodoCount: number
  remainingTodoCount: number
  backgroundTaskCount: number
  memoryFreshness?: 'fresh' | 'stale'
  hasHandoffReport: boolean
}

export type TuiSessionDetail = {
  session: TuiSessionSummary
  recentEvents: string[]
}

export type TuiToolActivity = {
  id: string
  name: string
  status: 'running' | 'ok' | 'error'
  summary: string
  detail?: string
}

export type TuiHandoff = {
  status: string
  finalMessage: string
  changedFiles: string[]
  verification: string[]
  unverified: string[]
  risks: string[]
  todos: string[]
  transcriptPath: string
  nextAction: string
  missing: boolean
}

export type TuiRuntimeEvent =
  | { type: 'user'; content: string }
  | { type: 'assistant'; content: string; reasoning?: string }
  | { type: 'working'; content: string }
  | { type: 'tool'; activity: TuiToolActivity }
  | { type: 'permission'; lines: string[] }
  | { type: 'ask-user'; lines: string[] }
  | { type: 'hook'; lines: string[] }
  | { type: 'error'; content: string }
  | { type: 'handoff'; handoff: TuiHandoff }

export type TuiTurnResult = {
  sessionId: string
  transcriptPath: string
  events: TuiRuntimeEvent[]
  handoff: TuiHandoff
}

export type TuiRuntimeAdapter = {
  readonly options: TuiOptions
  close(): Promise<void>
  doctor(): Promise<Record<string, unknown>>
  listSessions(): Promise<TuiSessionSummary[]>
  openSession(selector: string): Promise<TuiSessionDetail | null>
  runTask(input: {
    prompt: string
    sessionSelector?: string
    approvePlan?: boolean
    onEvent: (event: TuiRuntimeEvent) => void
  }): Promise<TuiTurnResult>
}
