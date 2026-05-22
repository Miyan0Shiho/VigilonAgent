import type { ScopedLspServerConfig } from './types.js';

export const DEFAULT_LSP_CONFIGS: Record<string, ScopedLspServerConfig> = {
  typescript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    languages: ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'],
    extensions: ['.ts', '.js', '.tsx', '.jsx'],
    startupTimeout: 10000,
  },
  python: {
    command: 'pyright-langserver',
    args: ['--stdio'],
    languages: ['python'],
    extensions: ['.py'],
    startupTimeout: 10000,
  },
  go: {
    command: 'gopls',
    args: [],
    languages: ['go'],
    extensions: ['.go'],
    startupTimeout: 10000,
  },
  rust: {
    command: 'rust-analyzer',
    args: [],
    languages: ['rust'],
    extensions: ['.rs'],
    startupTimeout: 30000,
  },
};
