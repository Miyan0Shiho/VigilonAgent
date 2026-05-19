import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js';
import { formatLocation, formatHover, formatSymbol, formatDiagnostic } from './lsp/formatters.js';
import { resolveToolPath, isUncPath, isBlockedDevicePath } from './path.js';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
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
  searchTerms: [
    'language',
    'language server',
    'code intelligence',
    'structural code intelligence',
    'symbol',
    'symbols',
    'document symbol',
    'workspace symbol',
    'definition',
    'go to definition',
    'references',
    'find references',
    'implementation',
    'call hierarchy',
    'hover',
    'diagnostics',
    'type errors',
  ],
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

    let resolvedPathForFallback: string | undefined;
    try {
      if (action === 'workspace_symbol') {
        const permission = await context.permissionGate.requestPermission({
          action: 'read',
          subject: context.cwd,
          risk: 'low',
          reason: 'LSP workspace symbol search',
        });
        if (!permission.allowed) return failed(permission.reason);
        const symbols = await context.lspServerManager.workspaceSymbol(query ?? '');
        if (!symbols || symbols.length === 0) {
          return ok('No workspace symbols found.');
        }
        return ok(
          budgetResult([
            'workspace symbols:',
            ...symbols.map(symbol => {
              const location = symbol.location ? formatLocation(symbol.location) : 'unresolved';
              return `- ${formatSymbol(symbol)} @ ${location}`;
            }),
          ].join('\n')),
          { count: symbols.length, budgeted: true },
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
      resolvedPathForFallback = resolvedPath;
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
            ? budgetResult(['implementation:', ...formatLocations(result)].join('\n'))
            : 'No implementation found.',
          { budgeted: Boolean(result) },
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
          {
            incomingCount: result.incoming.length,
            outgoingCount: result.outgoing.length,
          },
        );
      }

      if (action === 'diagnostics') {
        const diagnostics = await context.lspServerManager.getDiagnostics(resolvedPath);
        return ok(
          diagnostics.length > 0
            ? budgetResult(['diagnostics:', ...diagnostics.map(formatDiagnostic)].join('\n'))
            : 'No diagnostics found.',
          { count: diagnostics.length, budgeted: diagnostics.length > 0 },
        );
      }

      const server = context.lspServerManager.getServerForFile(resolvedPath);
      if (!server) {
        return failed(`No LSP server found for file: ${rawPath}`);
      }

      await server.start();

      // Track LSP-opened files separately from Read cache. A file being present
      // in readFileState only means the model has seen it, not that the LSP
      // server received textDocument/didOpen.
      if (!context.lspOpenFileState?.has(resolvedPath)) {
        const fileStat = await stat(resolvedPath);
        const content =
          context.readFileState?.get(resolvedPath)?.content ??
          (await context.lspServerManager.getFileContent(resolvedPath));
        await server.sendNotification('textDocument/didOpen', {
          textDocument: {
            uri: `file://${resolvedPath}`,
            languageId: server.config.languages[0] || 'typescript',
            version: 1,
            text: content,
          },
        });
        context.readFileState?.set(resolvedPath, {
          content,
          mtimeMs: fileStat.mtimeMs,
          fullRead: true,
        });
        context.lspOpenFileState?.add(resolvedPath);
      }

      switch (action) {
        case 'goToDefinition': {
          const params: TextDocumentPositionParams = {
            textDocument: { uri: `file://${resolvedPath}` },
            position: { line, character },
          };
          const result = await server.sendRequest<any>('textDocument/definition', params);
          return ok(result ? budgetResult(Array.isArray(result) ? result.map(formatLocation).join('\n') : formatLocation(result)) : 'No definition found.');
        }

        case 'findReferences': {
          const params: ReferenceParams = {
            textDocument: { uri: `file://${resolvedPath}` },
            position: { line, character },
            context: { includeDeclaration: true },
          };
          const result = await server.sendRequest<any[]>('textDocument/references', params);
          return ok(result && result.length > 0 ? budgetResult(result.map(formatLocation).join('\n')) : 'No references found.', { count: result?.length ?? 0 });
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
          return ok(result && result.length > 0 ? budgetResult(result.map(formatSymbol).join('\n')) : 'No symbols found.', { count: result?.length ?? 0 });
        }

        default:
          return failed(`Unsupported action: ${action}`);
      }
    } catch (error) {
      if (action === 'documentSymbol' && resolvedPathForFallback) {
        return fallbackDocumentSymbols({
          context,
          filePath: resolvedPathForFallback,
          error,
        });
      }
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
  const relative = path.relative(context.cwd, filePath).split(path.sep).join('/');
  if (context.projectConfig?.ignore.some(pattern => matchesIgnore(pattern, relative))) {
    return {
      ok: false,
      result: failed(`LSP path is ignored by project config: ${relative}`),
    };
  }
  const fileStat = await stat(filePath).catch(() => undefined);
  if (!fileStat?.isFile()) {
    return {
      ok: false,
      result: failed(`LSP file does not exist or is not a file: ${rawPath}`),
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

function budgetResult(content: string, maxChars = 12_000): string {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n\n[LSP result truncated by runtime budget]`;
}

async function fallbackDocumentSymbols({
  context,
  filePath,
  error,
}: {
  context: ToolUseContext;
  filePath: string;
  error: unknown;
}): Promise<ToolResult> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const content =
    context.readFileState?.get(filePath)?.content ??
    (await context.lspServerManager.getFileContent(filePath).catch(() => undefined)) ??
    (await readFile(filePath, 'utf8').catch(() => ''));
  const symbols = extractFallbackDocumentSymbols(content);
  const recoveryHint =
    'LSP server is unavailable; using read-only text symbol fallback. Continue with Read/Grep if exact references or type-aware navigation are needed.';
  if (symbols.length === 0) {
    return ok(
      [
        `LSP unavailable: ${errorMessage}`,
        recoveryHint,
        'No fallback document symbols found.',
      ].join('\n'),
      {
        lspUnavailable: true,
        fallback: 'text-document-symbols',
        symbolCount: 0,
      },
    );
  }
  return ok(
    budgetResult([
      `LSP unavailable: ${errorMessage}`,
      recoveryHint,
      'fallback document symbols:',
      ...symbols.map(symbol => `- ${symbol.name} (${symbol.kind}) @ ${symbol.line}:1`),
    ].join('\n')),
    {
      lspUnavailable: true,
      fallback: 'text-document-symbols',
      symbolCount: symbols.length,
      budgeted: true,
    },
  );
}

function extractFallbackDocumentSymbols(content: string): Array<{
  name: string;
  kind: string;
  line: number;
}> {
  const symbols: Array<{ name: string; kind: string; line: number }> = [];
  const seen = new Set<string>();
  const patterns: Array<{ kind: string; regex: RegExp }> = [
    {
      kind: 'function',
      regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/,
    },
    {
      kind: 'class',
      regex: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b/,
    },
    {
      kind: 'interface',
      regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/,
    },
    {
      kind: 'type',
      regex: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\b/,
    },
    {
      kind: 'const',
      regex: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\b/,
    },
  ];
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const pattern of patterns) {
      const match = pattern.regex.exec(line);
      if (!match?.[1]) continue;
      const key = `${pattern.kind}:${match[1]}:${index + 1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      symbols.push({
        name: match[1],
        kind: pattern.kind,
        line: index + 1,
      });
      break;
    }
  }
  return symbols;
}

function matchesIgnore(pattern: string, relativePath: string): boolean {
  const normalized = pattern.replace(/^\//, '').replace(/\/$/, '');
  if (!normalized) return false;
  if (normalized.includes('*')) {
    const regex = new RegExp(`^${normalized.split('*').map(escapeRegex).join('.*')}$`);
    return regex.test(relativePath);
  }
  return relativePath === normalized || relativePath.startsWith(`${normalized}/`);
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}
