import { test, expect, describe, vi } from 'vitest';
import { LspTool } from '../src/tools/lspTool';
import type { ToolUseContext } from '../src/runtime/contracts';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('LspTool', () => {
  test('should have a name and description', () => {
    expect(LspTool.name).toBe('LSP');
    expect(LspTool.description).toBeDefined();
  });

  test('should call goToDefinition (mocked)', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-lsp-'));
    await writeFile(path.join(cwd, 'test.ts'), 'content');
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
      cwd,
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
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-lsp-denied-'));
    await writeFile(path.join(cwd, 'test.ts'), 'content');
    const mockContext = {
      cwd,
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
    expect(mockContext.permissionGate.requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'read', subject: '/' }),
    );
  });

  test('should expose implementation and call hierarchy details', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-lsp-impl-'));
    await writeFile(path.join(cwd, 'test.ts'), 'content');
    const mockContext = {
      cwd,
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
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-lsp-diag-'));
    await writeFile(path.join(cwd, 'test.ts'), 'content');
    const mockContext = {
      cwd,
      lspServerManager: {
        getServerForFile: vi.fn(() => ({
          config: { languages: ['typescript'] },
          start: vi.fn(async () => {}),
          sendNotification: vi.fn(async () => {}),
        })),
        getFileContent: vi.fn(async () => 'content'),
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
      lspOpenFileState: new Set(),
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

  test('should reject ignored paths before LSP requests', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-lsp-ignore-'));
    await writeFile(path.join(cwd, 'ignored.ts'), 'content');
    const mockContext = {
      cwd,
      projectConfig: { ignore: ['ignored.ts'], defaultCommands: {} },
      permissionGate: {
        requestPermission: vi.fn(async () => ({ allowed: true })),
      },
    } as unknown as ToolUseContext;

    const result = await LspTool.invoke(
      { action: 'goToDefinition', filePath: 'ignored.ts' },
      mockContext,
    );

    expect(result.ok).toBe(false);
    expect(result.content).toContain('ignored by project config');
  });

  test('should fall back to text document symbols when the LSP server is unavailable', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-lsp-fallback-'));
    await writeFile(
      path.join(cwd, 'skills.ts'),
      [
        'export type RuntimeSkill = { name: string }',
        '',
        'export function loadRuntimeSkills() {',
        '  return []',
        '}',
        '',
        'export const buildSkillListing = () => ""',
        '',
      ].join('\n'),
    );
    const mockServer = {
      start: vi.fn(async () => {
        throw new Error('spawn typescript-language-server ENOENT');
      }),
      sendRequest: vi.fn(),
      sendNotification: vi.fn(),
      config: { languages: ['typescript'] },
    };
    const mockContext = {
      cwd,
      lspServerManager: {
        getServerForFile: vi.fn(() => mockServer),
        getFileContent: vi.fn(async () =>
          [
            'export type RuntimeSkill = { name: string }',
            'export function loadRuntimeSkills() { return [] }',
            'export const buildSkillListing = () => ""',
          ].join('\n'),
        ),
      },
      permissionGate: {
        requestPermission: vi.fn(async () => ({ allowed: true })),
      },
    } as unknown as ToolUseContext;

    const result = await LspTool.invoke(
      {
        action: 'documentSymbol',
        filePath: 'skills.ts',
      },
      mockContext,
    );

    expect(result.ok).toBe(true);
    expect(result.metadata).toMatchObject({
      lspUnavailable: true,
      fallback: 'text-document-symbols',
      symbolCount: 3,
    });
    expect(result.content).toContain('LSP unavailable: spawn typescript-language-server ENOENT');
    expect(result.content).toContain('fallback document symbols');
    expect(result.content).toContain('RuntimeSkill');
    expect(result.content).toContain('loadRuntimeSkills');
    expect(result.content).toContain('buildSkillListing');
    expect(mockServer.sendRequest).not.toHaveBeenCalled();
  });

  test('should send didOpen even when Read already cached the file', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-lsp-open-state-'));
    const filePath = path.join(cwd, 'cached.ts');
    await writeFile(filePath, 'export function cachedSymbol() { return true }\n');
    const mockServer = {
      start: vi.fn(),
      sendRequest: vi.fn(async () => [
        {
          name: 'cachedSymbol',
          kind: 12,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 48 },
          },
          selectionRange: {
            start: { line: 0, character: 16 },
            end: { line: 0, character: 28 },
          },
        },
      ]),
      sendNotification: vi.fn(),
      config: { languages: ['typescript'] },
    };
    const mockContext = {
      cwd,
      lspServerManager: {
        getServerForFile: vi.fn(() => mockServer),
        getFileContent: vi.fn(async () => 'should not be needed'),
      },
      permissionGate: {
        requestPermission: vi.fn(async () => ({ allowed: true })),
      },
      readFileState: new Map([
        [
          filePath,
          {
            content: 'export function cachedSymbol() { return true }\n',
            mtimeMs: 1,
            fullRead: true,
          },
        ],
      ]),
      lspOpenFileState: new Set<string>(),
    } as unknown as ToolUseContext;

    const result = await LspTool.invoke(
      {
        action: 'documentSymbol',
        filePath: 'cached.ts',
      },
      mockContext,
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain('cachedSymbol');
    expect(mockServer.sendNotification).toHaveBeenCalledWith(
      'textDocument/didOpen',
      expect.objectContaining({
        textDocument: expect.objectContaining({
          text: 'export function cachedSymbol() { return true }\n',
        }),
      }),
    );
    expect(mockContext.lspOpenFileState?.has(filePath)).toBe(true);
  });
});
