export type ToolCall = {
  id: string
  name: string
  input: unknown
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
  action: 'read' | 'write' | 'edit' | 'bash' | 'network' | 'external-tool'
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

export type ToolUseContext = {
  cwd: string
  abortSignal: AbortSignal
  permissionGate: PermissionGate
  transcript: TranscriptStore
}

export type Tool = {
  readonly name: string
  readonly description: string
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
      timestamp: string
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
      type: 'compact-boundary'
      summary: string
      timestamp: string
    }

export type TranscriptStore = {
  append(event: TranscriptEvent): Promise<void>
  readAll(): Promise<TranscriptEvent[]>
}

export type AgentRuntimeTurnInput = {
  prompt: string
  cwd: string
  abortSignal: AbortSignal
}

export type AgentRuntimeTurnResult = {
  finalMessage: string
  events: TranscriptEvent[]
}

export type AgentRuntimeEvent =
  | { type: 'model-request-started' }
  | { type: 'tool-started'; call: ToolCall }
  | { type: 'tool-finished'; result: ToolResult }
  | { type: 'turn-finished'; result: AgentRuntimeTurnResult }

export type AgentRuntime = {
  runTurn(input: AgentRuntimeTurnInput): AsyncIterable<AgentRuntimeEvent>
}
