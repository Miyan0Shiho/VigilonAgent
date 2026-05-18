import { test, expect, describe, vi } from 'vitest';
import { LspTool } from '../src/tools/lspTool';
import type { ToolUseContext } from '../src/runtime/contracts';

describe('LspTool', () => {
  test('should have a name and description', () => {
    expect(LspTool.name).toBe('LSP');
    expect(LspTool.description).toBeDefined();
  });

  test('should call goToDefinition (mocked)', async () => {
    const mockServer = {
      start: vi.fn(),
      sendRequest: vi.fn(async () => ({
        uri: 'file:///test.ts',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      })),
    };

    const mockContext = {
      lspServerManager: {
        getServerForFile: vi.fn(() => mockServer),
      },
    } as unknown as ToolUseContext;

    const result = await LspTool.invoke(
      {
        action: 'goToDefinition',
        filePath: '/test.ts',
        line: 1,
        character: 1,
      },
      mockContext,
    );

    expect(mockServer.start).toHaveBeenCalled();
    expect(mockServer.sendRequest).toHaveBeenCalledWith('textDocument/definition', expect.anything());
    expect(result.ok).toBe(true);
    expect(result.content).toBe('file:///test.ts:1:1');
  });
});
