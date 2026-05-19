import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js';
import { createHash } from 'node:crypto';

export const ToolSearchTool: Tool = {
  name: 'ToolSearch',
  description: 'Searches for deferred tools by capability, name, description, schema fields, and search terms. Use this when you need a capability that is not currently in your tool pool.',
  readOnly: true,
  inputJsonSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query (e.g., "git", "file manipulation", "mcp")' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const { query } = input as { query: string };
    const normalizedQuery = normalizeText(query);
    const queryTokens = tokenize(query);
    
    const deferredTools = context.tools.list().filter(t => t.deferred);
    const matches = deferredTools
      .map(tool => ({
        tool,
        match: scoreToolMatch(tool, normalizedQuery, queryTokens),
      }))
      .filter(candidate => candidate.match.score > 0)
      .sort((a, b) => b.match.score - a.match.score);

    if (matches.length === 0) {
      return ok(
        [
          `No deferred tools found matching "${query}".`,
          '',
          'Available deferred tools:',
          ...deferredTools.map(tool => {
            const terms = tool.searchTerms?.length
              ? ` Search terms: ${tool.searchTerms.join(', ')}.`
              : '';
            return `- ${tool.name}: ${tool.description}${terms}`;
          }),
        ].join('\n'),
        {
          availableDeferredTools: deferredTools.map(tool => tool.name),
        },
      );
    }

    const results = matches.map(({ tool, match }) => {
      return `Tool: ${tool.name}\nDescription: ${tool.description}\n` +
             `Matched: ${match.reasons.join(', ')}\n` +
             `To use this tool, you can now call it directly in your next turn. ` +
             `Its schema has been "materialized" for you.`;
    }).join('\n\n');

    return ok(`Found ${matches.length} matching deferred tools:\n\n${results}`, {
      discoveredTools: matches.map(({ tool }) => tool.name),
      toolReferenceDeltas: matches.map(({ tool, match }) => ({
        name: tool.name,
        reason: `ToolSearch matched query "${query}" via ${match.reasons.join(', ')}`,
        schemaHash: hashToolSchema(tool),
        discoveredAt: new Date().toISOString(),
      })),
    });
  },
};

function ok(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { toolCallId: '', ok: true, content, metadata };
}

function scoreToolMatch(
  tool: Tool,
  normalizedQuery: string,
  queryTokens: readonly string[],
): { score: number; reasons: string[] } {
  const haystackParts = [
    tool.name,
    tool.description,
    ...(tool.searchTerms ?? []),
    JSON.stringify(tool.inputJsonSchema ?? {}),
  ];
  const normalizedHaystack = normalizeText(haystackParts.join(' '));
  const haystackTokens = new Set(tokenize(normalizedHaystack));
  const reasons: string[] = [];
  let score = 0;

  if (normalizeText(tool.name) === normalizedQuery) {
    score += 100;
    reasons.push('exact tool name');
  } else if (normalizeText(tool.name).includes(normalizedQuery)) {
    score += 80;
    reasons.push('tool name');
  }

  const matchedSearchTerms = (tool.searchTerms ?? []).filter(term =>
    phraseMatchesQuery(normalizeText(term), normalizedQuery, queryTokens),
  );
  if (matchedSearchTerms.length > 0) {
    score += 30 + matchedSearchTerms.length * 5;
    reasons.push(`search terms: ${matchedSearchTerms.slice(0, 4).join(', ')}`);
  }

  const matchedTokens = queryTokens.filter(token => haystackTokens.has(token));
  if (matchedTokens.length > 0) {
    score += matchedTokens.length;
    reasons.push(`tokens: ${matchedTokens.slice(0, 6).join(', ')}`);
  }
  if (queryTokens.length > 0 && matchedTokens.length === queryTokens.length) {
    score += 20;
    reasons.push('all query tokens');
  }

  if (normalizedHaystack.includes(normalizedQuery)) {
    score += 15;
    reasons.push('description/schema phrase');
  }

  return {
    score,
    reasons: [...new Set(reasons)],
  };
}

function phraseMatchesQuery(
  normalizedPhrase: string,
  normalizedQuery: string,
  queryTokens: readonly string[],
): boolean {
  if (!normalizedPhrase) return false;
  if (normalizedPhrase.includes(normalizedQuery)) return true;
  if (normalizedQuery.includes(normalizedPhrase)) return true;
  const phraseTokens = tokenize(normalizedPhrase);
  return queryTokens.some(token => phraseTokens.includes(token));
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/i)
    .map(token => token.trim())
    .filter(token => token.length >= 2);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, ' ').trim();
}

function hashToolSchema(tool: Tool): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        name: tool.name,
        description: tool.description,
        inputJsonSchema: tool.inputJsonSchema,
        readOnly: tool.readOnly ?? false,
      }),
    )
    .digest('hex');
}
