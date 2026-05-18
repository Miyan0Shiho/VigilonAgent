import type { LSPServerManager } from '../services/lsp/LSPServerManager.js'
import type { DiagnosticFile } from '../services/lsp/LSPDiagnosticRegistry.js'

export type ToolCall = {
  id: string
  name: string
  input: unknown
}

export type ToolInputJsonSchema = {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export type ToolResult = {
  toolCallId: string
  ok: boolean
  content: string
  metadata?: Record<string, unknown>
}

export type ModelRequest = {
  messages: TranscriptEvent[]
  tools: Tool[]
  abortSignal: AbortSignal
}

export type ModelResponse = {
  content: string
  reasoningContent?: string
  toolCalls: ToolCall[]
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error'
  usage?: {
    inputTokens?: number
    outputTokens?: number
  }
}

export type ModelClient = {
  readonly id: string
  createMessage(request: ModelRequest): Promise<ModelResponse>
}

export type PermissionRequest = {
  action:
    | 'read'
    | 'write'
    | 'edit'
    | 'bash'
    | 'network'
    | 'ask-user'
    | 'external-tool'
    | 'plan-approval'
  subject: string
  risk: 'low' | 'medium' | 'high'
  reason: string
}

export type PermissionDecision = {
  allowed: boolean
  reason: string
}

export type PermissionGate = {
  requestPermission(request: PermissionRequest): Promise<PermissionDecision>
}

export type PermissionMode = 'read-only' | 'ask' | 'accept-edits' | 'bypass-local'

export type RuntimePhase = 'execute' | 'plan'

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type TodoItem = {
  id: string
  content: string
  status: TodoStatus
  activeForm?: string
}

export type CompactTrigger = 'manual' | 'auto'

export type CompactMetadata = {
  phase?: RuntimePhase
  permissionMode?: PermissionMode
  prePlanPermissionMode?: PermissionMode
  trigger: CompactTrigger
  preEventCount: number
  messagesSummarized: number
  userContext?: string
  discoveredToolNames?: string[]
  todos?: TodoItem[]
  approvedPlan?: string
  pendingPlan?: string
  verificationNotes?: string[]
  mcpInstructions?: string[]
  memoryFreshness?: 'fresh' | 'stale'
}

export type ContentReplacementRecord = {
  kind: 'tool-result'
  toolCallId: string
  replacement: string
}

export type HookDecision = {
  outcome: 'allow' | 'block'
  reason: string
}

export type PreToolUseHookRequest = {
  hookEventName: 'PreToolUse'
  toolCall: ToolCall
  cwd: string
}

export type PreToolUseHook = {
  readonly name: string
  evaluate(request: PreToolUseHookRequest): Promise<HookDecision>
}

export type RuntimeSkillSource = 'user' | 'project' | 'local' | 'custom'

export type RuntimeSkill = {
  name: string
  description: string
  content: string
  path: string
  root: string
  source: RuntimeSkillSource
  whenToUse?: string
  allowedTools: string[]
  disableModelInvocation: boolean
  userInvocable: boolean
  paths?: string[]
  model?: string
  effort?: string
}

export type RuntimeMcpServerConfig = {
  type?: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
}

export type RuntimeProjectConfig = {
  ignore: string[]
  defaultCommands: Record<string, string>
  allowedTools?: string[]
}

export type AskUserQuestionInput = {
  questions: Array<{
    question: string
    header: string
    options: Array<{
      label: string
      description: string
      preview?: string
    }>
    multiSelect?: boolean
  }>
  answers?: Record<string, string>
  annotations?: Record<
    string,
    {
      preview?: string
      notes?: string
    }
  >
  metadata?: {
    source?: string
  }
}

export type AskUserQuestionOutput = {
  questions: AskUserQuestionInput['questions']
  answers: Record<string, string>
  annotations?: AskUserQuestionInput['annotations']
}

export type RuntimeOperator = {
  askQuestions(input: AskUserQuestionInput): Promise<AskUserQuestionOutput | null>
}

export type WebFetchRuntimeOptions = {
  fetch?: typeof fetch
  maxContentChars?: number
  maxRedirects?: number
}

export type LocalAgentDefinition = {
  name: string
  description: string
  systemPrompt: string
  allowedTools: string[]
  maxTurns: number
}

export type SubagentRunRequest = {
  definition: LocalAgentDefinition
  task: string
  cwd: string
}

export type SubagentRunResult = {
  status: 'completed'
  agentName: string
  transcriptPath: string
  finalMessage: string
  report: ResultReport
}

export type TaskManager = {
  readonly activeTasks: BackgroundTask[]
  startBashTask(command: string, cwd: string): Promise<string>
  killTask(taskId: string): Promise<boolean>
  shutdown(): Promise<void>
}

export type ToolUseContext = {
  cwd: string
  abortSignal: AbortSignal
  permissionGate: PermissionGate
  transcript: TranscriptStore
  sessionState?: RuntimeSessionState
  readFileState?: Map<string, ReadFileStateEntry>
  fileReadingLimits?: FileReadingLimits
  globLimits?: {
    maxResults?: number
  }
  bashLimits?: {
    timeoutMs?: number
    maxOutputChars?: number
  }
  projectConfig?: RuntimeProjectConfig
  operator?: RuntimeOperator
  webFetch?: WebFetchRuntimeOptions
  lspServerManager: LSPServerManager
  taskManager: TaskManager
  runSubagent?: (request: SubagentRunRequest) => Promise<SubagentRunResult>
  tools: {
    list(): Tool[]
    find(name: string): Tool | undefined
  }
}

export type BackgroundTask = {
  id: string
  type: 'bash' | 'subagent'
  command: string
  startTime: string
  process?: any // For local process handle
}

export type RuntimeSessionState = {
  phase: RuntimePhase
  prePlanPermissionMode?: PermissionMode
  permissionMode: PermissionMode
  todos: TodoItem[]
  approvedPlan?: string
  pendingPlan?: string
  handoffReport?: ResultHandoffReport
  verificationNotes: string[]
  backgroundTasks: BackgroundTask[]
  discoveredToolNames: string[]
  mcpInstructions: string[]
  memoryFreshness?: 'fresh' | 'stale'
}

export type ResultHandoffReport = {
  finalMessage: string
  changes: string[]
  verified: string[]
  unverified: string[]
  risks: string[]
}

export type ReadFileStateEntry = {
  content: string
  mtimeMs: number
  offset?: number
  limit?: number
  fullRead?: boolean
}

export type FileReadingLimits = {
  maxSizeBytes?: number
  maxLines?: number
}

export type Tool = {
  readonly name: string
  readonly description: string
  readonly inputJsonSchema?: ToolInputJsonSchema
  readonly readOnly?: boolean
  readonly deferred?: boolean
  invoke(input: unknown, context: ToolUseContext): Promise<ToolResult>
}

export type TranscriptEvent =
  | {
      type: 'user'
      content: string
      timestamp: string
    }
  | {
      type: 'assistant'
      content: string
      reasoningContent?: string
      toolCalls?: ToolCall[]
      timestamp: string
      usage?: ModelResponse['usage']
    }
  | {
      type: 'tool-call'
      call: ToolCall
      timestamp: string
    }
  | {
      type: 'tool-result'
      result: ToolResult
      timestamp: string
    }
  | {
      type: 'permission'
      request: PermissionRequest
      decision: PermissionDecision
      timestamp: string
    }
  | {
      type: 'hook'
      hookEventName: 'PreToolUse'
      hookName: string
      toolCall: ToolCall
      decision: HookDecision
      timestamp: string
    }
  | {
      type: 'session-state'
      phase: RuntimePhase
      permissionMode?: PermissionMode
      prePlanPermissionMode?: PermissionMode | null
      todos?: TodoItem[]
      approvedPlan?: string | null
      pendingPlan?: string | null
      handoffReport?: ResultHandoffReport | null
      verificationNotes?: string[]
      backgroundTasks?: BackgroundTask[]
      discoveredToolNames?: string[]
      mcpInstructions?: string[]
      memoryFreshness?: 'fresh' | 'stale' | null
      timestamp: string
    }
  | {
      type: 'project-config'
      config: RuntimeProjectConfig
      timestamp: string
    }
  | {
      type: 'compact-boundary'
      summary: string
      metadata: CompactMetadata
      timestamp: string
    }
  | {
      type: 'content-replacement'
      replacements: ContentReplacementRecord[]
      timestamp: string
    }
  | {
      type: 'llm-request'
      requestId: string
      previousRequestId: string | null
      model: string
      toolCount: number
      toolSchemaHash: string
      messageCount: number
      modelVisibleEventCount: number
      compacted: boolean
      compactBoundaryIndex?: number
      droppedEventCount: number
      contentReplacementCount: number
      contentReplacementChars: number
      projectConfigHash: string | null
      skillListingHash: string | null
      timestamp: string
    }
  | {
      type: 'llm-response'
      requestId: string
      previousRequestId: string | null
      status: 'ok' | 'error'
      stopReason: ModelResponse['stopReason']
      inputTokens?: number
      outputTokens?: number
      durationMs: number
      toolCallCount: number
      assistantChars: number
      reasoningChars?: number
      errorMessage?: string
      timestamp: string
    }
  | {
      type: 'request-stability'
      requestId: string
      previousRequestId: string | null
      classification: 'expected_reset' | 'expected_change' | 'unexpected_change'
      reasons: string[]
      inputTokensDelta?: number
      inputTokensDeltaRatio?: number
      toolSchemaChanged: boolean
      modelChanged: boolean
      projectConfigChanged: boolean
      skillListingChanged: boolean
      compactionChanged: boolean
      contentReplacementChanged: boolean
      timestamp: string
    }
  | {
      type: 'lsp-diagnostics'
      serverName: string
      files: DiagnosticFile[]
      timestamp: string
    }

export type TranscriptStore = {
  readonly sessionId?: string
  readonly transcriptPath?: string
  append(event: TranscriptEvent): Promise<void>
  replace(events: TranscriptEvent[]): Promise<void>
  readAll(): Promise<TranscriptEvent[]>
}

export type RuntimeSessionSnapshot = {
  sessionId: string
  transcriptPath?: string
  events: TranscriptEvent[]
  sessionState: RuntimeSessionState
}

export type RuntimeSessionSummary = {
  sessionId: string
  transcriptPath: string
  eventCount: number
  createdAt?: string
  updatedAt?: string
  firstUserMessage?: string
}

export type AgentRuntimeTurnInput = {
  prompt: string
  cwd: string
  abortSignal: AbortSignal
}

export type AgentRuntimeTurnResult = {
  finalMessage: string
  events: TranscriptEvent[]
  stopReason: ModelResponse['stopReason']
  turns: number
  report: ResultReport
}

export type ResultReport = {
  status: 'completed' | 'stopped' | 'error'
  finalMessage: string
  todos: TodoItem[]
  approvedPlan?: string
  handoffReport?: ResultHandoffReport
  verificationNotes: string[]
  fileChanges: Array<{
    toolCallId: string
    toolName: string
    filePath: string
    type: 'create' | 'update'
    diff: string
  }>
  toolResults: Array<{
    toolCallId: string
    ok: boolean
    content: string
  }>
}

export type AgentRuntimeEvent =
  | { type: 'model-request-started' }
  | { type: 'model-response-received'; response: ModelResponse }
  | { type: 'tool-started'; call: ToolCall }
  | { type: 'tool-finished'; result: ToolResult }
  | { type: 'turn-finished'; result: AgentRuntimeTurnResult }

export type AgentRuntime = {
  runTurn(input: AgentRuntimeTurnInput): AsyncIterable<AgentRuntimeEvent>
}
