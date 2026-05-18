import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js';
import { formatLocation, formatHover, formatSymbol, formatDiagnostic } from './lsp/formatters.js';
import { resolveToolPath, isUncPath, isBlockedDevicePath } from './path.js';
import type {
  TextDocumentPositionParams,
  ReferenceParams,
  DocumentSymbolParams,
} from 'vscode-languageserver-protocol';

export const LspTool: Tool = {
  name: 'LSP',
  description: 'Language Server Protocol tool for code intelligence (definition, references, symbols, hover, diagnostics).',
  readOnly: true,
  deferred: true,
  inputJsonSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'goToDefinition',
          'findReferences',
          'hover',
          'documentSymbol',
          'workspace_symbol',
          'implementation',
          'call_hierarchy',
          'diagnostics',
        ],
      },
      query: {
        type: 'string',
        description: 'Workspace symbol query string',
      },
      filePath: {
        type: 'string',
        description: 'Absolute or cwd-relative path to the file',
      },
      line: {
        type: 'number',
        description: '1-based line number',
      },
      character: {
        type: 'number',
        description: '1-based character position',
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const {
      action,
      query,
      filePath: rawPath,
      line: rawLine,
      character: rawCharacter,
    } = input as any;

    try {
      if (action === 'workspace_symbol') {
        const symbols = await context.lspServerManager.workspaceSymbol(query ?? '');
        if (!symbols || symbols.length === 0) {
          return ok('No workspace symbols found.');
        }
        return ok(
          [
            'workspace symbols:',
            ...symbols.map(symbol => {
              const location = symbol.location ? formatLocation(symbol.location) : 'unresolved';
              return `- ${formatSymbol(symbol)} @ ${location}`;
            }),
          ].join('\n'),
        );
      }

      const filePath = await resolveReadableFilePath({
        context,
        action,
        rawPath,
      });
      if (!filePath.ok) {
        return filePath.result;
      }

      const resolvedPath = filePath.filePath;
      const line = (rawLine ?? 1) - 1;
      const character = (rawCharacter ?? 1) - 1;

      if (action === 'implementation') {
        const result = await context.lspServerManager.implementation(
          resolvedPath,
          line,
          character,
        );
        return ok(
          result
            ? ['implementation:', ...formatLocations(result)].join('\n')
            : 'No implementation found.',
        );
      }

      if (action === 'call_hierarchy') {
        const result = await context.lspServerManager.callHierarchy(
          resolvedPath,
          line,
          character,
        );
        if (!result) {
          return ok('No call hierarchy found.');
        }
        const incoming =
          result.incoming.length > 0
            ? result.incoming.map(call => `- ${call.from.name}`).join('\n')
            : '- none';
        const outgoing =
          result.outgoing.length > 0
            ? result.outgoing.map(call => `- ${call.to.name}`).join('\n')
            : '- none';
        return ok(
          [
            `call hierarchy for ${result.item.name}:`,
            'incoming calls:',
            incoming,
            'outgoing calls:',
            outgoing,
          ].join('\n'),
        );
      }

      if (action === 'diagnostics') {
        const diagnostics = await context.lspServerManager.getDiagnostics(resolvedPath);
        return ok(
          diagnostics.length > 0
            ? ['diagnostics:', ...diagnostics.map(formatDiagnostic)].join('\n')
            : 'No diagnostics found.',
        );
      }

      const server = context.lspServerManager.getServerForFile(resolvedPath);
      if (!server) {
        return failed(`No LSP server found for file: ${rawPath}`);
      }

      await server.start();

      // Send didOpen if not already opened
      if (!context.readFileState?.has(resolvedPath)) {
        const content = await context.lspServerManager.getFileContent(resolvedPath);
        await server.sendNotification('textDocument/didOpen', {
          textDocument: {
            uri: `file://${resolvedPath}`,
            languageId: server.config.languages[0] || 'typescript',
            version: 1,
            text: content,
          },
        });
      }

      switch (action) {
        case 'goToDefinition': {
          const params: TextDocumentPositionParams = {
            textDocument: { uri: `file://${resolvedPath}` },
            position: { line, character },
          };
          const result = await server.sendRequest<any>('textDocument/definition', params);
          return ok(result ? (Array.isArray(result) ? result.map(formatLocation).join('\n') : formatLocation(result)) : 'No definition found.');
        }

        case 'findReferences': {
          const params: ReferenceParams = {
            textDocument: { uri: `file://${resolvedPath}` },
            position: { line, character },
            context: { includeDeclaration: true },
          };
          const result = await server.sendRequest<any[]>('textDocument/references', params);
          return ok(result && result.length > 0 ? result.map(formatLocation).join('\n') : 'No references found.');
        }

        case 'hover': {
          const params: TextDocumentPositionParams = {
            textDocument: { uri: `file://${resolvedPath}` },
            position: { line, character },
          };
          const result = await server.sendRequest<any>('textDocument/hover', params);
          return ok(result ? formatHover(result) : 'No hover information found.');
        }

        case 'documentSymbol': {
          const params: DocumentSymbolParams = {
            textDocument: { uri: `file://${resolvedPath}` },
          };
          const result = await server.sendRequest<any[]>('textDocument/documentSymbol', params);
          return ok(result && result.length > 0 ? result.map(formatSymbol).join('\n') : 'No symbols found.');
        }

        default:
          return failed(`Unsupported action: ${action}`);
      }
    } catch (error) {
      return failed(`LSP request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

function ok(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { toolCallId: '', ok: true, content, metadata };
}

function failed(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { toolCallId: '', ok: false, content, metadata };
}

async function resolveReadableFilePath({
  context,
  action,
  rawPath,
}: {
  context: ToolUseContext;
  action: string;
  rawPath: string | undefined;
}): Promise<
  | {
      ok: true;
      filePath: string;
    }
  | {
      ok: false;
      result: ToolResult;
    }
> {
  if (!rawPath) {
    return {
      ok: false,
      result: failed(`LSP action "${action}" requires a filePath.`),
    };
  }

  const filePath = resolveToolPath(context.cwd, rawPath);
  if (isUncPath(filePath)) {
    return {
      ok: false,
      result: failed('UNC paths are not supported by the local LSP tool'),
    };
  }
  if (isBlockedDevicePath(filePath)) {
    return {
      ok: false,
      result: failed(`Refusing to access blocked device path: ${filePath}`),
    };
  }

  const permission = await context.permissionGate.requestPermission({
    action: 'read',
    subject: filePath,
    risk: 'low',
    reason: `LSP ${action} on file`,
  });
  if (!permission.allowed) {
    return {
      ok: false,
      result: failed(permission.reason),
    };
  }

  return {
    ok: true,
    filePath,
  };
}

function formatLocations(result: any): string[] {
  if (!result) return [];
  if (Array.isArray(result)) return result.map(formatLocation);
  return [formatLocation(result)];
}
