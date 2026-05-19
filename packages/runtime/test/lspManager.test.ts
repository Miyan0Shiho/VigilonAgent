import { test, expect, describe, vi } from 'vitest';
import { createLSPServerManager } from '../src/services/lsp/LSPServerManager';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('vscode-jsonrpc/node.js', () => {
  class MockReader {}
  class MockWriter {}
  return {
    StreamMessageReader: MockReader,
    StreamMessageWriter: MockWriter,
    createMessageConnection: vi.fn(() => ({
      listen: vi.fn(),
      onClose: vi.fn(),
      sendRequest: vi.fn(async (method) => {
        if (method === 'initialize') {
          return { capabilities: {} };
        }
        return {};
      }),
      sendNotification: vi.fn(),
      onNotification: vi.fn(),
      onRequest: vi.fn(),
      dispose: vi.fn(),
    })),
    Trace: { Verbose: 'verbose' },
  };
});

describe('LSPServerManager', () => {
  test('should manage multiple servers', async () => {
    const mockProcess = new EventEmitter() as any;
    mockProcess.stdin = new EventEmitter();
    mockProcess.stdin.write = vi.fn();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.kill = vi.fn();
    (spawn as any).mockReturnValue(mockProcess);

    const manager = createLSPServerManager();
    await manager.initialize({
      ts: {
        command: 'ts-lsp',
        languages: ['typescript'],
        extensions: ['.ts'],
      },
      py: {
        command: 'py-lsp',
        languages: ['python'],
        extensions: ['.py'],
      },
    });

    const tsServer = manager.getServerForFile('test.ts');
    expect(tsServer).toBeDefined();
    expect(tsServer?.name).toBe('ts');

    const pyServer = manager.getServerForFile('test.py');
    expect(pyServer).toBeDefined();
    expect(pyServer?.name).toBe('py');

    const unknownServer = manager.getServerForFile('test.txt');
    expect(unknownServer).toBeUndefined();

    // Test start
    const startPromise = tsServer?.start();
    mockProcess.emit('spawn');
    await startPromise;
    expect(tsServer?.state).toBe('running');

    await manager.shutdown();
    expect(tsServer?.state).toBe('stopped');
  });

  test('should initialize idempotently so routed servers are shut down', async () => {
    const mockProcess = new EventEmitter() as any;
    mockProcess.stdin = new EventEmitter();
    mockProcess.stdin.write = vi.fn();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.kill = vi.fn();
    (spawn as any).mockReturnValue(mockProcess);

    const manager = createLSPServerManager();
    const configs = {
      ts: {
        command: 'ts-lsp',
        languages: ['typescript'],
        extensions: ['.ts'],
      },
    };

    await manager.initialize(configs);
    const firstServer = manager.getServerForFile('test.ts');
    await manager.initialize(configs);
    const secondServer = manager.getServerForFile('test.ts');

    expect(secondServer).toBe(firstServer);

    const startPromise = firstServer?.start();
    mockProcess.emit('spawn');
    await startPromise;
    expect(firstServer?.state).toBe('running');

    await manager.shutdown();
    expect(firstServer?.state).toBe('stopped');
  });
});
