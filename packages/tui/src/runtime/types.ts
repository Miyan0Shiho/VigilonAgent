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

export type TuiAgentDefinitionRow = {
  name: string
  source: string
  sourceScope?: string
  description: string
  active: boolean
  overriddenBy?: string
  allowedTools?: string[]
  background?: boolean
  host?: string
}

export type TuiAgentTaskRow = {
  sessionId: string
  id: string
  agentName?: string
  status?: string
  background?: boolean
  transcriptPath?: string
  terminalReason?: string
  outputSummary?: string
  worktreeDiff?: {
    status: string
	    filesChanged: number
	    additions: number
	    deletions: number
	    patchPath?: string
	    changedFiles?: string[]
	    sourceApply?: {
      status: string
      filesChanged: number
      appliedAt?: string
      conflicts?: string[]
      error?: string
    }
  }
}

export type TuiAgentDetail = {
  parentSessionId: string
  task: TuiAgentTaskRow
  transcriptPath?: string
  recentEvents: string[]
  lifecycleEvents: string[]
  permissionSummary?: TuiPermissionOriginSummary
  resumeResult?: {
    status: string
    finalMessage: string
  }
  stopResult?: {
    ok: boolean
    message: string
  }
  applyResult?: {
    status: string
    message: string
  }
}

export type TuiPermissionOriginSummary = {
  totalRequests: number
  allowed: number
  denied: number
  actions: Array<{
    action: string
    count: number
    allowed: number
    denied: number
  }>
  risks: Array<{
    risk: string
    count: number
    allowed: number
    denied: number
  }>
  agents: Array<{
    agentId: string
    agentRole: string
    parentAgentId?: string
    count: number
    allowed: number
    denied: number
    tools: string[]
  }>
  tools: Array<{
    toolName: string
    count: number
    allowed: number
    denied: number
  }>
  resolutionSources: Array<{
    source: string
    count: number
  }>
  latest?: {
    timestamp: string
    action: string
    subject: string
    risk: string
    allowed: boolean
    reason: string
    origin?: {
      agentId: string
      agentRole: string
      toolName?: string
      parentAgentId?: string
    }
  }
}

export type TuiAgentTaskNotification = {
  sessionId?: string
  taskId: string
  agentName?: string
  status: string
  background: boolean
  transcriptPath?: string
  terminalReason?: string
	  outputSummary?: string
	  completedAt?: string
	  replayed?: boolean
	  source?: 'live' | 'transcript-replay'
	}

export type TuiAgentView = {
  cwd: string
  sourcePrecedence: string[]
  definitions: TuiAgentDefinitionRow[]
  tasks: TuiAgentTaskRow[]
  detail?: TuiAgentDetail
}

export type TuiCompactMemoryReadiness = {
  before?: 'fresh' | 'stale' | null
  after?: 'fresh' | 'stale' | null
  ready?: boolean
  blockingReasons?: string[]
  validationRequired?: boolean
  refreshed?: boolean
  groundingValidation?: {
    status?: string
    modelId?: string
    reason?: string
    supportedClaims?: string[]
    contradictedClaims?: string[]
    missingClaims?: string[]
  }
  extraction?: {
    status?: string
    trigger?: string
    sourceEventCount?: number
    outputSummary?: string
    errorMessage?: string
  }
}

export type TuiCompactResult = {
  sessionId: string
  transcriptPath?: string
  compacted: boolean
  summarySource?: string
  eventCount?: number
  memoryReadiness?: TuiCompactMemoryReadiness
  boundary?: {
    trigger?: string
    route?: {
      strategy?: string
      reason?: string
    }
    tokenPressure?: {
      tokenCountSource?: string
      estimatedTokens?: number
      tokenBudget?: number
      pressureRatio?: number
      reason?: string
      contextBudget?: {
        source?: string
        modelId?: string
        effectiveInputBudgetTokens?: number
      }
    }
    postCompactCleanup?: {
      completed?: boolean
      cleared?: string[]
    }
    memoryFreshness?: string
    memoryReadiness?: TuiCompactMemoryReadiness
  }
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
  | { type: 'subagent'; status: string; agentName: string; taskId: string; summary: string }
  | { type: 'agent-notification'; notification: TuiAgentTaskNotification }
  | { type: 'permission'; lines: string[] }
  | { type: 'ask-user'; lines: string[] }
  | { type: 'hook'; lines: string[] }
  | { type: 'error'; content: string }
  | { type: 'handoff'; handoff: TuiHandoff }
  | { type: 'cache'; ratio: number }

export type TuiTurnResult = {
  sessionId: string
  transcriptPath: string
  events: TuiRuntimeEvent[]
  handoff: TuiHandoff
}

export type TuiRuntimeAdapter = {
  readonly options: TuiOptions
  close(): Promise<void>
  subscribeAgentTaskNotifications(listener: (event: TuiRuntimeEvent) => void): () => void
  doctor(): Promise<Record<string, unknown>>
  listSessions(): Promise<TuiSessionSummary[]>
  openSession(selector: string): Promise<TuiSessionDetail | null>
  listAgents(): Promise<TuiAgentView>
  inspectAgentTask(sessionSelector: string, taskId: string): Promise<TuiAgentView | null>
  resumeAgentTask(input: {
    sessionSelector: string
    taskId: string
    prompt: string
  }): Promise<TuiAgentView | null>
  stopAgentTask(sessionSelector: string, taskId: string): Promise<TuiAgentView | null>
  applyAgentTask(sessionSelector: string, taskId: string, args?: string[]): Promise<TuiAgentView | null>
  compactSession(input: {
    sessionSelector: string
    args?: string[]
  }): Promise<TuiCompactResult | null>
  runTask(input: {
    prompt: string
    sessionSelector?: string
    approvePlan?: boolean
    onEvent: (event: TuiRuntimeEvent) => void
  }): Promise<TuiTurnResult>
}
