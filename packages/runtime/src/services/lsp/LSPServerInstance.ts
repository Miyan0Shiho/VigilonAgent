import * as path from 'path';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import type { InitializeParams, ServerCapabilities, InitializeResult, PublishDiagnosticsParams } from 'vscode-languageserver-protocol';
import { createLSPClient, type LSPClient } from './LSPClient.js';
import type { LspServerState, ScopedLspServerConfig } from './types.js';
import { registerPendingLSPDiagnostic } from './LSPDiagnosticRegistry.js';

const LSP_ERROR_CONTENT_MODIFIED = -32801;
const MAX_RETRIES_FOR_TRANSIENT_ERRORS = 3;
const RETRY_BASE_DELAY_MS = 500;

export type LSPServerInstance = {
  readonly name: string;
  readonly config: ScopedLspServerConfig;
  readonly state: LspServerState;
  readonly startTime: Date | undefined;
  readonly lastError: Error | undefined;
  readonly restartCount: number;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  isHealthy(): boolean;
  sendRequest<T>(method: string, params: unknown): Promise<T>;
  sendNotification(method: string, params: unknown): Promise<void>;
  onNotification(method: string, handler: (params: unknown) => void): void;
  onRequest<TParams, TResult>(
    method: string,
    handler: (params: TParams) => TResult | Promise<TResult>,
  ): void;
};

export function createLSPServerInstance(
  name: string,
  config: ScopedLspServerConfig,
): LSPServerInstance {
  let state: LspServerState = 'stopped';
  let startTime: Date | undefined;
  let lastError: Error | undefined;
  let restartCount = 0;
  let crashRecoveryCount = 0;

  const client = createLSPClient(name, (error) => {
    state = 'error';
    lastError = error;
    crashRecoveryCount++;
  });

  client.onNotification('textDocument/publishDiagnostics', (params: any) => {
    const { uri, diagnostics } = params as PublishDiagnosticsParams;
    registerPendingLSPDiagnostic({
      serverName: name,
      files: [{ uri, diagnostics }],
    });
  });

  async function start(): Promise<void> {
    if (state === 'running' || state === 'starting') {
      return;
    }

    const maxRestarts = config.maxRestarts ?? 3;
    if (state === 'error' && crashRecoveryCount > maxRestarts) {
      const error = new Error(
        `LSP server '${name}' exceeded max crash recovery attempts (${maxRestarts})`,
      );
      lastError = error;
      throw error;
    }

    let initPromise: Promise<InitializeResult> | undefined;
    try {
      state = 'starting';

      const resolvedCommand = resolveLspCommand(config.command, config.workspaceFolder);

      await client.start(resolvedCommand, config.args || [], {
        env: config.env,
        cwd: config.workspaceFolder,
      });

      const workspaceFolder = config.workspaceFolder || process.cwd();
      const workspaceUri = pathToFileURL(workspaceFolder).href;

      const initParams: InitializeParams = {
        processId: process.pid,
        initializationOptions: config.initializationOptions ?? {},
        workspaceFolders: [
          {
            uri: workspaceUri,
            name: path.basename(workspaceFolder),
          },
        ],
        rootPath: workspaceFolder,
        rootUri: workspaceUri,
        capabilities: {
          workspace: {
            configuration: false,
            workspaceFolders: false,
          },
          textDocument: {
            synchronization: {
              dynamicRegistration: false,
              willSave: false,
              willSaveWaitUntil: false,
              didSave: true,
            },
            publishDiagnostics: {
              relatedInformation: true,
              tagSupport: {
                valueSet: [1, 2],
              },
              versionSupport: false,
              codeDescriptionSupport: true,
              dataSupport: false,
            },
            hover: {
              dynamicRegistration: false,
              contentFormat: ['markdown', 'plaintext'],
            },
            definition: {
              dynamicRegistration: false,
              linkSupport: true,
            },
            references: {
              dynamicRegistration: false,
            },
            documentSymbol: {
              dynamicRegistration: false,
              hierarchicalDocumentSymbolSupport: true,
            },
            callHierarchy: {
              dynamicRegistration: false,
            },
          },
          general: {
            positionEncodings: ['utf-16'],
          },
        },
      };

      initPromise = client.initialize(initParams);
      if (config.startupTimeout !== undefined) {
        await withTimeout(
          initPromise,
          config.startupTimeout,
          `LSP server '${name}' timed out after ${config.startupTimeout}ms during initialization`,
        );
      } else {
        await initPromise;
      }

      state = 'running';
      startTime = new Date();
      crashRecoveryCount = 0;
    } catch (error) {
      client.stop().catch(() => {});
      initPromise?.catch(() => {});
      state = 'error';
      lastError = error as Error;
      throw error;
    }
  }

  async function stop(): Promise<void> {
    if (state === 'stopping') {
      return;
    }

    try {
      state = 'stopping';
      await client.stop();
      state = 'stopped';
    } catch (error) {
      state = 'error';
      lastError = error as Error;
      throw error;
    }
  }

  async function restart(): Promise<void> {
    await stop();
    restartCount++;
    const maxRestarts = config.maxRestarts ?? 3;
    if (restartCount > maxRestarts) {
      throw new Error(`Max restart attempts (${maxRestarts}) exceeded for server '${name}'`);
    }
    await start();
  }

  function isHealthy(): boolean {
    return state === 'running' && client.isInitialized;
  }

  async function sendRequest<T>(method: string, params: unknown): Promise<T> {
    if (!isHealthy()) {
      throw new Error(
        `Cannot send request to LSP server '${name}': server is ${state}` +
          `${lastError ? `, last error: ${lastError.message}` : ''}`,
      );
    }

    let lastAttemptError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES_FOR_TRANSIENT_ERRORS; attempt++) {
      try {
        return await client.sendRequest<T>(method, params);
      } catch (error) {
        lastAttemptError = error as Error;
        const errorCode = (error as { code?: number }).code;
        const isContentModifiedError =
          typeof errorCode === 'number' && errorCode === LSP_ERROR_CONTENT_MODIFIED;

        if (isContentModifiedError && attempt < MAX_RETRIES_FOR_TRANSIENT_ERRORS) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        break;
      }
    }

    throw new Error(
      `LSP request '${method}' failed for server '${name}': ${lastAttemptError?.message ?? 'unknown error'}`,
    );
  }

  async function sendNotification(method: string, params: unknown): Promise<void> {
    if (!isHealthy()) {
      throw new Error(`Cannot send notification to LSP server '${name}': server is ${state}`);
    }
    await client.sendNotification(method, params);
  }

  function onNotification(method: string, handler: (params: unknown) => void): void {
    client.onNotification(method, handler);
  }

  function onRequest<TParams, TResult>(
    method: string,
    handler: (params: TParams) => TResult | Promise<TResult>,
  ): void {
    client.onRequest(method, handler);
  }

  return {
    name,
    config,
    get state() {
      return state;
    },
    get startTime() {
      return startTime;
    },
    get lastError() {
      return lastError;
    },
    get restartCount() {
      return restartCount;
    },
    start,
    stop,
    restart,
    isHealthy,
    sendRequest,
    sendNotification,
    onNotification,
    onRequest,
  };
}

function resolveLspCommand(command: string, workspaceFolder?: string): string {
  if (path.isAbsolute(command)) return command
  if (command.includes('/')) {
    return workspaceFolder ? path.resolve(workspaceFolder, command) : path.resolve(command)
  }

  // Resolve from project node_modules/.bin if not in PATH
  const root = findWorkspaceRoot(workspaceFolder ?? process.cwd())
  if (root) {
    const binName = process.platform === 'win32' ? `${command}.cmd` : command
    const resolved = path.join(root, 'node_modules', '.bin', binName)
    if (existsSync(resolved)) return resolved
  }

  return command
}

function findWorkspaceRoot(start: string): string | undefined {
  let current = path.resolve(start)
  while (true) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout((rej, msg) => rej(new Error(msg)), ms, reject, message);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer!));
}
