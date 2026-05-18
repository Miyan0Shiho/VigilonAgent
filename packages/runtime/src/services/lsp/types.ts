export type LspServerState = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

export interface LspServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  initializationOptions?: any;
  maxRestarts?: number;
  startupTimeout?: number;
  shutdownTimeout?: number;
}

export interface ScopedLspServerConfig extends LspServerConfig {
  languages: string[];
  extensions: string[];
  workspaceFolder?: string;
}
