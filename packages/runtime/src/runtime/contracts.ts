import type { LSPServerManager } from '../services/lsp/LSPServerManager.js'
import type { DiagnosticFile } from '../services/lsp/LSPDiagnosticRegistry.js'
import type {
  PermissionRequest,
  PermissionDecision,
  PermissionGate,
  PermissionResolutionMetadata,
  PermissionOrigin,
  PermissionOriginActionSummary,
  PermissionOriginRiskSummary,
  PermissionOriginAgentSummary,
  PermissionOriginToolSummary,
  PermissionResolutionSourceSummary,
  PermissionOriginLatestRequest,
  PermissionOriginSummary,
  PermissionPolicyMetadata,
  PermissionMode,
} from './contracts/permission.js'

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
  toolChoice?: 'auto' | 'none' | { type: 'tool'; name: string }
  cachePrefix?: RequestCachePrefixMetadata
  abortSignal: AbortSignal
  systemPrompt?: string
  model?: string
  thinking?: 'off' | 'high'
}

export type ModelTokenCountRequest = ModelRequest

export type RequestCachePrefixMetadata = {
  version: number
  byteIdentical: true
  source: 'request' | 'fork-shared-prefix'
  model: string
  toolSchemaHash: string
  messagePrefixHash: string
  contentHash: string
  canonicalPrefixHash: string
  byteLength: number
  eventCount: number
  sharedPrefixEventCount: number
  parentCanonicalPrefixHash?: string
}

export type RequestCacheSnapshot = {
  model: string
  visibleEvents: TranscriptEvent[]
  tools: Tool[]
  cachePrefix: RequestCachePrefixMetadata
}

export type ModelResponse = {
  content: string
  reasoningContent?: string
  toolCalls: ToolCall[]
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'max_turns' | 'error'
  usage?: ModelUsage
}

export type ModelUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  cacheHitRatio?: number
}

export type ModelClient = {
  readonly id: string
  createMessage(request: ModelRequest): Promise<ModelResponse>
  countInputTokens?(
    request: ModelTokenCountRequest,
  ): Promise<ModelTokenCountResult>
}

export type ModelTokenCountFailureKind =
  | 'missing_credentials'
  | 'context_overflow'
  | 'provider_error'
  | 'aborted'
  | 'usage_unavailable'
  | 'unsupported'

export type ModelTokenCountResult =
  | {
      ok: true
      source: 'provider-chat-completion-usage'
      inputTokens: number
      usage?: ModelUsage
    }
  | {
      ok: false
      source: 'provider-chat-completion-usage' | 'unsupported'
      errorKind: ModelTokenCountFailureKind
      errorMessage: string
    }

export type {
  PermissionRequest,
  PermissionDecision,
  PermissionGate,
  PermissionResolutionMetadata,
  PermissionOrigin,
  PermissionOriginActionSummary,
  PermissionOriginRiskSummary,
  PermissionOriginAgentSummary,
  PermissionOriginToolSummary,
  PermissionResolutionSourceSummary,
  PermissionOriginLatestRequest,
  PermissionOriginSummary,
  PermissionPolicyMetadata,
  PermissionMode,
} from './contracts/permission.js'

export type RuntimePhase = 'execute' | 'plan'

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type TodoItem = {
  id: string
  content: string
  status: TodoStatus
  activeForm?: string
}

export type CompactTrigger = 'manual' | 'auto'
export type CompactStrategy = 'session-memory' | 'reactive' | 'legacy'
export type CompactQuerySource = 'main' | 'compact' | 'session_memory' | `agent:${string}`

export type CompactRouteMetadata = {
  strategy: CompactStrategy
  trigger: CompactTrigger
  querySource: CompactQuerySource
  reason: string
  fallbacks: CompactStrategy[]
}

export type CompactPreservedSegmentMetadata = {
  requestedSplitIndex: number
  adjustedSplitIndex: number
  summarizedEventCount: number
  preservedEventCount: number
  eventRefStrategy: 'deterministic-event-fingerprint'
  headEventIndex?: number
  headEventRef?: CompactPreservedEventRefMetadata
  anchorEventIndex?: number
  anchorEventRef?: CompactPreservedEventRefMetadata
  tailEventIndex?: number
  tailEventRef?: CompactPreservedEventRefMetadata
  apiInvariantAdjusted: boolean
}

export type CompactPreservedEventRefMetadata = {
  role: 'head' | 'anchor' | 'tail'
  eventId: string
  eventIndex: number
  eventType: TranscriptEvent['type']
  timestamp?: string
}

export type CompactTokenPressureMetadata = {
  estimatedTokens: number
  tokenBudget: number
  pressureRatio: number
  pressureThreshold: number
  eventsMeasured: number
  charsMeasured: number
  tokenCountSource:
    | 'runtime-char-estimate'
    | 'provider-usage-plus-delta-estimate'
    | 'provider-input-token-preflight'
    | 'provider-context-overflow-preflight'
  reason: 'token_pressure_exceeded' | 'below_token_pressure'
  contextBudget?: CompactContextWindowBudgetMetadata
}

export type CompactTokenPreflightMetadata =
  | {
      status: 'ok'
      source: 'model-client-count-input-tokens'
      modelId: string
      provider?: string
      requestEventCount: number
      toolCount: number
      inputTokens: number
      totalTokens?: number
      cacheReadInputTokens?: number
      cacheCreationInputTokens?: number
    }
  | {
      status: 'context-overflow'
      source: 'model-client-count-input-tokens'
      modelId: string
      provider?: string
      requestEventCount: number
      toolCount: number
      errorMessage: string
    }
  | {
      status: 'failed'
      source: 'model-client-count-input-tokens'
      modelId: string
      provider?: string
      requestEventCount: number
      toolCount: number
      errorKind: Exclude<ModelTokenCountFailureKind, 'context_overflow'>
      errorMessage: string
    }

export type CompactTokenEstimatorMetadata =
  | {
      kind: 'char-estimate'
      charsPerToken: number
      source: 'runtime-heuristic'
      preflightFailure?: {
        source: 'model-client-count-input-tokens'
        modelId: string
        provider?: string
        requestEventCount: number
        toolCount: number
        errorKind: string
        errorMessage: string
      }
    }
  | {
      kind: 'provider-usage-plus-delta-estimate'
      source: 'transcript-llm-response-usage'
      modelId: string
      provider?: string
      requestId: string
      responseEventIndex: number
      baseInputTokens?: number
      baseOutputTokens?: number
      baseTotalTokens?: number
      baseCacheReadInputTokens?: number
      baseCacheCreationInputTokens?: number
      baseContextTokens: number
      deltaEventCount: number
      deltaChars: number
      deltaEstimatedTokens: number
      deltaEstimator: {
        kind: 'char-estimate'
        charsPerToken: number
        source: 'runtime-heuristic'
      }
    }
  | {
      kind: 'provider-input-token-preflight'
      source: 'model-client-count-input-tokens'
      modelId: string
      provider?: string
      requestEventCount: number
      toolCount: number
      inputTokens: number
      totalTokens?: number
      cacheReadInputTokens?: number
      cacheCreationInputTokens?: number
    }
  | {
      kind: 'provider-context-overflow-preflight'
      source: 'model-client-count-input-tokens'
      modelId: string
      provider?: string
      requestEventCount: number
      toolCount: number
      errorMessage: string
    }

export type CompactContextWindowBudgetMetadata = {
  source:
    | 'explicit-token-budget'
    | 'model-context-window'
    | 'runtime-default-token-budget'
  modelId: string
  provider?: string
  contextWindowTokens: number | null
  reservedOutputTokens: number
  reservedSystemTokens: number
  reservedToolSchemaTokens: number
  safetyMarginTokens: number
  effectiveInputBudgetTokens: number
  pressureThreshold: number
  estimator: CompactTokenEstimatorMetadata
}

export type CompactMemoryReadinessMetadata = {
  before: 'fresh' | 'stale' | null
  after: 'fresh' | 'stale' | null
  ready: boolean
  blockingReasons: string[]
  validationRequired: boolean
  refreshed: boolean
  memoryPath: string
  manifestPath: string
  groundingValidation?: MemoryGroundingValidationMetadata
  extraction?: {
    jobId: string
    status: 'queued' | 'running' | 'completed' | 'failed' | 'skipped'
    trigger: 'manual' | 'compact' | 'auto' | 'runtime' | 'probe'
    queuedAt: string
    startedAt?: string
    completedAt?: string
    statusPath: string
    sourceEventCount: number
    outputSummary?: string
    errorMessage?: string
  }
}

export type MemoryGroundingStatus = 'supported' | 'contradicted' | 'unknown'

export type MemoryGroundingValidationMetadata = {
  kind: 'vigilon.session-memory-grounding'
  version: 1
  status: MemoryGroundingStatus
  modelId: string
  validatedAt: string
  memorySourceEventCount: number
  currentEventCount: number
  semanticDriftStatus: 'none' | 'changed' | 'unknown'
  changedAnchors: string[]
  evidenceEventCount: number
  supportedClaims: string[]
  contradictedClaims: string[]
  missingClaims: string[]
  reason: string
  usage?: ModelUsage
}

export type RuntimeStateScope = 'main' | `agent:${string}`

export type PostCompactCleanupTarget =
  | 'lsp-open-file-state'
  | 'read-file-state'
  | 'context-window'
  | 'content-replacement-window'
  | 'capability-replay'
  | 'compact-state'

export type PostCompactCleanupAction = 'cleared' | 'preserved' | 'scheduled'

export type PostCompactCleanupPolicy =
  | 'rebuild-after-compact'
  | 'preserve-safety-state'
  | 'replay-after-compact'
  | 'discard-after-boundary'

export type PostCompactCleanupOperation = {
  target: PostCompactCleanupTarget
  scope: RuntimeStateScope
  action: PostCompactCleanupAction
  policy: PostCompactCleanupPolicy
  beforeCount?: number
  afterCount?: number
  reason: string
}

export type PostCompactCleanupMetadata = {
  required: boolean
  completed: boolean
  cleared: string[]
  operations?: PostCompactCleanupOperation[]
}

export type CompactMetadata = {
  phase?: RuntimePhase
  permissionMode?: PermissionMode
  prePlanPermissionMode?: PermissionMode
  trigger: CompactTrigger
  preEventCount: number
  messagesSummarized: number
  compactRoute?: CompactRouteMetadata
  tokenPressure?: CompactTokenPressureMetadata
  memoryReadiness?: CompactMemoryReadinessMetadata
  preservedSegment?: CompactPreservedSegmentMetadata
  postCompactCleanup?: PostCompactCleanupMetadata
  userContext?: string
  discoveredToolNames?: string[]
  toolReferenceDeltas?: ToolReferenceDelta[]
  todos?: TodoItem[]
  approvedPlan?: string
  pendingPlan?: string
  verificationNotes?: string[]
  mcpInstructions?: string[]
  activeSkill?: ActiveSkillRuntimeState
  memoryFreshness?: 'fresh' | 'stale'
  systemPrompt?: string
  toolSchema?: string
  modelParams?: Record<string, unknown>
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
  cache?: Map<string, WebFetchCacheEntry>
  summarize?: (input: {
    url: string
    content: string
    maxChars: number
  }) => Promise<string>
}

export type WebFetchCacheEntry = {
  url: string
  fetchedAt: string
  code: number
  codeText: string
  content: string
  bytes: number
}

export type LocalAgentDefinition = {
  name: string
  description: string
  systemPrompt: string
  allowedTools: string[]
  maxTurns: number
  source: AgentDefinitionSource
  sourceScope?: string
  sourcePath?: string
  permissionMode?: PermissionMode
  model?: string
  effort?: 'low' | 'medium' | 'high' | 'xhigh'
  memory?: 'inherit' | 'none'
  background?: boolean
  host?: SubagentHostKind
}

export type SubagentHostKind = 'local' | 'worktree' | 'git-worktree'

export type AgentDefinitionSource =
  | 'built-in'
  | 'plugin'
  | 'user'
  | 'project'
  | 'local'
  | 'flag'
  | 'managed'

export type AgentCatalogEntry = {
  definition: LocalAgentDefinition
  overriddenBy?: AgentDefinitionSource
}

export type AgentCatalog = {
  active: LocalAgentDefinition[]
  entries: AgentCatalogEntry[]
  precedence: AgentDefinitionSource[]
}

export type SubagentMemorySnapshot = {
  freshness?: 'fresh' | 'stale'
  summary?: string
  sourceEventCount?: number
  generatedAt?: string
  longTerm?: {
    indexPath: string
    manifestPath: string
    entryCount: number
    entries: Array<{
      id: string
      kind: 'user' | 'project' | 'organization' | 'agent' | 'tool' | 'feedback' | 'reference'
      topic: string
      content: string
      createdAt: string
      sourceSessionId?: string
    }>
  }
}

export type SubagentTaskHost = {
  taskId: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  background: boolean
  transcriptPath: string
  cwd?: string
  host?: SubagentHostKind
  worktreePath?: string
  gitWorktree?: SubagentGitWorktreeMetadata
  sourceCwd?: string
  worktreeDiff?: SubagentWorktreeDiff
  startedAt: string
  completedAt?: string
  registeredWithTaskManager?: boolean
  stopPath?: 'shared-task-manager'
  stopRequestPath?: string
  stopRequestedAt?: string
}

export type SubagentWorktreeDiff = {
  strategy: 'copy-baseline-diff' | 'git-worktree-diff'
  status: 'clean' | 'changed' | 'failed'
  sourceCwd: string
  baselinePath: string
  baselineRef?: string
  worktreePath: string
  patchPath: string
  gitWorktree?: SubagentGitWorktreeMetadata
  filesChanged: number
  additions: number
  deletions: number
  changedFiles: Array<{
    path: string
    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typechange' | 'unknown'
  }>
  sourceApply?: SubagentWorktreeApply
  error?: string
}

export type SubagentWorktreeApply = {
  strategy: 'git-apply-after-baseline-check'
  mode: 'check' | 'apply' | 'rollback'
  status: 'clean' | 'checked' | 'applied' | 'rolled_back' | 'conflict' | 'failed'
  sourceCwd: string
  baselinePath: string
  baselineRef?: string
  worktreePath: string
  patchPath: string
  gitWorktree?: SubagentGitWorktreeMetadata
  threeWay: boolean
  filesChanged: number
  checkedFiles: string[]
  requestedFiles?: string[]
  appliedFiles: string[]
  skippedFiles: string[]
  appliedAt: string
  conflicts?: string[]
  conflictDetails?: Array<{
    path: string
    reason: 'source_changed_from_baseline' | 'apply_check_failed' | 'unsafe_path' | 'missing_from_diff'
    detail?: string
  }>
  error?: string
}

export type SubagentGitWorktreeMetadata = {
  gitRoot: string
  worktreePath: string
  branchName: string
  baseHead: string
  baseBranch?: string
}

export type SubagentLifecycleStatus =
  | 'started'
  | 'model-request-started'
  | 'model-response-received'
  | 'tool-started'
  | 'tool-finished'
  | 'running-handoff'
  | 'completed'
  | 'failed'
  | 'stopped'

export type SubagentLifecycleEvent = {
  taskId: string
  agentName: string
  status: SubagentLifecycleStatus
  background: boolean
  transcriptPath: string
  cwd?: string
  host?: SubagentHostKind
  worktreePath?: string
  gitWorktree?: SubagentGitWorktreeMetadata
  sourceCwd?: string
  worktreeDiff?: SubagentWorktreeDiff
  parentAgentId?: string
  timestamp: string
  summary?: string
  finalMessage?: string
  toolCallId?: string
  toolName?: string
  toolOk?: boolean
  modelId?: string
  stopReason?: ModelResponse['stopReason']
  toolCallCount?: number
}

export type SubagentLifecycleSink = {
  emit(event: SubagentLifecycleEvent): void | Promise<void>
}

export type SubagentRunRequest = {
  definition: LocalAgentDefinition
  task: string
  cwd: string
  catalog?: AgentCatalog
  memorySnapshot?: SubagentMemorySnapshot
  parentAgentId?: string
  lifecycle?: SubagentLifecycleSink
  requestCacheSnapshot?: RequestCacheSnapshot
}

export type SubagentRunResult = {
  status: 'running' | 'completed' | 'stopped' | 'failed'
  agentName: string
  transcriptPath: string
  finalMessage: string
  report: ResultReport
  taskHost: SubagentTaskHost
  permissionOrigin: PermissionOrigin
  memorySnapshot?: SubagentMemorySnapshot
  catalog?: AgentCatalog
}

export type TaskManager = {
  readonly activeTasks: BackgroundTask[]
  readonly retainedTasks: BackgroundTask[]
  subscribe(listener: (event: TaskManagerEvent) => void): () => void
  startBashTask(command: string, cwd: string): Promise<string>
  startSubagentTask(task: {
    taskId: string
    agentName: string
    transcriptPath: string
    cwd: string
    host?: SubagentHostKind
    worktreePath?: string
    gitWorktree?: SubagentGitWorktreeMetadata
    sourceCwd?: string
    background: boolean
    parentAgentId?: string
    parentSessionId?: string
    stopRequestPath?: string
    abortController: AbortController
  }): Promise<string>
  completeTask(taskId: string, terminal?: TaskTerminalUpdate): Promise<boolean>
  stopTask(taskId: string): Promise<boolean>
  killTask(taskId: string): Promise<boolean>
  shutdown(): Promise<void>
}

export type TaskManagerEvent = {
  type: 'task-terminal'
  task: BackgroundTask
  terminal: TaskTerminalUpdate
  timestamp: string
}

export type TaskTerminalUpdate = {
  status: Exclude<NonNullable<BackgroundTask['status']>, 'running'>
  terminalReason: string
  outputSummary?: string
  completedAt?: string
  worktreeDiff?: SubagentWorktreeDiff
  stopRequestedAt?: string
}

export type ToolUseContext = {
  cwd: string
  abortSignal: AbortSignal
  permissionGate: PermissionGate
  transcript: TranscriptStore
  sessionState?: RuntimeSessionState
  permissionOrigin?: PermissionOrigin
  readFileState?: Map<string, ReadFileStateEntry>
  lspOpenFileState?: Set<string>
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
  subagentLifecycle?: SubagentLifecycleSink
  requestCacheSnapshot?: RequestCacheSnapshot
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
  status?: 'running' | 'completed' | 'failed' | 'stopped'
  background?: boolean
  agentName?: string
  transcriptPath?: string
  cwd?: string
  host?: SubagentHostKind
  worktreePath?: string
  gitWorktree?: SubagentGitWorktreeMetadata
  sourceCwd?: string
  worktreeDiff?: SubagentWorktreeDiff
  parentAgentId?: string
  parentSessionId?: string
  completedAt?: string
  terminalReason?: string
  outputSummary?: string
  stopRequestPath?: string
  stopRequestedAt?: string
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
  retainedTasks?: BackgroundTask[]
  discoveredToolNames: string[]
  toolReferenceDeltas: ToolReferenceDelta[]
  mcpInstructions: string[]
  activeSkill?: ActiveSkillRuntimeState
  memoryFreshness?: 'fresh' | 'stale'
  systemPrompt?: string
  toolSchema?: string
  modelParams?: Record<string, unknown>
}

export type ToolReferenceDelta = {
  name: string
  reason: string
  schemaHash: string
  discoveredAt: string
}

export type ActiveSkillRuntimeState = {
  name: string
  allowedTools: string[]
  activatedAt: string
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

export type ActionClass =
  | 'reversible'       // Read-only, no side effects, always safe
  | 'needs-confirmation' // Writes, network, moderate risk — confirm first
  | 'needs-human'       // Email, payments, deployments — human must be present
  | 'forbidden'          // Never allowed (rm -rf /, etc.)

export type SecurityTier =
  | 'silent'   // Allow automatically (low risk)
  | 'confirm'  // Ask user to confirm (medium risk)
  | 'block'    // Refuse execution (high risk)

export type Tool = {
  readonly name: string
  readonly description: string
  readonly inputJsonSchema?: ToolInputJsonSchema
  readonly readOnly?: boolean
  readonly actionClass?: ActionClass
  readonly securityTier?: SecurityTier
  readonly deferred?: boolean
  readonly searchTerms?: readonly string[]
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
      retainedTasks?: BackgroundTask[]
      discoveredToolNames?: string[]
      toolReferenceDeltas?: ToolReferenceDelta[]
      mcpInstructions?: string[]
      activeSkill?: ActiveSkillRuntimeState | null
      memoryFreshness?: 'fresh' | 'stale' | null
      systemPrompt?: string | null
      toolSchema?: string | null
      modelParams?: Record<string, unknown> | null
      timestamp: string
    }
  | {
      type: 'subagent-lifecycle'
      event: SubagentLifecycleEvent
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
      systemPromptHash: string | null
      toolCount: number
      toolSchemaHash: string
      messageCount: number
      modelVisibleEventCount: number
      compacted: boolean
      compactBoundaryIndex?: number
      droppedEventCount: number
      contentReplacementCount: number
      contentReplacementChars: number
      compactCapabilityHash: string | null
      projectConfigHash: string | null
      skillListingHash: string | null
      cachePrefix: RequestCachePrefixMetadata | null
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
      totalTokens?: number
      cacheReadInputTokens?: number
      cacheCreationInputTokens?: number
      cacheHitRatio?: number
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
      cacheReadInputTokensDelta?: number
      cacheReadInputTokensDeltaRatio?: number
      systemChanged: boolean
      toolSchemaChanged: boolean
      modelChanged: boolean
      projectConfigChanged: boolean
      skillListingChanged: boolean
      compactCapabilityChanged: boolean
      compactionChanged: boolean
      contentReplacementChanged: boolean
      cachePrefixChanged: boolean
      details: {
        modelId: string
        systemPromptHash: string | null
        toolSchemaHash: string
        compactCapabilityHash: string | null
        projectConfigHash: string | null
        skillListingHash: string | null
        cachePrefix: RequestCachePrefixMetadata | null
        providerCache: {
          previousReadTokens?: number
          currentReadTokens?: number
          currentCreationTokens?: number
          currentHitRatio?: number
        }
        systemChanged: boolean
        toolSchemaChanged: boolean
        compactCapabilityChanged: boolean
        cachePrefixChanged: boolean
      }
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

export type RuntimeSessionStatus =
  | 'completed'
  | 'failed'
  | 'running'
  | 'waiting_approval'
  | 'recoverable'

export type RuntimeSessionSummary = {
  sessionId: string
  transcriptPath: string
  eventCount: number
  status: RuntimeSessionStatus
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
  retainedTaskCount: number
  memoryFreshness?: 'fresh' | 'stale'
  hasHandoffReport: boolean
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
  status: 'running' | 'completed' | 'stopped' | 'error'
  finalMessage: string
  todos: TodoItem[]
  warnings: string[]
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
  | { type: 'subagent-lifecycle'; event: SubagentLifecycleEvent }
  | { type: 'turn-finished'; result: AgentRuntimeTurnResult }
  | {
      type: 'cache-stability-change'
      event: Extract<TranscriptEvent, { type: 'request-stability' }>
    }

export type AgentRuntime = {
  runTurn(input: AgentRuntimeTurnInput): AsyncIterable<AgentRuntimeEvent>
}
