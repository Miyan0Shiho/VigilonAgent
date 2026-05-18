import type { LSPServerInstance } from './LSPServerInstance.js';
import { createLSPServerInstance } from './LSPServerInstance.js';
import type { ScopedLspServerConfig } from './types.js';

export type LSPServerManager = {
  initialize(configs: Record<string, ScopedLspServerConfig>): Promise<void>;
  shutdown(): Promise<void>;
  getServerForFile(filePath: string): LSPServerInstance | undefined;
  getAllServers(): Map<string, LSPServerInstance>;
};

export function createLSPServerManager(): LSPServerManager {
  const servers = new Map<string, LSPServerInstance>();
  const extensionToServers = new Map<string, LSPServerInstance[]>();

  return {
    async initialize(configs: Record<string, ScopedLspServerConfig>): Promise<void> {
      for (const [name, config] of Object.entries(configs)) {
        const instance = createLSPServerInstance(name, config);
        servers.set(name, instance);

        for (const ext of config.extensions) {
          const extWithDot = ext.startsWith('.') ? ext : `.${ext}`;
          const list = extensionToServers.get(extWithDot) || [];
          list.push(instance);
          extensionToServers.set(extWithDot, list);
        }
      }
    },

    async shutdown(): Promise<void> {
      await Promise.all(Array.from(servers.values()).map((s) => s.stop().catch(() => {})));
      servers.clear();
      extensionToServers.clear();
    },

    getServerForFile(filePath: string): LSPServerInstance | undefined {
      const ext = filePath.slice(((filePath.lastIndexOf('.') - 1) >>> 0) + 2);
      const extWithDot = `.${ext}`;
      const candidates = extensionToServers.get(extWithDot);
      if (!candidates || candidates.length === 0) return undefined;

      // For MVP, just return the first candidate.
      // In a more advanced implementation, we might check workspaceFolder.
      return candidates[0];
    },

    getAllServers(): Map<string, LSPServerInstance> {
      return servers;
    },
  };
}
