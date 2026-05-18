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
      sendNotification: vi.fn(),
      config: { languages: ['typescript'] },
    };

    const mockContext = {
      cwd: '/',
      lspServerManager: {
        getServerForFile: vi.fn(() => mockServer),
        getFileContent: vi.fn(async () => 'content'),
      },
      permissionGate: {
        requestPermission: vi.fn(async () => ({ allowed: true })),
      },
      readFileState: new Map(),
    } as unknown as ToolUseContext;

    const result = await LspTool.invoke(
      {
        action: 'goToDefinition',
        filePath: 'test.ts',
        line: 1,
        character: 1,
      },
      mockContext,
    );

    expect(mockServer.start).toHaveBeenCalled();
    expect(mockServer.sendNotification).toHaveBeenCalledWith('textDocument/didOpen', expect.anything());
    expect(mockServer.sendRequest).toHaveBeenCalledWith('textDocument/definition', expect.anything());
    expect(result.ok).toBe(true);
    expect(result.content).toBe('file:///test.ts:1:1');
  });

  test('should fail if permission is denied', async () => {
    const mockContext = {
      cwd: '/',
      permissionGate: {
        requestPermission: vi.fn(async () => ({ allowed: false, reason: 'Denied' })),
      },
    } as unknown as ToolUseContext;

    const result = await LspTool.invoke(
      {
        action: 'goToDefinition',
        filePath: 'test.ts',
      },
      mockContext,
    );

    expect(result.ok).toBe(false);
    expect(result.content).toBe('Denied');
  });

  test('should expose workspace symbols', async () => {
    const mockContext = {
      cwd: '/',
      lspServerManager: {
        workspaceSymbol: vi.fn(async () => [
          {
            name: 'searchWorkspace',
            kind: 12,
            location: {
              uri: 'file:///workspace.ts',
              range: {
                start: { line: 4, character: 2 },
                end: { line: 4, character: 18 },
              },
            },
          },
        ]),
      },
      permissionGate: {
        requestPermission: vi.fn(async () => ({ allowed: true })),
      },
    } as unknown as ToolUseContext;

    const result = await LspTool.invoke(
      {
        action: 'workspace_symbol',
        query: 'search',
      },
      mockContext,
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain('workspace symbols');
    expect(result.content).toContain('searchWorkspace');
  });

  test('should expose implementation and call hierarchy details', async () => {
    const mockContext = {
      cwd: '/',
      lspServerManager: {
        implementation: vi.fn(async () => [
          {
            uri: 'file:///impl.ts',
            range: {
              start: { line: 8, character: 0 },
              end: { line: 8, character: 10 },
            },
          },
        ]),
        callHierarchy: vi.fn(async () => ({
          item: { name: 'runTask', kind: 12, uri: 'file:///impl.ts' },
          incoming: [
            {
              from: { name: 'scheduleTask', kind: 12, uri: 'file:///entry.ts' },
            },
          ],
          outgoing: [
            {
              to: { name: 'stopTask', kind: 12, uri: 'file:///stop.ts' },
            },
          ],
        })),
      },
      permissionGate: {
        requestPermission: vi.fn(async () => ({ allowed: true })),
      },
    } as unknown as ToolUseContext;

    const implementationResult = await LspTool.invoke(
      {
        action: 'implementation',
        filePath: 'test.ts',
        line: 1,
        character: 1,
      },
      mockContext,
    );
    const callHierarchyResult = await LspTool.invoke(
      {
        action: 'call_hierarchy',
        filePath: 'test.ts',
        line: 1,
        character: 1,
      },
      mockContext,
    );

    expect(implementationResult.ok).toBe(true);
    expect(implementationResult.content).toContain('implementation');
    expect(implementationResult.content).toContain('file:///impl.ts:9:1');
    expect(callHierarchyResult.ok).toBe(true);
    expect(callHierarchyResult.content).toContain('incoming calls');
    expect(callHierarchyResult.content).toContain('scheduleTask');
    expect(callHierarchyResult.content).toContain('outgoing calls');
    expect(callHierarchyResult.content).toContain('stopTask');
  });

  test('should expose diagnostics from the manager registry', async () => {
    const mockContext = {
      cwd: '/',
      lspServerManager: {
        getDiagnostics: vi.fn(async () => [
          {
            severity: 1,
            message: 'Missing return type',
            range: {
              start: { line: 2, character: 4 },
              end: { line: 2, character: 12 },
            },
          },
        ]),
      },
      permissionGate: {
        requestPermission: vi.fn(async () => ({ allowed: true })),
      },
    } as unknown as ToolUseContext;

    const result = await LspTool.invoke(
      {
        action: 'diagnostics',
        filePath: 'test.ts',
      },
      mockContext,
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain('diagnostics');
    expect(result.content).toContain('Missing return type');
  });
});
