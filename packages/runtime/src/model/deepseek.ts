import type {
  ModelClient,
  ModelRequest,
  ModelResponse,
  Tool,
  ToolCall,
  TranscriptEvent,
} from '../runtime/contracts.js'

export type DeepSeekModelClientOptions = {
  apiKey?: string
  baseUrl?: string
  model?: 'deepseek-v4-flash' | 'deepseek-v4-pro' | (string & {})
  fetch?: typeof fetch
}

type DeepSeekMessage =
  | {
      role: 'user'
      content: string
    }
  | {
      role: 'assistant'
      content: string | null
      reasoning_content?: string
      tool_calls?: DeepSeekToolCall[]
    }
  | {
      role: 'tool'
      content: string
      tool_call_id: string
    }

type DeepSeekToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

type DeepSeekChatCompletion = {
  choices?: Array<{
    finish_reason?: string | null
    message?: {
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: DeepSeekToolCall[]
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
  error?: {
    message?: string
  }
}

const RETRYABLE_HTTP_STATUS = new Set([408, 409, 429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 2

export function createDeepSeekModelClient(
  options: DeepSeekModelClientOptions = {},
): ModelClient {
  const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY
  const baseUrl =
    options.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
  const model =
    options.model ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro'
  const fetchImpl = options.fetch ?? fetch

  return {
    id: `deepseek:${model}`,
    async createMessage(request: ModelRequest): Promise<ModelResponse> {
      if (!apiKey) {
        return {
          content: 'DEEPSEEK_API_KEY is not set',
          toolCalls: [],
          stopReason: 'error',
        }
      }

      const requestBody = JSON.stringify({
        model,
        messages: transcriptToDeepSeekMessages(request.messages),
        tools: request.tools.map(toolToDeepSeekTool),
        tool_choice: request.tools.length > 0 ? 'auto' : 'none',
        stream: false,
      })

      let lastError: string | undefined
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          const response = await fetchImpl(`${baseUrl}/chat/completions`, {
            method: 'POST',
            signal: request.abortSignal,
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: requestBody,
          })

          const payload = (await response.json()) as DeepSeekChatCompletion
          if (!response.ok) {
            const errorMessage =
              payload.error?.message ??
              `DeepSeek request failed with HTTP ${response.status}`
            if (attempt < MAX_ATTEMPTS && RETRYABLE_HTTP_STATUS.has(response.status)) {
              lastError = errorMessage
              continue
            }
            return {
              content: errorMessage,
              toolCalls: [],
              stopReason: 'error',
            }
          }

          const choice = payload.choices?.[0]
          const message = choice?.message
          const reasoningContent = message?.reasoning_content ?? undefined
          return {
            content: message?.content ?? '',
            ...(reasoningContent !== undefined ? { reasoningContent } : {}),
            toolCalls: (message?.tool_calls ?? []).map(fromDeepSeekToolCall),
            stopReason: mapStopReason(choice?.finish_reason),
            usage: {
              inputTokens: payload.usage?.prompt_tokens,
              outputTokens: payload.usage?.completion_tokens,
            },
          }
        } catch (error) {
          if (isAbortError(error) || request.abortSignal.aborted) {
            return {
              content: 'DeepSeek request aborted',
              toolCalls: [],
              stopReason: 'error',
            }
          }
          if (attempt < MAX_ATTEMPTS) {
            lastError = error instanceof Error ? error.message : String(error)
            continue
          }
          return {
            content:
              (error instanceof Error ? error.message : String(error)) ||
              lastError ||
              'DeepSeek request failed',
            toolCalls: [],
            stopReason: 'error',
          }
        }
      }

      return {
        content: lastError ?? 'DeepSeek request failed',
        toolCalls: [],
        stopReason: 'error',
      }
    },
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function transcriptToDeepSeekMessages(
  events: readonly TranscriptEvent[],
): DeepSeekMessage[] {
  const messages: DeepSeekMessage[] = []
  let pendingToolCalls: DeepSeekToolCall[] = []
  const seenToolCallIds = new Set<string>()

  for (const event of events) {
    if (event.type === 'user') {
      flushToolCalls(messages, pendingToolCalls)
      pendingToolCalls = []
      messages.push({ role: 'user', content: event.content })
    }

    if (event.type === 'compact-boundary') {
      flushToolCalls(messages, pendingToolCalls)
      pendingToolCalls = []
      messages.push({
        role: 'user',
        content: `Conversation compacted. Summary of earlier context:\n${event.summary}`,
      })
    }

    if (
      event.type === 'assistant' &&
      (event.content || event.reasoningContent || event.toolCalls?.length)
    ) {
      flushToolCalls(messages, pendingToolCalls)
      pendingToolCalls = []
      messages.push({
        role: 'assistant',
        content: event.content || null,
        reasoning_content: event.reasoningContent,
        tool_calls: event.toolCalls
          ?.filter(call => !seenToolCallIds.has(call.id))
          .map(call => {
            seenToolCallIds.add(call.id)
            return toDeepSeekToolCall(call)
          }),
      })
    }

    if (event.type === 'tool-call') {
      if (!seenToolCallIds.has(event.call.id)) {
        seenToolCallIds.add(event.call.id)
        pendingToolCalls.push(toDeepSeekToolCall(event.call))
      }
    }

    if (event.type === 'tool-result') {
      flushToolCalls(messages, pendingToolCalls)
      pendingToolCalls = []
      messages.push({
        role: 'tool',
        tool_call_id: event.result.toolCallId,
        content: event.result.content,
      })
    }
  }

  flushToolCalls(messages, pendingToolCalls)
  return messages
}

function flushToolCalls(
  messages: DeepSeekMessage[],
  toolCalls: readonly DeepSeekToolCall[],
): void {
  if (toolCalls.length === 0) return
  messages.push({
    role: 'assistant',
    content: null,
    tool_calls: [...toolCalls],
  })
}

function toolToDeepSeekTool(tool: Tool): object {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputJsonSchema ?? {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  }
}

function toDeepSeekToolCall(call: ToolCall): DeepSeekToolCall {
  return {
    id: call.id,
    type: 'function',
    function: {
      name: call.name,
      arguments: JSON.stringify(call.input ?? {}),
    },
  }
}

function fromDeepSeekToolCall(call: DeepSeekToolCall): ToolCall {
  return {
    id: call.id,
    name: call.function.name,
    input: parseToolArguments(call.function.arguments),
  }
}

function parseToolArguments(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return { raw: value }
  }
}

function mapStopReason(
  value: string | null | undefined,
): ModelResponse['stopReason'] {
  if (value === 'tool_calls') return 'tool_use'
  if (value === 'length') return 'max_tokens'
  if (value === 'stop' || value == null) return 'end_turn'
  return 'error'
}
