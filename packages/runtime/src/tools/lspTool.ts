import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js';
import { formatLocation, formatHover, formatSymbol } from './lsp/formatters.js';
import type {
  TextDocumentPositionParams,
  ReferenceParams,
  DocumentSymbolParams,
} from 'vscode-languageserver-protocol';

export const LspTool: Tool = {
  name: 'LSP',
  description: 'Language Server Protocol tool for code intelligence (definition, references, symbols, hover).',
  readOnly: true,
  inputJsonSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['goToDefinition', 'findReferences', 'hover', 'documentSymbol'],
      },
      filePath: {
        type: 'string',
        description: 'Absolute path to the file',
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
    required: ['action', 'filePath'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const { action, filePath, line: rawLine, character: rawCharacter } = input as any;
    
    const server = context.lspServerManager.getServerForFile(filePath);
    if (!server) {
      return failed(`No LSP server found for file extension: ${filePath}`);
    }

    try {
      await server.start();

      // Convert 1-based to 0-based
      const line = (rawLine ?? 1) - 1;
      const character = (rawCharacter ?? 1) - 1;

      switch (action) {
        case 'goToDefinition': {
          const params: TextDocumentPositionParams = {
            textDocument: { uri: `file://${filePath}` },
            position: { line, character },
          };
          const result = await server.sendRequest<any>('textDocument/definition', params);
          return ok(result ? (Array.isArray(result) ? result.map(formatLocation).join('\n') : formatLocation(result)) : 'No definition found.');
        }

        case 'findReferences': {
          const params: ReferenceParams = {
            textDocument: { uri: `file://${filePath}` },
            position: { line, character },
            context: { includeDeclaration: true },
          };
          const result = await server.sendRequest<any[]>('textDocument/references', params);
          return ok(result && result.length > 0 ? result.map(formatLocation).join('\n') : 'No references found.');
        }

        case 'hover': {
          const params: TextDocumentPositionParams = {
            textDocument: { uri: `file://${filePath}` },
            position: { line, character },
          };
          const result = await server.sendRequest<any>('textDocument/hover', params);
          return ok(result ? formatHover(result) : 'No hover information found.');
        }

        case 'documentSymbol': {
          const params: DocumentSymbolParams = {
            textDocument: { uri: `file://${filePath}` },
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
