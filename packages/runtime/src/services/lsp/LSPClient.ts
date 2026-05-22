import { type ChildProcess, spawn } from 'child_process';
import {
  createMessageConnection,
  type MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  Trace,
} from 'vscode-jsonrpc/node.js';
import type {
  InitializeParams,
  InitializeResult,
  ServerCapabilities,
} from 'vscode-languageserver-protocol';
import process from 'node:process';

const LSP_SHUTDOWN_TIMEOUT_MS = 1000;
const LSP_PROCESS_EXIT_TIMEOUT_MS = 500;
const activeLspProcesses = new Set<ChildProcess>();
let processCleanupRegistered = false;

/**
 * LSP client interface.
 */
export type LSPClient = {
  readonly capabilities: ServerCapabilities | undefined;
  readonly isInitialized: boolean;
  start: (
    command: string,
    args: string[],
    options?: {
      env?: Record<string, string>;
      cwd?: string;
    },
  ) => Promise<void>;
  initialize: (params: InitializeParams) => Promise<InitializeResult>;
  sendRequest: <TResult>(method: string, params: unknown) => Promise<TResult>;
  sendNotification: (method: string, params: unknown) => Promise<void>;
  onNotification: (method: string, handler: (params: unknown) => void) => void;
  onRequest: <TParams, TResult>(
    method: string,
    handler: (params: TParams) => TResult | Promise<TResult>,
  ) => void;
  stop: () => Promise<void>;
};

/**
 * Create an LSP client wrapper using vscode-jsonrpc.
 * Manages communication with an LSP server process via stdio.
 */
export function createLSPClient(
  serverName: string,
  onCrash?: (error: Error) => void,
): LSPClient {
  let childProcess: ChildProcess | undefined;
  let connection: MessageConnection | undefined;
  let capabilities: ServerCapabilities | undefined;
  let isInitialized = false;
  let isStopping = false;

  const pendingHandlers: Array<{
    method: string;
    handler: (params: unknown) => void;
  }> = [];
  const pendingRequestHandlers: Array<{
    method: string;
    handler: (params: unknown) => unknown | Promise<unknown>;
  }> = [];

  return {
    get capabilities(): ServerCapabilities | undefined {
      return capabilities;
    },

    get isInitialized(): boolean {
      return isInitialized;
    },

    async start(
      command: string,
      args: string[],
      options?: {
        env?: Record<string, string>;
        cwd?: string;
      },
    ): Promise<void> {
      childProcess = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...options?.env },
        cwd: options?.cwd,
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
      activeLspProcesses.add(childProcess);
      registerProcessCleanup();

      if (!childProcess.stdout || !childProcess.stdin) {
        throw new Error('LSP server process stdio not available');
      }

      const spawnedProcess = childProcess;
      await new Promise<void>((resolve, reject) => {
        const onSpawn = (): void => {
          cleanup();
          resolve();
        };
        const onError = (error: Error): void => {
          cleanup();
          reject(error);
        };
        const cleanup = (): void => {
          spawnedProcess.removeListener('spawn', onSpawn);
          spawnedProcess.removeListener('error', onError);
        };
        spawnedProcess.once('spawn', onSpawn);
        spawnedProcess.once('error', onError);
      });

      if (childProcess.stderr) {
        childProcess.stderr.on('data', (data: Buffer) => {
          const output = data.toString().trim();
          if (output) {
            // Log stderr in debug mode if needed
          }
        });
      }

      childProcess.on('exit', (code, signal) => {
        activeLspProcesses.delete(spawnedProcess);
        if (code !== 0 && code !== null && !isStopping) {
          isInitialized = false;
          const crashError = new Error(
            `LSP server ${serverName} exited with code ${code} (signal: ${signal})`,
          );
          onCrash?.(crashError);
        }
      });

      const reader = new StreamMessageReader(childProcess.stdout);
      const writer = new StreamMessageWriter(childProcess.stdin);
      connection = createMessageConnection(reader, writer);

      connection.onClose(() => {
        if (!isStopping) {
          isInitialized = false;
        }
      });

      connection.listen();

      // Apply queued handlers
      for (const { method, handler } of pendingHandlers) {
        connection.onNotification(method, handler);
      }
      pendingHandlers.length = 0;

      for (const { method, handler } of pendingRequestHandlers) {
        connection.onRequest(method, handler);
      }
      pendingRequestHandlers.length = 0;
    },

    async initialize(params: InitializeParams): Promise<InitializeResult> {
      if (!connection) throw new Error('LSP client not started');

      const result = await connection.sendRequest<InitializeResult>('initialize', params);
      capabilities = result.capabilities;
      await connection.sendNotification('initialized', {});
      isInitialized = true;
      return result;
    },

    async sendRequest<TResult>(method: string, params: unknown): Promise<TResult> {
      if (!connection) throw new Error('LSP client not started');
      if (!isInitialized) throw new Error('LSP client not initialized');
      return await connection.sendRequest<TResult>(method, params);
    },

    async sendNotification(method: string, params: unknown): Promise<void> {
      if (!connection) throw new Error('LSP client not started');
      await connection.sendNotification(method, params);
    },

    onNotification(method: string, handler: (params: unknown) => void): void {
      if (!connection) {
        pendingHandlers.push({ method, handler });
        return;
      }
      connection.onNotification(method, handler);
    },

    onRequest<TParams, TResult>(
      method: string,
      handler: (params: TParams) => TResult | Promise<TResult>,
    ): void {
      if (!connection) {
        pendingRequestHandlers.push({ method, handler: handler as any });
        return;
      }
      connection.onRequest(method, handler);
    },

    async stop(): Promise<void> {
      isStopping = true;
      try {
        if (connection) {
          await waitForShutdown(connection.sendRequest('shutdown', {}));
          void connection.sendNotification('exit', {}).catch(() => {});
          connection.dispose();
        }
      } catch (e) {
        // Ignore shutdown errors
      } finally {
        if (childProcess) {
          await terminateChildProcess(childProcess);
          childProcess = undefined;
        }
        connection = undefined;
        isInitialized = false;
        isStopping = false;
      }
    },
  };
}

async function waitForShutdown(shutdownRequest: Promise<unknown>): Promise<void> {
  await Promise.race([
    Promise.resolve(shutdownRequest).catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, LSP_SHUTDOWN_TIMEOUT_MS)),
  ]);
}

async function terminateChildProcess(childProcess: ChildProcess): Promise<void> {
  destroyStream(childProcess.stdin);
  destroyStream(childProcess.stdout);
  destroyStream(childProcess.stderr);
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return;
  activeLspProcesses.delete(childProcess);
  const exited = waitForProcessExit(childProcess);
  killProcessTree(childProcess, 'SIGTERM');
  const didExit = await Promise.race([
    exited.then(() => true),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), LSP_PROCESS_EXIT_TIMEOUT_MS),
    ),
  ]);
  if (!didExit && childProcess.exitCode === null && childProcess.signalCode === null) {
    killProcessTree(childProcess, 'SIGKILL');
    await Promise.race([
      exited,
      new Promise<void>((resolve) =>
        setTimeout(resolve, LSP_PROCESS_EXIT_TIMEOUT_MS),
      ),
    ]);
  }
}

function waitForProcessExit(childProcess: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
      resolve();
      return;
    }
    childProcess.once('exit', () => resolve());
    childProcess.once('close', () => resolve());
  });
}

function registerProcessCleanup(): void {
  if (processCleanupRegistered) return;
  processCleanupRegistered = true;
  process.once('exit', () => {
    for (const childProcess of activeLspProcesses) {
      killProcessTree(childProcess, 'SIGKILL');
    }
    activeLspProcesses.clear();
  });
}

function killProcessTree(childProcess: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32' && childProcess.pid) {
    try {
      process.kill(-childProcess.pid, signal);
      return;
    } catch {
      // Fall back to killing the direct child below.
    }
  }
  childProcess.kill(signal);
}

function destroyStream(stream: NodeJS.WritableStream | NodeJS.ReadableStream | null | undefined): void {
  if (!stream || typeof (stream as { destroy?: unknown }).destroy !== 'function') return;
  (stream as unknown as { destroy: () => void }).destroy();
}
