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
  let process: ChildProcess | undefined;
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
      process = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...(typeof process !== 'undefined' ? process.env : {}), ...options?.env },
        cwd: options?.cwd,
        windowsHide: true,
      });

      if (!process.stdout || !process.stdin) {
        throw new Error('LSP server process stdio not available');
      }

      const spawnedProcess = process;
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

      if (process.stderr) {
        process.stderr.on('data', (data: Buffer) => {
          const output = data.toString().trim();
          if (output) {
            // Log stderr in debug mode if needed
          }
        });
      }

      process.on('exit', (code, signal) => {
        if (code !== 0 && code !== null && !isStopping) {
          isInitialized = false;
          const crashError = new Error(
            `LSP server ${serverName} exited with code ${code} (signal: ${signal})`,
          );
          onCrash?.(crashError);
        }
      });

      const reader = new StreamMessageReader(process.stdout);
      const writer = new StreamMessageWriter(process.stdin);
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
          await connection.sendRequest('shutdown', {});
          await connection.sendNotification('exit', {});
          connection.dispose();
        }
      } catch (e) {
        // Ignore shutdown errors
      } finally {
        if (process) {
          process.kill();
          process = undefined;
        }
        connection = undefined;
        isInitialized = false;
        isStopping = false;
      }
    },
  };
}
