import { test, expect, describe, vi } from 'vitest';
import { createVigilonAgentRuntime } from '../src/runtime/agentLoop';
import { ToolRegistry } from '../src/runtime/tools';
import { ToolSearchTool } from '../src/tools/toolSearchTool';
import type { ModelClient, Tool } from '../src/runtime/contracts';

describe('Deferred Tools and ToolSearch', () => {
  test('should not include deferred tools in initial request but include them after ToolSearch', async () => {
    const deferredTool: Tool = {
      name: 'DeferredTool',
      description: 'A deferred tool',
      deferred: true,
      invoke: vi.fn(),
    };

    const tools = new ToolRegistry([ToolSearchTool, deferredTool]);
    
    const mockModelClient: ModelClient = {
      id: 'test-model',
      createMessage: vi.fn()
        .mockResolvedValueOnce({
          content: 'Searching for tools',
          toolCalls: [{ id: 'call-1', name: 'ToolSearch', input: { query: 'deferred' } }],
          stopReason: 'tool_use',
        })
        .mockResolvedValueOnce({
          content: 'Now using deferred tool',
          toolCalls: [{ id: 'call-2', name: 'DeferredTool', input: {} }],
          stopReason: 'tool_use',
        })
        .mockResolvedValueOnce({
          content: 'Done',
          toolCalls: [],
          stopReason: 'end_turn',
        }),
    };

    const runtime = createVigilonAgentRuntime({
      modelClient: mockModelClient,
      tools,
    });

    const iterator = runtime.runTurn({
      prompt: 'Find and use the deferred tool',
      cwd: '/',
      abortSignal: new AbortController().signal,
    });

    const events = [];
    for await (const event of iterator) {
      events.push(event);
    }

    // First call: tools should only contain ToolSearch, NOT DeferredTool
    const firstCallTools = (mockModelClient.createMessage as any).mock.calls[0][0].tools;
    expect(firstCallTools.map((t: any) => t.name)).toContain('ToolSearch');
    expect(firstCallTools.map((t: any) => t.name)).not.toContain('DeferredTool');

    // Second call: tools should include DeferredTool because it was "discovered"
    const secondCallTools = (mockModelClient.createMessage as any).mock.calls[1][0].tools;
    expect(secondCallTools.map((t: any) => t.name)).toContain('ToolSearch');
    expect(secondCallTools.map((t: any) => t.name)).toContain('DeferredTool');
  });
});
