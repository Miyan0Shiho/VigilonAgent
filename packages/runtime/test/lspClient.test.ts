import { test, expect, describe, vi } from 'vitest';
import { createLSPClient } from '../src/services/lsp/LSPClient';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// Mock child_process.spawn
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock vscode-jsonrpc/node.js
vi.mock('vscode-jsonrpc/node.js', () => {
  class MockReader {}
  class MockWriter {}
  return {
    StreamMessageReader: MockReader,
    StreamMessageWriter: MockWriter,
    createMessageConnection: vi.fn(() => ({
      listen: vi.fn(),
      onClose: vi.fn(),
      sendRequest: vi.fn(),
      sendNotification: vi.fn(),
      onNotification: vi.fn(),
      onRequest: vi.fn(),
      dispose: vi.fn(),
    })),
    Trace: { Verbose: 'verbose' },
  };
});

describe('LSPClient', () => {
  test('should be defined', () => {
    expect(createLSPClient).toBeDefined();
  });

  test('should start and initialize (mocked)', async () => {
    const mockProcess = new EventEmitter() as any;
    mockProcess.stdin = new EventEmitter();
    mockProcess.stdin.write = vi.fn();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.kill = vi.fn();

    (spawn as any).mockReturnValue(mockProcess);

    const client = createLSPClient('test-server');
    
    // Start client
    const startPromise = client.start('test-cmd', []);
    
    // Simulate process spawn
    mockProcess.emit('spawn');
    
    await startPromise;
    expect(spawn).toHaveBeenCalled();

    // Clean up
    await client.stop();
  });
});
