import { describe, expect, it } from 'vitest'
import { createDeepSeekModelClient, type Tool } from '../src/index.js'

describe('createDeepSeekModelClient', () => {
  it('defaults to deepseek-v4-flash when no model override is provided', async () => {
    let requestBody: unknown
    const client = createDeepSeekModelClient({
      apiKey: 'test-key',
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body))
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: { content: 'ok' },
              },
            ],
          }),
          { status: 200 },
        )
      },
    })

    expect(client.id).toBe('deepseek:deepseek-v4-flash')
    await client.createMessage({
      messages: [],
      tools: [],
      abortSignal: new AbortController().signal,
    })
    expect(requestBody).toMatchObject({
      model: 'deepseek-v4-flash',
    })
  })

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
              total_tokens: 18,
              prompt_cache_hit_tokens: 8,
              prompt_cache_miss_tokens: 3,
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
          type: 'assistant',
          content: '',
          toolCalls: [
            { id: 'old_call', name: 'echo', input: { text: 'before' } },
          ],
          timestamp: '2026-05-17T00:00:01Z',
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
      stream: true,
      stream_options: {
        include_usage: true,
      },
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
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18,
        cacheReadInputTokens: 8,
        cacheCreationInputTokens: 3,
        cacheHitRatio: 8 / 11,
      },
    })
  })

  it('counts input tokens through DeepSeek chat completion usage', async () => {
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
                finish_reason: 'length',
                message: { content: 'x' },
              },
            ],
            usage: {
              prompt_tokens: 1234,
              completion_tokens: 1,
              total_tokens: 1235,
              prompt_cache_hit_tokens: 1000,
              prompt_cache_miss_tokens: 234,
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

    await expect(
      client.countInputTokens?.({
        messages: [
          {
            type: 'user',
            content: 'hello',
            timestamp: '2026-05-17T00:00:00Z',
          },
        ],
        tools: [tool],
        abortSignal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      ok: true,
      source: 'provider-chat-completion-usage',
      inputTokens: 1234,
      usage: {
        inputTokens: 1234,
        outputTokens: 1,
        totalTokens: 1235,
        cacheReadInputTokens: 1000,
        cacheCreationInputTokens: 234,
        cacheHitRatio: 1000 / 1234,
      },
    })
    expect(requestBody).toMatchObject({
      model: 'deepseek-v4-flash',
      stream: false,
      max_tokens: 1,
      tool_choice: 'auto',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'echo',
          },
        },
      ],
    })
  })

  it('reports context overflow during DeepSeek input token preflight', async () => {
    const client = createDeepSeekModelClient({
      apiKey: 'test-key',
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: {
              message: 'This model maximum context length is exceeded.',
            },
          }),
          { status: 400 },
        ),
    })

    await expect(
      client.countInputTokens?.({
        messages: [
          {
            type: 'user',
            content: 'too much',
            timestamp: '2026-05-17T00:00:00Z',
          },
        ],
        tools: [],
        abortSignal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      ok: false,
      source: 'provider-chat-completion-usage',
      errorKind: 'context_overflow',
    })
  })

  it('maps required tool choice to DeepSeek function tool_choice', async () => {
    let requestBody: unknown
    const client = createDeepSeekModelClient({
      apiKey: 'test-key',
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body))
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: { content: 'ok' },
              },
            ],
          }),
          { status: 200 },
        )
      },
    })
    const tool: Tool = {
      name: 'ResultReport',
      description: 'Report',
      inputJsonSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      async invoke() {
        return { toolCallId: '', ok: true, content: 'unused' }
      },
    }

    await client.createMessage({
      messages: [],
      tools: [tool],
      toolChoice: { type: 'tool', name: 'ResultReport' },
      abortSignal: new AbortController().signal,
    })

    expect(requestBody).toMatchObject({
      tool_choice: {
        type: 'function',
        function: {
          name: 'ResultReport',
        },
      },
    })
  })

  it('retries with auto tool choice when DeepSeek rejects specific tool_choice', async () => {
    const requestBodies: unknown[] = []
    const client = createDeepSeekModelClient({
      apiKey: 'test-key',
      fetch: async (_input, init) => {
        requestBodies.push(JSON.parse(String(init?.body)))
        if (requestBodies.length === 1) {
          return new Response(
            JSON.stringify({
              error: { message: 'deepseek-reasoner does not support this tool_choice' },
            }),
            { status: 400 },
          )
        }
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: { content: 'ok' },
              },
            ],
          }),
          { status: 200 },
        )
      },
    })
    const tool: Tool = {
      name: 'ResultReport',
      description: 'Report',
      inputJsonSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      async invoke() {
        return { toolCallId: '', ok: true, content: 'unused' }
      },
    }

    const response = await client.createMessage({
      messages: [],
      tools: [tool],
      toolChoice: { type: 'tool', name: 'ResultReport' },
      abortSignal: new AbortController().signal,
    })

    expect(requestBodies).toHaveLength(2)
    expect(requestBodies[0]).toMatchObject({
      tool_choice: {
        type: 'function',
        function: { name: 'ResultReport' },
      },
    })
    expect(requestBodies[1]).toMatchObject({
      tool_choice: 'auto',
    })
    expect(response).toMatchObject({
      content: 'ok',
      stopReason: 'end_turn',
    })
  })

  it('maps project config events into model-visible chat messages', async () => {
    let requestBody: unknown
    const client = createDeepSeekModelClient({
      apiKey: 'test-key',
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body))
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: { content: 'ok' },
              },
            ],
          }),
          { status: 200 },
        )
      },
    })

    await client.createMessage({
      messages: [
        {
          type: 'project-config',
          config: {
            ignore: ['**/research/**', '**/.research/**'],
            defaultCommands: { test: 'pnpm test' },
            allowedTools: ['Read', 'Grep'],
          },
          timestamp: '2026-05-17T00:00:00Z',
        },
        {
          type: 'user',
          content: 'inspect skills',
          timestamp: '2026-05-17T00:00:01Z',
        },
      ],
      tools: [],
      abortSignal: new AbortController().signal,
    })

    expect(requestBody).toMatchObject({
      messages: [
        {
          role: 'user',
          content: expect.stringContaining('<vigilon_project_config>'),
        },
        { role: 'user', content: 'inspect skills' },
      ],
    })
    const messages = (requestBody as { messages: Array<{ content: string }> }).messages
    expect(messages[0].content).toContain('**/research/**')
    expect(messages[0].content).toContain('Do not search, read, or summarize')
    expect(messages[0].content).toContain('test: pnpm test')
    expect(messages[0].content).toContain('Allowed tools: Read, Grep')
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
      stream: true,
      stream_options: {
        include_usage: true,
      },
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

  it('accumulates streaming text and tool-call argument deltas into one response', async () => {
    const client = createDeepSeekModelClient({
      apiKey: 'test-key',
      fetch: async () =>
        new Response(
          createSseStream([
            {
              choices: [{ delta: { content: 'Hello ' } }],
            },
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_1',
                        type: 'function',
                        function: {
                          name: 'echo',
                          arguments: '{"text":"o',
                        },
                      },
                    ],
                  },
                },
              ],
            },
            {
              choices: [
                {
                  delta: {
                    content: 'world',
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: 'k"}',
                        },
                      },
                    ],
                  },
                },
              ],
            },
            {
              choices: [{ finish_reason: 'tool_calls' }],
              usage: {
                prompt_tokens: 9,
                completion_tokens: 4,
                total_tokens: 13,
                prompt_cache_hit_tokens: 5,
                prompt_cache_miss_tokens: 4,
              },
            },
          ]),
          {
            status: 200,
            headers: {
              'content-type': 'text/event-stream',
            },
          },
        ),
    })

    await expect(
      client.createMessage({
        messages: [{ type: 'user', content: 'say hello', timestamp: '2026-05-17T00:00:00Z' }],
        tools: [],
        abortSignal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      content: 'Hello world',
      toolCalls: [{ id: 'call_1', name: 'echo', input: { text: 'ok' } }],
      stopReason: 'tool_use',
      usage: {
        inputTokens: 9,
        outputTokens: 4,
        totalTokens: 13,
        cacheReadInputTokens: 5,
        cacheCreationInputTokens: 4,
        cacheHitRatio: 5 / 9,
      },
    })
  })

  it('classifies provider context overflow as a max-token stop', async () => {
    const client = createDeepSeekModelClient({
      apiKey: 'test-key',
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: {
              message:
                'This model maximum context length is 65536 tokens, however your request exceeded the context window.',
            },
          }),
          { status: 400 },
        ),
    })

    await expect(
      client.createMessage({
        messages: [{ type: 'user', content: 'huge prompt', timestamp: '2026-05-17T00:00:00Z' }],
        tools: [],
        abortSignal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      stopReason: 'max_tokens',
      content: expect.stringContaining('context window'),
    })
  })
})

function createSseStream(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const chunks = [
    ...events.map(event => encoder.encode(`data: ${JSON.stringify(event)}\n\n`)),
    encoder.encode('data: [DONE]\n\n'),
  ]
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
    },
  })
}
