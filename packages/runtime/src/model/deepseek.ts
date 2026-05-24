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
      role: 'system'
      content: string
    }
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
    total_tokens?: number
    prompt_cache_hit_tokens?: number
    prompt_cache_miss_tokens?: number
    prompt_tokens_details?: {
      cached_tokens?: number
    }
  }
  error?: {
    message?: string
  }
}

const RETRYABLE_HTTP_STATUS = new Set([408, 409, 429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 2

type DeepSeekStreamingChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: 'function'
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: DeepSeekChatCompletion['usage']
}

type DeepSeekStreamingToolCallDelta = NonNullable<
  NonNullable<NonNullable<DeepSeekStreamingChunk['choices']>[number]['delta']>['tool_calls']
>[number]

export function createDeepSeekModelClient(
  options: DeepSeekModelClientOptions = {},
): ModelClient {
  const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY
  const baseUrl =
    options.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
  const model =
    options.model ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash'
  const fetchImpl = options.fetch ?? fetch

  return {
    id: `deepseek:${model}`,
    async countInputTokens(request: ModelRequest) {
      if (!apiKey) {
        return {
          ok: false,
          source: 'provider-chat-completion-usage',
          errorKind: 'missing_credentials',
          errorMessage: 'DEEPSEEK_API_KEY is not set',
        }
      }

      const messages = transcriptToDeepSeekMessages(request.messages, request.systemPrompt)
      const apiTools = request.tools.map(toolToDeepSeekTool)
      let allowSpecificToolChoice = true
      let lastError: string | undefined
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const requestBody = JSON.stringify({
          model,
          messages,
          tools: apiTools,
          tool_choice: toDeepSeekToolChoice(request, allowSpecificToolChoice),
          stream: false,
          max_tokens: 1,
        })
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
              `DeepSeek token count request failed with HTTP ${response.status}`
            if (
              allowSpecificToolChoice &&
              isSpecificToolChoice(request.toolChoice) &&
              isUnsupportedToolChoiceError(errorMessage) &&
              attempt < MAX_ATTEMPTS
            ) {
              allowSpecificToolChoice = false
              lastError = errorMessage
              continue
            }
            if (isContextOverflowError(errorMessage)) {
              return {
                ok: false,
                source: 'provider-chat-completion-usage',
                errorKind: 'context_overflow',
                errorMessage: normalizeContextOverflowMessage(errorMessage),
              }
            }
            if (attempt < MAX_ATTEMPTS && RETRYABLE_HTTP_STATUS.has(response.status)) {
              lastError = errorMessage
              continue
            }
            return {
              ok: false,
              source: 'provider-chat-completion-usage',
              errorKind: 'provider_error',
              errorMessage,
            }
          }

          const usage = mapDeepSeekUsage(payload.usage)
          const inputTokens =
            usage?.inputTokens ??
            (usage?.cacheReadInputTokens !== undefined ||
            usage?.cacheCreationInputTokens !== undefined
              ? (usage.cacheReadInputTokens ?? 0) +
                (usage.cacheCreationInputTokens ?? 0)
              : undefined)
          if (inputTokens === undefined) {
            return {
              ok: false,
              source: 'provider-chat-completion-usage',
              errorKind: 'usage_unavailable',
              errorMessage: 'DeepSeek token count response did not include prompt usage',
            }
          }
          return {
            ok: true,
            source: 'provider-chat-completion-usage',
            inputTokens,
            ...(usage ? { usage } : {}),
          }
        } catch (error) {
          if (isAbortError(error) || request.abortSignal.aborted) {
            return {
              ok: false,
              source: 'provider-chat-completion-usage',
              errorKind: 'aborted',
              errorMessage: 'DeepSeek token count request aborted',
            }
          }
          if (attempt < MAX_ATTEMPTS) {
            lastError = error instanceof Error ? error.message : String(error)
            continue
          }
          return {
            ok: false,
            source: 'provider-chat-completion-usage',
            errorKind: 'provider_error',
            errorMessage:
              (error instanceof Error ? error.message : String(error)) ||
              lastError ||
              'DeepSeek token count request failed',
          }
        }
      }

      return {
        ok: false,
        source: 'provider-chat-completion-usage',
        errorKind: 'provider_error',
        errorMessage: lastError ?? 'DeepSeek token count request failed',
      }
    },
    async createMessage(request: ModelRequest): Promise<ModelResponse> {
      if (!apiKey) {
        return {
          content: 'DEEPSEEK_API_KEY is not set',
          toolCalls: [],
          stopReason: 'error',
        }
      }

      const messages = transcriptToDeepSeekMessages(request.messages, request.systemPrompt)
      const apiTools = request.tools.map(toolToDeepSeekTool)
      let allowSpecificToolChoice = true

      let lastError: string | undefined
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const requestBody = JSON.stringify({
          model,
          messages,
          tools: apiTools,
          tool_choice: toDeepSeekToolChoice(request, allowSpecificToolChoice),
          stream: true,
          stream_options: {
            include_usage: true,
          },
        })
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

          const payload = isEventStream(response)
            ? await readStreamingResponse(response)
            : ((await response.json()) as DeepSeekChatCompletion)
          if (!response.ok) {
            const errorMessage =
              payload.error?.message ??
              `DeepSeek request failed with HTTP ${response.status}`
            if (
              allowSpecificToolChoice &&
              isSpecificToolChoice(request.toolChoice) &&
              isUnsupportedToolChoiceError(errorMessage) &&
              attempt < MAX_ATTEMPTS
            ) {
              allowSpecificToolChoice = false
              lastError = errorMessage
              continue
            }
            if (isContextOverflowError(errorMessage)) {
              return {
                content: normalizeContextOverflowMessage(errorMessage),
                toolCalls: [],
                stopReason: 'max_tokens',
              }
            }
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
            usage: mapDeepSeekUsage(payload.usage),
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

function mapDeepSeekUsage(
  usage: DeepSeekChatCompletion['usage'],
): ModelResponse['usage'] | undefined {
  if (!usage) return undefined
  const cacheReadInputTokens =
    usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens
  const cacheCreationInputTokens =
    usage.prompt_cache_miss_tokens ??
    (usage.prompt_tokens !== undefined && cacheReadInputTokens !== undefined
      ? Math.max(0, usage.prompt_tokens - cacheReadInputTokens)
      : undefined)
  const cacheHitRatio =
    usage.prompt_tokens !== undefined &&
    usage.prompt_tokens > 0 &&
    cacheReadInputTokens !== undefined
      ? cacheReadInputTokens / usage.prompt_tokens
      : undefined
  return {
    ...(usage.prompt_tokens !== undefined ? { inputTokens: usage.prompt_tokens } : {}),
    ...(usage.completion_tokens !== undefined ? { outputTokens: usage.completion_tokens } : {}),
    ...(usage.total_tokens !== undefined ? { totalTokens: usage.total_tokens } : {}),
    ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
    ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
    ...(cacheHitRatio !== undefined ? { cacheHitRatio } : {}),
  }
}

function toDeepSeekToolChoice(
  request: ModelRequest,
  allowSpecificToolChoice: boolean,
): 'auto' | 'none' | { type: 'function'; function: { name: string } } {
  if (request.tools.length === 0) return 'none'
  if (!request.toolChoice || request.toolChoice === 'auto') return 'auto'
  if (request.toolChoice === 'none') return 'none'
  if (!allowSpecificToolChoice) return 'auto'
  return {
    type: 'function',
    function: {
      name: request.toolChoice.name,
    },
  }
}

function isSpecificToolChoice(
  toolChoice: ModelRequest['toolChoice'],
): toolChoice is { type: 'tool'; name: string } {
  return Boolean(toolChoice && typeof toolChoice === 'object' && toolChoice.type === 'tool')
}

function isUnsupportedToolChoiceError(message: string): boolean {
  return /does not support this tool_choice|unsupported.*tool_choice|tool_choice.*not supported/iu.test(
    message,
  )
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function isEventStream(response: Response): boolean {
  return response.headers.get('content-type')?.includes('text/event-stream') === true
}

async function readStreamingResponse(
  response: Response,
): Promise<DeepSeekChatCompletion> {
  const body = response.body
  if (!body) {
    return {
      choices: [
        {
          finish_reason: 'stop',
          message: { content: '' },
        },
      ],
    }
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoningContent = ''
  let finishReason: string | null | undefined
  let usage: DeepSeekChatCompletion['usage']
  const toolCalls: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }> = []

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
    let boundaryIndex = buffer.indexOf('\n\n')
    while (boundaryIndex !== -1) {
      const rawEvent = buffer.slice(0, boundaryIndex)
      buffer = buffer.slice(boundaryIndex + 2)
      applyStreamingEvent(rawEvent, {
        appendContent(chunk) {
          content += chunk
        },
        appendReasoning(chunk) {
          reasoningContent += chunk
        },
        mergeToolCall(delta) {
          const index = delta.index ?? 0
          const existing = toolCalls[index] ?? {
            id: delta.id ?? `tool_call_${index}`,
            type: 'function' as const,
            function: {
              name: delta.function?.name ?? '',
              arguments: '',
            },
          }
          if (delta.id) existing.id = delta.id
          if (delta.function?.name) existing.function.name = delta.function.name
          if (delta.function?.arguments) {
            existing.function.arguments += delta.function.arguments
          }
          toolCalls[index] = existing
        },
        setFinishReason(value) {
          finishReason = value
        },
        setUsage(value) {
          usage = value
        },
      })
      boundaryIndex = buffer.indexOf('\n\n')
    }
    if (done) break
  }

  return {
    choices: [
      {
        finish_reason: finishReason,
        message: {
          content,
          ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    usage,
  }
}

function applyStreamingEvent(
  rawEvent: string,
  handlers: {
    appendContent(chunk: string): void
    appendReasoning(chunk: string): void
    mergeToolCall(delta: DeepSeekStreamingToolCallDelta): void
    setFinishReason(value: string | null | undefined): void
    setUsage(value: DeepSeekChatCompletion['usage']): void
  },
): void {
  const dataLines = rawEvent
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim())
  if (dataLines.length === 0) return
  const payloadText = dataLines.join('\n')
  if (payloadText === '[DONE]') return

  const payload = JSON.parse(payloadText) as DeepSeekStreamingChunk
  const choice = payload.choices?.[0]
  if (choice?.delta?.content) handlers.appendContent(choice.delta.content)
  if (choice?.delta?.reasoning_content) {
    handlers.appendReasoning(choice.delta.reasoning_content)
  }
  for (const toolCall of choice?.delta?.tool_calls ?? []) {
    handlers.mergeToolCall(toolCall)
  }
  if (choice?.finish_reason !== undefined) {
    handlers.setFinishReason(choice.finish_reason)
  }
  if (payload.usage) {
    handlers.setUsage(payload.usage)
  }
}

function isContextOverflowError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('context window') ||
    normalized.includes('context length') ||
    normalized.includes('maximum context length')
  )
}

function normalizeContextOverflowMessage(message: string): string {
  return `DeepSeek request exceeded the model context window: ${message}`
}

function transcriptToDeepSeekMessages(
  events: readonly TranscriptEvent[],
  systemPrompt?: string,
): DeepSeekMessage[] {
  const messages: DeepSeekMessage[] = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  let pendingToolCalls: DeepSeekToolCall[] = []
  const seenToolCallIds = new Set<string>()

  for (const event of events) {
    if (event.type === 'user') {
      flushToolCalls(messages, pendingToolCalls)
      pendingToolCalls = []
      messages.push({ role: 'user', content: event.content })
    }

    if (event.type === 'project-config') {
      flushToolCalls(messages, pendingToolCalls)
      pendingToolCalls = []
      messages.push({
        role: 'user',
        content: formatProjectConfigForModel(event.config),
      })
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

function formatProjectConfigForModel(
  config: Extract<TranscriptEvent, { type: 'project-config' }>['config'],
): string {
  const lines = ['<vigilon_project_config>']
  if (config.ignore.length > 0) {
    lines.push('Ignored paths/globs for this task:')
    for (const pattern of config.ignore) lines.push(`- ${pattern}`)
    lines.push(
      'Do not search, read, or summarize files matching these ignored paths unless the user explicitly overrides this constraint later.',
    )
  }
  if (Object.keys(config.defaultCommands).length > 0) {
    lines.push('Default project commands:')
    for (const [name, command] of Object.entries(config.defaultCommands)) {
      lines.push(`- ${name}: ${command}`)
    }
  }
  if (config.allowedTools?.length) {
    lines.push(`Allowed tools: ${config.allowedTools.join(', ')}`)
  }
  lines.push('</vigilon_project_config>')
  return lines.join('\n')
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
  if (value === 'model_context_window_exceeded') return 'max_tokens'
  if (value === 'stop' || value == null) return 'end_turn'
  return 'error'
}
