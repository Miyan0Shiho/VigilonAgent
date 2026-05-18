import { describe, expect, it } from 'vitest'
import { createDeepSeekModelClient, type Tool } from '../src/index.js'

describe('createDeepSeekModelClient', () => {
  it('maps Vigilon transcript and tools to DeepSeek chat completions', async () => {
    let requestBody: unknown
    const client = createDeepSeekModelClient({
      apiKey: 'test-key',
      model: 'deepseek-v4-pro',
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body))
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      function: {
                        name: 'echo',
                        arguments: '{"text":"ok"}',
                      },
                    },
                  ],
                },
              },
            ],
            usage: {
              prompt_tokens: 11,
              completion_tokens: 7,
            },
          }),
          { status: 200 },
        )
      },
    })
    const tool: Tool = {
      name: 'echo',
      description: 'Echo input',
      inputJsonSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
      async invoke() {
        return { toolCallId: 'call_1', ok: true, content: 'unused' }
      },
    }

    const response = await client.createMessage({
      messages: [
        { type: 'user', content: 'hello', timestamp: '2026-05-17T00:00:00Z' },
        {
          type: 'compact-boundary',
          summary: 'The earlier session was summarized.',
          metadata: {
            trigger: 'manual',
            preEventCount: 1,
            messagesSummarized: 1,
          },
          timestamp: '2026-05-17T00:00:00Z',
        },
        {
          type: 'tool-call',
          call: { id: 'old_call', name: 'echo', input: { text: 'before' } },
          timestamp: '2026-05-17T00:00:01Z',
        },
        {
          type: 'tool-result',
          result: { toolCallId: 'old_call', ok: true, content: 'before' },
          timestamp: '2026-05-17T00:00:02Z',
        },
      ],
      tools: [tool],
      abortSignal: new AbortController().signal,
    })

    expect(requestBody).toMatchObject({
      model: 'deepseek-v4-pro',
      tool_choice: 'auto',
      messages: [
        { role: 'user', content: 'hello' },
        {
          role: 'user',
          content:
            'Conversation compacted. Summary of earlier context:\nThe earlier session was summarized.',
        },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'old_call',
              type: 'function',
              function: {
                name: 'echo',
                arguments: '{"text":"before"}',
              },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'old_call', content: 'before' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'echo',
            description: 'Echo input',
            parameters: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
              additionalProperties: false,
            },
          },
        },
      ],
    })
    expect(response).toEqual({
      content: '',
      toolCalls: [{ id: 'call_1', name: 'echo', input: { text: 'ok' } }],
      stopReason: 'tool_use',
      usage: { inputTokens: 11, outputTokens: 7 },
    })
  })

  it('round-trips reasoning content for thinking-mode tool calls', async () => {
    let requestBody: unknown
    const client = createDeepSeekModelClient({
      apiKey: 'test-key',
      model: 'deepseek-v4-flash',
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body))
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: 'done',
                },
              },
            ],
          }),
          { status: 200 },
        )
      },
    })

    await client.createMessage({
      messages: [
        { type: 'user', content: 'read file', timestamp: '2026-05-17T00:00:00Z' },
        {
          type: 'assistant',
          content: '',
          reasoningContent: 'Need to inspect package metadata.',
          toolCalls: [
            { id: 'call_1', name: 'Read', input: { file_path: 'package.json' } },
          ],
          timestamp: '2026-05-17T00:00:01Z',
        },
        {
          type: 'tool-call',
          call: { id: 'call_1', name: 'Read', input: { file_path: 'package.json' } },
          timestamp: '2026-05-17T00:00:02Z',
        },
        {
          type: 'tool-result',
          result: { toolCallId: 'call_1', ok: true, content: '{"name":"vigilon-agent"}' },
          timestamp: '2026-05-17T00:00:03Z',
        },
      ],
      tools: [],
      abortSignal: new AbortController().signal,
    })

    expect(requestBody).toMatchObject({
      messages: [
        { role: 'user', content: 'read file' },
        {
          role: 'assistant',
          content: null,
          reasoning_content: 'Need to inspect package metadata.',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'Read',
                arguments: '{"file_path":"package.json"}',
              },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: '{"name":"vigilon-agent"}' },
      ],
    })
  })

  it('fails closed when DEEPSEEK_API_KEY is missing', async () => {
    const client = createDeepSeekModelClient({
      apiKey: '',
      fetch: async () => {
        throw new Error('fetch should not run without an API key')
      },
    })

    await expect(
      client.createMessage({
        messages: [],
        tools: [],
        abortSignal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      stopReason: 'error',
      toolCalls: [],
    })
  })

  it('retries transient HTTP failures before succeeding', async () => {
    let callCount = 0
    const client = createDeepSeekModelClient({
      apiKey: 'test-key',
      fetch: async () => {
        callCount += 1
        if (callCount === 1) {
          return new Response(
            JSON.stringify({
              error: { message: 'temporary upstream failure' },
            }),
            { status: 502 },
          )
        }
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: 'recovered',
                },
              },
            ],
          }),
          { status: 200 },
        )
      },
    })

    await expect(
      client.createMessage({
        messages: [],
        tools: [],
        abortSignal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      stopReason: 'end_turn',
      content: 'recovered',
    })
    expect(callCount).toBe(2)
  })

  it('classifies aborted requests as runtime errors without retrying', async () => {
    const abortController = new AbortController()
    abortController.abort()
    let callCount = 0
    const client = createDeepSeekModelClient({
      apiKey: 'test-key',
      fetch: async (_input, init) => {
        callCount += 1
        if (init?.signal?.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError')
        }
        return new Response('{}', { status: 200 })
      },
    })

    await expect(
      client.createMessage({
        messages: [],
        tools: [],
        abortSignal: abortController.signal,
      }),
    ).resolves.toMatchObject({
      stopReason: 'error',
      content: 'DeepSeek request aborted',
    })
    expect(callCount).toBe(1)
  })
})
