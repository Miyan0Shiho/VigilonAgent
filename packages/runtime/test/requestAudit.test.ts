import { describe, expect, it } from 'vitest'
import {
  createToolRegistry,
  createVigilonAgentRuntime,
  InMemoryTranscriptStore,
  type ModelClient,
  type Tool,
} from '../src/index.js'

describe('request stability audit', () => {
  it('records request and response audit events around each model call', async () => {
    const transcript = new InMemoryTranscriptStore()
    const modelClient: ModelClient = {
      id: 'fake-model',
      async createMessage(request) {
        const hasToolResult = request.messages.some(event => event.type === 'tool-result')
        return hasToolResult
          ? {
              content: 'done',
              toolCalls: [],
              stopReason: 'end_turn',
              usage: { inputTokens: 1800, outputTokens: 120 },
            }
          : {
              content: '',
              toolCalls: [{ id: 'read-1', name: 'echo', input: { text: 'alpha' } }],
              stopReason: 'tool_use',
              usage: { inputTokens: 600, outputTokens: 40 },
            }
      },
    }
    const tool: Tool = {
      name: 'echo',
      description: 'Echo input',
      inputJsonSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
      async invoke(input) {
        return {
          toolCallId: 'read-1',
          ok: true,
          content: JSON.stringify(input),
        }
      },
    }
    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createToolRegistry([tool]),
      transcript,
    })

    for await (const _event of runtime.runTurn({
      prompt: 'inspect request stability',
      cwd: '/tmp/project',
      abortSignal: new AbortController().signal,
    })) {
      // Drain runtime events.
    }

    const events = await transcript.readAll()
    const llmRequests = events.filter(event => event.type === 'llm-request')
    const llmResponses = events.filter(event => event.type === 'llm-response')
    const requestStabilityEvents = events.filter(
      event => event.type === 'request-stability',
    )

    expect(llmRequests).toHaveLength(2)
    expect(llmResponses).toHaveLength(2)
    expect(llmRequests[0]).toMatchObject({
      toolCount: 1,
      model: 'fake-model',
      previousRequestId: null,
    })
    expect(llmRequests[1]).toMatchObject({
      toolCount: 1,
      previousRequestId: (llmResponses[0] as any).requestId,
    })
    expect(llmResponses[1]).toMatchObject({
      status: 'ok',
      inputTokens: 1800,
      outputTokens: 120,
      toolCallCount: 0,
    })
    expect(requestStabilityEvents).toContainEqual(
      expect.objectContaining({
        classification: 'unexpected_change',
        reasons: expect.arrayContaining(['input_tokens_shift_without_shape_change']),
      }),
    )
  })
})
