import type { LSPServerInstance } from './LSPServerInstance.js';
import { createLSPServerInstance } from './LSPServerInstance.js';
import { getLatestDiagnosticsForFile } from './LSPDiagnosticRegistry.js';
import type { ScopedLspServerConfig } from './types.js';
import { readFile } from 'node:fs/promises';
import type { Diagnostic } from 'vscode-languageserver-protocol';

export type LSPServerManager = {
  initialize(configs: Record<string, ScopedLspServerConfig>): Promise<void>;
  shutdown(): Promise<void>;
  getServerForFile(filePath: string): LSPServerInstance | undefined;
  getAllServers(): Map<string, LSPServerInstance>;
  getFileContent(filePath: string): Promise<string>;
  workspaceSymbol(query: string): Promise<any[]>;
  implementation(filePath: string, line: number, character: number): Promise<any>;
  callHierarchy(
    filePath: string,
    line: number,
    character: number,
  ): Promise<
    | {
        item: any;
        incoming: any[];
        outgoing: any[];
      }
    | undefined
  >;
  getDiagnostics(filePath: string): Promise<Diagnostic[]>;
};

export function createLSPServerManager(): LSPServerManager {
  const servers = new Map<string, LSPServerInstance>();
  const extensionToServers = new Map<string, LSPServerInstance[]>();

  return {
    async initialize(configs: Record<string, ScopedLspServerConfig>): Promise<void> {
      if (servers.size > 0) return;

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
      const instances = new Set<LSPServerInstance>(servers.values());
      for (const candidates of extensionToServers.values()) {
        for (const server of candidates) instances.add(server);
      }
      await Promise.all(Array.from(instances).map((s) => s.stop().catch(() => {})));
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

    async getFileContent(filePath: string): Promise<string> {
      try {
        return await readFile(filePath, 'utf8');
      } catch (error) {
        return '';
      }
    },

    async workspaceSymbol(query: string): Promise<any[]> {
      const server = servers.values().next().value as LSPServerInstance | undefined;
      if (!server) return [];
      await server.start();
      const result = await server.sendRequest<any[]>('workspace/symbol', { query });
      return result ?? [];
    },

    async implementation(
      filePath: string,
      line: number,
      character: number,
    ): Promise<any> {
      const server = this.getServerForFile(filePath);
      if (!server) return undefined;
      await openDocument(server, filePath, this.getFileContent);
      return server.sendRequest('textDocument/implementation', {
        textDocument: { uri: `file://${filePath}` },
        position: { line, character },
      });
    },

    async callHierarchy(
      filePath: string,
      line: number,
      character: number,
    ): Promise<
      | {
          item: any;
          incoming: any[];
          outgoing: any[];
        }
      | undefined
    > {
      const server = this.getServerForFile(filePath);
      if (!server) return undefined;
      await openDocument(server, filePath, this.getFileContent);
      const prepared = await server.sendRequest<any[] | any>(
        'textDocument/prepareCallHierarchy',
        {
          textDocument: { uri: `file://${filePath}` },
          position: { line, character },
        },
      );
      const item = Array.isArray(prepared) ? prepared[0] : prepared;
      if (!item) return undefined;
      const [incoming, outgoing] = await Promise.all([
        server.sendRequest<any[]>('callHierarchy/incomingCalls', { item }),
        server.sendRequest<any[]>('callHierarchy/outgoingCalls', { item }),
      ]);
      return {
        item,
        incoming: incoming ?? [],
        outgoing: outgoing ?? [],
      };
    },

    async getDiagnostics(filePath: string): Promise<Diagnostic[]> {
      return getLatestDiagnosticsForFile(filePath);
    },
  };
}

async function openDocument(
  server: LSPServerInstance,
  filePath: string,
  readContent: (filePath: string) => Promise<string>,
): Promise<void> {
  await server.start();
  const content = await readContent(filePath);
  await server.sendNotification('textDocument/didOpen', {
    textDocument: {
      uri: `file://${filePath}`,
      languageId: server.config.languages[0] || 'typescript',
      version: 1,
      text: content,
    },
  });
}
