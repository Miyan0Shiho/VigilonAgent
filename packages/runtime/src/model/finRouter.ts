import type { ModelClient, ModelRequest, ModelResponse } from '../runtime/contracts.js'

export type FinDecision = {
  model: 'deepseek-v4-flash' | 'deepseek-v4-pro'
  thinking: 'off' | 'high'
}

const FIN_SYSTEM = `Classify this coding task. Reply ONLY with valid JSON, no other text:
{"model":"flash"|"pro","thinking":"off"|"high"}

Use flash for: simple reads, single-file lookups, trivial edits, known-fact questions.
Use pro for: multi-file analysis, architecture work, debugging, refactoring, generating code, sub-agents, complex reasoning, cross-module understanding.

Use thinking=off for: straightforward lookups, trivial edits, single reads.
Use thinking=high for: analysis, planning, multi-step work, debugging, architecture.`

export function createFinRouter(options: {
  apiKey?: string
  baseUrl?: string
} = {}): (task: string) => Promise<FinDecision> {
  const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY
  const baseUrl = options.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'

  return async (task: string): Promise<FinDecision> => {
    if (!apiKey) {
      return { model: 'deepseek-v4-flash', thinking: 'off' }
    }

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [
            { role: 'system', content: FIN_SYSTEM },
            { role: 'user', content: task.slice(0, 2000) },
          ],
          max_tokens: 50,
          temperature: 0,
          stream: false,
        }),
        signal: AbortSignal.timeout(5000),
      })

      const payload = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const raw = payload.choices?.[0]?.message?.content?.trim() ?? ''
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as { model?: string; thinking?: string }
        const isPro = parsed.model === 'pro' || parsed.model?.includes('pro')
        return {
          model: isPro ? 'deepseek-v4-pro' : 'deepseek-v4-flash',
          thinking: parsed.thinking === 'high' ? 'high' : 'off',
        }
      }
    } catch {
      // Fin failed — fall back
    }

    return { model: 'deepseek-v4-flash', thinking: 'off' }
  }
}

/**
 * Wraps a ModelClient to add Fin auto-routing.
 * Before each createMessage, calls Fin to decide model + thinking.
 * Extracts task context from recent user messages in the request.
 */
export function createFinModelClient(
  baseClient: ModelClient,
  finRouter: ReturnType<typeof createFinRouter>,
): ModelClient {
  let activeModel = 'deepseek-v4-flash'

  return {
    get id() {
      return `deepseek:${activeModel}`
    },
    countInputTokens: undefined,
    async createMessage(request: ModelRequest): Promise<ModelResponse> {
      const userMessages = request.messages
        .filter(m => m.type === 'user')
        .map(m => m.type === 'user' ? m.content : '')
      const taskContext = userMessages.slice(-3).join('\n').slice(-3000)

      const decision = await finRouter(taskContext)
      activeModel = decision.model

      return baseClient.createMessage({
        ...request,
        model: decision.model,
        thinking: decision.thinking,
      })
    },
  } satisfies ModelClient
}

/**
 * Wraps a ModelClient with a fallback. When the primary client's createMessage
 * throws, the wrapper retries once with the fallback client.
 *
 * Mirrors Claude Code's --fallback-model for resilience against provider
 * outages, rate limits, and transient network errors.
 */
export function createFallbackModelClient(
  primary: ModelClient,
  fallback: ModelClient,
): ModelClient {
  return {
    get id() {
      return primary.id
    },
    countInputTokens: primary.countInputTokens,
    async createMessage(request: ModelRequest): Promise<ModelResponse> {
      try {
        return await primary.createMessage(request)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Only fall back on transport/availability errors, not on
        // content-filter or other logical refusals from the provider.
        const isTransport =
          msg.includes('fetch') ||
          msg.includes('network') ||
          msg.includes('timeout') ||
          msg.includes('ECONNREFUSED') ||
          msg.includes('ETIMEDOUT') ||
          msg.includes('ENOTFOUND') ||
          msg.includes('rate_limit') ||
          msg.includes('overload') ||
          msg.includes('503') ||
          msg.includes('502') ||
          msg.includes('504') ||
          msg.includes('429')
        if (!isTransport) throw err
        return fallback.createMessage(request)
      }
    },
  } satisfies ModelClient
}
